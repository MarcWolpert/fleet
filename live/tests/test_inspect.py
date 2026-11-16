# SPDX-License-Identifier: GPL-3.0-or-later
"""The process inspector: inspect_linux.py's classifier, socket parsing and whole run (main) over a made-up
/proc, which inspector each machine gets, and the Mac inspector."""
import builtins, contextlib, importlib.util, io, json, os, shutil, sys, tempfile, threading, types, unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def stat_line(pid, comm, fields):
    """A /proc/<pid>/stat line; fields by number as in proc(5) (3 state, 14 utime, 15 stime, ...), the rest 0."""
    vals = {3: "S", 4: 1}
    vals.update(fields)
    return "%d (%s) %s\n" % (pid, comm, " ".join(str(vals.get(i, 0)) for i in range(3, 53)))


class FakeProc:
    """A made-up /proc (and /sys/fs/cgroup, /etc/passwd) under a temporary directory. run() runs
    inspect_linux.main() against it: the module's open, os and time are replaced, so every absolute path it
    reads lands under the directory, time moves only when it sleeps, and nothing of this machine is read.
    at(secs, change) changes the tree once the look has run that long (a thread exits, another starts)."""

    def __init__(self, m):
        self.m, self.root, self.changes = m, tempfile.mkdtemp(prefix="fleet-proc-"), []

    def close(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def path(self, p):
        return self.root + p if p.startswith("/") else p

    def write(self, p, text):
        os.makedirs(os.path.dirname(self.path(p)), exist_ok=True)
        with builtins.open(self.path(p), "w") as f:
            f.write(text)

    def link(self, p, target):
        os.makedirs(os.path.dirname(self.path(p)), exist_ok=True)
        os.symlink(target, self.path(p))

    def remove(self, p):
        shutil.rmtree(self.path(p))

    def thread(self, pid, tid, comm, state="S", wchan="0", utime=0, stime=0, run_ns=0, wait_ns=0):
        base = "/proc/%d/task/%d/" % (pid, tid)
        self.write(base + "stat", stat_line(tid, comm, {3: state, 14: utime, 15: stime}))
        self.write(base + "schedstat", "%d %d 10\n" % (run_ns, wait_ns))
        self.write(base + "wchan", wchan)
        self.write(base + "comm", comm + "\n")

    def at(self, secs, change):
        self.changes.append((secs, change))

    T0 = 1_000_000.0   # the clock when the look starts

    def run(self, pid, secs, counters=None):
        fake, t0 = self, self.T0
        clock = types.SimpleNamespace(t=t0)
        def sleep(s):
            clock.t = round(clock.t + s, 6)
            while fake.changes and clock.t - t0 >= fake.changes[0][0]:
                fake.changes.pop(0)[1]()
        # /proc lists a process's tasks and fds in number order
        listdir = lambda p: sorted(os.listdir(fake.path(p)), key=lambda n: (len(n), n))
        fos = types.SimpleNamespace(listdir=listdir, readlink=lambda p: os.readlink(fake.path(p)),
                                    path=types.SimpleNamespace(isdir=lambda p: os.path.isdir(fake.path(p))), read=os.read, close=os.close)
        ftime = types.SimpleNamespace(time=lambda: clock.t, sleep=sleep)
        out = io.StringIO()
        with mock.patch.object(self.m, "open", lambda p, *a, **k: builtins.open(fake.path(p), *a, **k), create=True), \
                mock.patch.object(self.m, "os", fos), mock.patch.object(self.m, "time", ftime), \
                mock.patch.object(self.m, "Counters", counters or NoCounters), mock.patch.object(sys, "argv", ["-", str(pid), str(secs)]), \
                contextlib.redirect_stdout(out):
            self.m.main()
        return json.loads(out.getvalue())


class NoCounters:
    """In place of perf_event_open: no counters (a test never makes a real syscall)."""
    def __init__(self, tids):
        self.groups, self.error = [], "no counters in this test"

    def read(self):
        return {}

    def close(self):
        pass


class LinuxInspector(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        argv = sys.argv
        sys.argv = ["inspect_linux.py"]          # imported, not run: nothing reads a PID or prints
        try:
            cls.m = load("inspect_linux", os.path.join(LIVE, "inspect_linux.py"))
        finally:
            sys.argv = argv

    def test_every_state_and_wait_channel_lands_in_one_place(self):
        cases = {
            ("R", ""): "cpu", ("R", "0"): "cpu",
            ("D", "io_schedule"): "disk", ("D", "folio_wait_bit_common"): "disk", ("D", "filemap_fault"): "memory", ("D", "nfs_wait_on_request"): "netfs",
            ("D", "fuse_wait_answer"): "netfs", ("S", "futex_wait_queue"): "lock", ("S", "ep_poll"): "events", ("S", "do_select"): "events",
            ("S", "sk_wait_data"): "network", ("S", "inet_csk_accept"): "network", ("S", "unix_stream_read_generic"): "network",
            ("S", "pipe_read"): "pipe", ("S", "hrtimer_nanosleep"): "timer", ("S", "do_wait"): "child", ("S", "io_cqring_wait"): "io",
            ("S", "nvidia_poll"): "gpu", ("D", "dma_fence_default_wait"): "gpu", ("S", "sigsuspend"): "signal",
            ("S", "0"): "sleep", ("S", ""): "sleep", ("S", "some_new_kernel_fn"): "other",
            ("T", ""): "stopped", ("t", ""): "stopped", ("Z", ""): "stopped", ("I", ""): "idle",
        }
        got = dict((k, self.m.classify(*k)) for k in cases)
        self.assertEqual(got, cases)

    def fake(self):
        f = FakeProc(self.m)
        self.addCleanup(f.close)
        f.write("/proc/uptime", "5000.00 9000.00\n")
        f.write("/proc/4242/status", "Name:\tworker\nUid:\t1000\t1000\t1000\t1000\nVmRSS:\t10240 kB\n")
        return f

    def test_running_and_queued_count_only_time_inside_the_look_when_a_thread_exits(self):
        # schedstat is per thread and counts a thread's whole life. A pooled worker with 30 s of CPU behind it
        # exits mid-look, and a new one starts: comparing totals over the threads of each moment gave about -20
        # core-seconds per second of running and hid the queueing (#287). Only what each thread did inside the
        # look counts: the main thread's change, and all of the new worker's (it began inside the look).
        f = self.fake()
        f.write("/proc/4242/stat", stat_line(4242, "worker", {3: "S", 14: 500, 15: 100, 20: 2}))
        f.thread(4242, 4242, "worker", run_ns=2_000_000_000, wait_ns=100_000_000)
        f.thread(4242, 4243, "pool-1", state="R", run_ns=30_000_000_000, wait_ns=1_000_000_000)
        def worker_exits():
            f.remove("/proc/4242/task/4243")
            f.thread(4242, 4242, "worker", run_ns=2_600_000_000, wait_ns=250_000_000)
            f.thread(4242, 4244, "pool-2", state="R", run_ns=300_000_000, wait_ns=150_000_000)
        f.at(0.75, worker_exits)
        d = f.run(4242, 1.5)
        dt = d["dt"]
        self.assertGreaterEqual(dt, 1.5)
        self.assertEqual({k: round(d["cpu"][k] * dt, 6) for k in ("run_s", "runq_s")}, {"run_s": 0.9, "runq_s": 0.3})

    def test_running_and_queued_with_the_same_threads_throughout(self):
        # the control: nothing exits or starts, so it is each thread's change, summed
        f = self.fake()
        f.write("/proc/4242/stat", stat_line(4242, "worker", {3: "S", 14: 500, 15: 100, 20: 2}))
        f.thread(4242, 4242, "worker", run_ns=2_000_000_000, wait_ns=100_000_000)
        f.thread(4242, 4243, "pool-1", run_ns=5_000_000_000, wait_ns=0)
        f.at(0.75, lambda: (f.thread(4242, 4242, "worker", run_ns=2_500_000_000, wait_ns=100_000_000),
                            f.thread(4242, 4243, "pool-1", run_ns=6_000_000_000, wait_ns=300_000_000)))
        d = f.run(4242, 1.5)
        self.assertEqual({k: round(d["cpu"][k] * d["dt"], 6) for k in ("run_s", "runq_s")}, {"run_s": 1.5, "runq_s": 0.3})

    def test_one_whole_look_every_number_it_reports(self):
        # worker (pid 4242) and its three threads over a 1.5 s look: everything main() prints, from what /proc,
        # the cgroup and the CPU's counters say at the start and at the end (the end's values appear at 0.75 s)
        f, hz = self.fake(), self.m.HZ
        def proc(utime, stime, minflt, majflt, blkio, vol, invol, rd_b, wr_b, rchar):
            f.write("/proc/4242/stat", stat_line(4242, "worker", {3: "S", 4: 1, 10: minflt, 12: majflt, 14: utime, 15: stime, 18: 20, 19: 0, 20: 3,
                                                                  22: 200000, 39: 2, 42: blkio}))
            f.write("/proc/4242/status", "Name:\tworker\nUid:\t1000\t1000\t1000\t1000\nVmPeak:\t900000 kB\nVmSize:\t800000 kB\nVmHWM:\t300000 kB\n"
                    "VmRSS:\t200000 kB\nRssAnon:\t150000 kB\nRssFile:\t40000 kB\nRssShmem:\t10000 kB\nVmSwap:\t5000 kB\n"
                    "Cpus_allowed_list:\t0-3\nvoluntary_ctxt_switches:\t%d\nnonvoluntary_ctxt_switches:\t%d\n" % (vol, invol))
            f.write("/proc/4242/io", "rchar: %d\nwchar: 0\nsyscr: 0\nsyscw: 0\nread_bytes: %d\nwrite_bytes: %d\ncancelled_write_bytes: 0\n" % (rchar, rd_b, wr_b))
        def threads(main, pool, flusher):
            f.thread(4242, 4242, "worker", state="S", wchan="ep_poll", utime=main[0], run_ns=main[1], wait_ns=main[2])
            f.thread(4242, 4243, "pool-1", state="R", wchan="0", utime=pool[0], run_ns=pool[1], wait_ns=pool[2])
            f.thread(4242, 4244, "flusher", state="D", wchan="io_schedule", utime=flusher[0], run_ns=flusher[1], wait_ns=flusher[2])
        cg = "/sys/fs/cgroup/system.slice/worker.service/"
        def cgroup(throttled_usec, oom_kills):
            f.write(cg + "cpu.stat", "usage_usec 9000000\nuser_usec 8000000\nsystem_usec 1000000\nnr_periods 100\nnr_throttled 9\nthrottled_usec %d\n" % throttled_usec)
            f.write(cg + "memory.events", "low 0\nhigh 0\nmax 2\noom 1\noom_kill %d\n" % oom_kills)
        proc(1000, 200, 5000, 10, 50, 1000, 50, 1_000_000, 0, 2_000_000)
        threads((300, 3_000_000_000, 0), (800, 8_000_000_000, 1_000_000_000), (100, 1_000_000_000, 0))
        cgroup(1_000_000, 1)
        f.write("/proc/4242/cmdline", "worker\0--serve\0")
        f.link("/proc/4242/exe", "/usr/bin/worker")
        f.link("/proc/4242/cwd", "/srv/app")
        f.write("/proc/4242/cgroup", "0::/system.slice/worker.service\n")
        f.write(cg + "cpu.max", "150000 100000\n")
        f.write(cg + "memory.max", "4294967296\n")
        f.write(cg + "memory.current", "1073741824\n")
        f.write(cg + "cpu.pressure", "some avg10=1.50 avg60=1.00 avg300=0.50 total=123456\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n")
        f.write(cg + "memory.pressure", "some avg10=0.00 avg60=0.10 avg300=0.20 total=99\nfull avg10=0.00 avg60=0.05 avg300=0.10 total=50\n")
        f.write(cg + "io.pressure", "some avg10=12.00 avg60=8.00 avg300=5.00 total=777\n")
        f.write("/proc/sys/kernel/task_delayacct", "1\n")
        f.write("/etc/passwd", "root:x:0:0::/root:/bin/sh\napp:x:1000:1000::/home/app:/bin/sh\n")
        f.write("/proc/4242/limits", "Limit                     Soft Limit           Hard Limit           Units\n"
                "Max processes             63000                63000                processes\nMax open files            1024                 4096                 files\n")
        for fd, target in [("0", "/dev/null"), ("1", "pipe:[1]"), ("3", "socket:[5551]"), ("4", "socket:[5552]"), ("5", "/data/app.log"),
                           ("6", "/proc/4242/status"), ("7", "socket:[5553]"), ("10", "/srv/app/cache.db")]:
            f.link("/proc/4242/fd/" + fd, target)
        head = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n"
        f.write("/proc/4242/net/tcp", head + "   0: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 5551 1 0 100 0 0 10 0\n"
                "   1: 0200000A:1F90 0900000A:C822 01 00000000:00000000 00:00000000 00000000  1000        0 5552 1 0 20 4 30 10 -1\n"
                "   2: 0100007F:1538 0100007F:D431 01 00000000:00000000 00:00000000 00000000   999        0 9999 1 0 20 4 30 10 -1\n")  # another process's
        f.write("/proc/4242/net/tcp6", head)
        f.write("/proc/4242/net/udp", head + "  10: 00000000:0035 00000000:0000 07 00000000:00000000 00:00000000 00000000  1000        0 5553 2 0 0\n")
        f.write("/proc/4242/net/udp6", head)
        def at_the_end():
            proc(1150, 230, 5300, 13, 65, 1300, 65, 4_000_000, 1_500_000, 8_000_000)
            threads((315, 3_150_000_000, 0), (935, 9_350_000_000, 1_300_000_000), (130, 1_300_000_000, 150_000_000))
            cgroup(1_300_000, 1)
        f.at(0.75, at_the_end)
        class Counters:
            got = []
            reads = [{"refs": 1e6, "misses": 1e5, "instructions": 4e6, "cycles": 2e6}, {"refs": 4e6, "misses": 1e6, "instructions": 1e7, "cycles": 8e6}]
            def __init__(self, tids):
                Counters.got.append(list(tids))
                self.groups, self.error = [[1], [2], [3]], ""
            def read(self):
                return Counters.reads.pop(0)
            def close(self):
                pass
        d = f.run(4242, 1.5, counters=Counters)
        r = lambda x: {k: r(v) for k, v in x.items()} if isinstance(x, dict) else [r(v) for v in x] if isinstance(x, list) else round(x, 6) if isinstance(x, float) else x
        self.assertEqual(Counters.got, [[4243, 4242, 4244]], "the counters go on the busiest threads first")
        self.assertEqual(r(d), r({
            "pid": 4242, "name": "worker", "state": "S", "ppid": 1, "nice": 0, "priority": 20, "threads_n": 3,
            "started": f.T0 + 1.5 - 5000.0 + 200000 / hz, "last_cpu": 2, "user": "app", "cmdline": "worker --serve",
            "exe": "/usr/bin/worker", "cwd": "/srv/app", "affinity": "0-3",
            "cpu": {"user": 150 / hz / 1.5, "system": 30 / hz / 1.5, "ctx_vol": 200.0, "ctx_invol": 10.0, "run_s": 1.2, "runq_s": 0.3},
            "mem": {"rss": 200000 * 1024, "anon": 150000 * 1024, "file": 40000 * 1024, "shmem": 10000 * 1024, "swap": 5000 * 1024,
                    "peak": 300000 * 1024, "virt": 800000 * 1024, "minflt": 200.0, "majflt": 2.0},
            "io": {"read": 2e6, "write": 1e6, "rchar": 4e6, "blkio_delay": 15 / hz / 1.5, "delayacct": True},
            "waits": {"events": 16, "cpu": 16, "disk": 16}, "samples": 16, "dt": 1.5,
            "threads": [{"tid": 4243, "name": "pool-1", "cpu": round(135 / hz / 1.5, 3), "doing": "cpu"},
                        {"tid": 4244, "name": "flusher", "cpu": round(30 / hz / 1.5, 3), "doing": "disk"},
                        {"tid": 4242, "name": "worker", "cpu": round(15 / hz / 1.5, 3), "doing": "events"}],
            "fds": 8, "fd_limit": 1024, "files": ["/data/app.log", "/srv/app/cache.db"],
            "conns": [{"proto": "tcp", "local": "0.0.0.0:8080", "remote": "", "state": "listening"},
                      {"proto": "tcp", "local": "10.0.0.2:8080", "remote": "10.0.0.9:51234", "state": "established"},
                      {"proto": "udp", "local": "0.0.0.0:53", "remote": "", "state": "listening"}], "conns_n": 3,
            "cgroup": {"path": "/system.slice/worker.service", "cpu_limit": 1.5, "mem_limit": 4294967296, "mem_current": 1073741824,
                       "pressure": {"cpu": {"some": {"avg10": 1.5, "avg60": 1.0, "avg300": 0.5}, "full": {"avg10": 0.0, "avg60": 0.0, "avg300": 0.0}},
                                    "memory": {"some": {"avg10": 0.0, "avg60": 0.1, "avg300": 0.2}, "full": {"avg10": 0.0, "avg60": 0.05, "avg300": 0.1}},
                                    "io": {"some": {"avg10": 12.0, "avg60": 8.0, "avg300": 5.0}}},
                       "throttled": 0.2, "oom_kills": 1},
            "cache": {"refs": 2e6, "misses": 6e5, "instructions": 4e6, "cycles": 4e6, "miss_pct": 0.3, "ipc": 1.0, "threads": 3}, "cache_error": "",
        }))

    def test_a_process_with_no_cgroup_and_no_counters(self):
        # the "nothing else" control: no cgroup v2 line, counters refused, no fd access, no delay accounting
        f = self.fake()
        f.write("/proc/4242/stat", stat_line(4242, "worker", {3: "S", 20: 1}))
        f.thread(4242, 4242, "worker", state="S", wchan="hrtimer_nanosleep")
        f.write("/proc/4242/cgroup", "12:cpu:/legacy\n")
        class Refused(NoCounters):
            def __init__(self, tids):
                self.groups, self.error = [], "not allowed here (kernel.perf_event_paranoid)"
        d = f.run(4242, 0.5, counters=Refused)
        self.assertEqual({k: d[k] for k in ("cgroup", "cache", "cache_error", "fds", "files", "conns", "conns_n", "waits", "fd_limit")},
                         {"cgroup": {}, "cache": None, "cache_error": "not allowed here (kernel.perf_event_paranoid)", "fds": -1, "files": [],
                          "conns": [], "conns_n": 0, "waits": {"timer": 6}, "fd_limit": -1})
        self.assertEqual((d["io"]["delayacct"], d["io"]["read"]), (False, 0.0))

    def test_a_process_that_exits_during_the_look(self):
        f = self.fake()
        f.write("/proc/4242/stat", stat_line(4242, "worker", {3: "S", 20: 1}))
        f.thread(4242, 4242, "worker")
        f.at(0.3, lambda: f.remove("/proc/4242"))
        self.assertEqual(f.run(4242, 1.5), {"pid": 4242, "gone": True})

    def test_a_process_that_is_not_there(self):
        self.assertEqual(self.fake().run(4242, 1.5), {"pid": 4242, "gone": True})

    def test_counters_scale_by_the_time_each_group_was_on_the_cpu(self):
        # perf multiplexes: a group that counted for half the time it was enabled is scaled up by two
        c = self.m.Counters.__new__(self.m.Counters)
        c.names, c.groups = [n for n, _ in self.m.COUNTERS], [[11, 12, 13, 14], [21, 22]]
        data = {11: self.m.struct.pack("<QQQ4Q", 4, 2000, 1000, 100, 10, 400, 300), 21: self.m.struct.pack("<QQQ2Q", 2, 500, 500, 50, 5)}
        with mock.patch.object(self.m.os, "read", side_effect=lambda fd, n: data[fd]):
            self.assertEqual(c.read(), {"refs": 250.0, "misses": 25.0, "instructions": 800.0, "cycles": 600.0})

    def test_socket_addresses_from_proc_net(self):
        self.assertEqual(self.m.hexaddr("0100007F:1538"), ("127.0.0.1", 5432))
        self.assertEqual(self.m.hexaddr("00000000000000000000000000000000:0016"), ("0:0:0:0:0:0:0:0", 22))
        self.assertEqual(self.m.hexaddr("0000000000000000FFFF00000200000A:01BB"), ("10.0.0.2", 443))
        self.assertEqual(self.m.TCP_STATES["0A"], "listening")


class WhichInspector(unittest.TestCase):
    """inspect_process runs the inspector of the OS the process is on: this computer's own (by what it runs on,
    as local_loop picks its collector) or the machine's configured os over SSH. subprocess.run is a fake that
    records what would run and answers one JSON line, so nothing is started and no machine is read."""

    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, LIVE)
        import fleet_live
        cls.fl = fleet_live

    def look(self, cfg, system):
        from unittest import mock
        runs, macs = [], []
        def run(cmd, input=None, **kw):
            runs.append((cmd, input))
            return types.SimpleNamespace(stdout=b'warming up\n{"pid": 4242, "name": "worker"}\n', stderr=b"", returncode=0)
        m = types.SimpleNamespace(id="m-" + system, name="that machine", cfg=cfg)
        self.fl.INSPECT_CACHE.clear()
        with mock.patch.object(self.fl.platform, "system", return_value=system), mock.patch.object(self.fl.subprocess, "run", side_effect=run), \
                mock.patch.object(self.fl, "inspect_mac", side_effect=lambda pid: macs.append(pid) or {"pid": pid, "name": "worker"}):
            out = self.fl.inspect_process(m, 4242)
        self.fl.INSPECT_CACHE.clear()
        self.assertEqual((out["pid"], out["name"], out["machine"]), (4242, "worker", m.id))
        self.assertLessEqual(len(runs) + len(macs), 1)
        if macs:
            return ("in Fleet's process", "inspect_mac")
        cmd, stdin = runs[0]
        text = stdin.decode("utf-8") if stdin else ""
        what = ("inspect_windows.ps1" if "Get-Process -Id $FleetPid" in text and "$FleetPid=4242" in text else
                "inspect_linux.py" if "def classify" in text or any(str(c).endswith("inspect_linux.py") for c in cmd) else
                "the Mac reader" if "inspect_mac(4242)" in text else "?")
        prog = cmd[0] if cmd[0] != self.fl.sys.executable else "this Python"
        if prog == "ssh":
            prog = "ssh " + cmd[-1].split(" ")[0]
        return (prog, what)

    def test_each_machine_gets_its_own_systems_inspector(self):
        got = {
            "this computer, Windows": self.look({"kind": "local"}, "Windows"),
            "this computer, Linux": self.look({"kind": "local"}, "Linux"),
            "this computer, macOS": self.look({"kind": "local"}, "Darwin"),
            "Windows over SSH": self.look({"kind": "ssh", "ssh": "win-desktop", "os": "windows"}, "Darwin"),
            "Linux over SSH": self.look({"kind": "ssh", "ssh": "nas", "os": "linux"}, "Darwin"),
            "a Mac over SSH": self.look({"kind": "ssh", "ssh": "mac-mini", "os": "macos"}, "Linux"),
            "no os given, over SSH": self.look({"kind": "ssh", "ssh": "dev-vm"}, "Windows"),
        }
        self.assertEqual(got, {
            "this computer, Windows": ("powershell", "inspect_windows.ps1"),   # was this Python running inspect_linux.py (#287)
            "this computer, Linux": ("this Python", "inspect_linux.py"),
            "this computer, macOS": ("in Fleet's process", "inspect_mac"),
            "Windows over SSH": ("ssh powershell", "?"),                      # the script goes in -EncodedCommand, not on stdin
            "Linux over SSH": ("ssh python3", "inspect_linux.py"),
            "a Mac over SSH": ("ssh python3", "the Mac reader"),
            "no os given, over SSH": ("ssh python3", "inspect_linux.py"),
        })

    def test_this_windows_computer_reads_the_inspector_from_stdin_with_its_pid(self):
        from unittest import mock
        runs = []
        def run(cmd, input=None, **kw):
            runs.append((cmd, input))
            return types.SimpleNamespace(stdout=b'{"pid": 4242, "gone": true}\r\n', stderr=b"", returncode=0)
        m = types.SimpleNamespace(id="this", name="this computer", cfg={"kind": "local"})
        self.fl.INSPECT_CACHE.clear()
        with mock.patch.object(self.fl.platform, "system", return_value="Windows"), mock.patch.object(self.fl.subprocess, "run", side_effect=run):
            out = self.fl.inspect_process(m, 4242)
        self.fl.INSPECT_CACHE.clear()
        self.assertEqual({k: out[k] for k in ("pid", "gone", "machine")}, {"pid": 4242, "gone": True, "machine": "this"})
        cmd, stdin = runs[0]
        boot, script = self.fl.ps_launch("x")
        self.assertEqual(cmd, boot, "the same short starter the local collector uses (#269)")
        lines = stdin.decode("ascii").splitlines()
        self.assertEqual((lines[:2], lines[-1]), (["$FleetPid=4242", "$FleetSecs=%s" % self.fl.INSPECT_SECS], self.fl.PS_END))
        with open(os.path.join(LIVE, "inspect_windows.ps1"), encoding="utf-8") as f:
            self.assertEqual("\n".join(lines[2:-1]), self.fl.ps_compact(f.read()))


class InspectAnswers(unittest.TestCase):
    """What inspect_process makes of what the inspector printed: the last JSON line of its output, else the
    last line of its errors, else that nothing came; a look that takes too long, and one that can't start."""

    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, LIVE)
        import fleet_live
        cls.fl = fleet_live

    def answer(self, stdout=b"", stderr=b"", raises=None):
        def run(cmd, input=None, **kw):
            if raises:
                raise raises
            return types.SimpleNamespace(stdout=stdout, stderr=stderr, returncode=0 if stdout else 1)
        m = types.SimpleNamespace(id="nas", name="nas", cfg={"kind": "ssh", "ssh": "nas", "os": "linux"})
        self.fl.INSPECT_CACHE.clear()
        with mock.patch.object(self.fl.subprocess, "run", side_effect=run):
            out = self.fl.inspect_process(m, 4242)
        self.fl.INSPECT_CACHE.clear()
        self.assertEqual((out.pop("machine"), type(out.pop("t"))), ("nas", float))
        return out

    def test_what_each_kind_of_output_becomes(self):
        tb = b"Traceback (most recent call last):\n  File \"<stdin>\", line 10, in <module>\nAttributeError: module 'os' has no attribute 'sysconf'\n"
        got = {
            "a login banner, then the answer": self.answer(b"Welcome to nas\n{\"pid\": 4242, \"name\": \"worker\"}\n"),
            "Windows line ends": self.answer(b'{"pid": 4242, "name": "worker.exe"}\r\n'),
            "two answers: the last": self.answer(b'{"pid": 4242, "name": "old"}\n{"pid": 4242, "name": "new"}\n'),
            "the process is gone": self.answer(b'{"pid": 4242, "gone": true}\n'),
            "no python3": self.answer(stderr=b"bash: line 1: python3: command not found\n"),
            "a traceback": self.answer(b"half a line", tb),
            "nothing at all": self.answer(),
            "too slow": self.answer(raises=self.fl.subprocess.TimeoutExpired(["ssh"], 30)),
            "no ssh": self.answer(raises=FileNotFoundError(2, "No such file or directory", "ssh")),
        }
        self.assertEqual(got, {
            "a login banner, then the answer": {"pid": 4242, "name": "worker"},
            "Windows line ends": {"pid": 4242, "name": "worker.exe"},
            "two answers: the last": {"pid": 4242, "name": "new"},
            "the process is gone": {"pid": 4242, "gone": True},
            "no python3": {"pid": 4242, "error": "bash: line 1: python3: command not found"},
            "a traceback": {"pid": 4242, "error": "AttributeError: module 'os' has no attribute 'sysconf'"},
            "nothing at all": {"pid": 4242, "error": "no answer from nas"},
            "too slow": {"pid": 4242, "error": "nas took too long to answer"},
            "no ssh": {"pid": 4242, "error": "[Errno 2] No such file or directory: 'ssh'"},
        })

    def test_a_long_error_is_cut_to_300_characters(self):
        self.assertEqual(self.answer(stderr=b"x" * 1000), {"pid": 4242, "error": "x" * 300})


