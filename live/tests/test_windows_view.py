# SPDX-License-Identifier: GPL-3.0-or-later
"""What derive_windows makes of collect_windows.ps1's readings: containers from docker ps and docker stats, the
WSL utility VM net of Docker Desktop's containers, and readings that carry values the collector didn't expect.
Readings are hand-made in the collector's shape; no machine is read.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import fleet_live  # noqa: E402

GB = 2 ** 30
WEB, DB = "a1b2c3d4e5f60718293a4b5c6d7e8f90", "0f1e2d3c4b5a69788796a5b4c3d2e1f0"


def ps(cid, name, service):
    return json.dumps({"ID": cid, "Names": name, "Image": "nginx:1" if service == "web" else "postgres:16", "Status": "Up 2 hours",
                       "Labels": "com.docker.compose.project=shop,com.docker.compose.service=%s,com.docker.compose.project.config_files=C:\\shop\\compose.yaml" % service,
                       "Networks": "shop_default"})


def stats(cid, name, cpu, mem, block, net):
    return json.dumps({"BlockIO": block, "CPUPerc": cpu, "Container": cid[:12], "ID": cid[:12], "MemPerc": "1.00%", "MemUsage": mem,
                       "Name": name, "NetIO": net, "PIDs": "5"})


UNREADABLE = {"cpu": "--", "mem": "-- / --", "block": "-- / --", "net": "-- / --"}   # docker stats when it can't read a container in time


def reading(t, web, db, vmmem_cpu_secs):
    procs = [[10, 4, "vmmemWSL", vmmem_cpu_secs, 4.0 * GB, 12, -1, ""], [11, 4, "explorer.exe", 1.0, 0.25 * GB, 30, -1, "C:\\Windows\\explorer.exe"]]
    return {"t": t, "ncpu": 4, "lcpus": [{"n": n, "pct": 5.0, "mhz": 3000} for n in range(4)], "topo": [], "gpus": [], "adapters": [],
            "nvidia": [], "videoNames": [], "gproc": [], "procs": procs, "ifs": [], "tasks": [], "mem": [16 * GB, 8 * GB], "diskBps": 0,
            "os": "Windows", "wsl": [{"name": "docker-desktop", "state": "Running", "default": False}, {"name": "Ubuntu", "state": "Stopped", "default": True}],
            "containers": [ps(WEB, "shop-web-1", "web"), ps(DB, "shop-db-1", "db")],
            "dstats": [stats(WEB, "shop-web-1", web["cpu"], web["mem"], web["block"], web["net"]), stats(DB, "shop-db-1", db["cpu"], db["mem"], db["block"], db["net"])]}


def us(view):
    return {c["name"]: [round(x, 6) for x in c["u"]] for c in view["containers"]}


class DockerStatsUnreadable(unittest.TestCase):
    """#160: docker stats prints "--" for a container it couldn't read in time."""

    def setUp(self):
        self.m = fleet_live.Machine({"id": "w", "name": "w", "os": "windows"}, 3)
        self.first = self.m.derive_windows(reading(1000.0, {"cpu": "50.00%", "mem": "512MiB / 15.5GiB", "block": "1MB / 0B", "net": "2MB / 1MB"},
                                                   {"cpu": "10.00%", "mem": "1GiB / 15.5GiB", "block": "4MB / 2MB", "net": "1kB / 1kB"}, 100.0))

    def test_the_reading_is_kept_and_that_container_counts_as_idle(self):
        v = self.m.derive_windows(reading(1003.0, UNREADABLE, {"cpu": "10.00%", "mem": "1GiB / 15.5GiB", "block": "7MB / 2MB", "net": "4kB / 4kB"}, 106.0))
        self.assertEqual(us(v), {"shop-web-1": [0.0, 0.0, 0.0, 0.0, 0.0], "shop-db-1": [0.1, 1.0, 0.0, 1.0, 0.002]})
        self.assertEqual([(x["name"], [round(u, 6) for u in x["u"]], x["running"]) for x in v["vms"]], [("WSL", [1.9, 3.0, 0.0, 0.0, 0.0], True)],
                         "the WSL VM, net of the containers it runs")

    def test_its_io_counters_carry_on_from_its_last_good_reading(self):
        self.m.derive_windows(reading(1003.0, UNREADABLE, {"cpu": "10.00%", "mem": "1GiB / 15.5GiB", "block": "7MB / 2MB", "net": "4kB / 4kB"}, 106.0))
        v = self.m.derive_windows(reading(1006.0, {"cpu": "20.00%", "mem": "512MiB / 15.5GiB", "block": "7MB / 0B", "net": "5MB / 1MB"},
                                          {"cpu": "10.00%", "mem": "1GiB / 15.5GiB", "block": "10MB / 2MB", "net": "4kB / 4kB"}, 112.0))
        # web: 6 MB of block I/O and 3 MB of traffic over the 6 s since its last good reading, not the whole counter at once
        self.assertEqual(us(v), {"shop-web-1": [0.2, 0.5, 0.0, 1.0, 0.5], "shop-db-1": [0.1, 1.0, 0.0, 1.0, 0.0]})

    def test_the_first_reading_control(self):
        self.assertEqual(us(self.first), {"shop-web-1": [0.5, 0.5, 0.0, 0.0, 0.0], "shop-db-1": [0.1, 1.0, 0.0, 0.0, 0.0]})


