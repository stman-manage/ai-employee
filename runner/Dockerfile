# Render Free Docker service: BrowserAct CLI + visible Chromium + noVNC.
FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    PATH="/root/.local/bin:/root/.local/share/uv/tools/browser-act-cli/bin:${PATH}"

# System deps: Chromium, virtual display, VNC bridge, noVNC web client,
# window manager, python+curl (for uv / browser-act-cli), supervisor, tini.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      xvfb x11vnc fluxbox \
      novnc websockify \
      python3 python3-venv curl ca-certificates \
      supervisor tini fonts-liberation \
    && curl -LsSf https://astral.sh/uv/install.sh | sh \
    && /root/.local/bin/uv tool install browser-act-cli --python 3.12 \
    && ln -sf /usr/share/novnc/vnc.html /usr/share/novnc/index.html \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Point the CLI at the system Chromium.
ENV CHROME_BIN=/usr/bin/chromium \
    BROWSERACT_CHROME_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .

# Optional at build time; set at runtime on Render:
#   RUNNER_INTERNAL_TOKEN, BROWSERACT_API_KEY, VNC_USER, VNC_PASS
# On boot, entrypoint sets the BrowserAct key (if provided) then starts supervisord.
EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini","--","/app/entrypoint.sh"]
