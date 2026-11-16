# SPDX-License-Identifier: GPL-3.0-or-later
"""derive_linux: what Fleet Live makes of collect_linux.py's readings, per process and per group.
Readings are hand-made in the collector's shape; every assertion is the complete result.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import fleet_live  # noqa: E402

T0 = 1000.0


def reading(t, pnet):
    procs = [[pid, 1, comm, "S", 100, 0, 1, "root", 0, "", "", "", "/usr/bin/" + comm, 0] for pid, comm in ((104, "python3"), (110, "sshd"))]
    return {"t": t, "ncpu": 4, "hz": 100, "cpu": [10, 0, 10, 100, 0, 0, 0, 0], "lcpus": [], "mem": [16 << 30, 16 << 30], "disk": 0,
            "ifs": {}, "procs": procs, "containers": [], "vms": [], "cron": [], "timers": [], "gpus": [], "gproc": [], "pnet": pnet,
            "os": "Linux", "arch": "x86_64", "cpu_model": "test", "uptime": 1, "dockernets": []}


class ProcessNetworkRate(unittest.TestCase):
    """p[16] is the rate of the collector's per-process byte counter (pnet[pid]["b"]); a process the
    collector doesn't list has moved nothing, so its first connection counts from 0."""

    def test_rates(self):
        m = fleet_live.Machine({"id": "lx", "name": "lx"}, 3)
        steps = [
            {"110": {"ifs": ["eth0"], "b": 0}},
            {"104": {"ifs": ["eth0"], "b": 3e6}, "110": {"ifs": ["eth0"], "b": 1.5e6}},   # python3's first connection
            {"104": {"ifs": [], "b": 3e6}, "110": {"ifs": ["eth0"], "b": 1.5e6}},         # nothing open, nothing moved
            {"104": {"ifs": ["eth0"], "b": 4.5e6}, "110": {"ifs": ["eth0"], "b": 1.5e6}},
        ]
        got = []
        for i, pnet in enumerate(steps):
            v = m.derive_linux(reading(T0 + 3 * i, pnet))
            got.append({p[0]: (p[15], round(p[16], 3)) for p in v["procs"]})
        self.assertEqual(got, [
            {104: ([], 0.0), 110: (["eth0"], 0.0)},
            {104: (["eth0"], 1.0), 110: (["eth0"], 0.5)},
            {104: ([], 0.0), 110: (["eth0"], 0.0)},
            {104: (["eth0"], 0.5), 110: (["eth0"], 0.0)},
        ])


if __name__ == "__main__":
    unittest.main()
