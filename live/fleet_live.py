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
        gpus, pid_gpu = self.linux_gpus(r, t)
        pdisks = r.get("pdisks") or {}
        pnet = r.get("pnet") or {}
        disks = self.linux_disks(r, t)
        gpu_by_pid = {pid: sum(v.values()) for pid, v in pid_gpu.items()}
        cont_gk = {}
        procs = []
        cont_u, vm_u, unit_u = {}, {}, {}
        r_cid = {p[0]: p[9] for p in r["procs"]}
        by_pid = {}
        for p in r["procs"]:
            pid, ppid, comm, state, ticks, rss, threads, user, iob, cid, vm, unit, cmd = p[:13]
            lastcpu = p[13] if len(p) > 13 else -1
            c = self.rate("p.%d.t" % pid, ticks, t) / hz
            d = self.rate("p.%d.io" % pid, iob, t) / MB if iob >= 0 else 0.0
            g = gpu_by_pid.get(pid, 0.0)
            if cid and pid in pid_gpu:
                cont_gk.setdefault(cid, set()).update("gpu%d" % i for i, v in pid_gpu[pid].items() if v > 0)
            pn = pnet.get(str(pid)) or {}
            row = [pid, ppid, comm, user, state, c, rss / GB, d, g, threads, cmd, "", lastcpu, sorted(pid_gpu.get(pid, {})), list(pdisks.get(str(pid), [])),
                   list(pn.get("ifs", [])), self.rate("pn.%d" % pid, pn.get("b", 0), t) / MB if pn else 0.0]
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
        gpu_total = sum(g["util"] for g in gpus)
        for c in containers:
            c["gkeys"] = sorted(cont_gk.get(c["id"], ()))
        active = {}  # container -> disks it read or wrote since the last reading (from its cgroup)
        for cid, acc in (r.get("cdisks") or {}).items():
            for dn, tot in acc.items():
                if self.rate("cd.%s.%s" % (cid, dn), tot, t) > 0:
                    active.setdefault(cid, set()).add(dn)
        # Containers talk through their Docker networks' bridges (or a macvlan parent); VMs through their taps.
        nets = {n["name"]: n for n in r.get("dockernets", [])}
        def bridge_of(name):
            n = nets.get(name)
            if not n:
                return ""
            if n.get("driver") == "bridge":
                return "docker0" if name == "bridge" else "br-" + n.get("id", "")[:12]
            return name if name in r["ifs"] else ""
        c_ifs = {c["id"]: [b for b in (bridge_of(x) for x in c.get("networks", "").split(",") if x) if b] for c in containers}
        vm_ifs = {}
        for v in r.get("vms", []):
            vm_ifs[v["name"]] = sorted({i["if"] for i in v["ifs"]} | {i["source"] for i in v["ifs"] if i.get("source") in r["ifs"]})
        r_vm = {p[0]: p[10] for p in r["procs"] if p[10]}
        for row in procs:
            cid = r_cid.get(row[0], "")
            if cid in active:
                row[14] = sorted(set(row[14]) | active[cid])
            if cid in c_ifs:
                row[15] = sorted(set(row[15]) | set(c_ifs[cid]))
            if row[0] in r_vm:
                row[15] = sorted(set(row[15]) | set(vm_ifs.get(r_vm[row[0]], [])))
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
            "procs": procs, "ifs": ifs, "dockernets": r.get("dockernets", []), "cronLabel": "Cron jobs", "disks": disks,
            "gpu_procs": bool(gpus),  # each process names its GPUs (p[13]): nvidia-smi pmon, DRM fdinfo
        }

    def linux_disks(self, r, t):
        out = []
        for d in r.get("disks") or []:
            n = d["name"]
            out.append({"name": n, "model": d.get("model", ""), "size": d.get("size", 0), "rot": d.get("rot", False), "role": d.get("role", ""),
                        "mounts": d.get("mounts", []), "read": self.rate("dr." + n, d["r"], t) / MB, "write": self.rate("dw." + n, d["w"], t) / MB,
                        "busy": min(100.0, self.rate("dm." + n, d["ms"], t) / 10.0)})  # ms busy per s -> %
        return out

    def linux_gpus(self, r, t):
        """Every GPU on a Linux host, any vendor: the kernel's DRM devices (and GPUs passed through to VMs),
        with NVIDIA's numbers from nvidia-smi. Returns (gpus, {pid: {gpu index: %}})."""
        nv = {g.get("pdev", ""): g for g in r.get("gpus", [])}
        gpus, idx_of = [], {}
        for c in r.get("drm") or []:
            if c.get("driver") == "nvidia" and c["pdev"] in nv:
                continue  # nvidia-smi reports it below
            idx_of[c["pdev"]] = len(gpus)
            vram = c.get("vram") or [0, 0]
            if c.get("passthrough"):
                mem = "passed through to " + (c.get("vm") or "a VM")
            elif vram[0]:
                mem = "%d GB VRAM" % round(vram[0] / GB)
            elif c.get("maxmhz"):
                mem = "up to %.2f GHz" % (c["maxmhz"] / 1000.0)
            else:
                mem = ""
            gpus.append({"name": c["name"], "mem": mem, "util": 0.0, "busy": c.get("busy", -1), "mhz": c.get("mhz", 0),
                         "passthrough": bool(c.get("passthrough"))})
        nv_idx = {}
        for g in sorted(r.get("gpus", []), key=lambda g: g["index"]):
            nv_idx[g["index"]] = len(gpus)
            gpus.append({"name": g["name"], "mem": "%d GB VRAM" % round(g["memTotal"] / 1024) if g["memTotal"] else "", "util": g["util"], "nvidia": True})
        eng, pid_gpu = {}, {}
        for pid, pdev, cid, engines, cap, _mem in r.get("gclients", []):
            idx = idx_of.get(pdev)
            if idx is None:
                continue
            best = 0.0
            for e, ns in engines.items():
                v = self.rate("gpu.%s.%s.%s" % (pdev, cid, e), ns, t) / 1e9 * 100.0 / max(1, cap.get(e, 1))
                eng[(idx, e)] = eng.get((idx, e), 0.0) + v
                best = max(best, v)
            if best > 0:
                pid_gpu.setdefault(pid, {})[idx] = pid_gpu.get(pid, {}).get(idx, 0.0) + best
        for i, g in enumerate(gpus):
            if g.get("nvidia") or g.get("passthrough"):
                continue
            busiest = max([v for (gi, _e), v in eng.items() if gi == i] or [0.0])  # like nvtop: the busiest engine
            g["util"] = min(100.0, max(busiest, float(g["busy"]) if g.get("busy", -1) >= 0 else 0.0))
        for gidx, pid, sm in r.get("gproc", []):
            idx = nv_idx.get(gidx)
            if idx is not None:
                pid_gpu.setdefault(pid, {})[idx] = pid_gpu.get(pid, {}).get(idx, 0.0) + sm
        return gpus, pid_gpu

    def prune(self, t):
        if len(self.cum) > 40000:
            cutoff = t - 30
            self.cum = {k: v for k, v in self.cum.items() if v[1] >= cutoff}


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
