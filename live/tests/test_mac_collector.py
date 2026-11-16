# SPDX-License-Identifier: GPL-3.0-or-later
"""The macOS collector (MacCollector), fed hand-made command output shaped like a real Mac's. No command
runs and nothing on this machine is read: every command line the collector runs is answered from a table,
and host_processor_info from a fake libc. Every assertion is the exact result.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import contextlib, ctypes, importlib.util, json, os, plistlib, subprocess, sys, tempfile, types, unittest
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


class Mac:
    """A Mac that exists only as command output. `out` maps each command line to what it prints (str or
    bytes); a command that is not in it prints nothing, which is what run() makes of a failure."""

    def __init__(self, out=None, now=10000.0, ticks=None, docker=True):
        self.out = dict(BASE, **(out or {}))
        self.calls = []
        self.now = now
        self.libc = FakeLibc(ticks or [[100, 50, 800, 0]] * 8)
        self.docker = docker

    def run(self, cmd, **kw):
        line = " ".join(cmd)
        self.calls.append(line)
        o = self.out.get(line, "")
        return types.SimpleNamespace(stdout=o if isinstance(o, bytes) else o.encode(), stderr=b"", returncode=0)

    def collector(self, test):
        """A MacCollector reading this Mac; the fakes stay patched in until the test ends."""
        stack = contextlib.ExitStack()
        test.addCleanup(stack.close)
        self.home = stack.enter_context(tempfile.TemporaryDirectory())
        stack.enter_context(mock.patch.object(fl, "subprocess", types.SimpleNamespace(run=self.run, PIPE=subprocess.PIPE, DEVNULL=subprocess.DEVNULL)))
        stack.enter_context(mock.patch.object(fl, "shutil", types.SimpleNamespace(which=lambda n: "/usr/local/bin/docker" if self.docker and n == "docker" else None)))
        stack.enter_context(mock.patch.object(fl, "platform", types.SimpleNamespace(mac_ver=lambda: ("15.1", ("", "", ""), "arm64"),
                                                                                     machine=lambda: "arm64", system=lambda: "Darwin")))
        stack.enter_context(mock.patch.object(fl, "time", types.SimpleNamespace(time=lambda: self.now, sleep=lambda s: None)))
        stack.enter_context(mock.patch.dict(os.environ, {"HOME": self.home}))
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
     "file": "/srv/blog/compose.yaml", "networks": "blog_default", "u": [0.125, 100 * MIB / GB, 0.0, 0.0, 0.0]},
    {"id": MIGRATE_ID[:12], "name": "migrate", "image": "blog-migrate:latest", "status": "Up 1 second", "project": "", "service": "",
     "file": "", "networks": "bridge", "u": [0.0, 0.0, 0.0, 0.0, 0.0]},
    {"id": IDLE_ID[:12], "name": "idle", "image": "busybox:1.36", "status": "Up 3 days", "project": "", "service": "",
     "file": "", "networks": "bridge", "u": [0.0, 1 * MIB / GB, 0.0, 0.0, 0.0]},
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


if __name__ == "__main__":
    unittest.main()
