#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Fleet Live: every machine you manage, live, in one tree. Read-only.

Runs on macOS, Linux and Windows (Python 3.11+, standard library only).
Each machine in ~/.config/fleet/machines.toml is watched by one thread:
  - kind = "local":   this computer, read directly
  - os = "linux":     collect_linux.py piped to `python3 -` over SSH
  - os = "windows":   collect_windows.ps1 sent as `powershell -EncodedCommand`
The remote collectors loop and stream one reading per interval until the SSH
connection closes. Nothing is installed on any machine and nothing is changed.

Usage: python3 fleet_live.py [--port 4518] [--config PATH] [--open]
"""
import argparse, base64, collections, ctypes, ctypes.util, glob, http.server, json, os, platform, plistlib, shlex
import re, shutil, subprocess, sys, threading, time, tomllib, urllib.parse, webbrowser, zlib

VERSION = "0.1.0"
HERE = os.path.dirname(os.path.abspath(__file__))
H = 60
METRICS = ("cpu", "mem", "gpu", "disk", "net")
CONFIG_PATH = os.path.expanduser("~/.config/fleet/machines.toml")
LAST_CLIENT = [0.0]   # when a Fleet window last asked for data
PINS_PATH = os.path.expanduser("~/.config/fleet/pins.json")
PINS_LOCK = threading.Lock()


def load_pins():
    try:
        with open(PINS_PATH) as f:
            pins = json.load(f)
        return [p for p in pins if isinstance(p, str)][:40]
    except Exception:
        return []


def save_pins(pins):
    with PINS_LOCK:
        os.makedirs(os.path.dirname(PINS_PATH), exist_ok=True)
        tmp = PINS_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(pins, f, indent=1)
        os.replace(tmp, PINS_PATH)


# ---------------------------------------------------------------- history
class Hist:
    """Last H readings per node id and metric."""
    def __init__(self):
        self.d = {}
        self.lock = threading.Lock()

    def push(self, key, vals):
        with self.lock:
            q = self.d.get(key)
            if q is None:
                q = self.d[key] = [collections.deque([0.0] * H, maxlen=H) for _ in vals]
            for i, v in enumerate(vals):
                q[i].append(round(float(v), 4))

    def get(self, key, n=5):
        with self.lock:
            q = self.d.get(key)
            return [list(x) for x in q] if q else [[0.0] * H for _ in range(n)]


HIST = Hist()


def hist_obj(key):
    return dict(zip(METRICS, HIST.get(key)))


# ---------------------------------------------------------------- helpers
def run(cmd, timeout=10):
    try:
        return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout).stdout.decode("utf-8", "replace")
    except Exception:
        return ""


def human_cron(s):
    f = s.split()
    if s.startswith("@"):
        return s[1:]
    if len(f) != 5:
        return s
    mi, hr, dom, mon, dow = f
    if mi.startswith("*/") and hr == "*" and dom == mon == dow == "*":
        return "every %s min" % mi[2:]
    if mi.isdigit() and hr == "*" and dom == mon == dow == "*":
        return "hourly at :%02d" % int(mi)
    if mi.isdigit() and hr.startswith("*/") and dom == mon == dow == "*":
        return "every %s h" % hr[2:]
    if mi.isdigit() and hr.isdigit() and dom == mon == "*" and dow == "*":
        return "daily at %02d:%02d" % (int(hr), int(mi))
    if mi.isdigit() and hr.isdigit() and dom == mon == "*":
        return "weekly (%s) at %02d:%02d" % (dow, int(hr), int(mi))
    if mi.isdigit() and hr.isdigit() and dom.isdigit() and mon == "*":
        return "monthly, day %s at %02d:%02d" % (dom, int(hr), int(mi))
    return s


def cpulist(s):
    got = []
    for part in (s or "").split(","):
        if "-" in part:
            a, b = part.split("-")
            got.extend(range(int(a), int(b) + 1))
        elif part.strip().isdigit():
            got.append(int(part))
    return got


def slug(s):
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", s).strip("-") or "x"


def size_bytes(s):
    m = re.match(r"([\d.]+)\s*([kKMGT]?i?B)", s.strip())
    if not m:
        return 0.0
    mult = {"B": 1, "kB": 1e3, "KB": 1e3, "KiB": 1024, "MB": 1e6, "MiB": 2**20, "GB": 1e9, "GiB": 2**30, "TB": 1e12, "TiB": 2**40}
    return float(m.group(1)) * mult.get(m.group(2), 1)


GB = 2**30
MB = 1e6
# Every collector SSH session starts with exactly these options, so leftovers from an
# earlier Fleet Live run can be found (and only those) by their command line.
SSH_MARK = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15",
            "-o", "ServerAliveCountMax=2", "-o", "LogLevel=ERROR"]


def reap_leftover_collectors():
    """Stop collector SSH sessions left by an earlier run (orphaned, or children of this pid from before an exec)."""
    if platform.system() == "Windows":
        return 0
    mark = "ssh " + " ".join(SSH_MARK) + " "
    killed = 0
    for line in run(["ps", "-axo", "pid=,ppid=,command="]).splitlines():
        f = line.strip().split(None, 2)
        if len(f) == 3 and f[2].startswith(mark) and int(f[1]) in (1, os.getpid()):
            try:
                os.kill(int(f[0]), 15)
                killed += 1
            except OSError:
                pass
    return killed


def stop_collectors(fleet):
    for m in fleet.machines.values():
        p = m.proc
        if p and p.poll() is None:
            try:
                p.terminate()
            except Exception:
                pass


# ---------------------------------------------------------------- machine
class Machine:
    def __init__(self, cfg, interval):
        self.cfg = cfg
        self.id = cfg["id"]
        self.name = cfg.get("name", self.id)
        self.interval = interval
        self.status = "connecting"
        self.error = ""
        self.prev = None
        self.view = None          # derived, see derive_*()
        self.cum = {}             # cumulative counters from the previous reading
        self.disk_peak = 500 * MB
        self.lock = threading.Lock()
        self.proc = None
        self.last_ok = 0.0          # when the last good reading arrived
        self.wake = threading.Event()  # Retry now
        self.thread = threading.Thread(target=self.loop, daemon=True, name="fleet-" + self.id)

    # One thread per machine; reconnect with backoff.
    def loop(self):
        backoff = 5
        while True:
            try:
                if self.cfg.get("kind") == "local":
                    self.local_loop()
                else:
                    self.ssh_loop()
                backoff = 5
            except Exception as e:  # never die; show it
                self.set_status("offline", "collector error: %s" % e)
            self.wake.wait(backoff)
            self.wake.clear()
            backoff = min(60, backoff * 2)

    def got(self, view):
        with self.lock:
            self.view, self.status, self.error, self.last_ok = view, "ok", "", time.time()

    def set_status(self, status, error=""):
        with self.lock:
            self.status, self.error = status, error

    def ssh_cmd(self):
        base = ["ssh"] + SSH_MARK + [self.cfg["ssh"]]
        if self.cfg.get("os") == "windows":
            script = "$FleetInterval=%s\n" % self.interval + open(os.path.join(HERE, "collect_windows.ps1"), encoding="utf-8").read()
            enc = base64.b64encode(script.encode("utf-16-le")).decode()
            return base + ["powershell -NoProfile -NonInteractive -EncodedCommand " + enc], None
        script = "INTERVAL=%s\n" % self.interval + open(os.path.join(HERE, "collect_linux.py"), encoding="utf-8").read()
        return base + ["python3 -"], script.encode()

    def ssh_loop(self):
        cmd, stdin = self.ssh_cmd()
        self.set_status("connecting")
        p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.proc = p
        if stdin:
            p.stdin.write(stdin)
        p.stdin.close()
        err_tail = collections.deque(maxlen=5)
        threading.Thread(target=lambda: [err_tail.append(l.decode("utf-8", "replace").strip()) for l in p.stderr], daemon=True).start()
        for line in p.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                if self.cfg.get("os") == "windows":
                    s = line.decode("utf-8", "replace")
                    if not s.startswith("{"):
                        continue
                    raw = json.loads(s)
                    view = self.derive_windows(raw)
                else:
                    raw = json.loads(zlib.decompress(base64.b64decode(line)))
                    view = self.derive_linux(raw)
            except Exception as e:
                err_tail.append("bad reading: %s" % e)
                continue
            if view:
                self.got(view)
        p.wait()
        msg = " ".join(x for x in err_tail if x) or "connection closed (exit %s)" % p.returncode
        self.set_status("offline", msg[:300])

    def local_loop(self):
        if platform.system() == "Darwin":
            c = MacCollector()
            while True:
                began = time.time()
                view = self.derive_generic(c.snapshot())
                if view:
                    self.got(view)
                time.sleep(max(0.3, self.interval - (time.time() - began)))
        elif platform.system() == "Linux":
            env = dict(os.environ)
            p = subprocess.Popen([sys.executable, "-c", "INTERVAL=%s\n" % self.interval + open(os.path.join(HERE, "collect_linux.py")).read()],
                                 stdout=subprocess.PIPE)
            for line in p.stdout:
                view = self.derive_linux(json.loads(zlib.decompress(base64.b64decode(line.strip()))))
                if view:
                    self.got(view)
        elif platform.system() == "Windows":
            script = "$FleetInterval=%s\n" % self.interval + open(os.path.join(HERE, "collect_windows.ps1"), encoding="utf-8").read()
            enc = base64.b64encode(script.encode("utf-16-le")).decode()
            p = subprocess.Popen(["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand", enc], stdout=subprocess.PIPE)
            for line in p.stdout:
                s = line.decode("utf-8", "replace").strip()
                if s.startswith("{"):
                    view = self.derive_windows(json.loads(s))
                    if view:
                        self.got(view)

    def rate(self, key, value, t):
        """Per-second rate of a cumulative counter since the previous reading."""
        prev = self.cum.get(key)
        self.cum[key] = (value, t)
        if not prev or t <= prev[1] or value < prev[0]:
            return 0.0
        return (value - prev[0]) / (t - prev[1])

    # ------------------------------------------------------------ linux
    def derive_linux(self, r):
        t = r["t"]
        ncpu = r["ncpu"]
        hz = r["hz"]
        cpu = r["cpu"]
        busy = sum(cpu[:8]) - cpu[3] - cpu[4]
        tot = sum(cpu[:8])
        b, tt = self.rate("cpu.busy", busy, t), self.rate("cpu.tot", tot, t)
        host_cpu = (b / tt * ncpu) if tt else 0.0
        lcpus = []
        for c in r["lcpus"]:
            lb = sum(c["t"][:8]) - c["t"][3] - c["t"][4]
            lt = sum(c["t"][:8])
            x, y = self.rate("lcpu.b.%d" % c["n"], lb, t), self.rate("lcpu.t.%d" % c["n"], lt, t)
            lcpus.append({"n": c["n"], "pct": (100.0 * x / y) if y else 0.0, "mhz": c.get("mhz", 0),
                          "core": c.get("core", ""), "l3": c.get("l3", ""), "kind": c.get("kind", ""), "pkg": c.get("pkg", "")})
        groups = group_lcpus_linux(lcpus)
        mem_used = (r["mem"][0] - r["mem"][1]) / GB
        disk = self.rate("disk", r["disk"], t) / MB
        self.disk_peak = max(self.disk_peak, disk * MB * 1.25)
        phys = [k for k, v in r["ifs"].items() if v["phys"]]
        net = sum(self.rate("if.%s" % k, r["ifs"][k]["rx"] + r["ifs"][k]["tx"], t) for k in phys) / MB
        speed = sum(int(r["ifs"][k]["speed"]) for k in phys if str(r["ifs"][k]["speed"]).lstrip("-").isdigit() and int(r["ifs"][k]["speed"]) > 0)
        net_cap = (speed / 8.0) if speed else 125.0
        ifs = []
        for k, v in r["ifs"].items():
            rx, tx = self.rate("ifrx.%s" % k, v["rx"], t), self.rate("iftx.%s" % k, v["tx"], t)
            kind = "physical" if v["phys"] else "bridge" if v["bridge"] else "loopback" if k == "lo" else "virtual"
            ifs.append({"name": k, "kind": kind, "rx": rx / MB, "tx": tx / MB, "addrs": v.get("addrs", []), "master": v.get("master", ""),
                        "state": v.get("state", ""), "speed": v.get("speed", "")})

        # Processes: per-process rates; owner = container, VM, timer unit or base.
        gpu_by_pid = {}
        for g in r.get("gproc", []):
            gpu_by_pid[g[1]] = gpu_by_pid.get(g[1], 0) + g[2]
        slot = {g["index"]: i for i, g in enumerate(r.get("gpus", []))}  # nvidia-smi index -> position in gpus
        gpu_on = gpus_by_pid((g[1], slot[g[0]]) for g in r.get("gproc", []) if g[0] in slot)
        procs = []
        cont_u, vm_u, unit_u = {}, {}, {}
        by_pid = {}
        for p in r["procs"]:
            pid, ppid, comm, state, ticks, rss, threads, user, iob, cid, vm, unit, cmd = p[:13]
            lastcpu = p[13] if len(p) > 13 else -1
            c = self.rate("p.%d.t" % pid, ticks, t) / hz
            d = self.rate("p.%d.io" % pid, iob, t) / MB if iob >= 0 else 0.0
            g = gpu_by_pid.get(pid, 0.0)
            row = [pid, ppid, comm, user, state, c, rss / GB, d, g, threads, cmd, "", lastcpu, gpu_on.get(pid, [])]
            procs.append(row)
            by_pid[pid] = row
            u = [c, rss / GB, g, d, 0.0]
            if cid:
                acc = cont_u.setdefault(cid, [0.0] * 5)
            elif vm:
                acc = vm_u.setdefault(vm, [0.0] * 5)
            elif unit:
                acc = unit_u.setdefault(unit, [0.0] * 5)
            else:
                acc = None
            if acc is not None:
                for i in range(4):
                    acc[i] += u[i]
        self.prune(t)
        containers = []
        for c in r["containers"]:
            u = cont_u.get(c["id"], [0.0] * 5)
            u[4] = self.rate("c.%s.net" % c["id"], c["rx"] + c["tx"], t) / MB
            containers.append(dict(c, u=u))
        vmmap = {v["name"]: v for v in r.get("vms", [])}
        vms = []
        for name, v in vmmap.items():
            u = vm_u.get(name, [0.0] * 5)
            u[4] = sum(x["rx"] + x["tx"] for x in ifs if x["name"] in [i["if"] for i in v["ifs"]])
            vms.append({"name": name, "u": u, "running": True, "ifs": v["ifs"], "cpus": (r.get("vm_cpus") or {}).get(name, "")})
        # Scheduled jobs: crontab lines (deduplicated) and systemd timers.
        jobs, seen = [], set()
        for c in r.get("cron", []):
            k = (c["sched"], c["cmd"])
            if k in seen:
                continue
            seen.add(k)
            jobs.append({"name": job_name(c["cmd"]), "sched": c["sched"], "human": human_cron(c["sched"]), "cmd": c["cmd"],
                         "src": c["src"], "last": "", "running": False, "u": [0.0] * 5})
        cron_daemons = {p[0] for p in r["procs"] if p[2] in ("cron", "crond")}
        for row in procs:
            if row[1] in cron_daemons or by_pid.get(row[1], [0, 0])[1] in cron_daemons:
                j = match_job(jobs, row[2], row[10])
                if j is not None:
                    j["running"] = True
                    for i, v in enumerate((row[5], row[6], row[8], row[7])):
                        j["u"][(0, 1, 2, 3)[i]] += v
                    row[11] = "job:%d" % jobs.index(j)
        for tm in r.get("timers", []):
            u = unit_u.get(tm["unit"], [0.0] * 5)
            line = tm["line"].split()
            jobs.append({"name": tm["timer"].replace(".timer", ""), "sched": "systemd timer", "human": "timer",
                         "cmd": tm["unit"], "src": "systemd", "last": " ".join(line[-6:-4]) if len(line) > 6 else "",
                         "running": tm["unit"] in unit_u, "u": u})
        gpus = [{"name": g["name"], "mem": "%d GB VRAM" % round(g["memTotal"] / 1024) if g["memTotal"] else "", "util": g["util"]} for g in r.get("gpus", [])]
        gpu_total = sum(g["util"] for g in gpus)
        owner = {}
        for p in r["procs"]:
            if p[9]:
                owner[p[0]] = "c:" + p[9]
            elif p[10]:
                owner[p[0]] = "vm:" + p[10]
            elif p[11] and any(j["cmd"] == p[11] for j in jobs):
                owner[p[0]] = "unit:" + p[11]
        for row in procs:
            if not row[11]:
                row[11] = owner.get(row[0], "base")
        return {
            "t": t, "os": r["os"], "arch": r.get("arch", ""), "cpu_model": r.get("cpu_model", ""), "ncpu": ncpu,
            "uptime": r.get("uptime", 0), "host": [host_cpu, mem_used, gpu_total, disk, net],
            "cap": [ncpu, r["mem"][0] / GB, 100.0 * len(gpus), self.disk_peak / MB, net_cap],
            "gpus": gpus, "lcpus": lcpus, "groups": groups, "containers": containers, "vms": vms, "jobs": jobs,
            "procs": procs, "ifs": ifs, "dockernets": r.get("dockernets", []), "cronLabel": "Cron jobs",
            "gpu_procs": bool(gpus),  # nvidia-smi pmon names each process's GPUs (p[13])
        }

    def prune(self, t):
        if len(self.cum) > 40000:
            cutoff = t - 30
            self.cum = {k: v for k, v in self.cum.items() if v[1] >= cutoff}

    # ------------------------------------------------------------ windows
    def derive_windows(self, r):
        for k in ("lcpus", "topo", "gpus", "nvidia", "videoNames", "gproc", "procs", "ifs", "wsl", "containers", "dstats", "tasks"):
            r[k] = aslist(r.get(k))
        for a in r["ifs"]:
            a["addrs"] = [x for x in aslist(a.get("addrs")) if isinstance(x, str) and x]  # an empty list arrives as {}
        for tk in r["tasks"]:
            tk["triggers"] = aslist(tk.get("triggers"))
        t = r["t"]
        ncpu = r["ncpu"]
        lc = sorted(r.get("lcpus", []), key=lambda x: x["n"])
        topo = r.get("topo") or []
        if topo:
            self.cum["__topo"] = (topo, 0)
        topo = self.cum.get("__topo", ([], 0))[0]
        tmap = {}
        for s in topo:
            n, core, eff, l3 = (int(x) for x in s.split(":"))
            tmap[n] = (core, eff, l3)
        lcpus = [{"n": c["n"], "pct": c["pct"], "mhz": c.get("mhz", 0), "core": str(tmap.get(c["n"], ("",))[0]),
                  "eff": tmap.get(c["n"], (0, 0, -1))[1], "l3": str(tmap.get(c["n"], (0, 0, -1))[2])} for c in lc]
        groups = group_lcpus_windows(lcpus)
        host_cpu = sum(c["pct"] for c in lc) / 100.0
        mem_used = (r["mem"][0] - r["mem"][1]) / GB
        disk = float(r.get("diskBps") or 0) / MB
        self.disk_peak = max(self.disk_peak, disk * MB * 1.25)
        ifs, net, speed = [], 0.0, 0.0
        for a in r.get("ifs", []):
            rx, tx = self.rate("ifrx." + a["name"], a["rx"], t) / MB, self.rate("iftx." + a["name"], a["tx"], t) / MB
            kind = "virtual" if a.get("virtual") else "physical"
            ifs.append({"name": a["name"], "kind": kind, "rx": rx, "tx": tx, "addrs": a.get("addrs") or [], "master": "",
                        "state": a.get("status", ""), "speed": a.get("speed", ""), "desc": a.get("desc", "")})
            if kind == "physical" and a.get("status") == "Up":
                net += rx + tx
                m = re.match(r"([\d.]+)\s*([GMK])bps", a.get("speed", ""))
                if m:
                    speed += float(m.group(1)) * {"G": 1000, "M": 1, "K": 0.001}[m.group(2)]
        # GPUs: adapters ordered by dedicated memory; NVIDIA names from nvidia-smi when present.
        nv = [x.split(", ") for x in r.get("nvidia", []) if x and x.count(",") >= 4]
        names = [x[1] for x in nv] + [n for n in r.get("videoNames", []) if not any(n == x[1] for x in nv)]
        gpus, luid_idx = [], {}
        for i, g in enumerate(r.get("gpus", [])):
            luid_idx[g["luid"]] = i
            mem = ""
            if i < len(nv) and nv[i][4].strip().isdigit():
                mem = "%d GB VRAM" % round(int(nv[i][4]) / 1024)
            gpus.append({"name": names[i] if i < len(names) else "GPU %d" % i, "mem": mem, "util": min(100.0, g.get("util", 0))})
        gpu_by_pid = {}
        for pid, luid, pct in r.get("gproc", []):
            if luid in luid_idx:
                gpu_by_pid.setdefault(pid, {})[luid_idx[luid]] = gpu_by_pid.get(pid, {}).get(luid_idx[luid], 0) + pct
        procs, vm_u = [], [0.0] * 5
        for p in r.get("procs", []):
            pid, ppid, name, c, ws, threads, io, cmd = p
            g = sum(gpu_by_pid.get(pid, {}).values())
            row = [pid, ppid, name, "", "", c, ws / GB, io / MB, g, threads, cmd, "base", -1, sorted(gpu_by_pid.get(pid, {}))]
            if name.lower() in ("vmmem", "vmmemwsl"):
                row[11] = "vm:WSL"
                for i, v in enumerate((c, ws / GB, g, io / MB)):
                    vm_u[i] += v
            procs.append(row)
        containers = []
        stats = {}
        for line in r.get("dstats", []):
            try:
                s = json.loads(line)
            except Exception:
                continue
            nio = s.get("NetIO", "0B / 0B").split("/")
            bio = s.get("BlockIO", "0B / 0B").split("/")
            stats[s.get("ID", "")[:12]] = (float(s.get("CPUPerc", "0%").rstrip("%") or 0) / 100.0,
                                           size_bytes(s.get("MemUsage", "0B").split("/")[0]) / GB,
                                           sum(size_bytes(x) for x in bio), sum(size_bytes(x) for x in nio))
        for line in r.get("containers", []):
            try:
                c = json.loads(line)
            except Exception:
                continue
            labels = dict(kv.split("=", 1) for kv in c.get("Labels", "").split(",") if "=" in kv)
            cid = c.get("ID", "")[:12]
            st = stats.get(cid, (0, 0, 0, 0))
            u = [st[0], st[1], 0.0, self.rate("cb." + cid, st[2], t) / MB, self.rate("cn." + cid, st[3], t) / MB]
            containers.append({"id": cid, "name": c.get("Names", ""), "image": c.get("Image", ""), "status": c.get("Status", ""),
                               "project": labels.get("com.docker.compose.project", ""), "service": labels.get("com.docker.compose.service", ""),
                               "file": labels.get("com.docker.compose.project.config_files", ""), "networks": c.get("Networks", ""), "u": u})
        # The WSL utility VM also runs Docker Desktop's containers: they are listed on their own, the rest is the VM's.
        for i in range(5):
            vm_u[i] = max(0.0, vm_u[i] - sum(c["u"][i] for c in containers))
        running = [w["name"] for w in r.get("wsl", []) if w.get("state") == "Running"]
        vms = []
        if r.get("wsl"):
            vms.append({"name": "WSL", "u": vm_u, "running": bool(running), "ifs": [], "distros": r.get("wsl", []), "cpus": ""})
        jobs = []
        for tk in r.get("tasks", []):
            trig = ", ".join(tk.get("triggers") or []) or "on demand"
            jobs.append({"name": tk["name"], "sched": trig, "human": trig, "cmd": tk.get("cmd", ""), "src": tk.get("path", "\\"),
                         "last": tk.get("last", ""), "next": tk.get("next", ""), "running": tk.get("state") == "Running",
                         "state": tk.get("state", ""), "u": [0.0] * 5})
        return {
            "t": t, "os": r.get("os", "Windows"), "arch": r.get("arch", ""), "cpu_model": r.get("cpu_model", ""), "ncpu": ncpu,
            "uptime": r.get("uptime", 0), "host": [host_cpu, mem_used, sum(g["util"] for g in gpus), disk, net],
            "cap": [ncpu, r["mem"][0] / GB, 100.0 * len(gpus), self.disk_peak / MB, (speed / 8.0) if speed else 125.0],
            "gpus": gpus, "lcpus": lcpus, "groups": groups, "containers": containers, "vms": vms, "jobs": jobs,
            "procs": procs, "ifs": ifs, "dockernets": [], "cronLabel": "Scheduled tasks",
            "gpu_procs": bool(gpus),  # GPU engine counters name each process's adapters (p[13])
        }

    # ------------------------------------------------------------ macOS (already rates)
    def derive_generic(self, r):
        return r


def aslist(x):
    """PowerShell's ConvertTo-Json turns one-item arrays into a bare value; undo that."""
    if x is None or x == "":
        return []
    return x if isinstance(x, list) else [x]


