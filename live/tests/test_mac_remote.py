# SPDX-License-Identifier: GPL-3.0-or-later
"""Macs over SSH (#181): the server streams the same Mac reader it uses for this Mac, built from its own source,
and summarises its readings the same way. These tests run that streamed script through `python3 -` on this Mac
(the way sshd runs it there), also with the system Python 3.9 a fresh Mac has after xcode-select --install."""
import base64, importlib.util, json, os, subprocess, sys, unittest, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)
argv, sys.argv = sys.argv, ["fleet_live.py"]
try:
    spec = importlib.util.spec_from_file_location("fleet_live_mac_remote", os.path.join(LIVE, "fleet_live.py"))
    fl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fl)
finally:
    sys.argv = argv
PYTHONS = [sys.executable] + (["/usr/bin/python3"] if os.path.exists("/usr/bin/python3") and sys.platform == "darwin" else [])


@unittest.skipUnless(sys.platform == "darwin", "reads this Mac")
class StreamedMacCollector(unittest.TestCase):
    def reading(self, python):
        r = subprocess.run([python, "-"], input=("ONCE = True\n" + fl.mac_collector_script(1)).encode(), capture_output=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stderr.decode()[-800:])
        line = r.stdout.decode().strip().splitlines()[-1]
        return json.loads(zlib.decompress(base64.b64decode(line)))

    def test_one_reading_through_python3_stdin_summarises_like_this_mac(self):
        for py in PYTHONS:
            with self.subTest(python=py):
                raw = self.reading(py)
                m = fl.Machine({"id": "mac2", "name": "a Mac", "ssh": "me@mac2", "os": "macos"}, 3)
                view = m.derive_generic(raw)
                self.assertTrue(view, py)
                self.assertGreater(view["ncpu"], 0)
                self.assertTrue(any(p[0] == p[0] for p in view["procs"]))
                self.assertEqual(len(view["cap"]), 5)

    def test_a_process_looked_at_over_ssh(self):
        for py in PYTHONS:
            with self.subTest(python=py):
                r = subprocess.run([py, "-"], input=fl.mac_inspect_script(os.getpid(), 0.3).encode(), capture_output=True, timeout=60)
                d = json.loads(r.stdout.decode().strip().splitlines()[-1])
                self.assertEqual(d["pid"], os.getpid())
                self.assertIn("python", d["cmdline"].lower())


class Config(unittest.TestCase):
    def test_the_ssh_command_for_a_mac_streams_the_mac_reader(self):
        cmd, stdin = fl.Machine({"id": "mac2", "name": "a Mac", "ssh": "me@mac2", "os": "macos"}, 3).ssh_cmd()
        self.assertEqual(cmd[-2:], ["me@mac2", "python3 -"])
        self.assertIn(b"class MacCollector", stdin)
        self.assertIn(b"INTERVAL = 3", stdin)

    def test_macos_is_a_system_the_settings_accept(self):
        cfg, errors = fl.validate_config({"interval": 3, "machines": [{"id": "mac2", "name": "a Mac", "ssh": "me@mac2", "os": "macos", "tile": "laptop"}]})
        self.assertEqual(errors, [])
        self.assertEqual(cfg["machine"][0]["os"], "macos")   # the TOML key: one [[machine]] per machine


if __name__ == "__main__":
    unittest.main()
