# AI Employee — Render Docker runner

Executes browser tools for the Cloudflare Worker brain, and streams a visible
Chromium via noVNC. Single public port (Render Free).

## Endpoints
- `GET  /health` — liveness
- `POST /run-tool` — run a browser tool. Header `x-runner-token: $RUNNER_INTERNAL_TOKEN`.
  Body: `{ "tool": "open_url", "args": { "url": "https://..." }, "session": "job_x" }`
- `GET  /vnc` — noVNC viewer (HTTP Basic auth: `VNC_USER` / `VNC_PASS`)

## Tools -> BrowserAct CLI
open_url→`browser open <id> <url> --headed`, get_current_state→`state`,
extract_page_text→`get markdown`, click→`click <i>`, type_text→`input <i> <text>`,
screenshot→`screenshot <path> --full` (returned as base64), search_web→DuckDuckGo + `get markdown`.

## Processes (supervisord)
Xvfb :99 · fluxbox · x11vnc (localhost) · websockify/noVNC (6080) · node server ($PORT).

## Deploy on Render (Free)
New > Web Service > from this repo, root dir `runner`, runtime Docker.
Set env: `RUNNER_INTERNAL_TOKEN` (match the Worker secret), `BROWSERACT_API_KEY`
(your paid key), `VNC_PASS` (viewer password). Free tier: 512 MB RAM, spins down
after 15 min idle.
