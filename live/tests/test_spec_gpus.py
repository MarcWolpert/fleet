# SPDX-License-Identifier: GPL-3.0-or-later
"""What each workload uses of each GPU, measured, not split: every container, Compose service, VM and job
says how much of each GPU its processes use (gu, from nvidia-smi pmon / DRM fdinfo on Linux and the GPU
engine counters on Windows), and Base system is what is left of each GPU's own utilisation. /api/fleet
sends each node's per-GPU history as gh: {"gpu0": [...], "gpu1": [...]}.

Readings are hand-made, shaped like collect_linux.py's and collect_windows.ps1's output.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import os
import sys
import threading
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import fleet_live as fl  # noqa: E402

CID = "c0ffee000001"


def nv(index, util):
    return {"index": index, "name": "GPU %d" % index, "util": util, "memUsed": 100.0, "memTotal": 16384.0}


def linux_reading(gpus, gproc, cron=()):
    """One collect_linux.py reading on a 4-CPU host: a container (trainer 104, helper 105), a VM (qemu 106),
    a bare-metal process (107), the cron daemon (108) running a job (109), and sshd (110), which uses no GPU."""
    rows = [(104, 1, "python3", CID, "", "/usr/bin/python3 train.py"), (105, 1, "python3", CID, "", "/usr/bin/python3 helper.py"),
            (106, 1, "qemu-system-x86", "", "vm1", "/usr/bin/qemu-system-x86_64 -name guest=vm1"),
            (107, 1, "ffmpeg", "", "", "/usr/bin/ffmpeg -i in.mkv out.mp4"), (108, 1, "cron", "", "", "/usr/sbin/cron -f"),
            (109, 108, "render.sh", "", "", "/bin/sh /opt/render.sh"), (110, 1, "sshd", "", "", "/usr/sbin/sshd -D")]
    procs = [[pid, ppid, comm, "S", 100, 1 << 20, 2, "root", 0, cid, vm, "", cmd, 0] for pid, ppid, comm, cid, vm, cmd in rows]
    return {"t": 1000.0, "ncpu": 4, "hz": 100, "cpu": [10, 0, 10, 100, 0, 0, 0, 0],
            "lcpus": [{"n": n, "t": [1, 0, 1, 10, 0, 0, 0, 0], "core": str(n), "l3": "0", "kind": "", "pkg": "0"} for n in range(4)],
            "mem": [16 << 30, 8 << 30], "disk": 0, "ifs": {}, "procs": procs,
            "containers": [{"id": CID, "name": "trainer", "image": "train:1", "status": "Up", "project": "", "service": "", "file": "",
                            "networks": "", "rx": 0, "tx": 0}],
            "vms": [{"name": "vm1", "ifs": []}], "cron": list(cron), "timers": [],
            "gpus": gpus, "gproc": gproc, "os": "Linux", "arch": "x86_64", "cpu_model": "test", "uptime": 1, "dockernets": []}


RENDER = [{"sched": "*/5 * * * *", "cmd": "/opt/render.sh", "src": "root"}]


def spec_of(view, mid="lx"):
    m = fl.Machine({"id": mid, "name": mid}, 3)
    m.view, m.status = view, "ok"
    f = fl.Fleet.__new__(fl.Fleet)
    f.machines, f.lock, f.interval = {mid: m}, threading.Lock(), 3
    return f.machine_spec(m, record=True)


def now(gh):
    return {k: round(s[-1], 3) for k, s in gh.items()}


class LinuxGpusPerWorkload(unittest.TestCase):
    def setUp(self):
        fl.HIST.d.clear()

    def test_each_workload_says_what_it_uses_of_each_gpu_and_base_is_the_rest(self):
        # GPU 0 at 100%: the trainer 85, the VM 10. GPU 1 at 70%: the helper 5, the job 20, ffmpeg 30 (bare metal).
        v = fl.Machine({"id": "lx", "name": "lx"}, 3).derive_linux(linux_reading(
            [nv(0, 100.0), nv(1, 70.0)], [[0, 104, 85.0], [1, 105, 5.0], [0, 106, 10.0], [1, 107, 30.0], [1, 109, 20.0]], RENDER))
        self.assertEqual([(c["name"], c["gu"]) for c in v["containers"]], [("trainer", [85.0, 5.0])])
        self.assertEqual([(x["name"], x["gu"]) for x in v["vms"]], [("vm1", [10.0, 0.0])])
        self.assertEqual([(j["name"], j["running"], j["gu"]) for j in v["jobs"]], [("render.sh", True, [0.0, 20.0])])
        s = spec_of(v)
        self.assertEqual([(c["name"], now(c["gh"])) for c in s["containers"]], [("trainer", {"gpu0": 85.0, "gpu1": 5.0})])
        self.assertEqual([(j["name"], now(j["gh"])) for j in s["baseCron"]], [("render.sh", {"gpu0": 0.0, "gpu1": 20.0})])
        self.assertEqual(now(s["base"]["gh"]), {"gpu0": 5.0, "gpu1": 45.0}, "each GPU's utilisation, less what the workloads on it use")
        self.assertEqual(s["base"]["h"]["gpu"][-1], 50.0, "Base's GPU total is the sum of its GPUs")

    def test_bare_metal_load_lands_on_the_gpu_it_runs_on(self):
        v = fl.Machine({"id": "lx", "name": "lx"}, 3).derive_linux(linux_reading([nv(0, 10.0), nv(1, 60.0)], [[1, 107, 60.0]]))
        s = spec_of(v)
        self.assertEqual(now(s["base"]["gh"]), {"gpu0": 10.0, "gpu1": 60.0})
        self.assertEqual([(c["name"], now(c["gh"])) for c in s["containers"]], [("trainer", {"gpu0": 0.0, "gpu1": 0.0})])
        self.assertEqual(s["base"]["h"]["gpu"][-1], 70.0)

    def test_a_gpu_is_never_below_zero_for_base(self):
        # pmon's per-process numbers can add up to more than the GPU's own utilisation
        v = fl.Machine({"id": "lx", "name": "lx"}, 3).derive_linux(linux_reading([nv(0, 80.0), nv(1, 0.0)], [[0, 104, 85.0], [1, 105, 5.0]]))
        s = spec_of(v)
        self.assertEqual(now(s["base"]["gh"]), {"gpu0": 0.0, "gpu1": 0.0})
        self.assertEqual(s["base"]["h"]["gpu"][-1], 0.0)

    def test_a_machine_with_no_gpu_has_no_per_gpu_series(self):
        v = fl.Machine({"id": "lx", "name": "lx"}, 3).derive_linux(linux_reading([], [], RENDER))
        s = spec_of(v)
        self.assertEqual((s["base"]["gh"], [c["gh"] for c in s["containers"]], [j["gh"] for j in s["baseCron"]]), ({}, [{}], [{}]))
        self.assertEqual(s["base"]["h"]["gpu"][-1], 0.0)


class WindowsGpusPerWorkload(unittest.TestCase):
    def setUp(self):
        fl.HIST.d.clear()

    def test_the_wsl_vm_uses_its_own_adapter_and_base_is_the_rest(self):
        a, b = "0x0_0x1a", "0x0_0x2b"
        procs = [[10, 4, "game.exe", 0.1, 1 << 20, 3, 0, "C:\\game.exe"], [11, 4, "vmmemWSL", 0.1, 1 << 20, 3, 0, "vmmemWSL"]]
        r = {"t": 1000.0, "ncpu": 4, "lcpus": [{"n": n, "pct": 5.0, "mhz": 3000} for n in range(4)], "topo": [],
             "gpus": [{"luid": a, "util": 50.0, "dedicated": 24 << 30}, {"luid": b, "util": 30.0, "dedicated": 8 << 30}],
             "nvidia": [], "videoNames": ["GPU A", "GPU B"], "gproc": [[10, a, 50.0], [11, b, 20.0]], "procs": procs, "ifs": [],
             "wsl": [{"name": "Ubuntu", "state": "Running"}], "containers": [], "dstats": [], "tasks": [], "mem": [16 << 30, 8 << 30],
             "diskBps": 0, "os": "Windows"}
        v = fl.Machine({"id": "w", "name": "w", "os": "windows"}, 3).derive_windows(r)
        self.assertEqual([(x["name"], x["gu"]) for x in v["vms"]], [("WSL", [0.0, 20.0])])
        s = spec_of(v, "w")
        self.assertEqual(now(s["base"]["gh"]), {"gpu0": 50.0, "gpu1": 10.0})
        self.assertEqual(s["base"]["h"]["gpu"][-1], 60.0)


if __name__ == "__main__":
    unittest.main()
