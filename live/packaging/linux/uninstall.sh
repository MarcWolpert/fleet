#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Remove what install.sh added. Your settings (~/.config/fleet) and saved state (~/.cache/fleet-live) stay.
set -eu
PREFIX=${PREFIX:-$HOME/.local}
rm -rf "$PREFIX/share/fleet"
rm -f "$PREFIX/bin/fleet" "$PREFIX/share/applications/fleet.desktop"
for s in 16 32 48 64 128 256 512; do rm -f "$PREFIX/share/icons/hicolor/${s}x${s}/apps/fleet.png"; done
rm -f "$PREFIX/share/icons/hicolor/scalable/apps/fleet.svg"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$PREFIX/share/applications" >/dev/null 2>&1 || true
echo "Fleet removed. Settings in ~/.config/fleet were kept."
