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