def job_name(cmd):
    toks = [x for x in re.split(r"\s+", cmd) if x and not x.startswith("-") and x not in ("cd", "&&", "test", "-x", "||", "{", "}", "/", "sh", "bash", "-c")]
    for tok in toks:
        b = os.path.basename(tok.strip("'\";"))
        if b and b not in ("run-parts", "nice", "ionice", "env", "flock", "timeout", "sudo", "php", "python3", "python"):
            return b[:48]
    return (toks[0] if toks else cmd)[:48]


def match_job(jobs, comm, cmd):
    for j in jobs:
        if comm and (comm in j["cmd"] or (cmd and cmd.split()[0] in j["cmd"])):
            return j
    return None


def gpus_by_pid(pairs):
    """{pid: sorted GPU positions} from (pid, position) pairs: the GPUs each process has a context on."""
    out = {}
    for pid, pos in pairs:
        out.setdefault(pid, set()).add(pos)
    return {pid: sorted(v) for pid, v in out.items()}


def group_lcpus_linux(lcpus):
    groups = collections.OrderedDict()
    kinds = {c["kind"] for c in lcpus if c["kind"]}
    for c in lcpus:
        if kinds:
            key = ("P-cores" if c["kind"] == "P" else "E-cores") + ((" · L3 " + c["l3"]) if len({x["l3"] for x in lcpus}) > 2 else "")
        elif len({x["l3"] for x in lcpus if x["l3"]}) > 1:
            idx = sorted({x["l3"] for x in lcpus if x["l3"]}, key=lambda s: cpulist(s)[0]).index(c["l3"]) if c["l3"] else 0
            key = "CCD %d" % idx
        else:
            key = "All processors"
        if len({x["pkg"] for x in lcpus}) > 1:
            key = "Socket %s · %s" % (c["pkg"], key)
        groups.setdefault(key, []).append(c["n"])
    return [{"name": k, "cpus": v} for k, v in groups.items()]


