# SPDX-License-Identifier: GPL-3.0-or-later
"""Macs over SSH (#181): the server streams the same Mac reader it uses for this Mac, built from its own source,
and summarises its readings the same way. These tests run that streamed script through `python3 -` on this Mac
(the way sshd runs it there), also with the system Python 3.9 a fresh Mac has after xcode-select --install."""
import ast, base64, builtins, copy, importlib.util, json, os, shutil, stat, subprocess, sys, tempfile, unittest, zlib
from unittest import mock

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

    def test_docker_is_found_under_sshds_short_path(self):
        # sshd on a Mac runs `python3 -` with PATH=/usr/bin:/bin:/usr/sbin:/sbin and no login shell, so path_helper
        # never adds where Docker Desktop, OrbStack, Colima or Rancher put the docker CLI (#299). A stand-in docker in
        # the account's ~/.docker/bin (Docker Desktop's per-user place) must still be found and read.
        home = tempfile.mkdtemp(prefix="fleet-machome-")
        self.addCleanup(shutil.rmtree, home, True)
        os.makedirs(os.path.join(home, ".docker", "bin"))
        fake = os.path.join(home, ".docker", "bin", "docker")
        with open(fake, "w") as f:
            f.write("#!/bin/sh\ncase \"$1\" in\n"
                    "ps) echo '{\"ID\":\"0123456789abcdef\",\"Names\":\"blog-web-1\",\"Image\":\"nginx:1\",\"Status\":\"Up 2 minutes\","
                    "\"Labels\":\"com.docker.compose.project=blog,com.docker.compose.service=web\",\"Networks\":\"blog_default\"}' ;;\n"
                    "stats) echo '{\"ID\":\"0123456789ab\",\"CPUPerc\":\"50.00%\",\"MemUsage\":\"512MiB / 2GiB\",\"NetIO\":\"0B / 0B\",\"BlockIO\":\"0B / 0B\"}' ;;\n"
                    "esac\n")
        os.chmod(fake, os.stat(fake).st_mode | stat.S_IXUSR)
        env = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "HOME": home, "LANG": "C"}
        for py in PYTHONS:
            with self.subTest(python=py):
                r = subprocess.run([py, "-"], input=("ONCE = True\n" + fl.mac_collector_script(1)).encode(), capture_output=True, timeout=120, env=env)
                self.assertEqual(r.returncode, 0, r.stderr.decode()[-800:])
                raw = json.loads(zlib.decompress(base64.b64decode(r.stdout.decode().strip().splitlines()[-1])))
                self.assertEqual([(c["id"], c["name"], c["project"], c["service"], c["u"][0]) for c in raw["containers"]],
                                 [("0123456789ab", "blog-web-1", "blog", "web", 0.5)])

    def test_a_process_looked_at_over_ssh(self):
        for py in PYTHONS:
            with self.subTest(python=py):
                r = subprocess.run([py, "-"], input=fl.mac_inspect_script(os.getpid(), 0.3).encode(), capture_output=True, timeout=60)
                d = json.loads(r.stdout.decode().strip().splitlines()[-1])
                self.assertEqual(d["pid"], os.getpid())
                self.assertIn("python", d["cmdline"].lower())


class StreamedSource(unittest.TestCase):
    """The streamed reader is cut out of fleet_live.py (own_source); what it cuts must be all the reader uses."""

    def test_every_name_the_reader_uses_is_in_it(self):
        tree = ast.parse(fl.mac_collector_script(3))
        have = set(dir(builtins)) | {"ONCE"}   # ONCE: set by whoever runs it (the tests), else False
        for n in ast.walk(tree):
            if isinstance(n, (ast.FunctionDef, ast.ClassDef)):
                have.add(n.name)
            elif isinstance(n, (ast.Import, ast.ImportFrom)):
                have.update((a.asname or a.name).split(".")[0] for a in n.names)
            elif isinstance(n, ast.Name) and not isinstance(n.ctx, ast.Load):
                have.add(n.id)
            elif isinstance(n, ast.arg):
                have.add(n.arg)
            elif isinstance(n, ast.ExceptHandler) and n.name:
                have.add(n.name)
        used = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}
        self.assertEqual(sorted(used - have), [])

    def test_its_cron_job_names_are_the_servers(self):
        ns = {}
        exec(fl.MAC_IMPORTS + "".join(s + "\n\n" for s in fl.own_source(*fl.MAC_HELPERS)), ns)
        for cmd in ("test -x /usr/sbin/anacron || ( cd / && run-parts --report /etc/cron.daily )",
                    "flock -n /tmp/x.lock /usr/local/bin/a.sh", "nice -n 19 /home/me/backup.sh", "/usr/local/bin/sync.py --all"):
            with self.subTest(cmd=cmd):
                self.assertEqual(ns["job_name"](cmd), fl.job_name(cmd))


