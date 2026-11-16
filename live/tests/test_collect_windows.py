# SPDX-License-Identifier: GPL-3.0-or-later
"""The Windows collector: how Fleet starts collect_windows.ps1 (over SSH and on a Windows Fleet host) and
how derive_windows reads what it sends. No machine is read: the readings are hand-made in the collector's shape.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import base64, importlib.util, os, re, subprocess, sys, unittest
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


def collector_text():
    """collect_windows.ps1 as it is sent (no comments), with its quoted strings emptied."""
    return re.sub(r"'[^'\n]*'", "''", fl.ps_compact(open(os.path.join(LIVE, "collect_windows.ps1"), encoding="utf-8").read()))


class EveryProgramHasADeadline(unittest.TestCase):
    """#135: the external programs run through Start-Bounded/Invoke-Bounded, which wait 8 s at most (like
    collect_linux.py's run(..., timeout=8)) and then kill the program, so a hung one can't stop the loop."""
    SRC = fl.ps_compact(open(os.path.join(LIVE, "collect_windows.ps1"), encoding="utf-8").read())

    def test_the_programs_it_runs_and_how(self):
        calls = re.findall(r"(?:Start|Invoke)-Bounded '([^']+)' '([^']*)'", self.SRC)
        self.assertEqual(sorted(calls), sorted([
            ("nvidia-smi", "--query-gpu=index,name,utilization.gpu,memory.used,memory.total,utilization.memory,temperature.gpu,power.draw,"
                           "power.limit,clocks.gr,clocks.max.gr,clocks.mem,fan.speed,utilization.encoder,utilization.decoder --format=csv,noheader,nounits"),
            ("nvidia-smi", "--query-gpu=index,name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits"),
            ("wsl.exe", "-l -v"),
            ("docker", 'ps --no-trunc --format "{{json .}}"'),
            ("docker", 'stats --no-stream --format "{{json .}}"'),
        ]))

    def test_nothing_runs_them_without_a_deadline(self):
        bare = re.findall(r"(?<![$.\w-])(nvidia-smi|wsl(?:\.exe)?|docker)(?![\w-])", collector_text())   # not $wsl or $o.wsl
        self.assertEqual(bare, [])

    def test_the_deadline_is_8_seconds_and_a_late_program_is_killed(self):
        body = re.search(r"function Wait-Bounded\(\$job, \$secs = (\d+)\) \{(.*?)\n\}", self.SRC, re.S)
        self.assertIsNotNone(body, "Wait-Bounded($job, $secs = N) is defined")
        self.assertEqual(body.group(1), "8")
        self.assertIn(".Wait([int]($secs * 1000))", body.group(2))
        self.assertIn(".Kill()", body.group(2))

MB = fl.MB
CID = "abc123def456"


def reading(t, cpu_secs, rx, tx, bio, nio, **stamps):
    """One collect_windows.ps1 reading: one process, one adapter, one Docker Desktop container."""
    return dict({"t": t, "ncpu": 4, "lcpus": [{"n": n, "pct": 5.0, "mhz": 3000} for n in range(4)], "topo": [], "gpus": [], "nvidia": [],
                 "videoNames": [], "gproc": [], "procs": [[10, 4, "train", cpu_secs, 1 << 20, 3, 0, "C:\\train.exe"]],
                 "ifs": [{"name": "Ethernet", "desc": "Intel(R) Ethernet", "status": "Up", "speed": "1 Gbps", "virtual": False, "rx": rx, "tx": tx, "addrs": []}],
                 "wsl": [{"name": "docker-desktop", "state": "Running", "default": False}],
                 "containers": ['{"ID": "%s", "Names": "web", "Image": "nginx", "Status": "Up", "Labels": "", "Networks": "bridge"}' % CID],
                 "dstats": ['{"ID": "%s", "CPUPerc": "1.00%%", "MemUsage": "0B / 1GiB", "BlockIO": "%dB / 0B", "NetIO": "%dB / 0B"}' % (CID, bio, nio)],
                 "tasks": [], "mem": [16 << 30, 8 << 30], "diskBps": 0, "os": "Windows", "disks": []}, **stamps)


def rates(m, r):
    v = m.derive_windows(r)
    [p], [a], [c] = v["procs"], v["ifs"], v["containers"]
    return {"cores": p[5], "rx": a["rx"], "tx": a["tx"], "cblock": c["u"][3], "cnet": c["u"][4]}


class EachCounterHasItsOwnClock(unittest.TestCase):
    """#145: process CPU time, interface bytes and docker stats are read at different moments of a reading, after
    work that runs only on some readings; each rate divides by the time between two reads of that counter."""

    def test_rates_use_the_stamp_of_their_own_counters(self):
        m = fl.Machine({"id": "w", "name": "w", "os": "windows"}, 3)
        rates(m, reading(1000.0, 50.0, 10 * MB, 20 * MB, 100 * MB, 40 * MB, tp=1000.5, tn=1001.0, td=1002.0))
        # t moved 3 s, but the process list was read 4 s after the last one, the adapters 2 s and docker stats 2.5 s
        got = rates(m, reading(1003.0, 54.0, 12 * MB, 23 * MB, 105 * MB, 42.5 * MB, tp=1004.5, tn=1003.0, td=1004.5))
        self.assertEqual(got, {"cores": 1.0, "rx": 1.0, "tx": 1.5, "cblock": 2.0, "cnet": 1.0})

    def test_a_reading_without_stamps_uses_t(self):
        m = fl.Machine({"id": "w", "name": "w", "os": "windows"}, 3)
        rates(m, reading(1000.0, 50.0, 10 * MB, 20 * MB, 100 * MB, 40 * MB))
        got = rates(m, reading(1004.0, 54.0, 12 * MB, 23 * MB, 105 * MB, 42 * MB))
        self.assertEqual(got, {"cores": 1.0, "rx": 0.5, "tx": 0.75, "cblock": 1.25, "cnet": 0.5})

    def between(self, start, end):
        src = fl.ps_compact(open(os.path.join(LIVE, "collect_windows.ps1"), encoding="utf-8").read())
        i = src.index(start)
        return src[i + len(start):src.index(end, i)]

    def test_the_collector_stamps_each_counter_right_before_reading_it(self):
        self.assertNotRegex(self.between("$o.tp = ", ".TotalProcessorTime"), r"Get-CimInstance|Get-Net|Bounded")
        self.assertEqual(self.between("$o.tn = ", "Get-NetAdapterStatistics"), "UnixNow; foreach ($st in ")
        self.assertEqual(self.between("Invoke-Bounded 'docker' 'stats", "$o.td = "), ' --no-stream --format "{{json .}}"\'; ')

class ClockLikeTaskManager(unittest.TestCase):
    """#152: Processor Frequency is the nominal clock (or the P-state's); Task Manager's Speed scales it by
    % Processor Performance, which goes over 100 in turbo. Fleet shows frequency x performance / % of maximum frequency."""

    def mhz(self, lcpus):
        r = reading(1000.0, 1.0, 0, 0, 0, 0)
        r["ncpu"], r["lcpus"] = len(lcpus), [dict(c, n=n) for n, c in enumerate(lcpus)]
        return [c["mhz"] for c in fl.Machine({"id": "w", "name": "w", "os": "windows"}, 3).derive_windows(r)["lcpus"]]

    def test_turbo_throttled_and_idle_processors(self):
        self.assertEqual(self.mhz([{"pct": 100.0, "mhz": 3600, "perf": 141.6666666666667, "maxf": 100.0},   # turbo, 5.1 GHz
                                   {"pct": 30.0, "mhz": 1800, "perf": 40.0, "maxf": 50.0},                   # held at half the base
                                   {"pct": 1.0, "mhz": 3600, "perf": 100.0, "maxf": 100.0}]),
                         [5100, 1440, 3600])

    def test_without_the_performance_counter_the_frequency_stands(self):
        self.assertEqual(self.mhz([{"pct": 5.0, "mhz": 3600}, {"pct": 5.0, "mhz": 3600, "perf": 0.0, "maxf": 0.0},
                                   {"pct": 5.0, "mhz": 3600, "perf": 120.0}]),
                         [3600, 3600, 4320])

    def test_the_collector_reads_every_counter_it_needs(self):
        src = fl.ps_compact(open(os.path.join(LIVE, "collect_windows.ps1"), encoding="utf-8").read())
        paths = re.search(r"\$paths = @\((.*?)\)\n", src, re.S).group(1)
        self.assertEqual(re.findall(r"'([^']+)'", paths), [
            "\\Processor(*)\\% Processor Time", "\\Processor Information(*)\\Processor Frequency",
            "\\Processor Information(*)\\% Processor Performance", "\\Processor Information(*)\\% of Maximum Frequency",
            "\\PhysicalDisk(*)\\Disk Bytes/sec", "\\PhysicalDisk(*)\\Disk Read Bytes/sec", "\\PhysicalDisk(*)\\Disk Write Bytes/sec",
            "\\PhysicalDisk(*)\\% Idle Time", "\\GPU Engine(*)\\Utilization Percentage", "\\GPU Adapter Memory(*)\\Dedicated Usage",
            "\\GPU Adapter Memory(*)\\Shared Usage", "\\Memory\\Available Bytes"])
        line = "mhz = [int]$freq[$_]; perf = [double]$perf[$_]; maxf = [double]$maxf[$_]"
        self.assertTrue(line in src, line)

class LocalCollectorStopsWithFleet(unittest.TestCase):
    """#156: on a Windows Fleet host, a restart (Settings save, file watch) ends the local collector: it is the
    machine's proc, which stop_collectors terminates, and its stdin is a pipe that closes when Fleet exits."""

    def test_stop_collectors_ends_the_local_windows_collector(self):
        m = fl.Machine({"id": "local", "name": "local", "kind": "local"}, 3)
        ssh = fl.Machine({"id": "win-desktop", "name": "win-desktop", "os": "windows", "ssh": "win-desktop"}, 3)
        [p] = run_with_fake_popen(m.local_loop, system="Windows")
        [q] = run_with_fake_popen(ssh.ssh_loop)
        self.assertEqual((m.proc, ssh.proc), (p, q))
        self.assertEqual((p.kw.get("stdin"), p.stdin.closed), (subprocess.PIPE, False))
        fl.stop_collectors(type("F", (), {"machines": {"local": m, "win-desktop": ssh}})())
        self.assertEqual((p.terminated, q.terminated), (True, True))

