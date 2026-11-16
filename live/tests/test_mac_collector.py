# SPDX-License-Identifier: GPL-3.0-or-later
"""The macOS collector (MacCollector), fed hand-made command output shaped like a real Mac's. No command
runs and nothing on this machine is read: every command line the collector runs is answered from a table,
and host_processor_info from a fake libc. Every assertion is the exact result.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import contextlib, ctypes, importlib.util, json, os, plistlib, subprocess, sys, tempfile, threading, types, unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)
argv, sys.argv = sys.argv, ["fleet_live.py"]
try:
    spec = importlib.util.spec_from_file_location("fleet_live_mac_test", os.path.join(LIVE, "fleet_live.py"))
    fl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fl)
finally:
    sys.argv = argv

GB = 2**30
MIB = 2**20


def cpus_plist(types_by_cpu):
    """ioreg -rd1 -c IOPlatformDevice -k cluster-type -a: one entry per CPU, cpu-id and cluster-type as data."""
    return plistlib.dumps([{"IOObjectClass": "IOPlatformDevice", "cpu-id": n.to_bytes(4, "little"), "cluster-type": t.encode() + b"\0"}
                           for n, t in enumerate(types_by_cpu)], fmt=plistlib.FMT_XML)


def perflevels(*levels):
    """sysctl hw.nperflevels and hw.perflevelN.*: (name, cpusperl2, logicalcpu) per level, fastest first."""
    out = {"sysctl -n hw.nperflevels": "%d\n" % len(levels)}
    for i, (name, per_l2, count) in enumerate(levels):
        out["sysctl -n hw.perflevel%d.name" % i] = name + "\n"
        out["sysctl -n hw.perflevel%d.cpusperl2" % i] = "%d\n" % per_l2
        out["sysctl -n hw.perflevel%d.logicalcpu" % i] = "%d\n" % count
    return out


# An M1 (4 efficiency cores 0-3, 4 performance cores 4-7) with 16 GB.
BASE = dict({
    "sysctl -n hw.logicalcpu": "8\n",
    "sysctl -n hw.memsize": "17179869184\n",
    "sysctl -n machdep.cpu.brand_string": "Apple M1\n",
    "ioreg -rd1 -c IOPlatformDevice -k cluster-type -a": cpus_plist("EEEEPPPP"),
    "system_profiler SPDisplaysDataType -json": json.dumps({"SPDisplaysDataType": [{"_name": "Apple M1", "sppci_model": "Apple M1"}]}),
    "sysctl -n kern.boottime": "{ sec = 1000, usec = 0 } Thu Jan  1 00:16:40 1970\n",
}, **perflevels(("Performance", 4, 4), ("Efficiency", 4, 4)))


class FakeLibc:
    """host_processor_info answers from `ticks` (user, system, idle, nice per CPU) in an array it hands
    over, as the kernel does; vm_deallocate records what is given back."""

    def __init__(self, ticks):
        self.ticks, self.arrays, self.handed, self.freed = ticks, [], [], []

    def mach_host_self(self):
        return 3

    def mach_task_self(self):
        return 5

    def host_processor_info(self, host, flavor, count, info, n_info):
        flat = [x for t in self.ticks for x in t]
        arr = (ctypes.c_int * len(flat))(*flat)
        self.arrays.append(arr)
        self.handed.append((ctypes.addressof(arr), len(flat) * ctypes.sizeof(ctypes.c_int)))
        count._obj.value = len(self.ticks)
        info._obj.contents = ctypes.c_int.from_buffer(arr)
        n_info._obj.value = len(flat)
        return 0

    def vm_deallocate(self, task, addr, size):
        self.freed.append((task, getattr(addr, "value", addr), getattr(size, "value", size)))
        return 0


class FakeProc:
    """A command started with Popen: it runs until the test finishes it, printing `text` into its stdout."""

    def __init__(self, mac, cmd, stdout):
        self.cmd, self.stdout, self.done, self.killed = " ".join(cmd), stdout, False, False
        mac.started.append(self)

    def finish(self, text):
        self.stdout.write(text.encode())
        self.stdout.flush()
        self.done = True

    def poll(self):
        return 0 if self.done else None

    def kill(self):
        self.killed = self.done = True

    def wait(self, timeout=None):
        return 0


class Mac:
    """A Mac that exists only as command output. `out` maps each command line to what it prints (str or
    bytes); a command that is not in it prints nothing, which is what run() makes of a failure. A command
    in `slow` waits for its event before it prints. Popen'd commands are in `started` (FakeProc)."""

    def __init__(self, out=None, now=10000.0, ticks=None, docker=True):
        self.out = dict(BASE, **(out or {}))
        self.calls = []
        self.started = []
        self.slow = {}
        self.now = now
        self.libc = FakeLibc(ticks or [[100, 50, 800, 0]] * 8)
        self.docker = docker
        self.responsible = {}   # pid -> the process macOS holds responsible for it (#210); none: it can't tell

    def run(self, cmd, **kw):
        line = " ".join(cmd)
        self.calls.append(line)
        if line in self.slow:
            self.slow[line].wait(10)
        o = self.out.get(line, "")
        return types.SimpleNamespace(stdout=o if isinstance(o, bytes) else o.encode(), stderr=b"", returncode=0)

    def popen(self, cmd, stdout=None, stderr=None, **kw):
        return FakeProc(self, cmd, stdout)

    def collector(self, test):
        """A MacCollector reading this Mac; the fakes stay patched in until the test ends."""
        stack = contextlib.ExitStack()
        test.addCleanup(stack.close)
        self.home = stack.enter_context(tempfile.TemporaryDirectory())
        stack.enter_context(mock.patch.object(fl, "subprocess", types.SimpleNamespace(run=self.run, Popen=self.popen, PIPE=subprocess.PIPE, DEVNULL=subprocess.DEVNULL)))
        stack.enter_context(mock.patch.object(fl, "shutil", types.SimpleNamespace(which=lambda n: "/usr/local/bin/docker" if self.docker and n == "docker" else None)))
        stack.enter_context(mock.patch.object(fl, "platform", types.SimpleNamespace(mac_ver=lambda: ("15.1", ("", "", ""), "arm64"),
                                                                                     machine=lambda: "arm64", system=lambda: "Darwin")))
        stack.enter_context(mock.patch.object(fl, "time", types.SimpleNamespace(time=lambda: self.now, sleep=lambda s: None)))
        stack.enter_context(mock.patch.dict(os.environ, {"HOME": self.home}))
        stack.enter_context(mock.patch.object(fl.MacCollector, "responsible_pid", staticmethod(lambda pid: self.responsible.get(pid, 0))))
        c = fl.MacCollector()
        c.libc = self.libc
        return c


