# SPDX-License-Identifier: GPL-3.0-or-later
# Fleet Live: one read-only snapshot of a Linux machine, printed as JSON.
#
# Piped over SSH to `python3 -` on each Linux host; nothing is installed and
# nothing is changed. It only reads /proc and /sys and runs read-only listing
# commands (docker ps, virsh list/domiflist, crontab -l, systemctl list-timers,
# nvidia-smi, ip addr). Counters are cumulative; the Mac side turns them into
# rates by diffing two snapshots. It loops, printing one zlib+base64 JSON line
# every INTERVAL seconds (prepended by the collector), until SSH closes.
import base64, glob, json, os, re, subprocess, sys, time, zlib

PAGE = os.sysconf("SC_PAGE_SIZE")
HZ = os.sysconf("SC_CLK_TCK")
ROOT = ""  # where /proc, /sys and /usr/local/sbin are read from: "" on a host, a recorded snapshot in tests


def rd(path):
    try:
        with open(path, "rb") as f:
            return f.read().decode("utf-8", "replace")
    except Exception:
        return ""


def run(cmd, timeout=8):
    try:
        return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                              timeout=timeout).stdout.decode("utf-8", "replace")
    except Exception:
        return ""


def netdev(text):
    out = {}
    for line in text.splitlines()[2:]:
        name, _, rest = line.partition(":")
        f = rest.split()
        if len(f) >= 9:
            out[name.strip()] = [int(f[0]), int(f[8])]
    return out




# ---- GPUs from every vendor: the kernel's DRM devices, per-process engine time from fdinfo ----
DISPLAY_ONLY = {"ast", "mgag200", "simpledrm", "simplefb", "bochs", "bochs-drm", "cirrus", "cirrus-qemu", "hibmc-drm",
                "vboxvideo", "udl", "efifb", "vesafb", "gm12u320", "gud"}
VENDORS = {"0x10de": "NVIDIA", "0x1002": "AMD", "0x8086": "Intel", "0x1af4": "virtio", "0x15ad": "VMware",
           "0x1414": "Microsoft", "0x5143": "Qualcomm", "0x106b": "Apple", "0x1a03": "ASPEED"}
NAME_CACHE, GPU_FDS, SCAN = {}, [], {"n": 0, "cost": 0.0}


def gpu_name(pdev, vendor, driver):
    if pdev in NAME_CACHE:
        return NAME_CACHE[pdev]
    name = ""
    out = run(["lspci", "-mm", "-s", pdev], timeout=4).strip()
    f = re.findall(r'"([^"]*)"', out)
    if len(f) >= 3:
        vend = VENDORS.get(vendor) or f[1].split()[0]
        m = re.search(r"\[([^\]]+)\]", f[2])
        name = "%s %s" % (vend, m.group(1) if m else f[2])
    if not name:
        name = "%s GPU (%s)" % (VENDORS.get(vendor, "Unknown"), driver or "no driver")
    NAME_CACHE[pdev] = name
    return name


