# Releasing Fleet

Fleet is released for **macOS and Linux** on GitHub Releases, as `Fleet <version>`, tagged `fleet-v<version>`.
The prefix keeps Fleet's tags apart from Mission Center's own `v<version>` tags, which this full-history fork
carries and an upstream merge can bring more of. The first release is **0.0.1**.

1. Land everything on `main` the usual way (reviewed PRs, `.local/land_stack.sh`).
2. On a branch, set `VERSION` in `live/fleet_live.py` (the one place the version lives: the app bundle's
   Info.plist and both package names take it from there) and add a `## Fleet <version>` section at the top of
   `live/CHANGELOG.md`. Land that too.
3. On a Mac, on a clean `main` equal to `origin/main`: `live/packaging/release.sh <version>`. It checks the
   version, the changelog, the branch and that the tag is new, runs every test, and builds
   `live/dist/Fleet-<version>-macos-arm64.zip` (Apple silicon) and the Linux package, published as
   `fleet-<version>-linux-x64.tar.gz` and `fleet-<version>-linux-arm64.tar.gz` (Python and HTML: the same package under each name).
4. If all is well, run it again with `--publish`: it tags `fleet-v<version>`, pushes the tag and publishes the
   release with both packages, its notes taken from that version's changelog section.
