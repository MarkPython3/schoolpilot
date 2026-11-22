#!/usr/bin/env bash
# Demo day: start the server and a public Cloudflare tunnel, and keep the laptop awake.
# Run:  ./demo.sh        Stop: Ctrl+C (stops the server and the tunnel too).
cd "$(dirname "$0")" || exit 1
pkill -f "python3 server.py" 2>/dev/null
pkill -f "cloudflared tunnel --url" 2>/dev/null
sleep 0.5

# demo mode: the QR code (/?qr) logs phones in as this student (Ana Popa, 10F); change the id to pick another
export DEMO_STUDENT_ID="${DEMO_STUDENT_ID:-52}"
rm -f /tmp/schoolpilot-public-url
python3 server.py > /tmp/schoolpilot-server.log 2>&1 &
SERVER=$!
LOG=/tmp/schoolpilot-tunnel.log
# http2 instead of the default QUIC: conference Wi-Fi often blocks QUIC (UDP)
cloudflared tunnel --url http://localhost:8000 --no-autoupdate --protocol http2 > "$LOG" 2>&1 &
TUNNEL=$!
trap 'kill $SERVER $TUNNEL 2>/dev/null; echo; echo "Stopped."' EXIT

echo "Local:  http://localhost:8000"
for _ in $(seq 1 40); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1)
  [ -n "$URL" ] && break
  sleep 1
done
echo "Public: ${URL:-the tunnel did not start, see $LOG}"
[ -n "$URL" ] && echo "$URL" > /tmp/schoolpilot-public-url   # the QR page reads it
echo "QR:     http://localhost:8000/?qr   (show it on the stand screen)"
[ -n "$URL" ] && echo "        (a new address can take up to a minute before it opens)"
echo "Keeping the laptop awake while this runs. Press Ctrl+C to stop."
systemd-inhibit --what=idle:sleep --why="SchoolPilot demo" sleep infinity
