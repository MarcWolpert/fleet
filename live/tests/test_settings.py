# SPDX-License-Identifier: GPL-3.0-or-later
"""Settings and the other writes: what GET /api/config sends the page, what validate_config keeps, what
write_config puts in machines.toml, the argv Fleet builds for Open terminal and Test connection, the size
limits on pins, tile pins and prefs, and the gate every POST passes (right Host, Origin and X-Fleet).
Every test works on files in a temp dir and a Fleet that reads nothing: no collector starts, nothing is
run (subprocess is replaced with one that fails the test), and Fleet never restarts (restart_self is replaced).

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import collections
import http.client
import http.server
import json
import os
import subprocess
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


class NoProcesses:
    """Stands in for fleet_live's subprocess: anything that would run a program fails the test instead."""
    PIPE, STDOUT, DEVNULL, TimeoutExpired = subprocess.PIPE, subprocess.STDOUT, subprocess.DEVNULL, subprocess.TimeoutExpired

    def run(self, *a, **kw):
        raise AssertionError("a test tried to run %r" % (a[:1],))
    Popen = run


def setUpModule():
    _saved.update(restart_self=fleet_live.restart_self, terminal_choices=fleet_live.terminal_choices, fleet=fleet_live.Handler.fleet,
                  subprocess=fleet_live.subprocess)
    fleet_live.restart_self = lambda fleet, reason: (RESTARTS.append(reason), RESTARTED.set())
    fleet_live.terminal_choices = lambda: ([("terminal", "Terminal")], "terminal")
    fleet_live.subprocess = NoProcesses()


def tearDownModule():
    fleet_live.restart_self = _saved["restart_self"]
    fleet_live.terminal_choices = _saved["terminal_choices"]
    fleet_live.Handler.fleet = _saved["fleet"]
    fleet_live.subprocess = _saved["subprocess"]


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


# ---------- #88: Runs on can't go round in a circle ----------
def lx(mid, vm_on=""):
    m = {"id": mid, "name": mid, "ssh": mid, "os": "linux"}
    if vm_on:
        m["vm_on"] = vm_on
    return m


def circle(*names):
    return "%s: “runs on” goes round in a circle (%s). One of them has to run on its own hardware." % (names[0], " → ".join(names + names[:1]))


class RunsOnLoops(SettingsWithTempConfig):
    def check(self, machines, errors):
        cfg, got = fleet_live.validate_config({"interval": 3, "machines": machines})
        self.assertEqual(got, errors)
        if not errors:
            self.assertEqual(cfg["machine"], machines)

    def test_two_machines_on_each_other(self):
        self.check([lx("nas"), lx("vm-a", "vm-b"), lx("vm-b", "vm-a")], [circle("vm-a", "vm-b")])

    def test_three_in_a_circle_listed_out_of_order(self):
        """Named from the first of them in the list, in the order they run on each other."""
        self.check([lx("vm-c", "vm-a"), lx("nas"), lx("vm-a", "vm-b"), lx("vm-b", "vm-c")], [circle("vm-c", "vm-a", "vm-b")])

    def test_a_machine_on_a_circle_is_not_a_second_error(self):
        self.check([lx("vm-a", "vm-b"), lx("vm-b", "vm-a"), lx("vm-d", "vm-a")], [circle("vm-a", "vm-b")])

    def test_two_circles_are_two_errors(self):
        self.check([lx("vm-a", "vm-b"), lx("vm-b", "vm-a"), lx("vm-c", "vm-d"), lx("vm-d", "vm-c")],
                   [circle("vm-a", "vm-b"), circle("vm-c", "vm-d")])

    def test_runs_on_itself_is_still_the_one_error_it_was(self):
        self.check([lx("vm-a", "vm-a")], ["vm-a: “runs on” must be another machine in the list."])

    def test_runs_on_a_machine_not_in_the_list_is_still_the_one_error_it_was(self):
        self.check([lx("vm-a", "gone")], ["vm-a: “runs on” must be another machine in the list."])

    def test_a_vm_in_a_vm_is_fine(self):
        """Control: a chain that ends at a machine on its own hardware nests, however deep."""
        self.check([lx("nas"), lx("vm-a", "nas"), lx("vm-b", "vm-a"), lx("vm-c", "vm-b"), lx("vm-d", "nas")], [])

    def test_save_refuses_a_circle_and_leaves_the_file_alone(self):
        self.write(HAND_WRITTEN)
        st, r = self.save(self.serve(), {"interval": 3, "machines": [lx("vm-a", "vm-b"), lx("vm-b", "vm-a")]})
        self.assertEqual((st, r), (200, {"ok": False, "errors": [circle("vm-a", "vm-b")]}))
        with open(self.path, encoding="utf-8") as f:
            self.assertEqual(f.read(), HAND_WRITTEN)
        self.assertEqual(sorted(os.listdir(self.tmp.name)), ["machines.toml"])
        self.assertFalse(RESTARTED.wait(0.8))
        self.assertEqual(RESTARTS, [])



