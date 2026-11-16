# SPDX-License-Identifier: GPL-3.0-or-later
"""collect_linux.py's disks and network (#112): each physical disk with its mounts and role, the disks each container's
cgroup did I/O on, and which interfaces and how many TCP bytes each process has, read from a /proc and /sys tree and
ss / mdcmd output shaped like a real Linux host's (hand-made: no machine is read, no command is run).
Every assertion is the exact result."""
import importlib.util, os, re, shutil, sys, tempfile, unittest
from unittest import mock

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
        "33 22 0:55 / /mnt/user rw,nosuid,nodev,noatime shared:41 - fuse.shfs shfs rw,user_id=0,group_id=0,allow_other",
        "34 22 0:56 / /mnt/share rw,relatime shared:42 - cifs //nas/share rw,vers=3.1.1,cache=strict",
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


def fdinfo(mnt_id, ino):
    return "pos:\t0\nflags:\t02100002\nmnt_id:\t%d\nino:\t%d\n" % (mnt_id, ino)


class OpenFiles(unittest.TestCase):
    """Each host process that did I/O since the last reading, with the disks that hold the files it has open."""
    def setUp(self):
        t = self.tree = linux_host()
        self.addCleanup(shutil.rmtree, t.root)
        files = {
            300: [(0, "/dev/null", 24), (3, "/var/lib/postgresql/16/main/base/1/1259", 22), (4, "/mnt/backup/pg/base.tar", 31),
                  (5, "/srv/db/wal/000000010000000000000001", 27), (6, "socket:[48211]", 8), (7, "/mnt/user/appdata/pg/dump.sql", 33),
                  (8, "/mnt/share/exports/pg.csv", 34)],
            310: [(3, "/var/log/app/app.log", 612), (4, "/home/app/data.db", 615)],    # in its own mount namespace
            320: [(3, "/var/lib/app/cache.db", 22)],                                       # did no I/O
            330: [(3, "/mnt/backup/rsync.tmp", 31), (4, "/mnt/user/media/a.mkv", 33), (5, "pipe:[5521]", 13)],  # only on the network
            500: [(3, "/var/lib/nginx/cache/a", 22)],                                      # a container's: its cgroup says
        }
        for pid, fds in files.items():
            for fd, target, mnt_id in fds:
                t.raw_link("/proc/%d/fd/%d" % (pid, fd), target)
                t.file("/proc/%d/fdinfo/%d" % (pid, fd), fdinfo(mnt_id, 1000 + fd))
        t.file("/proc/310/mountinfo", "\n".join([      # systemd's ProtectSystem=strict: the same filesystems, new mount ids
            "600 590 8:1 / / ro,relatime shared:1 - ext4 /dev/sda1 rw",
            "612 600 8:1 /var/log /var/log rw,relatime shared:1 - ext4 /dev/sda1 rw",
            "615 600 253:0 / /home ro,relatime shared:31 - ext4 /dev/mapper/home rw"]) + "\n")
        self.m = load()
        self.m.ROOT = t.root
        self.m.run = commands({})

    def readings(self):
        before = [proc(300, "postgres", 1000), proc(310, "app", 50), proc(320, "app", 70), proc(330, "rsync", 0), proc(500, "nginx", 10, CONT1[:12])]
        after = [proc(300, "postgres", 9000), proc(310, "app", 60), proc(320, "app", 70), proc(330, "rsync", 4096), proc(500, "nginx", 90, CONT1[:12])]
        self.m.disk_info(before, [])
        return self.m.disk_info(after, [])[1]

    def test_each_busy_process_with_the_disks_its_open_files_are_on(self):
        self.assertEqual(self.readings(), {300: ["sda", "sdb", "sdc"], 310: ["nvme0n1", "sda"]})

    def test_open_files_are_never_stat_ed(self):
        """stat() would ask the file's own filesystem: an NFS, SMB or FUSE server, which may never answer."""
        fd_path = re.compile(re.escape(self.tree.root) + r"/proc/\d+/fd/\d+$")
        with mock.patch.object(self.m.os, "stat", wraps=os.stat) as st:
            self.readings()
        self.assertEqual([c.args[0] for c in st.call_args_list if fd_path.search(str(c.args[0]))], [])