def api_procs(view, mid="w"):
    """/api/procs for one machine holding `view`."""
    import threading
    m = fleet_live.Machine({"id": mid, "name": mid}, 3)
    m.got(view)   # a reading arrives
    f = fleet_live.Fleet.__new__(fleet_live.Fleet)
    f.machines, f.lock = {mid: m}, threading.Lock()
    f.specs = {mid: {"id": mid, "procs_owner": {"cont": {}, "vm": {}}, "vms": []}}
    return f.api_procs(mid)


class UntrustedProcessRows(unittest.TestCase):
    """#166: what a monitored host prints is data; Details gets Parent PID and Threads only as numbers."""
    HOSTILE = ["<svg onload=alert(1)>", "<img src=x onerror=alert(1)>"]

    def test_a_windows_reading(self):
        r = reading(1000.0, UNREADABLE, UNREADABLE, 100.0)
        r["procs"].append([12, self.HOSTILE[0], "x.exe", 0.1, 1048576, self.HOSTILE[1], 0, "C:\\x"])
        out = api_procs(fleet_live.Machine({"id": "w", "name": "w", "os": "windows"}, 3).derive_windows(r))
        self.assertEqual({p[0]: (p[1], p[11], p[8]) for p in out["procs"]}, {10: ("vmmemWSL", 4, 12), 11: ("explorer.exe", 4, 30), 12: ("x.exe", 0, 0)})

    def test_any_host(self):
        # a derived row: [pid, ppid, comm, user, state, cpu, mem, disk, gpu, threads, cmd, owner, last cpu, gpus, disks, ifs, net]
        row = lambda pid, ppid, threads: [pid, ppid, "sh", "root", "S", 0.0, 0.0, 0.0, 0.0, threads, "/bin/sh", "base", 0, [], [], [], 0.0]
        out = api_procs({"t": 1000.0, "procs": [row(1, 0, 1), row(2, 1, 4.0), row(3, self.HOSTILE[0], self.HOSTILE[1]), row(4, None, [5])]})
        self.assertEqual({p[0]: (p[11], p[8]) for p in out["procs"]}, {1: (0, 1), 2: (1, 4.0), 3: (0, 0), 4: (0, 0)})


MIB = 2 ** 20
L4080, LA2000 = "0x00000000_0x0000c1d2", "0x00000000_0x0000e4f2"
P_E_TOPO = ["0:0:1:0", "1:0:1:0", "2:1:1:0", "3:1:1:0", "4:2:0:0", "5:3:0:0", "6:4:0:0", "7:5:0:0"]   # cpu:core:efficiency class:L3


