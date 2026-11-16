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


MIB = 1024 * 1024
LO, HI = "0x00000000_0x0000d1b5", "0x00000000_0x00010f2c"   # two adapters' LUIDs, LO the lower
RTX3090 = "NVIDIA GeForce RTX 3090"
A2000 = "NVIDIA RTX A2000"
# nvidia-smi rows: index,name,utilization.gpu,memory.used,memory.total[,memory util,temp,power,power limit,clock,max clock,mem clock,fan,enc,dec]
ROW3090 = "%d, NVIDIA GeForce RTX 3090, 13, %d, 24576, 3, 27, 36.70, 350.00, 210, 2100, 405, 0, 0, 5"
ROWA2000 = "%d, NVIDIA RTX A2000, 90, %d, 12288"


def m3090(util, used):
    return {"util": util, "vram": used * MIB, "shared": 0.0, "3d": 0.0, "copy": 0.0, "encode": 0.0, "decode": 5.0, "memctl": 3.0, "temp": 27.0,
            "power": 36.7, "clock": 210.0, "memclock": 405.0, "fan": 0.0}


def ma2000(util, used):
    return {"util": util, "vram": used * MIB, "shared": 0.0, "3d": 0.0, "copy": 0.0, "encode": 0.0, "decode": 0.0}


LIM3090, LIMA2000 = {"vram": 24576 * MIB, "power": 350.0, "clock": 2100.0}, {"vram": 12288 * MIB}


def adapter(luid, util, used_mib):
    return {"luid": luid, "util": util, "dedicated": used_mib * MIB, "shared": 0, "eng": {}}


class GpusKeepTheirPlace(unittest.TestCase):
    """#119: adapters are numbered by LUID, not by VRAM in use, and each nvidia-smi row goes to the adapter whose
    dedicated usage it reports (WDDM gives nvidia-smi's memory.used and the GPU Adapter Memory counter one number)."""

    def gpus(self, r):
        gpus, by_pid = fl.Machine({"id": "w", "name": "w", "os": "windows"}, 3).windows_gpus(dict({"videoNames": [], "gproc": []}, **r))
        return [(g["name"], g["m"], g["lim"]) for g in gpus], by_pid

    def test_the_card_with_more_vram_in_use_is_not_gpu0(self):
        # the collector lists the busier adapter first; nvidia-smi says GPU0 is the A2000 (on HI), GPU1 the 3090 (on LO)
        got = self.gpus({"gpus": [adapter(HI, 90.0, 9000), adapter(LO, 13.0, 1654)],
                         "nvidia": [ROWA2000 % (0, 9000), ROW3090 % (1, 1654)], "videoNames": [RTX3090, A2000],
                         "gproc": [[10, HI, 80.0], [11, LO, 5.0], [12, LO, 1.0], [12, HI, 2.0]]})
        self.assertEqual(got, ([(RTX3090, m3090(13.0, 1654), LIM3090), (A2000, ma2000(90.0, 9000), LIMA2000)],
                               {10: {1: 80.0}, 11: {0: 5.0}, 12: {0: 1.0, 1: 2.0}}))

    def test_usage_crossing_over_does_not_swap_the_cards(self):
        before = self.gpus({"gpus": [adapter(LO, 13.0, 9000), adapter(HI, 90.0, 1654)],
                            "nvidia": [ROW3090 % (0, 9000), ROWA2000 % (1, 1654)], "gproc": [[10, HI, 80.0]]})
        after = self.gpus({"gpus": [adapter(HI, 90.0, 11000), adapter(LO, 13.0, 1654)],
                           "nvidia": [ROW3090 % (0, 1654), ROWA2000 % (1, 11000)], "gproc": [[10, HI, 80.0]]})
        self.assertEqual(before, ([(RTX3090, m3090(13.0, 9000), LIM3090), (A2000, ma2000(90.0, 1654), LIMA2000)], {10: {1: 80.0}}))
        self.assertEqual(after, ([(RTX3090, m3090(13.0, 1654), LIM3090), (A2000, ma2000(90.0, 11000), LIMA2000)], {10: {1: 80.0}}))

    def test_an_igpu_using_more_vram_than_the_idle_nvidia_card_keeps_its_own_name(self):
        intel, nvidia = "Intel(R) UHD Graphics 770", "NVIDIA GeForce RTX 4060 Laptop GPU"
        got = self.gpus({"gpus": [adapter(HI, 4.0, 128), adapter(LO, 0.0, 50)],
                         "nvidia": ["0, NVIDIA GeForce RTX 4060 Laptop GPU, 0, 50, 8188"], "videoNames": [intel, nvidia]})
        self.assertEqual(got, ([(nvidia, ma2000(0.0, 50), {"vram": 8188 * MIB}), (intel, ma2000(4.0, 128), {})], {}))

    def test_one_adapter_and_no_nvidia_smi(self):
        got = self.gpus({"gpus": [adapter(LO, 7.0, 512)], "nvidia": [], "videoNames": ["AMD Radeon RX 6600"]})
        self.assertEqual(got, ([("AMD Radeon RX 6600", ma2000(7.0, 512), {})], {}))


if __name__ == "__main__":
    unittest.main()
