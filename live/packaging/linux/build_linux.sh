#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Build live/dist/fleet-<version>-linux.tar.gz: the app, icons, a menu entry and install/uninstall scripts.
# Runs anywhere with a POSIX shell and tar. Usage: live/packaging/linux/build_linux.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
LIVE=$(cd "$HERE/../.." && pwd)
VERSION=$(sed -n 's/^VERSION = "\(.*\)"/\1/p' "$LIVE/fleet_live.py")
NAME="fleet-$VERSION-linux"
OUT="$LIVE/dist/$NAME"
rm -rf "$OUT" && mkdir -p "$OUT/app/web" "$OUT/icons"
cp "$LIVE/fleet_live.py" "$LIVE/collect_linux.py" "$LIVE/collect_windows.ps1" "$LIVE/inspect_linux.py" "$LIVE/inspect_windows.ps1" "$LIVE/machines.example.toml" "$OUT/app/"
cp "$LIVE/web/index.html" "$LIVE/web/app.js" "$LIVE/web/themes.js" "$LIVE/web/icon.svg" "$OUT/app/web/"
for s in 16 32 48 64 128 256 512; do cp "$LIVE/packaging/icon/png/fleet-$s.png" "$OUT/icons/"; done
cp "$LIVE/packaging/icon/fleet.svg" "$OUT/icons/fleet.svg"
cp "$HERE/install.sh" "$HERE/uninstall.sh" "$HERE/fleet.desktop" "$OUT/"
cp "$LIVE/../COPYING" "$OUT/COPYING"
chmod +x "$OUT/install.sh" "$OUT/uninstall.sh"
cat > "$OUT/README.txt" <<EOF
Fleet $VERSION for Linux: every machine you manage, live, in one tree.

Install (for this user, under ~/.local):   ./install.sh
Remove:                                    ./uninstall.sh
Needs Python 3.11+ and ssh. The app window uses Chrome, Chromium or Edge in app
mode when installed, otherwise your default browser. Settings live in
~/.config/fleet/machines.toml (edit them from Settings in the app).
EOF
# bsdtar (macOS) would add Apple xattr headers that GNU tar warns about on Linux.
TARFLAGS=""; tar --version 2>/dev/null | grep -q bsdtar && TARFLAGS="--no-xattrs --no-mac-metadata"
( cd "$LIVE/dist" && COPYFILE_DISABLE=1 tar $TARFLAGS -czf "$NAME.tar.gz" "$NAME" )
echo "built $LIVE/dist/$NAME.tar.gz"
