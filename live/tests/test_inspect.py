# SPDX-License-Identifier: GPL-3.0-or-later
"""The process inspector: inspect_linux.py's classifier and socket parsing, and the Mac inspector."""
import importlib.util, os, sys, threading, types, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


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
        self.assertEqual("\n".join(lines[2:-1]), self.fl.ps_compact(open(os.path.join(LIVE, "inspect_windows.ps1"), encoding="utf-8").read()))


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
