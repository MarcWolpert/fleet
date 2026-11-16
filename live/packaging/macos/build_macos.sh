#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Build Fleet.app and a zip of it, into live/dist/: universal (Apple silicon + Intel) by default, or one
# architecture with --arch arm64 (or x86_64), zipped as Fleet-<version>-macos-<arch>.zip.
# Needs the Xcode command line tools (swiftc, lipo, codesign).
# Usage: live/packaging/macos/build_macos.sh [--arch arm64|x86_64] [--check]
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
LIVE=$(cd "$HERE/../.." && pwd)
DIST="$LIVE/dist"
VERSION=$(sed -n 's/^VERSION = "\(.*\)"/\1/p' "$LIVE/fleet_live.py")
APP="$DIST/Fleet.app"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/fleet-macos.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

ARCHS="arm64 x86_64" ZIPSUFFIX="" CHECK=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1 ;;
    --arch) shift; case "${1:-}" in arm64|x86_64) ARCHS="$1" ZIPSUFFIX="-$1" ;; *) echo "build_macos: --arch takes arm64 or x86_64" >&2; exit 2 ;; esac ;;
    *) echo "build_macos: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
# With more than one file, swiftc takes top-level code (FleetApp's app.run()) only from a main.swift.
# (each path stays one quoted word: a checkout or a TMPDIR can have a space in its name)
cp "$HERE/FleetApp.swift" "$WORK/main.swift"
MAIN="$WORK/main.swift" TITLEBAR="$HERE/TitleBar.swift"
if [ -n "$CHECK" ]; then   # typecheck what a build compiles, and stop (the tests use this)
  swiftc -typecheck "$MAIN" "$TITLEBAR"
  exit 0
fi
rm -rf "$APP" && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/live/web"
set --
for arch in $ARCHS; do
  swiftc -O -target "$arch-apple-macos13" -o "$WORK/Fleet-$arch" "$MAIN" "$TITLEBAR" -framework Cocoa -framework WebKit
  set -- "$@" "$WORK/Fleet-$arch"
done
lipo -create -output "$APP/Contents/MacOS/Fleet" "$@"

cp "$LIVE/fleet_live.py" "$LIVE/collect_linux.py" "$LIVE/collect_windows.ps1" "$LIVE/inspect_linux.py" "$LIVE/inspect_windows.ps1" "$LIVE/machines.example.toml" "$APP/Contents/Resources/live/"
cp "$LIVE/web/index.html" "$LIVE/web/app.js" "$LIVE/web/themes.js" "$LIVE/web/icon.svg" "$APP/Contents/Resources/live/web/"
cp "$LIVE/packaging/icon/Fleet.icns" "$APP/Contents/Resources/Fleet.icns"
cp "$LIVE/../COPYING" "$APP/Contents/Resources/COPYING"
sed "s/@VERSION@/$VERSION/g" "$HERE/Info.plist" > "$APP/Contents/Info.plist"
plutil -lint "$APP/Contents/Info.plist" >/dev/null

codesign --force --deep --sign - "$APP"   # ad-hoc: runs on this Mac; share a notarized build for other Macs
ZIP="Fleet-$VERSION-macos$ZIPSUFFIX.zip"
( cd "$DIST" && rm -f "$ZIP" && ditto -c -k --keepParent Fleet.app "$ZIP" )
echo "built $APP ($(lipo -archs "$APP/Contents/MacOS/Fleet")) and $DIST/$ZIP"