# ---------- #89: what Settings accepts and refuses ----------
class ValidateConfig(unittest.TestCase):
    def test_accepted_and_normalised(self):
        """Values are stripped and empty ones dropped; this computer has no ssh or os, every other machine no
        kind; an unknown icon and an unknown terminal fall back; keys Fleet doesn't read are dropped."""
        cfg, errors = fleet_live.validate_config({"interval": "2.5", "terminal": "no-such-app", "extra": 1, "machines": [
            {"id": " nas ", "name": " nas ", "ssh": " root@nas.example.ts.net ", "os": "linux", "tile": "globe", "kind": "", "domain": "", "bogus": "x"},
            {"id": "win-desktop", "name": "win-desktop", "ssh": "me@win-desktop", "os": "windows", "tile": "spaceship", "kind": "remote", "tailscale": "win-desktop"},
            {"id": "this", "name": "this computer", "kind": "local", "ssh": "nas", "os": "linux", "tile": "laptop"},
            {"id": "app-vm", "name": "app-vm", "ssh": "app-vm", "os": "linux", "vm_on": "nas", "domain": "app_vm.1", "tile": "vm"}]})
        self.assertEqual(errors, [])
        self.assertEqual(cfg, {"interval": 2.5, "terminal": "auto", "machine": [
            {"id": "nas", "name": "nas", "ssh": "root@nas.example.ts.net", "os": "linux", "tile": "globe"},
            {"id": "win-desktop", "name": "win-desktop", "ssh": "me@win-desktop", "os": "windows", "tailscale": "win-desktop"},
            {"id": "this", "name": "this computer", "kind": "local", "tile": "laptop"},
            {"id": "app-vm", "name": "app-vm", "ssh": "app-vm", "os": "linux", "vm_on": "nas", "domain": "app_vm.1", "tile": "vm"}]})

    def test_interval_and_terminal(self):
        for data, want in (({}, (3.0, "auto")), ({"interval": 1}, (1.0, "auto")), ({"interval": 60, "terminal": "terminal"}, (60.0, "terminal")),
                           ({"terminal": "auto"}, (3.0, "auto"))):
            with self.subTest(data=data):
                cfg, errors = fleet_live.validate_config(data)
                self.assertEqual((errors, cfg), ([], {"interval": want[0], "terminal": want[1], "machine": []}))

    def test_refused(self):
        nas = {"id": "nas", "name": "nas", "ssh": "nas", "os": "linux"}
        here = {"id": "this", "name": "this computer", "kind": "local"}
        ssh_err = ["nas: SSH destination must look like host, user@host or a Tailscale name."]
        cases = [
            ({"interval": 0}, ["Refresh interval must be between 1 and 60 seconds."]),
            ({"interval": 61}, ["Refresh interval must be between 1 and 60 seconds."]),
            ({"interval": "soon"}, ["Refresh interval must be between 1 and 60 seconds."]),
            ({"machines": [dict(nas, id="")]}, ["Machine 1: id must be 1–40 letters, digits, - or _."]),
            ({"machines": [dict(nas, id="my nas")]}, ["Machine 1: id must be 1–40 letters, digits, - or _."]),
            ({"machines": [dict(nas, id="n" * 41)]}, ["Machine 1: id must be 1–40 letters, digits, - or _."]),
            ({"machines": [nas, dict(nas, name="nas2")]}, ["Machine 2: id nas is used twice."]),
            ({"machines": [dict(nas, name="")]}, ["Machine 1: give it a name (up to 80 characters)."]),
            ({"machines": [dict(nas, name="n" * 81)]}, ["Machine 1: give it a name (up to 80 characters)."]),
            ({"machines": [dict(nas, ssh="")]}, ssh_err),
            ({"machines": [dict(nas, ssh="-oProxyCommand=sh")]}, ssh_err),   # an option, not a destination
            ({"machines": [dict(nas, ssh="-Jjump.example")]}, ssh_err),
            ({"machines": [dict(nas, ssh="nas;reboot")]}, ssh_err),
            ({"machines": [dict(nas, os="")]}, ["nas: choose Linux, Windows or macOS."]),
            ({"machines": [dict(nas, os="freebsd")]}, ["nas: choose Linux, Windows or macOS."]),   # macOS is one since #181
            ({"machines": [dict(nas, domain="app vm")]}, ["nas: domain has characters Fleet can't use."]),
            ({"machines": [dict(nas, tailscale="nas$(id)")]}, ["nas: tailscale has characters Fleet can't use."]),
            ({"machines": [here, dict(here, id="this2")]}, ["Only one machine can be this computer."]),
            ({"machines": [{}]}, ["Machine 1: id must be 1–40 letters, digits, - or _.", "Machine 1: give it a name (up to 80 characters).",
                              "Machine 1: SSH destination must look like host, user@host or a Tailscale name.", "Machine 1: choose Linux, Windows or macOS."]),
        ]
        for data, want in cases:
            with self.subTest(data=data):
                self.assertEqual(fleet_live.validate_config(data)[1], want)
        with self.subTest("control: the same machines, each fixed"):
            self.assertEqual(fleet_live.validate_config({"interval": 3, "machines": [nas, here]})[1], [])


