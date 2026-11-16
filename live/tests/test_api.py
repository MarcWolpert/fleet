# SPDX-License-Identifier: GPL-3.0-or-later
"""The per-machine APIs: /api/procs puts every process on the tree node it runs in, /api/cpus, /api/ifs and
/api/disks describe one machine's processors, interfaces and disks, /api/net matches machines to tailnet
peers, and nested VMs are found at any depth. The machine's tree is built the way the server builds it
(derive_linux, then Fleet.machine_spec) from hand-made readings shaped like collect_linux.py's output, so a
process whose node the tree doesn't know shows up here.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import os
import sys
import json
import threading
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import fleet_live  # noqa: E402


def proc(pid, ppid, comm, cid="", vm="", unit="", cmd=None):
    """One collect_linux.py process row: pid, ppid, comm, state, ticks, rss, threads, user, io bytes,
    container id, vm, systemd unit, cmd, last cpu."""
    return [pid, ppid, comm, "S", 100, 1 << 20, 2, "root", 0, cid, vm, unit, cmd or "/usr/bin/" + comm, 0]


def container(cid, name, project="", service=""):
    return {"id": cid, "name": name, "project": project, "service": service, "file": "/srv/%s/compose.yaml" % project if project else "",
            "image": name + ":latest", "status": "Up 2 days", "networks": "bridge", "rx": 0, "tx": 0}


def reading(procs, containers=(), vms=(), cron=(), timers=(), t=1000.0):
    return {"t": t, "ncpu": 4, "hz": 100, "cpu": [10, 0, 10, 100, 0, 0, 0, 0],
            "lcpus": [{"n": n, "t": [1, 0, 1, 10, 0, 0, 0, 0], "core": str(n), "l3": "0", "kind": "", "pkg": "0"} for n in range(4)],
            "mem": [16 << 30, 8 << 30], "disk": 0, "ifs": {}, "procs": list(procs), "containers": list(containers), "vms": list(vms),
            "cron": list(cron), "timers": list(timers), "gpus": [], "gproc": [], "os": "Linux", "arch": "x86_64", "cpu_model": "test",
            "uptime": 1, "dockernets": []}


def iface(rx=0, tx=0, phys=False, bridge=False, master="", speed="-1"):
    return {"rx": rx, "tx": tx, "phys": phys, "bridge": bridge, "master": master, "state": "up", "speed": speed, "addrs": []}


def fleet_of(*cfgs):
    """A Fleet holding these machines, without its threads or saved state."""
    f = fleet_live.Fleet.__new__(fleet_live.Fleet)
    f.cfg, f.interval, f.tick, f.lock = {}, 3.0, 0, threading.Lock()
    f.machines = {c["id"]: fleet_live.Machine(c, 3) for c in cfgs}
    f.specs = {}
    return f


def build(f, mid, r, record=False):
    """What the server does for one reading: derive the machine's view, then build the tree from it."""
    m = f.machines[mid]
    m.view = m.derive_linux(r)
    f.specs = {mid: f.machine_spec(m, record=record)}
    return f.specs[mid]


ZEROS = [0.0] * fleet_live.H


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


