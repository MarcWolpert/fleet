# SPDX-License-Identifier: GPL-3.0-or-later
"""Machine.loop and ssh_loop: how a machine's collector session is retried, and what its status says meanwhile.
No machine is read and nothing is started: ssh is a fake Popen whose sessions the tests script.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import base64
import json
import os
import subprocess
import sys
import threading
import time
import unittest
import zlib
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import fleet_live  # noqa: E402


class Stop(BaseException):
    """Ends Machine.loop's endless retries (it catches Exception only)."""


class Waits:
    """Stands in for Machine.wake: records each wait instead of sleeping, and ends the loop at the `limit`th."""
    def __init__(self, limit):
        self.waits, self.limit = [], limit

    def wait(self, secs):
        self.waits.append(secs)
        if len(self.waits) >= self.limit:
            raise Stop()

    def clear(self):
        pass

    def set(self):
        pass


def linux_line(t):
    """One collect_linux.py reading, as it comes down the SSH session."""
    r = {"t": t, "ncpu": 1, "hz": 100, "cpu": [1, 0, 1, 10, 0, 0, 0, 0], "lcpus": [{"n": 0, "t": [1, 0, 1, 10, 0, 0, 0, 0], "core": "0", "l3": "0", "kind": "", "pkg": "0"}],
         "mem": [1 << 30, 1 << 29], "disk": 0, "ifs": {}, "procs": [], "containers": [], "vms": [], "cron": [], "timers": [], "gpus": [], "gproc": [],
         "os": "Linux", "arch": "x86_64", "cpu_model": "test", "uptime": 1, "dockernets": []}
    return base64.b64encode(zlib.compress(json.dumps(r).encode())) + b"\n"


class Session:
    """A fake ssh: prints `lines`, writes `err` to stderr, exits with `code`."""
    script = []   # what each new session does, in order
    seen = []     # (status, error) when each session started

    def __init__(self, argv, **kw):
        self.lines, self.err, self.returncode = Session.script.pop(0)
        Session.seen.append(None)
        self.stdin = mock.Mock() if kw.get("stdin") == subprocess.PIPE else None
        self.stdout, self.stderr = iter(self.lines), iter([self.err] if self.err else [])

    def wait(self):
        return self.returncode

    def poll(self):
        return self.returncode

    def kill(self):
        pass

    terminate = kill


def run_loop(m, sessions):
    """Runs m.loop() over scripted ssh sessions; returns the waits between them and (status, error) as each began."""
    Session.script, Session.seen = list(sessions), []
    m.wake = Waits(len(sessions))
    real = m.set_status
    def spy(status, error=""):
        real(status, error)
        if status == "connecting":
            Session.seen.append((m.status, m.error))
    with mock.patch.object(fleet_live.subprocess, "Popen", Session), mock.patch.object(m, "set_status", spy):
        try:
            m.loop()
        except Stop:
            pass
    return m.wake.waits, [s for s in Session.seen if s]


REFUSED = (b"", b"user@nas: Permission denied (publickey).\n", 255)
DOWN = (b"", b"ssh: connect to host nas port 22: Connection refused\n", 255)


def machine():
    return fleet_live.Machine({"id": "nas", "name": "nas", "os": "linux", "ssh": "nas"}, 3)


class Backoff(unittest.TestCase):
    """#178: the wait doubles, up to a minute, until a session brings a reading."""

    def test_a_machine_that_never_answers(self):
        waits, _ = run_loop(machine(), [DOWN] * 6)
        self.assertEqual(waits, [5, 10, 20, 40, 60, 60])

    def test_a_refused_key(self):
        m = machine()
        waits, _ = run_loop(m, [REFUSED] * 4)
        self.assertEqual(waits, [5, 10, 20, 40])
        self.assertEqual((m.status, m.error), ("offline", "user@nas: Permission denied (publickey)."))

    def test_a_session_with_a_reading_starts_the_backoff_over(self):
        good = ([linux_line(1000.0)], b"", 255)
        waits, _ = run_loop(machine(), [DOWN, DOWN, good, DOWN, DOWN, good, good])
        self.assertEqual(waits, [5, 10, 5, 10, 20, 5, 5])

    def test_a_collector_that_crashes_control(self):
        m = machine()
        with mock.patch.object(m, "ssh_loop", side_effect=[RuntimeError("boom")] * 6):
            m.wake = Waits(6)
            with self.assertRaises(Stop):
                m.loop()
        self.assertEqual(m.wake.waits, [5, 10, 20, 40, 60, 60])
        self.assertEqual((m.status, m.error), ("offline", "collector error: boom"))


