# SPDX-License-Identifier: GPL-3.0-or-later
"""The terminals' fonts (#408): the ones Fleet carries, and the ones you install, kept in a folder of Fleet's config.
Everything here works in a temporary folder; the HTTP tests run the handler on a free port of 127.0.0.1.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import http.client
import http.server
import json
import os
import struct
import sys
import tempfile
import threading
import tracemalloc
import unittest
import zlib
from unittest import mock

LIVE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, LIVE)
import fleet_live  # noqa: E402

FONTS = os.path.join(LIVE, "web", "fonts")


def sfnt(family, weight=400, italic=False, sub=None):
    """A small TrueType file with a name table (its family, and a typographic family when `sub` is given) and an
    OS/2 table (its weight, and whether it's italic): what Fleet reads from a font you install."""
    names = [(1, family), (2, "Italic" if italic else "Regular")] + ([(16, sub)] if sub else [])
    strings, recs = b"", b""
    for nid, s in names:
        b = s.encode("utf-16-be")
        recs += struct.pack(">6H", 3, 1, 0x409, nid, len(b), len(strings))
        strings += b
    name = struct.pack(">3H", 0, len(names), 6 + 12 * len(names)) + recs + strings
    os2 = struct.pack(">HhH", 4, 500, weight) + b"\0" * 56 + struct.pack(">H", 1 if italic else 0x40) + b"\0" * 32
    tables = [(b"OS/2", os2), (b"name", name)]
    head = struct.pack(">I4H", 0x00010000, len(tables), 32, 1, 0)
    off, dirs, body = 12 + 16 * len(tables), b"", b""
    for tag, data in tables:
        dirs += struct.pack(">4sIII", tag, 0, off + len(body), len(data))
        body += data + b"\0" * (-len(data) % 4)
    return head + dirs + body


def woff(font, tables=None):
    """A WOFF (1) of a TrueType file made by sfnt(): its tables zlib-compressed, as WOFF has them; or, given `tables`,
    [(tag, compressed data, original length)] as they are, to make a bad one."""
    if tables is None:
        n = struct.unpack_from(">H", font, 4)[0]
        tables = []
        for i in range(n):
            tag, _, off, ln = struct.unpack_from(">4sIII", font, 12 + 16 * i)
            tables.append((tag, zlib.compress(font[off:off + ln]), ln))
    off, dirs, body = 44 + 20 * len(tables), b"", b""
    for tag, data, olen in tables:
        dirs += struct.pack(">4sIIII", tag, off + len(body), len(data), olen, 0)
        body += data + b"\0" * (-len(data) % 4)
    total = off + len(body)
    return struct.pack(">4sIIHHI", b"wOFF", 0x00010000, total, len(tables), 0, total) + b"\0" * 24 + dirs + body


class Carried(unittest.TestCase):
    def test_fleet_carries_four_terminal_fonts_each_with_its_licence(self):
        got = {f["family"]: f for f in fleet_live.font_catalog(folder=tempfile.mkdtemp())}
        self.assertEqual(list(got), ["Fira Code", "JetBrains Mono", "Source Code Pro", "Hack"])
        for fam, f in got.items():
            self.assertFalse(f["own"], fam)
            self.assertEqual([x["weight"] for x in f["faces"]], ["400", "700"], fam)
            for x in f["faces"]:
                self.assertTrue(x["url"].startswith("/fonts/") and x["url"].endswith(".woff2"), x)
                with open(os.path.join(FONTS, x["url"][len("/fonts/"):]), "rb") as fh:
                    self.assertEqual(fh.read(4), b"wOF2", x)
            self.assertTrue(os.path.exists(os.path.join(FONTS, f["licence"])), f["licence"])
        for lic in ("FiraCode-OFL.txt", "JetBrainsMono-OFL.txt", "SourceCodePro-OFL.txt"):
            with open(os.path.join(FONTS, lic)) as fh:
                self.assertIn("SIL Open Font License, Version 1.1", fh.read(), lic)
        with open(os.path.join(FONTS, "Hack-LICENSE.txt")) as fh:
            self.assertIn("Bitstream Vera License", fh.read())


class Yours(unittest.TestCase):
    def setUp(self):
        self.dir = os.path.join(tempfile.mkdtemp(), "fonts")

    def own(self):
        return [f for f in fleet_live.font_catalog(folder=self.dir) if f["own"]]

    def test_an_installed_font_is_named_and_weighed_from_its_own_tables(self):
        self.assertEqual(fleet_live.install_font("Iosevka-Bold.ttf", sfnt("Iosevka Bold", 700, sub="Iosevka"), folder=self.dir), "Iosevka")
        self.assertEqual(fleet_live.install_font("Iosevka-Italic.ttf", sfnt("Iosevka", 400, italic=True), folder=self.dir), "Iosevka")
        self.assertEqual(fleet_live.install_font("MonoLisa.otf", b"OTTO" + sfnt("MonoLisa")[4:], folder=self.dir), "MonoLisa")
        got = {f["family"]: f["faces"] for f in self.own()}
        self.assertEqual(sorted(got), ["Iosevka", "MonoLisa"])
        self.assertEqual(sorted((x["weight"], x["style"], x["url"].split("&v=")[0]) for x in got["Iosevka"]),
                         [("400", "italic", "/api/font?f=Iosevka-Italic.ttf"), ("700", "normal", "/api/font?f=Iosevka-Bold.ttf")])
        self.assertEqual(os.stat(self.dir).st_mode & 0o777, 0o700)

    def test_a_woff2_is_named_from_its_file(self):
        # its tables are compressed (Brotli, which Python doesn't have), so the name says what it is
        with open(os.path.join(FONTS, "FiraCode-Bold.woff2"), "rb") as fh:
            self.assertEqual(fleet_live.install_font("FiraCodeNF-BoldItalic.woff2", fh.read(), folder=self.dir), "FiraCodeNF")
        self.assertEqual([(f["family"], [(x["weight"], x["style"]) for x in f["faces"]]) for f in self.own()], [("FiraCodeNF", [("700", "italic")])])

    def test_your_own_font_by_a_carried_ones_name_takes_its_place(self):
        fleet_live.install_font("FiraCode-Regular.ttf", sfnt("Fira Code"), folder=self.dir)
        got = [(f["family"], f["own"]) for f in fleet_live.font_catalog(folder=self.dir)]
        self.assertEqual(got, [("JetBrains Mono", False), ("Source Code Pro", False), ("Hack", False), ("Fira Code", True)])

    def test_what_isnt_a_font_or_is_named_badly_is_turned_away(self):
        for name, data in [("x.ttf", b"MZ\x90\0not a font"), ("../x.ttf", sfnt("X")), (".hidden.ttf", sfnt("X")), ("x.exe", sfnt("X")),
                           ("x.ttc", b"ttcf" + b"\0" * 64), ("x.ttf", b""), ("x.ttf", sfnt("X") + b"\0" * fleet_live.MAX_FONT)]:
            with self.assertRaises(ValueError, msg=name):
                fleet_live.install_font(name, data, folder=self.dir)
        self.assertEqual(self.own(), [])
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(self.dir), "x.ttf")))

    def test_a_woff_is_read_from_its_compressed_tables(self):
        self.assertEqual(fleet_live.font_info("x.woff", woff(sfnt("Iosevka Bold", 700, sub="Iosevka"))), ("Iosevka", "700", "normal"))

    def test_a_font_built_to_take_memory_is_read_within_bounds(self):
        # #408 review: a WOFF whose tables inflate to gigabytes, several pointing at the same data; a TrueType file whose
        # many table records each span the whole file. Fleet reads only the name and OS/2 tables, each bounded.
        bomb = zlib.compress(b"\0" * (64 << 20), 9)
        w = woff(None, [(t, bomb, 64 << 20) for t in (b"name", b"OS/2", b"glyf", b"loca")])
        n = 1000
        ttf = struct.pack(">I4H", 0x00010000, n, 0, 0, 0) + b"".join(struct.pack(">4sIII", b"T%03d" % i, 0, 1, 1 << 20) for i in range(n)) + b"\0" * (1 << 20)
        for name, data, want in [("Foo-Bold.woff", w, ("Foo", "700", "normal")), ("Bar-Light.ttf", ttf, ("Bar", "300", "normal"))]:
            tracemalloc.start()
            got = fleet_live.font_info(name, data)
            peak = tracemalloc.get_traced_memory()[1]
            tracemalloc.stop()
            self.assertEqual(got, want, name)
            self.assertLess(peak, 8 << 20, name)

    def test_a_file_name_ends_where_it_seems_to(self):
        with self.assertRaises(ValueError):
            fleet_live.install_font("a.ttf\n", sfnt("A"), folder=self.dir)
        self.assertFalse(os.path.exists(self.dir) and os.listdir(self.dir))

    def test_a_font_that_cant_be_read_is_named_from_its_file_and_can_be_removed(self):
        fleet_live.install_font("Odd-Bold.ttf", sfnt("Odd", 700), folder=self.dir)
        fleet_live.FONT_INFO.clear()
        with mock.patch.object(fleet_live, "font_tables", side_effect=MemoryError):
            got = fleet_live.font_catalog(folder=self.dir)
            self.assertEqual([(f["family"], [x["weight"] for x in f["faces"]]) for f in got[-1:]], [("Odd", ["700"])])
            self.assertEqual(len(got), 5, "Fleet's own are still there")
            self.assertEqual(fleet_live.remove_font("Odd", folder=self.dir), 1)

    def test_a_font_that_cant_be_read_isnt_installed(self):
        with mock.patch.object(fleet_live, "font_tables", side_effect=MemoryError):
            with self.assertRaises(ValueError):
                fleet_live.install_font("Odd.ttf", sfnt("Odd"), folder=self.dir)
        self.assertEqual(os.listdir(self.dir) if os.path.exists(self.dir) else [], [], "nothing left behind, not even a part")

    def test_installed_again_it_reads_anew_and_its_address_changes(self):
        fleet_live.install_font("Mono.ttf", sfnt("Mono", 400), folder=self.dir)
        before = self.own()[0]["faces"][0]
        os.utime(os.path.join(self.dir, "Mono.ttf"), (1, 1))
        fleet_live.install_font("Mono.ttf", sfnt("Mono", 700), folder=self.dir)
        after = self.own()[0]["faces"][0]
        self.assertEqual((before["weight"], after["weight"]), ("400", "700"))
        self.assertNotEqual(before["url"], after["url"], "so a page that has the old one fetches the new")
        self.assertTrue(after["url"].startswith("/api/font?f=Mono.ttf&v="), after["url"])
        self.assertEqual(os.stat(os.path.join(self.dir, "Mono.ttf")).st_mode & 0o777, 0o600)

    def test_a_font_is_removed_with_all_its_faces_and_only_those(self):
        fleet_live.install_font("Iosevka-Regular.ttf", sfnt("Iosevka"), folder=self.dir)
        fleet_live.install_font("Iosevka-Bold.ttf", sfnt("Iosevka", 700), folder=self.dir)
        fleet_live.install_font("Mono.ttf", sfnt("Mono"), folder=self.dir)
        with open(os.path.join(self.dir, "notes.txt"), "w") as fh:
            fh.write("mine")
        self.assertEqual(fleet_live.remove_font("Iosevka", folder=self.dir), 2)
        self.assertEqual(fleet_live.remove_font("Fira Code", folder=self.dir), 0, "a carried font stays")
        self.assertEqual([f["family"] for f in self.own()], ["Mono"])
        self.assertEqual(sorted(os.listdir(self.dir)), ["Mono.ttf", "notes.txt"])


