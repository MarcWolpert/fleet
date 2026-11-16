# SPDX-License-Identifier: GPL-3.0-or-later
"""The icon script (issue #90): make_icons.sh renders packaging/icon/fleet.svg with headless Chrome and only
then replaces the PNGs, Fleet.icns and web/icon.svg. When Chrome could not load the SVG (truncated, empty or
missing) it still writes a screenshot, of its broken-image placeholder, so the script must refuse and change
nothing; and a checkout or TMPDIR whose path holds # ? % or a character outside ASCII must still render the SVG
itself. Every case runs a copy of the script in a temporary checkout, so the committed icons are never touched.
Needs macOS (sips, iconutil) and Google Chrome, like the script."""
import json, os, pathlib, shutil, struct, subprocess, sys, tempfile, unittest, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SIZES = (16, 32, 48, 64, 128, 256, 512, 1024)
# A green square over the middle quarter of a transparent 1024 canvas: every pixel of a true render is known.
SVG = (b'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">'
       b'<rect x="256" y="256" width="512" height="512" fill="#00ff00"/></svg>\n')
OLD = b"committed\n"  # what every icon file holds before a run; a refused run must leave it all


def read(path):
    with open(path, "rb") as f:
        return f.read()


def write(path, data):
    with open(path, "wb") as f:
        f.write(data)