DOCKER_PS = "docker ps --no-trunc --format {{json .}}"
DOCKER_STATS = "docker stats --no-stream --format {{json .}}"
WEB_ID, MIGRATE_ID, IDLE_ID = "a1b2c3d4e5f6" + "1" * 52, "0f9e8d7c6b5a" + "2" * 52, "99aa88bb77cc" + "3" * 52


def jsonl(*rows):
    return "".join(json.dumps(r) + "\n" for r in rows)


# docker ps then docker stats: "migrate" exits between the two, so docker stats prints "--" for all its fields.
CONTAINERS = [
    {"ID": WEB_ID, "Names": "blog-web-1", "Image": "nginx:1.27", "Status": "Up 2 hours", "Networks": "blog_default",
     "Labels": "com.docker.compose.project=blog,com.docker.compose.service=web,com.docker.compose.project.config_files=/srv/blog/compose.yaml"},
    {"ID": MIGRATE_ID, "Names": "migrate", "Image": "blog-migrate:latest", "Status": "Up 1 second", "Networks": "bridge", "Labels": ""},
    {"ID": IDLE_ID, "Names": "idle", "Image": "busybox:1.36", "Status": "Up 3 days", "Networks": "bridge", "Labels": ""},
]
STATS = [
    {"BlockIO": "4.1MB / 1.2MB", "CPUPerc": "12.50%", "Container": WEB_ID[:12], "ID": WEB_ID[:12], "MemPerc": "1.28%",
     "MemUsage": "100MiB / 7.654GiB", "Name": "blog-web-1", "NetIO": "1.5kB / 3kB", "PIDs": "9"},
    {"BlockIO": "-- / --", "CPUPerc": "--", "Container": MIGRATE_ID[:12], "ID": MIGRATE_ID[:12], "MemPerc": "--",
     "MemUsage": "-- / --", "Name": "--", "NetIO": "-- / --", "PIDs": "--"},
    {"BlockIO": "0B / 0B", "CPUPerc": "0.00%", "Container": IDLE_ID[:12], "ID": IDLE_ID[:12], "MemPerc": "0.01%",
     "MemUsage": "1MiB / 7.654GiB", "Name": "idle", "NetIO": "0B / 0B", "PIDs": "1"},
]
EXPECTED_CONTAINERS = [
    {"id": WEB_ID[:12], "name": "blog-web-1", "image": "nginx:1.27", "status": "Up 2 hours", "project": "blog", "service": "web",
     "file": "/srv/blog/compose.yaml", "networks": "blog_default", "u": [0.125, 100 * MIB / GB, 0.0, 0.0, 0.0], "netrx": 0.0, "nettx": 0.0},
    {"id": MIGRATE_ID[:12], "name": "migrate", "image": "blog-migrate:latest", "status": "Up 1 second", "project": "", "service": "",
     "file": "", "networks": "bridge", "u": [0.0, 0.0, 0.0, 0.0, 0.0], "netrx": 0.0, "nettx": 0.0},
    {"id": IDLE_ID[:12], "name": "idle", "image": "busybox:1.36", "status": "Up 3 days", "project": "", "service": "",
     "file": "", "networks": "bridge", "u": [0.0, 1 * MIB / GB, 0.0, 0.0, 0.0], "netrx": 0.0, "nettx": 0.0},
]


class DockerStatsItCannotRead(unittest.TestCase):
    """#101: docker stats prints "--" for a container it cannot read (one that exits or is removed while it
    reads). That container counts as idle; the reading itself goes on."""

    def test_mac_reading_goes_on_and_the_container_counts_as_idle(self):
        mac = Mac({DOCKER_PS: jsonl(*CONTAINERS), DOCKER_STATS: jsonl(*STATS)})
        snap = mac.collector(self).snapshot()
        self.assertEqual(snap["containers"], EXPECTED_CONTAINERS)

    def test_windows_reading_goes_on_and_the_container_counts_as_idle(self):
        r = {"t": 1000.0, "ncpu": 4, "lcpus": [{"n": n, "pct": 5.0, "mhz": 3000} for n in range(4)], "topo": [], "gpus": [], "nvidia": [],
             "videoNames": [], "gproc": [], "procs": [], "ifs": [], "wsl": [], "tasks": [], "mem": [16 * GB, 8 * GB], "diskBps": 0,
             "os": "Windows", "disks": [], "containers": [json.dumps(c) for c in CONTAINERS], "dstats": [json.dumps(s) for s in STATS]}
        view = fl.Machine({"id": "win-desktop", "name": "win-desktop", "os": "windows"}, 3).derive_windows(r)
        self.assertEqual(view["containers"], EXPECTED_CONTAINERS)


HELPER_ID = "5e1f0e1f0e1f" + "4" * 52
# a throwaway container Fleet starts to look inside a process in Docker Desktop's VM (#218), as docker ps lists it
HELPER_CMD = fl.docker_vm_inspect_cmd("abc123def456", 3615, "helper", "", 0)[0]
HELPER = {"ID": HELPER_ID, "Names": "eager_turing", "Image": fl.HELPER_IMAGE, "Status": "Up 1 second", "Networks": "none",
          "Labels": HELPER_CMD[HELPER_CMD.index("--label") + 1]}   # the label Fleet starts it with
