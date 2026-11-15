# SPDX-License-Identifier: GPL-3.0-or-later
# Fleet Live: one read-only snapshot of a Linux machine, printed as JSON.
#
# Piped over SSH to `python3 -` on each Linux host; nothing is installed and
# nothing is changed. It only reads /proc and /sys and runs read-only listing
# commands (docker ps, virsh list/domiflist, crontab -l, systemctl list-timers,
# nvidia-smi, ip addr). Counters are cumulative; the Mac side turns them into
# rates by diffing two snapshots. It loops, printing one zlib+base64 JSON line
# every INTERVAL seconds (prepended by the collector), until SSH closes.
import base64, json, os, re, subprocess, sys, time, zlib

PAGE = os.sysconf("SC_PAGE_SIZE")
HZ = os.sysconf("SC_CLK_TCK")


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
    try:
        for a in json.loads(run(["ip", "-j", "addr"]) or "[]"):
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
        net = netdev(rd("/proc/%s/net/dev" % first_pid_of[cid])) if cid in first_pid_of else {}
        rx = sum(v[0] for k, v in net.items() if k != "lo")
        tx = sum(v[1] for k, v in net.items() if k != "lo")
        containers.append({"id": cid, "name": c.get("Names", ""), "image": c.get("Image", ""), "status": c.get("Status", ""),
                           "project": labels.get("com.docker.compose.project", ""),
                           "service": labels.get("com.docker.compose.service", ""),
                           "file": labels.get("com.docker.compose.project.config_files", ""),
                           "networks": c.get("Networks", ""), "rx": rx, "tx": tx})
    out["containers"] = containers
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
    for line in run(["nvidia-smi", "--query-gpu=index,name,utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"]).splitlines():
        f = [x.strip() for x in line.split(",")]
        if len(f) == 5:
            gpus.append({"index": int(f[0]), "name": f[1], "util": float(f[2] or 0), "memUsed": float(f[3] or 0), "memTotal": float(f[4] or 0)})
    out["gpus"] = gpus
    gproc = []
    if gpus:
        for line in run(["nvidia-smi", "pmon", "-c", "1", "-s", "u"], timeout=6).splitlines():
            f = line.split()
            if f and f[0].isdigit() and len(f) > 3 and f[1].isdigit():
                gproc.append([int(f[0]), int(f[1]), float(f[3]) if f[3].replace(".", "").isdigit() else 0.0])
    out["gproc"] = gproc

    return out


try:
    INTERVAL
except NameError:
    INTERVAL = 3.0
while True:
    began = time.time()
    data = json.dumps(snapshot(), separators=(",", ":")).encode()
    sys.stdout.write(base64.b64encode(zlib.compress(data, 3)).decode() + "\n")
    sys.stdout.flush()
    time.sleep(max(0.2, INTERVAL - (time.time() - began)))