class StatusWhileRetrying(unittest.TestCase):
    """#178: a retry keeps the last error, so the offline card and its Technical details stay put."""

    def test_the_error_stays_while_it_reconnects(self):
        m = machine()
        _, seen = run_loop(m, [REFUSED, REFUSED, DOWN])
        self.assertEqual(seen, [("connecting", ""), ("connecting", "user@nas: Permission denied (publickey)."),
                                ("connecting", "user@nas: Permission denied (publickey).")])
        self.assertEqual((m.status, m.error), ("offline", "ssh: connect to host nas port 22: Connection refused"))

    def test_a_reading_clears_it_and_then_the_session_s_own_end_shows(self):
        m = machine()
        states = []
        real_got = m.got
        m.got = lambda view: (real_got(view), states.append((m.status, m.error)))
        _, seen = run_loop(m, [REFUSED, ([linux_line(1000.0)], b"", 255), DOWN])
        self.assertEqual(states, [("ok", "")])
        self.assertEqual([s[1] for s in seen], ["", "user@nas: Permission denied (publickey).", "connection closed (exit 255)"])


class Silent:
    """A fake ssh session that prints `lines`, `gap` seconds apart, and then either ends (exit 0) or, with
    hang=True, stays silent with the connection up (a collector stuck in docker or wsl.exe) until it's killed."""

    def __init__(self, lines, gap=0.0, hang=True):
        self.killed, self.returncode, self.gone = False, None, threading.Event()
        self.stdin, self.stderr = mock.Mock(), iter([])
        def out():
            for line in lines:
                time.sleep(gap)
                yield line
            if hang:
                self.gone.wait(10)
            else:
                self.returncode = 0
                self.gone.set()
        self.stdout = out()

    def poll(self):
        return self.returncode

    def kill(self):
        self.killed, self.returncode = True, -9
        self.gone.set()

    terminate = kill

    def wait(self):
        self.gone.wait(10)
        return self.returncode


def session(m, fake):
    with mock.patch.object(fleet_live.subprocess, "Popen", lambda *a, **kw: fake):
        began = time.time()
        m.ssh_loop()
        return time.time() - began


class ReadDeadline(unittest.TestCase):
    """#183: a session that brings nothing for `stall` seconds is ended, so the machine goes offline and reconnects."""

    def test_a_collector_that_stops_sending(self):
        m, fake = machine(), Silent([linux_line(1000.0)])
        m.stall = 0.4
        took = session(m, fake)
        self.assertTrue(fake.killed)
        self.assertEqual((m.status, m.error), ("offline", "timed out: no reading in 0.4 s"))
        self.assertLess(took, 3.0)
        self.assertIsNotNone(m.view, "the last reading stays, shown as stale")

    def test_a_collector_that_never_sends(self):
        m, fake = machine(), Silent([])
        m.stall = 0.4
        session(m, fake)
        self.assertEqual((fake.killed, m.status, m.error, m.view), (True, "offline", "timed out: no reading in 0.4 s", None))

    def test_a_collector_that_keeps_sending_is_left_alone(self):
        m, fake = machine(), Silent([linux_line(1000.0 + i) for i in range(6)], gap=0.15, hang=False)
        m.stall = 0.4
        session(m, fake)
        self.assertEqual((fake.killed, m.status, m.error), (False, "offline", "connection closed (exit 0)"))

    def test_the_deadline_is_a_minute_or_ten_readings(self):
        self.assertEqual([fleet_live.Machine({"id": "x", "name": "x"}, i).stall for i in (2, 3, 6, 10)], [60.0, 60.0, 60.0, 100.0])


if __name__ == "__main__":
    unittest.main()