# ---------- #89: write_config writes only what it can read back ----------
class WriteConfig(SettingsWithTempConfig):
    CFG = {"interval": 2.5, "terminal": "terminal", "machine": [
        {"id": "nas", "name": "nas \"the box\" \\ ünïcode", "ssh": "root@nas.example.ts.net", "os": "linux", "tile": "globe",
         "note": {"label": "Note.", "text": "two\nlines\tand a tab"}},
        {"id": "this", "name": "this computer", "kind": "local"}]}

    def test_reads_back_exactly(self):
        fleet_live.write_config(self.path, self.CFG)
        self.assertEqual(self.read_back(), self.CFG)
        self.assertEqual(sorted(os.listdir(self.tmp.name)), ["machines.toml"], "no .bak when there was no file")

    def test_a_whole_interval_is_written_as_an_integer(self):
        fleet_live.write_config(self.path, dict(self.CFG, interval=3.0))
        with open(self.path, encoding="utf-8") as f:
            self.assertIn("\ninterval = 3\n", f.read())

    def test_the_previous_file_is_the_bak(self):
        self.write(HAND_WRITTEN)
        fleet_live.write_config(self.path, self.CFG)
        with open(self.path + ".bak", encoding="utf-8") as f:
            self.assertEqual(f.read(), HAND_WRITTEN)
        self.assertEqual(sorted(os.listdir(self.tmp.name)), ["machines.toml", "machines.toml.bak"])

    def test_never_writes_a_file_it_cant_read_back(self):
        """TOML can't hold a raw DEL character, which json.dumps leaves in: the save fails, the file stays."""
        self.write(HAND_WRITTEN)
        bad = dict(self.CFG, machine=[dict(self.CFG["machine"][1], name="this\x7fcomputer")])
        with self.assertRaises(tomllib.TOMLDecodeError):
            fleet_live.write_config(self.path, bad)
        with open(self.path, encoding="utf-8") as f:
            self.assertEqual(f.read(), HAND_WRITTEN)

    def test_a_save_it_cant_write_says_so_and_doesnt_restart(self):
        self.write(HAND_WRITTEN)
        st, r = self.save(self.serve(), {"interval": 3, "machines": [{"id": "this", "name": "this\x7fcomputer", "kind": "local"}]})
        self.assertEqual((st, r["ok"], len(r["errors"])), (200, False, 1))
        self.assertTrue(r["errors"][0].startswith("Couldn't save: "), r["errors"])
        with open(self.path, encoding="utf-8") as f:
            self.assertEqual(f.read(), HAND_WRITTEN)
        self.assertFalse(RESTARTED.wait(0.8))


