# SPDX-License-Identifier: GPL-3.0-or-later
"""The Windows collector: how Fleet starts collect_windows.ps1 (over SSH and on a Windows Fleet host) and
how derive_windows reads what it sends. No machine is read: the readings are hand-made in the collector's shape.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import base64, importlib.util, os, subprocess, sys, unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)
argv, sys.argv = sys.argv, ["fleet_live.py"]
try:
    spec = importlib.util.spec_from_file_location("fleet_live_win_test", os.path.join(LIVE, "fleet_live.py"))
    fl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fl)
finally:
    sys.argv = argv

BOOT = "iex ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine())))"
CMD_EXE_MAX = 8191   # cmd.exe's longest command line; Windows OpenSSH runs `cmd.exe /c <command>` by default


def collector_script(interval=3):
    return "$FleetInterval=%s\n" % interval + fl.ps_compact(open(os.path.join(LIVE, "collect_windows.ps1"), encoding="utf-8").read())


class FakeStdin:
    def __init__(self):
        self.writes, self.flushed, self.closed = [], False, False

    def write(self, b):
        self.writes.append(b)

    def flush(self):
        self.flushed = True

    def close(self):
        self.closed = True


class FakeProc:
    """A collector that connects and sends nothing."""
    made = []

    def __init__(self, argv, **kw):
        self.argv, self.kw, self.returncode, self.terminated = argv, kw, 0, False
        self.stdin = FakeStdin() if kw.get("stdin") == subprocess.PIPE else None
        self.stdout, self.stderr = iter([]), iter([])
        FakeProc.made.append(self)

    def wait(self):
        return 0

    def poll(self):
        return None

    def terminate(self):
        self.terminated = True


def run_with_fake_popen(fn, system=None):
    FakeProc.made = []
    patches = [mock.patch.object(fl.subprocess, "Popen", FakeProc)]
    if system:
        patches.append(mock.patch.object(fl.platform, "system", return_value=system))
    for p in patches:
        p.start()
    try:
        fn()
    finally:
        for p in patches:
            p.stop()
    return FakeProc.made


class LaunchFitsAnyShell(unittest.TestCase):
    """#100: the command is a short bootstrap that any default shell runs; the script itself arrives on stdin."""

    def check_bootstrap(self, command):
        head, enc = command.rsplit(" ", 1)
        self.assertEqual(head, "powershell -NoProfile -NonInteractive -EncodedCommand")
        self.assertEqual(base64.b64decode(enc).decode("utf-16-le"), BOOT)
        self.assertLess(len(command), CMD_EXE_MAX)

    def check_payload(self, payload):
        self.assertTrue(payload.endswith(b"\n"))
        self.assertEqual(payload.count(b"\n"), 1, "one line: the bootstrap reads exactly one")
        self.assertEqual(base64.b64decode(payload).decode("utf-8"), collector_script())

    def test_over_ssh(self):
        cmd, stdin = fl.Machine({"id": "w", "name": "w", "os": "windows", "ssh": "win-desktop"}, 3).ssh_cmd()
        self.assertEqual(cmd[:-1], ["ssh"] + fl.SSH_MARK + ["win-desktop"])
        self.check_bootstrap(cmd[-1])
        self.check_payload(stdin)

    def test_over_ssh_stdin_carries_the_script_and_then_stays_open(self):
        m = fl.Machine({"id": "w", "name": "w", "os": "windows", "ssh": "win-desktop"}, 3)
        [p] = run_with_fake_popen(m.ssh_loop)
        self.assertEqual(len(p.stdin.writes), 1)
        self.check_payload(p.stdin.writes[0])
        self.assertEqual((p.stdin.flushed, p.stdin.closed), (True, False), "an open stdin is the collector's lifeline")

    def test_linux_still_closes_stdin_after_the_script(self):
        m = fl.Machine({"id": "nas", "name": "nas", "os": "linux", "ssh": "nas"}, 3)
        [p] = run_with_fake_popen(m.ssh_loop)
        self.assertEqual(p.argv[-1], "python3 -")
        self.assertTrue(p.stdin.closed)

    def test_on_a_windows_fleet_host(self):
        m = fl.Machine({"id": "local", "name": "local", "kind": "local"}, 3)
        [p] = run_with_fake_popen(m.local_loop, system="Windows")
        self.assertEqual(p.argv[:4], ["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand"])
        self.check_bootstrap(" ".join(p.argv))
        self.assertEqual(p.kw.get("stdin"), subprocess.PIPE)
        self.assertEqual(len(p.stdin.writes), 1)
        self.check_payload(p.stdin.writes[0])
        self.assertEqual((p.stdin.flushed, p.stdin.closed), (True, False))


if __name__ == "__main__":
    unittest.main()
