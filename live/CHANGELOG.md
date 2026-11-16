# Changelog

Fleet's releases. Each is tagged `fleet-v<version>` (Mission Center's own tags in this fork are `v<version>`).
The section for a version becomes its GitHub release notes; see docs/fleet/RELEASING.md.

## Fleet 0.0.1-hotfix.1

Fixes and a few small additions since 0.0.1. For macOS (Fleet.app, Apple silicon) and Linux (x64 and arm64
packages, and a Flatpak), each carrying what it runs.

- **Inline terminals in Fleet.app** draw in the right font, spaced right, with Powerline and Nerd Font symbols:
  0.0.1 drew some in Times with the letters far apart. Choose your own font in Settings > Terminal.
- **The tree panel resizes** from its right edge (double-click for the default); dragged narrow it drops its
  graphs so the names get the room, and a toggle at the bottom turns the graphs off and on.
- **Keys:** t shows or hides the terminals, r goes into the one you're on (when you aren't typing in a field).
- **Escape closes any dialog**, wherever focus is.

## Fleet 0.0.1

The first release of Fleet Live: every machine you manage, live, in one tree. For macOS (Fleet.app, Apple
silicon) and Linux (x64 and arm64 packages, and a Flatpak). Each package carries what it runs, its own Python,
ttyd and tmux, so there's nothing else to install; it reads Linux, Windows and Mac machines over SSH,
read-only, and installs nothing on them.

**Installing:** each download has a README and an install script. Fleet.app isn't notarized by Apple yet: the
first time, its install script (or right-click > Open) gets it past macOS's check. The Linux packages run on
any current distribution (checked on Arch, Ubuntu 22.04 and 24.04, and Fedora); the Flatpak suits Bazzite,
Pop!_OS and Fedora.

- **The machine tree:** machines, their base system, Docker Compose projects and services, containers, VMs
  (machines again, all the way down) and scheduled jobs, with where each machine's CPU, memory, GPU, disk and
  network go by type. A network tree: tailnet, machines, interfaces and bridges, VMs and containers.
- **Spaces:** pin any machine, VM, project, container or group to the space bar (+ or ⌘N); ⌃⇥ cycles them;
  Pins only.
- **Machines:** + Add a machine walks you through getting one ready for SSH (Linux, Windows or macOS) and
  tests it. The dot on a machine's row turns its connection off and on, and **Auto** picks which machines
  Fleet connects to when it starts (All, None or a set you save), so a start at login asks for no key you
  didn't want.
- **VMs and Docker counted once:** a VM on its host costs what the host gives it (its QEMU process, as `htop`
  shows it), its own page what the guest reports, a ballooned guest without its balloon; Docker Desktop's VM
  on a Mac folds into Base system, and Details lists each container's processes from inside it.
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
- **Terminals below the page:** a terminal for each connected computer (and any machine or container),
  split below the page, each with its own text size; split, kill, rename and drag them like VS Code's, save
  the set as a template, and they keep running through a reload, Fleet restarting or quitting, and a dropped
  connection (tmux holds them). Powerline and Nerd Font symbols draw even without a Nerd Font installed.
- **Tidying up:** fold the whole tree (~, F~), the overview's cards and CPU groups; an Each CCD view; Details
  columns resize and reorder by dragging, and its groups hold still when you want them to.
- **Accessible:** a colour-blind mode (protanopia, deuteranopia, tritanopia, monochromacy), higher contrast,
  and the Tutorial pill for terms and keys; the Fleet logo at the top right opens ⌘K.
