#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# What the self-contained Linux package carries (#360), each pinned by its SHA-256: a Python (python-build-standalone,
# glibc 2.17 or newer, so every current distribution), ttyd (its own fully static release build) and a fully static
# tmux built from source (build_tmux.sh), with the terminfo entries it needs.
# Usage: fetch_linux_deps.sh <x86_64|aarch64>   ->  $FLEET_BUILD_CACHE/linux-<arch>/{python.tar.gz,ttyd,tmux,terminfo/}
set -eu
ARCH=${1:?usage: fetch_linux_deps.sh x86_64|aarch64}
HERE=$(cd "$(dirname "$0")" && pwd)
C=${FLEET_BUILD_CACHE:-$HOME/.cache/fleet-build}
die(){ echo "fetch_linux_deps: $*" >&2; exit 1; }
sha(){ shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1 || sha256sum "$1" | cut -d' ' -f1; }
get(){ [ -f "$2" ] && [ "$(sha "$2")" = "$3" ] || { curl -fsSL "$1" -o "$2.part" && mv "$2.part" "$2"; }; [ "$(sha "$2")" = "$3" ] || die "$(basename "$2") doesn't match its checksum"; }
case $ARCH in
  x86_64) PY_SHA=c2f87d4b4e8db3abddb0f116c6ccfc503d0cbdbb9ee8faacddad1b679ec12e99 TTYD_SHA=8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55 ;;
  aarch64) PY_SHA=4792f81750282597fb2a3389fe18b945ed2ba6aad5e45ad406d122c58cb33081 TTYD_SHA=b38acadd89d1d396a0f5649aa52c539edbad07f4bc7348b27b4f4b7219dd4165 ;;
  *) die "x86_64 or aarch64" ;;
esac
mkdir -p "$C"
PY="cpython-3.12.16+20261110-$ARCH-unknown-linux-gnu-install_only.tar.gz"
get "https://github.com/astral-sh/python-build-standalone/releases/download/20261110/$(printf %s "$PY" | sed 's/+/%2B/')" "$C/$PY" "$PY_SHA"
get "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.$ARCH" "$C/ttyd-1.7.7.$ARCH" "$TTYD_SHA"
[ -x "$C/tmux-3.8-static.$ARCH" ] && [ -f "$C/terminfo/78/xterm-256color" -o -f "$C/terminfo/x/xterm-256color" ] || "$HERE/build_tmux.sh" "$ARCH"
D="$C/linux-$ARCH"; rm -rf "$D" && mkdir -p "$D"
cp "$C/$PY" "$D/python.tar.gz" && cp "$C/ttyd-1.7.7.$ARCH" "$D/ttyd" && cp "$C/tmux-3.8-static.$ARCH" "$D/tmux" && cp -R "$C/terminfo" "$D/terminfo"
chmod 755 "$D/ttyd" "$D/tmux"
echo "$D"
