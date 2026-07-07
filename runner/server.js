// Single-port Node server for Render Free.
//   GET  /health         -> liveness
//   POST /run-tool       -> execute a browser tool (x-runner-token auth)
//   GET  /vnc  + /websockify + static -> noVNC viewer (HTTP Basic auth),
//                                         proxied to websockify on 127.0.0.1:6080
import http from "node:http";
import httpProxy from "http-proxy";
import { runTool, closeSession } from "./browseract.js";

const PORT = parseInt(process.env.PORT || "10000", 10);
const RUNNER_TOKEN = process.env.RUNNER_INTERNAL_TOKEN || "";
const VNC_USER = process.env.VNC_USER || "viewer";
const VNC_PASS = process.env.VNC_PASS || "";
const NOVNC_TARGET = "http://127.0.0.1:6080";

const proxy = httpProxy.createProxyServer({ target: NOVNC_TARGET, ws: true });
proxy.on("error", (err, req, res) => {
  if (res && res.writeHead && !res.headersSent) {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end("noVNC backend not ready: " + err.message);
  }
});

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

function checkBasicAuth(req) {
  if (!VNC_PASS) return true; // no password configured -> allow (set VNC_PASS to lock)
  const h = req.headers["authorization"] || "";
  if (!h.startsWith("Basic ")) return false;
  const [u, p] = Buffer.from(h.slice(6), "base64").toString("utf8").split(":");
  return u === VNC_USER && p === VNC_PASS;
}

function requireBasicAuth(res) {
  res.writeHead(401, { "WWW-Authenticate": 'Basic realm="AI Employee Viewer"' });
  res.end("Authentication required");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  // Health --------------------------------------------------------------
  if (p === "/health" && req.method === "GET") {
    return json(res, 200, { ok: true, service: "ai-employee-runner", time: Date.now() });
  }

  // Run tool ------------------------------------------------------------
  if (p === "/run-tool" && req.method === "POST") {
    const token = req.headers["x-runner-token"] || "";
    if (RUNNER_TOKEN && token !== RUNNER_TOKEN) return json(res, 401, { ok: false, error: "unauthorized" });
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch { return json(res, 400, { ok: false, error: "bad json" }); }
    const { tool, args, session } = payload || {};
    if (!tool) return json(res, 400, { ok: false, error: "missing tool" });
    const result = await runTool(tool, args || {}, session || "default");
    return json(res, 200, result);
  }

  // Close a session (housekeeping) -------------------------------------
  if (p === "/close-session" && req.method === "POST") {
    const token = req.headers["x-runner-token"] || "";
    if (RUNNER_TOKEN && token !== RUNNER_TOKEN) return json(res, 401, { ok: false, error: "unauthorized" });
    const { session } = JSON.parse((await readBody(req)) || "{}");
    await closeSession(session || "default");
    return json(res, 200, { ok: true });
  }

  // noVNC viewer (Basic auth) -> proxy to websockify --------------------
  if (p === "/vnc" || p === "/vnc/" || p.startsWith("/vnc/") || p.startsWith("/websockify") || p.startsWith("/core/") || p.startsWith("/app/") || p.startsWith("/vendor/")) {
    if (!checkBasicAuth(req)) return requireBasicAuth(res);
    // Rewrite /vnc -> noVNC's vnc.html entrypoint
    if (p === "/vnc" || p === "/vnc/") {
      req.url = "/vnc.html?autoconnect=1&resize=scale&path=websockify";
    } else if (p.startsWith("/vnc/")) {
      req.url = req.url.replace(/^\/vnc/, "");
    }
    return proxy.web(req, res);
  }

  json(res, 404, { ok: false, error: "not found", path: p });
});

// Proxy WebSocket upgrades (noVNC) with Basic auth.
server.on("upgrade", (req, socket, head) => {
  if (!checkBasicAuth(req)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"AI Employee Viewer\"\r\n\r\n");
    socket.destroy();
    return;
  }
  proxy.ws(req, socket, head);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[runner] listening on 0.0.0.0:${PORT} (noVNC -> ${NOVNC_TARGET})`);
});