class Http(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), fleet_live.Handler)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def setUp(self):
        self.dir = os.path.join(tempfile.mkdtemp(), "fonts")
        p = mock.patch.object(fleet_live, "FONTS_DIR", self.dir)
        p.start()
        self.addCleanup(p.stop)

    def req(self, method, path, body=b"", headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            h = {"Host": "127.0.0.1:%d" % self.port}
            h.update(headers or {})
            c.request(method, path, body=body, headers=h)
            r = c.getresponse()
            return r.status, r.getheader("Content-Type"), r.read()
        finally:
            c.close()

    def test_install_list_fetch_and_remove(self):
        w = {"X-Fleet": "1", "Origin": "http://127.0.0.1:%d" % self.port, "Content-Type": "application/octet-stream"}
        font = sfnt("Iosevka")
        st, _, b = self.req("POST", "/api/fonts/install?name=Iosevka-Regular.ttf", font, w)
        self.assertEqual((st, json.loads(b)), (200, {"ok": True, "family": "Iosevka"}))
        st, _, b = self.req("POST", "/api/fonts/install?name=bad.ttf", b"nope", w)
        self.assertEqual(st, 200)
        self.assertFalse(json.loads(b)["ok"])
        st, _, b = self.req("GET", "/api/fonts")
        got = json.loads(b)["fonts"]
        self.assertEqual([f["family"] for f in got], ["Fira Code", "JetBrains Mono", "Source Code Pro", "Hack", "Iosevka"])
        self.assertEqual(self.req("GET", "/api/font?f=Iosevka-Regular.ttf"), (200, "font/ttf", font))
        self.assertEqual(self.req("GET", "/api/font?f=../machines.toml")[0], 404)
        self.assertEqual(self.req("GET", "/api/font?f=nothere.ttf")[0], 404)
        self.assertEqual(self.req("GET", "/api/font?f=Iosevka-Regular.ttf%0A")[0], 404)
        self.assertEqual(self.req("GET", "/api/fonts", headers={"Host": "evil.example:%d" % self.port})[0], 403)
        self.assertEqual(self.req("GET", "/api/font?f=Iosevka-Regular.ttf", headers={"Host": "evil.example:%d" % self.port})[0], 403)
        self.assertEqual(self.req("POST", "/api/fonts/install?name=x.ttf", font, dict(w, Origin="http://evil.example"))[0], 403)
        self.assertEqual(self.req("POST", "/api/fonts/remove", b"{}", dict(w, Origin="http://evil.example"))[0], 403)
        self.assertEqual(self.req("GET", "/fonts/FiraCode-Regular.woff2")[0], 200)
        self.assertEqual(self.req("POST", "/api/fonts/install?name=x.ttf", font, {"Content-Type": "application/octet-stream"})[0], 403, "a write needs X-Fleet")
        st, _, b = self.req("POST", "/api/fonts/remove", json.dumps({"family": "Iosevka"}).encode(), dict(w, **{"Content-Type": "application/json"}))
        self.assertEqual(json.loads(b), {"ok": True, "removed": 1})
        self.assertEqual(os.listdir(self.dir), [])


if __name__ == "__main__":
    unittest.main()


class Body(unittest.TestCase):
    """What install takes as its body: a length that isn't one is a 400; one over the limit is said to be, unread."""

    def handler(self, length, body=b""):
        h = fleet_live.Handler.__new__(fleet_live.Handler)
        h.headers = {"Content-Length": length}
        h.rfile = __import__("io").BytesIO(body)
        h.path = "/api/fonts/install?name=x.ttf"
        h.allowed = lambda write=False: True
        sent = []
        h.send_json = sent.append
        h.send_error = lambda code, *a: sent.append(code)
        h.close_connection = False
        return h, sent

    def test_lengths(self):
        for length, want in [("-1", 400), ("abc", 400)]:
            h, sent = self.handler(length, b"x" * 100)
            h.do_POST()
            self.assertEqual(sent, [want], length)
        h, sent = self.handler(str(fleet_live.MAX_FONT + 1), b"")
        h.do_POST()
        self.assertEqual(len(sent), 1)
        self.assertFalse(sent[0]["ok"])
        self.assertIn("16 MB", sent[0]["error"])
        self.assertTrue(h.close_connection)
