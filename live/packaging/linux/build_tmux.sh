#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# A fully static tmux for the Linux package (#360), built from tmux's source (pinned by its SHA-256) on Alpine (musl,
# static libevent and ncurses), so it runs on any Linux distribution; and the terminfo entries it needs.
# Usage: build_tmux.sh <x86_64|aarch64>      (needs Docker; writes into $FLEET_BUILD_CACHE, ~/.cache/fleet-build)
set -eu
ARCH=${1:?usage: build_tmux.sh x86_64|aarch64}
case $ARCH in x86_64) PLAT=linux/amd64 ;; aarch64) PLAT=linux/arm64 ;; *) echo "build_tmux: x86_64 or aarch64" >&2; exit 2 ;; esac
C=${FLEET_BUILD_CACHE:-$HOME/.cache/fleet-build}
VER=3.8 SHA=e79c699c7e949dccd0a4a125e17b8d1261e311b16979dbc8eb34542f3966d82e
[ -f "$C/tmux-$VER.tar.gz" ] || curl -fsSL "https://github.com/tmux/tmux/releases/download/$VER/tmux-$VER.tar.gz" -o "$C/tmux-$VER.tar.gz"
[ "$(shasum -a 256 "$C/tmux-$VER.tar.gz" 2>/dev/null | cut -d' ' -f1 || sha256sum "$C/tmux-$VER.tar.gz" | cut -d' ' -f1)" = "$SHA" ] || { echo "build_tmux: the tmux source doesn't match its checksum" >&2; exit 1; }
docker run --rm --platform "$PLAT" -v "$C":/c alpine:3.20 sh -euc "
  apk add --no-cache -q build-base libevent-dev libevent-static ncurses-dev ncurses-static ncurses-terminfo bison pkgconf linux-headers >/dev/null
  if [ ! -x /c/tmux-$VER-static.$ARCH ]; then   # built once per architecture
    tar -xzf /c/tmux-$VER.tar.gz -C /tmp && cd /tmp/tmux-$VER
    ./configure -q --enable-static --prefix=/usr >/dev/null && make -s -j4 >/dev/null && strip tmux
    echo \"built \$(./tmux -V) (\$(uname -m), static)\"
    cp tmux /c/tmux-$VER-static.$ARCH
  fi
  rm -rf /c/terminfo && mkdir -p /c/terminfo
  for e in xterm xterm-256color tmux tmux-256color screen screen-256color; do
    f=\$(find /usr/share/terminfo /etc/terminfo -name \"\$e\" \\( -type f -o -type l \\) 2>/dev/null | head -1); [ -n \"\$f\" ] || continue
    d=/c/terminfo/\$(basename \$(dirname \$f)); mkdir -p \$d && cp -L \$f \$d/
  done
  ls /c/terminfo/*/xterm-256color >/dev/null
"
