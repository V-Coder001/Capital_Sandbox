#!/bin/bash
# ============================================================
# Capital Sandbox — ein Befehl, alles läuft:
#   ./start.sh          startet Server + öffentlichen Einladungslink
#   ./start.sh --lan    nur lokales Netzwerk (ohne Tunnel)
#   BOT=0 ./start.sh    ohne KI-Mitspieler
#   PORT=4000 ./start.sh   Port direkt vorgeben (überspringt die Abfrage)
# Fragt beim Start nach dem Port (Enter = 3000). Danach: Link teilen — fertig.
# Beenden mit Ctrl+C.
# ============================================================
set -e
cd "$(dirname "$0")"
LOG=".server.log"

# ---- 0. Port abfragen (Enter = 3000; PORT=... vorgeben überspringt die Frage) ----
if [ -z "${PORT:-}" ]; then
  PORT=3000
  if [ -t 0 ]; then
    read -p "Auf welchem Port soll das Spiel laufen? [3000]: " PORT_INPUT
    [ -n "$PORT_INPUT" ] && PORT="$PORT_INPUT"
  fi
fi
export PORT

# ---- 1. Node finden (System → mitgelieferte Binary → Download) ----
NODE=""
for c in node /opt/homebrew/bin/node /usr/local/bin/node ./.node/bin/node; do
  if command -v "$c" >/dev/null 2>&1; then NODE="$(command -v "$c")"; break; fi
done
if [ -z "$NODE" ]; then
  echo "→ Node.js nicht gefunden, lade portable Version (~45 MB) …"
  ARCH=$(uname -m); [ "$ARCH" = "x86_64" ] && ARCH="x64" || ARCH="arm64"
  mkdir -p .node
  curl -fsSL "https://nodejs.org/dist/v22.14.0/node-v22.14.0-darwin-$ARCH.tar.gz" | tar xz -C .node --strip-components=1
  NODE="./.node/bin/node"
fi

# ---- 2. Abhängigkeiten installieren, falls sie fehlen ----
if [ ! -d node_modules ]; then
  echo "→ Installiere Abhängigkeiten …"
  if command -v npm >/dev/null 2>&1; then npm install --omit=dev
  elif [ -x ./.node/bin/npm ]; then ./.node/bin/npm install --omit=dev
  else echo "✗ npm fehlt und node_modules ist leer — bitte einmal Node.js installieren (brew install node)"; exit 1; fi
fi

# ---- 3. Alten Server auf dem gewählten Port sauber beenden ----
if lsof -ti ":$PORT" >/dev/null 2>&1; then
  kill $(lsof -ti ":$PORT") 2>/dev/null || true
  sleep 1
fi

# ---- 4. Starten (öffentlicher Link standardmäßig an) ----
ARGS="--share"
[ "$1" = "--lan" ] && ARGS=""
"$NODE" server.js $ARGS > "$LOG" 2>&1 &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null; exit 0" INT TERM EXIT

# ---- 5. Warten bis erreichbar ----
for i in $(seq 1 30); do
  curl -s -o /dev/null "http://localhost:$PORT/" && break
  sleep 0.5
done

# ---- 6. Auf den öffentlichen Link warten (max. 15 s), dann Übersicht ----
PUBLIC=""
if [ "$ARGS" = "--share" ]; then
  echo "→ Erzeuge öffentlichen Einladungslink …"
  for i in $(seq 1 30); do
    PUBLIC=$(grep -o 'https://[a-z0-9-]*\.loca\.lt' "$LOG" | head -1 || true)
    [ -n "$PUBLIC" ] && break
    sleep 0.5
  done
fi
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")

echo ""
echo "════════════════════════════════════════════════════"
echo "  🏙️  Capital Sandbox läuft!"
echo ""
if [ -n "$PUBLIC" ]; then
echo "  👉 DIESEN LINK TEILEN (funktioniert überall):"
echo "     $PUBLIC"
echo ""
[ -n "$IP" ] && echo "  Schneller im gleichen WLAN:  http://$IP:$PORT"
else
[ -n "$IP" ] && echo "  👉 DIESEN LINK TEILEN (gleiches WLAN):  http://$IP:$PORT"
[ -z "$IP" ] && echo "  (Keine Netzwerk-IP gefunden — nur lokal spielbar)"
[ "$ARGS" = "--share" ] && echo "  (Öffentlicher Tunnel kam nicht zustande — WLAN-Link nutzen)"
fi
echo ""
echo "  Du selbst:  http://localhost:$PORT  (öffnet sich gleich)"
echo "  Beenden:    Ctrl+C"
echo "════════════════════════════════════════════════════"
echo ""
open "http://localhost:$PORT" 2>/dev/null || true
wait $SERVER_PID
