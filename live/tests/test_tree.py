# SPDX-License-Identifier: GPL-3.0-or-later
"""The machine tree the server builds from each machine's latest view (Fleet.machine_spec, /api/fleet), and the
history it keeps for every node. Views are shaped like what derive_linux, derive_windows and the macOS collector
return; nothing is read from any machine and no thread is started.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import collections
import json
import os
import sys
import tempfile
import threading
import unittest
from unittest import mock
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import fleet_live  # noqa: E402

H = fleet_live.H


def view(**over):
    """A derived view of a 4-CPU, 16 GB Linux host with nothing on it; `over` replaces any field."""
    v = {"t": 1000.0, "os": "Linux", "arch": "x86_64", "cpu_model": "test CPU", "ncpu": 4, "uptime": 3600,
         "host": [2.0, 6.0, 0.0, 1.0, 0.5], "cap": [4, 16.0, 0.0, 500.0, 125.0], "gpus": [], "lcpus": [], "groups": [],
         "containers": [], "vms": [], "jobs": [], "procs": [], "ifs": [], "dockernets": [], "cronLabel": "Cron jobs",
         "disks": [], "gpu_procs": False}
    v.update(over)
    return v


def job(name, cmd=None, sched="*/5 * * * *", src="crontab", u=None, running=None):
    u = list(u or [0.0] * 5)
    return {"name": name, "sched": sched, "human": "", "cmd": cmd if cmd is not None else "/usr/local/bin/" + name, "src": src,
            "last": "", "running": bool(u[0]) if running is None else running, "u": u}


def timer(name, u=None):
    """A systemd timer as derive_linux lists it."""
    j = job(name, cmd=name + ".service", sched="systemd timer", src="systemd", u=u)
    j["human"] = "timer"
    return j


def jid(mid, name, src, sched, cmd):
    """The id a job gets: its name, then a checksum of where it's defined, its schedule, its command and its name."""
    return "%s/base/cron/%s-%08x" % (mid, name, zlib.crc32("\0".join((src, sched, cmd, name)).encode()))


def make_fleet(*cfgs):
    """A Fleet over these machines' configs, without its threads or saved state."""
    f = fleet_live.Fleet.__new__(fleet_live.Fleet)
    f.cfg, f.interval, f.tick, f.lock, f.specs = {}, 3.0, 0, threading.Lock(), {}
    f.machines = collections.OrderedDict((c["id"], fleet_live.Machine(c, 3)) for c in cfgs)
    return f


def give(f, mid, v, status="ok"):
    m = f.machines[mid]
    if status == "ok":
        m.got(v)   # a reading arrives
    else:
        m.view, m.status = v, status
    return m


class TreeTest(unittest.TestCase):
    def setUp(self):
        self.saved_hist = fleet_live.HIST
        fleet_live.HIST = fleet_live.Hist()

    def tearDown(self):
        fleet_live.HIST = self.saved_hist

    def record(self, f, mid):
        """One record pass for root machine `mid`, as record_loop does it."""
        spec = f.machine_spec(f.machines[mid], record=True)
        with f.lock:
            f.specs = dict(f.specs, **{mid: spec})
        return spec


