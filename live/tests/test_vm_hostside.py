# SPDX-License-Identifier: GPL-3.0-or-later
"""#98: a VM's share of its host is measured from the host side. For a VM in machines.toml that runs its
own collector, the host's Base system leaves out what the host sees of that VM (its QEMU process), so
the spec sends that host-side view as history (`hostside`) next to the VM's own tree from inside it.

Views are shaped like derive_linux()'s output; no machine is read.
Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import collections
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import fleet_live  # noqa: E402


def view(host, cap, vms=()):
    """A derived reading: `host` is the machine's own [cpu cores, mem GB, gpu %, disk MB/s, net MB/s]."""
    return {"os": "Linux", "arch": "x86_64", "cpu_model": "test", "uptime": 60, "cap": cap, "gpus": [], "ncpu": cap[0], "groups": [],
            "host": host, "containers": [], "vms": list(vms), "jobs": [], "lcpus": [], "ifs": [], "disks": []}


def fleet(*machines):
    f = fleet_live.Fleet.__new__(fleet_live.Fleet)
    f.machines = collections.OrderedDict((m.id, m) for m in machines)
    return f


def machine(cfg, v):
    m = fleet_live.Machine(cfg, 3)
    m.view, m.status = v, "ok" if v else "offline"
    return m


def last(h):
    return {k: v[-1] for k, v in h.items()}


class NestedVmHostSide(unittest.TestCase):
    # A 64 GB host using 40 GB, 16 GB of it the QEMU process of "guest", which says it uses 6 GB of its own 16.
    SEEN = [1.5, 16.0, 0.0, 0.2, 0.1]   # what the host sees of the guest

    def spec(self, host_id, guest_view, extra_vms=()):
        h = machine({"id": host_id, "name": host_id}, view([3.5, 40.0, 0.0, 0.5, 0.3], [16, 64, 0, 500, 125],
                                                           [{"name": "guest", "u": list(self.SEEN), "running": True, "ifs": []}] + list(extra_vms)))
        g = machine({"id": host_id + "-guest", "name": "guest", "vm_on": host_id, "domain": "guest"}, guest_view)
        return fleet(h, g).machine_spec(h, record=True)

    def test_a_vm_with_its_own_collector_carries_the_host_side_view_as_history(self):
        s = self.spec("hs1", view([0.5, 6.0, 0.0, 0.1, 0.05], [4, 16, 0, 500, 125]))
        vm = s["vms"][0]
        self.assertEqual(last(s["base"]["h"]), {"cpu": 2.0, "mem": 24.0, "gpu": 0.0, "disk": 0.3, "net": 0.2}, "Base leaves out the host-side view")
        self.assertEqual(last(vm["base"]["h"]), {"cpu": 0.5, "mem": 6.0, "gpu": 0.0, "disk": 0.1, "net": 0.05}, "the VM's own tree is from inside it")
        self.assertIsInstance(vm.get("hostside"), dict)
        self.assertEqual({k: len(v) for k, v in vm["hostside"].items()}, {k: fleet_live.H for k in fleet_live.METRICS})
        self.assertEqual(last(vm["hostside"]), dict(zip(fleet_live.METRICS, self.SEEN)))
        self.assertEqual(vm["hostside"]["mem"][:-1], [0.0] * (fleet_live.H - 1), "one reading so far")

    def test_an_unreachable_nested_vm_shows_what_its_host_sees_both_ways(self):
        s = self.spec("hs2", None)
        vm = s["vms"][0]
        self.assertEqual(vm["status"], "hostonly")
        self.assertEqual(last(vm["base"]["h"]), dict(zip(fleet_live.METRICS, self.SEEN)))
        self.assertEqual(last(vm["hostside"]), dict(zip(fleet_live.METRICS, self.SEEN)))

    def test_a_vm_only_the_host_sees_has_no_second_view(self):
        other = {"name": "other", "u": [0.25, 2.0, 0.0, 0.0, 0.0], "running": True, "ifs": []}
        s = self.spec("hs3", view([0.5, 6.0, 0.0, 0.1, 0.05], [4, 16, 0, 500, 125]), [other])
        self.assertEqual([v["name"] for v in s["vms"]], ["guest", "other"])
        self.assertNotIn("hostside", s["vms"][1])
        self.assertEqual(last(s["vms"][1]["base"]["h"]), {"cpu": 0.25, "mem": 2.0, "gpu": 0.0, "disk": 0.0, "net": 0.0})
        self.assertEqual(last(s["base"]["h"])["mem"], 22.0, "Base leaves out both VMs as the host sees them")


if __name__ == "__main__":
    unittest.main()
