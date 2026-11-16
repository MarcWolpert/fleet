#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Install Fleet's Flatpak for you (no sudo). Flathub is added for its runtime when it isn't there yet.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
F=$(ls "$HERE"/fleet-*.flatpak 2>/dev/null | head -1)
[ -n "$F" ] || { echo "The .flatpak file should be next to this script." >&2; exit 1; }
command -v flatpak >/dev/null 2>&1 || { echo "Flatpak isn't installed here. Ubuntu: sudo apt install flatpak; Arch: sudo pacman -S flatpak. Or use Fleet's .tar.gz package instead." >&2; exit 1; }
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user -y --noninteractive "$F"
echo "Installed. Open Fleet from your app menu, or run: flatpak run io.github.MarcWolpert.Fleet"
