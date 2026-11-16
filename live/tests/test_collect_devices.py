# SPDX-License-Identifier: GPL-3.0-or-later
"""collect_linux.py's disks and network (#112): each physical disk with its mounts and role, the disks each container's
cgroup did I/O on, and which interfaces and how many TCP bytes each process has, read from a /proc and /sys tree and
ss / mdcmd output shaped like a real Linux host's (hand-made: no machine is read, no command is run).
Every assertion is the exact result."""
import importlib.util, os, shutil, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)


def load():
    """A fresh collect_linux.py (its caches empty), imported, not run."""
    spec = importlib.util.spec_from_file_location("collect_linux_under_test", os.path.join(LIVE, "collect_linux.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Tree:
    """A machine's /proc and /sys under a temporary root. Links are relative, as sysfs's are."""
    def __init__(self):
        self.root = os.path.realpath(tempfile.mkdtemp(prefix="fleet-collect-"))

    def file(self, path, text=""):
        p = self.root + path
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            f.write(text)

    def link(self, path, target):
        """A link to another place in the tree."""
        p = self.root + path
        os.makedirs(os.path.dirname(p), exist_ok=True)
        os.symlink(os.path.relpath(self.root + target, os.path.dirname(p)), p)

    def raw_link(self, path, text):
        """A link whose text is kept as it is (/proc/PID/fd/N names a path in the process's own view, or socket:[N])."""
        p = self.root + path
        os.makedirs(os.path.dirname(p), exist_ok=True)
        os.symlink(text, p)

    def block(self, name, majmin, dev, model="", size=0, rot=False, partitions=(), slaves=()):
        """A block device at its sysfs path `dev`, with its partitions [(name, major:minor)] and the devices under it."""
        self.file(dev + "/dev", majmin + "\n")
        self.file(dev + "/size", "%d\n" % size)
        self.file(dev + "/queue/rotational", "1\n" if rot else "0\n")
        if model:
            self.file(dev + "/device/model", model + "   \n")
        os.makedirs(self.root + dev + "/slaves", exist_ok=True)
        for s in slaves:
            self.link(dev + "/slaves/" + s, os.path.realpath(self.root + "/sys/class/block/" + s)[len(self.root):])
        for link in ("/sys/block/" + name, "/sys/class/block/" + name, "/sys/dev/block/" + majmin):
            self.link(link, dev)
        for pn, pmm in partitions:
            self.file(dev + "/" + pn + "/dev", pmm + "\n")
            self.file(dev + "/" + pn + "/partition", pn[-1] + "\n")
            self.link("/sys/class/block/" + pn, dev + "/" + pn)
            self.link("/sys/dev/block/" + pmm, dev + "/" + pn)


def ds(majmin, name, sectors_r, sectors_w, ms):
    """One /proc/diskstats line (kernel 5.5+: 17 fields after the name)."""
    ma, mi = majmin.split(":")
    return "%4s %7s %s 120 3 %d 41 260 9 %d 77 0 %d 118 0 0 0 0 0 0" % (ma, mi, name, sectors_r, sectors_w, ms)


SATA = "/sys/devices/pci0000:00/0000:00:17.0/ata%d/host%d/target%d:0:0/%d:0:0:0/block/"
NVME = "/sys/devices/pci0000:00/0000:00:1d.0/0000:3d:00.0/nvme/nvme0/"
CONT1, CONT2 = "c0ffee000001" + "ab" * 26, "deadbeef0002" + "cd" * 26


def proc(pid, comm, iob=0, cid=""):
    """One collect_linux.py process row: pid, ppid, comm, state, ticks, rss, threads, user, io bytes, container, vm, unit, cmd, last cpu."""
    return [pid, 1, comm, "S", 100, 1 << 20, 2, "root", iob, cid, "", "", "/usr/bin/" + comm, 0]


def linux_host():
    """A host with an SSD (sda: / and swap), two HDDs in an md RAID 1 (sdb, sdc: /srv, bind-mounted at /export/media),
    an NVMe SSD (/boot/efi, and /home on LUKS), an unmounted HDD (sdf), a snap loop device, a DVD drive, and two
    containers (one did I/O on sdb and on /home, one did none)."""
    t = Tree()
    t.block("sda", "8:0", SATA % (1, 0, 0, 0) + "sda", "Samsung SSD 870", 1953525168, partitions=[("sda1", "8:1"), ("sda2", "8:2")])
    t.block("sdb", "8:16", SATA % (2, 1, 1, 1) + "sdb", "WDC WD80EFZZ-68B", 15628053168, rot=True, partitions=[("sdb1", "8:17")])
    t.block("sdc", "8:32", SATA % (3, 2, 2, 2) + "sdc", "WDC WD80EFZZ-68B", 15628053168, rot=True, partitions=[("sdc1", "8:33")])
    t.block("sdf", "8:80", SATA % (4, 3, 3, 3) + "sdf", "ST4000VN006-3CW1", 7814037168, rot=True)
    t.block("sr0", "11:0", SATA % (5, 4, 4, 4) + "sr0", "DVD-RW DRW-24D5MT")
    t.block("nvme0n1", "259:0", NVME + "nvme0n1", "WD_BLACK SN850X 1000GB", 1953525168, partitions=[("nvme0n1p1", "259:1"), ("nvme0n1p2", "259:2")])
    t.block("md0", "9:0", "/sys/devices/virtual/block/md0", size=15627788288, slaves=["sdb1", "sdc1"])
    t.block("dm-0", "253:0", "/sys/devices/virtual/block/dm-0", size=1951424512, slaves=["nvme0n1p2"])
    t.block("loop0", "7:0", "/sys/devices/virtual/block/loop0", size=113424)
    t.file("/proc/diskstats", "\n".join([
        ds("7:0", "loop0", 2200, 0, 30), ds("8:0", "sda", 4000, 9000, 1500), ds("8:1", "sda1", 3900, 9000, 1490), ds("8:2", "sda2", 100, 0, 10),
        ds("8:16", "sdb", 600000, 200000, 90000), ds("8:17", "sdb1", 599000, 200000, 89900), ds("8:32", "sdc", 610000, 200000, 91000),
        ds("8:33", "sdc1", 609000, 200000, 90900), ds("8:80", "sdf", 12, 0, 4), ds("11:0", "sr0", 0, 0, 0),
        ds("259:0", "nvme0n1", 70000, 50000, 8000), ds("259:1", "nvme0n1p1", 300, 10, 20), ds("259:2", "nvme0n1p2", 69000, 49990, 7900),
        ds("9:0", "md0", 1200000, 200000, 0), ds("253:0", "dm-0", 69000, 49990, 7950)]) + "\n")
    t.file("/proc/self/mountinfo", "\n".join([
        "22 1 8:1 / / rw,relatime shared:1 - ext4 /dev/sda1 rw",
        "23 22 0:21 / /proc rw,nosuid,nodev,noexec,relatime shared:12 - proc proc rw",
        "24 22 0:5 / /dev rw,nosuid shared:2 - devtmpfs devtmpfs rw,size=8126464k,nr_inodes=2031616,mode=755",
        "25 22 259:1 / /boot/efi rw,relatime shared:30 - vfat /dev/nvme0n1p1 rw,fmask=0077,dmask=0077",
        "26 22 253:0 / /home rw,relatime shared:31 - ext4 /dev/mapper/home rw",
        "27 22 9:0 / /srv rw,relatime shared:32 - xfs /dev/md0 rw,attr2,inode64",
        "28 22 9:0 /media /export/media rw,relatime shared:32 - xfs /dev/md0 rw,attr2,inode64",
        "29 22 7:0 / /snap/core22/1380 ro,nodev,relatime shared:33 - squashfs /dev/loop0 ro",
        "30 22 0:30 / /tmp rw,nosuid,nodev shared:34 - tmpfs tmpfs rw",
        "31 22 0:52 / /mnt/backup rw,relatime shared:40 - nfs4 nas:/backup rw,vers=4.2,hard,proto=tcp",
        "32 22 0:48 / /var/lib/docker/overlay2/7c1d/merged rw,relatime - overlay overlay rw,lowerdir=/var/lib/docker/overlay2/l/A"]) + "\n")
    for pid, cont in ((500, CONT1), (501, CONT1), (510, CONT2)):
        t.file("/proc/%d/cgroup" % pid, "0::/system.slice/docker-%s.scope\n" % cont)
    t.file("/sys/fs/cgroup/system.slice/docker-%s.scope/io.stat" % CONT1,
           "8:16 rbytes=4096 wbytes=8192 rios=1 wios=2 dbytes=0 dios=0\n253:0 rbytes=1000 wbytes=24 rios=1 wios=1 dbytes=0 dios=0\n")
    t.file("/sys/fs/cgroup/system.slice/docker-%s.scope/io.stat" % CONT2, "")
    return t


def commands(outputs):
    """A stand-in for collect_linux.run: the recorded output of each command, and a failure for any other."""
    ran = []

    def run(cmd, timeout=8):
        ran.append(list(cmd))
        if tuple(cmd) not in outputs:
            raise AssertionError("ran an unexpected command: %r" % (cmd,))
        return outputs[tuple(cmd)]
    run.ran = ran
    return run


def disk(name, r, w, ms, model, size, rot, mounts, role=""):
    return {"name": name, "r": r * 512, "w": w * 512, "ms": ms, "model": model, "size": size * 512, "rot": rot, "mounts": mounts, "role": role}


class Disks(unittest.TestCase):
    def setUp(self):
        self.tree = linux_host()
        self.addCleanup(shutil.rmtree, self.tree.root)
        self.m = load()
        self.m.ROOT = self.tree.root
        self.m.run = commands({})
        self.procs = [proc(300, "postgres", 1000), proc(500, "nginx", cid=CONT1[:12]), proc(501, "nginx", cid=CONT1[:12]),
                      proc(510, "redis", cid=CONT2[:12])]

    def test_each_physical_disk_with_its_counters_model_size_and_mounts(self):
        disks, _, _ = self.m.disk_info(self.procs, [])
        self.assertEqual(disks, [
            disk("sda", 4000, 9000, 1500, "Samsung SSD 870", 1953525168, False, ["/"]),
            disk("sdb", 600000, 200000, 90000, "WDC WD80EFZZ-68B", 15628053168, True, ["/srv", "/export/media"]),
            disk("sdc", 610000, 200000, 91000, "WDC WD80EFZZ-68B", 15628053168, True, ["/srv", "/export/media"]),
            disk("sdf", 12, 0, 4, "ST4000VN006-3CW1", 7814037168, True, []),
            disk("nvme0n1", 70000, 50000, 8000, "WD_BLACK SN850X 1000GB", 1953525168, False, ["/boot/efi", "/home"]),
        ])

    def test_a_partition_an_md_array_and_luks_resolve_to_the_disks_under_them(self):
        got = {mm: self.m.disks_of(mm) for mm in ("8:1", "8:0", "9:0", "253:0", "259:2", "7:0", "11:0", "0:52", "1:9")}
        self.assertEqual(got, {"8:1": {"sda"}, "8:0": {"sda"}, "9:0": {"sdb", "sdc"}, "253:0": {"nvme0n1"}, "259:2": {"nvme0n1"},
                               "7:0": set(), "11:0": set(), "0:52": set(), "1:9": set()})

    def test_each_container_with_the_disks_its_cgroup_did_io_on(self):
        _, _, cdisks = self.m.disk_info(self.procs, [])
        self.assertEqual(cdisks, {CONT1[:12]: {"sdb": 12288, "nvme0n1": 1024}})

    def test_no_command_runs_on_a_host_without_unraid(self):
        self.m.disk_info(self.procs, [])
        self.assertEqual(self.m.run.ran, [])


MDCMD = """sbName=/boot/config/super.dat
mdState=STARTED
diskNumber.0=0
diskName.0=
diskSize.0=7814026532
rdevName.0=sde
diskNumber.1=1
diskName.1=md1p1
diskSize.1=7814026532
rdevName.1=sdd
diskNumber.2=2
diskName.2=md2p1
diskSize.2=0
rdevName.2=
diskNumber.29=29
diskName.29=
diskSize.29=0
rdevName.29=
"""


class UnraidDisks(unittest.TestCase):
    """Unraid's array driver hides the disk behind /dev/md1p1; mdcmd status (read-only) names it, and the parity disk."""
    def setUp(self):
        t = self.tree = linux_host()
        self.addCleanup(shutil.rmtree, t.root)
        t.file("/usr/local/sbin/mdcmd", "")
        t.block("sdd", "8:48", SATA % (6, 5, 5, 5) + "sdd", "ST8000VN004-3CP1", 15628053168, rot=True, partitions=[("sdd1", "8:49")])
        t.block("sde", "8:64", SATA % (7, 6, 6, 6) + "sde", "ST8000VN004-3CP1", 15628053168, rot=True, partitions=[("sde1", "8:65")])
        t.block("md1p1", "9:1", "/sys/devices/virtual/block/md1p1", size=15628053104)
        with open(t.root + "/proc/diskstats", "a") as f:
            f.write("\n".join([ds("8:48", "sdd", 5000, 7000, 900), ds("8:64", "sde", 100, 7000, 800), ds("9:1", "md1p1", 5000, 7000, 0)]) + "\n")
        with open(t.root + "/proc/self/mountinfo", "a") as f:
            f.write("40 22 9:1 / /mnt/disk1 rw,noatime shared:50 - xfs /dev/md1p1 rw,attr2,inode64\n")
        self.m = load()
        self.m.ROOT = t.root
        self.m.run = commands({("/usr/local/sbin/mdcmd", "status"): MDCMD})

    def test_array_disks_and_parity_get_their_role_and_mounts(self):
        disks, _, _ = self.m.disk_info([], [])
        self.assertEqual({d["name"]: (d["role"], d["mounts"]) for d in disks},
                         {"sda": ("", ["/"]), "sdb": ("", ["/srv", "/export/media"]), "sdc": ("", ["/srv", "/export/media"]), "sdf": ("", []),
                          "nvme0n1": ("", ["/boot/efi", "/home"]), "sdd": ("array disk 1", ["/mnt/disk1"]), "sde": ("parity", [])})
        self.assertEqual(self.m.disks_of("9:1"), {"sdd"})

    def test_mdcmd_runs_at_most_once_a_minute(self):
        for _ in range(3):
            self.m.disk_info([], [])
        self.assertEqual(self.m.run.ran, [["/usr/local/sbin/mdcmd", "status"]])


# ss -tinpH state established: Recv-Q, Send-Q, local, peer, process; each connection's TCP info on the next line.
SS = """0      0           192.168.1.20:22         192.168.1.10:51234 users:(("sshd",pid=1201,fd=4),("sshd",pid=1180,fd=4))
\t cubic wscale:7,7 rto:204 rtt:0.4/0.2 ato:40 mss:1448 pmtu:1500 rcvmss:536 advmss:1448 cwnd:10 bytes_sent:52340 bytes_acked:52340 bytes_received:8812 segs_out:200 segs_in:300 data_segs_out:150 data_segs_in:90 send 289.6Mbps lastsnd:4 lastrcv:4 lastack:4 pacing_rate 579.2Mbps delivery_rate 120Mbps delivered:151 app_limited busy:60ms rcv_space:14480 rcv_ssthresh:64088 minrtt:0.2
0      0    [::ffff:192.168.1.20]:8096 [::ffff:192.168.1.31]:40112 users:(("nginx",pid=2200,fd=21))
\t cubic wscale:7,7 rto:208 rtt:5.1/2 mss:1448 cwnd:40 bytes_sent:900000000 bytes_acked:899000000 bytes_received:40000 segs_out:621000 segs_in:30000 send 90.8Mbps
0      0              127.0.0.1:8096            127.0.0.1:39000 users:(("nginx",pid=2200,fd=22))
\t cubic rto:201 rtt:0.05/0.02 mss:65483 cwnd:10 bytes_sent:500 bytes_acked:500 bytes_received:100 segs_out:5 segs_in:6
0      0          [fe80::1%eth0]:22         [fe80::2%eth0]:50000 users:(("sshd",pid=1300,fd=4))
\t cubic rto:204 rtt:0.3/0.1 mss:1428 cwnd:10 bytes_acked:1000 bytes_received:2000 segs_out:10 segs_in:12
0      0              127.0.0.1:5432            127.0.0.1:41000 users:(("postgres",pid=300,fd=9))
\t cubic rto:201 rtt:0.04/0.02 mss:65483 cwnd:10 bytes_sent:700 bytes_acked:700 bytes_received:300 segs_out:7 segs_in:8
0      0              127.0.0.1:41000           127.0.0.1:5432 users:(("app",pid=320,fd=5))
\t cubic rto:201 rtt:0.04/0.02 mss:65483 cwnd:10 bytes_sent:300 bytes_acked:300 bytes_received:700 segs_out:8 segs_in:7
0      0               10.8.0.5:443           203.0.113.9:6000 users:(("wg-app",pid=400,fd=7))
\t cubic rto:250 rtt:40/10 mss:1380 cwnd:10 bytes_sent:10 bytes_acked:10 bytes_received:10 segs_out:2 segs_in:2
0      0           192.168.1.20:2049        192.168.1.40:812
\t cubic rto:204 rtt:0.5/0.2 mss:1448 cwnd:10 bytes_sent:4096 bytes_acked:4096 bytes_received:4096 segs_out:4 segs_in:4
"""
IFADDR = {"192.168.1.20": "eth0", "fe80::1": "eth0", "127.0.0.1": "lo", "::1": "lo", "172.17.0.1": "docker0"}
SS_CMD = ("ss", "-tinpH", "state", "established")


class NetUsers(unittest.TestCase):
    def setUp(self):
        self.m = load()
        self.m.run = commands({SS_CMD: SS})

    def test_each_process_with_its_interfaces_and_tcp_bytes(self):
        self.assertEqual(self.m.net_users(IFADDR), {
            "1201": {"ifs": ["eth0"], "b": 61152}, "1180": {"ifs": ["eth0"], "b": 61152},   # one connection, two processes
            "2200": {"ifs": ["eth0", "lo"], "b": 900040600},                                # IPv4-mapped IPv6, and loopback
            "1300": {"ifs": ["eth0"], "b": 3000},                                           # link-local: the interface is in the address
            "300": {"ifs": ["lo"], "b": 1000}, "320": {"ifs": ["lo"], "b": 1000},           # both ends on this host
            "400": {"ifs": [], "b": 20},                                                    # an address ip addr doesn't list
        })                                                                                  # (and the kernel's NFS socket has no process)

    def test_no_connections(self):
        self.m.run = commands({SS_CMD: ""})
        self.assertEqual(self.m.net_users(IFADDR), {})


if __name__ == "__main__":
    unittest.main()
