#!/usr/bin/env bash
set -e

# Required one-time handshake: the CLI blocks ALL commands (including auth set)
# until the entry Skill is fetched (error_code: skill_compat_required otherwise).
echo "[entrypoint] running browser-act get-skills handshake"
browser-act get-skills main || echo "[entrypoint] get-skills main failed (will surface as per-call errors in logs)"

if [ -n "$BROWSERACT_API_KEY" ]; then
  echo "[entrypoint] configuring browser-act auth"
  browser-act auth set "$BROWSERACT_API_KEY" || echo "[entrypoint] auth set failed (continuing; chrome-direct works without a key)"
fi

echo "[entrypoint] starting supervisord"
exec /usr/bin/supervisord -c /app/supervisord.conf
