<div align="center">

# Fleet

**Every machine you manage, live, in one tree, and where each one's usage goes.**

[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg)](COPYING)
[![Platforms](https://img.shields.io/badge/runs%20on-macOS%20%7C%20Linux-lightgrey)](#install)
[![Reads](https://img.shields.io/badge/reads-Linux%20%7C%20Windows%20%7C%20macOS-lightgrey)](#add-your-machines)
[![Based on Mission Center](https://img.shields.io/badge/based%20on-Mission%20Center-3584e4)](https://gitlab.com/mission-center-devs/mission-center)

[What it shows](#what-it-shows) · [Install](#install) · [Add your machines](#add-your-machines) · [Configuration](#configuration) · [Keyboard](#keyboard-shortcuts) · [How it works](#how-it-works) · [Roadmap](#roadmap) · [Contributing](#contributing)

</div>

---

Fleet is a task manager for all your machines at once: laptops, servers, VMs, Docker Compose projects,
containers and the scheduled jobs inside them. It's a fork of
[Mission Center](https://gitlab.com/mission-center-devs/mission-center), which shows one Linux machine;
Fleet shows the whole fleet as a tree, live:

```
home-server (Linux)
├─ Base system                      the OS, daemons, apps
│  └─ Cron jobs                     crontab, systemd timers, …
├─ Docker Compose
│  └─ photos: server, ml, redis, db
├─ Containers: media, backup, …
└─ VMs
   └─ app-vm                        a machine again, all the way down
```

It reads each machine over SSH, **read-only**, and installs nothing on it. Everything stays on your
computer: Fleet listens on `127.0.0.1` only.

## What it shows

**The tree.** Machines, their base system, Docker Compose projects and services, containers, VMs (machines
again, all the way down) and scheduled jobs (crontab, systemd timers, launchd, Windows Scheduled Tasks),
each with a live sparkline. Every machine's tile shows its OS at a glance. A second tree shows the
network: tailnet, machines, interfaces and bridges, VMs and containers, with traffic on each.

**Where the usage goes.** CPU, memory, GPU, disk I/O and network for any machine, group or all of them,
split by Base system, Compose, containers and VMs, as a share of capacity or of what's in use.

**Hardware, up close.** Logical processors one graph each, grouped by CCD, P/E cores or Apple core
clusters. Each GPU as a group of live tiles, like Task Manager: 3D, compute, copy, video encode and decode,
VRAM and shared memory, temperature, power, clocks and fan, for NVIDIA, AMD, Intel and Apple GPUs. Each
disk and each interface. Pick any of them to see just what runs there.

**Details.** A sortable, filterable process list for any node, grouped by CPU group, owner, user or status,
with the columns you choose, docked beside the overview if you like. Click a process for what it mostly
waits on (CPU, disk, memory, GPU, locks, network), its cache misses over a lookback, limits, sockets, files
and threads; the list holds still while it's open.

**Containers and VMs, counted once.** A VM on its host costs what the host gives it (its QEMU process, as
`htop` shows it); its own page shows what the guest reports, without a ballooned guest's balloon. On a Mac,
Docker Desktop's VM folds into Base system, and Details lists each container's processes from inside it.
Look inside one with a throwaway helper container or by running Fleet's inspector in its container.

**Machines and connections.** **+ Add a machine** walks you through getting a Linux, Windows or Mac machine
ready for SSH and tests it. Offline machines say why, in plain language, with the steps to fix it. The dot
on a machine's row turns its connection off and on; **Auto** picks which machines Fleet connects to when
it starts (none until you choose, all, or a set you tick), so a start at login asks for no key you didn't
want. **Open terminal** sshes to a machine, or opens a shell in a container, in the terminal you pick.

**Spaces and groups.** Pin any machine, VM, project, container or group to the space bar. Drag a box over
items at the same level (or drag a row by its handle) to group them: a **fleet** of machines, a
**flotilla** of VMs, a **division** of containers, a **section** of cron jobs, a **squadron** of Compose
projects, a **task force** when mixed, each with its own colour and icon, its own all-up view, folding and
pinning.

**Yours to read.** 22 themes (Fleet's own, Monokai Dimmed, Dracula, Nord, Solarized, Catppuccin, …) or
import any VS Code colour theme. A colour-blind mode for protanopia, deuteranopia, tritanopia or
monochromacy (colours checked to stay apart for each; statuses also change shape), and higher contrast.
Right-click anything for what fits it; a keyboard shortcut for everything.

## Install

Download Fleet from [Releases](https://github.com/MarcWolpert/fleet/releases/latest):

| | |
|---|---|
| **macOS** (Apple silicon) | `Fleet-<version>-macos-arm64.zip`: unzip, drag **Fleet.app** to Applications, open it. It needs Python 3.11 or newer on the Mac (`brew install python`). |
| **Linux** (x64 or arm64) | `fleet-<version>-linux-x64.tar.gz` or `-linux-arm64.tar.gz`: `tar -xzf fleet-*.tar.gz && fleet-*/install.sh`, then open Fleet from your app menu or run `fleet`. It needs Python 3.11+; the window is Chrome, Chromium or Edge in app mode when one is installed, otherwise your browser. `uninstall.sh` removes it. |

Or run it from source, anywhere with Python 3.11+:

```bash
git clone https://github.com/MarcWolpert/fleet.git && cd fleet/live
./fleet-live          # fleet-live.cmd on Windows; then open http://127.0.0.1:4518/
```

The first run writes `~/.config/fleet/machines.toml` with just this computer. Add the rest from the app.

## Add your machines

Use **+ Add a machine** at the bottom of the tree. It tests the connection before it adds anything. What
each machine needs:

| | |
|---|---|
| **Any** | You can `ssh` to it without a password (`ssh-copy-id user@host` if it asks). A name from `~/.ssh/config` or a Tailscale name works too. |
| **Linux** | `python3` (most have it). |
| **Windows** | OpenSSH Server (Settings › System › Optional features) and your key in `C:\Users\you\.ssh\authorized_keys`, or for an administrator account in `C:\ProgramData\ssh\administrators_authorized_keys`. |
| **macOS** | Remote Login on (System Settings › General › Sharing) and `python3` from the Command Line Tools: `xcode-select --install`. |
| **A VM** | Add it like any machine, then set **Runs on** in Settings to nest it under its host. |

## Configuration

Machines live in `~/.config/fleet/machines.toml`; **Settings** edits it for you:

```toml
interval = 3                      # seconds between readings

[[machine]]
id = "this"
name = "this computer"
kind = "local"
tile = "laptop"

[[machine]]
id = "nas"
name = "home-server"
ssh = "root@nas.example.ts.net"   # any ssh destination: a Host alias, user@host, a Tailscale name
os = "linux"
tile = "globe"

[[machine]]
id = "app-vm"
name = "app-vm"
ssh = "app-vm"
os = "linux"
vm_on = "nas"                     # nests under that host's VMs

[[machine]]
id = "studio"
name = "studio"
ssh = "me@studio.local"
os = "macos"
tile = "desktop"
```

| Key | Meaning |
|---|---|
| `kind = "local"` | the computer running Fleet |
| `ssh` | how to reach it; uses your `~/.ssh/config`, keys and Tailscale as they are |
| `os` | `linux`, `windows` or `macos` (see [Add your machines](#add-your-machines)) |
| `vm_on`, `domain` | this machine is a VM on another one; `domain` is its libvirt name when it differs |
| `tile` | its icon: `laptop`, `desktop`, `terminal`, `server`, `globe`, `vm` |

What you arrange in the app is kept beside it, so it survives restarts: `ui.json` (theme, colour vision,
contrast, Details columns, tree groups), `pins.json` (spaces), `tilepins.json` (pinned tiles and CPU groups)
and `connect.json` (which machines connect when Fleet starts, and your saved sets).

## Keyboard shortcuts

⌘ on a Mac, Ctrl elsewhere. Press `?` in the app for the list.

| Keys | Does |
|---|---|
| ⌘K | Go to anything: machines, VMs, projects, containers, jobs, groups (by name or kind), commands, themes |
| ⌘F or `/` | Find in the panel you're in: filter the tree, find on the page, or filter Details |
| ⌘[ ⌘] | Back, forward (also the ‹ › buttons and the mouse's side buttons) |
| ⌘D, ⌘⇧D | Details on and off; dock it beside the overview |
| ⌥1 … ⌥5 | CPU, Memory, GPU, Disk I/O, Network |
| ⌘1 … ⌘9 | Go to a space (⌘1 is All machines) |
| ⌃⇥, ⌃⇧⇥ (or ⌘⇧] ⌘⇧[) | Next or previous space, round and round |
| ⌘N | New space: pick a grouping to pin |
| P | Pin or unpin the selection as a space |
| ↑ ↓ ← → | Move through the tree; collapse, expand, go to the parent |
| ⌘T | Open a terminal on the selection |
| ⌘+ ⌘− ⌘0 | Bigger, smaller, actual size (the zoom shows by Settings when it isn't 100%) |
| ⌘, | Settings |
| ⇧F10 | The right-click menu, from the keyboard |

## How it works

- **One SSH session per machine**, running a small collector sent over stdin (`collect_linux.py` with
  `python3 -`; `collect_windows.ps1` read by a short `powershell -EncodedCommand`, so it also works when
  Windows OpenSSH keeps cmd.exe as its shell; for a Mac, the same reader Fleet uses for the Mac it runs on). It sends a reading every few seconds and ends when the connection closes.
  It only reads: `/proc`, `/sys`, performance counters and listing commands (`docker ps`, `virsh list`,
  `crontab -l`, `systemctl list-timers`, `nvidia-smi`, …).
- **Compose projects** come from Docker's `com.docker.compose.*` labels; a container's usage from its
  cgroup; **VMs** are matched by their QEMU process or WSL's utility VM.
- **A VM Fleet also reads over SSH** (`vm_on`) is counted once on its host, as what the host gives it, and
  on its own page as what the guest reports.
- **A scheduled job's usage** is a breakdown of what runs it, never added on top.
- **Looking inside a process** (the Details drop-down) runs a one-shot inspector the same way, for a couple
  of seconds. On a Mac with Docker Desktop, you choose a helper container or the container itself.

## Roadmap

1. **Fleet Live** (now): the read-only app above, for macOS and Linux.
2. **Native app:** Mission Center's GTK4/libadwaita UI on macOS, Linux and Windows, with Fleet's tree and
   spaces.
3. **Actions:** kill, stop, restart and run-now everywhere, each confirmed and logged.

## Building from source

Fleet Live is plain Python and HTML; there is nothing to compile. `live/packaging/macos/build_macos.sh`
builds Fleet.app, `live/packaging/linux/build_linux.sh` the Linux package, and `live/tests/run.sh` runs
every test (Python's unittest and a dependency-free browser harness). Releases are cut as in
[docs/fleet/RELEASING.md](docs/fleet/RELEASING.md). The native app builds exactly like Mission Center on
Linux: see [BUILD.md](BUILD.md); Mission Center's own README is at
[docs/mission-center/README.md](docs/mission-center/README.md).

## Contributing

How work is run here (an issue per change, tests first, small stacked PRs, extending upstream without
editing it) is in [CLAUDE.md](CLAUDE.md) and [AGENTS.md](AGENTS.md); the few upstream lines Fleet changes
are listed in [docs/fleet/HOOKS.md](docs/fleet/HOOKS.md). Fleet is GPL-3.0-or-later, like Mission Center.
