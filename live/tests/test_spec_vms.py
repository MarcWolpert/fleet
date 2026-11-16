# SPDX-License-Identifier: GPL-3.0-or-later
"""How /api/fleet's machine specs carry VMs: a nested VM (one in machines.toml with vm_on) is its own
machine with its own tree, measured from inside it, and also says what its host sees of it (hostside),
measured from the host side, with history, so the UI counts the VM in its host's totals from the host side.

Views are hand-made, shaped like derive_linux()'s output. Nothing is read from a machine.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import os
import sys
import threading
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import fleet_live as fl  # noqa: E402

H = fl.H


def view(host, cap, containers=(), vms=(), jobs=(), gpus=()):
    """A derived view: host usage [cpu cores, mem GB, gpu %, disk MB/s, net MB/s] and what runs there."""
    return {"os": "Linux", "arch": "x86_64", "cpu_model": "test", "uptime": 60, "ncpu": cap[0], "cap": list(cap), "host": list(host),
            "gpus": list(gpus), "groups": [], "containers": list(containers), "vms": list(vms), "jobs": list(jobs), "procs": [],
            "lcpus": [], "ifs": [], "disks": []}


def fleet(*machines):
    f = fl.Fleet.__new__(fl.Fleet)
    f.machines = {m.id: m for m in machines}
    f.lock = threading.Lock()
    f.interval = 3
    return f


def machine(cfg, v):
    m = fl.Machine(cfg, 3)
    m.view, m.status = v, ("ok" if v is not None else "offline")
    return m


def last(h):
    return {k: s[-1] for k, s in h.items()}


class NestedVm(unittest.TestCase):
    def setUp(self):
        fl.HIST.d.clear()

    def spec(self, vm_view):
        # the host uses 40 GB and 10 cores in all; the hypervisor sees its VM use 32 GB and 4 cores
        host = machine({"id": "host", "name": "lab-host"}, view([10, 40, 0, 20, 5], [16, 64, 0, 500, 125],
                       vms=[{"name": "vm1", "u": [4, 32, 0, 6, 2], "running": True, "ifs": [], "cpus": ""}]))
        vm = machine({"id": "vm1", "name": "vm1", "vm_on": "host"}, vm_view)
        f = fleet(host, vm)
        for _ in range(3):   # three readings: history, not one value
            s = f.machine_spec(host, record=True)
        return s

    def test_a_reachable_nested_vm_says_what_its_host_sees_of_it_with_history(self):
        s = self.spec(view([1.5, 6, 0, 1, 1], [4, 32, 0, 500, 125]))
        self.assertEqual([v["id"] for v in s["vms"]], ["vm1"])
        vm = s["vms"][0]
        self.assertEqual(sorted(vm["hostside"]), ["cpu", "disk", "gpu", "mem", "net"])
        self.assertEqual({k: len(x) for k, x in vm["hostside"].items()}, {k: H for k in fl.METRICS})
        self.assertEqual({k: x[-3:] for k, x in vm["hostside"].items()},
                         {"cpu": [4, 4, 4], "mem": [32, 32, 32], "gpu": [0, 0, 0], "disk": [6, 6, 6], "net": [2, 2, 2]})
        # its own tree is measured from inside it
        self.assertEqual(last(vm["base"]["h"]), {"cpu": 1.5, "mem": 6, "gpu": 0, "disk": 1, "net": 1})
        # and the host's Base system is what's left after the host-side figure
        self.assertEqual(last(s["base"]["h"]), {"cpu": 6, "mem": 8, "gpu": 0, "disk": 14, "net": 3})

    def test_an_unreachable_nested_vm_is_seen_from_its_host(self):
        s = self.spec(None)
        vm = s["vms"][0]
        self.assertEqual(vm["status"], "hostonly")
        self.assertEqual(last(vm["hostside"]), {"cpu": 4, "mem": 32, "gpu": 0, "disk": 6, "net": 2})
        self.assertEqual(last(vm["base"]["h"]), {"cpu": 4, "mem": 32, "gpu": 0, "disk": 6, "net": 2})

    def test_a_vm_not_in_the_config_is_only_what_the_host_sees(self):
        host = machine({"id": "host", "name": "lab-host"}, view([10, 40, 0, 20, 5], [16, 64, 0, 500, 125],
                       vms=[{"name": "other", "u": [4, 32, 0, 6, 2], "running": True, "ifs": [], "cpus": ""}]))
        s = fleet(host).machine_spec(host, record=True)
        self.assertEqual([v["id"] for v in s["vms"]], ["host/vms/other"])
        self.assertNotIn("hostside", s["vms"][0])
        self.assertEqual(last(s["vms"][0]["base"]["h"]), {"cpu": 4, "mem": 32, "gpu": 0, "disk": 6, "net": 2})


class WhatTheHostCannotSee(unittest.TestCase):
    """A host that can't measure some of a VM's figures says which it measured (measured: positions in METRICS): a
    Mac sees its VMs' CPU and memory but not their disk or network, WSL's host has no network for it. There the
    VM's share of its host is what the guest itself reports, and the host's Base system is what's left (#300)."""

    def setUp(self):
        fl.HIST.d.clear()

    def spec(self, measured, guest_status="ok", guest=True):
        # the host does 20 MB/s of disk and 5 of network in all; inside, the VM does 1.5 cores, 6 GB, 8 MB/s and 3 MB/s
        vm_entry = {"name": "vm1", "u": [4, 32, 0, 0, 0], "running": True, "ifs": [], "cpus": ""}
        if measured != "absent":
            vm_entry["measured"] = measured
        host = machine({"id": "host", "name": "lab-host"}, view([10, 40, 0, 20, 5], [16, 64, 0, 500, 125], vms=[vm_entry]))
        vm = machine({"id": "vm1", "name": "vm1", "vm_on": "host"}, view([1.5, 6, 0, 8, 3], [4, 32, 0, 500, 125]) if guest else None)
        vm.status = guest_status if guest else vm.status
        s = fleet(host, vm).machine_spec(host, record=True)
        return last(s["vms"][0]["hostside"]), last(s["base"]["h"])

    def test_a_macs_vm_takes_its_disk_and_network_from_inside(self):
        self.assertEqual(self.spec([0, 1]), ({"cpu": 4, "mem": 32, "gpu": 0, "disk": 8, "net": 3}, {"cpu": 6, "mem": 8, "gpu": 0, "disk": 12, "net": 2}))

    def test_wsls_takes_only_its_network_from_inside(self):
        self.assertEqual(self.spec([0, 1, 2, 3]), ({"cpu": 4, "mem": 32, "gpu": 0, "disk": 0, "net": 3}, {"cpu": 6, "mem": 8, "gpu": 0, "disk": 20, "net": 2}))

    def test_a_host_that_measures_everything_control(self):
        for measured in ([0, 1, 2, 3, 4], "absent", "garbage", {"0": 1}):
            with self.subTest(measured=measured):
                hs, base = self.spec(measured)
                self.assertEqual(hs, {"cpu": 4, "mem": 32, "gpu": 0, "disk": 0, "net": 0})
        # a list names what was measured; what isn't a position in it names nothing
        self.assertEqual(self.spec([True, "3", None, 1])[0], {"cpu": 1.5, "mem": 32, "gpu": 0, "disk": 8, "net": 3})

    def test_a_guest_that_isnt_live_leaves_the_hosts_figures_control(self):
        for status in ("offline", "connecting", "disabled"):
            with self.subTest(status=status):
                self.assertEqual(self.spec([0, 1], guest_status=status)[0], {"cpu": 4, "mem": 32, "gpu": 0, "disk": 0, "net": 0})
        self.assertEqual(self.spec([0, 1], guest=False)[0], {"cpu": 4, "mem": 32, "gpu": 0, "disk": 0, "net": 0})


if __name__ == "__main__":
    unittest.main()
