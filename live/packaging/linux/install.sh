#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Install Fleet for this user: the app, a `fleet` command, a menu entry and the icon.
# Usage: ./install.sh            (installs under ~/.local)
#        PREFIX=/opt/fleet ./install.sh
set -eu
SRC=$(cd "$(dirname "$0")" && pwd)
PREFIX=${PREFIX:-$HOME/.local}
APPDIR="$PREFIX/share/fleet"

PY=$(command -v python3 || true)
[ -n "$PY" ] || { echo "Fleet needs Python 3.11 or newer (python3 not found)." >&2; exit 1; }
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' || { echo "Fleet needs Python 3.11 or newer; found $("$PY" -V)." >&2; exit 1; }

mkdir -p "$APPDIR/web" "$PREFIX/bin" "$PREFIX/share/applications"
# everything the package's app/ holds (the server, its collectors and inspectors, the page and its scripts):
# a list of names here went stale once already (themes.js, the inspectors; issue #52)
cp -R "$SRC/app/." "$APPDIR/"
cp "$SRC/COPYING" "$APPDIR/COPYING"

cat > "$PREFIX/bin/fleet" <<EOF
#!/bin/sh
# Fleet: every machine you manage, live. Opens the app window (Chrome/Chromium/Edge app mode, else your browser).
exec "$PY" "$APPDIR/fleet_live.py" --open "\$@"
EOF
chmod +x "$PREFIX/bin/fleet"

for s in 16 32 48 64 128 256 512; do
  mkdir -p "$PREFIX/share/icons/hicolor/${s}x${s}/apps"
  cp "$SRC/icons/fleet-$s.png" "$PREFIX/share/icons/hicolor/${s}x${s}/apps/fleet.png"
done
mkdir -p "$PREFIX/share/icons/hicolor/scalable/apps"
cp "$SRC/icons/fleet.svg" "$PREFIX/share/icons/hicolor/scalable/apps/fleet.svg"

sed "s#@BIN@#$PREFIX/bin/fleet#g" "$SRC/fleet.desktop" > "$PREFIX/share/applications/fleet.desktop"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$PREFIX/share/applications" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t "$PREFIX/share/icons/hicolor" >/dev/null 2>&1 || true

echo "Installed Fleet in $APPDIR."
echo "Open it from your app menu, or run: $PREFIX/bin/fleet"
case ":$PATH:" in *":$PREFIX/bin:"*) ;; *) echo "(add $PREFIX/bin to your PATH to run plain 'fleet')";; esac