HELPER_STATS = {"BlockIO": "0B / 0B", "CPUPerc": "35.00%", "Container": HELPER_ID[:12], "ID": HELPER_ID[:12], "MemPerc": "0.40%",
                "MemUsage": "30MiB / 7.654GiB", "Name": "eager_turing", "NetIO": "0B / 0B", "PIDs": "1"}


class FleetsOwnHelpers(unittest.TestCase):
    """PR 273 review: Fleet's own helper containers (label fleet.helper) are not the user's containers. While a process's
    drop-down looks through a helper, a new one lives about 1.8 s per look, and most readings caught one: a randomly
    named python:3.12-slim container came and went under Containers, with its usage in the containers' totals."""

    def test_a_helper_container_is_not_listed(self):
        mac = Mac({DOCKER_PS: jsonl(CONTAINERS[0], HELPER, *CONTAINERS[1:]), DOCKER_STATS: jsonl(STATS[0], HELPER_STATS, *STATS[1:])})
        self.assertEqual(mac.collector(self).snapshot()["containers"], EXPECTED_CONTAINERS)

    def test_nothing_else_a_label_that_only_looks_like_it_is_listed(self):
        like = dict(HELPER, Labels="com.example.fleet.helper=inspect,fleet.helpers=1")
        mac = Mac({DOCKER_PS: jsonl(like), DOCKER_STATS: jsonl(HELPER_STATS)})
        self.assertEqual([c["name"] for c in mac.collector(self).snapshot()["containers"]], ["eager_turing"])


class CpuTicks(unittest.TestCase):
    """#102: host_processor_info hands this process an array the kernel allocated; the collector owns it
    and gives it back after every reading, so the server's memory stays flat."""

    def test_each_reading_gives_back_the_array_it_was_handed(self):
        mac = Mac(ticks=[[100, 50, 800, 10], [200, 60, 700, 0]])
        c = mac.collector(self)
        self.assertEqual(c.cpu_ticks(), [[100, 50, 800, 10], [200, 60, 700, 0]])
        self.assertEqual(c.cpu_ticks(), [[100, 50, 800, 10], [200, 60, 700, 0]])
        self.assertEqual(mac.libc.freed, [(5, addr, size) for addr, size in mac.libc.handed])
        self.assertEqual([size for _, size in mac.libc.handed], [32, 32])

    def test_a_snapshot_gives_it_back_too(self):
        mac = Mac()
        c = mac.collector(self)
        c.snapshot()
        mac.now += 3
        c.snapshot()
        self.assertEqual(len(mac.libc.handed), 2)
        self.assertEqual(mac.libc.freed, [(5, addr, size) for addr, size in mac.libc.handed])

    def test_nothing_is_given_back_when_the_call_fails(self):
        mac = Mac()
        c = mac.collector(self)
        mac.libc.host_processor_info = lambda *a: 5  # KERN_FAILURE: nothing handed over
        self.assertEqual(c.cpu_ticks(), [])
        self.assertEqual(mac.libc.freed, [])


PS_ARGS = "ps -A -o pid=,args="
PS_STAT = "ps -A -o pid=,ppid=,user=,state=,rss=,time=,comm="
VZ = "/System/Library/Frameworks/Virtualization.framework/Versions/A/XPCServices/com.apple.Virtualization.VirtualMachine.xpc/Contents/MacOS/com.apple.Virtualization.VirtualMachine"


def ps(*rows):
    """Both ps listings the collector reads, from (pid, ppid, user, rss KiB, cpu time, args) rows (comm is args' first word)."""
    return {PS_ARGS: "".join("%5d %s\n" % (r[0], r[5]) for r in rows),
            PS_STAT: "".join("%5d %5d %-8s Ss %8d %10s %s\n" % (r[0], r[1], r[2], r[3], r[4], r[5].split(" ")[0]) for r in rows)}


def lsof_files(pid, *paths):
    """lsof -nP -p <pid> -F n: the process, then each open file's descriptor and name."""
    return {"lsof -nP -p %d -F n" % pid: "p%d\nfcwd\nn/\nftxt\nn%s\n" % (pid, VZ) + "".join("f%d\nn%s\n" % (3 + i, x) for i, x in enumerate(paths))}


