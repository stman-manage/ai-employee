import { TOOL_DEFS, isBrowserTool, runBrowserTool } from "./tools.js";
import {
  getJob, updateJob, getMessages, addMessage, addStep, addToolResult, emit,
} from "./db.js";

const SYSTEM_PROMPT = `You are an autonomous AI employee that operates a real web browser to complete tasks for the user.

You work in a loop: read the current state, decide the next single action, call exactly one tool, observe the result, and repeat until the task is done.

Rules:
- Use get_current_state to see indexed elements before you click or type. Indices come from that state.
- Use open_url to navigate, extract_page_text to read a page, screenshot to capture visual proof.
- Think step by step. Do ONE tool call per turn.
- Before any irreversible or sensitive action (submitting forms, sending messages, payments, deletions), call ask_user to confirm.
- When the task is complete, call final_answer with a clear summary of what you did and the result.
- If you are blocked (login wall, CAPTCHA, missing info), call ask_user.
Never invent facts about pages you have not read.`;

// Normalize the various shapes Workers AI models can return for tool calls.
function parseModelResponse(out) {
  // out may be { response, tool_calls } or { choices: [{ message: {...} }] }
  let text = "";
  let toolCalls = [];
  if (out == null) return { text, toolCalls };
  if (typeof out.response === "string") text = out.response;
  const tc = out.tool_calls || (out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.tool_calls);
  if (Array.isArray(tc)) {
    for (const c of tc) {
      const fn = c.function || c;
      let args = fn.arguments ?? fn.parameters ?? {};
      if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
      toolCalls.push({ name: fn.name, args });
    }
  }
  if (!text && out.choices && out.choices[0] && out.choices[0].message) {
    text = out.choices[0].message.content || "";
  }
  return { text, toolCalls };
}

// Build the message list for the model from stored conversation.
function buildMessages(rows) {
  const msgs = [{ role: "system", content: SYSTEM_PROMPT }];
  for (const m of rows) {
    if (m.role === "tool") {
      msgs.push({ role: "tool", name: m.tool_name || "tool", content: m.content || "" });
    } else {
      const msg = { role: m.role, content: m.content || "" };
      msgs.push(msg);
    }
  }
  return msgs;
}

// Process exactly ONE agent step (one model turn + one tool), then self-chain
// to the next tick in a fresh invocation. GLM-4.7-Flash calls take ~30-45s, so
// running many steps in one background task would be killed; one step per
// invocation keeps each request within a safe duration.
export async function runAgent(env, ctx, jobId) {
  const maxSteps = parseInt(env.MAX_STEPS || "20", 10);

  let job = await getJob(env, jobId);
  if (!job) return;
  if (job.status === "done" || job.status === "error") return;

  if ((job.step_count || 0) >= maxSteps) {
    await finishJob(env, jobId, `Reached the step limit (${maxSteps}) before completing. Stopping to protect resources.`);
    return;
  }

  if (job.status !== "running") {
    await updateJob(env, jobId, { status: "running" });
    await emit(env, jobId, "status", { status: "running" });
  }

  const rows = await getMessages(env, jobId);
  const messages = buildMessages(rows);

  let out;
  try {
    out = await env.AI.run(env.MODEL || "@cf/zai-org/glm-4.7-flash", {
      messages,
      tools: TOOL_DEFS,
      max_tokens: 1024,
    });
  } catch (e) {
    await failJob(env, jobId, `Model call failed: ${e.message}`);
    return;
  }

  const { text, toolCalls } = parseModelResponse(out);
  if (text) await emit(env, jobId, "thought", { text });

  if (!toolCalls.length) {
    // No tool call -> treat the text as the final answer.
    await addMessage(env, jobId, { role: "assistant", content: text || "(no response)" });
    await finishJob(env, jobId, text || "(no response)");
    return;
  }

  const call = toolCalls[0]; // one action per turn
  await addMessage(env, jobId, { role: "assistant", content: text || "", tool_calls: [call] });
  const step = (job.step_count || 0) + 1;
  await updateJob(env, jobId, { step_count: step });
  await addStep(env, jobId, { idx: step, tool: call.name, args: call.args, status: "started" });
  await emit(env, jobId, "tool_call", { step, tool: call.name, args: call.args });

  // Control-flow tools ---------------------------------------------------
  if (call.name === "final_answer") {
    const summary = (call.args && call.args.summary) || text || "Done.";
    await addMessage(env, jobId, { role: "tool", tool_name: "final_answer", content: "ok" });
    await finishJob(env, jobId, summary);
    return;
  }
  if (call.name === "ask_user") {
    const question = (call.args && call.args.question) || "I need more information to continue.";
    await addMessage(env, jobId, { role: "tool", tool_name: "ask_user", content: "waiting for user" });
    await updateJob(env, jobId, { status: "waiting_user" });
    await emit(env, jobId, "ask_user", { question });
    return; // resumes when the user posts to /api/jobs/:id/chat
  }

  // Browser tools -> Render runner --------------------------------------
  if (isBrowserTool(call.name)) {
    const result = await runBrowserTool(env, jobId, call.name, call.args);
    await addToolResult(env, jobId, {
      step_idx: step, tool: call.name, ok: result.ok, output: result.output, error: result.error,
    });
    await emit(env, jobId, "tool_result", {
      step, tool: call.name, ok: result.ok,
      error: result.error, has_screenshot: !!result.screenshot,
      preview: typeof result.output === "string" ? result.output.slice(0, 400) : result.output,
    });
    const obs = result.ok
      ? (result.screenshot ? `[screenshot captured]\n` : "") + summarize(result.output)
      : `ERROR: ${result.error || "tool failed"}`;
    await addMessage(env, jobId, { role: "tool", tool_name: call.name, content: obs });
  } else {
    // Unknown tool (should not happen)
    await addMessage(env, jobId, { role: "tool", tool_name: call.name, content: `ERROR: unknown tool ${call.name}` });
  }

  // Chain to the next step in a fresh invocation.
  await scheduleTick(env, jobId);
}

function summarize(output) {
  if (output == null) return "(no output)";
  const s = typeof output === "string" ? output : JSON.stringify(output);
  return s.length > 6000 ? s.slice(0, 6000) + "\n…[truncated]" : s;
}

async function finishJob(env, jobId, result) {
  await updateJob(env, jobId, { status: "done", result });
  await emit(env, jobId, "final", { result });
}

async function failJob(env, jobId, error) {
  await updateJob(env, jobId, { status: "error", error });
  await emit(env, jobId, "error", { error });
}

// Chain to the next step in a fresh invocation. The /internal/tick endpoint
// returns 200 immediately (scheduling its own waitUntil), so this fetch resolves
// fast and each invocation only spans a single ~40s model call.
async function scheduleTick(env, jobId) {
  if (!env.SELF_URL) return; // without a self URL, the dashboard can re-trigger via /chat
  try {
    await fetch(env.SELF_URL.replace(/\/+$/, "") + `/internal/tick/${jobId}`, {
      method: "POST",
      headers: { "x-webhook-secret": env.WEBHOOK_SECRET || "" },
    });
  } catch { /* non-fatal; next chat or poll will resume */ }
}