class JobIds(TreeTest):
    """#109: a scheduled job's id and history follow the job, not its place in the list."""

    def test_reordered_timers_keep_their_ids_and_history(self):
        f = make_fleet({"id": "lx", "name": "lx", "ssh": "lx", "os": "linux"})
        m = give(f, "lx", view(jobs=[timer("backup", u=[1.0, 0.5, 0, 0, 0]), timer("fstrim")]))
        first = self.record(f, "lx")
        m.view = view(jobs=[timer("fstrim"), timer("backup", u=[1.0, 0.5, 0, 0, 0])])   # backup fired: it sorts last now
        second = self.record(f, "lx")
        want = {"backup": jid("lx", "backup", "systemd", "systemd timer", "backup.service"),
                "fstrim": jid("lx", "fstrim", "systemd", "systemd timer", "fstrim.service")}
        self.assertEqual({j["name"]: j["id"] for j in first["baseCron"]}, want)
        self.assertEqual({j["name"]: j["id"] for j in second["baseCron"]}, want)
        self.assertEqual({j["name"]: j["h"]["cpu"][-3:] for j in second["baseCron"]}, {"backup": [0.0, 1.0, 1.0], "fstrim": [0.0, 0.0, 0.0]})
        self.assertEqual({j["name"]: j["h"]["mem"][-2:] for j in second["baseCron"]}, {"backup": [0.5, 0.5], "fstrim": [0.0, 0.0]})

    def test_a_new_crontab_line_does_not_move_the_jobs_after_it(self):
        f = make_fleet({"id": "lx", "name": "lx", "ssh": "lx", "os": "linux"})
        m = give(f, "lx", view(jobs=[job("rotate.sh"), timer("fstrim")]))
        before = {j["name"]: j["id"] for j in self.record(f, "lx")["baseCron"]}
        m.view = view(jobs=[job("backup.sh", sched="0 3 * * *"), job("rotate.sh"), timer("fstrim")])
        after = {j["name"]: j["id"] for j in self.record(f, "lx")["baseCron"]}
        self.assertEqual(after, dict(before, **{"backup.sh": jid("lx", "backup.sh", "crontab", "0 3 * * *", "/usr/local/bin/backup.sh")}))

    def test_jobs_with_one_name_and_exact_duplicates_get_ids_of_their_own(self):
        f = make_fleet({"id": "mac", "name": "mac", "kind": "local"})
        daily = job("backup.sh", cmd="/usr/local/bin/backup.sh daily", sched="0 3 * * *")
        weekly = job("backup.sh", cmd="/usr/local/bin/backup.sh weekly", sched="0 4 * * 0")
        give(f, "mac", view(jobs=[daily, weekly, dict(daily)]))   # the macOS crontab isn't deduplicated
        d = jid("mac", "backup.sh", "crontab", "0 3 * * *", "/usr/local/bin/backup.sh daily")
        self.assertEqual([j["id"] for j in self.record(f, "mac")["baseCron"]],
                         [d, jid("mac", "backup.sh", "crontab", "0 4 * * 0", "/usr/local/bin/backup.sh weekly"), d + "-2"])

    def test_same_job_on_another_host_is_another_node(self):
        f = make_fleet({"id": "lx", "name": "lx", "ssh": "lx", "os": "linux"}, {"id": "nas", "name": "nas", "ssh": "nas", "os": "linux"})
        give(f, "lx", view(jobs=[timer("fstrim", u=[0.25, 0, 0, 0, 0])]))
        give(f, "nas", view(jobs=[timer("fstrim")]))
        a, b = self.record(f, "lx")["baseCron"][0], self.record(f, "nas")["baseCron"][0]
        self.assertEqual((a["id"], b["id"]), (jid("lx", "fstrim", "systemd", "systemd timer", "fstrim.service"),
                                              jid("nas", "fstrim", "systemd", "systemd timer", "fstrim.service")))
        self.assertEqual((a["h"]["cpu"][-1], b["h"]["cpu"][-1]), (0.25, 0.0))

    def test_a_job_process_in_details_points_at_its_job_in_the_current_order(self):
        f = make_fleet({"id": "mac", "name": "mac", "kind": "local"})
        proc = [501, 1, "rotate.sh", "", "", 0.5, 0.01, 0.0, 0.0, 1, "/bin/sh /usr/local/bin/rotate.sh", "job:0", -1]
        base = [502, 1, "sshd", "", "", 0.0, 0.01, 0.0, 0.0, 1, "/usr/sbin/sshd", "base", -1]
        give(f, "mac", view(jobs=[job("backup.sh", sched="0 3 * * *"), job("rotate.sh")]))
        self.record(f, "mac")
        f.machines["mac"].view = view(jobs=[job("rotate.sh", u=[0.5, 0.01, 0, 0, 0]), job("backup.sh", sched="0 3 * * *")], procs=[proc, base])
        self.assertEqual({p[0]: p[10] for p in f.api_procs("mac")["procs"]},
                         {501: jid("mac", "rotate.sh", "crontab", "*/5 * * * *", "/usr/local/bin/rotate.sh"), 502: "mac/base"})


def prow(pid, comm, owner, gpu=0.0, on=(), cpu=0.1):
    """A process row as the derive_* functions give it; `on` is the GPUs it runs on (positions in the machine's list)."""
    return [pid, 1, comm, "root", "S", cpu, 0.05, 0.0, gpu, 2, "/usr/bin/" + comm, owner, 0, list(on), [], [], 0.0]


def gpu(name, util):
    return {"name": name, "mem": "", "util": util, "m": {"util": util}, "lim": {}}


def container(cid, name, u, gkeys=(), project="", service=""):
    return {"id": cid, "name": name, "image": name + ":1", "status": "Up 1 hour", "project": project, "service": service,
            "file": "", "networks": "", "u": list(u), "gkeys": list(gkeys)}


TWO_GPUS = [gpu("RTX A4000", 50.0), gpu("RTX A2000", 100.0)]