class VirtualizationVms(unittest.TestCase):
    """#103: Apple's Virtualization framework runs each VM in an XPC service that launchd starts (parent
    pid 1, arguments only the service's path). The files it holds open say whose VM it is: Docker
    Desktop's (not a VM here; its containers are listed on their own) or a UTM VM's, by its bundle name."""

    PROCS = (
        (1, 0, "root", 20000, "1:00.00", "/sbin/launchd"),
        (400, 1, "someone", 300000, "0:30.00", "/Applications/Docker.app/Contents/MacOS/com.docker.backend"),
        (500, 1, "someone", 2097152, "10:00.00", VZ),
        (600, 1, "someone", 1048576, "5:00.00", VZ),
        (700, 1, "someone", 524288, "1:00.00", VZ),
        (800, 1, "someone", 262144, "2:00.00", "/opt/homebrew/bin/qemu-system-aarch64 -name guest=nas-lab,debug-threads=on -m 2048"),
        (900, 1, "someone", 200000, "0:10.00", "/Applications/UTM.app/Contents/MacOS/UTM"),
    )
    FILES = dict(lsof_files(500, "/Applications/Docker.app/Contents/Resources/linuxkit/kernel",
                            "/Users/someone/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw",
                            "/Users/someone/src/blog/compose.yaml"),
                 **lsof_files(600, "/Users/someone/Library/Containers/com.utmapp.UTM/Data/Documents/fleet-lab.utm/Data/3F2A.img",
                              "/Users/someone/src/app/docker/entrypoint.sh"),  # a shared folder: "docker" in a path says nothing
                 **lsof_files(700, "/Users/someone/vms/lab/disk.img"))

    def lsof_calls(self, mac):
        return [x for x in mac.calls if x.startswith("lsof -nP -p")]

    def test_docker_desktops_vm_is_not_a_vm_and_utm_vms_are_named(self):
        mac = Mac(dict(ps(*self.PROCS), **self.FILES))
        snap = mac.collector(self).snapshot()
        self.assertEqual(snap["vms"], [
            {"name": "fleet-lab", "u": [0.0, 1.0, 0.0, 0.0, 0.0], "running": True, "ifs": [], "cpus": ""},
            {"name": "VM 700", "u": [0.0, 0.5, 0.0, 0.0, 0.0], "running": True, "ifs": [], "cpus": ""},
            {"name": "nas-lab", "u": [0.0, 0.25, 0.0, 0.0, 0.0], "running": True, "ifs": [], "cpus": ""},
        ])
        self.assertEqual({p[0]: p[11] for p in snap["procs"]},
                         {1: "base", 400: "base", 500: "dockervm", 600: "vm:fleet-lab", 700: "vm:VM 700", 800: "vm:nas-lab", 900: "base"})
        self.assertEqual(self.lsof_calls(mac), ["lsof -nP -p 500 -F n", "lsof -nP -p 600 -F n", "lsof -nP -p 700 -F n"],
                         "only Virtualization processes their arguments don't name")

    def test_open_files_are_read_once_per_vm_and_again_for_one_they_did_not_name(self):
        mac = Mac(dict(ps(*self.PROCS), **self.FILES))
        c = mac.collector(self)
        c.snapshot()
        del mac.calls[:]
        mac.now += 3
        c.snapshot()
        self.assertEqual(self.lsof_calls(mac), ["lsof -nP -p 700 -F n"])

    def test_a_vm_macos_holds_docker_responsible_for_is_dockers_without_asking_lsof(self):
        # #210: macOS names the app responsible for an XPC service; Docker's backend asked for this VM
        mac = Mac(dict(ps(*self.PROCS), **self.FILES))
        mac.responsible = {500: 400}
        snap = mac.collector(self).snapshot()
        self.assertEqual([v["name"] for v in snap["vms"]], ["fleet-lab", "VM 700", "nas-lab"])
        self.assertEqual({p[0]: p[11] for p in snap["procs"]}[500], "dockervm")
        self.assertEqual(self.lsof_calls(mac), ["lsof -nP -p 600 -F n", "lsof -nP -p 700 -F n"], "the open files only where macOS can't tell")

    def test_a_new_vm_that_gets_an_old_vms_pid_is_not_taken_for_it(self):
        mac = Mac(dict(ps(*self.PROCS), **self.FILES))
        c = mac.collector(self)
        c.snapshot()
        mac.out.update(ps(*(p for p in self.PROCS if p[0] != 600)))  # fleet-lab stops
        mac.now += 3
        c.snapshot()
        mac.out.update(ps(*self.PROCS), **lsof_files(600, "/Users/someone/vms/other/disk.img"))  # another VM gets pid 600
        mac.now += 3
        self.assertEqual([v["name"] for v in c.snapshot()["vms"]], ["VM 600", "VM 700", "nas-lab"])


IOREG_DISKS = "ioreg -r -l -c IOBlockStorageDriver -d 2 -w 0 -a"


