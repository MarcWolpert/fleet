# Changelog

Fleet's releases. Each is tagged `fleet-v<version>` (Mission Center's own tags in this fork are `v<version>`).
The section for a version becomes its GitHub release notes; see docs/fleet/RELEASING.md.

## Fleet 0.0.1

The first release of Fleet Live: every machine you manage, live, in one tree. For macOS (Fleet.app, Apple
silicon and Intel) and Linux (a package with a menu entry and a `fleet` command). It reads Linux and Windows
machines over SSH, read-only, and installs nothing on them.

- **The machine tree:** machines, their base system, Docker Compose projects and services, containers, VMs
  (machines again, all the way down) and scheduled jobs, with where each machine's CPU, memory, GPU, disk and
  network go by type. A network tree: tailnet, machines, interfaces and bridges, VMs and containers.
- **Spaces:** pin any machine, VM, project, container or group to the space bar; Pins only.
- **Groups:** draw a box over siblings, or drag a row by its handle, to group them: fleets, flotillas,
  divisions, sections, squadrons and task forces, each with its own icon and theme colour; pin, fold, rename.
- **Details:** a sortable, filterable process list, grouped by CPU group, owner, user or status, with columns
  you arrange per type; dock it beside the overview. Click a process for what it mostly waits on, its cache
  misses over a lookback, and its CPU, memory, disk, network, files and threads.
- **Logical processors** by CCD or P/E cores; **Each GPU** with live tiles per engine, memory and sensor
  (NVIDIA, AMD, Intel, Apple); **Each disk** and **Each interface**. Pick any of them to filter Details.
- **Themes:** Fleet's own, Monokai Dimmed and 20 more, or import a VS Code colour theme.
- **Keyboard:** ⌘K go to anything, ⌘F find in the panel you're in, ⌘[ ⌘] back and forward, and more (press `?`).
- **Right-click menus** that fit what you clicked; **Open terminal** on a machine or container; offline machines
  say why, with the steps to fix it.