def group_lcpus_windows(lcpus):
    groups = collections.OrderedDict()
    effs = sorted({c.get("eff", 0) for c in lcpus})
    l3s = sorted({c["l3"] for c in lcpus if c["l3"] not in ("", "-1")})
    for c in lcpus:
        if len(effs) > 1:
            key = "P-cores" if c.get("eff", 0) == effs[-1] else "E-cores"
        elif len(l3s) > 1:
            key = "CCD %d" % l3s.index(c["l3"]) if c["l3"] in l3s else "CCD ?"
        else:
            key = "All processors"
        groups.setdefault(key, []).append(c["n"])
    return [{"name": k, "cpus": v} for k, v in groups.items()]


# ---------------------------------------------------------------- macOS collector
class MacCollector:
    """This Mac, read directly: ps, host_processor_info, vm_stat, iostat, netstat, ioreg, docker, crontab, launchd."""

    def __init__(self):
        self.prev = {}
        self.ncpu = int(run(["sysctl", "-n", "hw.logicalcpu"]).strip() or os.cpu_count())
        self.memsize = int(run(["sysctl", "-n", "hw.memsize"]).strip() or 0)
        self.model = run(["sysctl", "-n", "machdep.cpu.brand_string"]).strip()
        self.osver = "macOS " + platform.mac_ver()[0]
        self.groups = self.read_groups()
        self.libc = ctypes.CDLL(ctypes.util.find_library("c"))
        self.disk_peak = 500 * MB
        self.last_slow = 0
        self.jobs_cache = []
        self.docker_cache = ([], {})

    def read_groups(self):
        levels = {}
        for i in range(int(run(["sysctl", "-n", "hw.nperflevels"]).strip() or 0)):
            name = run(["sysctl", "-n", "hw.perflevel%d.name" % i]).strip()
            per_l2 = int(run(["sysctl", "-n", "hw.perflevel%d.cpusperl2" % i]).strip() or 0)
            count = int(run(["sysctl", "-n", "hw.perflevel%d.logicalcpu" % i]).strip() or 0)
            levels[i] = (name, per_l2, count)
        try:
            rows = plistlib.loads(subprocess.run(["ioreg", "-rd1", "-c", "IOPlatformDevice", "-k", "cluster-type", "-a"],
                                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10).stdout)
            ctype = {}
            for x in rows:
                cid = x.get("cpu-id")
                cid = int.from_bytes(cid, "little") if isinstance(cid, bytes) else int(cid)
                ctype[cid] = x.get("cluster-type", b"").decode().strip("\0")
        except Exception:
            ctype = {}
        if not ctype:
            return [{"name": "All processors", "cpus": list(range(self.ncpu))}]
        # Match cluster types to perf levels by count (largest-performance level first).
        by_type = collections.OrderedDict()
        for n in sorted(ctype):
            by_type.setdefault(ctype[n], []).append(n)
        groups = []
        for ct, cpus in by_type.items():
            lvl = next((v for v in levels.values() if v[2] == len(cpus)), (ct, len(cpus), len(cpus)))
            name, per_l2 = lvl[0] or ct, lvl[1] or len(cpus)
            chunks = [cpus[i:i + per_l2] for i in range(0, len(cpus), per_l2)]
            for k, ch in enumerate(chunks):
                groups.append({"name": "%s cores%s" % (name, (" · cluster %d" % k) if len(chunks) > 1 else ""), "cpus": ch})
        return groups

    def cpu_ticks(self):
        host = self.libc.mach_host_self()
        count = ctypes.c_uint()
        info = ctypes.POINTER(ctypes.c_int)()
        n_info = ctypes.c_uint()
        rc = self.libc.host_processor_info(host, 2, ctypes.byref(count), ctypes.byref(info), ctypes.byref(n_info))
        if rc != 0:
            return []
        ticks = [[info[i * 4 + j] for j in range(4)] for i in range(count.value)]  # user, system, idle, nice
        return ticks

    def rate(self, key, value, t):
        prev = self.prev.get(key)
        self.prev[key] = (value, t)
        if not prev or t <= prev[1] or value < prev[0]:
            return 0.0
        return (value - prev[0]) / (t - prev[1])

    def snapshot(self):
        t = time.time()
        lcpus = []
        busy_tot = 0.0
        for n, tk in enumerate(self.cpu_ticks()):
            b, a = self.rate("lb%d" % n, tk[0] + tk[1] + tk[3], t), self.rate("la%d" % n, sum(tk), t)
            pct = 100.0 * b / a if a else 0.0
            busy_tot += pct / 100.0
            lcpus.append({"n": n, "pct": pct, "mhz": 0})
        vm = run(["vm_stat"])
        page = int((re.search(r"page size of (\d+)", vm) or re.search(r"(16384)", "16384")).group(1))
        def pages(label):
            m = re.search(r"%s:\s+(\d+)" % re.escape(label), vm)
            return int(m.group(1)) if m else 0
        used = (pages("Anonymous pages") - pages("Pages purgeable") + pages("Pages wired down") + pages("Pages occupied by compressor")) * page
        if used <= 0:
            used = (pages("Pages active") + pages("Pages wired down") + pages("Pages occupied by compressor")) * page
        mem_used = used / GB
        io = run(["iostat", "-Id"]).split("\n")
        disk_mb = 0.0
        if len(io) >= 3:
            nums = io[2].split()
            disk_mb = sum(float(nums[i]) for i in range(2, len(nums), 3) if re.match(r"^[\d.]+$", nums[i]))
        disk = self.rate("disk", disk_mb, t)
        self.disk_peak = max(self.disk_peak, disk * MB * 1.25)
        ifs, net = [], 0.0
        for line in run(["netstat", "-ib"]).splitlines()[1:]:
            f = line.split()
            if len(f) >= 10 and f[2].startswith("<Link#"):
                name = f[0]
                if f[0].rstrip("*") in [x["name"] for x in ifs]:
                    continue
                rxb, txb = int(f[-5]) if f[-5].isdigit() else 0, int(f[-2]) if f[-2].isdigit() else 0
                rx, tx = self.rate("rx" + name, rxb, t) / MB, self.rate("tx" + name, txb, t) / MB
                kind = "physical" if re.match(r"^en\d+$", name) else "loopback" if name.startswith("lo") else "bridge" if name.startswith("bridge") else "virtual"
                ifs.append({"name": name, "kind": kind, "rx": rx, "tx": tx, "addrs": [], "master": "", "state": "", "speed": ""})
                if kind == "physical":
                    net += rx + tx
        for line in run(["ifconfig"]).splitlines():
            m = re.match(r"^(\S+):", line)
            if m:
                cur_if = m.group(1)
            m = re.search(r"inet (\d+\.\d+\.\d+\.\d+) netmask (0x[0-9a-f]+)", line)
            if m:
                bits = bin(int(m.group(2), 16)).count("1")
                for x in ifs:
                    if x["name"] == cur_if:
                        x["addrs"].append("%s/%d" % (m.group(1), bits))
        gpu = 0.0
        m = re.search(r'"Device Utilization %"=(\d+)', run(["ioreg", "-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"]))
        if m:
            gpu = float(m.group(1))
        # Processes: CPU from cumulative cpu time deltas.
        procs = []
        args = {}
        for line in run(["ps", "-A", "-o", "pid=,args="]).splitlines():
            line = line.strip()
            if line:
                pid, _, a = line.partition(" ")
                args[int(pid)] = a.strip()[:300]
        for line in run(["ps", "-A", "-o", "pid=,ppid=,user=,state=,rss=,time=,comm="]).splitlines():
            f = line.split(None, 6)
            if len(f) < 7:
                continue
            pid = int(f[0])
            secs = parse_cputime(f[5])
            c = self.rate("p%d" % pid, secs, t)
            procs.append([pid, int(f[1]), os.path.basename(f[6]), f[2], f[3], c, int(f[4]) * 1024 / GB, 0.0, 0.0, 0, args.get(pid, f[6]), "base", -1])
        if len(self.prev) > 20000:
            self.prev = {k: v for k, v in self.prev.items() if v[1] >= t - 30}
        # VMs: Virtualization.framework, QEMU and Parallels processes (Docker Desktop's VM is not a VM here).
        by_pid = {p[0]: p for p in procs}
        def ancestry(p):
            seen, out = 0, []
            while p and seen < 20:
                out.append(p[10])
                p = by_pid.get(p[1])
                seen += 1
            return " ".join(out)
        vms = {}
        docker_vm = None
        for p in procs:
            a = p[10]
            if "com.apple.Virtualization.VirtualMachine" in a or re.search(r"qemu-system-\w+", a) or "prl_vm_app" in a:
                anc = ancestry(p).lower()
                if "docker" in anc:
                    docker_vm = p
                    p[11] = "dockervm"
                    continue
                m = re.search(r"([^/]+)\.utm", a) or re.search(r"-name\s+(?:guest=)?([^,\s]+)", a) or re.search(r"([^/]+)\.pvm", a)
                name = m.group(1) if m else ("UTM VM" if "utm" in anc else "VM %d" % p[0])
                acc = vms.setdefault(name, {"name": name, "u": [0.0] * 5, "running": True, "ifs": [], "cpus": ""})
                acc["u"][0] += p[5]
                acc["u"][1] += p[6]
                p[11] = "vm:" + name
        # Docker (Docker Desktop): containers with compose labels, usage from docker stats.
        if t - self.last_slow > 2.5 * 1:
            self.last_slow = t
            if shutil.which("docker"):
                ps_out = run(["docker", "ps", "--no-trunc", "--format", "{{json .}}"], timeout=8)
                st_out = run(["docker", "stats", "--no-stream", "--format", "{{json .}}"], timeout=12) if ps_out.strip() else ""
                self.docker_cache = (ps_out, st_out)
            self.jobs_cache = self.read_jobs()
        containers = []
        stats = {}
        for line in (self.docker_cache[1] or "").splitlines():
            try:
                s = json.loads(line)
            except Exception:
                continue
            stats[s.get("ID", "")[:12]] = s
        for line in (self.docker_cache[0] or "").splitlines():
            try:
                c = json.loads(line)
            except Exception:
                continue
            labels = dict(kv.split("=", 1) for kv in c.get("Labels", "").split(",") if "=" in kv)
            cid = c.get("ID", "")[:12]
            s = stats.get(cid, {})
            nio = s.get("NetIO", "0B / 0B").split("/")
            bio = s.get("BlockIO", "0B / 0B").split("/")
            u = [float(s.get("CPUPerc", "0%").rstrip("%") or 0) / 100.0, size_bytes(s.get("MemUsage", "0B").split("/")[0]) / GB, 0.0,
                 self.rate("cb" + cid, sum(size_bytes(x) for x in bio), t) / MB, self.rate("cn" + cid, sum(size_bytes(x) for x in nio), t) / MB]
            containers.append({"id": cid, "name": c.get("Names", ""), "image": c.get("Image", ""), "status": c.get("Status", ""),
                               "project": labels.get("com.docker.compose.project", ""), "service": labels.get("com.docker.compose.service", ""),
                               "file": labels.get("com.docker.compose.project.config_files", ""), "networks": c.get("Networks", ""), "u": u})
        jobs = [dict(j, u=[0.0] * 5, running=False) for j in self.jobs_cache]
        launch = {}
        for line in run(["launchctl", "list"]).splitlines()[1:]:
            f = line.split("\t")
            if len(f) == 3 and f[0].strip().isdigit():
                launch[f[2]] = int(f[0])
        for i, j in enumerate(jobs):
            pid = launch.get(j.get("label", ""))
            if pid and pid in by_pid:
                j["running"] = True
                p = by_pid[pid]
                j["u"] = [p[5], p[6], 0.0, 0.0, 0.0]
                p[11] = "job:%d" % i
        return {
            "t": t, "os": self.osver, "arch": platform.machine(), "cpu_model": self.model, "ncpu": self.ncpu,
            "uptime": time.time() - float((re.search(r"sec = (\d+)", run(["sysctl", "-n", "kern.boottime"])) or re.search("(0)", "0")).group(1)),
            "host": [busy_tot, mem_used, gpu, disk, net],
            "cap": [self.ncpu, self.memsize / GB, 100.0, self.disk_peak / MB, 1250.0],
            "gpus": [{"name": self.model + " GPU", "mem": "unified memory", "util": gpu}],
            "lcpus": lcpus, "groups": self.groups, "containers": containers, "vms": list(vms.values()), "jobs": jobs,
            "procs": procs, "ifs": ifs, "dockernets": [], "cronLabel": "Cron & launchd jobs",
            "note": "Docker Desktop runs containers in its own Linux VM (no GPU passthrough). They are listed here directly; that VM's overhead counts as Base system.",
        }

    def read_jobs(self):
        jobs = []
        for line in run(["crontab", "-l"]).splitlines():
            line = line.strip()
            if not line or line.startswith("#") or re.match(r"^[A-Z_]+=", line):
                continue
            f = line.split()
            sched = f[0] if f[0].startswith("@") else " ".join(f[:5])
            cmd = " ".join(f[1:] if f[0].startswith("@") else f[5:])
            jobs.append({"name": job_name(cmd), "sched": sched, "human": human_cron(sched), "cmd": cmd, "src": "crontab", "last": ""})
        for path in sorted(glob.glob(os.path.expanduser("~/Library/LaunchAgents/*.plist"))):
            try:
                with open(path, "rb") as f:
                    pl = plistlib.load(f)
            except Exception:
                continue
            if "StartInterval" in pl:
                human = "every %s" % fmt_secs(int(pl["StartInterval"]))
            elif "StartCalendarInterval" in pl:
                ci = pl["StartCalendarInterval"]
                ci = ci[0] if isinstance(ci, list) and ci else ci
                human = "at " + ", ".join("%s %s" % (k.lower(), v) for k, v in ci.items()) if isinstance(ci, dict) else "calendar"
            else:
                continue
            prog = pl.get("Program") or " ".join(pl.get("ProgramArguments", []))
            label = pl.get("Label", os.path.basename(path)[:-6])
            jobs.append({"name": label, "label": label, "sched": "launchd", "human": human, "cmd": prog[:300], "src": path, "last": ""})
        return jobs


