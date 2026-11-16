# SPDX-License-Identifier: GPL-3.0-or-later
"""In a Flatpak (#358), the sandbox sees only its own processes, so Fleet runs what it uses on the host: this computer's
collector and inspector (under the host's python3, reading the host), ssh, docker, terminals and the app window, all
through flatpak-spawn --host; and tmux, the package's own static build, from the app's folder on the host, so the
terminals' shells outlive Fleet. ttyd, the package's own, stays in the sandbox."""
import importlib.util, os, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)
argv, sys.argv = sys.argv, ["fleet_live.py"]
try:
    spec = importlib.util.spec_from_file_location("fleet_live_flatpak_test", os.path.join(LIVE, "fleet_live.py"))
    fl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fl)
finally:
    sys.argv = argv

INFO = "[Application]\nname=io.github.MarcWolpert.Fleet\n\n[Instance]\napp-path=/var/lib/flatpak/app/io.github.MarcWolpert.Fleet/x86_64/stable/abc/files\n"


class InAFlatpak(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        info = os.path.join(self.dir.name, ".flatpak-info")
        with open(info, "w") as f:
            f.write(INFO)
        self.saved = (fl.FLATPAK_INFO, fl.HERE)
        fl.FLATPAK_INFO = info
        fl.HERE = "/app/share/fleet/live"

    def tearDown(self):
        fl.FLATPAK_INFO, fl.HERE = self.saved
        self.dir.cleanup()

    def test_it_knows(self):
        self.assertTrue(fl.in_flatpak())
        self.assertEqual(fl.flatpak_app_path(), "/var/lib/flatpak/app/io.github.MarcWolpert.Fleet/x86_64/stable/abc/files")

    def test_what_runs_on_the_host(self):
        self.assertEqual(fl.host_argv(["ssh", "-T", "nas", "python3 -"]), ["flatpak-spawn", "--host", "--watch-bus", "ssh", "-T", "nas", "python3 -"])
        self.assertEqual(fl.host_argv(["docker", "ps"])[:3], ["flatpak-spawn", "--host", "--watch-bus"])
        self.assertEqual(fl.host_argv([sys.executable, "-c", "x"]), ["flatpak-spawn", "--host", "--watch-bus", "python3", "-c", "x"], "the host's Python reads the host")
        self.assertEqual(fl.host_argv(["/app/share/fleet/bin/ttyd", "--port", "0"]), ["/app/share/fleet/bin/ttyd", "--port", "0"], "the package's ttyd stays in")
        self.assertEqual(fl.host_argv(["flatpak-spawn", "--host", "x"]), ["flatpak-spawn", "--host", "x"])
        env = {"TERMINFO_DIRS": "/a:/b", "PATH": "/app/bin"}
        self.assertIn("--env=TERMINFO_DIRS=/a:/b", fl.host_argv(["tmux", "-V"], env))

    def test_tmux_runs_from_the_apps_folder_on_the_host(self):
        app = fl.flatpak_app_path()
        self.assertEqual(fl.tmux_path(), app + "/share/fleet/bin/tmux")
        self.assertTrue(fl.bundle_env()["TERMINFO_DIRS"].startswith(app + "/share/fleet/terminfo:"))
        a = fl.session_argv("abc", ["ssh", "nas"], fl.tmux_path())
        self.assertEqual(a[:3], ["flatpak-spawn", "--host", "--watch-bus"][:2] + [a[2]])
        self.assertIn(app + "/share/fleet/bin/tmux", a)
        self.assertNotIn("--watch-bus", a, "ttyd's tmux client may end; the session it attaches to lives on")
        local = fl.session_argv("abc", [], fl.tmux_path())
        self.assertEqual(local[-2:], ["-s", "fleet-abc"], "no command: the user's own login shell, on the host")

    def test_outside_a_flatpak_nothing_changes(self):
        fl.FLATPAK_INFO = os.path.join(self.dir.name, "none")
        self.assertFalse(fl.in_flatpak())
        self.assertEqual(fl.host_argv(["ssh", "nas"]), ["ssh", "nas"])


class Package(unittest.TestCase):
    def test_the_manifest_asks_for_just_what_fleet_needs_and_the_build_uses_it(self):
        d = os.path.join(LIVE, "packaging", "flatpak")
        with open(os.path.join(d, "io.github.MarcWolpert.Fleet.yml")) as f:
            m = f.read()
        args = [l.split()[1] for l in m.splitlines() if l.startswith("  - --")]
        self.assertEqual(args, ["--share=network", "--talk-name=org.freedesktop.Flatpak", "--filesystem=xdg-config/fleet:create", "--filesystem=xdg-cache/fleet-live:create"])
        self.assertNotIn("--filesystem=home", m)
        self.assertNotIn("--filesystem=host", m)
        with open(os.path.join(d, "build_flatpak.sh")) as f:
            b = f.read()
        self.assertIn("build-finish out --command=fleet $FINISH", b, "the manifest's permissions, no others")
        for f in ("install-flatpak.sh", "fleet.sh", "io.github.MarcWolpert.Fleet.desktop", "io.github.MarcWolpert.Fleet.metainfo.xml"):
            self.assertTrue(os.path.exists(os.path.join(d, f)), f)


if __name__ == "__main__":
    unittest.main()
