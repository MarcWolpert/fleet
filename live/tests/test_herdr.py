# SPDX-License-Identifier: GPL-3.0-or-later
"""Open in Herdr (#227): herdr runs inside a terminal, so when its server isn't running Fleet starts it in the
default terminal, waits for it, then opens the new tab there; it never quietly opens another terminal instead.
herdr's answers are recorded from its CLI (JSON on stdout, errors as JSON on stderr)."""
import importlib.util, json, os, subprocess, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)
argv, sys.argv = sys.argv, ["fleet_live.py"]
try:
    spec = importlib.util.spec_from_file_location("fleet_live_herdr_test", os.path.join(LIVE, "fleet_live.py"))
    fl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fl)
finally:
    sys.argv = argv

NOT_RUNNING = json.dumps({"id": "cli:tab:create", "error": {"code": "server_not_running", "message": "no herdr server is running at x; run `herdr` to start or attach it"}})
CREATED = json.dumps({"id": "cli:tab:create", "result": {"tab": {"tab_id": "w1:t3"}, "root_pane": {"pane_id": "w1:t3:p1"}}})


class Herdr(unittest.TestCase):
    def run_with(self, answers):
        calls, launched = [], []
        def run(cmd, **kw):
            calls.append(cmd)
            if cmd[:3] == ["herdr", "tab", "create"]:
                out = answers.pop(0) if answers else NOT_RUNNING
                ok = '"result"' in out
                return subprocess.CompletedProcess(cmd, 0 if ok else 1, out if ok else "", "" if ok else out)
            return subprocess.CompletedProcess(cmd, 0, "", "")
        saved = (fl.subprocess.run, fl.subprocess.Popen, fl.terminal_choices, fl.platform.system, fl.time.sleep)
        fl.subprocess.run, fl.subprocess.Popen = run, lambda cmd, **kw: launched.append(cmd)
        fl.terminal_choices = lambda: ([("ghostty", "Ghostty"), ("herdr", "Herdr (new tab)"), ("terminal", "Terminal")], "ghostty")
        fl.platform.system, fl.time.sleep = lambda: "Darwin", lambda s: None
        try:
            try:
                return fl.open_terminal("herdr", ["ssh", "lab"], "lab"), calls, launched
            except Exception as e:
                return e, calls, launched
        finally:
            fl.subprocess.run, fl.subprocess.Popen, fl.terminal_choices, fl.platform.system, fl.time.sleep = saved

    def test_running_a_new_tab_runs_the_command(self):
        used, calls, launched = self.run_with([CREATED])
        self.assertEqual(used, "Herdr (new tab)")
        self.assertEqual(calls[-1], ["herdr", "pane", "run", "w1:t3:p1", "ssh lab"])
        self.assertEqual(launched, [])

    def test_not_running_starts_herdr_in_the_default_terminal_then_opens_the_tab(self):
        used, calls, launched = self.run_with([NOT_RUNNING, NOT_RUNNING, CREATED])
        self.assertEqual(used, "Herdr (new tab)")
        self.assertEqual(launched, [["open", "-na", "Ghostty", "--args", "-e", "herdr"]], "herdr itself, not the command")
        self.assertEqual(calls[-1], ["herdr", "pane", "run", "w1:t3:p1", "ssh lab"])

    def test_herdr_that_never_starts_is_said_not_swapped_for_ghostty(self):
        used, calls, launched = self.run_with([])
        self.assertIsInstance(used, RuntimeError)
        self.assertIn("Herdr", str(used))
        self.assertEqual(launched, [["open", "-na", "Ghostty", "--args", "-e", "herdr"]], "only herdr was started")


if __name__ == "__main__":
    unittest.main()
