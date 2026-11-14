#!/usr/bin/env bash
# Startet einen lokalen Webserver und öffnet das Spiel unter http://localhost:8000
cd "$(dirname "$0")"
echo "Minecraft-Nachbau läuft auf http://localhost:8000  (Strg+C zum Beenden)"
python3 -m http.server 8000
