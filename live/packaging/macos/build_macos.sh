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

# what it runs, inside it (#359): its own Python, ttyd and tmux (Apple silicon: the Python and Homebrew's are arm64)
if [ "$ARCHS" = arm64 ]; then "$HERE/bundle_deps.sh" "$APP"; else echo "build_macos: a $ARCHS build carries no Python, ttyd or tmux (only arm64 builds do)" >&2; fi
codesign --force --deep --sign - "$APP"   # ad-hoc: runs on this Mac; share a notarized build for other Macs
if [ -f "$APP/Contents/Resources/FLEET_BUNDLE" ]; then   # the build checks itself: nothing outside the app, each program runs
  R="$APP/Contents/Resources"
  if find "$R/bin" "$R/lib" -type f -exec otool -L {} + | grep -E '^[[:space:]]+/(opt|usr/local)/'; then echo "build_macos: a bundled program still uses a library outside the app" >&2; exit 1; fi
  "$R/python/bin/python3" -c 'import ssl, sqlite3, json, tomllib' && "$R/bin/ttyd" --version >/dev/null && TERMINFO_DIRS="$R/terminfo" "$R/bin/tmux" -V >/dev/null || { echo "build_macos: a bundled program doesn't run" >&2; exit 1; }
  codesign --verify --deep --strict "$APP" || { echo "build_macos: the signature doesn't verify" >&2; exit 1; }
fi
ZIP="Fleet-$VERSION-macos$ZIPSUFFIX.zip"
# the zip opens to a folder: Fleet.app, how to install it, and a script that does (#361)
STAGE="$WORK/stage/Fleet-$VERSION" && rm -rf "$WORK/stage" && mkdir -p "$STAGE"
ditto "$APP" "$STAGE/Fleet.app"
cp "$HERE/install.command" "$STAGE/Install Fleet.command" && chmod 755 "$STAGE/Install Fleet.command"
if [ -f "$APP/Contents/Resources/FLEET_BUNDLE" ]; then NEEDS="Everything Fleet runs is inside the app: its own Python, ttyd and tmux. It reaches your
machines with the Mac's own ssh."; else NEEDS="This build needs Python 3.11 or newer (brew install python), and ttyd and tmux for the
terminals below the page (brew install ttyd tmux)."; fi
cat > "$STAGE/README.txt" <<EOT
Fleet $VERSION for macOS$( [ "$ARCHS" = arm64 ] && echo " (Apple silicon)" ): every machine you manage, live, in one tree.

Install it:
  Double-click "Install Fleet.command". It copies Fleet.app into Applications
  and opens it. If macOS says it can't check the script, right-click it, choose
  Open, then Open again (or run it in Terminal: sh "Install Fleet.command").

Or by hand: drag Fleet.app into Applications. Fleet isn't notarized by Apple
yet, so the first time, right-click Fleet.app and choose Open (or open System
Settings > Privacy & Security and choose Open Anyway).

$NEEDS

Then use + Add a machine at the bottom of the tree. Fleet reads each machine
over SSH, read-only, and installs nothing on it. The Tutorial pill at the top
explains the rest.

To remove it: drag Fleet.app to the Bin. Your settings in ~/.config/fleet stay.
EOT
( cd "$WORK/stage" && rm -f "$DIST/$ZIP" && ditto -c -k --keepParent "Fleet-$VERSION" "$DIST/$ZIP" )
echo "built $APP ($(lipo -archs "$APP/Contents/MacOS/Fleet")) and $DIST/$ZIP"
