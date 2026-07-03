// The exact allowed tool set, exposed to GLM-4.7-Flash as function-calling schemas.
// Browser tools are executed remotely on the Render runner via /run-tool.
// ask_user and final_answer are control-flow tools handled by the agent loop.

export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the web for information. Returns result titles, URLs, and snippets.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Search query" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_url",
      description: "Open a URL in the browser and load the page.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "Absolute URL to open" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "extract_page_text",
      description: "Extract the readable text/markdown of the current page.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "click",
      description: "Click an element by its numeric index from the latest get_current_state.",
      parameters: {
        type: "object",
        properties: { index: { type: "integer", description: "Element index to click" } },
        required: ["index"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "type_text",
      description: "Type text into an input element by its numeric index.",
      parameters: {
        type: "object",
        properties: {
          index: { type: "integer", description: "Input element index" },
          text: { type: "string", description: "Text to type" },
        },
        required: ["index", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "screenshot",
      description: "Capture a screenshot of the current page. Returns an image reference.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_current_state",
      description: "Get the current page's indexed, model-friendly state (elements you can click/type into).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_user",
      description: "Pause and ask the user a question. Use before irreversible actions or when blocked. The job waits for the user's chat reply.",
      parameters: {
        type: "object",
        properties: { question: { type: "string", description: "Question to ask the user" } },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "final_answer",
      description: "Finish the job and return the final result to the user.",
      parameters: {
        type: "object",
        properties: { summary: { type: "string", description: "Final result / summary for the user" } },
        required: ["summary"],
      },
    },
  },
];

// Tools that require the remote browser runner on Render.
const BROWSER_TOOLS = new Set([
  "search_web", "open_url", "extract_page_text", "click", "type_text", "screenshot", "get_current_state",
]);

export function isBrowserTool(name) {
  return BROWSER_TOOLS.has(name);
}

// Proxy a browser tool to the Render runner. Returns { ok, output, error, screenshot? }.
export async function runBrowserTool(env, jobId, tool, args) {
  if (!env.RENDER_RUNNER_URL || !env.RUNNER_INTERNAL_TOKEN) {
    return { ok: false, error: "Runner not configured (RENDER_RUNNER_URL / RUNNER_INTERNAL_TOKEN missing)." };
  }
  const url = env.RENDER_RUNNER_URL.replace(/\/+$/, "") + "/run-tool";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-runner-token": env.RUNNER_INTERNAL_TOKEN,
      },
      // The runner keys the browser session by jobId so steps share one browser.
      body: JSON.stringify({ jobId, session: jobId, tool, args: args || {} }),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { ok: res.ok, output: text }; }
    if (!res.ok && data.ok === undefined) data.ok = false;
    return data;
  } catch (e) {
    return { ok: false, error: `Runner request failed: ${e.message}` };
  }
}