def drm_gpus():
    """Every GPU the kernel exposes (any vendor), minus display-only chips; plus GPUs passed through to VMs."""
    cards, seen = [], set()
    for c in sorted(os.listdir("/sys/class/drm")):
        if not re.match(r"^card\d+$", c):
            continue
        dev = os.path.realpath("/sys/class/drm/%s/device" % c)
        drv = os.path.basename(os.path.realpath(dev + "/driver")) if os.path.exists(dev + "/driver") else ""
        if drv in DISPLAY_ONLY:
            continue
        pdev, vendor = os.path.basename(dev), rd(dev + "/vendor").strip()
        if pdev in seen:
            continue
        seen.add(pdev)
        base = "/sys/class/drm/%s/" % c
        mhz = rd(base + "gt_act_freq_mhz").strip() or rd(dev + "/tile0/gt0/freq0/act_freq").strip()
        maxmhz = rd(base + "gt_max_freq_mhz").strip() or rd(dev + "/tile0/gt0/freq0/max_freq").strip()
        if not mhz:  # amdgpu: the current shader clock is the starred line of pp_dpm_sclk
            m = re.search(r"(\d+)Mhz \*", rd(dev + "/pp_dpm_sclk"))
            mhz = m.group(1) if m else ""
        busy = rd(dev + "/gpu_busy_percent").strip()  # amdgpu
        vt, vu = rd(dev + "/mem_info_vram_total").strip(), rd(dev + "/mem_info_vram_used").strip()
        m = re.search(r"(\d+)Mhz \*", rd(dev + "/pp_dpm_mclk"))  # amdgpu: the memory clock now
        # sensors: temperature (millidegrees), power (amdgpu average, microwatts) or energy (i915/xe, cumulative
        # microjoules), the power limit and the fan (rpm)
        hw = {}
        for h in glob.glob(dev + "/hwmon/hwmon*"):
            for k, f in (("temp", "temp1_input"), ("power", "power1_average"), ("energy", "energy1_input"), ("power_max", "power1_cap"),
                         ("power_max", "power1_max"), ("fan", "fan1_input")):
                v = rd(h + "/" + f).strip()
                if v.isdigit() and k not in hw and (k != "power_max" or int(v) > 0):
                    hw[k] = int(v)
        cards.append({"card": c, "pdev": pdev, "driver": drv, "vendor": VENDORS.get(vendor, vendor), "name": gpu_name(pdev, vendor, drv),
                      "mhz": int(mhz) if mhz.isdigit() else 0, "maxmhz": int(maxmhz) if maxmhz.isdigit() else 0,
                      "busy": int(busy) if busy.isdigit() else -1, "vram": [int(vt) if vt.isdigit() else 0, int(vu) if vu.isdigit() else 0],
                      "memmhz": int(m.group(1)) if m else 0, "hwmon": hw})
    # Display controllers bound to vfio-pci belong to a VM: still a GPU of this host, used by that VM.
    for pdev in sorted(os.listdir("/sys/bus/pci/devices")):
        d = "/sys/bus/pci/devices/" + pdev
        if pdev in seen or not rd(d + "/class").startswith("0x03"):
            continue
        drv = os.path.basename(os.path.realpath(d + "/driver")) if os.path.exists(d + "/driver") else ""
        if drv in ("vfio-pci", "pci-stub"):
            vendor = rd(d + "/vendor").strip()
            if vendor == "0x1a03":
                continue
            cards.append({"card": "", "pdev": pdev, "driver": drv, "vendor": VENDORS.get(vendor, vendor), "name": gpu_name(pdev, vendor, drv),
                          "mhz": 0, "maxmhz": 0, "busy": -1, "vram": [0, 0], "passthrough": True})
    return cards


def node_pdev(path):
    """/dev/dri/renderD128 or card1 -> the PCI (or platform) device it belongs to."""
    return os.path.basename(os.path.realpath("/sys/class/drm/%s/device" % os.path.basename(path)))