def desktop(t, step):
    """win-desktop's shape, `step` readings in: a hybrid CPU (4 P-threads, 4 E-cores), an RTX 4080 and an A2000 that
    drives the displays (more VRAM in use, so the counters list it first), Docker Desktop with two Compose containers
    (docker stats can't read the second one in the second reading), one scheduled task, one disk. Like ConvertTo-Json,
    it writes every one-item list as the bare item (tasks, disks, an adapter's addresses, a process's interfaces)."""
    k = step
    return {
        "t": t, "os": "Microsoft Windows 11 Pro", "arch": "AMD64", "cpu_model": "Intel(R) Core(TM) test CPU", "ncpu": 8, "uptime": 86400.0,
        "lcpus": [{"n": n, "pct": pct, "mhz": 3000 + 100 * n} for n, pct in enumerate((50.0, 40.0, 30.0, 20.0, 10.0, 10.0, 0.0, 0.0))],
        "topo": P_E_TOPO if k == 0 else None,   # only the first reading carries the topology
        "mem": [32.0 * GB, 20.0 * GB], "diskBps": 5e6,
        "gpus": [{"luid": LA2000, "util": 10.0, "dedicated": 3000.0 * MIB, "shared": 50.0 * MIB, "eng": {"3D": 10.0}},
                 {"luid": L4080, "util": 25.0, "dedicated": 2048.0 * MIB, "shared": 100.0 * MIB, "eng": {"3D": 1.0, "Compute_0": 25.0}}],
        "adapters": [{"luid": LA2000, "name": "NVIDIA RTX A2000", "vram": 6438256640.0}, {"luid": L4080, "name": "NVIDIA GeForce RTX 4080", "vram": 17171480576.0}],
        "nvidia": ["0, NVIDIA GeForce RTX 4080, 25, 2048, 16376, 10, 55, 120.50, 320.00, 2505, 3105, 11201, 35, 0, 0",
                   "1, NVIDIA RTX A2000, 10, 3000, 6138, 5, 45, 15.20, 70.00, 600, 2100, 6000, 0, 0, 0"],
        "videoNames": ["NVIDIA RTX A2000", "NVIDIA GeForce RTX 4080"],
        "gproc": [[20, L4080, 25.0], [30, LA2000, 10.0]],
        "procs": [[10, 4, "vmmemWSL", 100.0 + 6 * k, 6.0 * GB, 20, -1, ""],
                  [20, 1000, "python.exe", 50.0 + 3 * k, 2.0 * GB, 16, -1, "python train.py"],
                  [30, 4, "dwm.exe", 10.0 + 0.75 * k, 0.25 * GB, 12, -1, "C:\\Windows\\system32\\dwm.exe"]],
        "pnet": {"20": "Ethernet", "30": ["Ethernet", "vEthernet (WSL)"]},
        "ifs": [{"name": "Ethernet", "desc": "Intel(R) Ethernet Controller I226-V", "status": "Up", "speed": "2.5 Gbps", "virtual": False,
                 "rx": 1e9 + 3e6 * k, "tx": 5e8 + 1.5e6 * k, "addrs": "192.168.1.20/24"},
                {"name": "vEthernet (WSL)", "desc": "Hyper-V Virtual Ethernet Adapter", "status": "Up", "speed": "10 Gbps", "virtual": True,
                 "rx": 2e8 + 3e5 * k, "tx": 1e8 + 6e5 * k, "addrs": ["172.20.0.1/20"]},
                {"name": "Wi-Fi", "desc": "Intel(R) Wi-Fi 6E AX211 160MHz", "status": "Disconnected", "speed": "0 bps", "virtual": False,
                 "rx": 0.0, "tx": 0.0, "addrs": {}}],
        "wsl": [{"name": "docker-desktop", "state": "Running", "default": False}, {"name": "Ubuntu", "state": "Running", "default": True}],
        "containers": [ps(WEB, "shop-web-1", "web"), ps(DB, "shop-db-1", "db")],
        "dstats": [stats(WEB, "shop-web-1", "50.00%", "1GiB / 31GiB", "10MB / %gMB" % (5 + 3 * k), "3MB / %gMB" % (3 + 1.5 * k)),
                   stats(DB, "shop-db-1", "5.00%", "2GiB / 31GiB", "1MB / 1MB", "1kB / 1kB") if k == 0 else stats(DB, "shop-db-1", **{"cpu": "--", "mem": "-- / --", "block": "-- / --", "net": "-- / --"})],
        "tasks": {"name": "Backup", "path": "\\Fleet\\", "state": "Ready", "cmd": "C:\\backup.cmd --all", "triggers": "Daily 02:00",
                  "last": "2026-11-14 02:00", "next": "2026-11-16 02:00"},
        "disks": {"name": "Disk 0", "letters": "C: D:", "model": "Samsung SSD 990 PRO 2TB", "size": 2000398934016.0, "rot": False,
                  "read": 2e6, "write": 1e6, "busy": 12.5},
    }