# ---------- #89: config values and container names never become options ----------
class DestinationsAndNames(unittest.TestCase):
    def test_ssh_dest(self):
        ok = ["nas", "root@nas.example.ts.net", "me@192.0.2.10", "me@[2001:db8::1]", "fe80::1%en0", "win_desktop", "_x", "n" * 253]
        bad = ["", "-oProxyCommand=sh", "-Jjump.example", "-v", "-p", "--", "-", "@nas", ".nas", "[::1]", "nas -oX=y", "nas;id", "nas|id", "nas&", "$(id)", "`id`",
               "nas/x", "'nas'", "nas\tx", "n" * 254, "nаs"]
        self.assertEqual([x for x in ok + bad if fleet_live.SSH_DEST.match(x)], ok)

    def test_container_name(self):
        ok = ["web", "app-web-1", "app_web.1", "1web", "W" * 201]
        bad = ["", "-it", "--privileged", "-e", "_web", ".web", "web app", "web;id", "web$(id)", "web`id`", "a/b", "web'", "W" * 202]
        self.assertEqual([x for x in ok + bad if fleet_live.CNAME.match(x)], ok)


# ---------- #89: the argv Open terminal runs, for each kind of node ----------
SHELL = "command -v bash >/dev/null 2>&1 && exec bash || exec sh"


class TerminalTarget(unittest.TestCase):
    def setUp(self):
        f = fleet_live.Fleet.__new__(fleet_live.Fleet)
        f.lock = threading.Lock()
        f.machines = collections.OrderedDict((m["id"], fleet_live.Machine(m, 3)) for m in [
            {"id": "this", "name": "this computer", "kind": "local"},
            {"id": "nas", "name": "nas", "ssh": "root@nas.example.ts.net", "os": "linux"},
            {"id": "app-vm", "name": "app-vm", "ssh": "app-vm", "os": "linux", "vm_on": "nas"},
            {"id": "win-desktop", "name": "win-desktop", "ssh": "me@win-desktop", "os": "windows"},
            {"id": "bad", "name": "bad", "ssh": "-Jjump.example", "os": "linux"}])   # hand-written; Settings would refuse it
        node = lambda mid, conts=(), compose=(), vms=(): {"id": mid, "containers": list(conts), "compose": list(compose), "vms": list(vms)}
        f.specs = {
            "this": node("this", [{"id": "this/containers/db", "cname": "db"}]),
            "nas": node("nas", [{"id": "nas/containers/opt", "cname": "-e"}],
                        [{"id": "nas/compose/app", "services": [{"id": "nas/compose/app/web", "cname": "app-web-1"}]}],
                        [node("app-vm", [{"id": "app-vm/containers/cache", "cname": "cache"}])]),
            "win-desktop": node("win-desktop", [{"id": "win-desktop/containers/web", "cname": "web"}]),
            "bad": node("bad", [{"id": "bad/containers/x", "cname": "x"}])}
        self.fleet = f

    def test_each_kind_of_node(self):
        want = {
            "this": (None, "this computer"),
            "nas": (["ssh", "root@nas.example.ts.net"], "nas"),
            "app-vm": (["ssh", "app-vm"], "app-vm"),
            "win-desktop": (["ssh", "me@win-desktop"], "win-desktop"),
            "this/containers/db": (["docker", "exec", "-it", "db", "sh", "-c", SHELL], "db"),
            "nas/compose/app/web": (["ssh", "-t", "root@nas.example.ts.net", "docker exec -it app-web-1 sh -c '%s'" % SHELL], "app-web-1 on nas"),
            "app-vm/containers/cache": (["ssh", "-t", "app-vm", "docker exec -it cache sh -c '%s'" % SHELL], "cache on app-vm"),
            "win-desktop/containers/web": (["ssh", "-t", "me@win-desktop", "docker exec -it web sh"], "web on win-desktop"),
        }
        self.assertEqual({n: fleet_live.terminal_target(self.fleet, n) for n in want}, want)

    def test_refused(self):
        for node, msg in (("bad", "bad has no SSH destination."), ("bad/containers/x", "bad has no SSH destination."),
                          ("nas/containers/opt", "Fleet doesn't know that container's name."),
                          ("nas/compose/app", "That isn't something Fleet can open a terminal to."),
                          ("nas/base", "That isn't something Fleet can open a terminal to."), ("", "That isn't something Fleet can open a terminal to.")):
            with self.subTest(node=node):
                with self.assertRaises(ValueError) as e:
                    fleet_live.terminal_target(self.fleet, node)
                self.assertEqual(str(e.exception), msg)