def fmt_secs(s):
    return "%d h" % (s // 3600) if s % 3600 == 0 and s >= 3600 else "%d min" % (s // 60) if s % 60 == 0 else "%d s" % s


def parse_cputime(s):
    days = 0
    if "-" in s:
        d, s = s.split("-", 1)
        days = int(d)
    parts = [float(x) for x in s.split(":")]
    secs = 0.0
    for x in parts:
        secs = secs * 60 + x
    return days * 86400 + secs


# ---------------------------------------------------------------- tree assembly
class Fleet:
    def __init__(self, cfg):
        self.cfg = cfg
        self.config_path = cfg.get("__path", CONFIG_PATH)
        self.interval = float(cfg.get("interval", 3))
        self.machines = collections.OrderedDict()
        for m in cfg.get("machine", []):
            self.machines[m["id"]] = Machine(m, self.interval)
        self.tick = 0
        self.specs = {}
        self.lock = threading.Lock()
        load_state(self)  # last readings and history from before a restart: no empty flash
        for m in self.machines.values():
            m.thread.start()
        threading.Thread(target=self.record_loop, daemon=True, name="fleet-record").start()

    def roots(self):
        return [m for m in self.machines.values() if not m.cfg.get("vm_on")]

    def record_loop(self):
        """Every interval: build the tree from each machine's latest view and push one history step per node."""
        while True:
            began = time.time()
            specs = {}
            for m in self.roots():
                try:
                    specs[m.id] = self.machine_spec(m, record=True)
                except Exception:
                    import traceback
                    traceback.print_exc()
            with self.lock:
                self.specs = specs
            self.tick += 1
            if self.tick % 10 == 0:
                save_state(self)
            time.sleep(max(0.2, self.interval - (time.time() - began)))

    def machine_spec(self, m, record, vm_hostside=None, vm_parent=None):
        with m.lock:
            view, status, error = m.view, m.status, m.error
        cfg = m.cfg
        mid = m.id
        spec = {"id": mid, "name": m.name, "tile": cfg.get("tile", "vm" if cfg.get("vm_on") else "terminal"), "status": status,
                "error": error, "os": cfg.get("os_label") or {"windows": "Windows", "linux": "Linux"}.get(cfg.get("os", ""), ""), "agent": "local" if cfg.get("kind") == "local" else "ssh " + cfg.get("ssh", ""),
                "cronLabel": "Cron jobs", "gpus": [], "cap": [1, 1, 0, 1, 1], "procs": [], "baseCron": [], "compose": [], "containers": [], "vms": []}
        spec["ssh"] = cfg.get("ssh", "")
        spec["has_data"] = view is not None
        spec["last_ok"] = m.last_ok
        if view is None:
            if vm_hostside is not None:
                spec["base"] = {"id": mid + "/base", "h": self.leaf(mid + "/base", vm_hostside["u"], record)}
                spec["cap"] = [max(1, vm_hostside.get("vcpus", 1)), max(1, vm_hostside.get("mem", 1)), 0, 1, 1]
                spec["status"] = "hostonly" if status != "ok" else status
                spec["error"] = (error or "not reachable") + " · showing what its host sees"
            else:
                spec["base"] = {"id": mid + "/base", "h": self.leaf(mid + "/base", [0] * 5, record)}
            if vm_parent is not None and vm_hostside is None:
                spec["status"] = "off" if status != "ok" else status
            return spec
        spec.update({"os": view["os"] + (" · " + view["arch"] if view.get("arch") else ""), "cpu_model": view.get("cpu_model", ""),
                     "uptime": fmt_uptime(view.get("uptime", 0)), "cap": view["cap"], "cronLabel": view.get("cronLabel", "Cron jobs"),
                     "gpus": [{"name": g["name"], "mem": g.get("mem", "")} for g in view["gpus"]], "ncpu": view["ncpu"],
                     "groups": view.get("groups", [])})
        if view.get("note"):
            spec["note"] = {"label": "How this is counted.", "text": view["note"]}
        if cfg.get("note"):
            spec["note"] = {"label": cfg["note"].get("label", "Note."), "text": cfg["note"].get("text", "")}
        host = list(view["host"])
        dflt_g = ["gpu0"] if view["gpus"] else []
        # Containers grouped by Compose project.
        proj = collections.OrderedDict()
        loose = []
        csum = [0.0] * 5
        cont_ids = {}
        for c in sorted(view["containers"], key=lambda c: (c["project"], c["service"] or c["name"])):
            for i in range(5):
                csum[i] += c["u"][i]
            if c["project"]:
                pid = "%s/compose/%s" % (mid, slug(c["project"]))
                nid = "%s/%s" % (pid, slug(c["service"] or c["name"]))
                if nid in cont_ids.values():
                    nid += "-" + c["id"][:6]
                cont_ids[c["id"]] = nid
                proj.setdefault(c["project"], {"id": pid, "name": c["project"], "file": c["file"].split(",")[0], "services": []})["services"].append(
                    {"id": nid, "name": c["service"] or c["name"], "cname": c["name"], "image": c["image"], "status": c["status"], "g": dflt_g if c["u"][2] else [],
                     "h": self.leaf(nid, c["u"], record)})
            else:
                nid = "%s/containers/%s" % (mid, slug(c["name"]))
                cont_ids[c["id"]] = nid
                loose.append({"id": nid, "name": c["name"], "cname": c["name"], "image": c["image"], "status": c["status"], "g": dflt_g if c["u"][2] else [],
                              "h": self.leaf(nid, c["u"], record)})
        spec["compose"] = list(proj.values())
        spec["containers"] = loose
        # VMs: nested machines from config when they match by name; host-side usage otherwise.
        vsum = [0.0] * 5
        vm_ids = {}
        nested = {mm.cfg.get("domain", mm.name): mm for mm in self.machines.values() if mm.cfg.get("vm_on") == mid}
        listed = set()
        for v in view["vms"]:
            for i in range(5):
                vsum[i] += v["u"][i]
            mm = nested.get(v["name"])
            if mm:
                listed.add(v["name"])
                sub = self.machine_spec(mm, record, vm_hostside={"u": v["u"], "vcpus": 0, "mem": 0}, vm_parent=m)
                sub["hostside"] = v["u"]
                vm_ids[v["name"]] = sub["id"]
                spec["vms"].append(sub)
            else:
                vid = "%s/vms/%s" % (mid, slug(v["name"]))
                vm_ids[v["name"]] = vid
                facts = ", ".join("%s (%s)" % (d["name"], d["state"]) for d in v.get("distros", []))
                spec["vms"].append({"id": vid, "name": v["name"], "tile": "vm", "status": "ok" if v.get("running") else "off",
                                    "os": facts or "VM", "agent": "seen from the host", "cap": [max(1, view["ncpu"]), view["cap"][1], 0, 1, 1],
                                    "gpus": [], "cronLabel": "Cron jobs", "base": {"id": vid + "/base", "h": self.leaf(vid + "/base", v["u"], record)},
                                    "baseCron": [], "compose": [], "containers": [], "vms": [], "procs": []})
        for name, mm in nested.items():
            if name not in listed:
                spec["vms"].append(self.machine_spec(mm, record, vm_parent=m))
        # Scheduled jobs under Base system; their usage is a breakdown of Base.
        jsum = [0.0] * 5
        jobs = []
        for i, j in enumerate(view["jobs"]):
            jid = "%s/base/cron/%d" % (mid, i)
            for k in range(5):
                jsum[k] += j["u"][k]
            jobs.append({"id": jid, "name": j["name"], "sched": j["sched"], "human": j.get("human", ""), "cmd": j.get("cmd", ""),
                         "last": j.get("last", "") or ("next " + j["next"] if j.get("next") else ""), "running": j["running"],
                         "state": j.get("state", ""), "src": j.get("src", ""), "g": dflt_g if j["u"][2] else [], "h": self.leaf(jid, j["u"], record)})
        spec["baseCron"] = jobs
        base_u = [max(0.0, host[i] - csum[i] - vsum[i] - jsum[i]) for i in range(5)]
        if view["gpus"]:
            base_u[2] = max(0.0, host[2] - csum[2] - vsum[2] - jsum[2])
        spec["base"] = {"id": mid + "/base", "h": self.leaf(mid + "/base", base_u, record), "g": dflt_g}
        spec["procs_owner"] = {"cont": cont_ids, "vm": vm_ids}
        if record:
            HIST.push(mid + "/__host", host)
            for c in view.get("lcpus", []):
                HIST.push("%s/__cpu/%d" % (mid, c["n"]), [c["pct"]])
            for x in view.get("ifs", []):
                HIST.push("%s/__if/%s" % (mid, x["name"]), [x["rx"], x["tx"]])
        return spec

    def leaf(self, key, u, record):
        if record:
            HIST.push(key, u)
        return hist_obj(key)

    # API
    def api_fleet(self):
        with self.lock:
            specs = self.specs
        machines = []
        for m in self.roots():
            s = specs.get(m.id)
            if s:
                machines.append(strip_procs(s))
        return {"t": time.time(), "interval": self.interval, "window_s": self.interval * H, "machines": machines,
                "pins": load_pins()}

    def find_machine(self, mid):
        return self.machines.get(mid)

    def api_procs(self, mid):
        m = self.machines.get(mid)
        if not m:
            return {"procs": []}
        with m.lock:
            view = m.view
        with self.lock:
            spec = find_spec(self.specs, mid)
        if not view or not spec:
            return {"procs": []}
        own = spec.get("procs_owner", {"cont": {}, "vm": {}})
        out = []
        for p in view["procs"]:
            o = p[11]
            if o.startswith("c:"):
                node = own["cont"].get(o[2:], mid + "/base")
            elif o.startswith("vm:"):
                node = own["vm"].get(o[3:], mid + "/base")
            elif o.startswith("job:"):
                node = "%s/base/cron/%s" % (mid, o[4:])
            elif o == "dockervm":
                node = mid + "/base"
            else:
                node = mid + "/base"
            out.append([p[0], p[2], p[3], p[4], round(p[5], 4), round(p[6], 5), round(p[7], 4), round(p[8], 2), p[9], p[10], node, p[1],
                        p[12] if len(p) > 12 else -1, list(p[13]) if len(p) > 13 else []])
        # p[13]: positions (in this machine's gpus) of the GPUs the process has a context on; gpu_procs says
        # whether the host reports that at all (macOS doesn't).
        return {"procs": out, "t": view["t"], "gpu_procs": bool(view.get("gpu_procs"))}

    def api_cpus(self, mid):
        m = self.machines.get(mid)
        if not m:
            return {}
        with m.lock:
            view = m.view
        if not view:
            return {}
        return {"model": view.get("cpu_model", ""), "groups": view.get("groups", []),
                "cpus": [{"n": c["n"], "mhz": c.get("mhz", 0), "core": c.get("core", ""), "pct": c["pct"],
                          "h": HIST.get("%s/__cpu/%d" % (mid, c["n"]), 1)[0]} for c in view.get("lcpus", [])]}

    def api_net(self):
        ts = {}
        try:
            st = json.loads(run([tailscale_bin(), "status", "--json"], timeout=6) or "{}")
            for p in list((st.get("Peer") or {}).values()) + [st.get("Self") or {}]:
                if p:
                    ts[p.get("HostName", "").lower()] = {"ip": (p.get("TailscaleIPs") or [""])[0], "online": p.get("Online", True),
                                                         "os": p.get("OS", ""), "rx": p.get("RxBytes", 0), "tx": p.get("TxBytes", 0),
                                                         "relay": p.get("Relay", ""), "direct": bool(p.get("CurAddr"))}
            tailnet = (st.get("MagicDNSSuffix") or "tailnet").rstrip(".")
        except Exception:
            tailnet = "tailnet"
        machines = []
        for m in self.machines.values():
            with m.lock:
                view, status, error = m.view, m.status, m.error
            key = m.cfg.get("tailscale", m.cfg.get("ssh", m.name)).split("@")[-1].split(".")[0].lower()
            tsinfo = ts.get(key) or next((v for k, v in ts.items() if v["ip"] and v["ip"] in m.cfg.get("ssh", "")), None)
            if m.cfg.get("kind") == "local" and not tsinfo:
                tsinfo = next((v for k, v in ts.items() if k == platform.node().split(".")[0].lower()), None)
            ifs = []
            if view:
                for x in view.get("ifs", []):
                    hrx, htx = HIST.get("%s/__if/%s" % (m.id, x["name"]), 2)
                    ifs.append(dict(x, hrx=hrx, htx=htx))
            conts = []
            if view:
                for c in view.get("containers", []):
                    conts.append({"name": c["name"], "networks": c.get("networks", ""), "net": c["u"][4]})
            vms = [{"name": v["name"], "ifs": v.get("ifs", []), "net": v["u"][4]} for v in (view or {}).get("vms", [])]
            machines.append({"id": m.id, "name": m.name, "status": status, "error": error, "vm_on": m.cfg.get("vm_on", ""),
                             "tailscale": tsinfo, "ifs": ifs, "containers": conts, "vms": vms,
                             "dockernets": (view or {}).get("dockernets", [])})
        return {"tailnet": tailnet, "machines": machines, "window_s": self.interval * H}


# ---------------------------------------------------------------- state that survives restarts
STATE_PATH = os.path.expanduser("~/.cache/fleet-live/state.json")


def save_state(fleet):
    """Last reading per machine and all history, so a restart shows data at once instead of flashing empty."""
    try:
        views = {}
        for m in fleet.machines.values():
            with m.lock:
                if m.view is not None:
                    views[m.id] = {"view": dict(m.view, procs=[]), "last_ok": m.last_ok}
        with HIST.lock:
            hist = {k: [list(q) for q in v] for k, v in HIST.d.items()}
        os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
        tmp = STATE_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"t": time.time(), "views": views, "hist": hist}, f, separators=(",", ":"))
        os.replace(tmp, STATE_PATH)
    except Exception as e:
        print("could not save state: %s" % e, flush=True)


