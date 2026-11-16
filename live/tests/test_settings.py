# SPDX-License-Identifier: GPL-3.0-or-later
"""Settings: what GET /api/config sends the page, what validate_config keeps, and what write_config puts
in machines.toml. Every test works on a machines.toml in a temp dir and a Fleet that reads nothing: no
collector starts, nothing is run over SSH, and Fleet never restarts (restart_self is replaced).

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import collections
import http.client
import http.server
import json
import os
import sys
import tempfile
import threading
import tomllib
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import fleet_live  # noqa: E402

RESTARTS = []          # (reason) for every restart a save asked for
RESTARTED = threading.Event()
_saved = {}


def setUpModule():
    _saved.update(restart_self=fleet_live.restart_self, terminal_choices=fleet_live.terminal_choices, fleet=fleet_live.Handler.fleet)
    fleet_live.restart_self = lambda fleet, reason: (RESTARTS.append(reason), RESTARTED.set())
    fleet_live.terminal_choices = lambda: ([("terminal", "Terminal")], "terminal")


def tearDownModule():
    fleet_live.restart_self = _saved["restart_self"]
    fleet_live.terminal_choices = _saved["terminal_choices"]
    fleet_live.Handler.fleet = _saved["fleet"]


def fake_fleet(path):
    """A Fleet holding the machines in the machines.toml at `path`, built like Fleet() but with no threads."""
    with open(path, "rb") as f:
        cfg = tomllib.load(f)
    cfg["__path"] = path
    f = fleet_live.Fleet.__new__(fleet_live.Fleet)
    f.cfg, f.config_path, f.interval = cfg, path, float(cfg.get("interval", 3))
    f.machines = collections.OrderedDict((m["id"], fleet_live.Machine(m, f.interval)) for m in cfg.get("machine", []))
    f.lock, f.specs, f.tick = threading.Lock(), {}, 0
    return f


class Server:
    """Fleet's own HTTP handler on a free port, for one test."""
    def __init__(self, fleet):
        fleet_live.Handler.fleet = fleet
        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), fleet_live.Handler)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()

    def req(self, method, path, body=None, **headers):
        """Sends what Fleet's own page sends (right Host; for a POST the right Origin and X-Fleet: 1). A header
        passed as None is left out; one passed as a string replaces Fleet's."""
        h = {"Host": "127.0.0.1:%d" % self.port}
        if method == "POST":
            h.update({"Origin": "http://127.0.0.1:%d" % self.port, "X-Fleet": "1", "Content-Type": "application/json"})
        h.update({k.replace("_", "-"): v for k, v in headers.items()})
        h = {k: v for k, v in h.items() if v is not None}
        data = body if isinstance(body, bytes) or body is None else json.dumps(body).encode()
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            c.request(method, path, body=data, headers=h)
            r = c.getresponse()
            out = r.read()
        finally:
            c.close()
        return r.status, (json.loads(out) if r.status == 200 and out[:1] in (b"{", b"[") else out)


HAND_WRITTEN = """# my machines
interval = 3   # seconds

[[machine]]
id = "nas"
name = "nas"
ssh = "root@nas.example.ts.net"
os = "linux"
os_label = "Unraid"
tile = "globe"

[machine.note]
label = "Disks."
text = "The array spins down at night, so its disk reads are zero then."

[[machine]]
id = "win-desktop"
name = "win-desktop"
ssh = "me@win-desktop"
os = "windows"
os_label = "Windows 11"

[[machine]]
id = "this"
name = "this computer"
kind = "local"
tile = "laptop"
"""


class SettingsWithTempConfig(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "machines.toml")
        RESTARTS.clear()
        RESTARTED.clear()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, text):
        with open(self.path, "w", encoding="utf-8") as f:
            f.write(text)

    def serve(self):
        srv = Server(fake_fleet(self.path))
        self.addCleanup(srv.close)
        return srv

    def save(self, srv, body):
        """POST /api/config; waits for the restart a good save asks for."""
        st, r = srv.req("POST", "/api/config", body)
        if st == 200 and r.get("ok"):
            self.assertTrue(RESTARTED.wait(5), "a good save restarts Fleet")
        return st, r

    def read_back(self):
        with open(self.path, "rb") as f:
            return tomllib.load(f)