# ---------- #89: when Test connection says Connected ----------
class FakeSsh(NoProcesses):
    def __init__(self, out=b"", timeout=False):
        self.out, self.timeout, self.calls = out, timeout, []

    def run(self, argv, **kw):
        self.calls.append(argv)
        if self.timeout:
            raise subprocess.TimeoutExpired(argv, 25)
        return subprocess.CompletedProcess(argv, 0, self.out)


LINUX_PROBE = "echo FLEET_OK; uname -sr; command -v python3 || echo 'python3: not found'"
WIN_PROBE = "powershell -NoProfile -NonInteractive -Command \"'FLEET_OK'; $PSVersionTable.PSVersion.ToString(); (Get-CimInstance Win32_OperatingSystem).Caption\""


class TestConnection(unittest.TestCase):
    def probe(self, dest, os_name, **fake):
        ssh = FakeSsh(**fake)
        fleet_live.subprocess = ssh
        try:
            return fleet_live.test_connection(dest, os_name), ssh.calls
        finally:
            fleet_live.subprocess = NoProcesses()

    def test_results(self):
        cases = [
            (("nas", "linux"), {"out": b"FLEET_OK\r\nLinux 6.6.0\r\n/usr/bin/python3\r\n"},
             {"ok": True, "output": "Linux 6.6.0\n/usr/bin/python3"}, LINUX_PROBE),
            (("nas", "linux"), {"out": b"FLEET_OK\nLinux 6.6.0\npython3: not found\n"},
             {"ok": False, "output": "Linux 6.6.0\npython3: not found"}, LINUX_PROBE),
            (("nas", "linux"), {"out": b"root@nas: Permission denied (publickey).\n"},
             {"ok": False, "output": "root@nas: Permission denied (publickey)."}, LINUX_PROBE),
            (("nas", "linux"), {"timeout": True}, {"ok": False, "output": "No answer within 25 seconds."}, LINUX_PROBE),
            (("me@win-desktop", "windows"), {"out": b"FLEET_OK\r\n5.1.22621\r\nMicrosoft Windows 11 Pro\r\n"},
             {"ok": True, "output": "5.1.22621\nMicrosoft Windows 11 Pro"}, WIN_PROBE),
            (("me@win-desktop", "windows"), {"out": b"Connection timed out\r\n"}, {"ok": False, "output": "Connection timed out"}, WIN_PROBE),
            (("nas", "linux"), {"out": b"FLEET_OK\n" + b"x" * 1000}, {"ok": True, "output": "x" * 600}, LINUX_PROBE),
        ]
        for (dest, os_name), fake, want, remote in cases:
            with self.subTest(dest=dest, fake=fake):
                self.assertEqual(self.probe(dest, os_name, **fake), (want, [["ssh"] + fleet_live.SSH_MARK + [dest, remote]]))

    def test_an_option_is_never_run(self):
        for dest in ("-oProxyCommand=sh", "-Jjump.example", "", "nas;id"):
            with self.subTest(dest=dest):
                self.assertEqual(self.probe(dest, "linux", out=b"FLEET_OK\n"),
                                 ({"ok": False, "output": "That doesn't look like an SSH destination."}, []))


