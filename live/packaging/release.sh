#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Cut a Fleet release for macOS and Linux:  live/packaging/release.sh <version> [--publish]
#
# Checks that VERSION in live/fleet_live.py and the top of live/CHANGELOG.md say <version>, that this is a clean
# main equal to origin/main, and that the tag fleet-v<version> is new (prefixed so Fleet's tags never collide with
# Mission Center's own v0.x tags in this fork). Then it runs every test and builds both packages. Only with
# --publish does it tag, push the tag and publish the GitHub release with both packages and the changelog's notes.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
LIVE=$(cd "$HERE/.." && pwd)
ROOT=$(cd "$LIVE/.." && pwd)
WANT=${1:?usage: release.sh <version> [--publish]}
PUBLISH=${2:-}
TAG="fleet-v$WANT"
die(){ echo "release: $*" >&2; exit 1; }

HAVE=$(sed -n 's/^VERSION = "\(.*\)"/\1/p' "$LIVE/fleet_live.py")
[ "$HAVE" = "$WANT" ] || die "VERSION in live/fleet_live.py is $HAVE, not $WANT: set it (and the changelog) first"
grep -q "^## Fleet $WANT\$" "$LIVE/CHANGELOG.md" || die "live/CHANGELOG.md has no '## Fleet $WANT' section"
cd "$ROOT"
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "not on main (releases are cut from main, after the PRs land)"
[ -z "$(git status --porcelain)" ] || die "the working tree isn't clean"
git fetch -q origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "main isn't origin/main: pull or land first"
! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || die "$TAG already exists"
! git ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1 || die "$TAG already exists on origin"

"$LIVE/tests/run.sh"
if [ "$(uname)" = Darwin ]; then "$HERE/macos/build_macos.sh"; else echo "release: not on a Mac, so no macOS app from here" >&2; fi
"$HERE/linux/build_linux.sh"
MAC="$LIVE/dist/Fleet-$WANT-macos.zip" LINUX="$LIVE/dist/fleet-$WANT-linux.tar.gz"
[ -f "$LINUX" ] || die "no $LINUX"
NOTES=$(mktemp)
awk -v v="## Fleet $WANT" '$0 == v {on = 1; next} /^## / && on {exit} on' "$LIVE/CHANGELOG.md" > "$NOTES"

if [ "$PUBLISH" != "--publish" ]; then
  echo "release: all checks passed. With --publish this tags $TAG at $(git rev-parse --short HEAD) and publishes \"Fleet $WANT\" with:"
  ls -1 "$MAC" "$LINUX" 2>/dev/null | sed 's/^/  /'
  exit 0
fi
[ -f "$MAC" ] || die "no $MAC: publish from a Mac so the release has both packages"
git tag -a "$TAG" -m "Fleet $WANT"
git push origin "$TAG"
gh release create "$TAG" "$MAC" "$LINUX" --title "Fleet $WANT" --notes-file "$NOTES" --latest
echo "release: published Fleet $WANT ($TAG)"
