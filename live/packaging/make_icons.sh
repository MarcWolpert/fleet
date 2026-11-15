#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Render live/packaging/icon/fleet.svg into the PNG sizes Linux uses and the macOS Fleet.icns.
# Needs macOS (sips, iconutil) and Google Chrome (headless, for an exact SVG render with transparency).
# Usage: live/packaging/make_icons.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ICON="$HERE/icon"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "make_icons.sh needs Google Chrome to render the SVG" >&2; exit 1; }
WORK=$(mktemp -d "${TMPDIR:-/tmp}/fleet-icons.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

printf '<!doctype html><html><head><style>html,body{margin:0;background:transparent}img{display:block;width:1024px;height:1024px}</style></head><body><img src="file://%s"></body></html>' \
  "$ICON/fleet.svg" > "$WORK/render.html"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files --user-data-dir="$WORK/profile" \
  --default-background-color=00000000 --window-size=1024,1024 --screenshot="$WORK/fleet-1024.png" "file://$WORK/render.html" 2>/dev/null
[ -s "$WORK/fleet-1024.png" ] || { echo "render failed" >&2; exit 1; }

mkdir -p "$ICON/png"
for s in 16 32 48 64 128 256 512; do
  sips -z $s $s "$WORK/fleet-1024.png" --out "$ICON/png/fleet-$s.png" >/dev/null
done
cp "$WORK/fleet-1024.png" "$ICON/png/fleet-1024.png"

SET="$WORK/Fleet.iconset"; mkdir -p "$SET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$WORK/fleet-1024.png" --out "$SET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2)); sips -z $d $d "$WORK/fleet-1024.png" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o "$ICON/Fleet.icns"
cp "$ICON/fleet.svg" "$HERE/../web/icon.svg"
echo "icons: $ICON/png/fleet-{16..1024}.png and $ICON/Fleet.icns"
