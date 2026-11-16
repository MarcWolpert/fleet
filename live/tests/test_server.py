# SPDX-License-Identifier: GPL-3.0-or-later
"""The server itself: how it restarts itself, and when it reopens the app window. Nothing here starts, stops
or replaces a real process or opens a window: os.execv, save_state, stop_collectors and open_app_window are
replaced by mocks, time runs on a fake clock, and saved state goes to a temporary file.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import contextlib
import io
import ntpath
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import fleet_live  # noqa: E402


class RestartSelf(unittest.TestCase):
    """restart_self saves state, stops the collectors, then replaces the process with this script again:
    --open becomes --open-if-unseen (the window is reopened only if it's gone), every other argument stays."""

    def restart(self, system, executable, script, argv):
        calls = mock.Mock()
        abspath = ntpath.abspath if system == "Windows" else os.path.abspath
        with mock.patch.object(fleet_live, "save_state", calls.save_state), mock.patch.object(fleet_live, "stop_collectors", calls.stop_collectors), \
                mock.patch.object(fleet_live.os, "execv", calls.execv), mock.patch.object(fleet_live.platform, "system", return_value=system), \
                mock.patch.object(fleet_live.os.path, "abspath", abspath), mock.patch.object(fleet_live, "__file__", script), \
                mock.patch.object(fleet_live.sys, "executable", executable), mock.patch.object(fleet_live.sys, "argv", argv), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            fleet_live.restart_self("the fleet", "Fleet changed")
        self.assertEqual(out.getvalue(), "Fleet changed; restarting\n")
        self.assertEqual([c[0] for c in calls.mock_calls], ["save_state", "stop_collectors", "execv"])
        self.assertEqual(calls.save_state.call_args.args, ("the fleet",))
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


if __name__ == "__main__":
    unittest.main()
