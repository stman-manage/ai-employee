#!/usr/bin/env bash
set -e

# Required one-time handshake: the CLI blocks ALL commands (including auth set)
# until the entry Skill is fetched (error_code: skill_compat_required otherwise).
echo "[entrypoint] running browser-act get-skills handshake"
GETSKILLS_OUT=$(browser-act get-skills main 2>&1) && GS_CODE=0 || GS_CODE=$?
echo "[entrypoint] get-skills main exit=$GS_CODE output=$GETSKILLS_OUT"
echo "[entrypoint] running browser-act get-skills core (fallback)"
GETSKILLS_CORE_OUT=$(browser-act get-skills core 2>&1) && GSC_CODE=0 || GSC_CODE=$?
echo "[entrypoint] get-skills core exit=$GSC_CODE output=$GETSKILLS_CORE_OUT"

if [ -n "$BROWSERACT_API_KEY" ]; then
  echo "[entrypoint] configuring browser-act auth"
  browser-act auth set "$BROWSERACT_API_KEY" || echo "[entrypoint] auth set failed (continuing; chrome-direct works without a key)"
fi

echo "[entrypoint] starting supervisord"
exec /usr/bin/supervisord -c /app/supervisord.conf
