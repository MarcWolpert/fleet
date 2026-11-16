# SPDX-License-Identifier: GPL-3.0-or-later
"""A VM's memory, seen from its host and from inside.

On its host, a VM costs what the host gives it: its QEMU process's resident memory (what htop counts) and its
huge pages (which htop leaves out), not what the guest says it uses. And a guest whose balloon is inflated with
deflate-on-OOM keeps the balloon inside MemTotal and counts it as used, so the guest's own reading has
to leave the balloon out of both."""
import ast, importlib.util, os, re, sys, unittest
from unittest import mock

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
            "host": [1.0, used_gb, 0.0, 0.0, 0.0], "containers": [], "vms": list(vms), "jobs": [], "procs": []}


class OnItsHost(unittest.TestCase):
    def test_a_vm_under_its_host_carries_what_the_host_gives_it_as_a_history(self):
        host = fl.Machine({"id": "vmt-host", "name": "host", "ssh": "host", "os": "linux"}, 3)
        guest = fl.Machine({"id": "vmt-guest", "name": "guest", "ssh": "guest", "os": "linux", "vm_on": "vmt-host", "domain": "guest-domain"}, 3)
        host.got(view(20.0, [{"name": "guest-domain", "u": [0.5, 6.0, 0.0, 0.1, 0.2], "running": True, "ifs": [], "cpus": ""}]))   # readings arrive
        guest.got(view(40.0))
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

    # Kernels before nr_balloon_pages (6.1, 6.6, 6.8, 6.12: Debian 12 and 13, Ubuntu 24.04, RHEL 9) still count every
    # page the balloon took and gave back, so the balloon is inflate - deflate (#300)
    LTS = "nr_free_pages 5205423\nballoon_inflate 50331648\nballoon_deflate 7340032\nballoon_migrate 12\n"

    def test_a_kernel_without_nr_balloon_pages_counts_it_from_inflate_and_deflate(self):
        self.assertEqual(collector_fn("guest_mem")(MEMINFO, self.LTS, [DEFLATE_ON_OOM], 4096), [263895004 * KB - 42991616 * 4096, 24421508 * KB])

    def test_the_same_kernel_without_deflate_on_oom_control(self):
        self.assertEqual(collector_fn("guest_mem")(MEMINFO, self.LTS, [NO_DEFLATE], 4096), [263895004 * KB, 24421508 * KB])

    def test_a_balloon_given_all_back_takes_nothing_out(self):
        for vmstat in ("balloon_inflate 7340032\nballoon_deflate 7340032\n", "balloon_inflate 5\nballoon_deflate 9\n", "balloon_deflate 9\n"):
            with self.subTest(vmstat=vmstat):
                self.assertEqual(collector_fn("guest_mem")(MEMINFO, vmstat, [DEFLATE_ON_OOM], 4096), [263895004 * KB, 24421508 * KB])

    def test_nr_balloon_pages_wins_where_the_kernel_has_it(self):
        vmstat = "nr_balloon_pages 1000\nballoon_inflate 50331648\nballoon_deflate 7340032\n"
        self.assertEqual(collector_fn("guest_mem")(MEMINFO, vmstat, [DEFLATE_ON_OOM], 4096), [263895004 * KB - 1000 * 4096, 24421508 * KB])


# /proc/<pid>/status of a QEMU process whose guest RAM (32 GiB) is on huge pages: libvirt <memoryBacking><hugepages/>.
# Huge pages aren't in RSS (VmRSS, /proc/<pid>/stat), so the VM would cost its host 0.4 GB and Base system the rest (#300).
QEMU_STATUS = ("Name:\tqemu-system-x86\nState:\tS (sleeping)\nVmRSS:\t  419328 kB\nRssAnon:\t  401408 kB\n"
               "HugetlbPages:\t33554432 kB\nThreads:\t9\nCpus_allowed_list:\t2-7\n")


class HugePages(unittest.TestCase):
    def test_a_vm_on_huge_pages_costs_its_host_its_huge_pages(self):
        self.assertEqual(collector_fn("hugetlb_bytes")(QEMU_STATUS), 32 * GIB)

    def test_none_and_a_kernel_without_the_line_control(self):
        for status in (QEMU_STATUS.replace("33554432", "0"), "\n".join(l for l in QEMU_STATUS.splitlines() if not l.startswith("Huge")), ""):
            with self.subTest(status=status):
                self.assertEqual(collector_fn("hugetlb_bytes")(status), 0)

    def test_the_collector_adds_them_to_a_vms_qemu_process_only(self):
        # one reading of a /proc with dev-vm's QEMU process (32 GiB on huge pages) and a database that also maps huge
        # pages but isn't a VM (the control: its memory stays what RSS says, as everywhere else)
        spec = importlib.util.spec_from_file_location("collect_linux_hugepages", os.path.join(LIVE, "collect_linux.py"))
        cl = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cl)   # importing takes no reading
        stat = lambda pid, comm: "%d (%s) S 1 %d %d 0 -1 4194560 100 0 0 0 500 200 0 0 20 0 9 0 1000 4000000000 102400 %s" % (pid, comm, pid, pid, " ".join(["0"] * 20))
        files = {"/proc/stat": "cpu  1 0 1 10 0 0 0 0 0 0\ncpu0 1 0 1 10 0 0 0 0 0 0\n", "/proc/meminfo": MEMINFO,
                 "/proc/4242/stat": stat(4242, "qemu-system-x86"), "/proc/4242/status": QEMU_STATUS,
                 "/proc/4242/cmdline": "/usr/bin/qemu-system-x86_64\0-name\0guest=dev-vm,debug-threads=on\0-m\032768\0",
                 "/proc/5151/stat": stat(5151, "postgres"), "/proc/5151/status": QEMU_STATUS.replace("qemu-system-x86", "postgres"),
                 "/proc/5151/cmdline": "postgres\0-D\0/var/lib/postgresql\0"}
        listdir = os.listdir
        with mock.patch.object(cl, "rd", lambda p: files.get(p, "")), mock.patch.object(cl, "run", lambda *a, **kw: ""), \
                mock.patch.object(cl.os, "listdir", lambda p: ["4242", "5151", "self"] if p == "/proc" else listdir(p)):
            out = cl.snapshot()
        self.assertEqual(sorted((p[0], p[2], p[5], p[10]) for p in out["procs"]),
                         [(4242, "qemu-system-x86", 102400 * cl.PAGE + 32 * GIB, "dev-vm"), (5151, "postgres", 102400 * cl.PAGE, "")])
        self.assertEqual(out["vm_cpus"], {"dev-vm": "2-7"})


if __name__ == "__main__":
    unittest.main()
