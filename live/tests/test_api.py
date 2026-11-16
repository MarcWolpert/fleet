# SPDX-License-Identifier: GPL-3.0-or-later
"""The per-machine APIs: /api/procs puts every process on the tree node it runs in. The machine's tree is
built the way the server builds it (derive_linux, then Fleet.machine_spec) from a hand-made reading shaped
like collect_linux.py's output, so a process whose node the tree doesn't know shows up here.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import os
import sys
import threading
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import fleet_live  # noqa: E402


def proc(pid, ppid, comm, cid="", vm="", unit="", cmd=None):
    """One collect_linux.py process row: pid, ppid, comm, state, ticks, rss, threads, user, io bytes,
    container id, vm, systemd unit, cmd, last cpu."""
    return [pid, ppid, comm, "S", 100, 1 << 20, 2, "root", 0, cid, vm, unit, cmd or "/usr/bin/" + comm, 0]


def container(cid, name, project="", service=""):
    return {"id": cid, "name": name, "project": project, "service": service, "file": "/srv/%s/compose.yaml" % project if project else "",
            "image": name + ":latest", "status": "Up 2 days", "networks": "bridge", "rx": 0, "tx": 0}


def reading(procs, containers=(), vms=(), cron=(), timers=()):
    return {"t": 1000.0, "ncpu": 4, "hz": 100, "cpu": [10, 0, 10, 100, 0, 0, 0, 0],
            "lcpus": [{"n": n, "t": [1, 0, 1, 10, 0, 0, 0, 0], "core": str(n), "l3": "0", "kind": "", "pkg": "0"} for n in range(4)],
            "mem": [16 << 30, 8 << 30], "disk": 0, "ifs": {}, "procs": list(procs), "containers": list(containers), "vms": list(vms),
            "cron": list(cron), "timers": list(timers), "gpus": [], "gproc": [], "os": "Linux", "arch": "x86_64", "cpu_model": "test",
            "uptime": 1, "dockernets": []}


def fleet_of(*cfgs):
    """A Fleet holding these machines, without its threads or saved state."""
    f = fleet_live.Fleet.__new__(fleet_live.Fleet)
    f.cfg, f.interval, f.tick, f.lock = {}, 3.0, 0, threading.Lock()
    f.machines = {c["id"]: fleet_live.Machine(c, 3) for c in cfgs}
    f.specs = {}
    return f


def build(f, mid, r):
    """What the server does for one reading: derive the machine's view, then build the tree from it."""
    m = f.machines[mid]
    m.view = m.derive_linux(r)
    f.specs = {mid: f.machine_spec(m, record=False)}
    return f.specs[mid]


