#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Build live/dist/fleet-<version>-<arch>.flatpak (#358), a single file to hand someone: flatpak install it, and the
# runtime comes from Flathub. The app is what io.github.MarcWolpert.Fleet.yml describes, assembled with flatpak's own
# build-init, build-finish, build-export and build-bundle: they need no sandbox, so it builds in a Linux container even
# under emulation (flatpak-builder's bwrap can't filter system calls there). The app's files are the self-contained
# Linux package's for that architecture, without its Python (the runtime has one).
# Usage: live/packaging/flatpak/build_flatpak.sh [x86_64|aarch64]
#        (a privileged Linux container with flatpak and org.freedesktop.Platform and Sdk 24.08 for that architecture:
#         FLEET_FLATPAK_CONTAINER, default fleet-flatpak for x86_64 and fleet-flatpak-arm for aarch64)
set -eu
ARCH=${1:-x86_64}
case $ARCH in x86_64) TAR=x64 DEF=fleet-flatpak ;; aarch64) TAR=arm64 DEF=fleet-flatpak-arm ;; *) echo "build_flatpak: x86_64 or aarch64" >&2; exit 2 ;; esac
HERE=$(cd "$(dirname "$0")" && pwd)
LIVE=$(cd "$HERE/../.." && pwd)
VERSION=$(sed -n 's/^VERSION = "\(.*\)"/\1/p' "$LIVE/fleet_live.py")
CT=${FLEET_FLATPAK_CONTAINER:-$DEF}
ID=io.github.MarcWolpert.Fleet
"$LIVE/packaging/linux/build_linux.sh" --arch "$ARCH" >/dev/null
PKG="$LIVE/dist/fleet-$VERSION-linux-$TAR"
STAGE=$(mktemp -d)
mkdir -p "$STAGE/src"
cp -R "$PKG/app" "$STAGE/src/app" && rm -rf "$STAGE/src/app/python"
cp -R "$PKG/icons" "$STAGE/src/icons"
cp "$HERE/fleet.sh" "$HERE/$ID.desktop" "$HERE/$ID.metainfo.xml" "$STAGE/src/"
docker exec "$CT" rm -rf /build && docker cp "$STAGE/." "$CT:/build"
rm -rf "$STAGE"
# the finish arguments are the manifest's
FINISH=$(sed -n 's/^  - \(--[a-z-]*=*[^ ]*\).*/\1/p' "$HERE/$ID.yml" | tr '\n' ' ')
docker exec -e ID=$ID -e FINISH="$FINISH" "$CT" sh -euc '
  cd /build
  flatpak build-init out "$ID" org.freedesktop.Sdk org.freedesktop.Platform 24.08 >/dev/null
  F=out/files
  mkdir -p $F/share/fleet $F/bin && cp -R src/app/. $F/share/fleet/
  install -m755 src/fleet.sh $F/bin/fleet
  install -Dm644 src/$ID.desktop $F/share/applications/$ID.desktop
  install -Dm644 src/$ID.metainfo.xml $F/share/metainfo/$ID.metainfo.xml
  for s in 16 32 48 64 128 256 512; do install -Dm644 src/icons/fleet-$s.png $F/share/icons/hicolor/${s}x${s}/apps/$ID.png; done
  install -Dm644 src/icons/fleet.svg $F/share/icons/hicolor/scalable/apps/$ID.svg
  flatpak build-finish out --command=fleet $FINISH >/dev/null
  flatpak build-export repo out >/dev/null
  flatpak build-bundle repo fleet.flatpak "$ID" --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo'
OUT="$LIVE/dist/fleet-$VERSION-$ARCH.flatpak"
docker cp "$CT:/build/fleet.flatpak" "$OUT"
# and a folder to hand over with it: the file, how to install it, and a script that does (#361)
KIT="$LIVE/dist/fleet-$VERSION-$ARCH-flatpak"
rm -rf "$KIT" && mkdir -p "$KIT" && cp "$OUT" "$KIT/" && cp "$HERE/install-flatpak.sh" "$KIT/install.sh" && chmod 755 "$KIT/install.sh"
cat > "$KIT/README.txt" <<EOT
Fleet $VERSION as a Flatpak ($ARCH): every machine you manage, live, in one tree.

Install it (for you; no sudo):

    ./install.sh

or by hand: flatpak install --user fleet-$VERSION-$ARCH.flatpak
(Flatpak gets its runtime from Flathub; the script adds Flathub if needed.)
Then open Fleet from your app menu, or run: flatpak run $ID

For Bazzite, Pop!_OS, Fedora and other distributions with Flatpak. On Ubuntu
or Arch without Flatpak, use Fleet's self-contained .tar.gz instead.

Fleet reads this computer and reaches your machines from the host (as
Mission Center's Flatpak does), with the host's own python3 and ssh, which
these distributions have. Its terminals (ttyd and tmux) come with it.

Then use + Add a machine at the bottom of the tree. Fleet reads each machine
over SSH, read-only, and installs nothing on it. The Tutorial pill at the top
explains the rest.

To remove it: flatpak uninstall $ID (your settings in ~/.config/fleet stay).
EOT
( cd "$LIVE/dist" && rm -f "fleet-$VERSION-$ARCH-flatpak.tar.gz" && tar -czf "fleet-$VERSION-$ARCH-flatpak.tar.gz" "fleet-$VERSION-$ARCH-flatpak" )
echo "built $OUT and $LIVE/dist/fleet-$VERSION-$ARCH-flatpak.tar.gz"
