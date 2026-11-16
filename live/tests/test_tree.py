# SPDX-License-Identifier: GPL-3.0-or-later
"""The machine tree the server builds from each machine's latest view (Fleet.machine_spec, /api/fleet), and the
history it keeps for every node. Views are shaped like what derive_linux, derive_windows and the macOS collector
return; nothing is read from any machine and no thread is started.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import collections
import os
import sys
import threading
import unittest
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


if __name__ == "__main__":
    unittest.main()
