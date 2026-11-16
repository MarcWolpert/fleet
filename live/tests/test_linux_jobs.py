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


B_SH = {"sched": "0 3 * * *", "cmd": "/usr/local/bin/b.sh", "src": "crontab"}
HOURLY = {"sched": "17 * * * *", "cmd": "cd / && run-parts --report /etc/cron.hourly", "src": "/etc/crontab"}
REPORT = {"sched": "0 * * * *", "cmd": "python3 /opt/jobs/report.py", "src": "crontab"}
SYNC = {"sched": "*/10 * * * *", "cmd": "python3 /opt/jobs/sync.py", "src": "crontab"}
DUMP = {"sched": "30 2 * * *", "cmd": "pg_dump shop > /backups/db-$(date +\\%F).sql", "src": "crontab"}


class JobsByCommand(unittest.TestCase):
    """A process cron started belongs to the job whose command it runs, and to no other job."""

    def test_only_the_job_that_runs_is_running(self):
        m = derive(HOST + [
            proc(700, 500, "cron", "/usr/sbin/CRON -f", 0.01),           # cron's per-job child: cron itself, Base
            proc(701, 700, "sh", "/bin/sh -c /usr/local/bin/b.sh", 0.04),
            proc(702, 701, "b.sh", "/bin/bash /usr/local/bin/b.sh", 1.0),
        ], cron=[A_SH, B_SH, HOURLY])
        self.assertEqual(jobs(m), [("a.sh", False, IDLE), ("b.sh", True, [1.04, 0.0, 0.0, 0.0, 0.0]), ("cron.hourly", False, IDLE)])
        self.assertEqual(nodes(m), {1: "m1/base", 500: "m1/base", 600: "m1/base", 700: "m1/base", 701: "m1/base/cron/1", 702: "m1/base/cron/1"})

    def test_jobs_with_one_interpreter_stay_apart(self):
        m = derive(HOST + [
            proc(710, 500, "cron", "/usr/sbin/CRON -f"),
            proc(711, 710, "sh", "/bin/sh -c python3 /opt/jobs/sync.py"),
            proc(712, 711, "python3", "python3 /opt/jobs/sync.py", 0.5),
        ], cron=[REPORT, SYNC])
        self.assertEqual(jobs(m), [("report.py", False, IDLE), ("sync.py", True, [0.5, 0.0, 0.0, 0.0, 0.0])])
        self.assertEqual(nodes(m), {1: "m1/base", 500: "m1/base", 600: "m1/base", 710: "m1/base", 711: "m1/base/cron/1", 712: "m1/base/cron/1"})

    def test_a_shell_that_execs_the_lone_command(self):
        # dash and bash exec a lone command in place of themselves: cron's child is the script itself.
        m = derive(HOST + [proc(720, 500, "cron", "/usr/sbin/CRON -f"), proc(721, 720, "b.sh", "/bin/bash /usr/local/bin/b.sh", 0.75)],
                   cron=[A_SH, B_SH])
        self.assertEqual(jobs(m), [("a.sh", False, IDLE), ("b.sh", True, [0.75, 0.0, 0.0, 0.0, 0.0])])
        self.assertEqual(nodes(m), {1: "m1/base", 500: "m1/base", 600: "m1/base", 720: "m1/base", 721: "m1/base/cron/1"})

    def test_a_percent_sign_is_what_cron_hands_the_shell(self):
        # crontab(5): \% is a literal %; the shell gets the line with it unescaped.
        m = derive(HOST + [
            proc(730, 500, "cron", "/usr/sbin/CRON -f"),
            proc(731, 730, "sh", "/bin/sh -c pg_dump shop > /backups/db-$(date +%F).sql"),
            proc(732, 731, "pg_dump", "pg_dump shop", 0.5),
        ], cron=[A_SH, DUMP])
        self.assertEqual(jobs(m), [("a.sh", False, IDLE), ("pg_dump", True, [0.5, 0.0, 0.0, 0.0, 0.0])])
        self.assertEqual(nodes(m), {1: "m1/base", 500: "m1/base", 600: "m1/base", 730: "m1/base", 731: "m1/base/cron/1", 732: "m1/base/cron/1"})


BACKUP = {"sched": "0 4 * * *", "cmd": "/usr/local/bin/backup.sh", "src": "crontab"}