class NestedVms(unittest.TestCase):
    """A VM Fleet also watches from inside is a machine of its own, at any depth: its processes go on its own
    tree, and a VM inside it is found too."""

    def setUp(self):
        self.f = fleet_of({"id": "nas", "name": "nas", "os": "linux", "ssh": "nas"},
                          {"id": "lab", "name": "lab", "os": "linux", "ssh": "lab", "vm_on": "nas", "domain": "lab"},
                          {"id": "inner", "name": "inner", "os": "linux", "ssh": "inner", "vm_on": "lab", "domain": "inner-vm"})
        for mid, r in (("inner", reading([proc(1, 0, "systemd"), proc(80, 1, "nginx", cid="dddddddddddd")],
                                         containers=[container("dddddddddddd", "web")])),
                       ("lab", reading([proc(1, 0, "systemd"), proc(60, 1, "postgres", cid="eeeeeeeeeeee"),
                                        proc(61, 1, "qemu-system-x86", vm="inner-vm", cmd="qemu-system-x86_64 -name guest=inner-vm")],
                                       containers=[container("eeeeeeeeeeee", "db", "lab", "db")], vms=[{"name": "inner-vm", "ifs": []}])),
                       ("nas", reading([proc(1, 0, "systemd"), proc(501, 1, "qemu-system-x86", vm="lab", cmd="qemu-system-x86_64 -name guest=lab")],
                                       vms=[{"name": "lab", "ifs": []}]))):
            m = self.f.machines[mid]
            m.view = m.derive_linux(r)
        self.f.specs = {"nas": self.f.machine_spec(self.f.machines["nas"], record=False)}

    def test_every_machine_is_found_at_its_depth_and_nothing_else(self):
        found = {mid: (fleet_live.find_spec(self.f.specs, mid) or {}).get("id") for mid in ("nas", "lab", "inner", "inner-vm", "nope")}
        self.assertEqual(found, {"nas": "nas", "lab": "lab", "inner": "inner", "inner-vm": None, "nope": None})
        self.assertEqual([v["id"] for v in self.f.specs["nas"]["vms"]], ["lab"])
        self.assertEqual([v["id"] for v in self.f.specs["nas"]["vms"][0]["vms"]], ["inner"])

    def test_each_machine_puts_its_processes_on_its_own_tree(self):
        nodes = {mid: {p[0]: p[10] for p in self.f.api_procs(mid)["procs"]} for mid in ("nas", "lab", "inner")}
        self.assertEqual(nodes, {"nas": {1: "nas/base", 501: "lab"},
                                 "lab": {1: "lab/base", 60: "lab/compose/lab/db", 61: "inner"},
                                 "inner": {1: "inner/base", 80: "inner/containers/web"}})

    def test_a_machine_fleet_doesnt_know_or_has_no_reading_yet_has_no_processes(self):
        self.f.machines["inner"].view = None
        self.assertEqual((self.f.api_procs("nope"), self.f.api_procs("inner")), ({"procs": []}, {"procs": []}))


class ApiCpus(unittest.TestCase):
    def test_each_logical_cpu_with_its_load_and_history(self):
        f = fleet_of({"id": "cpus-host", "name": "cpus-host", "os": "linux", "ssh": "cpus-host"})
        r = reading([proc(1, 0, "systemd")])
        for c in r["lcpus"]:
            c["mhz"] = 3600 + 100 * c["n"]
        build(f, "cpus-host", r)
        r2 = reading([proc(1, 0, "systemd")], t=1003.0)
        for c in r2["lcpus"]:
            c["mhz"], c["t"] = 3600 + 100 * c["n"], [4, 0, 4, 12, 0, 0, 0, 0] if c["n"] % 2 else [1, 0, 1, 16, 0, 0, 0, 0]
        build(f, "cpus-host", r2, record=True)
        self.assertEqual(f.api_cpus("cpus-host"), {
            "model": "test", "groups": [{"name": "All processors", "cpus": [0, 1, 2, 3]}],
            "cpus": [{"n": n, "mhz": 3600 + 100 * n, "core": str(n), "pct": 75.0 if n % 2 else 0.0, "h": ZEROS[1:] + [75.0 if n % 2 else 0.0]}
                     for n in range(4)]})

    def test_a_machine_fleet_doesnt_know_or_has_no_reading_yet(self):
        f = fleet_of({"id": "quiet", "name": "quiet", "os": "linux", "ssh": "quiet"})
        self.assertEqual((f.api_cpus("nope"), f.api_cpus("quiet")), ({}, {}))


