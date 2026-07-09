// Maps the agent's browser tools to BrowserAct CLI commands.
// The visible browser is a local `chrome-direct` browser rendered under Xvfb,
// streamed via noVNC. chrome-direct works without an API key; the key (if set)
// only unlocks hosted stealth features.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DISPLAY = process.env.DISPLAY || ":99";
const CLI = process.env.BROWSER_ACT_BIN || "browser-act";

// One shared local browser for the container (free tier runs one job at a time).
let cachedBrowserId = null;
const openedSessions = new Set();

function run(args, { session } = {}) {
  const full = [];
  if (session) full.push("--session", session);
  full.push("--format", "json", ...args);
  return new Promise((resolve) => {
    console.log(`[cli] spawning: ${CLI} ${full.join(" ")}`);
    const child = spawn(CLI, full, { env: { ...process.env, DISPLAY } });
    let out = "", err = "";
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 120000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      console.log(`[cli] exit=${code} out=${out.slice(0, 500)} err=${err.slice(0, 500)}`);
      resolve({ code, out: out.trim(), err: err.trim() });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      console.log(`[cli] spawn error: ${e.message}`);
      resolve({ code: -1, out: "", err: e.message });
    });
  });
}

function parseMaybeJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return s; }
}

async function ensureBrowser() {
  if (cachedBrowserId) return cachedBrowserId;
  // Try to reuse an existing browser first.
  const list = await run(["browser", "list"]);
  const parsed = parseMaybeJson(list.out);
  const arr = Array.isArray(parsed) ? parsed : (parsed && parsed.browsers) || [];
  const existing = arr.find((b) => (b.type || b.browser_type) === "chrome-direct") || arr[0];
  if (existing && (existing.id || existing.browser_id)) {
    cachedBrowserId = existing.id || existing.browser_id;
    return cachedBrowserId;
  }
  // Otherwise create one.
  const created = await run([
    "browser", "create", "--type", "chrome-direct",
    "--name", "ai-employee-runner", "--desc", "AI employee visible runner browser",
  ]);
  const cj = parseMaybeJson(created.out);
  cachedBrowserId = (cj && (cj.id || cj.browser_id)) || "chrome-direct";
  return cachedBrowserId;
}

async function ensureOpen(session, url) {
  const id = await ensureBrowser();
  const args = ["browser", "open", id];
  if (url) args.push(url);
  args.push("--headed");
  const r = await run(args, { session });
  openedSessions.add(session);
  return r;
}

// tool -> {ok, output, error, screenshot?}
export async function runTool(tool, args = {}, session = "default") {
  try {
    switch (tool) {
      case "open_url": {
        if (!args.url) return { ok: false, error: "missing url" };
        const r = await ensureOpen(session, args.url);
        if (r.code !== 0) return { ok: false, error: r.err || "open failed" };
        const st = await run(["state"], { session });
        return { ok: true, output: st.out || r.out };
      }
      case "get_current_state": {
        if (!openedSessions.has(session)) await ensureOpen(session, "about:blank");
        const r = await run(["state"], { session });
        return r.code === 0 ? { ok: true, output: r.out } : { ok: false, error: r.err };
      }
      case "extract_page_text": {
        const r = await run(["get", "markdown"], { session });
        return r.code === 0 ? { ok: true, output: r.out } : { ok: false, error: r.err };
      }
      case "click": {
        if (args.index == null) return { ok: false, error: "missing index" };
        const r = await run(["click", String(args.index)], { session });
        if (r.code !== 0) return { ok: false, error: r.err };
        const st = await run(["state"], { session });
        return { ok: true, output: st.out || r.out };
      }
      case "type_text": {
        if (args.index == null) return { ok: false, error: "missing index" };
        const r = await run(["input", String(args.index), String(args.text ?? "")], { session });
        if (r.code !== 0) return { ok: false, error: r.err };
        const st = await run(["state"], { session });
        return { ok: true, output: st.out || r.out };
      }
      case "screenshot": {
        const p = path.join(os.tmpdir(), `shot-${session}-${Date.now()}.png`);
        const r = await run(["screenshot", p, "--full"], { session });
        if (r.code !== 0) return { ok: false, error: r.err };
        try {
          const buf = await readFile(p);
          return { ok: true, output: "screenshot captured", screenshot: `data:image/png;base64,${buf.toString("base64")}` };
        } catch (e) {
          return { ok: false, error: `screenshot read failed: ${e.message}` };
        }
      }
      case "search_web": {
        if (!args.query) return { ok: false, error: "missing query" };
        const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`;
        const r = await ensureOpen(session, url);
        if (r.code !== 0) return { ok: false, error: r.err || "search open failed" };
        const md = await run(["get", "markdown"], { session });
        return { ok: true, output: md.out || r.out };
      }
      default:
        return { ok: false, error: `unknown tool: ${tool}` };
    }
  } catch (e) {
    console.log(`[runTool] exception for tool=${tool}: ${e.stack || e.message}`);
    return { ok: false, error: e.message || String(e) };
  }
}

export async function closeSession(session) {
  await run(["session", "close", session]);
  openedSessions.delete(session);
}
