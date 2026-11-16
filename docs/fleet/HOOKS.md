# Approved upstream hooks

Fleet extends Mission Center without editing it. These are the only places
where Fleet changes an upstream-owned file. Each entry says what changed and
why. A new entry needs Marc's approval, and a branch that edits an upstream
file anywhere else is refactored before review (see `CLAUDE.md`).

Check a path's ownership with:

```bash
git ls-tree -r --name-only upstream/main | grep -qx <path> && echo upstream-owned
```

| # | File | Change | Why | Approved |
|---|------|--------|-----|----------|
| 1 | `.gitmodules` | Submodule URLs `../gng.git` and `../graph-widget.git` become absolute `https://gitlab.com/mission-center-devs/…` URLs | Relative URLs resolve against the remote you cloned from, so on GitHub they would point at `MarcWolpert/gng.git`, which doesn't exist | Required by the full-history fork (Marc, 2026-11-15) |
| 2 | `README.md` | Replaced by Fleet's README; Mission Center's moved to `docs/mission-center/README.md` | GitHub shows the root README, and it should describe Fleet. On an upstream sync, keep Fleet's and copy upstream's new README to `docs/mission-center/README.md` | Marc, 2026-11-15 ("update the readme for fleet") |

Planned, not yet approved: one `mod fleet;` line in `src/main.rs`, and a
sidebar slot in the main window for the machine tree and the spaces bar.
