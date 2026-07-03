# AI Employee — Cloudflare Worker backend

Cloud-only AI employee. This Worker is the agent brain: webhook intake, agent loop
(GLM-4.7-Flash via Workers AI), chat, SSE event stream, and D1 storage. Browser
actions are executed on a Render Docker runner via `/run-tool`.

## Endpoints
| Method | Path | Purpose |
| --- | --- | --- |
| GET  | `/health` | Liveness + config check |
| POST | `/api/webhook/task` | Create a job and start the agent (`x-webhook-secret`) |
| POST | `/api/jobs/:id/chat` | Send a chat message; resumes a job waiting on the user |
| GET  | `/api/jobs/:id/events` | SSE stream of job events (reconnect with `?after=<id>`) |
| GET  | `/api/jobs/:id` | Full job bundle (job, messages, steps, tool_results) |

## Agent tools (exact set)
`search_web`, `open_url`, `extract_page_text`, `click`, `type_text`, `screenshot`,
`get_current_state`, `ask_user`, `final_answer`.

## Storage (D1)
Tables: `jobs`, `messages`, `steps`, `tool_results`, `events`. See `schema.sql`.

## Deploy (Step 3)
```bash
npm install
wrangler d1 create ai_employee          # copy the database_id into wrangler.toml
npm run db:init                          # apply schema.sql to remote D1
wrangler secret put RUNNER_INTERNAL_TOKEN
wrangler secret put WEBHOOK_SECRET
wrangler secret put RENDER_RUNNER_URL    # or set as a var once Render is live
wrangler deploy
```
Workers AI (`[ai]` binding) and D1 (`[[d1_databases]]`) are free-tier. No billing.
