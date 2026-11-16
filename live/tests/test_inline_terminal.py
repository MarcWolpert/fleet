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

    def test_its_own_page_when_fleet_has_one(self):
        lo = "lo0" if platform.system() == "Darwin" else "lo"
        self.assertEqual(fl.ttyd_argv("/x/ttyd", "TOKEN", ["sh"], {}, index="/tmp/i.html"),
                         ["/x/ttyd", "--port", "0", "--interface", lo, "--once", "--writable", "--check-origin", "--base-path", "/TOKEN",
                          "--index", "/tmp/i.html", "sh"])

    def test_text_size_and_title_options(self):
        # #335: its own text size, which may be small (more tmux panes) or fractional (Fleet's zoom divided out)
        self.assertEqual(fl.inline_opts({"fontSize": 10.5}, "nas")["fontSize"], "10.5")
        self.assertEqual(fl.inline_opts({"fontSize": 2}, "nas")["fontSize"], "6")
        self.assertEqual(fl.inline_opts({"fontSize": 99}, "nas")["fontSize"], "32")
        self.assertEqual(fl.inline_opts({"fontSize": "x"}, "nas")["fontSize"], "13")
        o = fl.inline_opts({"theme": {"background": "#1d1d20", "foreground": "red", "evil": "#000000"}}, "nas")
        self.assertEqual(o["titleFixed"], "nas")
        self.assertEqual(fl.json.loads(o["theme"]), {"background": "#1d1d20"})

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


class OwnPage(unittest.TestCase):
    """#335: ttyd's own page, with Fleet's text-size script added, so the page framing it can resize its text live."""
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.fake = os.path.join(self.dir.name, "ttyd")
        with open(self.fake, "w") as f:   # a stand-in ttyd serving a page like ttyd's at its base path
            f.write("#!%s\n" % sys.executable + "\n".join([
                "import sys, http.server",
                "base = sys.argv[sys.argv.index('--base-path') + 1]",
                "class H(http.server.BaseHTTPRequestHandler):",
                "    def do_GET(s):",
                "        b = b'<html><head></head><body><script>window.term=t,window.term.fit=()=>{}</script></body></html>'",
                "        s.send_response(200 if s.path == base + '/' else 404); s.send_header('Content-Length', str(len(b))); s.end_headers(); s.wfile.write(b)",
                "    def log_message(s, *a): pass",
                "srv = http.server.HTTPServer(('127.0.0.1', 0), H)",
                "print('[2026/11/15 21:29:24:5566] N:  Listening on port: %d' % srv.server_address[1], flush=True)",
                "srv.serve_forever()", ""]))
        os.chmod(self.fake, os.stat(self.fake).st_mode | stat.S_IEXEC)
        fl.TTYD_INDEX.clear()

    def tearDown(self):
        fl.TTYD_INDEX.clear()
        self.dir.cleanup()

    def test_the_script_goes_into_ttyds_page(self):
        page = "<html><body><script>window.term=t</script></body></html>"
        out = fl.inject_index(page)
        self.assertIn(fl.TTYD_SIZE_JS.strip()[:40], out)
        self.assertLess(out.index("window.term=t"), out.index("termFont"))
        self.assertTrue(out.rstrip().endswith("</body></html>"))
        self.assertIsNone(fl.inject_index("<html><body>another page</body></html>"), "not a ttyd page Fleet knows")

    def test_made_once_from_the_ttyd_here(self):
        path = fl.ttyd_index(self.fake)
        self.assertTrue(path and os.path.exists(path))
        body = open(path).read()
        self.assertIn("termFont", body)
        self.assertIn("window.term=t", body)
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode) & 0o077, 0, "only yours")
        self.assertEqual(fl.ttyd_index(self.fake), path, "kept for the next session")
        f = fl.Fleet.__new__(fl.Fleet)
        f.machines = {}
        fl.stop_collectors(f)
        self.assertFalse(os.path.exists(os.path.dirname(path)), "gone when Fleet stops")

    def test_a_ttyd_that_wont_serve_means_no_page(self):
        bad = os.path.join(self.dir.name, "bad")
        with open(bad, "w") as f:
            f.write("#!/bin/sh\nexit 3\n")
        os.chmod(bad, 0o755)
        self.assertIsNone(fl.ttyd_index(bad))


class Sessions(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.fake = os.path.join(self.dir.name, "ttyd")
        with open(self.fake, "w") as f:
            f.write("#!/bin/sh\necho '[2026/11/15 21:29:24:5566] N:  Listening on port: 54321'\nexec sleep 30\n")
        os.chmod(self.fake, os.stat(self.fake).st_mode | stat.S_IEXEC)
        self.old, self.old_index = fl.ttyd_path, fl.ttyd_index
        fl.ttyd_path = lambda: self.fake
        fl.ttyd_index = lambda ttyd: None

    def tearDown(self):
        for sid in list(fl.INLINE):
            fl.close_inline(sid)
        fl.ttyd_path, fl.ttyd_index = self.old, self.old_index
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
