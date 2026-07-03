// D1 helpers. All timestamps are epoch ms.
const now = () => Date.now();

export async function createJob(env, { id, title, task }) {
  const t = now();
  await env.DB.prepare(
    `INSERT INTO jobs (id, title, task, status, step_count, created_at, updated_at)
     VALUES (?, ?, ?, 'queued', 0, ?, ?)`
  ).bind(id, title || null, task, t, t).run();
  return getJob(env, id);
}

export async function getJob(env, id) {
  return env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(id).first();
}

export async function updateJob(env, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  const vals = keys.map((k) => fields[k]);
  await env.DB.prepare(`UPDATE jobs SET ${set}, updated_at = ? WHERE id = ?`)
    .bind(...vals, now(), id).run();
}

export async function addMessage(env, jobId, { role, content, tool_calls, tool_name }) {
  await env.DB.prepare(
    `INSERT INTO messages (job_id, role, content, tool_calls, tool_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(jobId, role, content ?? null,
     tool_calls ? JSON.stringify(tool_calls) : null,
     tool_name ?? null, now()).run();
}

export async function getMessages(env, jobId) {
  const { results } = await env.DB.prepare(
    `SELECT role, content, tool_calls, tool_name FROM messages WHERE job_id = ? ORDER BY id ASC`
  ).bind(jobId).all();
  return results || [];
}

export async function addStep(env, jobId, { idx, tool, args, status }) {
  await env.DB.prepare(
    `INSERT INTO steps (job_id, idx, tool, args, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(jobId, idx, tool ?? null, args ? JSON.stringify(args) : null, status ?? null, now()).run();
}

export async function addToolResult(env, jobId, { step_idx, tool, ok, output, error }) {
  await env.DB.prepare(
    `INSERT INTO tool_results (job_id, step_idx, tool, ok, output, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(jobId, step_idx ?? null, tool ?? null, ok ? 1 : 0,
     output != null ? (typeof output === "string" ? output : JSON.stringify(output)) : null,
     error ?? null, now()).run();
}

export async function emit(env, jobId, type, data) {
  await env.DB.prepare(
    `INSERT INTO events (job_id, type, data, created_at) VALUES (?, ?, ?, ?)`
  ).bind(jobId, type, data != null ? JSON.stringify(data) : null, now()).run();
}

export async function getEventsAfter(env, jobId, afterId) {
  const { results } = await env.DB.prepare(
    `SELECT id, type, data, created_at FROM events WHERE job_id = ? AND id > ? ORDER BY id ASC LIMIT 200`
  ).bind(jobId, afterId || 0).all();
  return results || [];
}

export async function getJobBundle(env, id) {
  const job = await getJob(env, id);
  if (!job) return null;
  const [msgs, steps, tools] = await Promise.all([
    env.DB.prepare(`SELECT role, content, tool_name, created_at FROM messages WHERE job_id = ? ORDER BY id ASC`).bind(id).all(),
    env.DB.prepare(`SELECT idx, tool, args, status, created_at FROM steps WHERE job_id = ? ORDER BY idx ASC`).bind(id).all(),
    env.DB.prepare(`SELECT step_idx, tool, ok, output, error, created_at FROM tool_results WHERE job_id = ? ORDER BY id ASC`).bind(id).all(),
  ]);
  return { job, messages: msgs.results || [], steps: steps.results || [], tool_results: tools.results || [] };
}