class ApiIfs(unittest.TestCase):
    """Interfaces a person can pick: no loopback and no container veths; a bridge says how many interfaces and
    containers are on it, a tap says which VM it belongs to, a Docker network's bridge says which network."""

    def setUp(self):
        self.f = fleet_of({"id": "nas", "name": "nas", "os": "linux", "ssh": "nas"})
        self.r = reading([proc(1, 0, "systemd")], vms=[{"name": "win11", "ifs": [{"if": "vnet0", "source": "br0", "mac": "52:54:00:00:00:01"}]}])
        self.r["ifs"] = {"lo": iface(), "eth0": iface(phys=True, master="br0", speed="1000"), "br0": iface(bridge=True),
                         "vnet0": iface(master="br0"), "docker0": iface(bridge=True), "veth1a2b3c4": iface(master="docker0"),
                         "veth5d6e7f8": iface(master="docker0"), "br-0123456789ab": iface(bridge=True), "veth9a8b7c6": iface(master="br-0123456789ab"),
                         "wg0": iface()}
        self.r["dockernets"] = [{"id": "aaaaaaaaaaaa", "name": "bridge", "driver": "bridge"}, {"id": "0123456789ab", "name": "media_default", "driver": "bridge"},
                                {"id": "bbbbbbbbbbbb", "name": "br0", "driver": "ipvlan"}, {"id": "cccccccccccc", "name": "host", "driver": "host"}]

    def test_every_interface_with_what_is_on_it_and_nothing_else(self):
        build(self.f, "nas", self.r)
        out = self.f.api_ifs("nas")
        self.assertIs(out["per_process"], True)
        self.assertEqual({x["name"]: (x["kind"], x["vm"], x["dnet"], x["members"], x["containers"]) for x in out["ifs"]}, {
            "eth0": ("physical", "", "", 0, 0),
            "br0": ("bridge", "", "br0", 2, 0),               # eth0 and win11's tap; also the ipvlan Docker network br0
            "vnet0": ("virtual", "win11", "", 0, 0),
            "docker0": ("bridge", "", "bridge", 0, 2),
            "br-0123456789ab": ("bridge", "", "media_default", 0, 1),
            "wg0": ("virtual", "", "", 0, 0)})
        self.assertEqual(out["ifs"][0], {"name": "eth0", "kind": "physical", "rx": 0.0, "tx": 0.0, "addrs": [], "master": "br0", "state": "up",
                                         "speed": "1000", "hrx": ZEROS, "htx": ZEROS, "vm": "", "dnet": "", "members": 0, "containers": 0})

    def test_a_machine_fleet_doesnt_know_or_has_no_reading_yet(self):
        self.assertEqual((self.f.api_ifs("nope"), self.f.api_ifs("nas")), ({"ifs": []}, {"ifs": []}))


class ApiDisks(unittest.TestCase):
    def test_each_disk_with_its_rates_and_history(self):
        f = fleet_of({"id": "disks-host", "name": "disks-host", "os": "linux", "ssh": "disks-host"})
        disk = {"name": "sdb", "model": "WDC WD80EFZZ", "size": 8 << 40, "rot": True, "role": "array disk 1", "mounts": ["/mnt/disk1"]}
        r = reading([proc(1, 0, "systemd")])
        r["disks"] = [dict(disk, r=0, w=0, ms=0)]
        build(f, "disks-host", r)
        r2 = reading([proc(1, 0, "systemd")], t=1002.0)
        r2["disks"] = [dict(disk, r=6_000_000, w=2_000_000, ms=500)]
        build(f, "disks-host", r2, record=True)
        self.assertEqual(f.api_disks("disks-host"), {"per_process": True, "disks": [
            dict(disk, read=3.0, write=1.0, busy=25.0, hr=ZEROS[1:] + [3.0], hw=ZEROS[1:] + [1.0])]})

    def test_only_linux_says_which_disk_each_process_uses(self):
        f = fleet_of({"id": "x", "name": "x"})
        got = {}
        for os_name in ("Ubuntu 24.04.1 LTS", "Unraid 7.1.4", "macOS 26.1", "Microsoft Windows 11 Pro", "Windows"):
            f.machines["x"].view = {"os": os_name, "disks": []}
            got[os_name] = f.api_disks("x")
        self.assertEqual(got, {"Ubuntu 24.04.1 LTS": {"disks": [], "per_process": True}, "Unraid 7.1.4": {"disks": [], "per_process": True},
                               "macOS 26.1": {"disks": [], "per_process": False}, "Microsoft Windows 11 Pro": {"disks": [], "per_process": False},
                               "Windows": {"disks": [], "per_process": False}})
        f.machines["x"].view = None
        self.assertEqual((f.api_disks("x"), f.api_disks("nope")), ({"disks": [], "per_process": False}, {"disks": []}))


TAILSCALE = {
    "MagicDNSSuffix": "example-tailnet.ts.net.",
    "Self": {"HostName": "laptop", "TailscaleIPs": ["100.64.0.1", "fd7a:115c:a1e0::1"], "Online": True, "OS": "macOS",
             "RxBytes": 0, "TxBytes": 0, "Relay": "", "CurAddr": ""},
    "Peer": {
        "nodekey:01": {"HostName": "nas", "TailscaleIPs": ["100.64.0.2"], "Online": True, "OS": "linux",
                       "RxBytes": 1000, "TxBytes": 2000, "Relay": "fra", "CurAddr": "192.0.2.10:41641"},
        "nodekey:02": {"HostName": "win-desktop", "TailscaleIPs": ["100.64.0.3"], "Online": False, "OS": "windows",
                       "RxBytes": 5, "TxBytes": 6, "Relay": "fra", "CurAddr": ""},
        "nodekey:03": {"HostName": "garden-pi", "TailscaleIPs": ["100.64.0.4"], "Online": True, "OS": "linux",
                       "RxBytes": 7, "TxBytes": 8, "Relay": "ams", "CurAddr": "192.0.2.20:41641"}}}


