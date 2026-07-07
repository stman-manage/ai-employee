#!/usr/bin/env bash
set -e
if [ -n "$BROWSERACT_API_KEY" ]; then
  echo "[entrypoint] configuring browser-act auth"
  browser-act auth set "$BROWSERACT_API_KEY" || echo "[entrypoint] auth set failed (continuing; chrome-direct works without a key)"
fi
echo "[entrypoint] starting supervisord"
exec /usr/bin/supervisord -c /app/supervisord.conf
