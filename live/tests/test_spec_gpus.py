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


def host_view(gpus, containers=(), vms=()):
    return {"os": "Linux", "arch": "x86_64", "cpu_model": "test", "uptime": 60, "ncpu": 16, "cap": [16, 64, 100 * len(gpus), 500, 125],
            "host": [8, 40, sum(g["util"] for g in gpus), 0, 0], "gpus": list(gpus), "groups": [], "containers": list(containers),
            "vms": list(vms), "jobs": [], "procs": [], "lcpus": [], "ifs": [], "disks": []}


def gpu(util):
    return {"name": "GPU", "mem": "16 GB VRAM", "util": util, "m": {"util": util}, "lim": {}}


class VmGpusOnTheHost(unittest.TestCase):
    """What the host sees each VM use of each of the host's GPUs (hostside_gh), keyed by the host's GPUs."""
    def setUp(self):
        fl.HIST.d.clear()

    def test_every_vm_the_host_lists_says_what_it_uses_of_each_host_gpu(self):
        # GPU 0 at 100%: a container. GPU 1 at 50%: vm1's qemu (a vGPU). "other" is not in the config and uses no GPU.
        hv = host_view([gpu(100.0), gpu(50.0)],
                       containers=[{"id": CID, "name": "trainer", "image": "train:1", "status": "Up", "project": "", "service": "", "file": "",
                                    "u": [4, 12, 100, 0, 0], "gu": [100.0, 0.0]}],
                       vms=[{"name": "vm1", "u": [2, 16, 50, 0, 0], "gu": [0.0, 50.0], "running": True, "ifs": [], "cpus": ""},
                            {"name": "other", "u": [1, 4, 0, 0, 0], "gu": [0.0, 0.0], "running": True, "ifs": [], "cpus": ""}])
        # inside, vm1 sees its one vGPU at 45%
        iv = host_view([gpu(45.0)])
        host, vm = fl.Machine({"id": "host", "name": "lab-host"}, 3), fl.Machine({"id": "vm1", "name": "vm1", "vm_on": "host"}, 3)
        host.view, host.status, vm.view, vm.status = hv, "ok", iv, "ok"
        f = fl.Fleet.__new__(fl.Fleet)
        f.machines, f.lock, f.interval = {"host": host, "vm1": vm}, threading.Lock(), 3
        s = f.machine_spec(host, record=True)
        self.assertEqual([(v["id"], now(v["hostside_gh"])) for v in s["vms"]],
                         [("vm1", {"gpu0": 0.0, "gpu1": 50.0}), ("host/vms/other", {"gpu0": 0.0, "gpu1": 0.0})])
        self.assertEqual(now(s["vms"][0]["base"]["gh"]), {"gpu0": 45.0}, "the VM's own tree is measured inside it, on its own GPU")
        self.assertEqual(now(s["base"]["gh"]), {"gpu0": 0.0, "gpu1": 0.0})

    def test_a_host_with_no_gpu_says_nothing_per_gpu_of_its_vms(self):
        hv = host_view([], vms=[{"name": "other", "u": [1, 4, 0, 0, 0], "gu": [], "running": True, "ifs": [], "cpus": ""}])
        s = spec_of(hv, "host")
        self.assertEqual([(v["id"], v["hostside_gh"]) for v in s["vms"]], [("host/vms/other", {})])


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


class GpuMetricHistory(unittest.TestCase):
    """Each GPU's tiles in /api/fleet: [metric, limit, history] for the metrics it reports now (#290). Every metric a
    GPU has reported keeps its history moving on every reading: one that comes and goes (Windows' compute and video
    processing engines are counted only while a process holds them) reads 0 while it's away, so when it comes back
    its past stays where it happened instead of sitting just before now."""

    def setUp(self):
        fl.HIST.d.clear()
        self.view = fl.Machine({"id": "lx", "name": "lx"}, 3).derive_linux(linux_reading([nv(0, 0.0)], []))

    def poll(self, m):
        self.view["gpus"] = [{"name": "GPU 0", "mem": "", "util": m["util"], "m": m, "lim": {"vram": 8.0}}]
        return spec_of(self.view)["gpus"][0]["m"]

    def test_a_metric_that_comes_back_shows_its_past_where_it_happened(self):
        # a CUDA job at 90% for 5 readings, gone for 30, then another at 5%
        for _ in range(5):
            self.poll({"util": 90.0, "compute": 90.0, "vram": 4.0})
        for _ in range(30):
            got = self.poll({"util": 1.0, "vram": 1.0})
        self.assertEqual([k for k, _, _ in got], ["util", "vram"], "away: no compute tile")
        got = {k: (lim, h[-36:]) for k, lim, h in self.poll({"util": 5.0, "compute": 5.0, "vram": 2.0})}
        self.assertEqual(got, {"util": (None, [90.0] * 5 + [1.0] * 30 + [5.0]),
                               "compute": (None, [90.0] * 5 + [0.0] * 30 + [5.0]),
                               "vram": (8.0, [4.0] * 5 + [1.0] * 30 + [2.0])})

    def test_metrics_present_throughout_and_one_never_seen(self):
        # the "nothing else" control: steady metrics move one step a reading, and a metric this GPU never reported
        # gets no history at all
        for v in (10.0, 20.0, 30.0):
            got = self.poll({"util": v, "temp": v + 40})
        self.assertEqual({k: h[-3:] for k, _, h in got}, {"util": [10.0, 20.0, 30.0], "temp": [50.0, 60.0, 70.0]})
        self.assertEqual(sorted(k for k in fl.HIST.d if "/gpu0/" in k), ["lx/gpu0/temp", "lx/gpu0/util"])

    def test_a_machine_that_isnt_live_records_nothing(self):
        self.poll({"util": 50.0, "compute": 50.0})
        m = fl.Machine({"id": "lx", "name": "lx"}, 3)
        m.view, m.status = dict(self.view, gpus=[{"name": "GPU 0", "mem": "", "util": 0.0, "m": {"util": 0.0}, "lim": {}}]), "offline"
        f = fl.Fleet.__new__(fl.Fleet)
        f.machines, f.lock, f.interval = {"lx": m}, threading.Lock(), 3
        f.machine_spec(m, record=True)
        self.assertEqual({k: list(fl.HIST.d[k][0])[-2:] for k in ("lx/gpu0/util", "lx/gpu0/compute")},
                         {"lx/gpu0/util": [0.0, 50.0], "lx/gpu0/compute": [0.0, 50.0]})


if __name__ == "__main__":
    unittest.main()