def block_drivers(*disks):
    """ioreg's block storage drivers: each one's byte counters since boot and its whole-disk media, from
    (BSD name, registry id, bytes read, bytes written) rows; a row with no name is an empty bay."""
    return plistlib.dumps([{"IOObjectClass": "IOBlockStorageDriver",
                            "Statistics": {"Bytes (Read)": r, "Bytes (Write)": w, "Operations (Read)": r // 4096, "Operations (Write)": w // 4096},
                            "IORegistryEntryChildren": [{"IOObjectClass": "IOMedia", "BSD Name": dn, "Whole": True, "IORegistryEntryID": rid}] if dn else []}
                           for dn, rid, r, w in disks], fmt=plistlib.FMT_XML)


def diskutil(dn, model, size, bus, kind, ssd):
    return {"diskutil info -plist " + dn: plistlib.dumps({"DeviceIdentifier": dn, "MediaName": model, "TotalSize": size, "BusProtocol": bus,
                                                          "VirtualOrPhysical": kind, "SolidState": ssd}, fmt=plistlib.FMT_XML)}


def iostat(*disks):
    """iostat -Id as it prints on a Mac with more devices than fit in 80 columns: only the first four by name."""
    disks = sorted(disks)[:4]
    return ("".join("%21s" % dn for dn, _ in disks) + " \n" + "    KB/t  xfrs     MB " * len(disks) + "\n" +
            "".join("   %5.2f %5d %8.2f" % (64.0, b // 65536, b / MIB) for _, b in disks) + "\n")


DISKUTIL = dict(diskutil("disk0", "APPLE SSD AP1024Z", 1000555581440, "Apple Fabric", "Unknown", True),
                **diskutil("disk4", "Extreme SSD", 2000398934016, "USB", "Physical", True),
                **diskutil("disk6", "Backup HDD", 4000787030016, "USB", "Physical", False),
                **diskutil("disk11", "Disk Image", 524288000, "Disk Image", "Virtual", True),
                **diskutil("disk13", "Disk Image", 209715200, "Disk Image", "Virtual", True),
                **diskutil("disk14", "Disk Image", 104857600, "Disk Image", "Virtual", True))


def disks_at(step):
    """Every drive's counters, `step` readings in: per reading disk0 reads 40 MB and writes 20 MB, disk4 reads
    10 MB, disk6 writes 8 MB; the disk images move 6, 4 and 2 MB (already counted on disk0, which holds them)."""
    return [(None, 0, 0, 0), ("disk0", 1001, 100000000000 + 40000000 * step, 50000000000 + 20000000 * step),
            ("disk4", 1004, 2000000000000 + 10000000 * step, 400000000000), ("disk6", 1006, 5000000000, 1000000000 + 8000000 * step),
            ("disk11", 1011, 3000000000 + 6000000 * step, 0), ("disk13", 1013, 2000000000 + 4000000 * step, 0), ("disk14", 1014, 1000000000, 2000000 * step)]


def disk_readings(step):
    d = disks_at(step)
    return {IOREG_DISKS: block_drivers(*d), "iostat -Id": iostat(*((dn, r + w) for dn, _, r, w in d if dn))}


class EachDisk(unittest.TestCase):
    """#104: every drive is read, not only the first four by name, and disk images are left out (their I/O
    is already on the drive that holds their files), as the Linux reader leaves out loop devices."""

    def disk(self, name, model, size, rot, read, write):
        return {"name": name, "model": model, "size": size, "rot": rot, "role": "", "mounts": [], "read": read, "write": write, "busy": -1}

    def two_readings(self, mac):
        c = mac.collector(self)
        c.snapshot()
        mac.out.update(disk_readings(1))
        mac.now += 2
        return c, c.snapshot()

    def test_every_drive_and_no_disk_image(self):
        mac = Mac(dict(DISKUTIL, **disk_readings(0)))
        c, snap = self.two_readings(mac)
        self.assertEqual(snap["disks"], [self.disk("disk0", "APPLE SSD AP1024Z", 1000555581440, False, 20.0, 10.0),
                                         self.disk("disk4", "Extreme SSD", 2000398934016, False, 5.0, 0.0),
                                         self.disk("disk6", "Backup HDD", 4000787030016, True, 0.0, 4.0)])
        self.assertEqual(snap["host"][3], 39.0, "MB/s over the drives: (60 + 10 + 8) MB in 2 s")

    def test_reads_and_writes_are_each_their_own(self):
        """#107: a disk that is only written shows writes, not reads; one only read shows no writes."""
        mac = Mac(dict(DISKUTIL, **disk_readings(0)))
        c, snap = self.two_readings(mac)
        self.assertEqual({d["name"]: (d["read"], d["write"]) for d in snap["disks"]}, {"disk0": (20.0, 10.0), "disk4": (5.0, 0.0), "disk6": (0.0, 4.0)})

    def test_a_drive_that_takes_an_ejected_images_name_is_read(self):
        mac = Mac(dict(DISKUTIL, **disk_readings(0)))
        c, _ = self.two_readings(mac)
        d = [x for x in disks_at(1) if x[0] != "disk11"] + [("disk11", 2011, 7000000000, 0)]  # a new USB drive is disk11 now
        mac.out.update({IOREG_DISKS: block_drivers(*d)}, **diskutil("disk11", "Card Reader", 128043712512, "USB", "Physical", True))
        mac.now += 2
        c.snapshot()
        d[-1] = ("disk11", 2011, 7000000000 + 3000000, 0)
        mac.out[IOREG_DISKS] = block_drivers(*d)
        mac.now += 2
        self.assertEqual([(x["name"], x["model"], x["read"]) for x in c.snapshot()["disks"]],
                         [("disk0", "APPLE SSD AP1024Z", 0.0), ("disk4", "Extreme SSD", 0.0), ("disk6", "Backup HDD", 0.0), ("disk11", "Card Reader", 1.5)])



class CoreGroups(unittest.TestCase):
    """#106: each CPU cluster is named by its own perf level (ioreg's cluster-type "P" is sysctl's
    Performance level, "E" Efficiency), also when both clusters have the same number of CPUs."""

    def groups(self, ncpu, cluster_types, *levels):
        return Mac(dict({"sysctl -n hw.logicalcpu": "%d\n" % ncpu, "ioreg -rd1 -c IOPlatformDevice -k cluster-type -a": cpus_plist(cluster_types)},
                        **perflevels(*levels))).collector(self).groups

    def test_4p_4e(self):  # M1, M2, M3
        self.assertEqual(self.groups(8, "EEEEPPPP", ("Performance", 4, 4), ("Efficiency", 4, 4)),
                         [{"name": "Efficiency cores", "cpus": [0, 1, 2, 3]}, {"name": "Performance cores", "cpus": [4, 5, 6, 7]}])

    def test_6p_6e(self):  # the 12-core M3 Pro
        self.assertEqual(self.groups(12, "EEEEEEPPPPPP", ("Performance", 6, 6), ("Efficiency", 6, 6)),
                         [{"name": "Efficiency cores", "cpus": [0, 1, 2, 3, 4, 5]}, {"name": "Performance cores", "cpus": [6, 7, 8, 9, 10, 11]}])

    def test_two_performance_clusters_and_one_efficiency(self):  # an M3 Max: 12P in clusters of 6, 4E
        self.assertEqual(self.groups(16, "EEEE" + "P" * 12, ("Performance", 6, 12), ("Efficiency", 4, 4)),
                         [{"name": "Efficiency cores", "cpus": [0, 1, 2, 3]},
                          {"name": "Performance cores · cluster 0", "cpus": [4, 5, 6, 7, 8, 9]},
                          {"name": "Performance cores · cluster 1", "cpus": [10, 11, 12, 13, 14, 15]}])

    def test_no_clusters_in_ioreg_is_one_group(self):  # an Intel Mac
        mac = Mac({"sysctl -n hw.logicalcpu": "4\n", "ioreg -rd1 -c IOPlatformDevice -k cluster-type -a": b"", "sysctl -n hw.nperflevels": ""})
        self.assertEqual(mac.collector(self).groups, [{"name": "All processors", "cpus": [0, 1, 2, 3]}])


NETTOP = "nettop -P -L 1 -x -J bytes_in,bytes_out"


def nettop(*rows):
    """nettop -P -L 1 -x -J bytes_in,bytes_out: a header, then process.pid, bytes in, bytes out since it started."""
    return ",bytes_in,bytes_out,\n" + "".join("%s.%d,%d,%d,\n" % r for r in rows)


class NetPerProcess(unittest.TestCase):
    """#105: nettop takes about 5 s to print its one sample. It runs beside the readings, never inside one,
    and each reading uses the per-process rates between the last two samples it finished."""

    PROCS = ps((1, 0, "root", 20000, "1:00.00", "/sbin/launchd"), (100, 1, "someone", 50000, "0:01.00", "/usr/bin/curl"),
               (200, 1, "someone", 60000, "0:02.00", "/usr/bin/rsync"), (300, 1, "someone", 10000, "0:00.10", "/usr/local/bin/new"),
               (400, 1, "someone", 10000, "0:00.10", "/usr/local/bin/worker"))
    A = nettop(("launchd", 1, 0, 0), ("curl", 100, 1000000, 500000), ("rsync", 200, 0, 30000000), ("worker", 400, 9000000, 0))
    B = nettop(("launchd", 1, 0, 0), ("curl", 100, 4000000, 2000000), ("rsync", 200, 0, 60000000), ("new", 300, 500000, 0), ("worker", 400, 100, 0))

    def net(self, snap):
        return {p[0]: p[16] for p in snap["procs"]}

    def test_a_reading_does_not_wait_for_nettop(self):
        mac = Mac(self.PROCS)
        mac.slow[NETTOP] = threading.Event()
        c = mac.collector(self)
        th = threading.Thread(target=c.snapshot, daemon=True)
        th.start()
        th.join(2)
        waited = th.is_alive()
        mac.slow[NETTOP].set()
        th.join(10)
        self.assertFalse(waited, "the reading waited for nettop")
        self.assertEqual([(x.cmd, x.done) for x in mac.started], [(NETTOP, False)], "one nettop started, still running")
        self.assertNotIn(NETTOP, mac.calls)

    def test_each_process_gets_its_rate_from_the_last_two_samples(self):
        mac = Mac(self.PROCS)
        c = mac.collector(self)
        self.assertEqual(self.net(c.snapshot()), {1: 0.0, 100: 0.0, 200: 0.0, 300: 0.0, 400: 0.0})  # t 10000: sample A starts
        mac.started[0].finish(self.A)
        mac.now += 5
        self.assertEqual(self.net(c.snapshot()), {1: 0.0, 100: 0.0, 200: 0.0, 300: 0.0, 400: 0.0})  # t 10005: A is the first; B starts
        mac.started[1].finish(self.B)
        mac.now += 3
        # t 10008: from A to B, started 5 s apart: curl moved 4.5 MB, rsync 30 MB; a new process and one whose counter went back are 0
        rates = {1: 0.0, 100: 0.9, 200: 6.0, 300: 0.0, 400: 0.0}
        self.assertEqual(self.net(c.snapshot()), rates)
        mac.now += 3
        self.assertEqual(self.net(c.snapshot()), rates, "while the next sample runs, the last rates hold")
        self.assertEqual([(x.cmd, x.done) for x in mac.started], [(NETTOP, True), (NETTOP, True), (NETTOP, False)])

    def test_a_nettop_that_hangs_is_stopped_and_started_again(self):
        mac = Mac(self.PROCS)
        c = mac.collector(self)
        c.snapshot()
        mac.now += 9
        c.snapshot()
        self.assertEqual([(x.cmd, x.killed) for x in mac.started], [(NETTOP, False)], "9 s is still a run")
        mac.now += 2
        c.snapshot()
        self.assertEqual([(x.cmd, x.killed, x.done) for x in mac.started], [(NETTOP, True, True), (NETTOP, False, False)])


NETSTAT = "netstat -ib"
LSOF_TCP = "lsof -nP -iTCP -sTCP:ESTABLISHED -F pn"


def netstat(step):
    """netstat -ib, `step` readings in (3 s apart): en0 takes in 3 MB and sends 1.5 MB per reading, lo0 0.3 MB
    each way, utun3 30 kB in; the rest is still. Link rows carry the byte counters; address rows are skipped."""
    rows = [("lo0", 16384, "<Link#1>", "", 50000000 + 300000 * step, 50000000 + 300000 * step),
            ("en0", 1500, "<Link#11>", "aa:bb:cc:00:11:22", 3000000000 + 3000000 * step, 500000000 + 1500000 * step),
            ("en1", 1500, "<Link#12>", "aa:bb:cc:00:11:33", 0, 0),
            ("bridge0", 1500, "<Link#14>", "aa:bb:cc:00:11:44", 0, 1000),
            ("utun3", 1280, "<Link#20>", "", 200000 + 30000 * step, 100000),
            ("gif0*", 1280, "<Link#2>", "", 0, 0)]
    out = "Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll\n"
    for name, mtu, net, addr, rx, tx in rows:
        out += "%-10s %-5d %-13s %-17s %8d %5d %10d %8d %5d %10d %5d\n" % (name, mtu, net, addr, rx // 1000, 0, rx, tx // 1000, 0, tx, 0)
        if name == "en0":
            out += "%-10s %-5d %-13s %-17s %8d %5s %10d %8d %5s %10d %5s\n" % (name, mtu, "192.0.2", "192.0.2.20", rx // 1000, "-", rx, tx // 1000, "-", tx, "-")
    return out


IFCONFIG = """lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384
	options=1203<RXCSUM,TXCSUM,TXSTATUS,SW_TIMESTAMP>
	inet 127.0.0.1 netmask 0xff000000
	inet6 ::1 prefixlen 128 
	inet6 fe80::1%lo0 prefixlen 64 scopeid 0x1 
gif0: flags=8010<POINTOPOINT,MULTICAST> mtu 1280
en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
	ether aa:bb:cc:00:11:22
	inet6 fe80::1c2d:3e4f:5a6b:7c8d%en0 prefixlen 64 secured scopeid 0xb 
	inet 192.0.2.20 netmask 0xffffff00 broadcast 192.0.2.255
	inet6 2001:db8::20 prefixlen 64 autoconf secured 
	status: active
en1: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
	ether aa:bb:cc:00:11:33
	status: inactive
bridge0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
	ether aa:bb:cc:00:11:44
	status: inactive
utun3: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1280
	inet 198.51.100.5 --> 198.51.100.5 netmask 0xffffffff
	inet6 2001:db8:100::5 prefixlen 128 
"""

# Each process's established TCP connections: curl over en0, ssh over en0 (IPv6) and to a local port, ssh over utun3.
LSOF = """p100
f12
n192.0.2.20:52344->203.0.113.10:443
p200
f5
n[2001:db8::20]:50111->[2001:db8:1::5]:22
f6
n127.0.0.1:60000->127.0.0.1:5432
p300
f7
n198.51.100.5:51000->198.51.100.9:22
"""

NET_PROCS = ps((1, 0, "root", 131072, "61:01.00", "/sbin/launchd"),
               (100, 1, "someone", 65536, "0:01.50", "/usr/bin/curl -sS https://example.com/"),
               (200, 1, "someone", 65536, "0:10.00", "/usr/bin/ssh -N backup@nas"),
               (300, 1, "someone", 65536, "0:00.50", "/usr/bin/ssh lab"))


class Interfaces(unittest.TestCase):
    """#174: a point-to-point interface (a VPN's utun) prints its IPv4 address as "inet A --> B netmask M";
    it is read like any other, and connections from it count on that interface."""

    def reading(self):
        mac = Mac(dict({NETSTAT: netstat(0), "ifconfig": IFCONFIG, LSOF_TCP: LSOF}, **NET_PROCS))
        snap = mac.collector(self).snapshot()
        return {x["name"]: (x["addrs"], x.get("addrs6", [])) for x in snap["ifs"]}, {p[0]: p[15] for p in snap["procs"]}

    def test_point_to_point_addresses_are_read(self):
        addrs, _ = self.reading()
        self.assertEqual(addrs, {"lo0": (["127.0.0.1/8"], ["::1", "fe80::1"]), "en0": (["192.0.2.20/24"], ["fe80::1c2d:3e4f:5a6b:7c8d", "2001:db8::20"]),
                                 "en1": ([], []), "bridge0": ([], []), "utun3": (["198.51.100.5/32"], ["2001:db8:100::5"]), "gif0*": ([], [])})

    def test_connections_from_a_point_to_point_address_count_on_it(self):
        _, ifs = self.reading()
        self.assertEqual(ifs, {1: [], 100: ["en0"], 200: ["en0", "lo0"], 300: ["utun3"]})


# vm_stat on Apple silicon (16 KiB pages). Used memory is what Activity Monitor calls Memory Used:
# app memory (anonymous - purgeable) + wired + compressed = (350000 - 20000 + 150000 + 40000) pages.
VM_STAT = """Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               12345.
Pages active:                            300000.
Pages inactive:                          290000.
Pages speculative:                        10000.
Pages throttled:                              0.
Pages wired down:                        150000.
Pages purgeable:                          20000.
"Translation faults":                 123456789.
Pages copy-on-write:                    1234567.
Pages zero filled:                     98765432.
Pages reactivated:                        12345.
Pages purged:                             54321.
File-backed pages:                       250000.
Anonymous pages:                         350000.
Pages stored in compressor:              100000.
Pages occupied by compressor:             40000.
Decompressions:                          123456.
Compressions:                            234567.
Pageins:                                 345678.
Pageouts:                                  4567.
Swapins:                                      0.
Swapouts:                                     0.
"""

CRONTAB = """# m h dom mon dow command
MAILTO=""

*/15 * * * * /Users/someone/bin/sync-notes.sh >/dev/null 2>&1
@reboot /usr/local/bin/mount-shares
30 3 * * 1 /usr/bin/python3 /Users/someone/bin/weekly_report.py
"""

LAUNCHCTL = "PID\tStatus\tLabel\n410\t0\tcom.example.backup\n-\t0\tcom.example.cleanup\n77\t0\tcom.apple.Finder\n"

LAUNCH_AGENTS = {
    "com.example.agent": {"Label": "com.example.agent", "Program": "/usr/local/bin/agent", "KeepAlive": True},  # not scheduled: not a job
    "com.example.backup": {"Label": "com.example.backup", "ProgramArguments": ["/bin/sh", "/Users/someone/bin/backup.sh"], "StartInterval": 3600},
    "com.example.cleanup": {"Label": "com.example.cleanup", "Program": "/usr/local/bin/cleanup", "StartCalendarInterval": {"Hour": 4, "Minute": 30}},
    "com.example.every90": {"Label": "com.example.every90", "ProgramArguments": ["/usr/local/bin/poll", "--once"], "StartInterval": 90},
    "com.example.five": {"Label": "com.example.five", "ProgramArguments": ["/usr/local/bin/tick"], "StartInterval": 300},
}


def procs_at(step):
    """The processes, `step` readings in (3 s apart): CPU time goes up by 0.75, 0.75, 0, 1.5 and 1.5 s."""
    t = [("61:01.00", "61:01.75"), ("0:01.50", "0:02.25"), ("0:10.00", "0:10.00"), ("0:00.50", "0:02.00"), ("1:00.00", "1:01.50")]
    return ps((1, 0, "root", 131072, t[0][step], "/sbin/launchd"),
              (100, 1, "someone", 65536, t[1][step], "/usr/bin/curl -sS https://example.com/"),
              (200, 1, "someone", 65536, t[2][step], "/usr/bin/ssh -N backup@nas"),
              (300, 1, "someone", 65536, t[3][step], "/usr/bin/ssh lab"),
              (410, 1, "someone", 262144, t[4][step], "/bin/sh /Users/someone/bin/backup.sh"))


class WholeReading(unittest.TestCase):
    """#108: one complete Mac reading from hand-made output of every command the collector runs (Docker
    and disks have their own tests above): memory, CPUs, interfaces, processes, crontab and launchd jobs."""

    def test_the_second_reading_exactly(self):
        mac = Mac(dict({"vm_stat": VM_STAT, NETSTAT: netstat(0), "ifconfig": IFCONFIG, LSOF_TCP: LSOF, "crontab -l": CRONTAB, "launchctl list": LAUNCHCTL},
                       **procs_at(0)), ticks=[[100, 50, 800, 0]] * 8, docker=False)
        c = mac.collector(self)
        agents = os.path.join(mac.home, "Library", "LaunchAgents")
        os.makedirs(agents)
        for label, pl in LAUNCH_AGENTS.items():
            with open(os.path.join(agents, label + ".plist"), "wb") as f:
                plistlib.dump(pl, f)
        with open(os.path.join(agents, "com.example.broken.plist"), "wb") as f:
            f.write(b"not a plist")
        c.snapshot()
        mac.out.update({NETSTAT: netstat(1)}, **procs_at(1))
        mac.libc.ticks = [[130, 70, 950, 0]] * 4 + [[150, 90, 900, 10]] * 4  # E cores 50 of 200 ticks busy, P cores 100 of 200
        mac.now += 3
        snap = c.snapshot()

        def iface(name, kind, rx, tx, addrs, addrs6=None):
            x = {"name": name, "kind": kind, "rx": rx, "tx": tx, "addrs": addrs, "master": "", "state": "", "speed": ""}
            return dict(x, addrs6=addrs6) if addrs6 else x

        def proc(pid, ppid, comm, user, cpu, mem, args, owner, ifs):
            return [pid, ppid, comm, user, "Ss", cpu, mem, 0.0, 0.0, 0, args, owner, -1, [], [], ifs, 0.0]

        def cron(name, sched, human, cmd):
            return {"name": name, "sched": sched, "human": human, "cmd": cmd, "src": "crontab", "last": "", "u": [0.0] * 5, "running": False}

        def launchd(label, human, cmd, u=None):
            return {"name": label, "label": label, "sched": "launchd", "human": human, "cmd": cmd, "src": os.path.join(agents, label + ".plist"), "last": "",
                    "u": u or [0.0] * 5, "running": bool(u)}

        self.assertEqual(snap, {
            "t": 10003.0, "os": "macOS 15.1", "arch": "arm64", "cpu_model": "Apple M1", "ncpu": 8, "uptime": 9003.0,
            "host": [3.0, 520000 * 16384 / GB, 0.0, 0.0, 1.5],
            "cap": [8, 16.0, 100.0, 500.0, 1250.0],
            "gpus": [{"name": "Apple M1", "mem": "unified memory", "util": 0.0, "m": {}, "lim": {}}],
            "lcpus": [{"n": n, "pct": 25.0 if n < 4 else 50.0, "mhz": 0} for n in range(8)],
            "groups": [{"name": "Efficiency cores", "cpus": [0, 1, 2, 3]}, {"name": "Performance cores", "cpus": [4, 5, 6, 7]}],
            "containers": [], "vms": [],
            "jobs": [cron("sync-notes.sh", "*/15 * * * *", "every 15 min", "/Users/someone/bin/sync-notes.sh >/dev/null 2>&1"),
                     cron("mount-shares", "@reboot", "reboot", "/usr/local/bin/mount-shares"),
                     cron("weekly_report.py", "30 3 * * 1", "weekly (1) at 03:30", "/usr/bin/python3 /Users/someone/bin/weekly_report.py"),
                     launchd("com.example.backup", "every 1 h", "/bin/sh /Users/someone/bin/backup.sh", u=[0.5, 0.25, 0.0, 0.0, 0.0]),
                     launchd("com.example.cleanup", "at hour 4, minute 30", "/usr/local/bin/cleanup"),
                     launchd("com.example.every90", "every 90 s", "/usr/local/bin/poll --once"),
                     launchd("com.example.five", "every 5 min", "/usr/local/bin/tick")],
            "procs": [proc(1, 0, "launchd", "root", 0.25, 0.125, "/sbin/launchd", "base", []),
                      proc(100, 1, "curl", "someone", 0.25, 0.0625, "/usr/bin/curl -sS https://example.com/", "base", ["en0"]),
                      proc(200, 1, "ssh", "someone", 0.0, 0.0625, "/usr/bin/ssh -N backup@nas", "base", ["en0", "lo0"]),
                      proc(300, 1, "ssh", "someone", 0.5, 0.0625, "/usr/bin/ssh lab", "base", ["utun3"]),
                      proc(410, 1, "sh", "someone", 0.5, 0.25, "/bin/sh /Users/someone/bin/backup.sh", "job:3", [])],
            "ifs": [iface("lo0", "loopback", 0.1, 0.1, ["127.0.0.1/8"], ["::1", "fe80::1"]),
                    iface("en0", "physical", 1.0, 0.5, ["192.0.2.20/24"], ["fe80::1c2d:3e4f:5a6b:7c8d", "2001:db8::20"]),
                    iface("en1", "physical", 0.0, 0.0, []),
                    iface("bridge0", "bridge", 0.0, 0.0, []),
                    iface("utun3", "virtual", 0.01, 0.0, ["198.51.100.5/32"], ["2001:db8:100::5"]),
                    iface("gif0*", "virtual", 0.0, 0.0, [])],
            "dockernets": [], "cronLabel": "Cron & launchd jobs", "disks": [],
            "note": "Docker Desktop runs containers in its own Linux VM (no GPU passthrough). They are listed here directly; that VM's overhead counts as Base system.",
        })

    def test_memory_at_the_page_size_vm_stat_names(self):
        """An Intel Mac's pages are 4 KiB."""
        snap = Mac({"vm_stat": VM_STAT.replace("page size of 16384", "page size of 4096")}, docker=False).collector(self).snapshot()
        self.assertEqual(snap["host"][1], 520000 * 4096 / GB)


class Helpers(unittest.TestCase):
    def test_parse_cputime(self):
        self.assertEqual({s: fl.parse_cputime(s) for s in ("0:01.50", "61:01.00", "1:02:03.50", "2-03:04:05")},
                         {"0:01.50": 1.5, "61:01.00": 3661.0, "1:02:03.50": 3723.5, "2-03:04:05": 183845.0})

    def test_fmt_secs(self):
        self.assertEqual({s: fl.fmt_secs(s) for s in (45, 60, 90, 300, 3600, 3660, 7200)},
                         {45: "45 s", 60: "1 min", 90: "90 s", 300: "5 min", 3600: "1 h", 3660: "61 min", 7200: "2 h"})

if __name__ == "__main__":
    unittest.main()