def gpu_clients(cards):
    """[pid, pdev, client id, {engine: busy ns}, {engine: capacity}, memory bytes] for every process using a GPU."""
    want = {c["pdev"] for c in cards if c.get("card")}
    if not want:
        return []
    pids = set()
    debug = [d for d in ("/sys/kernel/debug/dri/" + p for p in want) if os.path.exists(d + "/clients")]
    if debug:  # cheap: the kernel lists each GPU's clients (root + debugfs)
        for d in debug:
            for line in rd(d + "/clients").splitlines()[1:]:
                f = line.split()
                if len(f) > 1 and f[1].isdigit():
                    pids.add(f[1])
        fds = []
        for pid in pids:
            try:
                for fd in os.listdir("/proc/%s/fd" % pid):
                    l = os.readlink("/proc/%s/fd/%s" % (pid, fd))
                    if l.startswith("/dev/dri/"):
                        fds.append((pid, fd, node_pdev(l)))
            except Exception:
                pass
        GPU_FDS[:] = fds
    else:  # scan every open file, but only as often as it's cheap
        SCAN["n"] += 1
        if SCAN["cost"] < 0.15 or SCAN["n"] % 10 == 1:
            began, fds = time.time(), []
            for pid in os.listdir("/proc"):
                if not pid.isdigit():
                    continue
                try:
                    for fd in os.listdir("/proc/%s/fd" % pid):
                        try:
                            l = os.readlink("/proc/%s/fd/%s" % (pid, fd))
                        except Exception:
                            continue
                        if l.startswith("/dev/dri/"):
                            fds.append((pid, fd, node_pdev(l)))
                except Exception:
                    continue
            GPU_FDS[:] = fds
            SCAN["cost"] = time.time() - began
    out, seen = [], set()
    for pid, fd, pdev in GPU_FDS:
        info = rd("/proc/%s/fdinfo/%s" % (pid, fd))
        if not info:
            continue
        m = re.search(r"drm-pdev:\s*(\S+)", info)
        pdev = m.group(1) if m else pdev
        cid = re.search(r"drm-client-id:\s*(\d+)", info)
        key = (pdev, cid.group(1) if cid else pid + "/" + fd)
        if key in seen or pdev not in want:
            continue  # the same client shows up in every process that shares its file
        seen.add(key)
        eng = {k: int(v) for k, v in re.findall(r"drm-engine-([a-z0-9-]+):\s*(\d+) ns", info) if not k.startswith("capacity")}
        cap = {k: int(v) for k, v in re.findall(r"drm-engine-capacity-([a-z0-9-]+):\s*(\d+)", info)}
        mem = 0
        for k, v, u in re.findall(r"drm-(?:resident)-([a-z0-9]+):\s*(\d+)\s*(\w*)", info):
            if k.startswith(("vram", "local")):
                mem += int(v) * {"KiB": 1024, "MiB": 1024 ** 2, "GiB": 1024 ** 3}.get(u, 1)
        out.append([int(pid), pdev, key[1], eng, cap, mem])
    return out


# ---- Disks: each physical disk, and which processes and containers do I/O on it ----
PHYS = re.compile(r"^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme\d+n\d+|mmcblk\d+)$")
PREV_IO, RESOLVE = {}, {}
UNRAID = {"t": 0.0, "map": {}, "role": {}}
BTRFS, ZPOOLS = {}, {"t": 0.0, "pools": {}}


def unraid_map():
    """Unraid's array driver hides which physical disk is behind /dev/mdNp1; mdcmd status (read-only) says."""
    if time.time() - UNRAID["t"] < 60 or not os.path.exists(ROOT + "/usr/local/sbin/mdcmd"):
        return
    UNRAID["t"] = time.time()
    st = run(["/usr/local/sbin/mdcmd", "status"], timeout=5)
    names = dict(re.findall(r"^diskName\.(\d+)=(\S*)$", st, re.M))
    for n, dev in re.findall(r"^rdevName\.(\d+)=(\S*)$", st, re.M):
        if not dev:
            continue
        md = names.get(n, "")
        if md:
            UNRAID["map"][md] = dev
            UNRAID["role"][dev] = "array disk %s" % n
        else:
            UNRAID["role"][dev] = "parity" if n == "0" else "parity 2" if n == "29" else "slot %s" % n
    RESOLVE.clear()


def disks_of(majmin):
    """major:minor of a block device (partition, md/dm array, disk) -> the physical disks under it."""
    if majmin in RESOLVE:
        return RESOLVE[majmin]
    out = set()
    path = os.path.realpath(ROOT + "/sys/dev/block/" + majmin)
    if os.path.exists(path):
        name = os.path.basename(path)
        if name in UNRAID["map"]:
            RESOLVE[majmin] = {UNRAID["map"][name]}
            return RESOLVE[majmin]
        base = os.path.dirname(path) if os.path.exists(path + "/partition") else path
        slaves = os.path.join(base, "slaves")
        if os.path.isdir(slaves) and os.listdir(slaves):
            for sl in os.listdir(slaves):
                out |= disks_of(rd(ROOT + "/sys/class/block/%s/dev" % sl).strip())
        elif PHYS.match(os.path.basename(base)):
            out.add(os.path.basename(base))
        elif PHYS.match(name):
            out.add(name)
    RESOLVE[majmin] = out
    return out


