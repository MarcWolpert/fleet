#!/bin/sh
# Fleet, in its Flatpak: the server (the runtime's Python) and its window (on the host)
exec python3 /app/share/fleet/live/fleet_live.py --open "$@"
