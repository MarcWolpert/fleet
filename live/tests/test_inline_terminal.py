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
    def test_ttyd_on_loopback_writable_own_origin_secret_path(self):
        lo = "lo0" if platform.system() == "Darwin" else "lo"
        self.assertEqual(fl.ttyd_argv("/x/ttyd", "TOKEN", ["ssh", "-t", "nas"], {"fontSize": "13"}),
                         ["/x/ttyd", "--port", "0", "--interface", lo, "--writable", "--check-origin", "--base-path", "/fleet-TOKEN",
                          "--client-option", "fontSize=13", "ssh", "-t", "nas"])

    def test_its_own_page_when_fleet_has_one(self):
        lo = "lo0" if platform.system() == "Darwin" else "lo"
        self.assertEqual(fl.ttyd_argv("/x/ttyd", "TOKEN", ["sh"], {}, index="/tmp/i.html"),
                         ["/x/ttyd", "--port", "0", "--interface", lo, "--writable", "--check-origin", "--base-path", "/fleet-TOKEN",
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

    def test_inline_can_be_the_default(self):
        cfg, errors = fl.validate_config({"interval": 3, "terminal": "inline", "machine": [{"id": "here", "name": "here", "kind": "local"}]})
        self.assertEqual(errors, [])
        self.assertEqual(cfg["terminal"], "inline")

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
        self.assertIn(fl.TTYD_BRIDGE_JS.strip()[:40], out)
        self.assertLess(out.index("window.term=t"), out.index("termFont"))
        self.assertTrue(out.rstrip().endswith("</body></html>"))
        self.assertIsNone(fl.inject_index("<html><body>another page</body></html>"), "not a ttyd page Fleet knows")

    def test_made_once_from_the_ttyd_here(self):
        path = fl.ttyd_index(self.fake)
        self.assertTrue(path and os.path.exists(path))
        with open(path) as f:
            body = f.read()
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


def load(path):
    with open(path) as f:
        return fl.json.load(f)


def stub_fleet():
    f = fl.Fleet.__new__(fl.Fleet)
    f.machines = {"nas": fl.Machine({"id": "nas", "name": "nas", "ssh": "admin@nas", "os": "linux"}, 3),
                  "here": fl.Machine({"id": "here", "name": "here", "kind": "local"}, 3)}
    f.lock, f.specs = fl.threading.Lock(), {}
    return f


class Reconnect(unittest.TestCase):
    """#337: a dropped SSH connection (ssh exits 255) reconnects; any other exit ends the terminal."""
    def test_only_ssh_is_wrapped(self):
        self.assertEqual(fl.reconnecting(["ssh", "-t", "nas", "x"]), ["sh", "-c", fl.RECONNECT_SH, "fleet", "ssh", "-t", "nas", "x"])
        self.assertEqual(fl.reconnecting(["/bin/zsh", "-l"]), ["/bin/zsh", "-l"])

    def test_it_tries_again_after_a_drop_and_stops_on_a_real_exit(self):
        with tempfile.TemporaryDirectory() as d:
            n, fake = os.path.join(d, "n"), os.path.join(d, "ssh")
            with open(fake, "w") as f:   # drops twice, then the user types exit (status 7 here)
                f.write("#!/bin/sh\necho x >> %s\n[ $(wc -l < %s) -ge 3 ] && exit 7\nexit 255\n" % (n, n))
            os.chmod(fake, 0o755)
            argv = fl.reconnecting(["ssh", "nas"])
            r = fl.subprocess.run([argv[0], argv[1], argv[2], argv[3], fake, "nas"], capture_output=True, text=True, timeout=20,
                                  env=dict(os.environ, FLEET_RECONNECT_WAIT="0"))
            self.assertEqual(r.returncode, 7)
            with open(n) as f:
                self.assertEqual(f.read().count("x"), 3)
            self.assertEqual(r.stdout.count("reconnecting"), 2)


class Sessions(unittest.TestCase):
    """A stand-in ttyd (prints ttyd's 'Listening on port' line, then waits) makes a real process to start and end."""
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.fake = os.path.join(self.dir.name, "ttyd")
        with open(self.fake, "w") as f:
            f.write("#!/bin/sh\necho '[2026/11/15 21:29:24:5566] N:  Listening on port: 54321'\nexec sleep 30\n")
        os.chmod(self.fake, os.stat(self.fake).st_mode | stat.S_IEXEC)
        self.saved = (fl.ttyd_path, fl.ttyd_index, fl.tmux_path, fl.TERMS_PATH, fl.INLINE_MAX)
        fl.ttyd_path, fl.ttyd_index, fl.tmux_path = (lambda: self.fake), (lambda ttyd: None), (lambda: None)
        fl.TERMS_PATH = os.path.join(self.dir.name, "terminals.json")
        fl.INLINE.clear()
        self.f = stub_fleet()

    def tearDown(self):
        for sid in list(fl.INLINE):
            fl.close_inline(sid)
        fl.ttyd_path, fl.ttyd_index, fl.tmux_path, fl.TERMS_PATH, fl.INLINE_MAX = self.saved
        self.dir.cleanup()

    def wait_end(self, p):
        end = time.time() + 3
        while p.poll() is None and time.time() < end:
            time.sleep(0.05)
        return p.poll() is not None

    def test_a_loopback_url_at_a_secret_path_and_close_ends_it(self):
        r = fl.new_inline(self.f, "nas", "", {})
        self.assertRegex(r["url"], r"^http://127\.0\.0\.1:54321/fleet-[A-Za-z0-9_-]{32,}/$")
        self.assertEqual(r["title"], "nas")
        p = fl.INLINE[r["id"]]["proc"]
        self.assertIsNone(p.poll())
        self.assertTrue(fl.close_inline(r["id"]))
        self.assertTrue(self.wait_end(p), "its ttyd ended")
        self.assertNotIn(r["id"], fl.INLINE)
        self.assertEqual(load(fl.TERMS_PATH)["terminals"], [], "and it's gone from the setup")

    def test_the_setup_is_kept_and_comes_back(self):
        a = fl.new_inline(self.f, "nas", "tmux new -A -s fleet", {})
        b = fl.new_inline(self.f, "here", "", {})
        kept = load(fl.TERMS_PATH)["terminals"]
        self.assertEqual([(t["id"], t["node"], t["then"], t["title"]) for t in kept], [(a["id"], "nas", "tmux new -A -s fleet", "nas"), (b["id"], "here", "", "here")])
        self.assertNotIn("fleet-", fl.json.dumps(kept), "no secret path or port in the file")
        fl.stop_inline()   # Fleet stops: ttyd ends, the setup stays
        fl.INLINE.clear()
        fl.load_terms()
        self.assertEqual([(x["id"], x["node"], x["title"], x["live"]) for x in fl.list_inline()], [(a["id"], "nas", "nas", False), (b["id"], "here", "here", False)])

    def test_stopping_fleet_ends_ttyd_and_attach_starts_it_again(self):
        r = fl.new_inline(self.f, "nas", "", {})
        p = fl.INLINE[r["id"]]["proc"]
        fl.stop_inline()
        self.assertTrue(self.wait_end(p))
        self.assertIn(r["id"], fl.INLINE)
        again = fl.attach_inline(self.f, r["id"], {})
        self.assertEqual(again["id"], r["id"])
        self.assertNotEqual(again["url"], r["url"], "a new secret path")
        self.assertIsNone(fl.INLINE[r["id"]]["proc"].poll())
        self.assertEqual(fl.attach_inline(self.f, r["id"], {})["url"], again["url"], "a running one is reused")

    def test_attach_to_one_fleet_doesnt_know(self):
        with self.assertRaises(KeyError):
            fl.attach_inline(self.f, "nope", {})

    def test_a_cap_and_it_says_so(self):
        fl.INLINE_MAX = 2
        fl.new_inline(self.f, "nas", "", {})
        fl.new_inline(self.f, "nas", "", {})
        with self.assertRaises(RuntimeError) as e:
            fl.new_inline(self.f, "nas", "", {})
        self.assertIn("close one", str(e.exception))
        self.assertEqual(len(fl.INLINE), 2, "none closed behind your back")

    def test_without_ttyd_it_says_how_to_get_it(self):
        fl.ttyd_path = lambda: None
        with self.assertRaises(RuntimeError) as e:
            fl.new_inline(self.f, "nas", "", {})
        self.assertIn("brew install ttyd", str(e.exception))
        self.assertIn("apt install ttyd", str(e.exception))
        self.assertEqual(fl.INLINE, {})


@unittest.skipUnless(fl.tmux_path(), "tmux isn't installed here")
class Durable(unittest.TestCase):
    """#337: the shell lives in a tmux session on Fleet's own socket: it outlives ttyd and Fleet, and ends with its tab."""
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.fake = os.path.join(self.dir.name, "ttyd")
        with open(self.fake, "w") as f:
            f.write("#!/bin/sh\necho 'N:  Listening on port: 54321'\nexec sleep 30\n")
        os.chmod(self.fake, 0o755)
        self.saved = (fl.ttyd_path, fl.ttyd_index, fl.TERMS_PATH, fl.TMUX_SOCKET)
        fl.ttyd_path, fl.ttyd_index = (lambda: self.fake), (lambda ttyd: None)
        fl.TERMS_PATH = os.path.join(self.dir.name, "terminals.json")
        fl.TMUX_SOCKET = "fleet-inline-test-%d" % os.getpid()
        fl.INLINE.clear()
        self.f = stub_fleet()
        self.f.machines["here"].cfg["kind"] = "local"

    def tearDown(self):
        for sid in list(fl.INLINE):
            fl.close_inline(sid)
        fl.subprocess.run([fl.tmux_path(), "-L", fl.TMUX_SOCKET, "kill-server"], capture_output=True)
        fl.ttyd_path, fl.ttyd_index, fl.TERMS_PATH, fl.TMUX_SOCKET = self.saved
        self.dir.cleanup()

    def test_ttyd_attaches_to_its_own_session(self):
        tmux = fl.tmux_path()
        self.assertEqual(fl.session_argv("abc", ["ssh", "nas"], tmux),
                         [tmux, "-L", fl.TMUX_SOCKET, "-f", fl.tmux_conf(), "new-session", "-A", "-s", "fleet-abc"] + fl.reconnecting(["ssh", "nas"]))
        with open(fl.tmux_conf()) as f:
            conf = f.read()
        for line in ("set -g prefix None", "set -g status off", "set -g mouse on"):
            self.assertIn(line, conf)

    def test_the_shell_outlives_ttyd_and_fleet_and_ends_with_its_tab(self):
        r = fl.new_inline(self.f, "here", "exec sleep 120", {})
        self.assertIn("fleet-" + r["id"], fl.tmux_sessions(), "started at once, before any page connects")
        fl.stop_inline()   # Fleet quits or restarts
        fl.INLINE.clear()
        fl.load_terms()
        fl.prune_tmux()
        self.assertIn("fleet-" + r["id"], fl.tmux_sessions(), "still there for the next Fleet")
        fl.close_inline(r["id"])
        self.assertNotIn("fleet-" + r["id"], fl.tmux_sessions(), "closing the tab ends the shell")

    def test_sessions_fleet_no_longer_knows_are_ended(self):
        tmux = fl.tmux_path()
        fl.subprocess.run([tmux, "-L", fl.TMUX_SOCKET, "-f", fl.tmux_conf(), "new-session", "-d", "-s", "fleet-gone", "sleep", "120"], check=True)
        fl.subprocess.run([tmux, "-L", fl.TMUX_SOCKET, "new-session", "-d", "-s", "yours", "sleep", "120"], check=True)
        fl.prune_tmux()
        self.assertNotIn("fleet-gone", fl.tmux_sessions())
        self.assertIn("yours", fl.tmux_sessions(), "only Fleet's")


if __name__ == "__main__":
    unittest.main()