class ProcsNode(unittest.TestCase):
    """Every process lands on the node it runs in: a Compose service, a container, a VM, a cron job, a systemd
    timer's job, or Base system for everything else."""

    def setUp(self):
        self.f = fleet_of({"id": "nas", "name": "nas", "os": "linux", "ssh": "nas"},
                          {"id": "lab", "name": "lab", "os": "linux", "ssh": "lab", "vm_on": "nas", "domain": "lab"})
        self.r = reading(
            procs=[proc(1, 0, "systemd"),
                   proc(200, 1, "cron", unit="cron.service"),
                   proc(201, 200, "rsync-backup.sh", unit="cron.service", cmd="/bin/bash /usr/local/bin/rsync-backup.sh"),
                   proc(300, 1, "restic", unit="backup.service", cmd="/usr/bin/restic backup /srv"),
                   proc(301, 300, "ssh", unit="backup.service", cmd="ssh backup-host restic serve"),
                   proc(310, 1, "certbot", unit="certbot.service", cmd="/usr/bin/certbot renew"),
                   proc(320, 1, "sshd", unit="ssh.service", cmd="/usr/sbin/sshd -D"),
                   proc(400, 1, "jellyfin", cid="aaaaaaaaaaaa"),
                   proc(401, 1, "redis-server", cid="bbbbbbbbbbbb"),
                   proc(402, 1, "gone", cid="cccccccccccc"),
                   proc(500, 1, "qemu-system-x86", vm="win11", cmd="qemu-system-x86_64 -name guest=win11"),
                   proc(501, 1, "qemu-system-x86", vm="lab", cmd="qemu-system-x86_64 -name guest=lab")],
            containers=[container("aaaaaaaaaaaa", "media-jellyfin-1", "media", "jellyfin"), container("bbbbbbbbbbbb", "redis")],
            vms=[{"name": "win11", "ifs": []}, {"name": "lab", "ifs": []}],
            cron=[{"sched": "0 3 * * *", "cmd": "/usr/local/bin/rsync-backup.sh", "src": "crontab"}],
            timers=[{"timer": "backup.timer", "unit": "backup.service", "line": "Sun 2026-11-15 03:00:00 UTC 5h left Sat 2026-11-14 03:00:00 UTC 19h ago"},
                    {"timer": "certbot.timer", "unit": "certbot.service", "line": "Sun 2026-11-15 12:00:00 UTC 14h left - -"}])

    def nodes(self):
        build(self.f, "nas", self.r)
        return {p[0]: p[10] for p in self.f.api_procs("nas")["procs"]}

    def test_the_tree_has_one_job_per_cron_line_and_timer(self):
        spec = build(self.f, "nas", self.r)
        self.assertEqual([(j["id"], j["name"], j["cmd"]) for j in spec["baseCron"]],
                         [("nas/base/cron/0", "rsync-backup.sh", "/usr/local/bin/rsync-backup.sh"),
                          ("nas/base/cron/1", "backup", "backup.service"), ("nas/base/cron/2", "certbot", "certbot.service")])

    def test_every_process_is_on_the_node_it_runs_in(self):
        self.assertEqual(self.nodes(), {
            1: "nas/base", 200: "nas/base", 320: "nas/base",   # the OS and its daemons, cron itself included
            201: "nas/base/cron/0",                              # a crontab line cron is running
            300: "nas/base/cron/1", 301: "nas/base/cron/1",      # backup.timer's backup.service, child process too
            310: "nas/base/cron/2",                              # certbot.timer's certbot.service
            400: "nas/compose/media/jellyfin", 401: "nas/containers/redis",
            402: "nas/base",                                     # its container isn't running any more
            500: "nas/vms/win11",                                # a VM Fleet only sees from the host
            501: "lab",                                          # a VM Fleet also watches from inside
        })

    def test_a_unit_no_timer_starts_stays_in_base_system(self):
        self.r["timers"] = [t for t in self.r["timers"] if t["unit"] != "backup.service"]
        n = self.nodes()
        self.assertEqual({pid: n[pid] for pid in (300, 301, 310)}, {300: "nas/base", 301: "nas/base", 310: "nas/base/cron/1"})

    def test_a_cron_line_and_a_timer_with_the_same_text_stay_apart(self):
        # A crontab line whose command reads like a unit name doesn't claim that unit's processes.
        self.r["cron"].append({"sched": "@daily", "cmd": "backup.service", "src": "crontab"})
        build(self.f, "nas", self.r)
        jobs = {j["id"]: (j["name"], j["src"]) for j in self.f.specs["nas"]["baseCron"]}
        self.assertEqual(jobs, {"nas/base/cron/0": ("rsync-backup.sh", "crontab"), "nas/base/cron/1": ("backup.service", "crontab"),
                                "nas/base/cron/2": ("backup", "systemd"), "nas/base/cron/3": ("certbot", "systemd")})
        n = self.nodes()
        self.assertEqual({pid: n[pid] for pid in (201, 300, 301, 310)},
                         {201: "nas/base/cron/0", 300: "nas/base/cron/2", 301: "nas/base/cron/2", 310: "nas/base/cron/3"})


if __name__ == "__main__":
    unittest.main()