# ---------- #89: the POST gate and the size limits ----------
POSTS = {   # a body each endpoint takes
    "/api/config": {"interval": 3, "machines": [{"id": "nas", "name": "nas", "ssh": "nas", "os": "linux"}]},
    "/api/test": {"ssh": "nas", "os": "linux"},
    "/api/terminal": {"node": "nas"},
    "/api/prefs": {"theme": "fleet"},
    "/api/tilepins": {"nas": ["cpu"]},
    "/api/retry": {"machine": "nas"},
    "/api/pins": ["nas"],
}


class WithServer(SettingsWithTempConfig):
    """Fleet's handler with pins, tile pins and prefs in the temp dir, and Test connection and Open terminal
    replaced with recorders."""
    def setUp(self):
        super().setUp()
        self.calls = []
        for name, val in (("PINS_PATH", "pins.json"), ("TILEPINS_PATH", "tilepins.json"), ("PREFS_PATH", "ui.json")):
            self.addCleanup(setattr, fleet_live, name, getattr(fleet_live, name))
            setattr(fleet_live, name, os.path.join(self.tmp.name, val))
        for name, fake in (("test_connection", lambda dest, os_name: self.calls.append(("test", dest, os_name)) or {"ok": True, "output": ""}),
                           ("open_terminal", lambda choice, argv, title: self.calls.append(("terminal", argv, title)) or "Terminal")):
            self.addCleanup(setattr, fleet_live, name, getattr(fleet_live, name))
            setattr(fleet_live, name, fake)
        self.write('interval = 3\n\n[[machine]]\nid = "nas"\nname = "nas"\nssh = "nas"\nos = "linux"\n')
        self.srv = self.serve()

    def files(self):
        return sorted(os.listdir(self.tmp.name))


class WriteGate(WithServer):
    def bad_requests(self):
        p = self.srv.port
        return {"no X-Fleet": {"X_Fleet": None}, "X-Fleet: 0": {"X_Fleet": "0"},
                "another site": {"Origin": "http://evil.example"}, "another port": {"Origin": "http://127.0.0.1:%d" % (p + 1)},
                "a sandboxed page": {"Origin": "null"}, "https": {"Origin": "https://127.0.0.1:%d" % p},
                "DNS rebinding": {"Host": "evil.example:%d" % p}, "no Host": {"Host": ""}, "another Host port": {"Host": "127.0.0.1:%d" % (p + 1)},
                "no Origin, no X-Fleet": {"Origin": None, "X_Fleet": None}}

    def test_every_write_is_refused_from_anywhere_else(self):
        for path, body in POSTS.items():
            for why, headers in self.bad_requests().items():
                with self.subTest(path=path, why=why):
                    self.assertEqual(self.srv.req("POST", path, body, **headers)[0], 403)
        self.assertEqual(self.files(), ["machines.toml"], "nothing was written")
        self.assertEqual(self.calls, [], "nothing was tested or opened")
        self.assertFalse(self.srv.srv.RequestHandlerClass.fleet.machines["nas"].wake.is_set(), "nothing was retried")
        self.assertFalse(RESTARTED.wait(0.8))

    def test_reads_need_the_right_host(self):
        p = self.srv.port
        for path in ("/api/config", "/api/fleet", "/api/pins", "/"):
            with self.subTest(path=path):
                self.assertEqual(self.srv.req("GET", path, Host="evil.example:%d" % p)[0], 403)
                self.assertEqual(self.srv.req("GET", path, Host="127.0.0.1:%d" % (p + 1))[0], 403)
        self.assertEqual(self.srv.req("GET", "/api/config")[0], 200)
        self.assertEqual(self.srv.req("GET", "/api/config", Host="localhost:%d" % p)[0], 200)

    def test_control_fleets_own_page_gets_through(self):
        p = self.srv.port
        want = {"/api/test": {"ok": True, "output": ""}, "/api/terminal": {"ok": True, "terminal": "Terminal", "title": "nas"},
                "/api/prefs": {"prefs": {"theme": "fleet"}}, "/api/tilepins": {"tilepins": {"nas": ["cpu"]}},
                "/api/retry": {"ok": True}, "/api/pins": {"pins": ["nas"]}}
        got = {path: self.srv.req("POST", path, POSTS[path]) for path in want}
        self.assertEqual(got, {k: (200, v) for k, v in want.items()})
        self.assertEqual(self.srv.req("POST", "/api/pins", ["app-vm"], Host="localhost:%d" % p, Origin="http://localhost:%d" % p), (200, {"pins": ["app-vm"]}))
        self.assertEqual(self.srv.req("POST", "/api/pins", ["nas"], Origin=None), (200, {"pins": ["nas"]}), "no Origin (not a page) still passes with X-Fleet")
        self.assertEqual(self.calls, [("test", "nas", "linux"), ("terminal", ["ssh", "nas"], "nas")])
        self.assertEqual(self.save(self.srv, POSTS["/api/config"]), (200, {"ok": True}))
        self.assertEqual(self.files(), ["machines.toml", "machines.toml.bak", "pins.json", "tilepins.json", "ui.json"])