class GpuTags(TreeTest):
    """#116: Base and scheduled jobs name the GPUs they run on, and Base is counted on each GPU by what's left there."""

    def gpu_view(self, gpus, procs, containers=(), jobs=(), gpu_procs=True):
        host_gpu = sum(g["util"] for g in gpus)
        return view(gpus=gpus, procs=procs, containers=list(containers), jobs=list(jobs), gpu_procs=gpu_procs,
                    host=[2.0, 6.0, host_gpu, 1.0, 0.5], cap=[4, 16.0, 100.0 * len(gpus), 500.0, 125.0])

    def tags(self, spec):
        return {"base": spec["base"]["g"], "gh": {k: v[-1] for k, v in spec["base"].get("gh", {}).items()}, "base_gpu": spec["base"]["h"]["gpu"][-1],
                "jobs": {j["name"]: j["g"] for j in spec["baseCron"]},
                "containers": {c["name"]: c["g"] for c in spec["containers"]}}

    def test_base_on_two_gpus_is_counted_on_each_by_what_it_uses_there(self):
        f = make_fleet({"id": "lx", "name": "lx", "ssh": "lx", "os": "linux"})
        give(f, "lx", self.gpu_view(TWO_GPUS, [prow(10, "python3", "base", 50.0, [0]), prow(11, "ffmpeg", "base", 100.0, [1]),
                                               prow(12, "sshd", "base")]))
        self.assertEqual(self.tags(self.record(f, "lx")),
                         {"base": ["gpu0", "gpu1"], "gh": {"gpu0": 50.0, "gpu1": 100.0}, "base_gpu": 150.0, "jobs": {}, "containers": {}})

    def test_containers_and_jobs_are_taken_off_the_gpu_they_run_on(self):
        f = make_fleet({"id": "lx", "name": "lx", "ssh": "lx", "os": "linux"})
        procs = [prow(10, "python3", "base", 50.0, [0]), prow(11, "ffmpeg", "base", 20.0, [1]), prow(20, "trainer", "c:abc123", 60.0, [1]),
                 prow(30, "encode.sh", "job:0", 20.0, [1]), prow(31, "rotate.sh", "job:1"), prow(32, "scrub", "unit:scrub.service", 0.0, [])]
        jobs = [job("encode.sh", u=[0.1, 0.05, 20.0, 0, 0]), job("rotate.sh", u=[0.1, 0.05, 0, 0, 0]), timer("scrub")]
        give(f, "lx", self.gpu_view(TWO_GPUS, procs, [container("abc123", "trainer", [0.1, 0.05, 60.0, 0, 0], ["gpu1"])], jobs))
        self.assertEqual(self.tags(self.record(f, "lx")),
                         {"base": ["gpu0", "gpu1"], "gh": {"gpu0": 50.0, "gpu1": 20.0}, "base_gpu": 70.0,
                          "jobs": {"encode.sh": ["gpu1"], "rotate.sh": [], "scrub": []}, "containers": {"trainer": ["gpu1"]}})

    def test_a_timer_names_the_gpu_its_unit_runs_on(self):
        f = make_fleet({"id": "lx", "name": "lx", "ssh": "lx", "os": "linux"})
        procs = [prow(32, "scrub", "unit:scrub.service", 30.0, [1]), prow(10, "python3", "base", 50.0, [0])]
        give(f, "lx", self.gpu_view([gpu("RTX A4000", 50.0), gpu("RTX A2000", 30.0)], procs, jobs=[timer("scrub", u=[0.1, 0.05, 30.0, 0, 0])]))
        self.assertEqual(self.tags(self.record(f, "lx")),
                         {"base": ["gpu0"], "gh": {"gpu0": 50.0, "gpu1": 0.0}, "base_gpu": 50.0, "jobs": {"scrub": ["gpu1"]}, "containers": {}})

    def test_base_names_no_gpu_when_a_container_uses_all_of_it(self):
        f = make_fleet({"id": "lx", "name": "lx", "ssh": "lx", "os": "linux"})
        give(f, "lx", self.gpu_view([gpu("RTX A4000", 30.0)], [prow(20, "trainer", "c:abc123", 30.0, [0]), prow(12, "sshd", "base")],
                                    [container("abc123", "trainer", [0.1, 0.05, 30.0, 0, 0], ["gpu0"])]))
        self.assertEqual(self.tags(self.record(f, "lx")),
                         {"base": [], "gh": {"gpu0": 0.0}, "base_gpu": 0.0, "jobs": {}, "containers": {"trainer": ["gpu0"]}})

    def test_a_host_that_does_not_name_each_process_gpu_counts_base_by_each_gpu_use(self):
        f = make_fleet({"id": "mac", "name": "mac", "kind": "local"})
        give(f, "mac", self.gpu_view([gpu("Apple GPU", 15.0)], [prow(10, "WindowServer", "base", cpu=0.2)], gpu_procs=False))
        self.assertEqual(self.tags(self.record(f, "mac")),
                         {"base": ["gpu0"], "gh": {"gpu0": 15.0}, "base_gpu": 15.0, "jobs": {}, "containers": {}})

    def test_a_machine_with_no_gpu_names_none(self):
        f = make_fleet({"id": "lx", "name": "lx", "ssh": "lx", "os": "linux"})
        give(f, "lx", self.gpu_view([], [prow(10, "python3", "base"), prow(30, "encode.sh", "job:0")], jobs=[job("encode.sh", u=[0.1, 0.05, 0, 0, 0])],
                                    gpu_procs=False))
        self.assertEqual(self.tags(self.record(f, "lx")), {"base": [], "gh": {}, "base_gpu": 0.0, "jobs": {"encode.sh": []}, "containers": {}})

    def test_base_gpu_history_per_gpu_follows_the_readings(self):
        f = make_fleet({"id": "lx", "name": "lx", "ssh": "lx", "os": "linux"})
        m = give(f, "lx", self.gpu_view(TWO_GPUS, [prow(10, "python3", "base", 50.0, [0]), prow(11, "ffmpeg", "base", 100.0, [1])]))
        self.record(f, "lx")
        m.view = self.gpu_view([gpu("RTX A4000", 10.0), gpu("RTX A2000", 0.0)], [prow(10, "python3", "base", 10.0, [0])])
        gh = self.record(f, "lx")["base"]["gh"]
        self.assertEqual({k: v[-3:] for k, v in gh.items()}, {"gpu0": [0.0, 50.0, 10.0], "gpu1": [0.0, 100.0, 0.0]})


