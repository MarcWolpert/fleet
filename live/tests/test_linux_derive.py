# SPDX-License-Identifier: GPL-3.0-or-later
"""derive_linux: what Fleet Live makes of collect_linux.py's readings, per process and per group.
Readings are hand-made in the collector's shape; every assertion is the complete result.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import os
import sys
import threading
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


# One host, nas, 8 CPUs, read twice 3 s apart. Its Compose project "web" (db, app), two loose containers
# (proxy on Docker's default bridge, metrics on the host network), a container that exited after ps
# listed its process, a libvirt VM on br0, and the host's own dockerd and sshd.
A, B, C, D, E = "aaaaaaaaaaa1", "bbbbbbbbbbb2", "ccccccccccc3", "ddddddddddd4", "eeeeeeeeeee5"
GiB = 1 << 30
#        pid, comm, cores, mem GB, container, vm, unit, disk bytes over the 3 s
PROCS = [(1, "systemd", 0.0, 0.0, "", "", "", 0),
         (200, "dockerd", 0.25, 0.125, "", "", "docker.service", 0),
         (300, "postgres", 1.0, 1.0, A, "", "", 3e6),
         (301, "python3", 0.5, 0.5, B, "", "", 0),
         (302, "nginx", 0.25, 0.0625, C, "", "", 0),
         (303, "node_exporter", 0.1, 0.0, D, "", "", 0),
         (304, "sleep", 0.5, 0.0, E, "", "", 0),
         (400, "qemu-system-x86", 2.0, 4.0, "", "fleet-lab", "", 0),
         (500, "sshd", 0.25, 0.0, "", "", "ssh.service", 0)]


def nas(i):
    """Reading i (0 or 1) of nas: counters at 3 s * i."""
    t, dt = T0 + 3 * i, 3 * i
    procs = [[pid, 1, comm, "S", 1000 + int(round(cores * 100 * dt)), int(mem * GiB), 2, "root", 1000 + int(io * i), cid, vm, unit,
              "/usr/bin/" + comm, 0] for pid, comm, cores, mem, cid, vm, unit, io in PROCS]
    busy = sum(p[2] for p in PROCS)

    def nic(rx, tx, **kw):
        return dict({"rx": 1000 + int(rx * i), "tx": 1000 + int(tx * i), "phys": False, "master": "", "bridge": False, "state": "up",
                     "speed": "", "addrs": []}, **kw)

    def ctr(cid, name, project, service, networks, net):
        return {"id": cid, "name": name, "image": name + ":1", "status": "Up 3 days", "project": project, "service": service,
                "file": "/srv/web/compose.yml" if project else "", "networks": networks, "rx": 1000 + int(net * i), "tx": 1000}
    return {
        "t": t, "ncpu": 8, "hz": 100, "cpu": [1000 + int(round(busy * 100 * dt)), 0, 0, 1000 + int(round((8 - busy) * 100 * dt)), 0, 0, 0, 0],
        "lcpus": [], "mem": [32 * GiB, 24 * GiB], "disk": 1000 + int(9e6 * i),
        "ifs": {"eth0": nic(6e6, 3e6, phys=True, master="br0", speed="1000"), "br0": nic(1.8e6, 0, bridge=True, addrs=["198.51.100.5/24"]),
                "docker0": nic(0, 0, bridge=True), "br-0123456789ab": nic(3e5, 3e5, bridge=True), "vnet0": nic(9e5, 4.5e5, master="br0"),
                "lo": nic(3e6, 3e6, state="unknown")},
        "procs": procs,
        "containers": [ctr(A, "web-db-1", "web", "db", "web_default", 1.5e6), ctr(B, "web-app-1", "web", "app", "web_default,br0", 0),
                       ctr(C, "proxy", "", "", "bridge", 3e6), ctr(D, "metrics", "", "", "host", 0)],
        "dockernets": [{"id": "0123456789ab", "name": "web_default", "driver": "bridge"}, {"id": "fedcba987654", "name": "bridge", "driver": "bridge"},
                       {"id": "111111111111", "name": "host", "driver": "host"}, {"id": "222222222222", "name": "br0", "driver": "macvlan"}],
        "vms": [{"name": "fleet-lab", "ifs": [{"if": "vnet0", "source": "br0", "mac": "52:54:00:00:00:01"}]}], "vm_cpus": {"fleet-lab": "4-7"},
        "pdisks": {"300": ["sda"], "500": ["nvme0n1"]},
        "cdisks": {A: {"sda": 1000 + int(2e6 * i), "sdb": 1000 + int(1e6 * i)}, B: {"sda": 5000}},
        "pnet": {"500": {"ifs": ["eth0"], "b": int(1.5e6 * i)}},
        "disks": [{"name": "sda", "model": "WDC WD40EFRX", "size": 4000787030016, "rot": True, "role": "disk1", "mounts": ["/mnt/disk1"],
                   "r": 1000 + int(3e6 * i), "w": 1000 + int(6e6 * i), "ms": 1000 + 1500 * i},
                  {"name": "nvme0n1", "model": "Samsung SSD 980", "size": 1000204886016, "rot": False, "role": "cache", "mounts": ["/mnt/cache"],
                   "r": 1000, "w": 1000 + int(3e5 * i), "ms": 1000 + 30 * i}],
        "cron": [], "timers": [], "gpus": [], "gproc": [], "os": "Unraid 7.0.0", "arch": "x86_64", "cpu_model": "test", "uptime": 86400}


def r3(xs):
    return [round(x, 4) for x in xs]


class Attribution(unittest.TestCase):
    """Every process, container, VM, interface and disk of one host reading, and where each goes."""

    @classmethod
    def setUpClass(cls):
        cls.m = fleet_live.Machine({"id": "nas", "name": "nas"}, 3)
        cls.m.derive_linux(nas(0))
        cls.v = cls.m.derive_linux(nas(1))
        cls.m.got(cls.v)   # a reading arrives

    def test_host(self):
        self.assertEqual(r3(self.v["host"]), [4.85, 8.0, 0.0, 3.0, 3.0], "cpu, memory used, gpu, disk MB/s, physical network MB/s")
        self.assertEqual(self.v["cap"], [8, 32.0, 0.0, 500.0, 125.0], "1 Gb/s eth0 is 125 MB/s")

    def test_containers(self):
        self.assertEqual({c["name"]: (r3(c["u"]), c["gu"]) for c in self.v["containers"]}, {   # gu: per GPU, and this host has none
            "web-db-1": ([1.0, 1.0, 0.0, 1.0, 0.5], []), "web-app-1": ([0.5, 0.5, 0.0, 0.0, 0.0], []),
            "proxy": ([0.25, 0.0625, 0.0, 0.0, 1.0], []), "metrics": ([0.1, 0.0, 0.0, 0.0, 0.0], [])})

    def test_vms(self):
        self.assertEqual([dict(x, u=r3(x["u"])) for x in self.v["vms"]], [
            {"name": "fleet-lab", "u": [2.0, 4.0, 0.0, 0.0, 0.45], "gu": [], "running": True, "cpus": "4-7",
             "ifs": [{"if": "vnet0", "source": "br0", "mac": "52:54:00:00:00:01"}]}])

    def test_each_process(self):
        # owner, disks it uses (its own and its container's), interfaces it talks through, network MB/s
        self.assertEqual({p[0]: (p[11], p[14], p[15], round(p[16], 4)) for p in self.v["procs"]}, {
            1: ("base", [], [], 0.0),
            200: ("base", [], [], 0.0),                                         # a service with no timer is Base
            300: ("c:" + A, ["sda", "sdb"], ["br-0123456789ab"], 0.0),           # its own sda and its container's sdb
            301: ("c:" + B, [], ["br-0123456789ab", "br0"], 0.0),               # its container did no I/O; on a macvlan too
            302: ("c:" + C, [], ["docker0"], 0.0),
            303: ("c:" + D, [], [], 0.0),                                        # the host network is no bridge of its own
            304: ("c:" + E, [], [], 0.0),                                        # an exited container lends nothing
            400: ("vm:fleet-lab", [], ["br0", "vnet0"], 0.0),
            500: ("base", ["nvme0n1"], ["eth0"], 0.5)})
        self.assertEqual({p[0]: r3([p[5], p[6], p[7]]) for p in self.v["procs"]}, {pid: [cores, mem, io / 3e6] for pid, _, cores, mem, _, _, _, io in PROCS})

    def test_interfaces(self):
        self.assertEqual([(x["name"], x["kind"], round(x["rx"], 4), round(x["tx"], 4), x["master"], x["addrs"]) for x in self.v["ifs"]], [
            ("eth0", "physical", 2.0, 1.0, "br0", []), ("br0", "bridge", 0.6, 0.0, "", ["198.51.100.5/24"]), ("docker0", "bridge", 0.0, 0.0, "", []),
            ("br-0123456789ab", "bridge", 0.1, 0.1, "", []), ("vnet0", "virtual", 0.3, 0.15, "br0", []), ("lo", "loopback", 1.0, 1.0, "", [])])

    def test_disks(self):
        self.assertEqual(self.v["disks"], [
            {"name": "sda", "model": "WDC WD40EFRX", "size": 4000787030016, "rot": True, "role": "disk1", "mounts": ["/mnt/disk1"],
             "read": 1.0, "write": 2.0, "busy": 50.0},
            {"name": "nvme0n1", "model": "Samsung SSD 980", "size": 1000204886016, "rot": False, "role": "cache", "mounts": ["/mnt/cache"],
             "read": 0.0, "write": 0.1, "busy": 1.0}])

    def test_tree_and_base(self):
        f = fleet_live.Fleet.__new__(fleet_live.Fleet)
        f.machines, f.lock = {"nas": self.m}, threading.Lock()
        f.specs = {"nas": f.machine_spec(self.m, True)}
        self.assertEqual({p[0]: p[10] for p in f.api_procs("nas")["procs"]}, {
            1: "nas/base", 200: "nas/base", 300: "nas/compose/web/db", 301: "nas/compose/web/app", 302: "nas/containers/proxy",
            303: "nas/containers/metrics", 304: "nas/base", 400: "nas/vms/fleet-lab", 500: "nas/base"})
        h = f.specs["nas"]["base"]["h"]
        self.assertEqual([round(h[k][-1], 4) for k in fleet_live.METRICS], [1.0, 2.4375, 0.0, 2.0, 1.05],
                         "Base: dockerd, the exited container's sleep and sshd; what no container or VM holds")


def lcpu(n, core, l3, pkg="0", kind=""):
    return {"n": n, "pct": 0.0, "mhz": 0, "core": str(core), "l3": l3, "kind": kind, "pkg": pkg}


class LcpuGroups(unittest.TestCase):
    """Logical processors grouped as the hardware is: P- and E-cores, CCDs (one L3 each), sockets."""

    def groups(self, lcpus):
        return [(g["name"], g["cpus"]) for g in fleet_live.group_lcpus_linux(lcpus)]

    def test_one_l3(self):
        self.assertEqual(self.groups([lcpu(n, n, "0-3") for n in range(4)]), [("All processors", [0, 1, 2, 3])])

    def test_ccds_in_order_of_their_first_cpu(self):
        self.assertEqual(self.groups([lcpu(n, n % 8, "8-15" if n >= 8 else "0-7") for n in (8, 0, 9, 1)]), [("CCD 1", [8, 9]), ("CCD 0", [0, 1])])

    def test_hybrid(self):
        cpus = [lcpu(0, 0, "0-5", kind="P"), lcpu(1, 0, "0-5", kind="P"), lcpu(2, 4, "0-5", kind="E"), lcpu(3, 5, "0-5", kind="E")]
        self.assertEqual(self.groups(cpus), [("P-cores", [0, 1]), ("E-cores", [2, 3])])

    def test_sockets(self):
        cpus = [lcpu(0, 0, "0-1", "0"), lcpu(1, 1, "0-1", "0"), lcpu(2, 0, "2-3", "1"), lcpu(3, 1, "2-3", "1")]
        self.assertEqual(self.groups(cpus), [("Socket 0 · CCD 0", [0, 1]), ("Socket 1 · CCD 1", [2, 3])])


class HumanCron(unittest.TestCase):
    def test_schedules(self):
        cases = {"*/5 * * * *": "every 5 min", "17 * * * *": "hourly at :17", "0 */6 * * *": "every 6 h", "30 2 * * *": "daily at 02:30",
                 "47 6 * * 7": "weekly (7) at 06:47", "52 6 1 * *": "monthly, day 1 at 06:52", "@reboot": "reboot", "@daily": "daily",
                 "*/15 9-17 * * 1-5": "*/15 9-17 * * 1-5", "0 0 1 1 *": "0 0 1 1 *"}
        self.assertEqual({s: fleet_live.human_cron(s) for s in cases}, cases)


if __name__ == "__main__":
    unittest.main()