# One process row as the Mac reader sends it: pid, ppid, name, user, state, CPU cores, memory GB, disk MB/s, GPU %, threads,
# command, owner, last CPU, [GPUs], [disks], [interfaces], network MB/s
ROW = [501, 1, "nginx", "_www", "S", 0.25, 0.0625, 0.0, 0.0, 0, "/opt/homebrew/bin/nginx -g daemon off;", "base", -1, [], [], ["en0"], 0.01]
IMG = '<img src=x onerror="fetch(\'/api/procs?machine=nas\')">'


def mac_reading(*rows):
    return {"t": 1000.0, "os": "macOS 26", "ncpu": 8, "procs": [list(r) for r in rows], "containers": [], "vms": [], "jobs": []}


def with_col(i, v):
    r = list(ROW)
    r[i] = v
    return r


class CheckedReading(unittest.TestCase):
    """A remote Mac's reading is the view (its reader sends rates), but it is data from another machine: every process
    row must have the types the server and the page take it to have, or the whole reading is a bad reading, as on
    Linux, where derive_linux can't use a PID that isn't a number (#299)."""

    def mac(self):
        return fl.Machine({"id": "mac2", "name": "a Mac", "ssh": "me@mac2", "os": "macos"}, 3)

    def test_a_good_reading_is_the_view_unchanged(self):
        r = mac_reading(ROW, with_col(12, 3), with_col(13, [0]), with_col(14, ["disk0"]), with_col(0, 0), with_col(5, 1))
        self.assertEqual(self.mac().derive_generic(copy.deepcopy(r)), r)

    def test_a_row_with_the_wrong_types_makes_it_a_bad_reading(self):
        bad = {"pid markup": with_col(0, IMG), "pid true": with_col(0, True), "pid 1.5": with_col(0, 1.5), "pid none": with_col(0, None),
               "ppid text": with_col(1, "1"), "name a number": with_col(2, 5), "user a list": with_col(3, ["root"]),
               "state none": with_col(4, None), "cpu text": with_col(5, "0.5"), "mem true": with_col(6, True), "disk markup": with_col(7, IMG),
               "gpu list": with_col(8, [1]), "threads markup": with_col(9, IMG), "cmd a dict": with_col(10, {}), "owner a number": with_col(11, 3),
               "last cpu text": with_col(12, "3"), "gpus of text": with_col(13, ["0"]), "gpus a string": with_col(13, "0"),
               "disks of numbers": with_col(14, [1]), "interfaces markup list": with_col(15, [IMG, 1]), "net text": with_col(16, "0.1"),
               "short": ROW[:16], "long": ROW + [0], "a dict": dict(enumerate(ROW)), "a string": IMG}
        for name, row in bad.items():
            with self.subTest(name):
                with self.assertRaises(ValueError):
                    self.mac().derive_generic(mac_reading(ROW, row))
        for name, r in {"no procs": {"t": 1.0}, "procs a dict": dict(mac_reading(), procs={}), "a list": [ROW], "a string": "x"}.items():
            with self.subTest(name):
                with self.assertRaises(ValueError):
                    self.mac().derive_generic(r)

    def test_over_ssh_it_never_becomes_the_view(self):
        class Fake:
            def __init__(self, *a, **kw):
                self.stdin, self.returncode = mock.Mock(), 0
                self.stdout = iter([base64.b64encode(zlib.compress(json.dumps(mac_reading(ROW, with_col(0, IMG))).encode())) + b"\n"])
                self.stderr = iter([])
            def poll(self):
                return 0
            def wait(self):
                return 0
        m = self.mac()
        with mock.patch.object(fl.subprocess, "Popen", Fake):
            m.ssh_loop()
        self.assertEqual((m.view, m.status), (None, "offline"))
        self.assertTrue(m.error.startswith("bad reading: "), m.error)
        self.assertNotIn("<img", m.error)


class MacPath(unittest.TestCase):
    """Where the streamed Mac reader looks for the docker CLI, after what PATH already has (#299)."""

    def test_sshds_path_gets_every_place_docker_lives(self):
        self.assertEqual(fl.mac_path("/usr/bin:/bin:/usr/sbin:/sbin", "/Users/someone"),
                         "/usr/bin:/bin:/usr/sbin:/sbin:/Users/someone/.docker/bin:/Users/someone/.orbstack/bin:/Users/someone/.rd/bin"
                         ":/opt/homebrew/bin:/usr/local/bin")

    def test_a_place_already_on_path_keeps_its_place(self):
        self.assertEqual(fl.mac_path("/usr/local/bin:/usr/bin:/bin::", "/Users/someone"),
                         "/usr/local/bin:/usr/bin:/bin:/Users/someone/.docker/bin:/Users/someone/.orbstack/bin:/Users/someone/.rd/bin:/opt/homebrew/bin")
        self.assertEqual(fl.mac_path("", "/Users/someone"),
                         "/Users/someone/.docker/bin:/Users/someone/.orbstack/bin:/Users/someone/.rd/bin:/opt/homebrew/bin:/usr/local/bin")


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
