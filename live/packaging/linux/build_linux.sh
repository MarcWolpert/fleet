#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Build live/dist/fleet-<version>-linux.tar.gz: the app, icons, a menu entry and install/uninstall scripts.
# With --arch x86_64 or aarch64 it is self-contained (#360): fleet-<version>-linux-<x64|arm64>.tar.gz also carries a
# Python, ttyd and tmux (fetch_linux_deps.sh, or --deps <dir> with python.tar.gz, ttyd, tmux and terminfo/), so the
# machine it's installed on needs nothing but ssh.
# Usage: live/packaging/linux/build_linux.sh [--arch x86_64|aarch64 [--deps <dir>]]
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
LIVE=$(cd "$HERE/../.." && pwd)
ARCH="" DEPS=""
while [ $# -gt 0 ]; do case $1 in --arch) ARCH=$2; shift 2 ;; --deps) DEPS=$2; shift 2 ;; *) echo "build_linux: unknown $1" >&2; exit 2 ;; esac; done
VERSION=$(sed -n 's/^VERSION = "\(.*\)"/\1/p' "$LIVE/fleet_live.py")
case $ARCH in "") NAME="fleet-$VERSION-linux" ;; x86_64) NAME="fleet-$VERSION-linux-x64" ;; aarch64) NAME="fleet-$VERSION-linux-arm64" ;; *) echo "build_linux: --arch x86_64 or aarch64" >&2; exit 2 ;; esac
OUT="$LIVE/dist/$NAME"
rm -rf "$OUT" && mkdir -p "$OUT/app/live/web" "$OUT/icons"
cp "$LIVE/fleet_live.py" "$LIVE/collect_linux.py" "$LIVE/collect_windows.ps1" "$LIVE/inspect_linux.py" "$LIVE/inspect_windows.ps1" "$LIVE/machines.example.toml" "$OUT/app/live/"
cp "$LIVE/web/index.html" "$LIVE/web/app.js" "$LIVE/web/themes.js" "$LIVE/web/icon.svg" "$OUT/app/live/web/"
mkdir -p "$OUT/app/live/web/fonts" && cp "$LIVE/web/fonts/"* "$OUT/app/live/web/fonts/"   # the terminals' symbols font (#387)
if [ -n "$ARCH" ]; then   # what it runs, inside it: a Python, ttyd and tmux (#360)
  [ -n "$DEPS" ] || DEPS=$("$HERE/fetch_linux_deps.sh" "$ARCH" | tail -1)
  tar -xzf "$DEPS/python.tar.gz" -C "$OUT/app"   # -> app/python
  ( cd "$OUT/app/python/lib/python3.12" 2>/dev/null && rm -rf test idlelib tkinter turtledemo turtle.py lib2to3 ensurepip ) || true
  rm -rf "$OUT/app/python/lib/"tcl* "$OUT/app/python/lib/"tk* "$OUT/app/python/lib/"itcl* "$OUT/app/python/share"
  mkdir -p "$OUT/app/bin" && cp "$DEPS/ttyd" "$DEPS/tmux" "$OUT/app/bin/" && chmod 755 "$OUT/app/bin/ttyd" "$OUT/app/bin/tmux"
  cp -R "$DEPS/terminfo" "$OUT/app/terminfo"
  touch "$OUT/app/FLEET_BUNDLE"
  python3 "$HERE/../notices/notices.py" linux "$OUT/THIRD_PARTY_NOTICES.txt" && cp "$OUT/THIRD_PARTY_NOTICES.txt" "$OUT/app/"   # what it carries, and their licences (#388)
fi
for s in 16 32 48 64 128 256 512; do cp "$LIVE/packaging/icon/png/fleet-$s.png" "$OUT/icons/"; done
cp "$LIVE/packaging/icon/fleet.svg" "$OUT/icons/fleet.svg"
cp "$HERE/install.sh" "$HERE/uninstall.sh" "$HERE/fleet.desktop" "$OUT/"
cp "$LIVE/../COPYING" "$OUT/COPYING"
chmod +x "$OUT/install.sh" "$OUT/uninstall.sh"
if [ -n "$ARCH" ]; then NEEDS="Everything Fleet runs is inside: its own Python, ttyd and tmux. It reaches your
machines with your own ssh (openssh), which almost every Linux has."
else NEEDS="Needs Python 3.11 or newer and ssh; ttyd and tmux for the terminals below the page."; fi
cat > "$OUT/README.txt" <<EOF
Fleet $VERSION for Linux: every machine you manage, live, in one tree.

Install it (for you, under ~/.local; no sudo):

    tar -xzf $NAME.tar.gz
    cd $NAME
    ./install.sh

Then open Fleet from your app menu, or run ~/.local/bin/fleet.
To remove it: ./uninstall.sh (your settings in ~/.config/fleet stay).

$NEEDS
Works on Ubuntu, Pop!_OS, Fedora, Bazzite, Arch and other current
distributions. The window opens in Chrome, Chromium or Edge (app mode) when
one is installed, otherwise in your default browser.

Then use + Add a machine at the bottom of the tree. Fleet reads each machine
over SSH, read-only, and installs nothing on it. The Tutorial pill at the top
explains the rest.
EOF
# bsdtar (macOS) would add Apple xattr headers that GNU tar warns about on Linux.
TARFLAGS=""; tar --version 2>/dev/null | grep -q bsdtar && TARFLAGS="--no-xattrs --no-mac-metadata"
( cd "$LIVE/dist" && COPYFILE_DISABLE=1 tar $TARFLAGS -czf "$NAME.tar.gz" "$NAME" )
echo "built $LIVE/dist/$NAME.tar.gz"
