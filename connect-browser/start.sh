#!/usr/bin/env bash
set -e

# Affichage virtuel
Xvfb :0 -screen 0 1280x900x24 -ac +extension RANDR &
export DISPLAY=:0
sleep 1

# Auth VNC : mot de passe si VNC_PASSWORD est défini, sinon ouvert (réseau local).
if [ -n "${VNC_PASSWORD:-}" ]; then
  x11vnc -display :0 -passwd "$VNC_PASSWORD" -forever -shared -rfbport 5900 -bg
else
  x11vnc -display :0 -nopw -forever -shared -rfbport 5900 -bg
fi

# Pont websocket noVNC -> VNC, sert l'UI noVNC sur 6080
websockify --web=/usr/share/novnc 6080 localhost:5900 &

# Chromium (≥ v111) bind TOUJOURS le CDP sur 127.0.0.1 et ignore
# --remote-debugging-address ; il refuse aussi les requêtes DevTools dont le Host
# n'est ni localhost ni une IP. On expose donc le CDP loopback sur l'IP du conteneur
# via socat : l'API s'y connecte par IP (Host = IP, accepté), et l'URL websocket
# renvoyée par Chromium pointe sur cette IP (donc joignable).
CONTAINER_IP=$(hostname -i | awk '{print $1}')
socat TCP-LISTEN:9222,bind="$CONTAINER_IP",fork,reuseaddr TCP:127.0.0.1:9222 &

# Chromium headful, CDP en loopback (exposé via le socat ci-dessus)
exec chromium \
  --no-sandbox \
  --disable-dev-shm-usage \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --start-maximized \
  --window-size=1280,900 \
  "https://www.vinted.fr"