def zfs_pools():
    """Each ZFS pool's devices, from zpool status (read-only), at most once a minute."""
    if time.time() - ZPOOLS["t"] >= 60:
        ZPOOLS["t"], pools, pool, spare = time.time(), {}, "", False
        for line in run(["zpool", "status", "-P"], timeout=5).splitlines():
            f = line.split()
            if f[:1] == ["pool:"] and len(f) > 1:
                pool, spare = f[1], False
            elif f[:1] == ["spares"]:
                spare = True  # a hot spare holds nothing until it replaces a disk
            elif f and f[0].startswith("/dev/") and pool and not spare:
                pools.setdefault(pool, []).append(f[0])
        ZPOOLS["pools"] = pools
    return ZPOOLS["pools"]


def mount_disks(majmin, fstype, source):
    """The physical disks under one mount. btrfs and ZFS have anonymous device numbers (major 0): the mount's source
    names its device (and /sys/fs/btrfs the others of a multi-device btrfs), and a ZFS dataset's pool its devices."""
    if not majmin.startswith("0:"):
        return disks_of(majmin)
    if fstype == "zfs":
        devs = zfs_pools().get(source.split("/")[0], [])
    elif source.startswith("/dev/"):
        devs = [source]
    else:
        return set()  # tmpfs, overlay, NFS, SMB, FUSE: no disk of this machine
    out = set()
    for d in devs:
        name = os.path.basename(os.path.realpath(ROOT + d))  # /dev/mapper/x, /dev/disk/by-id/y -> dm-0, sdb1
        for n in BTRFS.get(name, [name]):
            mm = rd(ROOT + "/sys/class/block/%s/dev" % n).strip()
            if mm:
                out |= disks_of(mm)
    return out


def mounts_in(text):
    """mountinfo -> [(mount id, mount point, the physical disks under it)]"""
    out = []
    for line in text.splitlines():
        f = line.split()
        if len(f) > 4 and f[2]:
            fs = f[f.index("-", 6) + 1:] if "-" in f[6:] else []
            out.append((f[0], f[4], mount_disks(f[2], fs[0] if fs else "", fs[1] if len(fs) > 1 else "")))
    return out


def disk_info(procs, containers):
    unraid_map()
    disks = []
    for line in rd(ROOT + "/proc/diskstats").splitlines():
        f = line.split()
        if len(f) < 14 or not PHYS.match(f[2]):
            continue
        n = f[2]
        b = ROOT + "/sys/block/%s/" % n
        size = rd(b + "size").strip()
        disks.append({"name": n, "r": int(f[5]) * 512, "w": int(f[9]) * 512, "ms": int(f[12]),
                      "model": (rd(b + "device/model").strip() or rd(b + "device/name").strip()), "size": int(size) * 512 if size.isdigit() else 0,
                      "rot": rd(b + "queue/rotational").strip() == "1", "mounts": [], "role": UNRAID["role"].get(n, "")})
    by = {d["name"]: d for d in disks}
    BTRFS.clear()
    for fs in glob.glob(ROOT + "/sys/fs/btrfs/*/devices"):  # every device of each btrfs, by name
        devs = sorted(os.listdir(fs))
        BTRFS.update((d, devs) for d in devs)
    mnt = {}  # mount id -> the disks under it, for the open files below
    for mid, point, under in mounts_in(rd(ROOT + "/proc/self/mountinfo")):
        mnt[mid] = under
        for dn in under:
            if dn in by and len(by[dn]["mounts"]) < 4 and point not in by[dn]["mounts"]:
                by[dn]["mounts"].append(point)
    # Processes that did I/O since the last reading: which disks hold the files they have open.
    pdisks = {}
    busy = []
    for p in procs:
        if p[8] >= 0:
            prev = PREV_IO.get(p[0])
            PREV_IO[p[0]] = p[8]
            if prev is not None and p[8] > prev and not p[9]:
                busy.append(p[0])
    for pid in busy[:300]:
        found, own = set(), False
        try:
            fds = os.listdir(ROOT + "/proc/%d/fd" % pid)[:2000]
        except Exception:
            continue
        for fd in fds:
            # The fd's fdinfo names the mount its file is on. stat() would ask the file's own filesystem instead: a round
            # trip to an NFS, SMB or FUSE server for no disk, and a reading that never returns when that server is gone.
            try:
                if not os.readlink(ROOT + "/proc/%d/fd/%s" % (pid, fd)).startswith("/"):
                    continue  # a socket, pipe or anon inode: never on a disk
            except Exception:
                continue
            m = re.search(r"^mnt_id:\s*(\d+)", rd(ROOT + "/proc/%d/fdinfo/%s" % (pid, fd)), re.M)
            if not m:
                continue
            if m.group(1) not in mnt and not own:  # its own mount namespace (systemd's ProtectSystem, PrivateTmp); mount ids are global
                own = True
                mnt.update((mid, under) for mid, _, under in mounts_in(rd(ROOT + "/proc/%d/mountinfo" % pid)))
            found |= mnt.get(m.group(1), set())
        if found:
            pdisks[pid] = sorted(found)
    if len(PREV_IO) > 20000:
        live = {p[0] for p in procs}
        for k in [k for k in PREV_IO if k not in live]:
            del PREV_IO[k]
    # Containers: their cgroup counts I/O per device.
    cdisks = {}
    first = {}
    for p in procs:
        if p[9] and p[9] not in first:
            first[p[9]] = p[0]
    for cid, pid in first.items():
        m = re.search(r"0::(\S+)", rd(ROOT + "/proc/%d/cgroup" % pid))
        if not m:
            continue
        acc = {}
        for line in rd(ROOT + "/sys/fs/cgroup%s/io.stat" % m.group(1)).splitlines():
            f = line.split()
            if not f:
                continue
            kv = dict(x.split("=", 1) for x in f[1:] if "=" in x)
            tot = int(kv.get("rbytes", 0)) + int(kv.get("wbytes", 0))
            for dn in disks_of(f[0]):
                acc[dn] = acc.get(dn, 0) + tot
        if acc:
            cdisks[cid] = acc
    return disks, pdisks, cdisks


