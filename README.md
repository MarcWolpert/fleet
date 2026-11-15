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
| ✅ | Scheduled jobs under what runs them: crontab, systemd timers, launchd, Windows Scheduled Tasks, with usage while they run |
| ✅ | Details: a sortable, filterable process list for any node, groupable by CPU group (CCD, P-cores, E-cores), owner, user or status |
| ✅ | Logical processors: one live graph per CPU, grouped by CCD, P/E cores or Apple core clusters |
| ✅ | Network tree: tailnet → machines → interfaces and bridges → VMs and containers, with traffic on each |
| ✅ | Pinned spaces: pin any machine, VM, project or container from the tree; **All machines** is always there |
| ✅ | Offline machines explain why in plain language, with the steps to fix it and Retry; reconnecting machines keep their last reading |
| ✅ | Settings: add and edit machines, test a connection, pick the terminal app and refresh rate |
| ✅ | Open terminal: ssh to any machine, or a shell inside any container, in your preferred terminal |
| ✅ | Pick processors, a CCD or a P/E-core group, or a GPU, and see just those, with what runs on them |
| ✅ | Dock the Details process list beside the overview (drag the Details pill to the right) |
| ✅ | macOS app and Linux package, with the Fleet icon |
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
| `os` | `linux` (the host needs `python3`) or `windows` (OpenSSH + PowerShell) |
| `vm_on`, `domain` | this machine is a VM on another one; `domain` is its libvirt name when it differs |
| `tile` | icon: `laptop`, `desktop`, `terminal`, `server`, `globe`, `vm` |

Pinned spaces live in `~/.config/fleet/pins.json` and are managed from the app.

## How it works

- Each machine gets one SSH session that runs a small collector streamed over
  stdin (`collect_linux.py` with `python3 -`, `collect_windows.ps1` with
  `powershell -EncodedCommand`). It loops, sending one reading every few
  seconds, and ends when the connection closes. It only reads `/proc`, `/sys`,
  performance counters and listing commands (`docker ps`, `virsh list`,
  `crontab -l`, `systemctl list-timers`, `nvidia-smi`, …).
- Compose projects come from Docker's `com.docker.compose.*` labels;
  container usage comes from each container's cgroup; VMs are matched by their
  QEMU process or the WSL utility VM.
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