HOST_CFG = {"id": "nas", "name": "nas", "ssh": "nas", "os": "linux"}
VM_CFG = {"id": "win-vm", "name": "win-vm", "ssh": "win-vm", "os": "windows", "vm_on": "nas"}


def host_view(vms, **over):
    """A 16-CPU, 64 GB Linux host with an 800 MB/s disk and a 1250 MB/s link, running these VMs."""
    return view(ncpu=16, host=[6.0, 30.0, 0.0, 40.0, 20.0], cap=[16, 64.0, 0.0, 800.0, 1250.0], vms=vms, **over)


def vm(name, u, cpus="", running=True):
    return {"name": name, "u": list(u), "running": running, "ifs": [], "cpus": cpus}


class VmCapacity(TreeTest):
    """#141: a VM seen from its host is measured against what it can use there, not 1 core, 1 GB and 1 MB/s."""

    def one_vm(self, spec):
        v = spec["vms"][0]
        return {"id": v["id"], "status": v["status"], "cap": v["cap"], "cpu": v["base"]["h"]["cpu"][-1], "mem": v["base"]["h"]["mem"][-1]}

    def test_a_configured_vm_seen_only_from_its_host_gets_its_pinned_cpus_and_the_hosts_memory_disk_and_network(self):
        f = make_fleet(HOST_CFG, VM_CFG)
        give(f, "nas", host_view([vm("win-vm", [3.5, 16.0, 0, 2.0, 1.0], cpus="4-7,12-15")]))
        f.machines["win-vm"].status = "offline"
        self.assertEqual(self.one_vm(self.record(f, "nas")),
                         {"id": "win-vm", "status": "hostonly", "cap": [8, 64.0, 0, 800.0, 1250.0], "cpu": 3.5, "mem": 16.0})

    def test_a_vm_whose_host_does_not_say_its_cpus_may_use_all_of_the_hosts(self):
        f = make_fleet(HOST_CFG, VM_CFG)
        give(f, "nas", host_view([vm("win-vm", [3.5, 16.0, 0, 2.0, 1.0])]))
        f.machines["win-vm"].status = "offline"
        self.assertEqual(self.one_vm(self.record(f, "nas")),
                         {"id": "win-vm", "status": "hostonly", "cap": [16, 64.0, 0, 800.0, 1250.0], "cpu": 3.5, "mem": 16.0})

    def test_an_unconfigured_vm_is_measured_against_the_host_the_same_way(self):
        f = make_fleet(HOST_CFG)
        give(f, "nas", host_view([vm("lab", [1.0, 4.0, 0, 3.0, 2.0], cpus="0-3"), vm("idle", [0, 0, 0, 0, 0], running=False)]))
        spec = self.record(f, "nas")
        self.assertEqual([(v["id"], v["status"], v["cap"]) for v in spec["vms"]],
                         [("nas/vms/lab", "ok", [4, 64.0, 0, 800.0, 1250.0]), ("nas/vms/idle", "off", [16, 64.0, 0, 800.0, 1250.0])])

    def test_a_vm_reached_directly_keeps_its_own_capacity(self):
        f = make_fleet(HOST_CFG, VM_CFG)
        give(f, "nas", host_view([vm("win-vm", [3.5, 16.0, 0, 2.0, 1.0], cpus="4-7")]))
        give(f, "win-vm", view(ncpu=8, cap=[8, 32.0, 0.0, 300.0, 125.0], os="Windows"))
        v = self.record(f, "nas")["vms"][0]
        self.assertEqual((v["id"], v["status"], v["cap"]), ("win-vm", "ok", [8, 32.0, 0.0, 300.0, 125.0]))
        # what the host gives it, as a history (#206): its latest reading
        self.assertEqual({k: h[-1] for k, h in v["hostside"].items()}, {"cpu": 3.5, "mem": 16.0, "gpu": 0.0, "disk": 2.0, "net": 1.0})


VM2_CFG = {"id": "lab-vm", "name": "lab-vm", "ssh": "lab-vm", "os": "linux", "vm_on": "nas"}