class ProcessDetailsOnlyForNewPids(unittest.TestCase):
    """#161: a running process's parent and command line never change, so the collector asks WMI for just those,
    about PIDs it hasn't seen (or that now run under another name), on the reading it first sees them."""
    SRC = fl.ps_compact(open(os.path.join(LIVE, "collect_windows.ps1"), encoding="utf-8").read())

    def test_wmi_is_asked_for_three_properties(self):
        self.assertEqual(re.findall(r"Get-CimInstance[^\n]*Win32_Process\b[^\n]*", self.SRC)
                         + re.findall(r"\$q = @\{[^\n]*", self.SRC),
                         ["Get-CimInstance Win32_Process -Filter \"ProcessId=$anc\").ParentProcessId",   # once, to find sshd
                          "$q = @{ ClassName = 'Win32_Process'; Property = @('ProcessId', 'ParentProcessId', 'CommandLine') }"])

    def test_only_about_pids_it_has_not_seen(self):
        line = "$q.Filter = ($miss | ForEach-Object { \"Handle='$($_.Id)'\" }) -join ' OR '"
        self.assertTrue(line in self.SRC, line)
        self.assertEqual(self.SRC.count("$cmdCache = @{}"), 1, "the cache is never thrown away")
        self.assertNotRegex(self.SRC, r"\$loop % 3 -eq 0\) \{ \$cmdCache")

    def test_pids_that_are_gone_are_forgotten(self):
        line = "foreach ($k in @($cmdCache.Keys)) { if (-not $live.ContainsKey($k)) { $cmdCache.Remove($k) } }"
        self.assertTrue(line in self.SRC, line)


if __name__ == "__main__":
    unittest.main()