def load_state(fleet):
    try:
        with open(STATE_PATH) as f:
            st = json.load(f)
    except Exception:
        return
    if time.time() - st.get("t", 0) > 6 * 3600:
        return  # too old to be useful
    for mid, v in st.get("views", {}).items():
        m = fleet.machines.get(mid)
        if m:
            m.view, m.last_ok, m.status = v["view"], v.get("last_ok", 0.0), "connecting"
    with HIST.lock:
        for k, qs in st.get("hist", {}).items():
            HIST.d[k] = [collections.deque(q[-H:], maxlen=H) for q in qs]


def restart_self(fleet, reason):
    print("%s; restarting" % reason, flush=True)
    save_state(fleet)
    stop_collectors(fleet)
    args = [x for x in sys.argv[1:] if x not in ("--open", "--open-if-unseen")] + ["--open-if-unseen"]
    os.execv(sys.executable, [sys.executable, os.path.abspath(__file__)] + args)


# ---------------------------------------------------------------- settings
TILES = ("laptop", "desktop", "terminal", "server", "globe", "vm")
SSH_DEST = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.@:\[\]%-]{0,252}$")   # never starts with "-": no option smuggling
MACHINE_KEYS = ("id", "name", "kind", "ssh", "os", "tile", "vm_on", "domain", "tailscale")