class VmsOfAHostWithoutAReading(TreeTest):
    """#147: a host that has no reading still lists its configured VMs, each with what it knows of itself."""

    def api_fleet(self, f):
        with mock.patch.object(fleet_live, "load_pins", lambda: []), mock.patch.object(fleet_live, "load_tilepins", lambda: {}), \
                mock.patch.object(fleet_live, "load_prefs", lambda: {}):
            return f.api_fleet()

    def tree(self, f):
        """/api/fleet as (id, status, has_data) per machine, VMs nested."""
        def one(s):
            return (s["id"], s["status"], s["has_data"], [one(v) for v in s["vms"]])
        return [one(s) for s in self.api_fleet(f)["machines"]]

    def test_a_live_vm_under_a_host_without_a_reading_is_listed_with_its_data(self):
        f = make_fleet(HOST_CFG, VM_CFG)
        f.machines["nas"].status = "offline"
        give(f, "win-vm", view(ncpu=8, cap=[8, 32.0, 0.0, 300.0, 125.0], host=[1.5, 9.0, 0.0, 2.0, 1.0], os="Windows",
                               procs=[prow(40, "explorer.exe", "base", cpu=1.5)]))
        self.record(f, "nas")
        self.assertEqual(self.tree(f), [("nas", "offline", False, [("win-vm", "ok", True, [])])])
        v = self.api_fleet(f)["machines"][0]["vms"][0]
        self.assertEqual((v["cap"], v["base"]["h"]["cpu"][-1]), ([8, 32.0, 0.0, 300.0, 125.0], 1.5))
        self.assertEqual([(p[0], p[10]) for p in f.api_procs("win-vm")["procs"]], [(40, "win-vm/base")])

    def test_vms_without_readings_under_such_a_host_show_their_own_status_not_off(self):
        f = make_fleet(HOST_CFG, VM_CFG, VM2_CFG)
        f.machines["win-vm"].status = "offline"
        self.record(f, "nas")
        self.assertEqual(self.tree(f), [("nas", "connecting", False, [("win-vm", "offline", False, []), ("lab-vm", "connecting", False, [])])])

    def test_a_live_host_that_does_not_list_a_vm_still_says_it_is_off(self):
        f = make_fleet(HOST_CFG, VM_CFG)
        give(f, "nas", host_view([]))
        f.machines["win-vm"].status = "offline"
        self.record(f, "nas")
        self.assertEqual(self.tree(f), [("nas", "ok", True, [("win-vm", "off", False, [])])])

    def test_a_vm_of_another_host_is_not_listed_here(self):
        f = make_fleet(HOST_CFG, VM_CFG, {"id": "lx", "name": "lx", "ssh": "lx", "os": "linux"},
                       {"id": "lx-vm", "name": "lx-vm", "ssh": "lx-vm", "os": "linux", "vm_on": "lx"})
        self.record(f, "nas")
        self.record(f, "lx")
        self.assertEqual(self.tree(f), [("nas", "connecting", False, [("win-vm", "connecting", False, [])]),
                                        ("lx", "connecting", False, [("lx-vm", "connecting", False, [])])])


def busy_view(cpu, **over):
    """A host reading with a bit of everything that has a history: Base, a container, a job, a GPU, CPUs, an interface, a disk."""
    v = view(host=[cpu, 6.0, 20.0, 1.0, 0.5], cap=[4, 16.0, 100.0, 500.0, 125.0], gpus=[gpu("RTX A4000", 20.0)], gpu_procs=True,
             procs=[prow(10, "python3", "base", 20.0, [0], cpu=cpu)], containers=[container("abc123", "web", [0.5, 1.0, 0, 0, 0])],
             jobs=[job("rotate.sh", u=[0.1, 0.05, 0, 0, 0])], lcpus=[{"n": n, "pct": 10.0 * cpu} for n in range(4)],
             ifs=[{"name": "eth0", "kind": "physical", "rx": 0.25, "tx": 0.25}], disks=[{"name": "sda", "read": 0.5, "write": 0.5}])
    v.update(over)
    return v


def snapshot():
    with fleet_live.HIST.lock:
        return {k: [list(q) for q in v] for k, v in fleet_live.HIST.d.items()}


