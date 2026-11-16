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
    m.view = view
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


if __name__ == "__main__":
    unittest.main()
