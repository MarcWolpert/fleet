# Fleet — Development Workflow

Fleet is a fork of [Mission Center](https://gitlab.com/mission-center-devs/mission-center)
(Rust, GTK4/libadwaita) that shows every machine you manage as a tree, and
where each machine's usage goes by type. The per-session startup routine
lives in the untracked `CLAUDE.local.md`; this file governs how development
itself is run. The product decisions are in `FLEET.md`.

## Decisions (Marc, 2026-11-15)

- **Platforms:** the app runs on macOS, Linux and Windows (Marc, 2026-11-15:
  "build it for mac, linux, and windows"). Until the native GTK app is
  ported, **Fleet Live** (`live/`, Python 3.11+ and a browser) is the version
  in daily use; it runs on all three.
- **Repo:** a full-history fork. `upstream` is GitLab, `origin` is
  `github.com/MarcWolpert/fleet`. Upstream comes in by **merging**
  `upstream/main`, never by rebasing (see "Upstream ownership").
- **Transport:** an agent on each host. Its socket is tunnelled over SSH
  (`~/.ssh/config`, Tailscale). Docker is read through `DOCKER_HOST=ssh://`.
  No new listening ports on any machine.
- **Control:** actions everywhere (kill, stop, restart, run a cron job now),
  each behind a confirmation that names the machine, the object and the
  effect, and each written to an audit log. Protected objects (below) need a
  typed confirmation.
- **License:** GPL-3.0-or-later, inherited from Mission Center. Every new file
  carries the same license header as upstream's sources.

## The tree model

```
machine ─┬─ Base system           everything not in a group below (OS, daemons, apps)
         ├─ Docker Compose ─ project ─ service
         ├─ Containers ─ container
         └─ VMs ─ machine          (recursive: a VM is a machine)
```

- **Cron jobs** sit under whatever runs them: the host's Base system, a
  Compose service or a container. Sources: crontab, systemd timers, launchd,
  Windows Task Scheduler ("Scheduled tasks"), cron inside containers. A job's
  usage is a breakdown of its owner, **never added on top**.
- **Metrics:** CPU, memory, GPU, disk I/O, network. GPU is tracked **per GPU**:
  every workload names the GPU(s) it runs on (`GPU0`, `GPU1`, `GPU0+1`). A VM's
  virtual GPU maps onto the host GPU it lands on.
- **VM share of its host** is measured from the host side (the hypervisor's
  view); the VM's own tree is measured from inside it.
- **Spaces:** one per root machine plus pinned VMs, like Marc's herdr tabs.
  The design mockup is `docs/design/fleet-mockup.html`.

## Upstream ownership: extend, don't edit

The point is to keep profiting from upstream work without merge collisions.

- A file is **upstream-owned** if it exists in upstream's tree:
  `git ls-tree -r --name-only upstream/main | grep -qx <path>`.
- Fleet code lives in **fleet-owned** files: `src/fleet/`, `crates/fleet-*`
  (model, agent, collectors), `live/` (Fleet Live), `docs/fleet/`,
  `docs/design/`, `docs/mission-center/`.
- Upstream files change only through **approved hook lines**, each listed in
  `docs/fleet/HOOKS.md` with its reason (for example one `mod fleet;` line, or
  a sidebar slot in the window's Blueprint file). A new hook needs Marc's OK.
- Rust can't reopen a type from another file the way Crystal can, so wrap
  instead: a fleet type that holds the upstream widget, a trait implemented in
  fleet code, or a new module the one hook line pulls in.
- A branch that changed upstream lines beyond an approved hook is refactored
  back into fleet files before review. The refactor stage may delete the
  branch's own additions from upstream files (that shrinks the upstream diff);
  upstream's original lines stay untouched.
- **magpie** (`subprojects/magpie`, its own GitLab repo) reads Linux `/proc`
  and `/sys`, but already splits `platform` from `platform-linux`. macOS and
  Windows collectors go in fleet-owned crates that implement magpie's
  platform traits, not inside the submodule.

## TDD — always

- Write the test **first**, watch it fail, then implement until green. Bug
  fixes: a regression test first, then the fix, in the same commit.
- Write a broad set of failing tests before any fix code: the repro plus its
  variants and negative controls. Put the red count and the key failing lines
  in the commit message; `/private/tmp` paths are not evidence on their own.
- Every feature test asserts the **complete result** as an exact set (every
  node, metric, GPU tag, action), so a missing item fails and so does an extra
  one. Include a "nothing else" control: a same-named container on another
  host, a stopped container, an idle cron job, a machine with no GPU.
- Collector tests run against **recorded snapshots** of real machines (see
  `CLAUDE.local.md`), not only hand-made fixtures. Expected values come from
  an independent source where possible: `docker stats`, `nvidia-smi`,
  `ps`/`top`, Task Manager counters, `powermetrics`.

## Git & GitHub discipline

- **Atomic commits, as you go:** one logical change per commit, together with
  its test. Each commit builds on its own.
- **Issues via `gh`:** read the backlog first (`gh issue list`), file an issue
  for every bug or gap found (`gh issue create`, after a duplicate search),
  and reference it (`Fixes #N`). Every issue carries exactly one label:
  `problem` or `feature`.
- **Finish before starting:** before new feature work, sweep open issues,
  check their acceptance criteria, close what's done with evidence, and finish
  what's nearly done.
- **No CI runner:** every commit subject ends with `[skip ci]`. All gates run
  locally. Never trigger a workflow.
- Land verified work as commits promptly. Working-tree-only changes get lost
  when parallel sessions commit.

## Safety: real machines and actions

This repo names machines and projects by neutral placeholders (`nas`,
`win-desktop`, `win-laptop`, `shop-*`, `shop-prod`). The real names are in the
untracked `CLAUDE.local.md`, and every rule below applies to the real ones.
Never write real machine, project or company names, IPs, paths or personal
emails into this repo, its commit messages, issues or PRs.

- Agents and tests **only read** from real machines (Marc's Mac, nas
  and its Unraid VMs, win-desktop, win-laptop). Never install, start, stop
  or kill anything on them, and never run a Fleet action against them, without
  Marc. Every action test runs only against the `fleet-lab` VM.
- **Protected objects:** never touch any `shop-*` Compose project,
  container or volume, above all `shop-prod` and its
  `backup volumes` volumes, which hold production dumps and backups.
  Fleet's action layer must treat them as protected (typed confirmation), and
  a test proves it.
- Never run `docker system|volume|container prune` or `image prune -a`. Remove
  only containers and images you created, by name, ID or the label
  `fleet.dev=1`.

## Verification targets

- **macOS arm64** (this MacBook Pro): build with Homebrew GTK4/libadwaita, run
  the app with an isolated config and data dir under `/private/tmp/fleet-*`,
  launched with `open -g` so it never takes focus, and moved to the yabai
  Space `fleet-tests`. Never use Marc's own Fleet config.
- **Linux x64 and arm64:** the upstream Flatpak build, run in `fleet-lab`.
- **Windows x64:** the agent only, read-only against win-desktop and
  win-laptop.
- **Zero errors:** using Fleet produces no error toasts or dialogs; an
  unreachable machine shows as offline, not as an error.