class OnlyLiveReadingsAreRecorded(TreeTest):
    """#163: a machine that isn't live shows its last reading, but its history waits instead of repeating it."""

    def tree(self, spec):
        def one(s):
            return (s["id"], s["status"], [one(v) for v in s["vms"]])
        return one(spec)

    def test_a_host_gone_offline_adds_nothing_to_any_history(self):
        f = make_fleet(HOST_CFG)
        m = give(f, "nas", busy_view(1.0))
        for cpu in (1.0, 2.0, 3.0):
            m.view = busy_view(cpu)
            self.record(f, "nas")
        before = snapshot()
        self.assertEqual(sorted(before), ["nas/__cpu/0", "nas/__cpu/1", "nas/__cpu/2", "nas/__cpu/3", "nas/__disk/sda", "nas/__host", "nas/__if/eth0",
                                          "nas/base", jid("nas", "rotate.sh", "crontab", "*/5 * * * *", "/usr/local/bin/rotate.sh"),
                                          "nas/base/gpu0", "nas/containers/web", "nas/gpu0/util"])
        m.status, m.error = "offline", "connection closed (exit 255)"
        for _ in range(3):
            spec = self.record(f, "nas")
        self.assertEqual(snapshot(), before)
        self.assertEqual((spec["status"], spec["has_data"], spec["base"]["h"]["cpu"][-4:]), ("offline", True, [0.0, 0.4, 1.4, 2.4]))   # less the container and the job
        m.view, m.status = busy_view(4.0), "ok"   # back: the next reading follows the last one taken
        self.assertEqual(self.record(f, "nas")["base"]["h"]["cpu"][-5:], [0.0, 0.4, 1.4, 2.4, 3.4])

    def test_a_restored_reading_waits_for_the_first_live_one(self):
        f = make_fleet(HOST_CFG)
        m = give(f, "nas", busy_view(2.0), status="connecting")   # as load_state leaves it
        self.record(f, "nas")
        self.assertEqual(snapshot(), {})

    def test_vms_under_a_host_that_is_not_live_show_their_own_state(self):
        f = make_fleet(HOST_CFG, VM_CFG, VM2_CFG)
        give(f, "nas", host_view([vm("win-vm", [3.5, 16.0, 0, 2.0, 1.0]), vm("lab", [1.0, 4.0, 0, 0, 0])]), status="offline")
        f.machines["win-vm"].status = "offline"
        spec = self.record(f, "nas")
        self.assertEqual(self.tree(spec), ("nas", "offline", [("win-vm", "offline", []), ("nas/vms/lab", "offline", []), ("lab-vm", "connecting", [])]))
        self.assertNotIn("hostside", spec["vms"][0])
        self.assertEqual(snapshot(), {})

    def test_a_live_vm_under_a_host_that_is_not_live_still_records_its_own_readings(self):
        f = make_fleet(HOST_CFG, VM_CFG)
        give(f, "nas", host_view([vm("win-vm", [3.5, 16.0, 0, 2.0, 1.0])]), status="offline")
        give(f, "win-vm", view(host=[1.5, 9.0, 0.0, 2.0, 1.0], os="Windows"))
        spec = self.record(f, "nas")
        self.assertEqual(self.tree(spec), ("nas", "offline", [("win-vm", "ok", [])]))
        self.assertEqual(sorted(snapshot()), ["win-vm/__host", "win-vm/base"])
        self.assertEqual(spec["vms"][0]["base"]["h"]["cpu"][-1], 1.5)

    def test_a_vm_seen_only_from_a_live_host_records_what_the_host_sees(self):
        f = make_fleet(HOST_CFG, VM_CFG)
        give(f, "nas", host_view([vm("win-vm", [3.5, 16.0, 0, 2.0, 1.0])]))
        f.machines["win-vm"].status = "offline"
        spec = self.record(f, "nas")
        self.assertEqual(self.tree(spec), ("nas", "ok", [("win-vm", "hostonly", [])]))
        self.assertEqual(snapshot()["win-vm/base"][0][-1], 3.5)


class GoneNodesAreForgotten(TreeTest):
    """#171: history for a container, interface or job that's gone is dropped, in memory and in state.json."""

    def setUp(self):
        super().setUp()
        self.tmp = tempfile.TemporaryDirectory()
        self.state = mock.patch.object(fleet_live, "STATE_PATH", os.path.join(self.tmp.name, "state.json"))
        self.state.start()

    def tearDown(self):
        self.state.stop()
        self.tmp.cleanup()
        super().tearDown()

    def saved_keys(self):
        with open(fleet_live.STATE_PATH) as f:
            return sorted(json.load(f)["hist"])

    def with_veth(self, cpu, veth):
        return busy_view(cpu, ifs=[{"name": "eth0", "kind": "physical", "rx": 0.25, "tx": 0.25}, {"name": veth, "kind": "virtual", "rx": 0.1, "tx": 0.1}],
                         containers=[container("c" + veth[-5:], "run-" + veth[-5:], [0.5, 1.0, 0, 0, 0])])

    def keys(self, mid, veth):
        return sorted(["%s/__cpu/%d" % (mid, n) for n in range(4)] + ["%s/__disk/sda" % mid, "%s/__host" % mid, "%s/__if/eth0" % mid,
                       "%s/__if/%s" % (mid, veth), mid + "/base", jid(mid, "rotate.sh", "crontab", "*/5 * * * *", "/usr/local/bin/rotate.sh"),
                       mid + "/base/gpu0", "%s/containers/run-%s" % (mid, veth[-5:]), mid + "/gpu0/util"])

    def test_a_restarted_container_and_its_old_veth_are_dropped_after_a_sweep(self):
        f = make_fleet(HOST_CFG)
        m = give(f, "nas", self.with_veth(1.0, "veth1a2b3"))
        for _ in range(10):
            f.record_pass()
        self.assertEqual((sorted(snapshot()), self.saved_keys()), (self.keys("nas", "veth1a2b3"), self.keys("nas", "veth1a2b3")))
        m.view = self.with_veth(1.0, "veth9f8e7")   # the container restarted: a new name and a new veth
        for _ in range(10):
            f.record_pass()
        self.assertEqual((sorted(snapshot()), self.saved_keys()), (self.keys("nas", "veth9f8e7"), self.keys("nas", "veth9f8e7")))

    def test_an_offline_machine_keeps_its_history_while_its_last_reading_is_shown(self):
        f = make_fleet(HOST_CFG)
        m = give(f, "nas", self.with_veth(1.0, "veth1a2b3"))
        f.record_pass()
        before = snapshot()
        m.status = "offline"
        for _ in range(25):
            f.record_pass()
        self.assertEqual(snapshot(), before)
        self.assertEqual(self.saved_keys(), self.keys("nas", "veth1a2b3"))

    def test_dead_keys_restored_from_an_old_state_file_go_at_the_first_sweep(self):
        f = make_fleet(HOST_CFG, {"id": "lx", "name": "lx", "ssh": "lx", "os": "linux"})
        give(f, "nas", self.with_veth(1.0, "veth1a2b3"))
        with fleet_live.HIST.lock:   # what an old state.json left: a veth long gone, and a machine no longer in the config
            fleet_live.HIST.d["nas/__if/veth00000"] = [collections.deque([0.5] * H, maxlen=H)] * 2
            fleet_live.HIST.d["old-host/base"] = [collections.deque([1.0] * H, maxlen=H)] * 5
        for _ in range(10):
            f.record_pass()
        self.assertEqual(sorted(snapshot()), self.keys("nas", "veth1a2b3"))
        self.assertEqual(sorted(f.specs), ["lx", "nas"])


