# SPDX-License-Identifier: GPL-3.0-or-later
"""#4: /api/procs says which GPUs each process is on (p[13], positions in the machine's GPU list) and
whether the host reports that at all (gpu_procs). Readings are shaped like the collectors' output:
collect_linux.py (nvidia-smi --query-gpu, nvidia-smi pmon) and collect_windows.ps1 (GPU engine counters).

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import os
import sys
import threading
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import fleet_live  # noqa: E402


def linux_reading(gpus, gproc):
    """One collect_linux.py reading: 4 CPUs, five processes (pid, ppid, comm, state, ticks, rss, threads,
    user, io bytes, container id, vm, unit, cmd, last cpu)."""
    procs = [[pid, 1, comm, "S", 100, 1 << 20, 2, "root", 0, "", "", "", "/usr/bin/" + comm, last]
             for pid, comm, last in ((104, "python3", 2), (105, "python3", 3), (106, "ffmpeg", 1), (109, "Xorg", 0), (110, "sshd", 3))]
    return {"t": 1000.0, "ncpu": 4, "hz": 100, "cpu": [10, 0, 10, 100, 0, 0, 0, 0],
            "lcpus": [{"n": n, "t": [1, 0, 1, 10, 0, 0, 0, 0], "core": str(n), "l3": "0", "kind": "", "pkg": "0"} for n in range(4)],
            "mem": [16 << 30, 8 << 30], "disk": 0, "ifs": {}, "procs": procs, "containers": [], "vms": [], "cron": [], "timers": [],
            "gpus": gpus, "gproc": gproc, "os": "Linux", "arch": "x86_64", "cpu_model": "test", "uptime": 1, "dockernets": []}


def nv(index, name):
    return {"index": index, "name": name, "util": 10.0, "memUsed": 100.0, "memTotal": 16384.0}


def by_pid(view):
    return {p[0]: p for p in view["procs"]}


def on(p, i=13):
    return p[i] if len(p) > i else "missing"


class LinuxGpusPerProcess(unittest.TestCase):
    def derive(self, gpus, gproc):
        return fleet_live.Machine({"id": "lx", "name": "lx"}, 3).derive_linux(linux_reading(gpus, gproc))

    def test_each_process_names_the_gpus_pmon_puts_it_on(self):
        v = self.derive([nv(0, "RTX A4000"), nv(1, "RTX A2000")],
                        [[0, 104, 40.0], [1, 105, 25.0], [0, 106, 10.0], [1, 106, 20.0], [0, 109, 0.0]])
        self.assertEqual({pid: on(p) for pid, p in by_pid(v).items()}, {104: [0], 105: [1], 106: [0, 1], 109: [0], 110: []})
        self.assertEqual({pid: p[8] for pid, p in by_pid(v).items()}, {104: 40.0, 105: 25.0, 106: 30.0, 109: 0.0, 110: 0.0}, "GPU % unchanged")
        self.assertEqual({pid: p[12] for pid, p in by_pid(v).items()}, {104: 2, 105: 3, 106: 1, 109: 0, 110: 3}, "last CPU unchanged")
        self.assertIs(v.get("gpu_procs"), True)

    def test_nvidia_indices_map_to_positions_in_the_gpu_list(self):
        v = self.derive([nv(1, "RTX A2000"), nv(3, "RTX A4000")], [[3, 104, 5.0], [1, 105, 5.0], [2, 106, 5.0]])
        self.assertEqual({pid: on(p) for pid, p in by_pid(v).items()}, {104: [1], 105: [0], 106: [], 109: [], 110: []})

    def test_no_gpu_means_nothing_is_on_one_and_it_is_not_reported(self):
        v = self.derive([], [])
        self.assertEqual({pid: on(p) for pid, p in by_pid(v).items()}, {104: [], 105: [], 106: [], 109: [], 110: []})
        self.assertIs(v.get("gpu_procs"), False)


if __name__ == "__main__":
    unittest.main()