def ts_peer(ip, online, os_name, rx, tx, relay, direct):
    return {"ip": ip, "online": online, "os": os_name, "rx": rx, "tx": tx, "relay": relay, "direct": direct}


class ApiNet(unittest.TestCase):
    """The network view: each machine matched to its tailnet peer by host name, by the IP it's reached at, by
    its own tailscale name, or (this computer) by its own name; no peer for a machine that isn't on the tailnet."""

    def setUp(self):
        self.f = fleet_of({"id": "mac", "name": "This Mac", "kind": "local"},
                          {"id": "nas", "name": "nas", "os": "linux", "ssh": "root@nas.example-tailnet.ts.net"},
                          {"id": "win", "name": "win-desktop", "os": "windows", "ssh": "user@100.64.0.3"},
                          {"id": "pi", "name": "Garden", "os": "linux", "ssh": "pi@192.0.2.20", "tailscale": "garden-pi"},
                          {"id": "lab", "name": "lab", "os": "linux", "ssh": "lab", "vm_on": "nas"})
        self.f.machines["nas"].view = {"ifs": [{"name": "eth0", "kind": "physical", "rx": 1.5, "tx": 0.5}],
                                       "containers": [{"name": "redis", "networks": "bridge", "u": [0.1, 0.2, 0.0, 0.0, 0.25]}],
                                       "vms": [{"name": "lab", "ifs": [{"if": "vnet0", "source": "br0"}], "u": [0.5, 2.0, 0.0, 0.0, 0.75]}],
                                       "dockernets": [{"id": "aaaaaaaaaaaa", "name": "bridge", "driver": "bridge"}]}
        self.f.machines["nas"].status = "ok"

    def net(self, out):
        with mock.patch.object(fleet_live, "run", return_value=out) as run, mock.patch.object(fleet_live.platform, "node", return_value="laptop.local"):
            got = self.f.api_net()
        self.assertEqual(run.call_args.args[0][1:], ["status", "--json"])
        return got

    def test_every_machine_with_its_peer_and_what_runs_on_it(self):
        out = self.net(json.dumps(TAILSCALE))
        self.assertEqual((out["tailnet"], out["window_s"]), ("example-tailnet.ts.net", 3.0 * fleet_live.H))
        self.assertEqual({m["id"]: m["tailscale"] for m in out["machines"]}, {
            "mac": ts_peer("100.64.0.1", True, "macOS", 0, 0, "", False),
            "nas": ts_peer("100.64.0.2", True, "linux", 1000, 2000, "fra", True),
            "win": ts_peer("100.64.0.3", False, "windows", 5, 6, "fra", False),
            "pi": ts_peer("100.64.0.4", True, "linux", 7, 8, "ams", True),
            "lab": None})
        nas = next(m for m in out["machines"] if m["id"] == "nas")
        self.assertEqual({k: v for k, v in nas.items() if k != "tailscale"}, {
            "id": "nas", "name": "nas", "status": "ok", "error": "", "vm_on": "",
            "ifs": [{"name": "eth0", "kind": "physical", "rx": 1.5, "tx": 0.5, "hrx": ZEROS, "htx": ZEROS}],
            "containers": [{"name": "redis", "networks": "bridge", "net": 0.25}],
            "vms": [{"name": "lab", "ifs": [{"if": "vnet0", "source": "br0"}], "net": 0.75}],
            "dockernets": [{"id": "aaaaaaaaaaaa", "name": "bridge", "driver": "bridge"}]})
        lab = next(m for m in out["machines"] if m["id"] == "lab")
        self.assertEqual(lab, {"id": "lab", "name": "lab", "status": "connecting", "error": "", "vm_on": "nas", "tailscale": None,
                               "ifs": [], "containers": [], "vms": [], "dockernets": []})

    def test_without_tailscale_no_machine_has_a_peer(self):
        for out in ("", "tailscale: command not found"):
            got = self.net(out)
            self.assertEqual((got["tailnet"], {m["id"]: m["tailscale"] for m in got["machines"]}),
                             ("tailnet", {"mac": None, "nas": None, "win": None, "pi": None, "lab": None}), out)


if __name__ == "__main__":
    unittest.main()