def compose(cid, project, service, u, name=None, gkeys=()):
    c = container(cid, name or "%s-%s-1" % (project, service), u, gkeys, project, service)
    c["file"] = "/srv/%s/compose.yaml,/srv/%s/compose.override.yaml" % (project, project)
    return c


class TheTree(TreeTest):
    """#179: the whole tree for a machine, as an exact set, with the nothing-else controls."""

    def shape(self, spec):
        node = lambda n: (n["id"], n["name"], n.get("status", ""), n.get("g", []), n["h"]["cpu"][-1], n["h"]["mem"][-1])
        return {"base": (spec["base"]["id"], spec["base"]["g"], [spec["base"]["h"][k][-1] for k in fleet_live.METRICS]),
                "compose": [(p["id"], p["name"], p["file"], [node(s) for s in p["services"]]) for p in spec["compose"]],
                "containers": [node(c) for c in spec["containers"]],
                "jobs": [(j["id"], j["name"], j["running"], j["g"], j["h"]["cpu"][-1]) for j in spec["baseCron"]],
                "vms": [(v["id"], v["status"], [v["base"]["h"][k][-1] for k in fleet_live.METRICS]) for v in spec["vms"]],
                "owners": spec["procs_owner"]}

    def test_compose_projects_loose_containers_vms_and_jobs_with_base_as_what_is_left(self):
        f = make_fleet({"id": "lx", "name": "lx", "ssh": "lx", "os": "linux"}, {"id": "nas", "name": "nas", "ssh": "nas", "os": "linux"})
        conts = [compose("aaaaaa111111", "media", "web", [0.5, 1.0, 0, 0.25, 0.1]), compose("bbbbbb222222", "media", "web", [0.25, 1.0, 0, 0, 0.1], name="media-web-2"),
                 compose("cccccc333333", "media", "db", [0.25, 2.0, 0, 0.25, 0]), container("dddddd444444", "builder", [0.5, 0.5, 0, 0, 0.05]),
                 dict(container("eeeeee555555", "old", [0, 0, 0, 0, 0]), status="Exited (0) 2 hours ago")]
        give(f, "lx", view(host=[2.0, 5.0, 0.0, 1.0, 0.5], containers=conts, vms=[vm("lab", [0.25, 1.0, 0, 0.25, 0.05], cpus="2-3")],
                           jobs=[job("rotate.sh", u=[0.125, 0.25, 0, 0, 0]), job("backup.sh", sched="0 3 * * *")]))
        give(f, "nas", view(containers=[compose("ffffff666666", "media", "web", [1.0, 1.0, 0, 0, 0])]))   # same names, another host
        r = lambda: jid("lx", "rotate.sh", "crontab", "*/5 * * * *", "/usr/local/bin/rotate.sh")
        b = lambda: jid("lx", "backup.sh", "crontab", "0 3 * * *", "/usr/local/bin/backup.sh")
        self.assertEqual(self.shape(self.record(f, "lx")), {
            # 2.0 cores less 1.5 in containers, 0.25 in the VM and 0.125 in a job; 5 GB less 4.5, 1 and 0.25 is below 0, so 0
            "base": ("lx/base", [], [0.125, 0.0, 0.0, 0.25, 0.2]),
            "compose": [("lx/compose/media", "media", "/srv/media/compose.yaml",
                         [("lx/compose/media/db", "db", "Up 1 hour", [], 0.25, 2.0), ("lx/compose/media/web", "web", "Up 1 hour", [], 0.5, 1.0),
                          ("lx/compose/media/web-bbbbbb", "web", "Up 1 hour", [], 0.25, 1.0)])],
            "containers": [("lx/containers/builder", "builder", "Up 1 hour", [], 0.5, 0.5), ("lx/containers/old", "old", "Exited (0) 2 hours ago", [], 0.0, 0.0)],
            "jobs": [(r(), "rotate.sh", True, [], 0.125), (b(), "backup.sh", False, [], 0.0)],
            "vms": [("lx/vms/lab", "ok", [0.25, 1.0, 0.0, 0.25, 0.05])],
            "owners": {"cont": {"aaaaaa111111": "lx/compose/media/web", "bbbbbb222222": "lx/compose/media/web-bbbbbb", "cccccc333333": "lx/compose/media/db",
                                "dddddd444444": "lx/containers/builder", "eeeeee555555": "lx/containers/old"}, "vm": {"lab": "lx/vms/lab"}}})
        nas = self.shape(self.record(f, "nas"))
        self.assertEqual((nas["compose"], nas["containers"], nas["jobs"], nas["vms"]),
                         ([("nas/compose/media", "media", "/srv/media/compose.yaml", [("nas/compose/media/web", "web", "Up 1 hour", [], 1.0, 1.0)])], [], [], []))

    def test_api_fleet_sends_no_processes_at_any_level(self):
        f = make_fleet(HOST_CFG, VM_CFG)
        give(f, "nas", host_view([vm("win-vm", [3.5, 16.0, 0, 2.0, 1.0])], procs=[prow(10, "qemu", "vm:win-vm")]))
        give(f, "win-vm", view(procs=[prow(40, "explorer.exe", "base")]))
        self.record(f, "nas")
        with mock.patch.object(fleet_live, "load_pins", lambda: []), mock.patch.object(fleet_live, "load_tilepins", lambda: {}), \
                mock.patch.object(fleet_live, "load_prefs", lambda: {}):
            out = f.api_fleet()
        def keys(s):
            return [sorted({"procs", "procs_owner"} & set(s))] + [keys(v) for v in s["vms"]]
        self.assertEqual([keys(s) for s in out["machines"]], [[[], [[]]]])
        self.assertEqual(([p[10] for p in f.api_procs("nas")["procs"]], [p[10] for p in f.api_procs("win-vm")["procs"]]), (["win-vm"], ["win-vm/base"]))