@unittest.skipUnless(sys.platform == "win32", "the Windows inspector reads this Windows computer")
class WindowsInspector(unittest.TestCase):
    """inspect_windows.ps1, run the way Fleet runs it on this computer, on this test's own process."""

    def test_this_test_process(self):
        sys.path.insert(0, LIVE)
        import fleet_live
        stop = threading.Event()
        threading.Thread(target=stop.wait, daemon=True).start()
        m = types.SimpleNamespace(id="this", name="this computer", cfg={"kind": "local"})
        fleet_live.INSPECT_CACHE.clear()
        try:
            d = fleet_live.inspect_process(m, os.getpid())
        finally:
            stop.set()
            fleet_live.INSPECT_CACHE.clear()
        self.assertEqual(set(d), {"pid", "name", "state", "ppid", "nice", "priority", "priority_class", "threads_n", "started", "last_cpu", "user",
                                  "cmdline", "exe", "cwd", "affinity_mask", "cpu", "mem", "io", "waits", "samples", "dt", "threads", "fds", "fd_limit",
                                  "handles", "files", "conns", "conns_n", "cgroup", "cache", "cache_error", "machine", "t"}, d)
        self.assertEqual((d["pid"], d["ppid"], d["cgroup"], d["cache"], d["files"]), (os.getpid(), os.getppid(), None, None, []))
        self.assertIn("python", d["cmdline"].lower())
        self.assertEqual(set(d["cpu"]), {"user", "system"})
        self.assertEqual(set(d["mem"]), {"rss", "private", "peak", "paged", "virt", "faults"})
        self.assertEqual(set(d["io"]), {"read", "write", "other"})
        self.assertLessEqual(set(d["waits"]), {"cpu", "cpuwait", "stopped", "events", "other", "timer", "pipe", "lock", "memory"}, d["waits"])
        self.assertGreaterEqual(sum(d["waits"].values()), 2 * d["samples"], d)
        self.assertGreater(d["handles"], 0)
        self.assertGreaterEqual(d["threads_n"], 2)
        self.assertTrue(all(set(t) == {"tid", "name", "cpu", "total", "doing", "prio"} for t in d["threads"]), d["threads"])


