# SPDX-License-Identifier: GPL-3.0-or-later
"""Packages carry every file the app loads (issue #52): the Linux package is built and installed into a
temporary prefix, and the macOS bundle's build script is read, and both must hold every script the page
loads (<script src>) and every file the server opens beside itself (os.path.join(HERE, ...))."""
import os, re, shutil, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)


def needed():
    page = open(os.path.join(LIVE, "web", "index.html"), encoding="utf-8").read()
    web = sorted(set(re.findall(r'<script src="([^"]+)"', page)) | {"index.html", "icon.svg"})
    server = open(os.path.join(LIVE, "fleet_live.py"), encoding="utf-8").read()
    app = sorted(set(re.findall(r'os\.path\.join\(HERE, "([\w.]+)"\)', server)) - {"web"})
    return web, app


class Packages(unittest.TestCase):
    def test_what_is_needed_is_known(self):
        web, app = needed()
        self.assertIn("themes.js", web)
        self.assertIn("app.js", web)
        self.assertTrue({"collect_linux.py", "collect_windows.ps1", "inspect_linux.py", "inspect_windows.ps1"} <= set(app), app)

    def test_the_linux_install_has_every_file(self):
        web, app = needed()
        out = subprocess.run(["sh", os.path.join(LIVE, "packaging", "linux", "build_linux.sh")], capture_output=True, text=True, check=True).stdout
        tarball = re.search(r"built (\S+\.tar\.gz)", out).group(1)
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(["tar", "-xzf", tarball, "-C", tmp], check=True)
            pkg = os.path.join(tmp, os.listdir(tmp)[0])
            prefix = os.path.join(tmp, "prefix")
            env = dict(os.environ, PREFIX=prefix, HOME=tmp)
            subprocess.run(["sh", os.path.join(pkg, "install.sh")], env=env, capture_output=True, check=True)
            appdir = os.path.join(prefix, "share", "fleet")
            self.assertEqual([f for f in web if not os.path.exists(os.path.join(appdir, "web", f))], [])
            self.assertEqual([f for f in app if not os.path.exists(os.path.join(appdir, f))], [])

    def test_the_macos_bundle_copies_every_file(self):
        web, app = needed()
        script = open(os.path.join(LIVE, "packaging", "macos", "build_macos.sh"), encoding="utf-8").read()
        self.assertEqual([f for f in web if '/web/%s"' % f not in script], [])
        self.assertEqual([f for f in app if '/%s"' % f not in script], [])


class Icon(unittest.TestCase):
    """The app icon (#136): one SVG, the East Indiaman, that the page, the .icns and the PNGs are made from."""
    def test_one_icon_everywhere(self):
        svg = open(os.path.join(LIVE, "packaging", "icon", "fleet.svg"), encoding="utf-8").read()
        self.assertIn("East Indiaman", svg)
        # navy and gold (#158): a gold ship on a navy gradient
        self.assertIn('stop-color="#0b1f3a"', svg)
        self.assertIn('stop-color="#1b3f6e"', svg)
        self.assertIn('fill="#f2c14e"', svg)
        self.assertNotIn('fill="#fff"', svg)
        self.assertEqual(open(os.path.join(LIVE, "web", "icon.svg"), encoding="utf-8").read(), svg)
        for s in (16, 32, 48, 64, 128, 256, 512, 1024):
            png = os.path.join(LIVE, "packaging", "icon", "png", "fleet-%d.png" % s)
            self.assertGreaterEqual(os.path.getmtime(png), os.path.getmtime(os.path.join(LIVE, "packaging", "icon", "fleet.svg")) - 1, png)


if __name__ == "__main__":
    unittest.main()
