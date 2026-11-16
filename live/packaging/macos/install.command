#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Install Fleet: copy Fleet.app into Applications (yours, when the Mac's isn't writable) and open it.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
[ -d "$HERE/Fleet.app" ] || { echo "Fleet.app should be next to this script." >&2; exit 1; }
DEST=/Applications
[ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }
osascript -e 'tell application "Fleet" to quit' >/dev/null 2>&1 || true   # an older Fleet that's open
rm -rf "$DEST/Fleet.app"
ditto "$HERE/Fleet.app" "$DEST/Fleet.app"
# Fleet isn't notarized by Apple yet: you chose to install it, so it comes out of quarantine and opens like any app
xattr -dr com.apple.quarantine "$DEST/Fleet.app" 2>/dev/null || true
echo "Installed Fleet in $DEST. Opening it..."
open "$DEST/Fleet.app"
