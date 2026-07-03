import { json, cors, uid, safeEqual } from "./util.js";
import {
  createJob, getJob, getJobBundle, addMessage, updateJob, emit, getEventsAfter,
} from "./db.js";
import { runAgent } from "./agent.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") return new Response(null, { headers: cors() });

    try {
      // GET /health
      if (path === "/health" && method === "GET") {
        return json({
          ok: true,
          service: "ai-employee-worker",
          model: env.MODEL || "@cf/zai-org/glm-4.7-flash",
          runner_configured: !!(env.RENDER_RUNNER_URL && env.RUNNER_INTERNAL_TOKEN),
          time: Date.now(),
        });
      }

      // POST /api/webhook/task  -> create job + start agent
      if (path === "/api/webhook/task" && method === "POST") {
        if (env.WEBHOOK_SECRET) {
          const given = request.headers.get("x-webhook-secret") || url.searchParams.get("secret");
          if (!safeEqual(given || "", env.WEBHOOK_SECRET)) return json({ error: "unauthorized" }, 401);
        }
        const body = await safeJson(request);
        const task = body.task || body.prompt || body.message;
        if (!task) return json({ error: "missing 'task'" }, 400);
        const id = uid("job");
        await createJob(env, { id, title: body.title || null, task });
        await addMessage(env, id, { role: "user", content: task });
        await emit(env, id, "status", { status: "queued" });
        ctx.waitUntil(runAgent(env, ctx, id));
        return json({ ok: true, job_id: id, status: "queued" }, 201);
      }

      // Job-scoped routes: /api/jobs/:id ...
      const jobMatch = path.match(/^\/api\/jobs\/([^/]+)(\/[^/]+)?$/);
      if (jobMatch) {
        const jobId = jobMatch[1];
        const sub = jobMatch[2];

        // GET /api/jobs/:id
        if (!sub && method === "GET") {
          const bundle = await getJobBundle(env, jobId);
          if (!bundle) return json({ error: "not found" }, 404);
          return json(bundle);
        }

        // POST /api/jobs/:id/chat  -> add user message; resume if waiting
        if (sub === "/chat" && method === "POST") {
          const job = await getJob(env, jobId);
          if (!job) return json({ error: "not found" }, 404);
          const body = await safeJson(request);
          const msg = body.message || body.content || body.text;
          if (!msg) return json({ error: "missing 'message'" }, 400);
          await addMessage(env, jobId, { role: "user", content: msg });
          await emit(env, jobId, "chat", { role: "user", content: msg });
          // If the agent was waiting for the user, resume it.
          if (job.status === "waiting_user" || job.status === "done" || job.status === "error") {
            ctx.waitUntil(runAgent(env, ctx, jobId));
          }
          return json({ ok: true });
        }

        // GET /api/jobs/:id/events  -> SSE stream (tails the events table)
        if (sub === "/events" && method === "GET") {
          return sseStream(env, jobId, url);
        }
      }

      // POST /internal/tick/:id  -> resume long-running agent (self-call)
      const tickMatch = path.match(/^\/internal\/tick\/([^/]+)$/);
      if (tickMatch && method === "POST") {
        if (env.WEBHOOK_SECRET) {
          const given = request.headers.get("x-webhook-secret") || "";
          if (!safeEqual(given, env.WEBHOOK_SECRET)) return json({ error: "unauthorized" }, 401);
        }
        ctx.waitUntil(runAgent(env, ctx, tickMatch[1]));
        return json({ ok: true });
      }

      // Fallback to static dashboard assets (Step 6), else 404.
      if (env.ASSETS) {
        const res = await env.ASSETS.fetch(request);
        if (res.status !== 404) return res;
      }
      return json({ error: "not found", path }, 404);
    } catch (e) {
      return json({ error: "internal", detail: e.message }, 500);
    }
  },
};

async function safeJson(request) {
  try { return await request.json(); } catch { return {}; }
}

// Server-Sent Events: poll the events table and push new rows. Fully free-tier
// friendly (plain Worker, no Durable Objects). Client reconnects with Last-Event-ID.
function sseStream(env, jobId, url) {
  const encoder = new TextEncoder();
  let lastId = parseInt(url.searchParams.get("after") || "0", 10);
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj, id) => {
        let frame = "";
        if (id != null) frame += `id: ${id}\n`;
        frame += `event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`;
        controller.enqueue(encoder.encode(frame));
      };
      send({ type: "open", jobId }, null);

      const deadline = Date.now() + 55000; // one SSE connection lasts ~55s, then client reconnects
      while (!closed && Date.now() < deadline) {
        const rows = await getEventsAfter(env, jobId, lastId);
        for (const r of rows) {
          lastId = r.id;
          let data = {};
          try { data = r.data ? JSON.parse(r.data) : {}; } catch {}
          send({ type: r.type, id: r.id, at: r.created_at, ...data }, r.id);
        }
        const job = await getJob(env, jobId);
        if (job && (job.status === "done" || job.status === "error")) {
          send({ type: "closed", status: job.status }, null);
          break;
        }
        await sleep(1200);
      }
      controller.close();
    },
    cancel() { closed = true; },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
      ...cors(),
    },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