def validate_config(data):
    """Returns (config, errors). Only the keys Fleet knows are kept."""
    errors = []
    try:
        interval = float(data.get("interval", 3))
    except Exception:
        interval = -1
    if not (1 <= interval <= 60):
        errors.append("Refresh interval must be between 1 and 60 seconds.")
    machines, ids = [], set()
    for i, m in enumerate(data.get("machines") or []):
        label = "Machine %d" % (i + 1)
        mm = {k: str(m.get(k, "")).strip() for k in MACHINE_KEYS if str(m.get(k, "")).strip()}
        if not re.match(r"^[A-Za-z0-9_-]{1,40}$", mm.get("id", "")):
            errors.append("%s: id must be 1–40 letters, digits, - or _." % label)
        elif mm["id"] in ids:
            errors.append("%s: id %s is used twice." % (label, mm["id"]))
        ids.add(mm.get("id", ""))
        if not mm.get("name") or len(mm["name"]) > 80:
            errors.append("%s: give it a name (up to 80 characters)." % label)
        if mm.get("kind") == "local":
            mm.pop("ssh", None)
            mm.pop("os", None)
        else:
            mm.pop("kind", None)
            if not SSH_DEST.match(mm.get("ssh", "")):
                errors.append("%s: SSH destination must look like host, user@host or a Tailscale name." % (mm.get("name") or label))
            if mm.get("os") not in ("linux", "windows"):
                errors.append("%s: choose Linux or Windows." % (mm.get("name") or label))
        if mm.get("tile") and mm["tile"] not in TILES:
            mm.pop("tile")
        for k in ("domain", "tailscale"):
            if k in mm and not re.match(r"^[A-Za-z0-9_.@:-]{1,120}$", mm[k]):
                errors.append("%s: %s has characters Fleet can't use." % (mm.get("name") or label, k))
        machines.append(mm)
    for mm in machines:
        if mm.get("vm_on") and (mm["vm_on"] not in ids or mm["vm_on"] == mm.get("id")):
            errors.append("%s: “runs on” must be another machine in the list." % mm.get("name", "?"))
    if sum(1 for mm in machines if mm.get("kind") == "local") > 1:
        errors.append("Only one machine can be this computer.")
    term = str(data.get("terminal", "auto"))
    if term != "auto" and term not in [k for k, _ in terminal_choices()[0]]:
        term = "auto"
    return {"interval": interval, "terminal": term, "machine": machines}, errors


