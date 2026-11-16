# SPDX-License-Identifier: GPL-3.0-or-later
"""A VM's memory, seen from its host and from inside.

On its host, a VM costs what the host gives it: its QEMU process's resident memory (what htop and the
hypervisor's own UI count), not what the guest says it uses. And a guest whose balloon is inflated with
deflate-on-OOM keeps the balloon inside MemTotal and counts it as used, so the guest's own reading has
to leave the balloon out of both."""
import ast, importlib.util, os, re, sys, unittest

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


def collector_fn(name):
    """One function from collect_linux.py (which starts reading the moment it is imported)."""
    src = open(os.path.join(LIVE, "collect_linux.py"), encoding="utf-8").read()
    node = next(n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == name)
    ns = {"re": re}
    exec(ast.get_source_segment(src, node), ns)
    return ns[name]


KB, GIB = 1024, 1024 ** 3
# A guest with 256 GiB at most and 92 GiB now: the host inflated its balloon by 164 GiB (deflate-on-OOM on).
MEMINFO = "MemTotal:       263895004 kB\nMemFree:        20821692 kB\nMemAvailable:   24421508 kB\nCached:         25160152 kB\n"
VMSTAT = "nr_free_pages 5205423\nnr_balloon_pages 42991616\nballoon_inflate 50331648\nballoon_deflate 7340032\n"
DEFLATE_ON_OOM = "0110010000000000000000000000010010000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000\n"
NO_DEFLATE = "0100010000000000000000000000010010000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000\n"


class InsideTheGuest(unittest.TestCase):
    def test_a_balloon_kept_inside_memtotal_is_not_the_guests(self):
        total, avail = collector_fn("guest_mem")(MEMINFO, VMSTAT, [DEFLATE_ON_OOM], 4096)
        self.assertEqual((total, avail), (263895004 * KB - 42991616 * 4096, 24421508 * KB))
        self.assertEqual(round((total - avail) / GIB, 1), 64.4)   # what it really uses, of the 87.7 GiB it has

    def test_without_deflate_on_oom_the_kernel_already_took_the_balloon_out(self):
        self.assertEqual(collector_fn("guest_mem")(MEMINFO, VMSTAT, [NO_DEFLATE], 4096), [263895004 * KB, 24421508 * KB])

    def test_no_balloon(self):
        self.assertEqual(collector_fn("guest_mem")(MEMINFO, "nr_free_pages 1\n", [], 4096), [263895004 * KB, 24421508 * KB])


if __name__ == "__main__":
    unittest.main()
