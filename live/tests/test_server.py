# SPDX-License-Identifier: GPL-3.0-or-later
"""The server itself: how it restarts itself. Nothing here starts, stops or replaces a real process: os.execv,
save_state and stop_collectors are replaced by mocks.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import contextlib
import io
import ntpath
import os
import sys
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


if __name__ == "__main__":
    unittest.main()
