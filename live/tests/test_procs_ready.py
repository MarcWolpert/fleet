# SPDX-License-Identifier: GPL-3.0-or-later
"""A machine's process list says whether it is a fresh reading. After Fleet restarts, each machine's last
reading comes back at once, but without its processes (the state file leaves them out), so until the
first new reading the list is 'not ready', not 'no processes': the page keeps what it shows instead of
flashing empty."""
import importlib.util, json, os, sys, tempfile, time, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)
argv, sys.argv = sys.argv, ["fleet_live.py"]
try:
    spec = importlib.util.spec_from_file_location("fleet_live_ready_test", os.path.join(LIVE, "fleet_live.py"))
    fl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fl)
finally:
    sys.argv = argv


class Ready(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.old, fl.STATE_PATH = fl.STATE_PATH, os.path.join(self.dir.name, "state.json")
        self.m = fl.Machine({"id": "rdy", "name": "rdy", "ssh": "rdy", "os": "linux"}, 3)
        self.f = fl.Fleet.__new__(fl.Fleet)
        self.f.machines = {"rdy": self.m}
        self.f.specs = {"rdy": {"id": "rdy", "vms": [], "procs_owner": {"cont": {}, "vm": {}}}}
        self.f.lock = fl.threading.Lock()

    def tearDown(self):
        fl.STATE_PATH = self.old
        self.dir.cleanup()

    def test_restored_then_read(self):
        self.assertEqual(self.f.api_procs("rdy")["ready"], False)          # connecting, nothing read yet
        with open(fl.STATE_PATH, "w") as f:
            json.dump({"t": time.time(), "views": {"rdy": {"view": {"procs": [], "os": "Linux"}, "last_ok": time.time()}}, "hist": {}}, f)
        fl.load_state(self.f)
        self.assertEqual(self.f.api_procs("rdy"), {"procs": [], "ready": False})   # last reading back, its processes not yet
        self.m.got({"procs": [], "os": "Linux", "t": time.time()})
        r = self.f.api_procs("rdy")
        self.assertEqual((r["procs"], r["ready"]), ([], True))                       # read: really none

    def test_a_machine_turned_off_has_none(self):
        self.m.on.clear()
        self.m.status = "disabled"
        self.assertEqual(self.f.api_procs("rdy"), {"procs": [], "ready": True})


if __name__ == "__main__":
    unittest.main()
