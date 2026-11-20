#!/usr/bin/env bash
# Starts the low-latency relay server + a Cloudflare quick tunnel, then publishes
# the tunnel URL to server.json on GitHub so the GitHub Pages site finds it.
# The game still works without this (it falls back to the public MQTT relay).
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8787}"
mkdir -p .tunnel

if [ ! -d server/node_modules ]; then (cd server && npm install --silent); fi

pkill -f "[n]ode server.js" 2>/dev/null || true
pkill -f "[c]loudflared tunnel --no-autoupdate --url http://localhost:$PORT" 2>/dev/null || true
sleep 1

(cd server && PORT="$PORT" setsid nohup node server.js > ../.tunnel/server.log 2>&1 < /dev/null &)
sleep 1
setsid nohup cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" > .tunnel/cloudflared.log 2>&1 < /dev/null &

URL=""
for i in $(seq 1 60); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' .tunnel/cloudflared.log | head -1 || true)
  [ -n "$URL" ] && break
  sleep 1
done
if [ -z "$URL" ]; then echo "Tunnel failed to start; see .tunnel/cloudflared.log"; exit 1; fi

# wait until the tunnel actually serves traffic
for i in $(seq 1 30); do
  if curl -fsS -m 5 "$URL/health" >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "{\"url\":\"$URL\",\"updated\":\"$(date -u +%FT%TZ)\"}" > server.json
git add server.json
git commit -q -m "Update relay server URL" || true
git push -q origin HEAD 2>/dev/null || echo "(push failed, server.json not published)"
echo "Relay server live at: $URL"