def rounded(x):
    if isinstance(x, float):
        return round(x, 9)
    if isinstance(x, list):
        return [rounded(v) for v in x]
    if isinstance(x, dict):
        return {k: rounded(v) for k, v in x.items()}
    return x


class CompleteView(unittest.TestCase):
    """Everything derive_windows makes of a reading, as one exact view: a missing item fails and so does an extra one."""

    def test_the_second_reading_of_a_desktop(self):
        m = fleet_live.Machine({"id": "win-desktop", "name": "win-desktop", "os": "windows"}, 3)
        m.derive_windows(desktop(1000.0, 0))
        v = m.derive_windows(desktop(1003.0, 1))
        lc = lambda n, pct, core, eff: {"n": n, "pct": pct, "mhz": 3000 + 100 * n, "core": core, "eff": eff, "l3": "0"}
        web = {"id": WEB[:12], "name": "shop-web-1", "image": "nginx:1", "status": "Up 2 hours", "project": "shop", "service": "web",
               "file": "C:\\shop\\compose.yaml", "networks": "shop_default", "u": [0.5, 1.0, 0.0, 1.0, 0.5], "netrx": 0.0, "nettx": 0.5}   # it sent 1.5 MB
        want = {
            "t": 1003.0, "os": "Microsoft Windows 11 Pro", "arch": "AMD64", "cpu_model": "Intel(R) Core(TM) test CPU", "ncpu": 8, "uptime": 86400.0,
            "host": [1.6, 12.0, 35.0, 5.0, 1.5],   # CPU cores, GB in use, GPU %, disk MB/s, network MB/s (physical links that are up)
            "cap": [8, 32.0, 200.0, 500.0, 312.5],  # 2.5 Gbit/s is 312.5 MB/s
            "gpus": [{"name": "NVIDIA GeForce RTX 4080", "mem": "16 GB VRAM", "util": 25.0,
                      "m": {"util": 25.0, "3d": 1.0, "compute": 25.0, "vram": 2048.0 * MIB, "shared": 100.0 * MIB, "memctl": 10.0, "temp": 55.0,
                            "power": 120.5, "clock": 2505.0, "memclock": 11201.0, "fan": 35.0, "encode": 0.0, "decode": 0.0, "copy": 0.0},
                      "lim": {"vram": 16376.0 * MIB, "power": 320.0, "clock": 3105.0}},
                     {"name": "NVIDIA RTX A2000", "mem": "6 GB VRAM", "util": 10.0,
                      "m": {"util": 10.0, "3d": 10.0, "vram": 3000.0 * MIB, "shared": 50.0 * MIB, "memctl": 5.0, "temp": 45.0, "power": 15.2,
                            "clock": 600.0, "memclock": 6000.0, "fan": 0.0, "encode": 0.0, "decode": 0.0, "copy": 0.0},
                      "lim": {"vram": 6138.0 * MIB, "power": 70.0, "clock": 2100.0}}],
            "lcpus": [lc(0, 50.0, "0", 1), lc(1, 40.0, "0", 1), lc(2, 30.0, "1", 1), lc(3, 20.0, "1", 1),
                      lc(4, 10.0, "2", 0), lc(5, 10.0, "3", 0), lc(6, 0.0, "4", 0), lc(7, 0.0, "5", 0)],
            "groups": [{"name": "P-cores", "cpus": [0, 1, 2, 3]}, {"name": "E-cores", "cpus": [4, 5, 6, 7]}],
            "containers": [web, dict(web, id=DB[:12], name="shop-db-1", image="postgres:16", service="db", u=[0.0] * 5, nettx=0.0)],   # docker stats: "--"
            # the WSL utility VM: vmmemWSL's 2 cores and 6 GB, less the container Docker Desktop runs in it
            "vms": [{"name": "WSL", "u": [1.5, 5.0, 0.0, 0.0, 0.0], "gu": [0.0, 0.0], "running": True, "ifs": [], "cpus": "",   # on neither GPU
                     "distros": [{"name": "docker-desktop", "state": "Running", "default": False}, {"name": "Ubuntu", "state": "Running", "default": True}]}],
            "jobs": [{"name": "Backup", "sched": "Daily 02:00", "human": "Daily 02:00", "cmd": "C:\\backup.cmd --all", "src": "\\Fleet\\",
                      "last": "2026-11-14 02:00", "next": "2026-11-16 02:00", "running": False, "state": "Ready", "u": [0.0] * 5}],
            "procs": [[10, 4, "vmmemWSL", "", "", 2.0, 6.0, 0.0, 0.0, 20, "", "vm:WSL", -1, [], [], [], -1.0],
                      [20, 1000, "python.exe", "", "", 1.0, 2.0, 0.0, 25.0, 16, "python train.py", "base", -1, [0], [], ["Ethernet"], -1.0],
                      [30, 4, "dwm.exe", "", "", 0.25, 0.25, 0.0, 10.0, 12, "C:\\Windows\\system32\\dwm.exe", "base", -1, [1], [], ["Ethernet", "vEthernet (WSL)"], -1.0]],
            "ifs": [{"name": "Ethernet", "kind": "physical", "rx": 1.0, "tx": 0.5, "addrs": ["192.168.1.20/24"], "master": "", "state": "Up",
                     "speed": "2.5 Gbps", "desc": "Intel(R) Ethernet Controller I226-V"},
                    {"name": "vEthernet (WSL)", "kind": "virtual", "rx": 0.1, "tx": 0.2, "addrs": ["172.20.0.1/20"], "master": "", "state": "Up",
                     "speed": "10 Gbps", "desc": "Hyper-V Virtual Ethernet Adapter"},
                    {"name": "Wi-Fi", "kind": "physical", "rx": 0.0, "tx": 0.0, "addrs": [], "master": "", "state": "Disconnected",
                     "speed": "0 bps", "desc": "Intel(R) Wi-Fi 6E AX211 160MHz"}],
            "dockernets": [], "cronLabel": "Scheduled tasks", "gpu_procs": True,
            "disks": [{"name": "Disk 0", "model": "Samsung SSD 990 PRO 2TB", "size": 2000398934016.0, "rot": False, "role": "", "mounts": ["C:", "D:"],
                       "read": 2.0, "write": 1.0, "busy": 12.5}],
        }
        self.assertEqual(sorted(v), sorted(want), "the same keys")
        for k in want:
            self.assertEqual(rounded(v[k]), rounded(want[k]), k)

    def test_cpu_groups_by_ccd_and_a_single_group(self):
        m = fleet_live.Machine({"id": "w", "name": "w", "os": "windows"}, 3)
        r = desktop(1000.0, 0)
        r["topo"] = ["%d:%d:0:%d" % (n, n % 4, n // 4) for n in range(8)]   # two CCDs, one efficiency class
        self.assertEqual(m.derive_windows(r)["groups"], [{"name": "CCD 0", "cpus": [0, 1, 2, 3]}, {"name": "CCD 1", "cpus": [4, 5, 6, 7]}])
        r = desktop(1000.0, 0)
        r["topo"], r["lcpus"] = [], {"n": 0, "pct": 12.5, "mhz": 2400}   # a one-CPU VM without topology: one bare item
        v = fleet_live.Machine({"id": "w", "name": "w", "os": "windows"}, 3).derive_windows(r)
        self.assertEqual((v["groups"], v["lcpus"], v["host"][0]),
                         ([{"name": "All processors", "cpus": [0]}], [{"n": 0, "pct": 12.5, "mhz": 2400, "core": "", "eff": 0, "l3": "-1"}], 0.125))

    def test_nothing_else(self):
        """A host with no GPU, no WSL, no Docker and no tasks lists none of them."""
        r = desktop(1000.0, 0)
        for k in ("gpus", "adapters", "nvidia", "gproc", "containers", "dstats", "tasks", "disks"):
            r[k] = []
        r["wsl"], r["videoNames"] = [], "Microsoft Basic Display Adapter"
        v = fleet_live.Machine({"id": "w", "name": "w", "os": "windows"}, 3).derive_windows(r)
        self.assertEqual({k: v[k] for k in ("gpus", "containers", "vms", "jobs", "disks", "gpu_procs")},
                         {"gpus": [], "containers": [], "vms": [], "jobs": [], "disks": [], "gpu_procs": False})
        self.assertEqual((v["host"][2], v["cap"][2]), (0, 0.0))
        self.assertEqual([p[11] for p in v["procs"]], ["vm:WSL", "base", "base"], "vmmemWSL is still the WSL VM's process")


if __name__ == "__main__":
    unittest.main()
