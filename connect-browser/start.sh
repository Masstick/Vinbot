#!/usr/bin/env bash
set -e

# Affichage virtuel
Xvfb :0 -screen 0 1280x900x24 -ac +extension RANDR &
export DISPLAY=:0
sleep 1

# Serveur VNC sur l'affichage virtuel (pas de mot de passe : réseau local seulement)
x11vnc -display :0 -nopw -forever -shared -rfbport 5900 -bg

# Pont websocket noVNC -> VNC, sert l'UI noVNC sur 6080
websockify --web=/usr/share/novnc 6080 localhost:5900 &

# Chromium headful avec CDP exposé sur toutes les interfaces du conteneur
exec chromium \
  --no-sandbox \
  --disable-dev-shm-usage \
  --remote-debugging-address=0.0.0.0 \
  --remote-debugging-port=9222 \
  --start-maximized \
  --window-size=1280,900 \
  "https://www.vinted.fr"