class SavedState(TreeTest):
    """#179: the last readings and history survive a restart; nothing too old, and nothing for machines no longer configured."""

    def setUp(self):
        super().setUp()
        self.tmp = tempfile.TemporaryDirectory()
        self.state = mock.patch.object(fleet_live, "STATE_PATH", os.path.join(self.tmp.name, "state.json"))
        self.state.start()

    def tearDown(self):
        self.state.stop()
        self.tmp.cleanup()
        super().tearDown()

    def test_a_restart_gets_the_last_reading_without_processes_and_the_history_back(self):
        f = make_fleet(HOST_CFG, {"id": "lx", "name": "lx", "ssh": "lx", "os": "linux"})
        m = give(f, "nas", busy_view(1.0))
        m.last_ok = 1234.5
        for cpu in (1.0, 2.0):
            m.view = busy_view(cpu)
            self.record(f, "nas")
        fleet_live.save_state(f)
        hist = snapshot()
        fleet_live.HIST = fleet_live.Hist()
        g = make_fleet(HOST_CFG, {"id": "lx", "name": "lx", "ssh": "lx", "os": "linux"})
        fleet_live.load_state(g)
        n = g.machines["nas"]
        self.assertEqual((n.view, n.last_ok, n.status), (dict(busy_view(2.0), procs=[]), 1234.5, "connecting"))
        self.assertEqual((g.machines["lx"].view, g.machines["lx"].status), (None, "connecting"))
        self.assertEqual(snapshot(), hist)

    def test_a_state_file_over_six_hours_old_is_left_alone(self):
        f = make_fleet(HOST_CFG)
        give(f, "nas", busy_view(1.0))
        self.record(f, "nas")
        with mock.patch.object(fleet_live.time, "time", lambda: 1_000_000.0):
            fleet_live.save_state(f)
        fleet_live.HIST = fleet_live.Hist()
        g = make_fleet(HOST_CFG)
        with mock.patch.object(fleet_live.time, "time", lambda: 1_000_000.0 + 6 * 3600 + 1):
            fleet_live.load_state(g)
        self.assertEqual((g.machines["nas"].view, snapshot()), (None, {}))

    def test_a_machine_no_longer_configured_gets_no_reading(self):
        f = make_fleet(HOST_CFG, {"id": "old-host", "name": "old-host", "ssh": "old-host", "os": "linux"})
        give(f, "old-host", busy_view(1.0))
        fleet_live.save_state(f)
        g = make_fleet(HOST_CFG)
        fleet_live.load_state(g)
        self.assertEqual(list(g.machines), ["nas"])
        self.assertIsNone(g.machines["nas"].view)


if __name__ == "__main__":
    unittest.main()
