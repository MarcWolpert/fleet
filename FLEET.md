# Fleet

A multi-platform task manager for every machine you manage. Fleet is a fork of
[Mission Center](https://gitlab.com/mission-center-devs/mission-center) and
keeps its GPL-3.0-or-later license.

Mission Center shows one machine. Fleet shows all of them as a tree, and how
much of each machine goes to what:

```
this computer (M5 Max MBP)
├─ Base system
│  └─ Cron jobs: restic backup, embeddings reindex, …
├─ Docker Compose
│  └─ shop: backend, frontend, office, postgres
├─ Containers: jade-lsp, crystal-shards
└─ VMs
   ├─ win11-arm            (a machine: Base system, Scheduled tasks, …)
   └─ ubuntu-arm64-lab     (a machine: Base system, Compose, Containers, …)
```

- **Spaces:** one per machine across the top, like herdr's tabs, plus an
  "All machines" overview of where the whole fleet's usage goes by type.
- **Usage by type:** CPU, memory, each GPU, disk and network, split into Base
  system, Compose, containers and VMs, as a share of capacity or of what's in
  use.
- **Which GPU:** every workload names the GPU it runs on.
- **Cron jobs and scheduled tasks** under whatever runs them, with their own
  usage while they run.
- **Actions** on any machine, container or job, each confirmed and logged.

Machines report through a small agent reached over SSH, so no machine opens a
new port. The UI runs on macOS and Linux; Windows machines run the agent only.

Design mockup: `docs/design/fleet-mockup.html` (open it in a browser; the
numbers are sample data). How the work is run: `CLAUDE.md`. Upstream changes
Fleet relies on: `docs/fleet/HOOKS.md`.
