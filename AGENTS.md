# Fleet Codex Instructions

Codex follows the same rules as Claude in this repo. Read these first, in order:

1. `CLAUDE.md`: decisions, the tree model, upstream ownership, TDD, git
   discipline, safety around real machines, verification targets.
2. `FLEET.md`: what Fleet is.
3. `docs/fleet/HOOKS.md`: the only upstream lines Fleet may change.

The rules that matter most when reviewing or writing code here:

- Upstream-owned files (anything in `git ls-tree -r --name-only upstream/main`)
  change only through an approved hook in `docs/fleet/HOOKS.md`. Fleet code
  goes in `src/fleet/`, `crates/fleet-*` or `docs/fleet/`.
- Tests come first and fail first. They assert the complete result as an exact
  set, with a "nothing else" control.
- Only read from Marc's real machines; actions run only against `fleet-lab`.
  Never touch any `shop-*` Compose project, container or volume.
- Commit subjects end with `[skip ci]`; no CI runs on GitHub.
- Review findings use the triage format in `CLAUDE.md`'s process (`F<n>:
  fixed <sha> — <why>` / `F<n>: declined — <reason>`), posted on the issue.