@unittest.skipUnless(sys.platform == "darwin", "the Mac inspector reads this Mac")
class MacInspector(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        argv = sys.argv
        sys.argv = ["fleet_live.py"]
        try:
            cls.fl = load("fleet_live_under_test", os.path.join(LIVE, "fleet_live.py"))
        finally:
            sys.argv = argv
        cls.fl.INSPECT_SECS = 0.3

    def test_this_test_process(self):
        stop = threading.Event()
        t = threading.Thread(target=stop.wait, daemon=True)
        t.start()
        try:
            d = self.fl.inspect_mac(os.getpid())
        finally:
            stop.set()
        self.assertEqual(d["pid"], os.getpid())
        self.assertGreaterEqual(d["threads_n"], 2)
        # every thread lands in a state ps -M names (a broken STAT column would put them all in "other"), the
        # thread blocked on the Event among them, in every sample
        self.assertLessEqual(set(d["waits"]), {"cpu", "disk", "sleep", "idle", "stopped"}, d["waits"])
        self.assertIn("sleep", d["waits"])
        self.assertGreaterEqual(sum(d["waits"].values()), 2 * d["samples"], d)
        self.assertGreater(d["mem"]["rss"], 1e6)
        self.assertIn("python", d["cmdline"].lower())
        self.assertIsNone(d["cache"])

    def test_a_process_that_is_gone(self):
        self.assertEqual(self.fl.inspect_mac(2 ** 30), {"pid": 2 ** 30, "gone": True})

    def test_answers_are_shared_for_a_second(self):
        m = types.SimpleNamespace(id="this", name="this computer", cfg={"kind": "local"})
        a = self.fl.inspect_process(m, os.getpid())
        b = self.fl.inspect_process(m, os.getpid())
        self.assertIs(a, b)
        self.assertEqual(a["machine"], "this")


if __name__ == "__main__":
    unittest.main()