class WholeRun(unittest.TestCase):
    """Everything a job's run starts, however deep, is the job's; nothing outside the run is."""

    def test_the_work_under_the_script_is_the_jobs(self):
        m = derive(HOST + [
            proc(740, 500, "cron", "/usr/sbin/CRON -f", 0.01),
            proc(741, 740, "sh", "/bin/sh -c /usr/local/bin/backup.sh", 0.01),
            proc(742, 741, "backup.sh", "/bin/bash /usr/local/bin/backup.sh", 0.05),
            proc(743, 742, "tar", "tar -czf /backups/home.tgz /home", 1.0),
            proc(744, 743, "gzip", "gzip", 0.5),
            proc(745, 742, "rsync", "rsync -a /backups/ nas:/backups/", 0.25),
            proc(750, 1, "tar", "tar -xf /tmp/other.tar", 0.5),     # the same program, not started by cron: Base
        ], cron=[A_SH, BACKUP])
        self.assertEqual(jobs(m), [("a.sh", False, IDLE), ("backup.sh", True, [1.81, 0.0, 0.0, 0.0, 0.0])])
        self.assertEqual(nodes(m), {1: "m1/base", 500: "m1/base", 600: "m1/base", 740: "m1/base", 741: "m1/base/cron/1", 742: "m1/base/cron/1",
                                    743: "m1/base/cron/1", 744: "m1/base/cron/1", 745: "m1/base/cron/1", 750: "m1/base"})
        self.assertEqual(base(m), [1.01, 0.0, 0.0, 0.0, 0.0], "Base keeps sshd, cron's child and the other tar")

    def test_a_job_of_busybox_crond(self):
        # busybox crond starts sh -c <the job> itself, with no per-job child.
        m = derive([proc(1, 0, "init", "/sbin/init"), proc(500, 1, "crond", "/usr/sbin/crond -f"),
                    proc(741, 500, "sh", "/bin/sh -c /usr/local/bin/backup.sh"),
                    proc(742, 741, "backup.sh", "/bin/sh /usr/local/bin/backup.sh"),
                    proc(743, 742, "tar", "tar -czf /backups/home.tgz /home", 1.0)], cron=[BACKUP])
        self.assertEqual(jobs(m), [("backup.sh", True, [1.0, 0.0, 0.0, 0.0, 0.0])])
        self.assertEqual(nodes(m), {1: "m1/base", 500: "m1/base", 741: "m1/base/cron/0", 742: "m1/base/cron/0", 743: "m1/base/cron/0"})


# systemctl list-timers --all --no-legend --no-pager, as collect_linux.py keeps it (the line before the unit names)
LOGROTATE = {"timer": "logrotate.timer", "unit": "logrotate.service",
             "line": "Mon 2026-11-16 00:00:00 PST 9h left Sun 2026-11-15 00:00:00 PST 14h ago"}
APT_DAILY = {"timer": "apt-daily.timer", "unit": "apt-daily.service",
             "line": "Mon 2026-11-16 06:12:40 PST 15h left Sun 2026-11-15 07:44:02 PST 6h ago"}


class Timers(unittest.TestCase):
    """A timer's service runs as its own unit: its processes are the timer's, under the timer's node."""

    def m(self):
        return derive(HOST + [
            proc(800, 1, "logrotate", "/usr/sbin/logrotate /etc/logrotate.conf", 0.5, unit="logrotate.service"),
            proc(801, 800, "gzip", "gzip", 0.25, unit="logrotate.service"),
            proc(820, 1, "nginx", "nginx: master process /usr/sbin/nginx", 0.25, unit="nginx.service"),  # a service with no timer: Base
        ], cron=[A_SH], timers=[LOGROTATE, APT_DAILY])

    def test_the_timer_that_runs_is_running(self):
        self.assertEqual(jobs(self.m()), [("a.sh", False, IDLE), ("logrotate", True, [0.75, 0.0, 0.0, 0.0, 0.0]), ("apt-daily", False, IDLE)])

    def test_its_processes_are_under_the_timer(self):
        self.assertEqual(nodes(self.m()), {1: "m1/base", 500: "m1/base", 600: "m1/base", 800: "m1/base/cron/1", 801: "m1/base/cron/1",
                                           820: "m1/base"})

    def test_base_keeps_the_rest(self):
        self.assertEqual(base(self.m()), [0.75, 0.0, 0.0, 0.0, 0.0], "sshd and nginx")


if __name__ == "__main__":
    unittest.main()