class SizeLimits(WithServer):
    def post(self, path, body):
        return self.srv.req("POST", path, body)[0]

    def test_pins(self):
        pins = ["nas/compose/app%d" % i for i in range(41)]
        self.assertEqual(self.srv.req("POST", "/api/pins", pins), (200, {"pins": pins[:40]}), "the first 40 are kept")
        with open(fleet_live.PINS_PATH) as f:
            self.assertEqual(json.load(f), pins[:40], "and only they are saved")
        self.assertEqual(self.srv.req("POST", "/api/pins", ["n" * 299]), (200, {"pins": ["n" * 299]}))
        for body in (["n" * 300], {"pins": ["nas"]}, [1], ["nas", None], b"not json"):
            with self.subTest(body=body):
                self.assertEqual(self.post("/api/pins", body), 400)
        self.assertEqual(fleet_live.load_pins(), ["n" * 299], "a refused write changes nothing")

    def test_tile_pins(self):
        ok = {"m%d" % i: ["cpu"] for i in range(500)}
        self.assertEqual(self.srv.req("POST", "/api/tilepins", ok), (200, {"tilepins": ok}))
        self.assertEqual(self.srv.req("POST", "/api/tilepins", {"nas": ["t%d" % i for i in range(200)], "empty": [], "k" * 250: ["v" * 250]}),
                         (200, {"tilepins": {"nas": ["t%d" % i for i in range(200)], "k" * 200: ["v" * 200]}}), "empty lists go, long names are cut to 200")
        for body in (dict(ok, m500=["cpu"]), {"nas": ["t%d" % i for i in range(201)]}, {"nas": "cpu"}, ["nas"]):
            with self.subTest(body=str(body)[:60]):
                self.assertEqual(self.post("/api/tilepins", body), 400)
        self.assertEqual(fleet_live.load_tilepins(), {"nas": ["t%d" % i for i in range(200)], "k" * 200: ["v" * 200]})

    def test_prefs(self):
        big = {"x": "a" * (65536 - len(json.dumps({"x": ""})))}   # exactly 64 KiB as JSON
        self.assertEqual(self.srv.req("POST", "/api/prefs", big), (200, {"prefs": big}))
        for body in ({"x": "a" * (65537 - len(json.dumps({"x": ""})))}, ["theme"], "fleet", 3):   # one byte over
            with self.subTest(body=str(body)[:40]):
                self.assertEqual(self.post("/api/prefs", body), 400)
        self.assertEqual(fleet_live.load_prefs(), big)


if __name__ == "__main__":
    unittest.main()
