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
            appdir = os.path.join(prefix, "share", "fleet", "live")
            self.assertEqual([f for f in web if not os.path.exists(os.path.join(appdir, "web", f))], [])
            self.assertEqual([f for f in app if not os.path.exists(os.path.join(appdir, f))], [])
            with open(os.path.join(prefix, "bin", "fleet")) as f:
                self.assertIn(os.path.join(appdir, "fleet_live.py"), f.read())
            for f in ("SymbolsNerdFontMono-Regular.ttf", "SymbolsNerdFont-LICENSE.txt"):   # the terminals' symbols font and its licence (#387)
                self.assertTrue(os.path.exists(os.path.join(appdir, "web", "fonts", f)), f)

    def test_a_self_contained_linux_package_installs_its_own_python_ttyd_and_tmux(self):
        # #360: --arch with --deps (stand-ins here for the pinned downloads fetch_linux_deps.sh makes)
        with tempfile.TemporaryDirectory() as tmp:
            deps = os.path.join(tmp, "deps")
            os.makedirs(os.path.join(deps, "pkg", "python", "bin"))
            py = os.path.join(deps, "pkg", "python", "bin", "python3")
            with open(py, "w") as f:   # a Python that is this one
                f.write('#!/bin/sh\nexec "%s" "$@"\n' % sys.executable)
            os.chmod(py, 0o755)
            subprocess.run(["tar", "-czf", os.path.join(deps, "python.tar.gz"), "-C", os.path.join(deps, "pkg"), "python"], check=True)
            for t in ("ttyd", "tmux"):
                with open(os.path.join(deps, t), "w") as f:
                    f.write("#!/bin/sh\necho %s\n" % t)
            os.makedirs(os.path.join(deps, "terminfo", "x"))
            open(os.path.join(deps, "terminfo", "x", "xterm-256color"), "w").close()
            out = subprocess.run(["sh", os.path.join(LIVE, "packaging", "linux", "build_linux.sh"), "--arch", "x86_64", "--deps", deps],
                                 capture_output=True, text=True, check=True).stdout
            tarball = re.search(r"built (\S+\.tar\.gz)", out).group(1)
            self.assertTrue(tarball.endswith("-linux-x64.tar.gz"), tarball)
            subprocess.run(["tar", "-xzf", tarball, "-C", tmp], check=True)
            pkg = os.path.join(tmp, os.path.basename(tarball)[:-7])
            with open(os.path.join(pkg, "README.txt")) as f:
                readme = f.read()
            self.assertIn("./install.sh", readme)
            self.assertIn("Everything Fleet runs is inside", readme)
            prefix = os.path.join(tmp, "prefix")
            env = dict(os.environ, PREFIX=prefix, HOME=tmp, PATH="/usr/bin:/bin")   # no python3 needed from here on
            subprocess.run(["sh", os.path.join(pkg, "install.sh")], env=env, capture_output=True, check=True)
            appdir = os.path.join(prefix, "share", "fleet")
            with open(os.path.join(pkg, "THIRD_PARTY_NOTICES.txt")) as f:   # what it carries, and their licences (#388)
                notices = f.read()
            for want in ("ttyd 1.7.7", "tmux 3.8", "mbed TLS", "musl libc", "libevent", "Python 3.12", "Symbols Nerd Font Mono", "Permission is hereby granted"):
                self.assertIn(want, notices)
            for f in ("FLEET_BUNDLE", "bin/ttyd", "bin/tmux", "terminfo/x/xterm-256color", "python/bin/python3", "live/fleet_live.py", "THIRD_PARTY_NOTICES.txt"):
                self.assertTrue(os.path.exists(os.path.join(appdir, f)), f)
            with open(os.path.join(prefix, "bin", "fleet")) as f:
                self.assertIn('exec "%s"' % os.path.join(appdir, "python", "bin", "python3"), f.read(), "its own Python")
            build = os.path.join(LIVE, "dist", os.path.basename(tarball)[:-7])
            shutil.rmtree(build, ignore_errors=True); os.remove(tarball)

    def test_the_macos_bundle_copies_every_file(self):
        web, app = needed()
        script = open(os.path.join(LIVE, "packaging", "macos", "build_macos.sh"), encoding="utf-8").read()
        self.assertIn('cp "$LIVE/web/fonts/"*', script)
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
            self.assertTrue(os.path.exists(os.path.join(LIVE, "packaging", "icon", "png", "fleet-%d.png" % s)), s)
        # the PNGs were drawn from this drawing (make_icons.sh writes its hash, comments aside; git keeps no file times)
        import hashlib, re
        with open(os.path.join(LIVE, "packaging", "icon", "png", "SOURCE")) as f:
            self.assertEqual(f.read().strip(), hashlib.sha256(re.sub(r"<!--.*?-->", "", svg, flags=re.S).encode()).hexdigest(),
                             "the drawing changed: run live/packaging/make_icons.sh")

    def test_fleet_app_uses_its_own_python_first(self):
        # #359: the app carries a Python; one installed on the Mac is only a fallback
        src = open(os.path.join(LIVE, "packaging", "macos", "FleetApp.swift"), encoding="utf-8").read()
        body = src[src.index("func findPython()"):src.index("func startServer()")]
        self.assertIn('appendingPathComponent("python/bin/python3")', body)
        self.assertLess(body.index("python/bin/python3"), body.index("/opt/homebrew/bin/python3"))

    def test_fleet_app_zoom_goes_to_the_terminals_while_youre_in_them(self):
        # #351: the page says when the terminals are the panel you're in; the View menu's zoom then sizes them
        src = open(os.path.join(LIVE, "packaging", "macos", "FleetApp.swift"), encoding="utf-8").read()
        self.assertIn('d["termFocus"] as? Bool', src)
        body = src[src.index("func zoom(_ how: String)"):src.index("@objc func zoomIn")]
        self.assertIn("termZoom", body)
        self.assertIn("fleetTermZoom", body)

    def test_the_boat_sits_centred_top_to_bottom(self):
        # #355: as much tile above the boat as below it. Its bounds come from its shapes: every rect, and every point of
        # every path (the curves here bend toward their control points, never past them)
        import re
        svg = open(os.path.join(LIVE, "packaging", "icon", "fleet.svg"), encoding="utf-8").read()
        tile = re.search(r'<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" rx="\d+" fill="url\(#g2\)"/>', svg)
        top, bottom = int(tile.group(2)), int(tile.group(2)) + int(tile.group(4))
        dx, dy = map(float, re.search(r'<g transform="translate\(([-\d.]+) ([-\d.]+)\)">', svg).groups())
        boat = svg[svg.index('<g transform="translate(0 0)'):]
        ys = []
        for m in re.finditer(r'<rect x="[-\d.]+" y="([-\d.]+)" width="[-\d.]+" height="([-\d.]+)"', boat):
            ys += [float(m.group(1)), float(m.group(1)) + float(m.group(2))]
        for d in re.findall(r' d="([^"]+)"', boat):
            ys += [float(y) for _, y in re.findall(r"(-?[\d.]+),(-?[\d.]+)", d)]
        above, below = min(ys) + dy - top, bottom - (max(ys) + dy)
        self.assertGreater(above, 100)
        self.assertLessEqual(abs(above - below), 2, "%.0f px above the boat, %.0f below" % (above, below))

    def test_the_icon_names_no_local_path(self):
        # the page serves web/icon.svg as its favicon, and fleet.svg ships in the packages: neither may say where on
        # a developer's machine it was made (#298)
        for f in (os.path.join(LIVE, "packaging", "icon", "fleet.svg"), os.path.join(LIVE, "web", "icon.svg")):
            svg = open(f, encoding="utf-8").read()
            self.assertEqual(re.findall(r"~/|/Users/|/home/|\.cache|[A-Za-z]:\\|\w+\.(?:py|sh|mjs)\b", svg), [], f)
            self.assertEqual(re.findall(r"<!--(.*?)-->", svg, re.S), [" Fleet: a 1700s East Indiaman under full sail, gold on a navy gradient "], f)


if __name__ == "__main__":
    unittest.main()