def write_config(path, cfg):
    lines = ["# Fleet Live machine list. Written by Fleet's Settings (the previous file is kept as machines.toml.bak).",
             "interval = %s" % (int(cfg["interval"]) if float(cfg["interval"]).is_integer() else cfg["interval"]),
             "terminal = %s" % json.dumps(cfg.get("terminal", "auto")), ""]
    for m in cfg["machine"]:
        lines.append("[[machine]]")
        for k in MACHINE_KEYS:
            if m.get(k):
                lines.append("%s = %s" % (k, json.dumps(m[k], ensure_ascii=False)))
        lines.append("")
    if os.path.exists(path):
        shutil.copy(path, path + ".bak")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    with open(tmp, "rb") as f:
        tomllib.load(f)  # never write a file Fleet can't read back
    os.replace(tmp, path)


def test_connection(dest, os_name):
    if not SSH_DEST.match(dest or ""):
        return {"ok": False, "output": "That doesn't look like an SSH destination."}
    remote = ("powershell -NoProfile -NonInteractive -Command \"'FLEET_OK'; $PSVersionTable.PSVersion.ToString(); (Get-CimInstance Win32_OperatingSystem).Caption\""
              if os_name == "windows" else "echo FLEET_OK; uname -sr; command -v python3 || echo 'python3: not found'")
    try:
        p = subprocess.run(["ssh"] + SSH_MARK + [dest, remote], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=25)
        out = p.stdout.decode("utf-8", "replace").replace("\r", "").strip()
    except subprocess.TimeoutExpired:
        return {"ok": False, "output": "No answer within 25 seconds."}
    ok = "FLEET_OK" in out and "python3: not found" not in out
    return {"ok": ok, "output": out.replace("FLEET_OK", "").strip()[:600]}


# ---------------------------------------------------------------- open a terminal to a node
TERMINALS = [  # key, label, macOS app path, bundle id
    ("ghostty", "Ghostty", "/Applications/Ghostty.app", "com.mitchellh.ghostty"),
    ("iterm", "iTerm", "/Applications/iTerm.app", "com.googlecode.iterm2"),
    ("wezterm", "WezTerm", "/Applications/WezTerm.app", "com.github.wez.wezterm"),
    ("kitty", "kitty", "/Applications/kitty.app", "net.kovidgoyal.kitty"),
    ("alacritty", "Alacritty", "/Applications/Alacritty.app", "org.alacritty"),
    ("herdr", "Herdr (new tab)", "/Applications/Herdr.app", ""),
    ("terminal", "Terminal", "/System/Applications/Utilities/Terminal.app", "com.apple.Terminal"),
]
LINUX_TERMINALS = [("x-terminal-emulator", ["-e"]), ("gnome-terminal", ["--"]), ("konsole", ["-e"]), ("kitty", []),
                   ("alacritty", ["-e"]), ("wezterm", ["start", "--"]), ("xfce4-terminal", ["-x"]), ("xterm", ["-e"])]
CNAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,200}$")


def ssh_link_handler():
    """The app macOS opens ssh:// links with, if the user picked one."""
    path = os.path.expanduser("~/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist")
    try:
        with open(path, "rb") as f:
            for h in plistlib.load(f).get("LSHandlers", []):
                if h.get("LSHandlerURLScheme") == "ssh":
                    return h.get("LSHandlerRoleAll", "")
    except Exception:
        pass
    return ""


def terminal_choices():
    """[(key, label)] available on this computer, plus which one Automatic picks."""
    if platform.system() == "Darwin":
        have = [(k, l) for k, l, app, _ in TERMINALS if os.path.exists(app) and (k != "herdr" or shutil.which("herdr"))]
        bid = ssh_link_handler()
        auto = next((k for k, l, app, b in TERMINALS if b and b == bid and os.path.exists(app)), "")
        if not auto:
            auto = next((k for k, l in have if k not in ("terminal", "herdr")), "terminal")
        return have, auto
    if platform.system() == "Windows":
        have = [("wt", "Windows Terminal")] if shutil.which("wt") else []
        return have + [("cmd", "Command Prompt")], (have[0][0] if have else "cmd")
    env = os.environ.get("TERMINAL", "")
    have = ([("env", "$TERMINAL (%s)" % env)] if env and shutil.which(env) else []) + [(k, k) for k, _ in LINUX_TERMINALS if shutil.which(k)]
    return have, (have[0][0] if have else "")


def open_terminal(choice, argv, title):
    """Open a new terminal window (or herdr tab) on this computer running argv; argv None = a local shell."""
    have, auto = terminal_choices()
    keys = [k for k, _ in have]
    term = choice if choice in keys else auto
    label = dict(have).get(term, term)
    line = shlex.join(argv) if argv else ""
    def osa(*lines):
        subprocess.run(["osascript"] + sum([["-e", l] for l in lines], []), check=True, capture_output=True, timeout=15)
    def q(x):
        return x.replace("\\", "\\\\").replace('"', '\\"')
    if platform.system() == "Darwin":
        if term == "terminal":
            osa('tell application "Terminal"', "activate", 'do script "%s"' % q(line), "end tell")
        elif term == "iterm":
            osa('tell application "iTerm"', "activate",
                ('create window with default profile command "%s"' % q(line)) if line else "create window with default profile", "end tell")
        elif term == "herdr":
            out = subprocess.run(["herdr", "tab", "create", "--label", title[:40], "--focus"], capture_output=True, text=True, timeout=10).stdout
            pane = re.search(r'"(?:pane_id|paneId)"\s*:\s*"([^"]+)"', out) or re.search(r'"id"\s*:\s*"([^"]*pane[^"]*)"', out)
            if not pane:
                return open_terminal("auto" if auto != "herdr" else "terminal", argv, title)
            if line:
                subprocess.run(["herdr", "pane", "run", pane.group(1), line], check=True, capture_output=True, timeout=10)
        else:
            app = {"ghostty": "Ghostty", "wezterm": "WezTerm", "kitty": "kitty", "alacritty": "Alacritty"}[term]
            extra = {"ghostty": ["-e"], "wezterm": ["start", "--"], "kitty": [], "alacritty": ["-e"]}[term] if argv else []
            subprocess.Popen(["open", "-na", app, "--args"] + extra + (argv or []))
        return label
    if platform.system() == "Windows":
        if term == "wt":
            subprocess.Popen(["wt", "new-tab", "--title", title] + (argv or ["powershell"]))
        else:
            subprocess.Popen(["cmd", "/c", "start", title] + (argv or ["cmd"]))
        return label
    if term == "env":
        subprocess.Popen([os.environ["TERMINAL"], "-e"] + (argv or [os.environ.get("SHELL", "sh")]))
        return label
    for k, flag in LINUX_TERMINALS:
        if k == term:
            subprocess.Popen([k] + (flag + argv if argv else []))
            return label
    raise RuntimeError("No terminal app found. Set $TERMINAL or install one.")


def terminal_target(fleet, node_id):
    """(argv, title) for a node: ssh to a machine, a local shell, or a shell inside a container."""
    machine = fleet.machines.get(node_id)
    if machine:
        if machine.cfg.get("kind") == "local":
            return None, machine.name
        dest = machine.cfg.get("ssh", "")
        if not SSH_DEST.match(dest):
            raise ValueError("%s has no SSH destination." % machine.name)
        return ["ssh", dest], machine.name
    with fleet.lock:
        specs = fleet.specs
    for top in specs.values():
        stack = [(top, None)]
        while stack:
            s, _ = stack.pop()
            items = list(s.get("containers", [])) + [sv for p in s.get("compose", []) for sv in p.get("services", [])]
            for c in items:
                if c.get("id") == node_id:
                    cname = c.get("cname", "")
                    if not CNAME.match(cname):
                        raise ValueError("Fleet doesn't know that container's name.")
                    m = fleet.machines.get(s["id"])
                    shell = "command -v bash >/dev/null 2>&1 && exec bash || exec sh"
                    inner = ["docker", "exec", "-it", cname, "sh", "-c", shell]
                    if m is None or m.cfg.get("kind") == "local":
                        return inner, cname
                    dest = m.cfg.get("ssh", "")
                    if not SSH_DEST.match(dest):
                        raise ValueError("%s has no SSH destination." % m.name)
                    remote = "docker exec -it %s sh" % cname if m.cfg.get("os") == "windows" else shlex.join(inner)
                    return ["ssh", "-t", dest, remote], "%s on %s" % (cname, m.name)
            stack.extend((v, s) for v in s.get("vms", []))
    raise ValueError("That isn't something Fleet can open a terminal to.")