# ---------- #87: a save keeps every machine setting Fleet reads ----------
NAS = {"id": "nas", "name": "nas", "ssh": "root@nas.example.ts.net", "os": "linux", "os_label": "Unraid", "tile": "globe",
       "note": {"label": "Disks.", "text": "The array spins down at night, so its disk reads are zero then."}}
WIN = {"id": "win-desktop", "name": "win-desktop", "ssh": "me@win-desktop", "os": "windows", "os_label": "Windows 11"}
THIS = {"id": "this", "name": "this computer", "kind": "local", "tile": "laptop"}


class SaveKeepsWhatFleetReads(SettingsWithTempConfig):
    def test_get_sends_os_label_and_note(self):
        self.write(HAND_WRITTEN)
        st, d = self.serve().req("GET", "/api/config")
        self.assertEqual(st, 200)
        self.assertEqual(d["machines"], [NAS, WIN, THIS])

    def test_validate_keeps_os_label_and_note(self):
        cfg, errors = fleet_live.validate_config({"interval": 3, "terminal": "auto", "machines": [NAS, WIN, THIS]})
        self.assertEqual(errors, [])
        self.assertEqual(cfg, {"interval": 3.0, "terminal": "auto", "machine": [NAS, WIN, THIS]})

    def test_validate_keeps_only_the_note_fields_fleet_reads(self):
        """A note keeps its label and text; anything else in it, an empty note and a note that isn't a table are
        dropped, like any other key Fleet doesn't read."""
        ms = [dict(WIN, id="a", note={"label": " Disks. ", "text": " spins down ", "colour": "red"}),
              dict(WIN, id="b", note={"text": "only text"}),
              dict(WIN, id="c", note={"label": "", "text": "  "}),
              dict(WIN, id="d", note="not a table"),
              dict(WIN, id="e", os_label="  ", bogus="x")]
        cfg, errors = fleet_live.validate_config({"interval": 3, "machines": ms})
        self.assertEqual(errors, [])
        plain = {k: v for k, v in WIN.items() if k != "os_label"}
        self.assertEqual(cfg["machine"], [dict(WIN, id="a", note={"label": "Disks.", "text": "spins down"}),
                                          dict(WIN, id="b", note={"text": "only text"}),
                                          dict(WIN, id="c"), dict(WIN, id="d"), dict(plain, id="e")])

    def test_write_then_read_back_keeps_os_label_and_note(self):
        cfg = {"interval": 3.0, "terminal": "auto", "machine": [NAS, WIN, THIS]}
        fleet_live.write_config(self.path, cfg)
        self.assertEqual(self.read_back(), {"interval": 3, "terminal": "auto", "machine": [NAS, WIN, THIS]})

    def test_a_save_that_only_changes_the_interval_keeps_every_machine_as_it_was(self):
        """The page posts back what GET /api/config gave it, with the interval changed (app.js saveSettings)."""
        self.write(HAND_WRITTEN)
        srv = self.serve()
        _, d = srv.req("GET", "/api/config")
        st, r = self.save(srv, {"interval": 5, "terminal": d["terminal"], "machines": d["machines"]})
        self.assertEqual((st, r), (200, {"ok": True}))
        self.assertEqual(self.read_back(), {"interval": 5, "terminal": "auto", "machine": [NAS, WIN, THIS]})
        with open(self.path + ".bak", encoding="utf-8") as f:
            self.assertEqual(f.read(), HAND_WRITTEN)

    def test_a_second_save_still_has_them(self):
        """The .bak only holds the previous file, so the keys have to survive every save, not just the first."""
        self.write(HAND_WRITTEN)
        for interval in (5, 7):   # each save restarts Fleet, which then reads the file it wrote
            RESTARTED.clear()
            srv = Server(fake_fleet(self.path))
            try:
                _, d = srv.req("GET", "/api/config")
                self.assertEqual(self.save(srv, {"interval": interval, "terminal": "auto", "machines": d["machines"]}), (200, {"ok": True}))
            finally:
                srv.close()
        self.assertEqual(self.read_back(), {"interval": 7, "terminal": "auto", "machine": [NAS, WIN, THIS]})
        with open(self.path + ".bak", "rb") as f:
            self.assertEqual(tomllib.load(f), {"interval": 5, "terminal": "auto", "machine": [NAS, WIN, THIS]})


if __name__ == "__main__":
    unittest.main()
