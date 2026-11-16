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

    def run(self, pid, secs, counters=None):
        fake, t0 = self, 1000.0
        clock = types.SimpleNamespace(t=t0)
        def sleep(s):
            clock.t += s
            while fake.changes and clock.t - t0 >= fake.changes[0][0]:
                fake.changes.pop(0)[1]()
        fos = types.SimpleNamespace(listdir=lambda p: os.listdir(fake.path(p)), readlink=lambda p: os.readlink(fake.path(p)),
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
        self.assertTrue(d["waits"], d)
        self.assertLessEqual(set(d["waits"]), {"cpu", "disk", "sleep", "idle", "stopped", "other"})
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
