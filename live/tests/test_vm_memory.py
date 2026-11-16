# SPDX-License-Identifier: GPL-3.0-or-later
"""A VM's memory, seen from its host and from inside.

On its host, a VM costs what the host gives it: its QEMU process's resident memory (what htop and the
hypervisor's own UI count), not what the guest says it uses. And a guest whose balloon is inflated with
deflate-on-OOM keeps the balloon inside MemTotal and counts it as used, so the guest's own reading has
to leave the balloon out of both."""
import importlib.util, os, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)
argv, sys.argv = sys.argv, ["fleet_live.py"]
try:
    spec = importlib.util.spec_from_file_location("fleet_live_vm_test", os.path.join(LIVE, "fleet_live.py"))
    fl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fl)
finally:
    sys.argv = argv


def view(used_gb, vms=()):
    return {"os": "Linux", "arch": "x86_64", "cpu_model": "", "uptime": 0, "cap": [8, 64.0, 0, 500, 125], "gpus": [], "ncpu": 8, "groups": [],
            "host": [1.0, used_gb, 0.0, 0.0, 0.0], "containers": [], "vms": list(vms), "jobs": []}


class OnItsHost(unittest.TestCase):
    def test_a_vm_under_its_host_carries_what_the_host_gives_it_as_a_history(self):
        host = fl.Machine({"id": "vmt-host", "name": "host", "ssh": "host", "os": "linux"}, 3)
        guest = fl.Machine({"id": "vmt-guest", "name": "guest", "ssh": "guest", "os": "linux", "vm_on": "vmt-host", "domain": "guest-domain"}, 3)
        host.view = view(20.0, [{"name": "guest-domain", "u": [0.5, 6.0, 0.0, 0.1, 0.2], "running": True, "ifs": [], "cpus": ""}])
        guest.view = view(40.0)
        f = fl.Fleet.__new__(fl.Fleet)
        f.machines = {"vmt-host": host, "vmt-guest": guest}
        sub = f.machine_spec(host, record=True)["vms"][0]
        self.assertEqual(sub["id"], "vmt-guest")
        self.assertEqual({k: v[-1] for k, v in sub["hostside"].items()}, {"cpu": 0.5, "mem": 6.0, "gpu": 0.0, "disk": 0.1, "net": 0.2})
        self.assertEqual(len(sub["hostside"]["mem"]), fl.H)


if __name__ == "__main__":
    unittest.main()
