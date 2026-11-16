# SPDX-License-Identifier: GPL-3.0-or-later
"""Which machines Fleet connects to: every SSH machine can be turned off and on by hand, and 'Connect
automatically' (All, None, or a saved set of machines) decides which ones Fleet connects to when it
starts, so a start at login doesn't open sessions (or ask for keys) you didn't want. This computer is
always on: it needs no SSH."""
import importlib.util, json, os, sys, tempfile, threading, time, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)
argv, sys.argv = sys.argv, ["fleet_live.py"]
try:
    spec = importlib.util.spec_from_file_location("fleet_live_connect_test", os.path.join(LIVE, "fleet_live.py"))
    fl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fl)
finally:
    sys.argv = argv

LOCAL = {"id": "here", "name": "here", "kind": "local"}
A = {"id": "a", "name": "a", "ssh": "a", "os": "linux"}
B = {"id": "b", "name": "b", "ssh": "b", "os": "linux"}


def wait_for(cond, secs=5):
    end = time.time() + secs
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.05)
    return False


class AtStart(unittest.TestCase):
    def test_all_none_or_a_saved_set_and_this_computer_always(self):
        presets = {"lab": ["b"]}
        at = lambda auto, cfg, off=(): fl.connects_at_start(cfg, {"auto": auto, "presets": presets}, off)
        self.assertEqual([at("all", c) for c in (LOCAL, A, B)], [True, True, True])
        self.assertEqual([at("none", c) for c in (LOCAL, A, B)], [True, False, False])
        self.assertEqual([at("lab", c) for c in (LOCAL, A, B)], [True, False, True])
        # turned off by hand before Fleet restarted itself (settings saved, an update): still off
        self.assertEqual([at("all", c, {"a"}) for c in (LOCAL, A, B)], [True, False, True])
        # a restart Fleet does itself keeps every machine connected but those turned off, whatever Auto says (#224),
        # and connects one just added
        restart = lambda auto, cfg, off=(): fl.connects_at_start(cfg, {"auto": auto, "presets": presets}, off, restarted=True)
        self.assertEqual([restart("none", c, {"a"}) for c in (LOCAL, A, B)], [True, False, True])
        self.assertEqual([restart("lab", c) for c in (LOCAL, A, B)], [True, True, True])

    def test_the_setting_file_is_read_defensively(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "connect.json")
            old, fl.CONNECT_PATH = fl.CONNECT_PATH, path
            try:
                self.assertEqual(fl.load_connect(), {"auto": "all", "presets": {}})
                with open(path, "w") as f:
                    json.dump({"auto": "gone", "presets": {"lab": ["b", 3], "bad": "x"}}, f)
                self.assertEqual(fl.load_connect(), {"auto": "all", "presets": {"lab": ["b", "3"]}})
            finally:
                fl.CONNECT_PATH = old


class ByHand(unittest.TestCase):
    def test_off_ends_its_own_session_and_keeps_it_closed_on_starts_it_again(self):
        m = fl.Machine(A, 3)
        started = []
        def cmd():
            started.append(time.time())
            return ["sleep", "30"], None   # a session that stays open, like ssh streaming readings
        m.ssh_cmd = cmd
        m.thread.start()
        self.assertTrue(wait_for(lambda: m.proc is not None and m.proc.poll() is None), "connected")
        p = m.proc
        self.assertTrue(m.turn(False))
        self.assertTrue(wait_for(lambda: p.poll() is not None), "its session ended")
        self.assertTrue(wait_for(lambda: m.status == "disabled"), m.status)
        time.sleep(0.3)
        self.assertEqual(len(started), 1, "and it stays closed")
        self.assertTrue(m.turn(True))
        self.assertTrue(wait_for(lambda: len(started) == 2 and m.proc.poll() is None), "connected again")
        m.turn(False)
        self.assertTrue(wait_for(lambda: m.proc.poll() is not None))

    def test_this_computer_has_no_switch(self):
        self.assertFalse(fl.Machine(LOCAL, 3).turn(False))


class Api(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.old, fl.CONNECT_PATH = fl.CONNECT_PATH, os.path.join(self.dir.name, "connect.json")
        self.f = fl.Fleet.__new__(fl.Fleet)
        self.f.machines = {"here": fl.Machine(LOCAL, 3), "a": fl.Machine(A, 3), "b": fl.Machine(B, 3)}
        self.f.machines["a"].on.clear()   # a is off now; here and b are on

    def tearDown(self):
        fl.CONNECT_PATH = self.old
        self.dir.cleanup()

    def test_save_what_is_connected_now_as_a_set_pick_it_and_delete_it(self):
        r = self.f.api_connect({"save": "Lab boxes"})
        self.assertEqual(r["connect"], {"auto": "Lab boxes", "presets": {"Lab boxes": ["b"]}, "starts": ["here", "b"]})
        self.assertEqual(self.f.api_connect({"auto": "none"})["connect"]["starts"], ["here"])
        self.assertEqual(self.f.api_connect({"auto": "nope"})["ok"], False)
        self.assertEqual(self.f.api_connect({"save": "All"})["ok"], False)   # All and None are taken
        r = self.f.api_connect({"auto": "Lab boxes"})
        self.assertEqual(r["connect"]["auto"], "Lab boxes")
        r = self.f.api_connect({"delete": "Lab boxes"})
        self.assertEqual(r["connect"], {"auto": "all", "presets": {}, "starts": ["here", "a", "b"]})
        with open(fl.CONNECT_PATH) as f:
            self.assertEqual(json.load(f), {"auto": "all", "presets": {}})

    def test_save_a_set_of_machines_ticked_by_hand(self):
        r = self.f.api_connect({"save": "Picked", "machines": ["a", "here", "zzz"]})   # a is off now: it can still be picked
        self.assertEqual((r["ok"], r["connect"]["presets"], r["connect"]["auto"]), (True, {"Picked": ["a"]}, "Picked"))
        self.assertEqual(r["connect"]["starts"], ["here", "a"])

    def test_turning_a_machine_on_or_off(self):
        self.assertEqual(self.f.api_connect({"machine": "b", "on": False})["ok"], True)
        self.assertFalse(self.f.machines["b"].on.is_set())
        self.assertEqual(self.f.api_connect({"machine": "zzz", "on": True})["ok"], False)
        self.assertEqual(self.f.api_connect({"machine": "here", "on": False})["ok"], False)


if __name__ == "__main__":
    unittest.main()
