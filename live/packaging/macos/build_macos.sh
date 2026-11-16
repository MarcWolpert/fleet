#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Build Fleet.app (universal: Apple silicon + Intel) and a zip of it, into live/dist/.
# Needs the Xcode command line tools (swiftc, lipo, codesign). Usage: live/packaging/macos/build_macos.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
LIVE=$(cd "$HERE/../.." && pwd)
DIST="$LIVE/dist"
VERSION=$(sed -n 's/^VERSION = "\(.*\)"/\1/p' "$LIVE/fleet_live.py")
APP="$DIST/Fleet.app"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/fleet-macos.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

rm -rf "$APP" && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/live/web"
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos13" -o "$WORK/Fleet-$arch" "$HERE/FleetApp.swift" -framework Cocoa -framework WebKit
done
lipo -create -output "$APP/Contents/MacOS/Fleet" "$WORK/Fleet-arm64" "$WORK/Fleet-x86_64"

cp "$LIVE/fleet_live.py" "$LIVE/collect_linux.py" "$LIVE/collect_windows.ps1" "$LIVE/machines.example.toml" "$APP/Contents/Resources/live/"
cp "$LIVE/web/index.html" "$LIVE/web/app.js" "$LIVE/web/themes.js" "$LIVE/web/icon.svg" "$APP/Contents/Resources/live/web/"
cp "$LIVE/packaging/icon/Fleet.icns" "$APP/Contents/Resources/Fleet.icns"
cp "$LIVE/../COPYING" "$APP/Contents/Resources/COPYING"
sed "s/@VERSION@/$VERSION/g" "$HERE/Info.plist" > "$APP/Contents/Info.plist"
plutil -lint "$APP/Contents/Info.plist" >/dev/null

codesign --force --deep --sign - "$APP"   # ad-hoc: runs on this Mac; share a notarized build for other Macs
( cd "$DIST" && rm -f "Fleet-$VERSION-macos.zip" && ditto -c -k --keepParent Fleet.app "Fleet-$VERSION-macos.zip" )
echo "built $APP ($(lipo -archs "$APP/Contents/MacOS/Fleet")) and $DIST/Fleet-$VERSION-macos.zip"