def pixels(path):
    """Every pixel of an 8-bit, non-interlaced RGB or RGBA PNG (what Chrome screenshots), as rows of (r, g, b, a)."""
    b = read(path)
    i, idat = 8, b""
    while i < len(b):
        n, t = struct.unpack(">I4s", b[i:i + 8])
        d = b[i + 8:i + 8 + n]
        i += 12 + n
        if t == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", d[:10])
        elif t == b"IDAT":
            idat += d
    assert depth == 8 and ctype in (2, 6), (depth, ctype)
    bpp = 4 if ctype == 6 else 3
    raw, stride, prev, rows = zlib.decompress(idat), w * bpp, bytearray(w * bpp), []
    for y in range(h):
        f, row = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for x in range(stride):
            a, up, c = row[x - bpp] if x >= bpp else 0, prev[x], prev[x - bpp] if x >= bpp else 0
            if f == 1: row[x] = (row[x] + a) & 255
            elif f == 2: row[x] = (row[x] + up) & 255
            elif f == 3: row[x] = (row[x] + (a + up) // 2) & 255
            elif f == 4:
                p = a + up - c
                pa, pb, pc = abs(p - a), abs(p - up), abs(p - c)
                row[x] = (row[x] + (a if pa <= pb and pa <= pc else up if pb <= pc else c)) & 255
        rows.append([tuple(row[x:x + bpp]) + ((255,) if bpp == 3 else ()) for x in range(0, stride, bpp)])
        prev = row
    return rows


def size(path):
    return struct.unpack(">II", read(path)[16:24])


def tree(root):
    out = {}
    for d, _, files in os.walk(root):
        for f in files:
            p = os.path.join(d, f)
            out[os.path.relpath(p, root)] = read(p)
    return out


@unittest.skipUnless(sys.platform == "darwin" and os.path.exists(CHROME), "make_icons.sh needs macOS and Google Chrome")
class MakeIcons(unittest.TestCase):
    def checkout(self, tmp, name, svg):
        """A checkout at tmp/name holding the script, fleet.svg (svg, or none) and an older copy of every icon."""
        root = os.path.join(tmp, name)
        pack = os.path.join(root, "live", "packaging")
        os.makedirs(os.path.join(pack, "icon", "png"))
        os.makedirs(os.path.join(root, "live", "web"))
        shutil.copy(os.path.join(LIVE, "packaging", "make_icons.sh"), pack)
        if svg is not None:
            write(os.path.join(pack, "icon", "fleet.svg"), svg)
        for f in ["icon/png/fleet-%d.png" % s for s in SIZES] + ["icon/Fleet.icns", "../web/icon.svg"]:
            write(os.path.join(pack, f), OLD)
        return root

    def run_script(self, root, tmpdir):
        os.makedirs(tmpdir, exist_ok=True)
        return subprocess.run(["sh", os.path.join(root, "live", "packaging", "make_icons.sh")], capture_output=True,
                              text=True, env=dict(os.environ, TMPDIR=tmpdir))

    def test_an_svg_chrome_cannot_load_changes_nothing(self):
        for case, svg in (("truncated", SVG[:len(SVG) // 2]), ("empty", b""), ("missing", None)):
            with self.subTest(case), tempfile.TemporaryDirectory() as tmp:
                root = self.checkout(tmp, "fleet", svg)
                before = tree(root)
                r = self.run_script(root, os.path.join(tmp, "tmp"))
                icon = os.path.join(root, "live", "packaging", "icon")
                self.assertEqual((r.returncode, r.stdout, r.stderr),
                                 (1, "", "make_icons.sh: Chrome could not render %s/fleet.svg, so no icon was changed\n" % icon))
                self.assertEqual(tree(root), before)
                self.assertEqual(os.listdir(os.path.join(tmp, "tmp")), [])  # its work dir is gone too

    def test_the_svg_renders_from_any_checkout_path(self):
        want = [[(0, 255, 0, 255) if 256 <= x < 768 and 256 <= y < 768 else (0, 0, 0, 0) for x in range(1024)] for y in range(1024)]
        # (checkout dir, TMPDIR): a plain path (the control), then each character a file:// URL reads as syntax, then
        # characters outside ASCII (#305: the page Chrome loads must be read as UTF-8, or "é" reaches it as "Ã©")
        for name, tmpname in (("fleet", "tmp"), ("fleet #1", "tmp"), ("fleet ?2", "tmp"), ("fleet %41", "tmp"), ("fleet", "tmp #3"),
                              ("Développement", "tmp"), ("開発 fleet", "tmp"), ("fleet", "tmp é")):
            with self.subTest(checkout=name, tmpdir=tmpname), tempfile.TemporaryDirectory() as tmp:
                root = self.checkout(tmp, name, SVG)
                r = self.run_script(root, os.path.join(tmp, tmpname))
                icon = os.path.join(root, "live", "packaging", "icon")
                self.assertEqual((r.returncode, r.stdout, r.stderr),
                                 (0, "icons: %s/png/fleet-{16..1024}.png and %s/Fleet.icns\n" % (icon, icon), ""))
                files = tree(root)
                self.assertEqual(sorted(files), sorted(["live/packaging/make_icons.sh", "live/packaging/icon/fleet.svg", "live/packaging/icon/Fleet.icns", "live/web/icon.svg",
                                                        "live/packaging/icon/png/SOURCE"] + ["live/packaging/icon/png/fleet-%d.png" % s for s in SIZES]))
                # what they were drawn from: the drawing's hash, comments aside (test_packaging checks it against fleet.svg)
                import hashlib, re
                drawing = re.sub(r"<!--.*?-->", "", SVG.decode() if isinstance(SVG, bytes) else SVG, flags=re.S)
                self.assertEqual(files["live/packaging/icon/png/SOURCE"].decode().strip(), hashlib.sha256(drawing.encode()).hexdigest())
                self.assertEqual(files["live/web/icon.svg"], SVG)
                self.assertEqual(files["live/packaging/icon/Fleet.icns"][:4], b"icns")
                self.assertEqual({s: size(os.path.join(icon, "png", "fleet-%d.png" % s)) for s in SIZES}, {s: (s, s) for s in SIZES})
                self.assertTrue(pixels(os.path.join(icon, "png", "fleet-1024.png")) == want, "fleet-1024.png is not the SVG's render")
                self.assertEqual(os.listdir(os.path.join(tmp, tmpname)), [])


class NoKeychain(unittest.TestCase):
    """#280: Chrome launched for rendering or tests never touches the macOS keychain, so a scratch HOME (which has
    none) shows no 'Keychain Not Found' dialog. Each launch runs a stand-in Chrome that writes down the arguments it
    was started with, so the flag must be on the command that runs, not just somewhere in the file."""
    def fake_chrome(self, tmp):
        fake, out = os.path.join(tmp, "fake-chrome"), os.path.join(tmp, "argv")
        write(fake, b'#!/bin/sh\nprintf "%s\\n" "$@" > "$FAKE_ARGV"\nexit 1\n')
        os.chmod(fake, 0o755)
        return fake, out

    def argv(self, out):
        self.assertTrue(os.path.exists(out), "Chrome was started")
        with open(out, encoding="utf-8") as f:
            return f.read().splitlines()

    def test_make_icons_starts_chrome_with_a_mock_keychain(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake, out = self.fake_chrome(tmp)
            pack = os.path.join(tmp, "fleet", "live", "packaging")
            os.makedirs(os.path.join(pack, "icon")); os.makedirs(os.path.join(tmp, "work"))
            text = read(os.path.join(LIVE, "packaging", "make_icons.sh")).decode()
            chrome = [l for l in text.splitlines() if l.startswith("CHROME=")]
            self.assertEqual(len(chrome), 1, "one Chrome for the script")
            write(os.path.join(pack, "make_icons.sh"), text.replace(chrome[0], 'CHROME="%s"' % fake).encode())
            write(os.path.join(pack, "icon", "fleet.svg"), SVG)
            subprocess.run(["sh", os.path.join(pack, "make_icons.sh")], capture_output=True,
                           env=dict(os.environ, FAKE_ARGV=out, TMPDIR=os.path.join(tmp, "work")))
            argv = self.argv(out)
            self.assertIn("--headless=new", argv)
            self.assertIn("--use-mock-keychain", argv)

    @unittest.skipUnless(shutil.which("node"), "needs node")
    def test_the_web_tests_start_chrome_with_a_mock_keychain(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake, out = self.fake_chrome(tmp)
            harness = pathlib.Path(LIVE, "tests", "web", "harness.mjs").as_uri()
            # the stand-in exits, so launch() fails once it has started it: only its arguments matter here
            js = "import {launch} from %s; try { await launch(); } catch (e) {} process.exit(0);" % json.dumps(harness)
            subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, timeout=60,
                           env=dict(os.environ, FLEET_TEST_CHROME=fake, FAKE_ARGV=out, TMPDIR=tmp))
            argv = self.argv(out)
            self.assertIn("--remote-debugging-port=0", argv)
            self.assertIn("--use-mock-keychain", argv)


if __name__ == "__main__":
    unittest.main()
