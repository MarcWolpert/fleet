<div align="center">

# Fleet

**Every machine you manage, in one tree, and where each one's usage goes.**

[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg)](COPYING)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)](#quick-start)
[![Based on Mission Center](https://img.shields.io/badge/based%20on-Mission%20Center-3584e4)](https://gitlab.com/mission-center-devs/mission-center)

[Features](#features) · [Quick start](#quick-start) · [Configuration](#configuration) · [How it works](#how-it-works) · [Roadmap](#roadmap) · [Building from source](#building-from-source) · [Contributing](#contributing)

</div>

---

Fleet is a task manager for all your machines at once: laptops, servers, VMs,
Compose projects, containers and the cron jobs inside them. It's a fork of
[Mission Center](https://gitlab.com/mission-center-devs/mission-center), which
shows one Linux machine; Fleet shows the whole fleet as a tree:

```
home-server (Unraid)
├─ Base system                      the OS, daemons, apps
│  └─ Cron jobs                     crontab, systemd timers, …
├─ Docker Compose
│  └─ photos: server, ml, redis, db
├─ Containers: media, backup, …
└─ VMs
   └─ app-vm                        a machine again, all the way down
```

## Features

**Fleet Live** is the version you can use today: a small read-only collector
plus an app window.

| | Feature |
|---|---|
| ✅ | Machine tree: Base system, Docker Compose (project → service), containers, VMs, recursively |
| ✅ | Where usage goes: CPU, memory, GPU, disk I/O and network split by type, as a share of capacity or of what's in use |
| ✅ | Which GPU: per-GPU rows, "what runs on which GPU", and `GPU0`/`GPU1` tags on every workload |
| ✅ | Each GPU, like Task Manager: per GPU a group of live tiles for its engines (3D, compute, copy, video encode/decode), VRAM and shared memory, temperature, power, clocks and fan, from NVIDIA, AMD, Intel and Apple GPUs on Linux, Windows and macOS |
| ✅ | Scheduled jobs under what runs them: crontab, systemd timers, launchd, Windows Scheduled Tasks, with usage while they run |
| ✅ | Details: a sortable, filterable process list for any node, groupable by CPU group (CCD, P-cores, E-cores), owner, user or status |
| ✅ | Logical processors: one live graph per CPU, grouped by CCD, P/E cores or Apple core clusters |
| ✅ | Network tree: tailnet → machines → interfaces and bridges → VMs and containers, with traffic on each |
| ✅ | Pinned spaces: pin any machine, VM, project, container or group from the tree; **All machines** is always there; **Pins only** shows just your pins, with their own all-up view |
| ✅ | Groups in the trees: drag a box over items at the same level (or drag a row by its handle). A group is named and coloured by what's in it: a **fleet** of machines, a **flotilla** of VMs, a **division** of containers, a **section** of cron jobs, a **squadron** of Docker Compose, a **task force** when mixed; each kind has its own colour from the theme. Click a group's name to see its own all-up view (a fleet gets All machines for just its machines), or its chevron to fold it to one line and back, as it was; right-click to rename, pin or disband; pin any group as a space from **+**; Pins only keeps its own; click empty space for the all-up view |
| ✅ | Offline machines explain why in plain language, with the steps to fix it and Retry; reconnecting machines keep their last reading |
| ✅ | Settings: add and edit machines, test a connection, pick the terminal app and refresh rate |
| ✅ | **+ Add a machine** at the bottom of the tree: how to get a machine ready for SSH (keys, python3 on Linux, OpenSSH on Windows, Tailscale names), then test and add it in one step |
| ✅ | Open terminal: ssh to any machine, or a shell inside any container, in your preferred terminal |
| ✅ | Pick processors, a CCD or a P/E-core group, or a GPU, and see just those, with what runs on them |
| ✅ | Dock the Details process list beside the overview (drag the Details pill to the right) |
| ✅ | Details columns: right-click a column header to hide, move or add columns, a layout per detail type |
| ✅ | Themes: Fleet's own, Monokai Dimmed and 20 more built in (Dracula, Nord, Solarized, Gruvbox, Tokyo Night, Catppuccin, GitHub, …), or **Import theme** from any VS Code colour theme |
| ✅ | Keyboard: ⌘K goes to any machine, container, job, command or theme; ⌘F finds in the panel you're in; ⌘[ ⌘] back and forward; ⌘1–9 spaces, ⌃⇥ cycles them, ⌘N a new space, ⌥1–5 metrics, arrows in the tree, ⌘+/⌘− text size; `?` lists them all |
| ✅ | Docker Desktop on a Mac: its containers are listed directly and its Linux VM is folded into Base system (never counted twice); Details lists each container's processes from `docker top`, with the VM's PID tagged **VM** |
| ✅ | Details drop-down: click a process to see what it mostly waits on (CPU, disk, memory, GPU, locks, network…), its cache misses, limits, sockets, files and threads; the list holds still while it's open |
| ✅ | Connections: the dot on a machine's row (or its right-click menu) turns its SSH connection off and on. **Auto** beside + Add a machine picks which machines Fleet connects to when it starts: All, None, or a set you save (*Save what's connected now as a set…*), so a start at login opens no session and asks for no key you didn't want. Kept in `~/.config/fleet/connect.json` |
| ✅ | Machine tiles show the OS at a glance: a strip in the OS colour (Linux amber, Windows blue, macOS in the theme's ink) with a penguin, four panes or an apple, beside the machine's kind icon; in the tree, beside its line icon. Tiles take their colours from the theme |
| ✅ | macOS app and Linux package, with the Fleet icon |
| ✅ | Right-click anything (a process, a tree row, a CPU, CCD, GPU, disk or interface tile, a space) for what fits it: details, show it in the tree, pin, open a terminal, copy its PID, name, command line or SSH destination; ⇧F10 does the same from the keyboard |
| ⬜ | Native app (the Mission Center fork) on macOS, Linux and Windows |
| ⬜ | Actions (kill, stop, restart, run a job now), each confirmed and logged |

## Quick start

Fleet needs **Python 3.11+** on the computer you run it on, and SSH access to
the machines you want to see. Nothing is installed on those machines.

<details>
<summary><b>macOS</b>: Fleet.app</summary>

```bash
git clone https://github.com/MarcWolpert/fleet.git && cd fleet
live/packaging/macos/build_macos.sh          # → live/dist/Fleet.app (Apple silicon + Intel)
ditto live/dist/Fleet.app ~/Applications/Fleet.app && open ~/Applications/Fleet.app
```

Fleet.app is a native window with its own Dock icon. It starts the collector
itself and stops it when you quit; its log is `~/Library/Logs/Fleet.log`.

</details>

<details>
<summary><b>Linux</b>: menu entry and <code>fleet</code> command</summary>

```bash
git clone https://github.com/MarcWolpert/fleet.git && cd fleet
live/packaging/linux/build_linux.sh          # → live/dist/fleet-<version>-linux.tar.gz
tar -xzf live/dist/fleet-*-linux.tar.gz && fleet-*-linux/install.sh
fleet                                        # or open Fleet from your app menu
```

The window is Chrome, Chromium or Edge in app mode when one is installed,
otherwise your default browser. `uninstall.sh` removes it again.

</details>

<details>
<summary><b>Windows</b>, or anywhere without installing</summary>

```powershell
git clone https://github.com/MarcWolpert/fleet.git
cd fleet\live
.\fleet-live.cmd        # ./fleet-live on macOS and Linux
```

</details>

The first run writes a starter `~/.config/fleet/machines.toml` with just this
computer. Add your machines from **Settings** in the app (or edit the file).

## Configuration

`~/.config/fleet/machines.toml`, one `[[machine]]` per machine:

```toml
interval = 3                      # seconds between readings

[[machine]]
id = "this"
name = "this computer"
kind = "local"
tile = "laptop"

[[machine]]
id = "nas"
name = "my-unraid-box"
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
id = "gaming-pc"
name = "gaming-pc"
ssh = "me@gaming-pc"
os = "windows"
tile = "desktop"
```

| Key | Meaning |
|---|---|
| `kind = "local"` | the computer running Fleet Live (macOS, Linux or Windows) |
| `ssh` | how to reach it; uses your `~/.ssh/config`, keys and Tailscale as they are |
| `os` | `linux` (the host needs `python3`), `windows` (OpenSSH + PowerShell) or `macos` (Remote Login on, and `python3` from the Command Line Tools: `xcode-select --install`) |
| `vm_on`, `domain` | this machine is a VM on another one; `domain` is its libvirt name when it differs |
| `tile` | icon: `laptop`, `desktop`, `terminal`, `server`, `globe`, `vm` |

Fleet keeps what you arrange in the app beside it, so it survives restarts:
`pins.json` (pinned spaces), `tilepins.json` (pinned tiles and CPU groups) and
`ui.json` (Details column layouts, the theme, imported themes, tree groups).

## Keyboard shortcuts

⌘ on a Mac, Ctrl elsewhere. Press `?` in the app for the full list.

| Keys | Does |
|---|---|
| ⌘K | Go to anything: machines, VMs, projects, containers, jobs, groups (by name or kind: type "squadron"), commands, themes; the pin on a result (or ⇧Enter) pins it |
| ⌘F or `/` | Find in the panel you're in: filter the tree, find on the page, or filter Details |
| ⌘[ ⌘] | Back, forward (also the ‹ › buttons and the mouse's side buttons) |
| ⌘D, ⌘⇧D | Details on and off; dock it beside the overview |
| ⌥1 … ⌥5 | CPU, Memory, GPU, Disk I/O, Network |
| ⌘1 … ⌘9, ⌘⇧[ ⌘⇧] | Go to a space; previous or next space |
| ⌃⇥, ⌃⇧⇥ | Cycle through the spaces, or the other way, round and round (Ctrl+Tab on Linux and Windows too) |
| ↑ ↓ ← → | Move through the tree; collapse, expand, go to the parent |
| ⌘N | New space: opens the dialog to pick a grouping to pin (same as the + in the space bar) |
| P | Pin or unpin the selection as a space |
| ⌘T | Open a terminal on the selection |
| ⌘+ ⌘− ⌘0 | Text bigger, smaller, actual size |
| ⌘, | Settings |

## Themes

Settings → Appearance has Fleet's own theme (the default), Monokai Dimmed and
20 more. Their chart colours were re-tuned where needed so the four kinds of
workload stay distinct for colour-blind readers. **Import theme** reads a VS Code
colour theme (`.json`, comments allowed) or a Fleet theme:

```json
{"name": "Paper", "type": "light", "colors": {"chrome": "#eeeeee", "ink": "#222222", "accent": "#0055cc"}}
```

Any token in `live/web/themes.js` (`THEME_KEYS`) can be set; the rest are derived.

## How it works

- Each machine gets one SSH session that runs a small collector streamed over
  stdin (`collect_linux.py` with `python3 -`, `collect_windows.ps1` with a
  short `powershell -EncodedCommand` that reads it, so it also works when the
  Windows OpenSSH server keeps cmd.exe as its shell). It loops, sending one reading every few
  seconds, and ends when the connection closes. It only reads `/proc`, `/sys`,
  performance counters and listing commands (`docker ps`, `virsh list`,
  `crontab -l`, `systemctl list-timers`, `nvidia-smi`, …).
- Compose projects come from Docker's `com.docker.compose.*` labels;
  container usage comes from each container's cgroup; VMs are matched by their
  QEMU process or the WSL utility VM.
- A VM Fleet also reads over SSH (`vm_on`) is counted twice over. As part of
  its host it costs what the host gives it: its QEMU process's CPU, resident
  memory, disk and network, which is what `htop` and the hypervisor's own UI
  show. Its own page shows what the guest reports.
- A scheduled job's usage is a breakdown of what runs it, never added on top.
- Everything stays on your computer: the server listens on `127.0.0.1` only.

## Roadmap

1. **Fleet Live** (now): the read-only web app above.
2. **Native app:** Mission Center's GTK4/libadwaita UI on macOS, Linux and
   Windows, with Fleet's tree and spaces, and collectors for macOS and Windows
   alongside Mission Center's Linux daemon.
3. **Actions:** kill, stop, restart and run-now everywhere, each confirmed and
   audit-logged, with protected objects that need a typed confirmation.

## Building from source

Fleet Live is plain Python and HTML; there is nothing to build. The native app
currently builds exactly like Mission Center on Linux: see [BUILD.md](BUILD.md).
Mission Center's own README is kept at
[docs/mission-center/README.md](docs/mission-center/README.md).

## Contributing

How work is run here (tests first, small stacked PRs, extending upstream
without editing it) is in [CLAUDE.md](CLAUDE.md) and [AGENTS.md](AGENTS.md);
the few upstream lines Fleet changes are listed in
[docs/fleet/HOOKS.md](docs/fleet/HOOKS.md). Fleet is GPL-3.0-or-later, like
Mission Center.