# ---- Network: which interface each process talks through, and its TCP bytes (from ss -ti) ----
def net_users(ifaddr):
    users, cur = {}, None
    for line in run(["ss", "-tinpH", "state", "established"], timeout=8).splitlines():
        if line[:1] not in (" ", "\t"):
            addrs = [x for x in line.split() if ":" in x and not x.startswith("users:")]
            ifn = ""
            if addrs:
                ip = addrs[0].rsplit(":", 1)[0].strip("[]")
                if "%" in ip:
                    ip, ifn = ip.split("%", 1)
                ifn = ifn or ifaddr.get(ip.replace("::ffff:", ""), "")
            pids = re.findall(r"pid=(\d+)", line)
            cur = pids
            for pid in pids:
                u = users.setdefault(pid, {"ifs": [], "b": 0})
                if ifn and ifn not in u["ifs"]:
                    u["ifs"].append(ifn)
        elif cur:
            sent = re.search(r"bytes_(?:sent|acked):(\d+)", line)
            got = re.search(r"bytes_received:(\d+)", line)
            b = (int(sent.group(1)) if sent else 0) + (int(got.group(1)) if got else 0)
            for pid in cur:
                users[pid]["b"] += b
            cur = None
    return users


def snapshot():
    global out
    out = {"t": time.time(), "hz": HZ, "ncpu": os.cpu_count(), "host": os.uname()[1], "kernel": os.uname()[2]}
    osr = {}
    for line in rd("/etc/os-release").splitlines():
        k, _, v = line.partition("=")
        osr[k] = v.strip('"')
    unraid = rd("/etc/unraid-version").strip()
    out["os"] = ("Unraid " + unraid.split('"')[1]) if unraid.count('"') >= 2 else osr.get("PRETTY_NAME", "Linux")
    out["arch"] = os.uname()[4]
    out["uptime"] = float((rd("/proc/uptime").split() or ["0"])[0])
    stat_lines = rd("/proc/stat").splitlines()
    out["cpu"] = [int(x) for x in stat_lines[0].split()[1:]]
    # Logical processors: ticks, frequency, topology.
    lcpus = []
    for line in stat_lines[1:]:
        if not re.match(r"^cpu\d+ ", line):
            if lcpus:
                break
            continue
        f = line.split()
        n = f[0][3:]
        base = "/sys/devices/system/cpu/cpu%s/" % n
        mhz = rd(base + "cpufreq/scaling_cur_freq").strip()
        l3 = ""
        for idx in range(6):
            if rd(base + "cache/index%d/level" % idx).strip() == "3":
                l3 = rd(base + "cache/index%d/shared_cpu_list" % idx).strip()
                break
        lcpus.append({"n": int(n), "t": [int(x) for x in f[1:]], "mhz": round(int(mhz) / 1000) if mhz.isdigit() else 0,
                      "core": rd(base + "topology/core_id").strip(), "pkg": rd(base + "topology/physical_package_id").strip(),
                      "die": rd(base + "topology/die_id").strip(), "l3": l3})
    out["lcpus"] = lcpus


    def cpulist(s):
        got = set()
        for part in s.strip().split(","):
            if "-" in part:
                a, b = part.split("-")
                got.update(range(int(a), int(b) + 1))
            elif part.isdigit():
                got.add(int(part))
        return got


    # Hybrid CPUs (Intel P/E cores) list their CPUs under cpu_core and cpu_atom.
    p_cpus, e_cpus = cpulist(rd("/sys/devices/cpu_core/cpus")), cpulist(rd("/sys/devices/cpu_atom/cpus"))
    for c in lcpus:
        c["kind"] = "P" if c["n"] in p_cpus else "E" if c["n"] in e_cpus else ""
    out["cpu_model"] = (re.search(r"model name\s*:\s*(.+)", rd("/proc/cpuinfo")) or re.search(r"(.*)", "")).group(1).strip()
    mi = {}
    for line in rd("/proc/meminfo").splitlines():
        k, _, v = line.partition(":")
        if v.split():
            mi[k] = int(v.split()[0]) * 1024
    out["mem"] = [mi.get("MemTotal", 0), mi.get("MemAvailable", 0)]

    disk = 0
    for line in rd("/proc/diskstats").splitlines():
        f = line.split()
        if len(f) >= 14 and re.match(r"^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme\d+n\d+)$", f[2]):
            disk += (int(f[5]) + int(f[9])) * 512
    out["disk"] = disk

    # Interfaces: counters, whether physical, bridge master, state, addresses.
    ifs = {}
    for name, (rx, tx) in netdev(rd("/proc/net/dev")).items():
        base = "/sys/class/net/" + name
        master = os.path.basename(os.path.realpath(base + "/master")) if os.path.exists(base + "/master") else ""
        ifs[name] = {"rx": rx, "tx": tx, "phys": os.path.exists(base + "/device"), "master": master,
                     "bridge": os.path.exists(base + "/bridge"), "state": rd(base + "/operstate").strip(),
                     "speed": rd(base + "/speed").strip(), "addrs": []}
    ifaddr = {}
    try:
        for a in json.loads(run(["ip", "-j", "addr"]) or "[]"):
            for x in a.get("addr_info", []):
                ifaddr[x.get("local", "")] = a.get("ifname", "")
            if a.get("ifname") in ifs:
                ifs[a["ifname"]]["addrs"] = ["%s/%s" % (x["local"], x["prefixlen"]) for x in a.get("addr_info", []) if x.get("family") == "inet"]
    except Exception:
        pass
    out["ifs"] = ifs

    users = {}
    for line in rd("/etc/passwd").splitlines():
        f = line.split(":")
        if len(f) > 2:
            users[f[2]] = f[0]

    procs, first_pid_of = [], {}
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        s = rd("/proc/%s/stat" % pid)
        if not s:
            continue
        r = s.rfind(")")
        comm = s[s.find("(") + 1:r]
        f = s[r + 2:].split()
        try:
            uid = str(os.stat("/proc/" + pid).st_uid)
        except Exception:
            uid = ""
        cg = rd("/proc/%s/cgroup" % pid)
        m = re.search(r"(?:docker[-/]|libpod-)([0-9a-f]{64})", cg)
        cid = m.group(1)[:12] if m else ""
        m = re.search(r"/([^/\s]+\.service)", cg)
        unit = m.group(1) if m else ""
        io = rd("/proc/%s/io" % pid)
        rb = re.search(r"read_bytes: (\d+)", io)
        wb = re.search(r"write_bytes: (\d+)", io)
        iob = (int(rb.group(1)) + int(wb.group(1))) if rb and wb else -1
        cmd = rd("/proc/%s/cmdline" % pid).replace("\0", " ").strip()
        vm = ""
        if comm.startswith("qemu"):
            m = re.search(r"guest=([^,\s]+)", cmd)
            vm = m.group(1) if m else ""
            if vm:
                m = re.search(r"Cpus_allowed_list:\s*(\S+)", rd("/proc/%s/status" % pid))
                out.setdefault("vm_cpus", {})[vm] = m.group(1) if m else ""
        if cid and cid not in first_pid_of:
            first_pid_of[cid] = pid
        procs.append([int(pid), int(f[1]), comm, f[0], int(f[11]) + int(f[12]), int(f[21]) * PAGE,
                      int(f[17]), users.get(uid, uid), iob, cid, vm, unit, cmd[:300], int(f[36]) if len(f) > 36 else -1])
    out["procs"] = procs

    # Docker: containers with compose labels; per-container network from its namespace.
    containers = []
    for line in run(["docker", "ps", "--no-trunc", "--format", "{{json .}}"]).splitlines():
        try:
            c = json.loads(line)
        except Exception:
            continue
        labels = dict(kv.split("=", 1) for kv in c.get("Labels", "").split(",") if "=" in kv)
        cid = c.get("ID", "")[:12]
        host_ns = os.readlink("/proc/1/ns/net") if os.path.exists("/proc/1/ns/net") else ""
        try:
            own_ns = os.readlink("/proc/%s/ns/net" % first_pid_of[cid]) if cid in first_pid_of else ""
        except Exception:
            own_ns = ""
        # network_mode: host shares the host's namespace; its traffic is the host's, so don't count it again here
        net = netdev(rd("/proc/%s/net/dev" % first_pid_of[cid])) if cid in first_pid_of and own_ns and own_ns != host_ns else {}
        rx = sum(v[0] for k, v in net.items() if k != "lo")
        tx = sum(v[1] for k, v in net.items() if k != "lo")
        containers.append({"id": cid, "name": c.get("Names", ""), "image": c.get("Image", ""), "status": c.get("Status", ""),
                           "project": labels.get("com.docker.compose.project", ""),
                           "service": labels.get("com.docker.compose.service", ""),
                           "file": labels.get("com.docker.compose.project.config_files", ""),
                           "networks": c.get("Networks", ""), "rx": rx, "tx": tx})
    out["containers"] = containers
    try:
        out["pnet"] = net_users(ifaddr)
    except Exception:
        out["pnet"] = {}
    try:
        out["disks"], out["pdisks"], out["cdisks"] = disk_info(procs, containers)
    except Exception:
        out["disks"], out["pdisks"], out["cdisks"] = [], {}, {}
    nets = []
    for line in run(["docker", "network", "ls", "--format", "{{json .}}"]).splitlines():
        try:
            n = json.loads(line)
            nets.append({"id": n.get("ID", "")[:12], "name": n.get("Name", ""), "driver": n.get("Driver", "")})
        except Exception:
            pass
    out["dockernets"] = nets

    # Libvirt VMs and the tap interfaces they use.
    vms = []
    for name in run(["virsh", "list", "--name"]).split():
        ifaces = []
        for line in run(["virsh", "domiflist", name]).splitlines()[2:]:
            f = line.split()
            if len(f) >= 5:
                ifaces.append({"if": f[0], "source": f[2], "mac": f[4]})
        vms.append({"name": name, "ifs": ifaces})
    out["vms"] = vms

    # Scheduled jobs: crontabs and systemd timers.
    cron = []
    def add_cron(text, src):
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or re.match(r"^[A-Z_]+=", line):
                continue
            f = line.split()
            if f[0].startswith("@"):
                cron.append({"sched": f[0], "cmd": " ".join(f[1:]), "src": src})
            elif len(f) >= 6:
                user_col = src != "crontab" and len(f) >= 7
                cron.append({"sched": " ".join(f[:5]), "cmd": " ".join(f[6:] if user_col else f[5:]), "src": src})
    add_cron(run(["crontab", "-l"]), "crontab")
    add_cron(rd("/etc/crontab"), "/etc/crontab")
    try:
        for n in sorted(os.listdir("/etc/cron.d")):
            add_cron(rd("/etc/cron.d/" + n), "/etc/cron.d/" + n)
    except Exception:
        pass
    out["cron"] = cron
    timers = []
    for line in run(["systemctl", "list-timers", "--all", "--no-legend", "--no-pager"]).splitlines():
        m = re.search(r"(\S+\.timer)\s+(\S+\.service)\s*$", line)
        if m:
            timers.append({"timer": m.group(1), "unit": m.group(2), "line": line[:m.start()].strip()})
    out["timers"] = timers

    # NVIDIA GPUs and which processes use them.
    gpus = []
    # the newer fields fail the whole query on old drivers, so fall back to the basic one
    q = "index,name,utilization.gpu,memory.used,memory.total,pci.bus_id"
    extra = ",utilization.memory,temperature.gpu,power.draw,power.limit,clocks.gr,clocks.max.gr,clocks.mem,fan.speed,utilization.encoder,utilization.decoder"
    rows = run(["nvidia-smi", "--query-gpu=" + q + extra, "--format=csv,noheader,nounits"]).splitlines()
    if not any(line.count(",") >= 15 for line in rows):
        rows = run(["nvidia-smi", "--query-gpu=" + q, "--format=csv,noheader,nounits"]).splitlines()
    num = lambda x: float(x) if re.match(r"^-?\d+(\.\d+)?$", x) else None   # "[N/A]", "[Not Supported]" -> None
    for line in rows:
        f = [x.strip() for x in line.split(",")]
        if len(f) in (6, 16):
            bus = f[5].lower()
            bus = bus[4:] if re.match(r"^0000[0-9a-f]{4}:", bus) else bus  # 00000000:83:00.0 -> 0000:83:00.0
            g = {"index": int(f[0]), "name": f[1], "util": float(f[2] or 0), "memUsed": float(f[3] or 0), "memTotal": float(f[4] or 0), "pdev": bus}
            if len(f) == 16:
                for k, x in zip(("memUtil", "temp", "power", "powerLimit", "clock", "clockMax", "memClock", "fan", "enc", "dec"), f[6:]):
                    g[k] = num(x)
            gpus.append(g)
    try:
        cards = drm_gpus()
    except Exception:
        cards = []
    out["drm"] = cards
    try:
        out["gclients"] = gpu_clients(cards)
    except Exception:
        out["gclients"] = []
    for c in cards:  # which VM a passed-through GPU belongs to (the full QEMU command line names its PCI address)
        if c.get("passthrough"):
            for p in procs:
                if p[10]:
                    full = rd("/proc/%d/cmdline" % p[0]).replace("\0", " ")
                    if c["pdev"] in full or c["pdev"][5:] in full:
                        c["vm"] = p[10]
                        break
    out["gpus"] = gpus
    gproc = []
    if gpus:
        for line in run(["nvidia-smi", "pmon", "-c", "1", "-s", "u"], timeout=6).splitlines():
            f = line.split()
            if f and f[0].isdigit() and len(f) > 3 and f[1].isdigit():
                gproc.append([int(f[0]), int(f[1]), float(f[3]) if f[3].replace(".", "").isdigit() else 0.0])
    out["gproc"] = gproc

    return out


if __name__ == "__main__":   # also true for `python3 -` and `python3 -c`, as the server runs it; tests import it
    try:
        INTERVAL
    except NameError:
        INTERVAL = 3.0
    while True:
        began = time.time()
        data = json.dumps(snapshot(), separators=(",", ":")).encode()
        try:
            sys.stdout.write(base64.b64encode(zlib.compress(data, 3)).decode() + "\n")
            sys.stdout.flush()
        except (BrokenPipeError, OSError):
            os._exit(0)  # Fleet Live went away: stop
        time.sleep(max(0.2, INTERVAL - (time.time() - began)))
