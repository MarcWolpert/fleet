# SPDX-License-Identifier: GPL-3.0-or-later
"""collect_linux.py's parsers, fed the text each source prints (/proc/net/dev, sysfs CPU lists, crontabs).
Importing the collector reads nothing from this machine: its reading loop runs only when the file runs as a
script, the way Fleet Live pipes it to `python3 -`. Every assertion is the exact result.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import importlib.util, os, subprocess, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(os.path.dirname(HERE), "collect_linux.py")
_LOADED = {}


def collector():
    """collect_linux.py as a module, loaded once."""
    if "m" not in _LOADED:
        spec = importlib.util.spec_from_file_location("collect_linux_under_test", SRC)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        _LOADED["m"] = m
    return _LOADED["m"]


class Import(unittest.TestCase):
    def test_importing_takes_no_reading(self):
        code = ("import importlib.util, sys\n"
                "s = importlib.util.spec_from_file_location('c', sys.argv[1])\n"
                "m = importlib.util.module_from_spec(s)\n"
                "s.loader.exec_module(m)\n"
                "print(sorted(k for k in ('snapshot', 'netdev', 'cpulist', 'add_cron') if callable(getattr(m, k, None))))\n")
        p = subprocess.run([sys.executable, "-c", code, SRC], capture_output=True, text=True, timeout=30)
        self.assertEqual((p.returncode, p.stdout, p.stderr), (0, "['add_cron', 'cpulist', 'netdev', 'snapshot']\n", ""))


class NetDev(unittest.TestCase):
    def test_counters_per_interface(self):
        text = ("Inter-|   Receive                                                |  Transmit\n"
                " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n"
                "    lo:    4096      40    0    0    0     0          0         0     4096      40    0    0    0     0       0          0\n"
                "  eth0: 123456789  98765    0    3    0     0          0        12 987654321   54321    0    0    0     0       0          0\n"
                "   br0:      0       0    0    0    0     0          0         0       70       1    0    0    0     0       0          0\n")
        self.assertEqual(collector().netdev(text), {"lo": [4096, 4096], "eth0": [123456789, 987654321], "br0": [0, 70]})

    def test_nothing_without_counters(self):
        self.assertEqual(collector().netdev(""), {})


class CpuList(unittest.TestCase):
    def test_ranges_and_single_cpus(self):
        self.assertEqual(collector().cpulist("0-3,8,10-11\n"), {0, 1, 2, 3, 8, 10, 11})

    def test_empty_file_is_no_cpus(self):
        self.assertEqual(collector().cpulist(""), set())


class UserCrontab(unittest.TestCase):
    def test_jobs_of_a_user_crontab(self):
        text = ("SHELL=/bin/sh\n"
                "# m h dom mon dow command\n"
                "\n"
                "*/5 * * * * /usr/local/bin/backup --quick > /dev/null 2>&1\n"
                "@daily /usr/local/bin/rotate-logs\n"
                "0 4 * * 1\n")
        cron = []
        collector().add_cron(cron, text, "crontab")
        self.assertEqual(cron, [{"sched": "*/5 * * * *", "cmd": "/usr/local/bin/backup --quick > /dev/null 2>&1", "src": "crontab"},
                                {"sched": "@daily", "cmd": "/usr/local/bin/rotate-logs", "src": "crontab"}])


if __name__ == "__main__":
    unittest.main()
