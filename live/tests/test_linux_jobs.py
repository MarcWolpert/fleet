# SPDX-License-Identifier: GPL-3.0-or-later
"""Scheduled jobs on a Linux host (crontab lines and systemd timers): which processes run each job, the
job's usage (a breakdown of Base system, never added on top), whether it is running, when it last ran,
and the tree node /api/procs puts each process under. Readings are shaped like collect_linux.py's.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import os
import sys
import threading
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import fleet_live  # noqa: E402

HZ = 100
T0 = 1000.0
IDLE = [0.0] * 5


def proc(pid, ppid, comm, cmd, cores=0.0, cid="", unit=""):
    """One process of a reading: it uses `cores` CPU cores between the two readings derive() takes."""
    return (pid, ppid, comm, cmd, cores, cid, unit)


def reading(t, procs, cron=(), timers=(), containers=()):
    """The host's CPU is busy for exactly what its processes use."""
    rows = [[pid, ppid, comm, "S", 1000 + int(round(cores * HZ * (t - T0))), 0, 1, "root", 0, cid, "", unit, cmd, 0]
            for pid, ppid, comm, cmd, cores, cid, unit in procs]
    busy = sum(p[4] for p in procs)
    cpu = [1000 + int(round(busy * HZ * (t - T0))), 0, 0, 1000 + int(round((4 - busy) * HZ * (t - T0))), 0, 0, 0, 0]
    return {"t": t, "ncpu": 4, "hz": HZ, "cpu": cpu, "lcpus": [], "mem": [16 << 30, 16 << 30], "disk": 0,
            "ifs": {}, "procs": rows, "containers": [dict(c) for c in containers], "vms": [], "cron": list(cron), "timers": list(timers),
            "gpus": [], "gproc": [], "os": "Linux", "arch": "x86_64", "cpu_model": "test", "uptime": 1, "dockernets": []}


def derive(procs, **kw):
    """A machine after two readings 3 s apart (the first only sets where the counters start)."""
    m = fleet_live.Machine({"id": "m1", "name": "m1"}, 3)
    m.derive_linux(reading(T0, procs, **kw))
    m.view = m.derive_linux(reading(T0 + 3, procs, **kw))
    return m


def fleet(m):
    f = fleet_live.Fleet.__new__(fleet_live.Fleet)
    f.machines, f.lock = {"m1": m}, threading.Lock()
    f.specs = {"m1": f.machine_spec(m, True)}
    return f


def nodes(m):
    """pid -> the tree node /api/procs puts the process under."""
    return {p[0]: p[10] for p in fleet(m).api_procs("m1")["procs"]}


def base(m):
    """Base system's usage now, as the tree shows it."""
    h = fleet(m).specs["m1"]["base"]["h"]
    return [round(h[k][-1], 3) for k in fleet_live.METRICS]


def jobs(m):
    return [(j["name"], j["running"], [round(x, 3) for x in j["u"]]) for j in m.view["jobs"]]


def container(cid, name):
    return {"id": cid, "name": name, "image": name + ":latest", "status": "Up 2 hours", "project": "", "service": "", "file": "",
            "networks": "", "rx": 0, "tx": 0}


HOST = [proc(1, 0, "systemd", "/sbin/init"), proc(500, 1, "cron", "/usr/sbin/cron -f"), proc(600, 1, "sshd", "sshd: /usr/sbin/sshd -D", 0.5)]
A_SH = {"sched": "*/5 * * * *", "cmd": "/usr/local/bin/a.sh", "src": "crontab"}


class ContainerCron(unittest.TestCase):
    """A container's own cron daemon runs the container's jobs; they are the container's, not the host's."""

    APP, WEB = "c0ffee000001", "c0ffee000002"

    def m(self):
        return derive(HOST + [
            proc(900, 1, "containerd-shim", "/usr/bin/containerd-shim-runc-v2 -namespace moby -id c0ffee000001", unit="containerd.service"),
            # busybox crond (Alpine image): crond, then sh -c <the job>
            proc(901, 900, "crond", "crond -f -l 8", cid=self.APP),
            proc(902, 901, "sh", "/bin/sh -c php /var/www/cron.php", 0.5, cid=self.APP),
            proc(903, 902, "php", "php /var/www/cron.php", 1.0, cid=self.APP),
            # Debian cron (Debian-based image): cron, its per-job CRON child, sh -c <the job>
            proc(910, 1, "containerd-shim", "/usr/bin/containerd-shim-runc-v2 -namespace moby -id c0ffee000002", unit="containerd.service"),
            proc(911, 910, "cron", "cron -f", cid=self.WEB),
            proc(912, 911, "cron", "/usr/sbin/CRON -f", cid=self.WEB),
            proc(913, 912, "sh", "/bin/sh -c /usr/local/bin/a.sh", 0.25, cid=self.WEB),
        ], cron=[A_SH], containers=[container(self.APP, "app"), container(self.WEB, "web")])

    def test_the_host_job_stays_idle(self):
        self.assertEqual(jobs(self.m()), [("a.sh", False, IDLE)])

    def test_each_process_is_under_its_container(self):
        self.assertEqual(nodes(self.m()), {1: "m1/base", 500: "m1/base", 600: "m1/base", 900: "m1/base", 901: "m1/containers/app", 902: "m1/containers/app",
                                           903: "m1/containers/app", 910: "m1/base", 911: "m1/containers/web", 912: "m1/containers/web",
                                           913: "m1/containers/web"})

    def test_the_usage_is_the_containers_once(self):
        m = self.m()
        self.assertEqual({c["name"]: [round(x, 3) for x in c["u"]] for c in m.view["containers"]},
                         {"app": [1.5, 0.0, 0.0, 0.0, 0.0], "web": [0.25, 0.0, 0.0, 0.0, 0.0]})
        self.assertEqual(base(m), [0.5, 0.0, 0.0, 0.0, 0.0], "Base is the host's sshd: the containers' cron work is taken out once")


if __name__ == "__main__":
    unittest.main()
