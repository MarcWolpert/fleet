#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Put what Fleet.app runs inside it, so there's nothing else to install (#359): a Python (python-build-standalone,
# pinned by its checksum), and ttyd and tmux with the libraries they use (from this Mac's Homebrew, relocated into
# the app), libwebsockets' event-loop plugin (ttyd loads it at run time) and the terminfo entries tmux needs.
# Usage: bundle_deps.sh <Fleet.app>      (build_macos.sh runs it)
set -eu
APP=$1
RES="$APP/Contents/Resources"
HERE=$(cd "$(dirname "$0")" && pwd)
CACHE=${FLEET_BUILD_CACHE:-$HOME/.cache/fleet-build}
PY_REL=20261110 PY_VER=3.12.16
PY_FILE="cpython-$PY_VER+$PY_REL-aarch64-apple-darwin-install_only.tar.gz"
PY_SHA=e956e60bc9465d577ef8062059aa05cd3a2665b4b8678a2ed24e432368330b8f
die(){ echo "bundle_deps: $*" >&2; exit 1; }

mkdir -p "$CACHE"
PY_TGZ="$CACHE/$PY_FILE"
ok(){ [ -f "$PY_TGZ" ] && [ "$(shasum -a 256 "$PY_TGZ" | cut -d' ' -f1)" = "$PY_SHA" ]; }
ok || { curl -fsSL "https://github.com/astral-sh/python-build-standalone/releases/download/$PY_REL/$(printf %s "$PY_FILE" | sed 's/+/%2B/')" -o "$PY_TGZ.part" && mv "$PY_TGZ.part" "$PY_TGZ"; }
ok || die "the Python download doesn't match its checksum"
rm -rf "$RES/python" && tar -xzf "$PY_TGZ" -C "$RES"
# what Fleet never uses: the test suite, Tk and IDLE
( cd "$RES/python/lib/python3.12" && rm -rf test idlelib tkinter turtledemo turtle.py lib2to3 ensurepip ) && rm -rf "$RES/python/lib/"tcl* "$RES/python/lib/"tk* "$RES/python/lib/"itcl* "$RES/python/share"
"$RES/python/bin/python3" -c 'import ssl, sqlite3, json, urllib.request, tomllib, zlib' || die "the bundled Python is missing a module Fleet uses"

BREW=$(brew --prefix 2>/dev/null) || die "Homebrew is needed to build (ttyd and tmux come from it): brew install ttyd tmux"
for t in ttyd tmux; do [ -x "$BREW/bin/$t" ] || die "no $t: brew install $t"; done
rm -rf "$RES/bin" "$RES/lib" "$RES/terminfo" && mkdir -p "$RES/bin" "$RES/lib"
for t in ttyd tmux; do cp "$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$BREW/bin/$t")" "$RES/bin/$t"; chmod 755 "$RES/bin/$t"; done
PLUGIN=$(ls "$BREW"/opt/libwebsockets/lib/libwebsockets-evlib_uv.dylib 2>/dev/null) || die "libwebsockets has no libuv event-loop plugin"
for t in ttyd tmux; do export "RELOCATE_SRC_$t=$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$BREW/bin/$t")"; done
python3 "$HERE/relocate.py" "$RES/bin" "$RES/lib" "$PLUGIN"
# tmux's terminal descriptions (it looks in the package first: bundle_env)
TI="$BREW/opt/ncurses/share/terminfo"
for e in xterm xterm-256color tmux tmux-256color screen screen-256color; do
  for f in "$TI"/*/"$e"; do [ -f "$f" ] || continue; d="$RES/terminfo/$(basename "$(dirname "$f")")"; mkdir -p "$d" && cp "$f" "$d/"; done
done
ls "$RES/terminfo"/*/xterm-256color >/dev/null 2>&1 || die "no terminfo for xterm-256color"
touch "$RES/FLEET_BUNDLE"
# every program the app carries is signed (ad hoc) before the app is
find "$RES/python" -type f \( -perm -u+x -o -name '*.dylib' -o -name '*.so' \) -exec codesign --force --sign - {} + 2>/dev/null
echo "bundled: Python $PY_VER, ttyd $("$RES/bin/ttyd" --version 2>&1 | sed 's/ttyd version //'), $("$RES/bin/tmux" -V)"
