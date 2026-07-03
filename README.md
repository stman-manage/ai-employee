# AI Employee (cloud-only)

A fully cloud-hosted AI employee browser agent.

- **worker/** — Cloudflare Worker backend (agent brain, webhook, chat, SSE, D1 storage)
- **runner/** — Render Docker service (BrowserAct CLI + visible Chromium + noVNC) [Step 4]

Stack: Cloudflare Free (Workers AI GLM-4.7-Flash + D1) · BrowserAct (paid) · Render Free · GitHub.
No billing enabled on any free platform.
