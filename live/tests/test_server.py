# SPDX-License-Identifier: GPL-3.0-or-later
"""The server itself: who it answers, how it restarts itself, and when it reopens the app window. Nothing
here starts, stops or replaces a real process or opens a window: os.execv, save_state, stop_collectors and
open_app_window are replaced by mocks, time runs on a fake clock, and saved state goes to a temporary file.
The HTTP tests run the handler on a free port of 127.0.0.1 and send only requests that write nothing.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import contextlib
import email.message
import http.client
import http.server
import io
import ntpath
import os
import sys
import tempfile
import threading
import types
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import fleet_live  # noqa: E402


class RestartSelf(unittest.TestCase):
    """restart_self saves state, stops the collectors, then replaces the process with this script again:
    --open becomes --open-if-unseen (the window is reopened only if it's gone), every other argument stays."""

    def restart(self, system, executable, script, argv):
        calls, fleet = mock.Mock(), types.SimpleNamespace(machines={})   # no machine turned off: FLEET_OFF is empty (#208)
        abspath = ntpath.abspath if system == "Windows" else os.path.abspath
        with mock.patch.object(fleet_live, "save_state", calls.save_state), mock.patch.object(fleet_live, "stop_collectors", calls.stop_collectors), \
                mock.patch.object(fleet_live.os, "execv", calls.execv), mock.patch.object(fleet_live.platform, "system", return_value=system), \
                mock.patch.object(fleet_live.os.path, "abspath", abspath), mock.patch.object(fleet_live, "__file__", script), \
                mock.patch.object(fleet_live.sys, "executable", executable), mock.patch.object(fleet_live.sys, "argv", argv), \
                mock.patch.dict(fleet_live.os.environ), contextlib.redirect_stdout(io.StringIO()) as out:
            fleet_live.restart_self(fleet, "Fleet changed")
        self.assertEqual(out.getvalue(), "Fleet changed; restarting\n")
        self.assertEqual([c[0] for c in calls.mock_calls], ["save_state", "stop_collectors", "execv"])
        self.assertEqual(calls.save_state.call_args.args, (fleet,))
        return calls.execv.call_args.args

    def test_on_windows_every_argument_with_a_space_is_quoted(self):
        # The C runtime's _wexecv joins argv with spaces and quotes nothing; the new process splits its
        # command line again by Microsoft's rules, so an argument with a space must arrive quoted.
        exe = r"C:\Program Files\Python313\python.exe"
        got = self.restart("Windows", exe, r"C:\Users\Jo Doe\OneDrive - Example\fleet\live\fleet_live.py",
                           [r"C:\Users\Jo Doe\OneDrive - Example\fleet\live\fleet_live.py", "--config", r"C:\Users\Jo Doe\.config\fleet\machines.toml",
                            "--port", "4519", "--open"])
        self.assertEqual(got, (exe, [r'"C:\Program Files\Python313\python.exe"', r'"C:\Users\Jo Doe\OneDrive - Example\fleet\live\fleet_live.py"',
                                     "--config", r'"C:\Users\Jo Doe\.config\fleet\machines.toml"', "--port", "4519", "--open-if-unseen"]))

    def test_on_windows_paths_without_spaces_are_left_alone(self):
        exe = r"C:\Python313\python.exe"
        got = self.restart("Windows", exe, r"C:\fleet\live\fleet_live.py", [r"C:\fleet\live\fleet_live.py", "--open-if-unseen", "--no-watch"])
        self.assertEqual(got, (exe, [exe, r"C:\fleet\live\fleet_live.py", "--no-watch", "--open-if-unseen"]))

    def test_on_linux_and_macos_arguments_go_through_as_they_are(self):
        # execv hands argv over as a list there: quoting would put the quotes into the arguments.
        for system in ("Linux", "Darwin"):
            exe = "/opt/py 3.13/bin/python3"
            got = self.restart(system, exe, "/home/jo/My Code/fleet/live/fleet_live.py",
                               ["/home/jo/My Code/fleet/live/fleet_live.py", "--open", "--config", "/home/jo/My Config/machines.toml"])
            self.assertEqual(got, (exe, [exe, "/home/jo/My Code/fleet/live/fleet_live.py", "--config", "/home/jo/My Config/machines.toml",
                                         "--open-if-unseen"]), system)

    def test_a_second_restart_asks_for_the_window_only_once(self):
        exe = "/usr/bin/python3"
        got = self.restart("Linux", exe, "/srv/fleet/live/fleet_live.py", ["/srv/fleet/live/fleet_live.py", "--port", "4519", "--open-if-unseen"])
        self.assertEqual(got, (exe, [exe, "/srv/fleet/live/fleet_live.py", "--port", "4519", "--open-if-unseen"]))


class Clock:
    """Fake time for fleet_live: sleep() moves the clock on, and a Fleet window's polls of /api/fleet land in
    LAST_CLIENT as the clock passes them."""

    def __init__(self, t, polls=()):
        self.t, self.polls = t, sorted(polls)

    def time(self):
        return self.t

    def sleep(self, secs):
        self.t += secs
        while self.polls and self.polls[0] <= self.t:
            fleet_live.LAST_CLIENT[0] = self.polls.pop(0)


SINCE = 100000.0   # when the server restarted, or the UI files changed


class ReopenIfUnseen(unittest.TestCase):
    """After a restart or a UI change the app window is reopened only if no Fleet window is left. A visible page
    polls every 2 s; Chrome runs the timers of a page hidden for 5 minutes (minimized or covered) only about
    once a minute, so a window seen in the last minute is waited for until a minute after its last poll."""

    def setUp(self):
        self.addCleanup(fleet_live.LAST_CLIENT.__setitem__, 0, fleet_live.LAST_CLIENT[0])

    def reopen(self, last_poll, polls=()):
        """Returns when the window was opened (None if it wasn't) and when reopen_if_unseen gave up waiting."""
        fleet_live.LAST_CLIENT[0] = last_poll
        clock, opened = Clock(SINCE, polls), []
        with mock.patch.object(fleet_live, "time", clock), \
                mock.patch.object(fleet_live, "open_app_window", side_effect=lambda url: opened.append((url, clock.t))):
            fleet_live.reopen_if_unseen("http://127.0.0.1:4518/", SINCE)
        self.assertLessEqual(len(opened), 1)
        return (opened[0][1] - SINCE if opened else None), clock.t - SINCE

    def test_a_visible_window_is_seen_at_its_next_poll(self):
        self.assertEqual(self.reopen(SINCE - 1, [SINCE + 1, SINCE + 3]), (None, 1.0))

    def test_a_hidden_window_polling_once_a_minute_is_left_alone(self):
        self.assertEqual(self.reopen(SINCE - 30, [SINCE + 30]), (None, 30.0))
        self.assertEqual(self.reopen(SINCE - 5, [SINCE + 56]), (None, 56.0), "a minute and a bit between two polls")

    def test_no_window_for_a_while_reopens_after_eight_seconds(self):
        self.assertEqual(self.reopen(SINCE - 3600), (8.0, 8.0))
        self.assertEqual(self.reopen(0.0), (8.0, 8.0), "no window since Fleet started")

    def test_a_window_closed_just_before_reopens_once_it_would_have_polled(self):
        self.assertEqual(self.reopen(SINCE - 20), (55.0, 55.0))

    def test_the_last_poll_survives_a_restart(self):
        # restart_self saves state before it replaces the process; the new process loads it before it
        # starts waiting for a window.
        with tempfile.TemporaryDirectory() as d, mock.patch.object(fleet_live, "STATE_PATH", os.path.join(d, "state.json")):
            fleet = mock.Mock(machines={})
            fleet_live.LAST_CLIENT[0] = SINCE - 30
            with contextlib.redirect_stdout(io.StringIO()) as out:
                fleet_live.save_state(fleet)
            fleet_live.LAST_CLIENT[0] = 0.0      # a new process
            fleet_live.load_state(fleet)
        self.assertEqual((fleet_live.LAST_CLIENT[0], out.getvalue()), (SINCE - 30, ""))


def allowed(headers, write=False, port=4518):
    """Handler.allowed() for one request with these headers, to a server on `port`."""
    h = fleet_live.Handler.__new__(fleet_live.Handler)
    h.headers = email.message.Message()
    for k, v in headers.items():
        h.headers[k] = v
    h.server = types.SimpleNamespace(server_address=("127.0.0.1", port))
    return h.allowed(write=write)


class Allowed(unittest.TestCase):
    """Only this computer's own Fleet window gets answers: the Host must be 127.0.0.1 or localhost on Fleet's
    port (a DNS-rebound name is turned away), and a write also needs no foreign Origin and X-Fleet: 1 (a
    cross-site page can't send that header without a preflight, which the server doesn't answer)."""

    def test_reads_only_for_fleets_own_host_names(self):
        hosts = ["127.0.0.1:4518", "localhost:4518", "127.0.0.1", "localhost", "127.0.0.1:4519", "localhost:80", "evil.example:4518",
                 "fleet.attacker.example", "[::1]:4518", "LOCALHOST:4518", "127.0.0.1:4518.evil.example", "0.0.0.0:4518", ""]
        got = {h: allowed({"Host": h}) for h in hosts}
        got["(no Host)"] = allowed({})
        self.assertEqual({h for h, ok in got.items() if ok}, {"127.0.0.1:4518", "localhost:4518"})
        self.assertEqual(len(got), len(hosts) + 1)

    def test_the_port_is_the_servers_own(self):
        self.assertEqual((allowed({"Host": "127.0.0.1:5000"}, port=5000), allowed({"Host": "127.0.0.1:4518"}, port=5000)), (True, False))

    def test_writes_need_fleets_origin_or_none_and_the_fleet_header(self):
        good = {"Host": "127.0.0.1:4518", "X-Fleet": "1"}
        cases = {
            "the app's own fetch": good,
            "Origin 127.0.0.1": dict(good, Origin="http://127.0.0.1:4518"),
            "Origin localhost": dict(good, Origin="http://localhost:4518"),
            "Host localhost, Origin 127.0.0.1": dict(good, Host="localhost:4518", Origin="http://127.0.0.1:4518"),
            "no X-Fleet": {"Host": "127.0.0.1:4518", "Origin": "http://127.0.0.1:4518"},
            "X-Fleet: true": dict(good, **{"X-Fleet": "true"}),
            "X-Fleet: 0": dict(good, **{"X-Fleet": "0"}),
            "foreign Origin": dict(good, Origin="https://evil.example"),
            "Origin null": dict(good, Origin="null"),
            "Origin over https": dict(good, Origin="https://127.0.0.1:4518"),
            "Origin on another port": dict(good, Origin="http://127.0.0.1:3000"),
            "foreign Host": dict(good, Host="evil.example:4518", Origin="http://evil.example:4518"),
            "no Host": {"X-Fleet": "1", "Origin": "http://127.0.0.1:4518"},
        }
        got = {k: allowed(h, write=True) for k, h in cases.items()}
        self.assertEqual({k for k, ok in got.items() if ok}, {"the app's own fetch", "Origin 127.0.0.1", "Origin localhost", "Host localhost, Origin 127.0.0.1"})

    def test_a_read_doesnt_need_the_write_headers(self):
        self.assertEqual((allowed({"Host": "localhost:4518", "Origin": "https://evil.example"}), allowed({"Host": "localhost:4518"}, write=True)),
                         (True, False))


class Http(unittest.TestCase):
    """The same rules on the wire: every refused request gets 403 before the handler looks at its path or body."""

    @classmethod
    def setUpClass(cls):
        cls.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), fleet_live.Handler)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def exchange(self, method, path, headers, host="own"):
        """One request; returns its response (status and headers)."""
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            c.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
            if host:
                c.putheader("Host", "127.0.0.1:%d" % self.port if host == "own" else host)
            for k, v in headers.items():
                c.putheader(k, v)
            c.putheader("Content-Length", "0")
            c.endheaders()
            r = c.getresponse()
            r.read()
            return r
        finally:
            c.close()

    def send(self, method, path, headers, host="own"):
        return self.exchange(method, path, headers, host).status

    def test_reads(self):
        got = {"own": self.send("GET", "/", {}),
               "localhost": self.send("GET", "/", {}, host="localhost:%d" % self.port),
               "foreign": self.send("GET", "/", {}, host="evil.example:%d" % self.port),
               "wrong port": self.send("GET", "/", {}, host="127.0.0.1:%d" % (self.port + 1)),
               "no Host": self.send("GET", "/", {}, host=None),
               "API, foreign": self.send("GET", "/api/fleet", {}, host="evil.example:%d" % self.port)}
        self.assertEqual(got, {"own": 200, "localhost": 200, "foreign": 403, "wrong port": 403, "no Host": 403, "API, foreign": 403})

    def test_writes(self):
        own = "http://127.0.0.1:%d" % self.port
        got = {"passes the gate": self.send("POST", "/api/no-such-thing", {"X-Fleet": "1", "Origin": own}),   # 404: past the checks, nothing written
               "no X-Fleet": self.send("POST", "/api/pins", {"Origin": own}),
               "foreign Origin": self.send("POST", "/api/config", {"X-Fleet": "1", "Origin": "https://evil.example"}),
               "foreign Host": self.send("POST", "/api/prefs", {"X-Fleet": "1"}, host="evil.example:%d" % self.port),
               "preflight": self.send("OPTIONS", "/api/pins", {"Origin": "https://evil.example", "Access-Control-Request-Method": "POST",
                                                                "Access-Control-Request-Headers": "x-fleet"})}
        self.assertEqual(got, {"passes the gate": 404, "no X-Fleet": 403, "foreign Origin": 403, "foreign Host": 403, "preflight": 501})

    def test_no_page_can_put_fleet_in_a_frame(self):
        # Inside a frame the UI is same-origin with the server, so its own requests would pass every check
        # above: the browser has to refuse to frame it, on every response.
        reqs = {"the page": ("GET", "/", {}), "the script": ("GET", "/app.js", {}), "JSON": ("GET", "/api/proc?machine=none&pid=1", {}),
                "refused": ("GET", "/", {}, "evil.example:%d" % self.port), "not found": ("POST", "/api/no-such-thing", {"X-Fleet": "1"}),
                "preflight": ("OPTIONS", "/api/pins", {})}
        with mock.patch.object(fleet_live.Handler, "fleet", types.SimpleNamespace(machines={})):
            got = {}
            for name, req in reqs.items():
                r = self.exchange(*req)
                got[name] = (r.status, r.getheader("X-Frame-Options"), r.getheader("Content-Security-Policy"), r.getheader("Cache-Control"))
        framed = {"the page": 200, "the script": 200, "JSON": 200, "refused": 403, "not found": 404, "preflight": 501}
        self.assertEqual(got, {k: (status, "DENY", "frame-ancestors 'none'", "no-store") for k, status in framed.items()})


if __name__ == "__main__":
    unittest.main()