def find_spec(specs, mid):
    for s in specs.values():
        stack = [s]
        while stack:
            x = stack.pop()
            if x.get("id") == mid:
                return x
            stack.extend(x.get("vms", []))
    return None


def strip_procs(spec):
    s = {k: v for k, v in spec.items() if k not in ("procs", "procs_owner")}
    s["vms"] = [strip_procs(v) for v in spec.get("vms", [])]
    return s


def fmt_uptime(secs):
    secs = int(secs or 0)
    if secs >= 86400:
        return "%d d" % (secs // 86400)
    if secs >= 3600:
        return "%d h" % (secs // 3600)
    return "%d min" % (secs // 60)


def tailscale_bin():
    for p in ("tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale", r"C:\Program Files\Tailscale\tailscale.exe"):
        if shutil.which(p) or os.path.exists(p):
            return p
    return "tailscale"


# ---------------------------------------------------------------- HTTP
class Handler(http.server.SimpleHTTPRequestHandler):
    fleet = None

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=os.path.join(HERE, "web"), **kw)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, obj):
        body = json.dumps(obj, separators=(",", ":")).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def allowed(self, write=False):
        """Only this computer's own Fleet window: right Host (no DNS rebinding), and for writes the right
        Origin plus a custom header (a cross-site form or fetch can't send it without a preflight)."""
        port = self.server.server_address[1]
        hosts = {"127.0.0.1:%d" % port, "localhost:%d" % port}
        if self.headers.get("Host", "") not in hosts:
            return False
        if write:
            origin = self.headers.get("Origin")
            if origin and origin not in {"http://" + h for h in hosts}:
                return False
            if self.headers.get("X-Fleet") != "1":
                return False
        return True

    def read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(min(n, 1 << 20)) or b"null")

    def do_GET(self):
        if not self.allowed():
            self.send_error(403)
            return
        u = urllib.parse.urlparse(self.path)
        if u.path == "/api/config":
            f = self.fleet
            st = {m.id: {"status": m.status, "error": m.error} for m in f.machines.values()}
            machines = [{k: m.cfg[k] for k in MACHINE_KEYS if k in m.cfg} for m in f.machines.values()]
            have, auto = terminal_choices()
            return self.send_json({"path": f.config_path, "interval": f.interval, "machines": machines, "status": st,
                                   "terminal": f.cfg.get("terminal", "auto"), "terminals": have, "terminal_auto": dict(have).get(auto, auto)})
        q = urllib.parse.parse_qs(u.query)
        if u.path == "/api/fleet":
            LAST_CLIENT[0] = time.time()
            return self.send_json(self.fleet.api_fleet())
        if u.path == "/api/procs":
            return self.send_json(self.fleet.api_procs(q.get("machine", [""])[0]))
        if u.path == "/api/cpus":
            return self.send_json(self.fleet.api_cpus(q.get("machine", [""])[0]))
        if u.path == "/api/net":
            return self.send_json(self.fleet.api_net())
        return super().do_GET()

    def do_POST(self):
        if not self.allowed(write=True):
            self.send_error(403)
            return
        u = urllib.parse.urlparse(self.path)
        if u.path == "/api/config":
            try:
                cfg, errors = validate_config(self.read_json() or {})
            except Exception:
                cfg, errors = None, ["That wasn't valid settings data."]
            if errors:
                return self.send_json({"ok": False, "errors": errors})
            try:
                write_config(self.fleet.config_path, cfg)
            except Exception as e:
                return self.send_json({"ok": False, "errors": ["Couldn't save: %s" % e]})
            self.send_json({"ok": True})
            threading.Thread(target=lambda: (time.sleep(0.4), restart_self(self.fleet, "settings saved")), daemon=True).start()
            return
        if u.path == "/api/test":
            d = self.read_json() or {}
            return self.send_json(test_connection(str(d.get("ssh", "")), str(d.get("os", "linux"))))
        if u.path == "/api/terminal":
            d = self.read_json() or {}
            try:
                argv, title = terminal_target(self.fleet, str(d.get("node", "")))
                used = open_terminal(self.fleet.cfg.get("terminal", "auto"), argv, title)
                return self.send_json({"ok": True, "terminal": used, "title": title})
            except Exception as e:
                return self.send_json({"ok": False, "error": str(e)[:300]})
        if u.path == "/api/retry":
            d = self.read_json() or {}
            m = self.fleet.machines.get(str(d.get("machine", "")))
            if m:
                m.wake.set()
            return self.send_json({"ok": bool(m)})
        if u.path != "/api/pins":
            self.send_error(404)
            return
        n = int(self.headers.get("Content-Length") or 0)
        try:
            pins = json.loads(self.rfile.read(min(n, 65536)) or b"[]")
            assert isinstance(pins, list) and all(isinstance(p, str) and len(p) < 300 for p in pins)
        except Exception:
            self.send_error(400)
            return
        save_pins(pins[:40])
        return self.send_json({"pins": load_pins()})


def main():
    ap = argparse.ArgumentParser(description="Fleet Live: every machine you manage, live. Read-only.")
    ap.add_argument("--port", type=int, default=4518)
    ap.add_argument("--config", default=CONFIG_PATH)
    ap.add_argument("--open", action="store_true", help="open the UI in an app window")
    ap.add_argument("--open-if-unseen", action="store_true", help="open the app window only if no Fleet window connects within a few seconds")
    ap.add_argument("--no-watch", action="store_true", help="don't restart or reopen the window when Fleet's own files change")
    a = ap.parse_args()
    if not os.path.exists(a.config):
        os.makedirs(os.path.dirname(a.config), exist_ok=True)
        shutil.copy(os.path.join(HERE, "machines.example.toml"), a.config)
        print("wrote a starter config to %s; edit it to list your machines" % a.config)
    with open(a.config, "rb") as f:
        cfg = tomllib.load(f)
    cfg["__path"] = a.config
    n = reap_leftover_collectors()
    if n:
        print("stopped %d leftover collector session(s) from an earlier run" % n, flush=True)
    Handler.fleet = Fleet(cfg)
    import signal
    def bye(*_):
        save_state(Handler.fleet)
        stop_collectors(Handler.fleet)
        os._exit(0)
    signal.signal(signal.SIGTERM, bye)
    signal.signal(signal.SIGINT, bye)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    url = "http://127.0.0.1:%d/" % a.port
    print("Fleet Live on %s" % url, flush=True)
    if a.open:
        open_app_window(url)
    elif a.open_if_unseen:
        threading.Thread(target=reopen_if_unseen, args=(url, time.time()), daemon=True).start()
    if not a.no_watch:
        threading.Thread(target=watch_own_files, args=(url,), daemon=True, name="fleet-watch").start()
    srv.serve_forever()


def reopen_if_unseen(url, since, wait=8.0):
    """Open the app window unless a Fleet window has polled since `since` (the page polls every 2 s)."""
    time.sleep(wait)
    if LAST_CLIENT[0] < since:
        open_app_window(url)


def watch_own_files(url):
    """Fleet updates itself: server or collector changes restart the server (the page reconnects);
    UI changes reload the open page on their own. Either way, a closed window is reopened."""
    server_files = [os.path.join(HERE, f) for f in ("fleet_live.py", "collect_linux.py", "collect_windows.ps1")]
    ui_files = [os.path.join(HERE, "web", f) for f in ("index.html", "app.js")]
    def stamp(files):
        out = []
        for f in files:
            try:
                out.append(os.stat(f).st_mtime_ns)
            except OSError:
                out.append(0)
        return out
    srv, ui = stamp(server_files), stamp(ui_files)
    while True:
        time.sleep(1.0)
        s2, u2 = stamp(server_files), stamp(ui_files)
        if s2 != srv:
            time.sleep(0.5)  # let an editor finish writing
            try:
                compile(open(server_files[0], encoding="utf-8").read(), server_files[0], "exec")
            except SyntaxError as e:
                print("not restarting: %s" % e, flush=True)
                srv = s2
                continue
            restart_self(Handler.fleet, "Fleet changed")
        if u2 != ui:
            ui = u2
            threading.Thread(target=reopen_if_unseen, args=(url, time.time()), daemon=True).start()


def open_app_window(url):
    """A chromeless app window when Chrome or Edge is installed, else the default browser."""
    cands = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
             "google-chrome", "chromium", "microsoft-edge", r"C:\Program Files\Google\Chrome\Application\chrome.exe",
             r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"]
    for c in cands:
        if os.path.exists(c) or shutil.which(c):
            prof = os.path.join(os.path.expanduser("~"), ".cache", "fleet-live", "browser")
            extra = ["--class=fleet-live"] if platform.system() == "Linux" else []  # groups the window under fleet.desktop
            subprocess.Popen([c, "--app=" + url, "--user-data-dir=" + prof, "--window-size=1500,950"] + extra, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
    webbrowser.open(url)


if __name__ == "__main__":
    main()