ZPOOL = """  pool: tank
 state: ONLINE
  scan: scrub repaired 0B in 05:12:44 with 0 errors on Sun Nov  8 05:36:45 2026
config:

\tNAME                                              STATE     READ WRITE CKSUM
\ttank                                              ONLINE       0     0     0
\t  mirror-0                                        ONLINE       0     0     0
\t    /dev/disk/by-id/ata-WDC_WD120EFBX-68B_A1-part1  ONLINE       0     0     0
\t    /dev/disk/by-id/ata-WDC_WD120EFBX-68B_A2-part1  ONLINE       0     0     0
\tspares
\t  /dev/disk/by-id/ata-WDC_WD120EFBX-68B_A3-part1    AVAIL

errors: No known data errors
"""
ZPOOL_CMD = ("zpool", "status", "-P")


class BtrfsAndZfs(unittest.TestCase):
    """btrfs and ZFS give each filesystem an anonymous device number (major 0); its source and pool name the disks."""
    def setUp(self):
        t = self.tree = linux_host()
        self.addCleanup(shutil.rmtree, t.root)
        for i, (name, mm) in enumerate((("sdg", "8:96"), ("sdh", "8:112"), ("sdi", "8:128"), ("sdj", "8:144"), ("sdk", "8:160"), ("sdl", "8:176"))):
            ma, mi = mm.split(":")
            t.block(name, mm, SATA % (8 + i, 7 + i, 7 + i, 7 + i) + name, "Disk " + name, 7814037168, rot=True,
                    partitions=[(name + "1", "%s:%d" % (ma, int(mi) + 1))])
        t.block("dm-1", "253:1", "/sys/devices/virtual/block/dm-1", size=7814000000, slaves=["sdl1"])
        t.link("/dev/mapper/luks-5d2c", "/sys/class/block/dm-1")          # real: ../dm-1; only the name counts
        for i, n in enumerate(("sdi1", "sdj1", "sdk1")):
            t.link("/dev/disk/by-id/ata-WDC_WD120EFBX-68B_A%d-part1" % (i + 1), "/sys/class/block/" + n)
        for fs, devs in (("2f1e6a0c-6b7e-4f43-9d1a-2b8e0c5d7f11", ("sdg1", "sdh1")), ("9a7c1e55-0d2b-4c8e-a1f3-6e2d4b8c0a99", ("dm-1",))):
            for d in devs:
                t.link("/sys/fs/btrfs/%s/devices/%s" % (fs, d), "/sys/class/block/" + d)
        t.file("/sys/fs/btrfs/features/free_space_tree", "0\n")
        with open(t.root + "/proc/diskstats", "a") as f:
            f.write("\n".join(ds(mm, n, 100, 200, 30) for n, mm in (("sdg", "8:96"), ("sdh", "8:112"), ("sdi", "8:128"), ("sdj", "8:144"),
                                                                     ("sdk", "8:160"), ("sdl", "8:176"))) + "\n")
        with open(t.root + "/proc/self/mountinfo", "a") as f:
            f.write("\n".join([
                "41 22 0:40 / /mnt/cache rw,noatime shared:60 - btrfs /dev/sdg1 rw,ssd,space_cache=v2,subvolid=5,subvol=/",
                "42 22 0:61 / /mnt/tank rw,noatime shared:61 - zfs tank rw,xattr,noacl",
                "43 42 0:62 / /mnt/tank/media rw,noatime shared:62 - zfs tank/media rw,xattr,noacl",
                "44 22 0:40 /appdata /var/lib/appdata rw,noatime shared:63 - btrfs /dev/sdg1 rw,ssd,space_cache=v2,subvolid=257,subvol=/appdata",
                "45 22 0:46 /@data /data rw,relatime shared:64 - btrfs /dev/mapper/luks-5d2c rw,subvolid=256,subvol=/@data"]) + "\n")
        for pid, fds in ((340, [(3, "/mnt/cache/appdata/db.sqlite", 41), (4, "/mnt/tank/media/a.mkv", 43), (5, "/data/photos/b.jpg", 45)]),
                         (350, [(3, "/var/lib/appdata/app/log.txt", 44)])):
            for fd, target, mnt_id in fds:
                t.raw_link("/proc/%d/fd/%d" % (pid, fd), target)
                t.file("/proc/%d/fdinfo/%d" % (pid, fd), fdinfo(mnt_id, 2000 + fd))
        self.m = load()
        self.m.ROOT = t.root
        self.m.run = commands({ZPOOL_CMD: ZPOOL})

    def test_each_disk_shows_the_btrfs_and_zfs_filesystems_on_it(self):
        disks, _, _ = self.m.disk_info([], [])
        self.assertEqual({d["name"]: d["mounts"] for d in disks}, {
            "sda": ["/"], "sdb": ["/srv", "/export/media"], "sdc": ["/srv", "/export/media"], "sdf": [], "nvme0n1": ["/boot/efi", "/home"],
            "sdg": ["/mnt/cache", "/var/lib/appdata"], "sdh": ["/mnt/cache", "/var/lib/appdata"],   # a btrfs RAID 1, and a subvolume
            "sdi": ["/mnt/tank", "/mnt/tank/media"], "sdj": ["/mnt/tank", "/mnt/tank/media"],         # a ZFS mirror and its dataset
            "sdk": [],                                                                                # the pool's hot spare holds nothing
            "sdl": ["/data"],                                                                         # btrfs on LUKS (/dev/mapper)
        })

    def test_processes_with_files_on_btrfs_and_zfs(self):
        self.m.disk_info([proc(340, "app", 0), proc(350, "app", 0)], [])
        _, pdisks, _ = self.m.disk_info([proc(340, "app", 8192), proc(350, "app", 512)], [])
        self.assertEqual(pdisks, {340: ["sdg", "sdh", "sdi", "sdj", "sdl"], 350: ["sdg", "sdh"]})

    def test_zpool_runs_at_most_once_a_minute(self):
        for _ in range(3):
            self.m.disk_info([], [])
        self.assertEqual(self.m.run.ran, [list(ZPOOL_CMD)])


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

    def test_an_array_disk_formatted_zfs(self):
        self.format_disk1("40 22 0:70 / /mnt/disk1 rw,noatime shared:50 - zfs disk1 rw,xattr,noacl")
        self.m.run = commands({("/usr/local/sbin/mdcmd", "status"): MDCMD, ZPOOL_CMD:
                               "  pool: disk1\n state: ONLINE\nconfig:\n\n\tNAME          STATE     READ WRITE CKSUM\n"
                               "\tdisk1         ONLINE       0     0     0\n\t  /dev/md1p1  ONLINE       0     0     0\n\nerrors: No known data errors\n"})
        disks, _, _ = self.m.disk_info([], [])
        self.assertEqual({d["name"]: d["mounts"] for d in disks if d["mounts"] or d["role"]}, {
            "sda": ["/"], "sdb": ["/srv", "/export/media"], "sdc": ["/srv", "/export/media"], "nvme0n1": ["/boot/efi", "/home"],
            "sdd": ["/mnt/disk1"], "sde": []})

    def test_an_array_disk_formatted_btrfs(self):
        self.format_disk1("40 22 0:71 / /mnt/disk1 rw,noatime shared:50 - btrfs /dev/md1p1 rw,space_cache=v2,subvolid=5,subvol=/")
        self.tree.link("/sys/fs/btrfs/51c0a7e2-3f4d-4b6a-8e9c-0d1f2a3b4c5d/devices/md1p1", "/sys/class/block/md1p1")
        disks, _, _ = self.m.disk_info([], [])
        self.assertEqual({d["name"]: d["mounts"] for d in disks if d["mounts"] or d["role"]}, {
            "sda": ["/"], "sdb": ["/srv", "/export/media"], "sdc": ["/srv", "/export/media"], "nvme0n1": ["/boot/efi", "/home"],
            "sdd": ["/mnt/disk1"], "sde": []})

    def format_disk1(self, line):
        p = self.tree.root + "/proc/self/mountinfo"
        with open(p) as f:
            text = f.read()
        with open(p, "w") as f:
            f.write(text.replace("40 22 9:1 / /mnt/disk1 rw,noatime shared:50 - xfs /dev/md1p1 rw,attr2,inode64", line))

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
