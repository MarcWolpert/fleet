# SPDX-License-Identifier: GPL-3.0-or-later
"""Inline terminals (#329): ttyd serves a terminal running the same command as Open terminal, on loopback only, at a
random port and an unguessable path, for one client, letting only its own page connect; the page frames it in a drawer.
A stand-in ttyd (prints ttyd's 'Listening on port' line, then waits) makes a real process Fleet must start and end."""
import importlib.util, os, platform, re, stat, sys, tempfile, time, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)
argv, sys.argv = sys.argv, ["fleet_live.py"]
try:
    spec = importlib.util.spec_from_file_location("fleet_live_inline_test", os.path.join(LIVE, "fleet_live.py"))
    fl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fl)
finally:
    sys.argv = argv


class Command(unittest.TestCase):
    def test_ttyd_on_loopback_once_writable_own_origin_secret_path(self):
        lo = "lo0" if platform.system() == "Darwin" else "lo"
        self.assertEqual(fl.ttyd_argv("/x/ttyd", "TOKEN", ["ssh", "-t", "nas"], {"fontSize": "13"}),
                         ["/x/ttyd", "--port", "0", "--interface", lo, "--once", "--writable", "--check-origin", "--base-path", "/TOKEN",
                          "--client-option", "fontSize=13", "ssh", "-t", "nas"])

    def test_what_it_runs(self):
        f = fl.Fleet.__new__(fl.Fleet)
        f.machines = {"nas": fl.Machine({"id": "nas", "name": "nas", "ssh": "admin@nas", "os": "linux"}, 3),
                      "here": fl.Machine({"id": "here", "name": "here", "kind": "local"}, 3)}
        f.lock, f.specs = fl.threading.Lock(), {}
        self.assertEqual(fl.inline_argv(f, "nas", ""), (["ssh", "admin@nas"], "nas"))
        self.assertEqual(fl.inline_argv(f, "nas", "tmux new -A -s fleet"), (["ssh", "-t", "admin@nas", "tmux new -A -s fleet"], "nas"))
        sh = os.environ.get("SHELL") or "/bin/sh"
        self.assertEqual(fl.inline_argv(f, "here", ""), ([sh, "-l"], "here"))
        self.assertEqual(fl.inline_argv(f, "here", "tmux new -A -s fleet"), ([sh, "-lc", "tmux new -A -s fleet"], "here"))
        with self.assertRaises(ValueError):
            fl.inline_argv(f, "nas", "tmux\nrm -rf /")


class Sessions(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.fake = os.path.join(self.dir.name, "ttyd")
        with open(self.fake, "w") as f:
            f.write("#!/bin/sh\necho '[2026/11/15 21:29:24:5566] N:  Listening on port: 54321'\nexec sleep 30\n")
        os.chmod(self.fake, os.stat(self.fake).st_mode | stat.S_IEXEC)
        self.old = fl.ttyd_path
        fl.ttyd_path = lambda: self.fake

    def tearDown(self):
        for sid in list(fl.INLINE):
            fl.close_inline(sid)
        fl.ttyd_path = self.old
        self.dir.cleanup()

    def test_open_gives_a_loopback_url_at_a_secret_path_and_close_ends_it(self):
        r = fl.open_inline(["echo", "hi"], "lab", {})
        self.assertRegex(r["url"], r"^http://127\.0\.0\.1:54321/[A-Za-z0-9_-]{32,}/$")
        self.assertEqual(r["title"], "lab")
        p = fl.INLINE[r["id"]]["proc"]
        self.assertIsNone(p.poll())
        fl.close_inline(r["id"])
        end = time.time() + 3
        while p.poll() is None and time.time() < end:
            time.sleep(0.05)
        self.assertIsNotNone(p.poll(), "its ttyd ended")
        self.assertNotIn(r["id"], fl.INLINE)

    def test_at_most_six_at_once_the_oldest_goes(self):
        first = fl.open_inline(["echo"], "a", {})
        for i in range(6):
            fl.open_inline(["echo"], "b%d" % i, {})
        self.assertEqual(len(fl.INLINE), 6)
        self.assertNotIn(first["id"], fl.INLINE)

    def test_without_ttyd_it_says_how_to_get_it(self):
        fl.ttyd_path = lambda: None
        with self.assertRaises(RuntimeError) as e:
            fl.open_inline(["echo"], "a", {})
        self.assertIn("brew install ttyd", str(e.exception))
        self.assertIn("apt install ttyd", str(e.exception))


if __name__ == "__main__":
    unittest.main()
