# SPDX-License-Identifier: GPL-3.0-or-later
"""A container's network traffic keeps its two directions (#177): what it received and what it sent, as well as
their sum (u[4], the container's net usage). Readings are shaped like the collectors' output: collect_linux.py
(rx and tx bytes from the container's /proc/<pid>/net/dev) and collect_windows.ps1 (docker ps and docker stats
lines, NetIO "received / sent"). /api/net hands both directions to the Network tree.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import json
import os
import sys
import threading
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, ".."), HERE]
import fleet_live  # noqa: E402
from test_procs_gpu import linux_reading, windows_reading  # noqa: E402

MB = 1e6


def lx_container(cid, name, rx, tx):
    return {"id": cid, "name": name, "image": "img:1", "status": "Up 2 hours", "project": "", "service": "", "file": "",
            "networks": "bridge", "rx": rx, "tx": tx}


def win_lines(t, conts):
    """docker ps and docker stats lines for (id, name, NetIO) containers."""
    ps = [json.dumps({"ID": cid + "0" * 52, "Names": name, "Image": "img:1", "Status": "Up 2 hours", "Labels": "", "Networks": "bridge"}) for cid, name, _ in conts]
    st = [json.dumps({"ID": cid + "0" * 52, "CPUPerc": "0.00%", "MemUsage": "10MiB / 1GiB", "BlockIO": "0B / 0B", "NetIO": nio}) for cid, _, nio in conts]
    return ps, st


def nets(view):
    return {c["name"]: [round(c["netrx"], 6), round(c["nettx"], 6), round(c["u"][4], 6)] for c in view["containers"]}


class LinuxContainers(unittest.TestCase):
    def test_received_and_sent_each_have_their_rate(self):
        m = fleet_live.Machine({"id": "lx", "name": "lx"}, 3)
        a = linux_reading([], [])
        a["containers"] = [lx_container("aaaaaaaaaaaa", "backup", 0, 0), lx_container("bbbbbbbbbbbb", "web", 0, 0),
                           lx_container("cccccccccccc", "idle", 5000, 5000)]
        m.derive_linux(a)
        b = linux_reading([], [])
        b["t"] = a["t"] + 2.0
        b["containers"] = [lx_container("aaaaaaaaaaaa", "backup", 2 * MB, 40 * MB),   # mostly sends: an uploader
                           lx_container("bbbbbbbbbbbb", "web", 6 * MB, 1 * MB),
                           lx_container("cccccccccccc", "idle", 5000, 5000)]
        self.assertEqual(nets(m.derive_linux(b)), {"backup": [1.0, 20.0, 21.0], "web": [3.0, 0.5, 3.5], "idle": [0.0, 0.0, 0.0]})


class WindowsContainers(unittest.TestCase):
    def test_netio_is_received_then_sent(self):
        m = fleet_live.Machine({"id": "win", "name": "win"}, 3)
        a = windows_reading([], [])
        a["containers"], a["dstats"] = win_lines(a["t"], [("aaaaaaaaaaaa", "backup", "0B / 0B"), ("bbbbbbbbbbbb", "web", "1MB / 2MB")])
        m.derive_windows(a)
        b = windows_reading([], [])
        b["t"] = a["t"] + 2.0
        b["containers"], b["dstats"] = win_lines(b["t"], [("aaaaaaaaaaaa", "backup", "2MB / 40MB"), ("bbbbbbbbbbbb", "web", "7MB / 3MB")])
        self.assertEqual(nets(m.derive_windows(b)), {"backup": [1.0, 20.0, 21.0], "web": [3.0, 0.5, 3.5]})


class NetIO(unittest.TestCase):
    def test_both_halves_and_what_is_missing(self):
        self.assertEqual(fleet_live.netio("1.5kB / 3MB"), (1500.0, 3e6))
        self.assertEqual(fleet_live.netio("2KiB / 0B"), (2048.0, 0.0))
        self.assertEqual(fleet_live.netio("12B"), (12.0, 0.0))
        self.assertEqual(fleet_live.netio(""), (0.0, 0.0))
        self.assertEqual(fleet_live.netio(None), (0.0, 0.0))


class ApiNet(unittest.TestCase):
    def test_containers_carry_received_and_sent(self):
        m = fleet_live.Machine({"id": "lx", "name": "lab-linux", "ssh": "lab-linux"}, 3)
        m.view = {"ifs": [], "vms": [], "dockernets": [{"name": "bridge", "id": "abc", "driver": "bridge"}],
                  "containers": [{"name": "backup", "networks": "bridge", "u": [0, 0, 0, 0, 21.0], "netrx": 1.0, "nettx": 20.0},
                                 {"name": "web", "networks": "bridge", "u": [0, 0, 0, 0, 3.5], "netrx": 3.0, "nettx": 0.5}]}
        m.status, m.error = "ok", ""
        f = fleet_live.Fleet.__new__(fleet_live.Fleet)
        f.machines, f.lock, f.interval = {"lx": m}, threading.Lock(), 3
        with mock.patch.object(fleet_live, "run", return_value=""):   # no tailscale is run
            d = f.api_net()
        self.assertEqual(d["machines"][0]["containers"], [{"name": "backup", "networks": "bridge", "net": 21.0, "rx": 1.0, "tx": 20.0},
                                                          {"name": "web", "networks": "bridge", "net": 3.5, "rx": 3.0, "tx": 0.5}])


if __name__ == "__main__":
    unittest.main()
