#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Fleet Live: every machine you manage, live, in one tree. Read-only.

Runs on macOS, Linux and Windows (Python 3.11+, standard library only).
Each machine in ~/.config/fleet/machines.toml is watched by one thread:
  - kind = "local":   this computer, read directly
  - os = "linux":     collect_linux.py piped to `python3 -` over SSH
  - os = "windows":   collect_windows.ps1 piped to a short `powershell -EncodedCommand` bootstrap
The remote collectors loop and stream one reading per interval until the SSH
connection closes. Nothing is installed on any machine and nothing is changed.

Usage: python3 fleet_live.py [--port 4518] [--config PATH] [--open]
"""
import argparse, base64, collections, ctypes, ctypes.util, glob, http.server, json, os, platform, plistlib, shlex
import re, shutil, subprocess, sys, tempfile, threading, time, tomllib, urllib.parse, urllib.request, webbrowser, zlib

VERSION = "0.0.1"
HERE = os.path.dirname(os.path.abspath(__file__))
H = 60
METRICS = ("cpu", "mem", "gpu", "disk", "net")
CONFIG_PATH = os.path.expanduser("~/.config/fleet/machines.toml")
LAST_CLIENT = [0.0]   # when a Fleet window last asked for data
HIDDEN_POLL_S = 75.0  # longest gap between a hidden window's polls: Chrome's once-a-minute timers, plus slack
PINS_PATH = os.path.expanduser("~/.config/fleet/pins.json")
TILEPINS_PATH = os.path.expanduser("~/.config/fleet/tilepins.json")  # pinned tiles and CPU groups, per machine
PREFS_PATH = os.path.expanduser("~/.config/fleet/ui.json")  # UI layout (Details columns per detail type)
CONNECT_PATH = os.path.expanduser("~/.config/fleet/connect.json")  # which machines Fleet connects to when it starts, and saved sets
PINS_LOCK = threading.Lock()


def load_pins():
    try:
        with open(PINS_PATH) as f:
            pins = json.load(f)
        return [p for p in pins if isinstance(p, str)][:40]
    except Exception:
        return []


def load_tilepins():
    try:
        with open(TILEPINS_PATH) as f:
            d = json.load(f)
        return {str(k)[:200]: [str(x)[:200] for x in v][:200] for k, v in d.items() if isinstance(v, list)} if isinstance(d, dict) else {}
    except Exception:
        return {}


def load_prefs():
    try:
        with open(PREFS_PATH) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def load_connect():
    """'Connect automatically': auto is all, none or the name of a saved set of machine ids; none until chosen."""
    try:
        with open(CONNECT_PATH) as f:
            d = json.load(f)
    except Exception:
        d = {}
    d = d if isinstance(d, dict) else {}
    raw = d.get("presets") if isinstance(d.get("presets"), dict) else {}
    presets = {str(k)[:60]: [str(x)[:200] for x in v][:500] for k, v in raw.items() if isinstance(v, list)}
    auto = d.get("auto") if d.get("auto") in ["all", "none"] + list(presets) else "none"   # nothing chosen: no SSH machine at start (#224)
    return {"auto": auto, "presets": presets}


def save_connect(d):
    with PINS_LOCK:
        os.makedirs(os.path.dirname(CONNECT_PATH), exist_ok=True)
        tmp = CONNECT_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"auto": d["auto"], "presets": d["presets"]}, f, indent=1)
        os.replace(tmp, CONNECT_PATH)


def connects_at_start(cfg, conn, off=(), restarted=False):
    """Whether Fleet connects to this machine when it starts: this computer always (it needs no SSH); an
    SSH machine per 'Connect automatically'. A restart Fleet does itself (settings saved, an update) keeps every
    machine connected but those turned off by hand, and connects one just added (#224)."""
    if cfg.get("kind") == "local":
        return True
    if cfg["id"] in off:
        return False
    if restarted:
        return True
    a = conn["auto"]
    return a == "all" or (a != "none" and cfg["id"] in conn["presets"].get(a, []))


def save_prefs(d):
    with PINS_LOCK:
        os.makedirs(os.path.dirname(PREFS_PATH), exist_ok=True)
        tmp = PREFS_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(d, f, indent=1)
        os.replace(tmp, PREFS_PATH)


def save_tilepins(d):
    with PINS_LOCK:
        os.makedirs(os.path.dirname(TILEPINS_PATH), exist_ok=True)
        tmp = TILEPINS_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(d, f, indent=1)
        os.replace(tmp, TILEPINS_PATH)


def save_pins(pins):
    with PINS_LOCK:
        os.makedirs(os.path.dirname(PINS_PATH), exist_ok=True)
        tmp = PINS_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(pins, f, indent=1)
        os.replace(tmp, PINS_PATH)


# ---------------------------------------------------------------- history
class Hist:
    """Last H readings per node id and metric. A node nothing has pushed, read or touched since the last sweep is gone
    (a restarted container, its veth, a removed job) and is forgotten, in memory and so in state.json."""
    def __init__(self):
        self.d = {}
        self.used = set()
        self.lock = threading.Lock()

    def push(self, key, vals):
        with self.lock:
            self.used.add(key)
            q = self.d.get(key)
            if q is None:
                q = self.d[key] = [collections.deque([0.0] * H, maxlen=H) for _ in vals]
            for i, v in enumerate(vals):
                q[i].append(round(float(v), 4))

    def keys(self, prefix):
        with self.lock:
            return [k for k in self.d if k.startswith(prefix)]

    def get(self, key, n=5):
        with self.lock:
            q = self.d.get(key)
            if q:
                self.used.add(key)
            return [list(x) for x in q] if q else [[0.0] * H for _ in range(n)]

    def touch(self, key):
        with self.lock:
            self.used.add(key)

    def sweep(self):
        with self.lock:
            for k in [k for k in self.d if k not in self.used]:
                del self.d[k]
            self.used = set()


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


def docker_pct(s):
    """A docker stats percentage as a fraction. docker stats prints "--" for a container it cannot read (one
    that exits or is removed while it reads): that container counts as idle."""
    try:
        return float((s or "0%").rstrip("%") or 0) / 100.0
    except ValueError:
        return 0.0


def netio(s):
    """docker stats NetIO, "received / sent", as bytes: (received, sent)."""
    rx, _, tx = (s or "").partition("/")
    return size_bytes(rx), size_bytes(tx)


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
def ps_compact(script):
    """A PowerShell script without full-line comments, blank lines or indentation: -EncodedCommand doubles
    its size (UTF-16) and grows it by a third (base64), and a Windows command line holds 32,767 characters.
    (The collector's here-strings are C#, where indentation doesn't matter and no line starts with #;
    each closing '@ must start a line, which stripping keeps true.)"""
    return "\n".join(l.strip() for l in script.splitlines() if l.strip() and not l.strip().startswith("#"))


# Reads the script as plain lines up to an end marker and runs it as a script block (#269): decoding a base64 payload
# and running it with iex is what Windows' protection against obfuscated scripts refuses ("Access is denied").
PS_END = "#FLEET-END"
PS_BOOT = ("$b = New-Object System.Text.StringBuilder; "
           "while (($l = [Console]::In.ReadLine()) -ne $null -and $l -ne '%s') { [void]$b.AppendLine($l) }; "
           "& ([ScriptBlock]::Create($b.ToString()))" % PS_END)


def ps_launch(script):
    """(argv, stdin) that run a long PowerShell script: the command is a short bootstrap that reads the script
    from stdin as plain lines, because OpenSSH's default shell, cmd.exe, takes at most 8,191 characters.
    The caller keeps stdin open afterwards: the collector's lifeline."""
    enc = base64.b64encode(PS_BOOT.encode("utf-16-le")).decode()
    return ["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand", enc], (script + "\n" + PS_END + "\n").encode("ascii")


# ---------------------------------------------------------------- GPU metrics (issue #6)
# Every GPU reports what it can as g["m"] = {metric: value} and g["lim"] = {metric: its maximum}.
MIB = 1024 * 1024
GPU_METRICS = ["util", "3d", "compute", "copy", "video", "encode", "decode", "vpp", "jpeg", "tiler", "memctl", "vram", "shared", "sysmem",
               "temp", "power", "clock", "memclock", "fan", "fanrpm"]
DRM_ENGINE = {"render": "3d", "gfx": "3d", "compute": "compute", "copy": "copy", "dma": "copy", "video": "video", "video-enhance": "vpp",
              "enc": "encode", "dec": "decode", "jpeg": "jpeg"}
DRIVER_ENGINES = {"i915": ["render", "copy", "video", "video-enhance"], "xe": ["render", "compute", "copy", "video", "video-enhance"],
                  "amdgpu": ["gfx", "compute", "dma", "enc", "dec"]}
WIN_ENGINE = {"3d": "3d", "copy": "copy", "videodecode": "decode", "videoencode": "encode", "videoprocessing": "vpp"}


def gpu_metric_order(g):
    """(metric, limit) pairs in Fleet's order: engines, memory, then sensors; unknown ones last."""
    m, lim = g.get("m") or {}, g.get("lim") or {}
    known = [k for k in GPU_METRICS if k in m] + [k for k in m if k not in GPU_METRICS]
    return [(k, lim.get(k)) for k in known]


def mac_gpu_stats(ioreg):
    """`ioreg -c IOAccelerator` → one dict per GPU: device, renderer and tiler utilisation, memory in use."""
    out = []
    for block in re.findall(r'"PerformanceStatistics" = \{([^}]*)\}', ioreg):
        def val(name):
            m = re.search(r'"%s"=(\d+)' % re.escape(name), block)
            return float(m.group(1)) if m else None
        d = {}
        for k, name in (("util", "Device Utilization %"), ("3d", "Renderer Utilization %"), ("tiler", "Tiler Utilization %"), ("sysmem", "In use system memory")):
            v = val(name)
            if v is not None:
                d[k] = v
        if d:
            d.setdefault("util", 0.0)
            out.append(d)
    return out


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
        self.fresh = False        # a reading arrived in this run (a view restored at start has no processes)
        self.cum = {}             # cumulative counters from the previous reading
        self.nv_pair = {}         # Windows: each adapter's (LUID's) nvidia-smi index, as the last reading paired them
        self.disk_peak = 500 * MB
        self.lock = threading.Lock()
        self.proc = None
        self.last_ok = 0.0          # when the last good reading arrived
        self.stall = max(60.0, 10.0 * interval)   # a collector session that brings nothing for this long is ended
        self.wake = threading.Event()  # Retry now
        self.on = threading.Event()    # connect (set) or stay disconnected (clear)
        self.on.set()
        self.thread = threading.Thread(target=self.loop, daemon=True, name="fleet-" + self.id)

    # One thread per machine; reconnect with backoff.
    def loop(self):
        backoff = 5
        while True:
            if not self.on.is_set():   # turned off: no session until it's turned on
                with self.lock:
                    self.view, self.status, self.error, self.fresh = None, "disabled", "", False
                self.on.wait()
                backoff = 5
            began = self.last_ok
            try:
                if self.cfg.get("kind") == "local":
                    self.local_loop()
                else:
                    self.ssh_loop()
            except Exception as e:  # never die; show it
                self.set_status("offline", "collector error: %s" % e)
            if not self.on.is_set():
                continue
            if self.last_ok > began:
                backoff = 5   # that session brought a reading: start over; a machine that's down or refuses the key waits longer each time
            self.wake.wait(backoff)
            self.wake.clear()
            backoff = min(60, backoff * 2)

    def turn(self, on):
        """Connect (on) or disconnect (off) by hand. Off ends this machine's own SSH session and keeps it
        closed until it's turned on. This computer has no switch: it needs no SSH."""
        if self.cfg.get("kind") == "local":
            return False
        if on:
            self.on.set()
        else:
            self.on.clear()
            p = self.proc
            if p is not None and p.poll() is None:
                p.terminate()
        self.wake.set()
        return True

    def docker_desktop_procs(self, view, own, now=None):
        """Docker Desktop (this Mac): each container's processes, read with docker top, since they run in
        Docker's Linux VM, which macOS can't see. Their PIDs are the VM's, so rows are keyed
        d:<container>:<pid> and never meet this Mac's. CPU comes from each one's cumulative CPU time over its
        last readings (up to 15 s apart); it is read at most every 2 s."""
        now = time.time() if now is None else now
        st = self.__dict__.setdefault("dtop", {"t": -1e9, "rows": [], "cpu": {}})
        if now - st["t"] < 2.0:
            return st["rows"]
        conts = [c for c in view.get("containers", []) if c.get("id")]
        outs = {}
        def top(c):
            outs[c["id"]] = run(["docker", "top", c["id"], "-eo", "pid,ppid,user,stat,cputimes,rss,nlwp,args"], timeout=5)
        threads = [threading.Thread(target=top, args=(c,), daemon=True) for c in conts]
        for t in threads:
            t.start()
        for t in threads:
            t.join(6)
        rows, seen = [], set()
        for c in conts:
            cid = c["id"]
            for pid, ppid, user, stat, cpus, rss, nlwp, args in parse_docker_top(outs.get(cid, "")):
                key = "d:%s:%d" % (cid, pid)
                seen.add(key)
                hist = st["cpu"].setdefault(key, collections.deque(maxlen=8))
                hist.append((now, cpus))
                old = next(((t0, c0) for t0, c0 in hist if now - t0 <= 15), None)
                cpu = (cpus - old[1]) / (now - old[0]) if old and now - old[0] >= 2.5 else 0.0
                name = os.path.basename(args.split()[0]).rstrip(":") if args.split() else ""
                rows.append([key, name, user, stat, round(max(0.0, cpu), 4), round(rss * 1024 / GB, 5), 0.0, 0.0, nlwp, args,
                             own["cont"].get(cid, self.id + "/base"), "d:%s:%d" % (cid, ppid), -1, [], [], [], -1])
        st["cpu"] = {k: v for k, v in st["cpu"].items() if k in seen}
        st["t"], st["rows"] = now, rows
        return rows

    def got(self, view):
        with self.lock:
            self.view, self.status, self.error, self.last_ok, self.fresh = view, "ok", "", time.time(), True

    def set_status(self, status, error=""):
        with self.lock:
            self.status, self.error = status, error

    def ssh_cmd(self):
        base = ["ssh"] + SSH_MARK + [self.cfg["ssh"]]
        if self.cfg.get("os") == "windows":
            argv, stdin = ps_launch("$FleetInterval=%s\n" % self.interval + ps_compact(open(os.path.join(HERE, "collect_windows.ps1"), encoding="utf-8").read()))
            return base + [" ".join(argv)], stdin
        if self.cfg.get("os") == "macos":   # the same Mac reader as this Mac's, built from this file's source
            return base + ["python3 -"], mac_collector_script(self.interval).encode()
        script = "INTERVAL=%s\n" % self.interval + open(os.path.join(HERE, "collect_linux.py"), encoding="utf-8").read()
        return base + ["python3 -"], script.encode()

    def ssh_loop(self):
        cmd, stdin = self.ssh_cmd()
        self.set_status("connecting", self.error)   # the last failure stays on the offline card until a reading or the next failure
        p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.proc = p
        if not self.on.is_set():   # turned off while it was starting
            p.terminate()
        if stdin:
            p.stdin.write(stdin)
            if self.cfg.get("os") == "windows":
                p.stdin.flush()  # Windows: the script as one line; stdin then stays open, the collector exits when it closes (its lifeline)
            else:
                p.stdin.close()  # Linux: the script itself; python3 - runs it at EOF
        err_tail = collections.deque(maxlen=5)
        threading.Thread(target=lambda: [err_tail.append(l.decode("utf-8", "replace").strip()) for l in p.stderr], daemon=True).start()
        heard, stalled, bad = [time.time()], [], [False]   # when the last good reading came; whether the watchdog ended the session; bad readings since
        def watchdog():   # a hung docker, wsl.exe or nvidia-smi call leaves SSH up (sshd answers keepalives) and the read blocked
            while p.poll() is None:
                if time.time() - heard[0] > self.stall:
                    stalled.append(True)
                    p.kill()
                    return
                time.sleep(min(1.0, self.stall / 4))
        threading.Thread(target=watchdog, daemon=True).start()
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
                    view = self.derive_generic(raw) if self.cfg.get("os") == "macos" else self.derive_linux(raw)
            except Exception as e:
                err_tail.append("bad reading: %s" % e)
                bad[0] = True   # not a reading: the deadline keeps running
                continue
            if view:
                heard[0], bad[0] = time.time(), False
                self.got(view)
        p.wait()
        tail = " ".join(dict.fromkeys(x for x in err_tail if x))
        if stalled:
            msg = ("no good reading in %g s" if bad[0] else "timed out: no reading in %g s") % self.stall + ("; " + tail if tail else "")
        else:
            msg = tail or "connection closed (exit %s)" % p.returncode
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
            argv, script = ps_launch("$FleetInterval=%s\n" % self.interval + ps_compact(open(os.path.join(HERE, "collect_windows.ps1"), encoding="utf-8").read()))
            p = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
            self.proc = p     # stop_collectors ends it before a restart: there's no sshd to outlive
            p.stdin.write(script)
            p.stdin.flush()   # stdin stays open: the collector's lifeline, closed when Fleet exits
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
        gpus, pid_gpu = self.linux_gpus(r, t)
        pdisks = r.get("pdisks") or {}
        pnet = r.get("pnet") or {}
        disks = self.linux_disks(r, t)
        gpu_by_pid = {pid: sum(v.values()) for pid, v in pid_gpu.items()}
        procs = []
        cont_u, vm_u, unit_u = {}, {}, {}
        cont_g, vm_g, unit_g = {}, {}, {}   # what each of them uses of each GPU (by position in gpus)
        r_cid = {p[0]: p[9] for p in r["procs"]}
        by_pid = {}
        for p in r["procs"]:
            pid, ppid, comm, state, ticks, rss, threads, user, iob, cid, vm, unit, cmd = p[:13]
            lastcpu = p[13] if len(p) > 13 else -1
            c = self.rate("p.%d.t" % pid, ticks, t) / hz
            d = self.rate("p.%d.io" % pid, iob, t) / MB if iob >= 0 else 0.0
            g = gpu_by_pid.get(pid, 0.0)
            pn = pnet.get(str(pid)) or {}  # a process the collector doesn't list has moved nothing (b counts from 0)
            row = [pid, ppid, comm, user, state, c, rss / GB, d, g, threads, cmd, "", lastcpu, sorted(pid_gpu.get(pid, {})), list(pdisks.get(str(pid), [])),
                   list(pn.get("ifs", [])), self.rate("pn.%d" % pid, pn.get("b", 0), t) / MB]
            procs.append(row)
            by_pid[pid] = row
            u = [c, rss / GB, g, d, 0.0]
            if cid:
                acc, gacc = cont_u.setdefault(cid, [0.0] * 5), cont_g.setdefault(cid, [0.0] * len(gpus))
            elif vm:
                acc, gacc = vm_u.setdefault(vm, [0.0] * 5), vm_g.setdefault(vm, [0.0] * len(gpus))
            elif unit:
                acc, gacc = unit_u.setdefault(unit, [0.0] * 5), unit_g.setdefault(unit, [0.0] * len(gpus))
            else:
                acc = gacc = None
            if acc is not None:
                for i in range(4):
                    acc[i] += u[i]
                for i, v in pid_gpu.get(pid, {}).items():
                    gacc[i] += v
        self.prune(t)
        containers = []
        for c in r["containers"]:
            u = cont_u.get(c["id"], [0.0] * 5)
            rx, tx = self.rate("c.%s.rx" % c["id"], c["rx"], t) / MB, self.rate("c.%s.tx" % c["id"], c["tx"], t) / MB
            u[4] = rx + tx
            containers.append(dict(c, u=u, gu=cont_g.get(c["id"], [0.0] * len(gpus)), netrx=rx, nettx=tx))
        vmmap = {v["name"]: v for v in r.get("vms", [])}
        vms = []
        for name, v in vmmap.items():
            u = vm_u.get(name, [0.0] * 5)
            u[4] = sum(x["rx"] + x["tx"] for x in ifs if x["name"] in [i["if"] for i in v["ifs"]])
            # measured: which of u the host sees (#300); without a tap on the host (a NIC passed through) not its network
            vms.append({"name": name, "u": u, "gu": vm_g.get(name, [0.0] * len(gpus)), "running": True, "ifs": v["ifs"], "cpus": (r.get("vm_cpus") or {}).get(name, ""),
                        "measured": [0, 1, 2, 3, 4] if v["ifs"] else [0, 1, 2, 3]})
        # Scheduled jobs: crontab lines (deduplicated) and systemd timers.
        jobs, seen = [], set()
        for c in r.get("cron", []):
            k = (c["sched"], c["cmd"])
            if k in seen:
                continue
            seen.add(k)
            jobs.append({"name": job_name(c["cmd"]), "sched": c["sched"], "human": human_cron(c["sched"]), "cmd": c["cmd"],
                         "src": c["src"], "last": "", "running": False, "u": [0.0] * 5, "gu": [0.0] * len(gpus)})
        # The host's cron; a container's own cron runs the container's jobs, which are its usage already.
        cron_daemons = {p[0] for p in r["procs"] if p[2] in ("cron", "crond") and not p[9]}

        job_at = {}

        def job_of(row):
            """The job a process cron started runs (by its command), for that process and everything under
            it, however deep: cron's own per-job child (named cron too) is cron's, Base."""
            chain, pid = [], row[0]
            while pid in by_pid and pid not in cron_daemons and pid not in job_at and len(chain) < 64:
                chain.append(pid)
                pid = by_pid[pid][1]
            if pid in job_at:
                ji = job_at[pid]
            elif chain and pid in cron_daemons:
                ji = cron_job(jobs, by_pid[chain[-1]][10])  # chain[-1] is the process cron started
            else:
                ji = None
            for q in chain:
                job_at[q] = ji
            return ji
        for row in procs:
            ji = job_of(row)
            if ji is not None:
                j = jobs[ji]
                j["running"] = True
                for i, v in enumerate((row[5], row[6], row[8], row[7])):
                    j["u"][(0, 1, 2, 3)[i]] += v
                for i, v in pid_gpu.get(row[0], {}).items():
                    j["gu"][i] += v
                row[11] = "job:%d" % ji
        for tm in r.get("timers", []):
            u = unit_u.get(tm["unit"], [0.0] * 5)
            jobs.append({"name": tm["timer"].replace(".timer", ""), "sched": "systemd timer", "human": "timer",
                         "cmd": tm["unit"], "src": "systemd", "last": timer_last(tm["line"]),
                         "running": tm["unit"] in unit_u, "u": u, "gu": unit_g.get(tm["unit"], [0.0] * len(gpus))})
        gpu_total = sum(g["util"] for g in gpus)
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
        timer_of = {}  # a timer's service -> its job, the node /api/procs puts the service's processes under
        for i, j in enumerate(jobs):
            if j["src"] == "systemd":
                timer_of.setdefault(j["cmd"], i)
        for p in r["procs"]:
            if p[9]:
                owner[p[0]] = "c:" + p[9]
            elif p[10]:
                owner[p[0]] = "vm:" + p[10]
            elif p[11] in timer_of:
                owner[p[0]] = "job:%d" % timer_of[p[11]]
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
            g = {"name": c["name"], "mem": mem, "util": 0.0, "busy": c.get("busy", -1), "mhz": c.get("mhz", 0), "driver": c.get("driver", ""),
                 "passthrough": bool(c.get("passthrough")), "m": {}, "lim": {}}
            if not c.get("passthrough"):
                hw = c.get("hwmon") or {}
                if vram[0]:
                    g["m"]["vram"], g["lim"]["vram"] = vram[1], vram[0]
                if "temp" in hw:
                    g["m"]["temp"] = hw["temp"] / 1000.0
                if "power" in hw:          # amdgpu: average power, microwatts
                    g["m"]["power"] = hw["power"] / 1e6
                elif "energy" in hw:       # i915/xe: cumulative energy, microjoules
                    g["m"]["power"] = self.rate("gpuenergy." + c["pdev"], hw["energy"], t) / 1e6
                if hw.get("power_max"):
                    g["lim"]["power"] = hw["power_max"] / 1e6
                if c.get("mhz") or c.get("maxmhz"):   # an idle GPU can clock down to 0
                    g["m"]["clock"] = float(c.get("mhz") or 0)
                    if c.get("maxmhz"):
                        g["lim"]["clock"] = float(c["maxmhz"])
                if c.get("memmhz"):
                    g["m"]["memclock"] = float(c["memmhz"])
                if "fan" in hw:
                    g["m"]["fanrpm"] = float(hw["fan"])
            gpus.append(g)
        nv_idx = {}
        for g in sorted(r.get("gpus", []), key=lambda g: g["index"]):
            nv_idx[g["index"]] = len(gpus)
            m, lim = {"util": g["util"]}, {}
            for k, src in (("memctl", "memUtil"), ("encode", "enc"), ("decode", "dec"), ("temp", "temp"), ("power", "power"),
                           ("clock", "clock"), ("memclock", "memClock"), ("fan", "fan")):
                if g.get(src) is not None:
                    m[k] = g[src]
            if g.get("memTotal"):
                m["vram"], lim["vram"] = g["memUsed"] * MIB, g["memTotal"] * MIB
            for k, src in (("power", "powerLimit"), ("clock", "clockMax")):
                if g.get(src):
                    lim[k] = g[src]
            gpus.append({"name": g["name"], "mem": "%d GB VRAM" % round(g["memTotal"] / 1024) if g["memTotal"] else "", "util": g["util"], "nvidia": True,
                         "m": m, "lim": lim})
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
            g["m"]["util"] = g["util"]
            for e in DRIVER_ENGINES.get(g.get("driver"), []):   # the driver's engines are there even when idle
                g["m"].setdefault(DRM_ENGINE.get(e, e), 0.0)
            for (gi, e), v in eng.items():   # each engine, under Fleet's name for it
                if gi == i:
                    k = DRM_ENGINE.get(e, e)
                    g["m"][k] = min(100.0, g["m"].get(k, 0.0) + v)
        for gidx, pid, sm in r.get("gproc", []):
            idx = nv_idx.get(gidx)
            if idx is not None:
                pid_gpu.setdefault(pid, {})[idx] = pid_gpu.get(pid, {}).get(idx, 0.0) + sm
        return gpus, pid_gpu

    def prune(self, t):
        if len(self.cum) > 40000:
            cutoff = t - 30
            self.cum = {k: v for k, v in self.cum.items() if v[1] >= cutoff}

    # ------------------------------------------------------------ windows
    def windows_gpus(self, r):
        """Adapters by VRAM size, largest first, each named by its LUID (DXGI's adapter list), with its engines by
        type (the GPU Engine counters), dedicated and shared memory, and NVIDIA's own numbers from the nvidia-smi
        row of the same card: one of the same name, and of two cards of one model the one whose memory.used is the
        adapter's dedicated VRAM in use."""
        nv = [[x.strip() for x in line.split(",")] for line in r.get("nvidia", []) if line and line.count(",") >= 4]
        num = lambda x: float(x) if re.match(r"^-?\d+(\.\d+)?$", x or "") else None
        key = lambda s: tuple(int(x, 16) for x in s.split("_")) if re.match(r"^0x[0-9a-fA-F]+_0x[0-9a-fA-F]+$", str(s)) else str(s).lower()
        dx = {}   # LUID -> (DXGI's position, name, VRAM bytes)
        for i, a in enumerate(r.get("adapters", [])):
            dx.setdefault(key(a.get("luid")), (i, str(a.get("name") or ""), float(a.get("vram") or 0)))
        info = lambda g: dx.get(key(g.get("luid")))
        lone = len(r.get("gpus", [])) == 1 and not dx   # no adapter list: a lone adapter can only be the one nvidia-smi or Windows names
        gpus, luid_idx = [], {}
        order = lambda g: (-info(g)[2], info(g)[0], "") if info(g) else (0.0, len(dx), str(g.get("luid")).lower())
        ordered = sorted(r.get("gpus", []), key=order)
        # Each adapter's nvidia-smi row. Older GeForce and Quadro drivers leave "NVIDIA " out of nvidia-smi's name. Cards
        # of one model share a name, and DXGI lists the primary display's first, whatever nvidia-smi's index: WDDM reports
        # one VRAM-in-use number to both, so a row goes to the adapter whose dedicated use is its memory.used. Within
        # 64 MiB (both idle, say) that can't tell them apart: the pairing the last reading found holds, else Fleet's order.
        model = lambda s: re.sub(r"^nvidia ", "", " ".join(s.lower().split()))
        near = []
        for i, g in enumerate(ordered):
            for j, x in enumerate(nv):
                if info(g) and model(x[1]) == model(info(g)[1]):
                    used, ded = num(x[3]), g.get("dedicated")
                    d = abs(used * MIB - float(ded)) if used is not None and isinstance(ded, (int, float)) else float("inf")
                    near.append((d if d > 64 * MIB else 0.0, self.nv_pair.get(key(g["luid"])) != x[0], i, j))
        rows = {}
        for _, _, i, j in sorted(near):
            if i not in rows and j not in rows.values():
                rows[i] = j
        self.nv_pair = {key(ordered[i]["luid"]): nv[j][0] for i, j in rows.items()}
        for i, g in enumerate(ordered):
            luid_idx[g["luid"]] = i
            a, videos = info(g), r.get("videoNames", [])
            if a:
                name, size, row = a[1] or "GPU %d" % i, a[2], nv[rows[i]] if i in rows else []
            elif lone:
                row = nv[0] if len(nv) == 1 else []
                name, size = row[1] if row else videos[0] if len(videos) == 1 else "GPU 0", 0.0
            else:
                name, size, row = "GPU %d" % i, 0.0, []
            total = num(row[4]) if len(row) > 4 else None
            m = {"util": min(100.0, g.get("util", 0))}
            for e, v in (g.get("eng") or {}).items():
                e = e.lower()
                k = "compute" if e.startswith("compute") or e == "cuda" else WIN_ENGINE.get(e)
                if k:
                    m[k] = max(m.get(k, 0.0), min(100.0, float(v)))
            lim = {}
            if g.get("dedicated") is not None:
                m["vram"] = g["dedicated"]
            if g.get("shared") is not None:
                m["shared"] = g["shared"]
            if total or size:
                lim["vram"] = total * MIB if total else size
            if len(row) >= 15:   # index,name,util,mem used,total,mem util,temp,power,power limit,clock,max clock,mem clock,fan,enc,dec
                for k, j in (("memctl", 5), ("temp", 6), ("power", 7), ("clock", 9), ("memclock", 11), ("fan", 12)):
                    if num(row[j]) is not None:
                        m[k] = num(row[j])
                for k, j in (("encode", 13), ("decode", 14)):   # when no process has used the engine, there's no counter for it
                    if k not in m and num(row[j]) is not None:
                        m[k] = num(row[j])
                for k, j in (("power", 8), ("clock", 10)):
                    if num(row[j]):
                        lim[k] = num(row[j])
            for k in ("3d", "copy", "encode", "decode"):   # Task Manager's four, there even when idle
                m.setdefault(k, 0.0)
            vram = lim.get("vram", 0)
            gpus.append({"name": name, "mem": "%d GB VRAM" % round(vram / GB) if vram >= GB / 2 else "", "util": m["util"], "m": m, "lim": lim})
        gpu_by_pid = {}
        for pid, luid, pct in r.get("gproc", []):
            if luid in luid_idx:
                gpu_by_pid.setdefault(pid, {})[luid_idx[luid]] = gpu_by_pid.get(pid, {}).get(luid_idx[luid], 0) + pct
        return gpus, gpu_by_pid

    def derive_windows(self, r):
        for k in ("lcpus", "topo", "gpus", "adapters", "nvidia", "videoNames", "gproc", "procs", "ifs", "wsl", "containers", "dstats", "tasks", "disks"):
            r[k] = aslist(r.get(k))
        for a in r["ifs"]:
            a["addrs"] = [x for x in aslist(a.get("addrs")) if isinstance(x, str) and x]  # an empty list arrives as {}
        for tk in r["tasks"]:
            tk["triggers"] = aslist(tk.get("triggers"))
        t = r["t"]
        tp, tn, td = r.get("tp", t), r.get("tn", t), r.get("td", t)   # when process CPU, adapter bytes and docker stats were read
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
        def mhz(c):   # Task Manager's Speed: frequency x % Processor Performance / % of Maximum Frequency
            return round(c.get("mhz", 0) * c["perf"] / (c.get("maxf") or 100.0)) if c.get("perf", 0) > 0 else c.get("mhz", 0)
        lcpus = [{"n": c["n"], "pct": c["pct"], "mhz": mhz(c), "core": str(tmap.get(c["n"], ("",))[0]),
                  "eff": tmap.get(c["n"], (0, 0, -1))[1], "l3": str(tmap.get(c["n"], (0, 0, -1))[2])} for c in lc]
        groups = group_lcpus_windows(lcpus)
        host_cpu = sum(c["pct"] for c in lc) / 100.0
        mem_used = (r["mem"][0] - r["mem"][1]) / GB
        disk = float(r.get("diskBps") or 0) / MB
        self.disk_peak = max(self.disk_peak, disk * MB * 1.25)
        ifs, net, speed = [], 0.0, 0.0
        for a in r.get("ifs", []):
            rx, tx = self.rate("ifrx." + a["name"], a["rx"], tn) / MB, self.rate("iftx." + a["name"], a["tx"], tn) / MB
            kind = "virtual" if a.get("virtual") else "physical"
            ifs.append({"name": a["name"], "kind": kind, "rx": rx, "tx": tx, "addrs": a.get("addrs") or [], "master": "",
                        "state": a.get("status", ""), "speed": a.get("speed", ""), "desc": a.get("desc", "")})
            if kind == "physical" and a.get("status") == "Up":
                net += rx + tx
                m = re.match(r"([\d.]+)\s*([GMK])bps", a.get("speed", ""))
                if m:
                    speed += float(m.group(1)) * {"G": 1000, "M": 1, "K": 0.001}[m.group(2)]
        gpus, gpu_by_pid = self.windows_gpus(r)
        procs, vm_u, vm_g = [], [0.0] * 5, [0.0] * len(gpus)
        for p in r.get("procs", []):
            pid, ppid, name, c_secs, ws, threads, io, cmd = p
            c = self.rate("wp.%d" % pid, c_secs, tp)  # cumulative CPU seconds -> cores
            io = max(0.0, io)
            g = sum(gpu_by_pid.get(pid, {}).values())
            row = [pid, ppid, name, "", "", c, ws / GB, io / MB, g, threads, cmd, "base", -1, sorted(gpu_by_pid.get(pid, {})), [],
                   aslist((r.get("pnet") or {}).get(str(pid))), -1.0]
            if name.lower() in ("vmmem", "vmmemwsl"):
                row[11] = "vm:WSL"
                for i, v in enumerate((c, ws / GB, g, io / MB)):
                    vm_u[i] += v
                for i, v in gpu_by_pid.get(pid, {}).items():
                    vm_g[i] += v
            procs.append(row)
        containers = []
        stats = {}
        for line in r.get("dstats", []):
            try:
                s = json.loads(line)
            except Exception:
                continue
            cpu = s.get("CPUPerc", "0%").rstrip("%")
            if not re.match(r"^\d+(\.\d+)?$", cpu):
                continue   # "--": docker stats couldn't read it in time; idle this reading, its I/O counters wait for the next
            bio = s.get("BlockIO", "0B / 0B").split("/")
            stats[s.get("ID", "")[:12]] = (docker_pct(s.get("CPUPerc")),
                                           size_bytes(s.get("MemUsage", "0B").split("/")[0]) / GB,
                                           sum(size_bytes(x) for x in bio)) + netio(s.get("NetIO"))
        for line in r.get("containers", []):
            try:
                c = json.loads(line)
            except Exception:
                continue
            labels = dict(kv.split("=", 1) for kv in c.get("Labels", "").split(",") if "=" in kv)
            cid = c.get("ID", "")[:12]
            st = stats.get(cid)
            if st:   # received and sent at docker stats' own stamp (#145, #177)
                rx, tx = self.rate("cnr." + cid, st[3], td) / MB, self.rate("cnt." + cid, st[4], td) / MB
                u = [st[0], st[1], 0.0, self.rate("cb." + cid, st[2], td) / MB, rx + tx]
            else:    # docker stats couldn't read it: idle this reading, its counters untouched (#160)
                rx = tx = 0.0
                u = [0.0] * 5
            containers.append({"id": cid, "name": c.get("Names", ""), "image": c.get("Image", ""), "status": c.get("Status", ""),
                               "project": labels.get("com.docker.compose.project", ""), "service": labels.get("com.docker.compose.service", ""),
                               "file": labels.get("com.docker.compose.project.config_files", ""), "networks": c.get("Networks", ""), "u": u,
                               "netrx": rx, "nettx": tx})
        # The WSL utility VM also runs Docker Desktop's containers: they are listed on their own, the rest is the VM's.
        for i in range(5):
            vm_u[i] = max(0.0, vm_u[i] - sum(c["u"][i] for c in containers))
        running = [w["name"] for w in r.get("wsl", []) if w.get("state") == "Running"]
        vms = []
        if r.get("wsl"):
            vms.append({"name": "WSL", "u": vm_u, "gu": vm_g, "running": bool(running), "ifs": [], "distros": r.get("wsl", []), "cpus": "",
                        "measured": [0, 1, 2, 3]})   # vmmemWSL's CPU, memory, GPU and I/O; its network isn't seen (#300)
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
            "disks": [{"name": d.get("name", ""), "model": d.get("model", ""), "size": d.get("size", 0), "rot": bool(d.get("rot")), "role": "",
                       "mounts": [x for x in str(d.get("letters", "")).split() if x], "read": float(d.get("read") or 0) / MB,
                       "write": float(d.get("write") or 0) / MB, "busy": min(100.0, float(d.get("busy") or 0))} for d in r["disks"]],
        }

    # ------------------------------------------------------------ macOS (already rates)
    # A Mac's reader sends rates, so its reading is the view. A remote Mac's is data from another machine, like any
    # host's: every process row must have the types the server and the page take it to have, or the reading is a bad
    # reading, as on Linux, where derive_linux can't use a PID that isn't a number (#299).
    def derive_generic(self, r):
        procs = r.get("procs") if isinstance(r, dict) else None
        if not isinstance(procs, list):
            raise ValueError("no process list")
        for i, p in enumerate(procs):
            if not mac_row_ok(p):
                raise ValueError("process row %d isn't one" % i)
        return r


# A process row from a Mac's reader: pid, ppid, name, user, state, CPU, memory, disk, GPU, threads, command, owner,
# last CPU, [GPU positions], [disks], [interfaces], network ("num": an int or a float, never a bool)
MAC_ROW = (int, int, str, str, str, "num", "num", "num", "num", int, str, str, int, (int,), (str,), (str,), "num")


def mac_row_ok(p):
    def ok(v, t):
        if isinstance(v, bool):
            return False
        if t == "num":
            return isinstance(v, (int, float))
        if isinstance(t, tuple):
            return isinstance(v, list) and all(ok(x, t[0]) for x in v)
        return isinstance(v, t)
    return isinstance(p, list) and len(p) == len(MAC_ROW) and all(ok(v, t) for v, t in zip(p, MAC_ROW))


def vm_hostside_u(v, mm):
    """What a VM costs its host, [cpu, mem, gpu, disk, net]: what the host measured of it (v["u"]), and for a figure
    the host can't see (v["measured"] leaves it out: a Mac's VMs' disk and network, WSL's network) what the guest
    itself reports, while it's live (#300). A host that doesn't say measured all five."""
    u = list(v["u"])
    seen = v.get("measured")
    seen = set(range(5)) if not isinstance(seen, list) else {i for i in seen if isinstance(i, int) and not isinstance(i, bool)}
    if mm is None or seen >= set(range(5)):
        return u
    with mm.lock:
        guest = mm.view if mm.status == "ok" else None
    if guest:
        for i in set(range(5)) - seen:
            u[i] = guest["host"][i]
    return u


def aslist(x):
    """PowerShell's ConvertTo-Json turns one-item arrays into a bare value; undo that."""
    if x is None or x == "":
        return []
    return x if isinstance(x, list) else [x]


JOB_GUARDS = ("cd", "test", "[", "[[", "command", "true", ":", "fi", "done", "}", ")")
# Wrappers of a job's command, with their options that take a value; flock and timeout take one argument
# (the lock file, the duration) before the command.
JOB_WRAPPERS = {"run-parts": (), "nice": ("-n",), "ionice": ("-c", "-n", "-p"), "env": ("-u",), "sudo": ("-u", "-g"), "nohup": (),
                "flock": ("-w", "-E"), "timeout": ("-s", "-k"), "php": (), "python3": (), "python": (), "sh": (), "bash": ()}
JOB_ARGS = {"flock": 1, "timeout": 1}


def job_name(cmd):
    """A short name for a cron job: what it runs (run-parts: the directory), past a guard (test -x X ||,
    [ -x X ] &&, command -v X &&), cd, variable assignments, and wrappers with their own arguments."""
    for part in re.split(r"&&|\|\||;", cmd):
        words = [w.strip("'\";") for w in part.split()]
        while words and words[0] in ("{", "(", "if", "then", "else", "do", "!", "exec"):
            words.pop(0)
        if not words or words[0] in JOB_GUARDS:
            continue
        opts, args, i = (), 0, 0
        while i < len(words):
            w = words[i]
            i += 1
            if w.startswith("-"):
                i += w in opts  # its value
            elif re.match(r"[A-Za-z_]\w*=", w):
                continue
            elif args:
                args -= 1
            elif os.path.basename(w) in JOB_WRAPPERS:
                opts, args = JOB_WRAPPERS[os.path.basename(w)], JOB_ARGS.get(os.path.basename(w), 0)
            elif os.path.basename(w):
                return os.path.basename(w)[:48]
    return (cmd.split() or [cmd])[0][:48]


def vm_cap(view, v):
    """What a VM seen from its host can use there: the host CPUs its process may run on (all of them when the host
    doesn't say), the host's memory, and the host's disk and network."""
    return [len(cpulist(v.get("cpus", ""))) or max(1, view["ncpu"]), view["cap"][1], 0, view["cap"][3], view["cap"][4]]


def job_ids(mid, jobs):
    """Each scheduled job's node id, from what the job is (where it's defined, its schedule, its command, its name), not
    its place in the list: systemd lists timers by when they fire next, so places change all the time, and a job's
    history would carry on under another job's id. Exact duplicates (an unduplicated crontab) are numbered."""
    ids, seen = [], collections.Counter()
    for j in jobs:
        key = "\0".join((j.get("src", ""), j.get("sched", ""), j.get("cmd", ""), j.get("name", "")))
        seen[key] += 1
        jid = "%s/base/cron/%s-%08x" % (mid, slug(j.get("name", "")), zlib.crc32(key.encode()))
        ids.append(jid if seen[key] == 1 else "%s-%d" % (jid, seen[key]))
    return ids


TIMER_LINE = re.compile(r"(?:\w{3} \S+ \S+ \S+|-|n/a) (?:-|n/a|.+? (?:left|ago)) (?:\w{3} (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}):\d{2} \S+|-|n/a)(?: |$)")


def timer_last(line):
    """When a timer last ran, from its `systemctl list-timers` line (NEXT LEFT LAST PASSED; LEFT and PASSED
    take any number of words, a time never reached is "-" or "n/a"), as Windows tasks show it
    (2026-11-15 14:47), or "" if it never ran."""
    m = TIMER_LINE.match(" ".join(line.split()))
    return "%s %s" % m.groups() if m and m.group(1) else ""


SHELLS = ("sh", "bash", "dash", "ash", "zsh", "ksh", "mksh", "busybox")
SH_RESERVED = ("{", "}", "!", "if", "then", "else", "elif", "fi", "do", "done", "while", "until", "exec")
SH_REDIRECT = re.compile(r"&>>?|\d*(?:>>|>&|>\||<&|<>|<<<|<<-?|>|<)")   # each takes a word: its file, fd or here-doc tag


def sh_word(line, i):
    """The shell word that starts at line[i]: (its pieces, where it ends). A piece is text as the program gets it (quotes
    gone), or None where the shell expands something ($name, ${...}, $(...), `...`, a glob, a leading ~): any text."""
    out, n = [], len(line)

    def text(s):
        if out and out[-1] is not None:
            out[-1] += s
        else:
            out.append(s)

    def expands():
        if not out or out[-1] is not None:
            out.append(None)

    def closing(j, open_, close):   # just past what closes the bracket opened before line[j]
        depth = 1
        while j < n and depth:
            depth += (line[j] == open_) - (line[j] == close)
            j += 2 if line[j] == "\\" else 1
        return j

    while i < n and line[i] not in " \t\n;&|()<>":
        c = line[i]
        if c == "'":
            j = line.find("'", i + 1)
            j = n if j < 0 else j
            text(line[i + 1:j])
            i = j + 1
        elif c == "\\":
            text(line[i + 1:i + 2])
            i += 2
        elif c == '"':
            i += 1
            while i < n and line[i] != '"':
                if line[i] == "\\" and line[i + 1:i + 2] in ("$", "`", '"', "\\"):
                    text(line[i + 1])
                    i += 2
                elif line[i] in "$`" and line[i + 1:i + 2] not in ("", '"', " "):
                    i = sh_expansion(line, i, closing)
                    expands()
                else:
                    text(line[i])
                    i += 1
            i += 1
        elif c in "$`" and line[i + 1:i + 2] not in ("", " ", "\t"):
            i = sh_expansion(line, i, closing)
            expands()
        elif c in "*?[" or (c == "~" and not out):
            i += 1
            expands()
        else:
            text(c)
            i += 1
    return out, i


def sh_expansion(line, i, closing):
    """Where the expansion at line[i] ($name, $1, ${...}, $(...), $((...)), `...`) ends."""
    if line[i] == "`":
        j = i + 1
        while j < len(line) and line[j] != "`":
            j += 2 if line[j] == "\\" else 1
        return j + 1
    if line[i + 1] in "({":
        return closing(i + 2, line[i + 1], ")" if line[i + 1] == "(" else "}")
    m = re.compile(r"[A-Za-z_]\w*|[0-9@*#?$!-]").match(line, i + 1)
    return m.end() if m else i + 1


def sh_last_command(line):
    """The words of the last simple command of a shell line, as the program it runs gets them, or None. Each word is
    its texts with any text between each two (what the shell expands). A shell execs a line's last command in its
    own place (dash, cron's /bin/sh on Debian and Ubuntu, does so past a `cd X &&` or a guard, and with
    redirections applied), so it is what cron's child runs then. The line splits at && || ; | & and brackets;
    redirections and their words, VAR=value before the command and reserved words go."""
    cmds, cur, i, n, target = [], [], 0, len(line), False
    while i < n:
        c = line[i]
        m = SH_REDIRECT.match(line, i)
        if c in " \t":
            i += 1
        elif m:
            i, target = m.end(), True
        elif line.startswith(("&&", "||"), i) or c in ";&|()\n":
            cmds.append(cur)
            cur, target = [], False
            i += 2 if line.startswith(("&&", "||"), i) else 1
        elif c == "#":   # a comment, from a word's start to the end of the line
            break
        else:
            start = i
            pieces, i = sh_word(line, i)
            raw = line[start:i]
            if target:
                target = False
            elif cur or not (raw in SH_RESERVED or re.match(r"[A-Za-z_]\w*=", raw)):
                cur.append(pieces)
    cmds = [c for c in cmds + [cur] if c]
    if not cmds:
        return None
    words = []   # a command line's words are what it holds between spaces: a quoted "7 days" is two of them
    for pieces in cmds[-1]:
        w = [""]
        for p in pieces:
            if p is None:
                w.append("")
                continue
            segs = re.split(r"\s+", p)
            w[-1] += segs[0]
            for seg in segs[1:]:
                if w != [""]:
                    words.append(w)
                w = [seg]
        if w != [""]:
            words.append(w)
    return words or None


def sh_runs(words, got):
    """Whether the command line got (its words) is the command words (from sh_last_command): word for word, where
    each word's texts come in order and anything may lie between them. Linear: nothing is tried twice."""
    if len(got) != len(words):
        return False
    for w, s in zip(words, got):
        if len(w) == 1:
            if s != w[0]:
                return False
            continue
        if len(s) < len(w[0]) + len(w[-1]) or not s.startswith(w[0]) or not s.endswith(w[-1]):
            return False
        at, end = len(w[0]), len(s) - len(w[-1])
        for part in w[1:-1]:
            at = s.find(part, at, end)
            if at < 0:
                return False
            at += len(part)
    return True


def cron_job(jobs, cmd):
    """Index of the crontab job a process cron started runs, from its command line (cmd), or None. Cron
    hands the job's line (up to an unescaped %, with \\% as %) to `sh -c`; a shell may exec the line's last
    command in its place (a lone command, or the one after a `cd X &&`, without its redirections), and a
    script then runs as `<interpreter> <script>`."""
    words = cmd.split()
    shell = len(words) > 2 and os.path.basename(words[0]) in SHELLS and words[1] == "-c"
    got = " ".join(words[2:] if shell else words)
    cut = len(cmd) >= 300  # the collector keeps 300 characters of a command line
    lines = []
    for j in jobs:
        line = " ".join(re.split(r"(?<!\\)%", j["cmd"])[0].replace("\\%", "%").split())
        lines.append((line, sh_last_command(line) if line and not shell else None))
    gw = got.split()
    tests = (lambda line, last: got == line or (cut and line.startswith(got)),                  # sh -c <line>, or the line itself
             lambda line, last: last and sh_runs(last, gw),                                     # the line's last command
             lambda line, last: not shell and (got.endswith(" " + line) or (last and len(gw) > len(last) and sh_runs(last, gw[-len(last):]))))
    for test in tests:
        for i, (line, last) in enumerate(lines):
            if line and test(line, last):
                return i
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
def parse_docker_top(text):
    """docker top <c> -eo pid,ppid,user,stat,cputimes,rss,nlwp,args: (pid, ppid, user, stat, CPU seconds,
    RSS KB, threads, command line), the command line whole."""
    rows = []
    lines = text.splitlines()
    if not lines or not lines[0].split()[:1] == ["PID"]:
        return rows
    for line in lines[1:]:
        f = line.split(None, 7)
        try:
            rows.append((int(f[0]), int(f[1]), f[2], f[3], int(f[4]), int(f[5]), int(f[6]), f[7] if len(f) > 7 else ""))
        except (ValueError, IndexError):
            continue
    return rows


class MacCollector:
    """This Mac, read directly: ps, host_processor_info, vm_stat, netstat, ioreg, docker, crontab, launchd."""

    @staticmethod
    def responsible_pid(pid):
        """The process macOS holds responsible for pid: for an XPC service (a VM run by Apple's Virtualization
        framework, under launchd), the app that asked for it. 0 if there is none or it can't tell."""
        try:
            f = ctypes.CDLL(None).responsibility_get_pid_responsible_for_pid
            f.restype, f.argtypes = ctypes.c_int, [ctypes.c_int]
            return max(0, int(f(int(pid)))) if pid > 0 else 0
        except Exception:
            return 0

    @staticmethod
    def is_docker_vm(p, by_pid, responsible=0):
        """Docker Desktop's Linux VM: a VM process Docker started as its own child (older versions), or one
        macOS holds Docker responsible for (Apple's Virtualization framework runs it as an XPC service)."""
        def chain(q):
            out, seen = [], 0
            while q and seen < 20:
                out.append(q[10])
                q = by_pid.get(q[1])
                seen += 1
            return " ".join(out).lower()
        return "docker" in chain(p) or bool(responsible and responsible != p[0] and "docker" in chain(by_pid.get(responsible)))

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
        self.gpu_info = self.read_gpus()
        self.disk_names = {}
        self.vz_owners = {}
        self.nettop = None     # the nettop sample running beside the readings: (Popen, its output file, when it started)
        self.net_last = None   # the last sample it finished: (bytes in + out per pid, when it started)
        self.net_rates = {}    # MB/s per pid between the last two samples

    def disk_info(self, dn, rid=None):
        """diskutil's facts about a disk, kept per disk and registry entry (a disk name is reused when an image is ejected)."""
        if (dn, rid) not in self.disk_names:
            try:
                pl = plistlib.loads(subprocess.run(["diskutil", "info", "-plist", dn], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=8).stdout)
                self.disk_names[(dn, rid)] = {"model": pl.get("MediaName", ""), "size": pl.get("TotalSize") or pl.get("Size") or 0, "rot": pl.get("SolidState") is False,
                                              "image": pl.get("BusProtocol") == "Disk Image" or pl.get("VirtualOrPhysical") == "Virtual"}
            except Exception:
                self.disk_names[(dn, rid)] = {}
        return self.disk_names[(dn, rid)]

    def vz_owner(self, pid):
        """Whose Virtualization.framework VM a process runs, from the files it holds open: "docker" for Docker
        Desktop's (its kernel in Docker.app, its disk under com.docker.docker), a UTM VM's name from the .utm
        bundle its disk is in, or "" when they don't say (asked again the next reading)."""
        if pid not in self.vz_owners:
            own = ""
            for line in run(["lsof", "-nP", "-p", str(pid), "-F", "n"]).splitlines():
                if re.match(r"n.*(/Docker\.app/Contents/|/com\.docker\.docker/)", line):
                    own = "docker"
                    break
                m = re.match(r"n.*/([^/]+)\.utm/", line)
                if m and not own:
                    own = m.group(1)
            if not own:
                return ""
            self.vz_owners[pid] = own
        return self.vz_owners[pid]

    def net_rates_now(self):
        """Each process's network rate (MB/s, in + out) from nettop. nettop takes about 5 s to print its one
        sample, so it runs beside the readings: a reading that finds it done starts the next one, and every
        reading uses the rates between the last two samples. A sample still running after 10 s is stopped."""
        t = time.time()
        if self.nettop:
            p, out, began = self.nettop
            if p.poll() is None and t - began <= 10:
                return self.net_rates
            if p.poll() is None:
                p.kill()
                p.wait()
                self.net_rates = {}
            else:
                out.seek(0)
                b = {}
                for line in out.read().decode("utf-8", "replace").splitlines()[1:]:
                    f = line.split(",")
                    if len(f) >= 3:
                        _name, _, pid = f[0].rpartition(".")
                        if pid.isdigit() and f[1].isdigit() and f[2].isdigit():
                            b[int(pid)] = int(f[1]) + int(f[2])
                if self.net_last and began > self.net_last[1]:
                    prev, dt = self.net_last[0], began - self.net_last[1]
                    self.net_rates = {pid: (v - prev[pid]) / dt / MB for pid, v in b.items() if pid in prev and v >= prev[pid]}
                self.net_last = (b, began)
            out.close()
        out = tempfile.TemporaryFile()  # a file, not a pipe, so nettop never waits on a full pipe
        try:
            self.nettop = (subprocess.Popen(["nettop", "-P", "-L", "1", "-x", "-J", "bytes_in,bytes_out"], stdout=out, stderr=subprocess.DEVNULL), out, t)
        except Exception:
            out.close()
            self.nettop = None
        return self.net_rates

    def read_gpus(self):
        """Every GPU in this Mac (Apple silicon's, or an Intel Mac's integrated and discrete ones), in IOAccelerator order."""
        try:
            d = json.loads(run(["system_profiler", "SPDisplaysDataType", "-json"], timeout=20) or "{}")
            out = []
            for g in d.get("SPDisplaysDataType", []):
                vram = g.get("spdisplays_vram") or g.get("spdisplays_vram_shared") or ""
                out.append({"name": g.get("sppci_model") or g.get("_name") or "GPU",
                            "mem": "unified memory" if "Apple" in (g.get("sppci_model") or "") else (vram.replace("_", " ") if vram else "")})
            return out or [{"name": self.model + " GPU", "mem": "unified memory"}]
        except Exception:
            return [{"name": self.model + " GPU", "mem": "unified memory"}]

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
        # Match cluster types to perf levels by name ("P" is Performance, "E" Efficiency); by count only when no
        # name matches, since counts can't tell 4P+4E apart.
        by_type = collections.OrderedDict()
        for n in sorted(ctype):
            by_type.setdefault(ctype[n], []).append(n)
        groups = []
        used = set()
        for ct, cpus in by_type.items():
            li = next((i for i, v in levels.items() if i not in used and ct[:1] and v[0][:1].upper() == ct[:1].upper()), None)
            if li is None:
                li = next((i for i, v in levels.items() if i not in used and v[2] == len(cpus)), None)
            used.add(li)
            lvl = levels.get(li, (ct, len(cpus), len(cpus)))
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
        # The kernel allocated the array in this process and it is ours: give it back, or every reading leaks a page.
        self.libc.vm_deallocate(self.libc.mach_task_self(), ctypes.cast(info, ctypes.c_void_p), ctypes.c_size_t(n_info.value * ctypes.sizeof(ctypes.c_int)))
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
        # Disks: every drive's block storage driver counts its bytes since boot (iostat shows only the first few
        # by name). Disk images are left out: their I/O is already counted on the drive that holds their files.
        try:
            drivers = plistlib.loads(subprocess.run(["ioreg", "-r", "-l", "-c", "IOBlockStorageDriver", "-d", "2", "-w", "0", "-a"],
                                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10).stdout)
        except Exception:
            drivers = []
        disk_b, mac_disks = 0, []
        for drv in drivers:
            st = drv.get("Statistics") or {}
            for media in drv.get("IORegistryEntryChildren") or []:
                dn = media.get("BSD Name")
                info = self.disk_info(dn, media.get("IORegistryEntryID")) if dn else {}
                if not dn or info.get("image"):
                    continue
                r, w = st.get("Bytes (Read)", 0), st.get("Bytes (Write)", 0)
                disk_b += r + w
                mac_disks.append({"name": dn, "model": info.get("model", ""), "size": info.get("size", 0), "rot": info.get("rot", False), "role": "",
                                  "mounts": [], "read": self.rate("dkr." + dn, r, t) / MB, "write": self.rate("dkw." + dn, w, t) / MB, "busy": -1})
        disk = self.rate("disk", disk_b, t) / MB
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
            m6 = re.search(r"inet6 ([0-9a-f:]+)(?:%\S+)? prefixlen (\d+)", line)
            if m6:
                for x in ifs:
                    if x["name"] == cur_if:
                        x.setdefault("addrs6", []).append(m6.group(1))
            m = re.search(r"inet (\d+\.\d+\.\d+\.\d+)(?: --> \S+)? netmask (0x[0-9a-f]+)", line)  # "A --> B": point-to-point (utun)
            if m:
                bits = bin(int(m.group(2), 16)).count("1")
                for x in ifs:
                    if x["name"] == cur_if:
                        x["addrs"].append("%s/%d" % (m.group(1), bits))
        stats = mac_gpu_stats(run(["ioreg", "-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"]))
        gpus = [{"name": gi["name"], "mem": gi["mem"], "util": stats[i]["util"] if i < len(stats) else 0.0, "m": stats[i] if i < len(stats) else {}, "lim": {}}
                for i, gi in enumerate(self.gpu_info)]
        gpu = sum(g["util"] for g in gpus)
        # Network per process: nettop has each process's bytes in/out (it runs beside the readings, see
        # net_rates_now); lsof says which local address (and so which interface) its connections use.
        # (netstat prints nothing when run from Python.)
        ip_if = {a.split("/")[0]: x["name"] for x in ifs for a in x["addrs"] + x.get("addrs6", [])}
        net_rates = self.net_rates_now()
        mac_net = {}
        cur_pid = None
        for line in run(["lsof", "-nP", "-iTCP", "-sTCP:ESTABLISHED", "-F", "pn"], timeout=10).splitlines():
            if line.startswith("p"):
                cur_pid = int(line[1:]) if line[1:].isdigit() else None
            elif line.startswith("n") and cur_pid:
                ip = line[1:].split("->")[0].rsplit(":", 1)[0].strip("[]")
                ifn = ip_if.get(ip)
                if ifn:
                    mac_net.setdefault(cur_pid, set()).add(ifn)
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
            procs.append([pid, int(f[1]), os.path.basename(f[6]), f[2], f[3], c, int(f[4]) * 1024 / GB, 0.0, 0.0, 0, args.get(pid, f[6]), "base", -1, [], [],
                          sorted(mac_net.get(pid, ())), net_rates.get(pid, 0.0)])
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
        self.vz_owners = {pid: own for pid, own in self.vz_owners.items() if pid in by_pid}
        for p in procs:
            a = p[10]
            if "com.apple.Virtualization.VirtualMachine" in a or re.search(r"qemu-system-\w+", a) or "prl_vm_app" in a:
                anc = ancestry(p).lower()
                m = re.search(r"([^/]+)\.utm", a) or re.search(r"-name\s+(?:guest=)?([^,\s]+)", a) or re.search(r"([^/]+)\.pvm", a)
                # Apple's Virtualization VMs run in an XPC service launchd starts (parent pid 1, arguments only
                # the service's path), so neither says whose VM it is; its open files do.
                vz = "com.apple.Virtualization.VirtualMachine" in a and not m and "docker" not in anc
                # macOS may say Docker is responsible for it (#210); if not, its open files may (#103)
                docker = self.is_docker_vm(p, by_pid, self.responsible_pid(p[0]))
                own = self.vz_owner(p[0]) if vz and not docker else ""
                if docker or own == "docker":
                    docker_vm = p
                    p[11] = "dockervm"
                    continue
                name = m.group(1) if m else own or ("UTM VM" if "utm" in anc else "VM %d" % p[0])
                # measured: a Mac sees its VMs' CPU and memory (their processes), not their disk or network (#300)
                acc = vms.setdefault(name, {"name": name, "u": [0.0] * 5, "running": True, "ifs": [], "cpus": "", "measured": [0, 1]})
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
            nrx, ntx = netio(s.get("NetIO"))
            bio = s.get("BlockIO", "0B / 0B").split("/")
            rx, tx = self.rate("cnr" + cid, nrx, t) / MB, self.rate("cnt" + cid, ntx, t) / MB
            u = [docker_pct(s.get("CPUPerc")), size_bytes(s.get("MemUsage", "0B").split("/")[0]) / GB, 0.0,
                 self.rate("cb" + cid, sum(size_bytes(x) for x in bio), t) / MB, rx + tx]
            containers.append({"id": cid, "name": c.get("Names", ""), "image": c.get("Image", ""), "status": c.get("Status", ""),
                               "project": labels.get("com.docker.compose.project", ""), "service": labels.get("com.docker.compose.service", ""),
                               "file": labels.get("com.docker.compose.project.config_files", ""), "networks": c.get("Networks", ""), "u": u,
                               "netrx": rx, "nettx": tx})
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
            "cap": [self.ncpu, self.memsize / GB, 100.0 * len(gpus), self.disk_peak / MB, 1250.0],
            "gpus": gpus,
            "lcpus": lcpus, "groups": self.groups, "containers": containers, "vms": list(vms.values()), "jobs": jobs,
            "procs": procs, "ifs": ifs, "dockernets": [], "cronLabel": "Cron & launchd jobs", "disks": mac_disks,
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
        conn, off = load_connect(), set(filter(None, os.environ.pop("FLEET_OFF", "").split(",")))
        restarted = os.environ.pop("FLEET_RESTARTED", "") == "1"   # Fleet restarting itself, not a start
        for m in cfg.get("machine", []):
            self.machines[m["id"]] = Machine(m, self.interval)
            if not connects_at_start(m, conn, off, restarted):
                self.machines[m["id"]].on.clear()
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
            self.record_pass()
            time.sleep(max(0.2, self.interval - (time.time() - began)))

    def record_pass(self):
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
            HIST.sweep()   # what no machine's tree has had for 10 passes is gone
            save_state(self)

    def machine_spec(self, m, record, vm_hostside=None, vm_parent=None):
        with m.lock:
            view, status, error = m.view, m.status, m.error
        cfg = m.cfg
        mid = m.id
        spec = {"id": mid, "name": m.name, "tile": cfg.get("tile", "vm" if cfg.get("vm_on") else "terminal"), "status": status,
                "error": error, "os": cfg.get("os_label") or {"windows": "Windows", "linux": "Linux", "macos": "macOS"}.get(cfg.get("os", ""), ""), "agent": "local" if cfg.get("kind") == "local" else "ssh " + cfg.get("ssh", ""),
                "cronLabel": "Cron jobs", "gpus": [], "cap": [1, 1, 0, 1, 1], "procs": [], "baseCron": [], "compose": [], "containers": [], "vms": []}
        spec["ssh"] = cfg.get("ssh", "")
        spec["on"] = m.on.is_set()
        spec["has_data"] = view is not None
        spec["last_ok"] = m.last_ok
        if view is None:
            if vm_hostside is not None:
                spec["base"] = {"id": mid + "/base", "h": self.leaf(mid + "/base", vm_hostside["u"], record)}
                spec["cap"] = vm_hostside["cap"]
                spec["status"] = "hostonly" if status != "ok" else status
                spec["error"] = (error or ("not connected" if status == "disabled" else "not reachable")) + " · showing what its host sees"
            else:
                spec["base"] = {"id": mid + "/base", "h": self.leaf(mid + "/base", [0] * 5, False)}   # nothing was read
            if vm_parent is not None and vm_hostside is None:
                spec["status"] = "off" if status != "ok" else status
            # Without a reading of its own it still has its VMs: each shows what it knows of itself, not "off".
            spec["vms"] = [self.machine_spec(mm, record) for mm in self.machines.values() if mm.cfg.get("vm_on") == mid]
            return spec
        # Only a live reading is recorded: a machine that isn't live shows its last one, and its history waits.
        live = status == "ok"
        own = record and live
        spec.update({"os": view["os"] + (" · " + view["arch"] if view.get("arch") else ""), "cpu_model": view.get("cpu_model", ""),
                     "uptime": fmt_uptime(view.get("uptime", 0)), "cap": view["cap"], "cronLabel": view.get("cronLabel", "Cron jobs"),
                     "gpus": [{"name": g["name"], "mem": g.get("mem", ""), "m": self.gpu_metrics(mid, gi, g, own)} for gi, g in enumerate(view["gpus"])],
                     "ncpu": view["ncpu"],
                     "groups": view.get("groups", [])})
        if view.get("note"):
            spec["note"] = {"label": "How this is counted.", "text": view["note"]}
        if cfg.get("note"):
            spec["note"] = {"label": cfg["note"].get("label", "Note."), "text": cfg["note"].get("text", "")}
        host = list(view["host"])
        ng = len(view["gpus"])
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
                    {"id": nid, "name": c["service"] or c["name"], "cname": c["name"], "image": c["image"], "status": c["status"],
                     "h": self.leaf(nid, c["u"], own), "gh": self.gpu_leaf(nid, c.get("gu"), ng, own)})
            else:
                nid = "%s/containers/%s" % (mid, slug(c["name"]))
                cont_ids[c["id"]] = nid
                loose.append({"id": nid, "name": c["name"], "cname": c["name"], "image": c["image"], "status": c["status"],
                              "h": self.leaf(nid, c["u"], own), "gh": self.gpu_leaf(nid, c.get("gu"), ng, own)})
        spec["compose"] = list(proj.values())
        spec["containers"] = loose
        # VMs: nested machines from config when they match by name; host-side usage otherwise.
        vsum = [0.0] * 5
        vm_ids = {}
        nested = {mm.cfg.get("domain", mm.name): mm for mm in self.machines.values() if mm.cfg.get("vm_on") == mid}
        listed = set()
        for v in view["vms"]:
            mm = nested.get(v["name"])
            u = vm_hostside_u(v, mm)
            for i in range(5):
                vsum[i] += u[i]
            if mm:
                listed.add(v["name"])
                sub = self.machine_spec(mm, record, vm_hostside={"u": v["u"], "cap": vm_cap(view, v)} if live else None, vm_parent=m if live else None)
                if live:   # what the host gives it (its QEMU process), as a history, and of each of the host's GPUs
                    sub["hostside"] = self.leaf(sub["id"] + "/hostside", u, own)
                    sub["hostside_gh"] = self.gpu_leaf(sub["id"] + "/hostside", v.get("gu"), ng, own)
                elif record:   # not shown while the host isn't live, and kept like the host's own history
                    for key in [sub["id"] + "/hostside"] + ["%s/hostside/__gpu/%d" % (sub["id"], i) for i in range(ng)]:
                        HIST.touch(key)
                vm_ids[v["name"]] = sub["id"]
                spec["vms"].append(sub)
            else:
                vid = "%s/vms/%s" % (mid, slug(v["name"]))
                vm_ids[v["name"]] = vid
                facts = ", ".join("%s (%s)" % (d["name"], d["state"]) for d in v.get("distros", []))
                spec["vms"].append({"id": vid, "name": v["name"], "tile": "vm", "status": ("ok" if v.get("running") else "off") if live else status,
                                    "os": facts or "VM", "agent": "seen from the host", "cap": vm_cap(view, v),
                                    "gpus": [], "cronLabel": "Cron jobs", "base": {"id": vid + "/base", "h": self.leaf(vid + "/base", v["u"], own)},
                                    "baseCron": [], "compose": [], "containers": [], "vms": [], "procs": [],
                                    "hostside_gh": self.gpu_leaf(vid + "/hostside", v.get("gu"), ng, own)})
        for name, mm in nested.items():
            if name not in listed:
                spec["vms"].append(self.machine_spec(mm, record, vm_parent=m if live else None))
        # Scheduled jobs under Base system; their usage is a breakdown of Base.
        jsum = [0.0] * 5
        jobs = []
        for jid, j in zip(job_ids(mid, view["jobs"]), view["jobs"]):
            for k in range(5):
                jsum[k] += j["u"][k]
            jobs.append({"id": jid, "name": j["name"], "sched": j["sched"], "human": j.get("human", ""), "cmd": j.get("cmd", ""),
                         "last": j.get("last", "") or ("next " + j["next"] if j.get("next") else ""), "running": j["running"],
                         "state": j.get("state", ""), "src": j.get("src", ""), "h": self.leaf(jid, j["u"], own), "gh": self.gpu_leaf(jid, j.get("gu"), ng, own)})
        spec["baseCron"] = jobs
        base_u = [max(0.0, host[i] - csum[i] - vsum[i] - jsum[i]) for i in range(5)]
        # Base on each GPU: that GPU's own utilisation, less what the containers, VMs and jobs measurably use of it.
        gsum = [0.0] * ng
        for x in list(view["containers"]) + list(view["vms"]) + list(view["jobs"]):
            for i, v in enumerate((x.get("gu") or [])[:ng]):
                gsum[i] += v
        base_g = [max(0.0, g.get("util", 0.0) - gsum[i]) for i, g in enumerate(view["gpus"])]
        if view["gpus"]:
            base_u[2] = sum(base_g)
        spec["base"] = {"id": mid + "/base", "h": self.leaf(mid + "/base", base_u, own), "gh": self.gpu_leaf(mid + "/base", base_g, ng, own)}
        spec["procs_owner"] = {"cont": cont_ids, "vm": vm_ids}
        if record:   # not live: still shown from its last reading, so its history is kept, not extended
            keep = HIST.push if own else lambda key, vals: HIST.touch(key)
            keep(mid + "/__host", host)
            for c in view.get("lcpus", []):
                keep("%s/__cpu/%d" % (mid, c["n"]), [c["pct"]])
            for x in view.get("ifs", []):
                keep("%s/__if/%s" % (mid, x["name"]), [x["rx"], x["tx"]])
            for x in view.get("disks", []):
                keep("%s/__disk/%s" % (mid, x["name"]), [x["read"], x["write"]])
        return spec

    def leaf(self, key, u, record):
        if record:
            HIST.push(key, u)
        return hist_obj(key)

    def gpu_metrics(self, mid, gi, g, record):
        """One GPU's tiles: [metric, limit, history] for each metric it reports now. A metric it reported before but
        not now (Windows' compute and video processing engines are counted only while a process holds them) reads 0
        while it's away, so its history keeps time with the others and a comeback isn't drawn next to old values (#290)."""
        m, prefix = g.get("m") or {}, "%s/gpu%d/" % (mid, gi)
        out = [[k, lim, self.leaf(prefix + k, [m.get(k, 0.0)], record)["cpu"]] for k, lim in gpu_metric_order(g)]
        if record:
            for key in HIST.keys(prefix):
                if key[len(prefix):] not in m:
                    HIST.push(key, [0.0])
        return out

    def gpu_leaf(self, key, gu, n, record):
        """What a node uses of each of its machine's n GPUs, with history: {"gpu0": [...], "gpu1": [...]}."""
        gu = list(gu or [])
        return {"gpu%d" % i: self.leaf("%s/__gpu/%d" % (key, i), [gu[i] if i < len(gu) else 0.0], record)["cpu"] for i in range(n)}

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
                "pins": load_pins(), "tilepins": load_tilepins(), "prefs": load_prefs(), "connect": self.connect_state()}

    def connect_state(self):
        conn = load_connect()
        conn["starts"] = [m.id for m in self.machines.values() if connects_at_start(m.cfg, conn)]
        return conn

    def api_connect(self, d):
        """Turn a machine on or off ({machine, on}), or set 'Connect automatically': {auto: all | none | a
        saved set}, {save: name} (the SSH machines connected now, or {machines: [...]} ticked by hand; then it picks
        that set), {delete: name}."""
        if "machine" in d:
            m = self.machines.get(str(d["machine"]))
            return {"ok": bool(m and m.turn(bool(d.get("on")))), "connect": self.connect_state()}
        conn = load_connect()
        if "save" in d:
            name = " ".join(str(d["save"]).split())[:60]
            if not name or name.lower() in ("all", "none"):
                return {"ok": False, "error": "Give it a name other than All or None.", "connect": self.connect_state()}
            ssh_ids = [m.id for m in self.machines.values() if m.cfg.get("kind") != "local"]
            picked = d.get("machines")
            if isinstance(picked, list):   # ticked by hand (Choose machines…); SSH machines only, in Fleet's order
                want = {str(x) for x in picked}
                conn["presets"][name] = [i for i in ssh_ids if i in want]
            else:                          # the machines connected now
                conn["presets"][name] = [i for i in ssh_ids if self.machines[i].on.is_set()]
            conn["auto"] = name
        elif "delete" in d:
            conn["presets"].pop(str(d["delete"]), None)
            if conn["auto"] not in conn["presets"] and conn["auto"] not in ("all", "none"):
                conn["auto"] = "none"
        elif "auto" in d:
            if d["auto"] not in ["all", "none"] + list(conn["presets"]):
                return {"ok": False, "error": "No such set.", "connect": self.connect_state()}
            conn["auto"] = d["auto"]
        else:
            return {"ok": False, "connect": self.connect_state()}
        save_connect(conn)
        return {"ok": True, "connect": self.connect_state()}

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
        if not view or not spec or not m.fresh:   # not read yet (connecting, or just restarted): the page keeps what it shows
            return {"procs": [], "ready": m.status == "disabled"}
        own = spec.get("procs_owner", {"cont": {}, "vm": {}})
        num = lambda x: x if isinstance(x, (int, float)) and not isinstance(x, bool) else 0   # what a host sends is data: numbers only
        gpus = lambda xs: [i for i in xs if isinstance(i, int) and not isinstance(i, bool)] if isinstance(xs, list) else []   # GPU places
        lastcpu = lambda x: x if isinstance(x, int) and not isinstance(x, bool) else -1   # a CPU's number, or -1: not reported
        jids = job_ids(mid, view.get("jobs", []))   # job:<n> is a place in this view's own job list
        out = []
        for p in view["procs"]:
            if not isinstance(p[0], int) or isinstance(p[0], bool):   # a pid that isn't a number names no process
                continue
            o = p[11]
            if o.startswith("c:"):
                node = own["cont"].get(o[2:], mid + "/base")
            elif o.startswith("vm:"):
                node = own["vm"].get(o[3:], mid + "/base")
            elif o.startswith("job:"):
                n = int(o[4:])
                node = jids[n] if n < len(jids) else mid + "/base"
            elif o == "dockervm":
                node = mid + "/base"
            else:
                node = mid + "/base"
            out.append([p[0], p[2], p[3], p[4], round(p[5], 4), round(p[6], 5), round(p[7], 4), round(p[8], 2), num(p[9]), p[10], node, num(p[1]),
                        lastcpu(p[12] if len(p) > 12 else -1), gpus(p[13] if len(p) > 13 else []), p[14] if len(p) > 14 else [],
                        p[15] if len(p) > 15 else [], round(p[16], 4) if len(p) > 16 else -1])
        # p[13]: the GPUs the process uses (positions in this machine's gpus); gpu_procs says whether the
        # host reports that at all (macOS doesn't), so an empty p[13] isn't taken for "on no GPU".
        if m.cfg.get("kind") == "local" and platform.system() == "Darwin" and view.get("containers"):
            out.extend(m.docker_desktop_procs(view, own))   # Docker Desktop: its containers' processes, from its VM
        return {"procs": out, "t": view["t"], "gpu_procs": bool(view.get("gpu_procs")), "ready": True}

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

    def api_ifs(self, mid):
        m = self.machines.get(mid)
        if not m:
            return {"ifs": []}
        with m.lock:
            view = m.view
        if not view:
            return {"ifs": []}
        vms = {}
        for v in view.get("vms", []):
            for i in v.get("ifs", []):
                vms[i["if"]] = v["name"]
        nets = {("docker0" if n["name"] == "bridge" else "br-" + n.get("id", "")[:12]): n["name"] for n in view.get("dockernets", []) if n.get("driver") == "bridge"}
        nets.update({n["name"]: n["name"] for n in view.get("dockernets", []) if n.get("driver") in ("macvlan", "ipvlan")})
        out = []
        for x in view.get("ifs", []):
            if x["kind"] == "loopback" or x["name"].startswith("veth") or x["name"] == "lo":
                continue
            hrx, htx = HIST.get("%s/__if/%s" % (mid, x["name"]), 2)
            members = [y["name"] for y in view.get("ifs", []) if y.get("master") == x["name"]]
            out.append(dict(x, hrx=hrx, htx=htx, vm=vms.get(x["name"], ""), dnet=nets.get(x["name"], ""),
                            members=len([y for y in members if not y.startswith("veth")]), containers=len([y for y in members if y.startswith("veth")])))
        return {"ifs": out, "per_process": True}

    def api_disks(self, mid):
        m = self.machines.get(mid)
        if not m:
            return {"disks": []}
        with m.lock:
            view = m.view
        out = []
        for d in (view or {}).get("disks", []):
            hr, hw = HIST.get("%s/__disk/%s" % (mid, d["name"]), 2)
            out.append(dict(d, hr=hr, hw=hw))
        return {"disks": out, "per_process": bool(view and view.get("os", "").split(" ")[0] not in ("macOS", "Microsoft", "Windows"))}

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
                    conts.append({"name": c["name"], "networks": c.get("networks", ""), "net": c["u"][4], "rx": c.get("netrx", 0.0), "tx": c.get("nettx", 0.0)})
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
            json.dump({"t": time.time(), "views": views, "hist": hist, "client": LAST_CLIENT[0]}, f, separators=(",", ":"))
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
    LAST_CLIENT[0] = max(LAST_CLIENT[0], st.get("client", 0.0))  # a window the last process saw is waited for
    for mid, v in st.get("views", {}).items():
        m = fleet.machines.get(mid)
        if m:
            m.view, m.last_ok, m.status = v["view"], v.get("last_ok", 0.0), "connecting"
    with HIST.lock:
        for k, qs in st.get("hist", {}).items():
            HIST.d[k] = [collections.deque(q[-H:], maxlen=H) for q in qs]


def restart_self(fleet, reason):
    print("%s; restarting" % reason, flush=True)
    os.environ["FLEET_OFF"] = ",".join(m.id for m in fleet.machines.values() if not m.on.is_set())   # stays off after the restart
    os.environ["FLEET_RESTARTED"] = "1"   # and the rest stay connected, whatever Auto says (#224)
    save_state(fleet)
    stop_collectors(fleet)
    args = [sys.executable, os.path.abspath(__file__)] + [x for x in sys.argv[1:] if x not in ("--open", "--open-if-unseen")] + ["--open-if-unseen"]
    if platform.system() == "Windows":
        # os.execv there is the C runtime's _wexecv: it joins argv with spaces and quotes nothing, so quote
        # each argument the way the new process splits it again (C:\Program Files\... stays one argument).
        args = [subprocess.list2cmdline([x]) for x in args]
    os.execv(sys.executable, args)


# ---------------------------------------------------------------- settings
TILES = ("laptop", "desktop", "terminal", "server", "globe", "vm")
SSH_DEST = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.@:\[\]%-]{0,252}$")   # never starts with "-": no option smuggling
MACHINE_KEYS = ("id", "name", "kind", "ssh", "os", "os_label", "tile", "vm_on", "domain", "tailscale", "note")
NOTE_KEYS = ("label", "text")   # note is a table: [machine.note] label = "...", text = "..."


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
        mm = {k: str(m.get(k, "")).strip() for k in MACHINE_KEYS if k != "note" and str(m.get(k, "")).strip()}
        if isinstance(m.get("note"), dict):
            note = {k: str(m["note"].get(k, "")).strip() for k in NOTE_KEYS if str(m["note"].get(k, "")).strip()}
            if note:
                mm["note"] = note
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
            if mm.get("os") not in ("linux", "windows", "macos"):
                errors.append("%s: choose Linux, Windows or macOS." % (mm.get("name") or label))
        if mm.get("tile") and mm["tile"] not in TILES:
            mm.pop("tile")
        for k in ("domain", "tailscale"):
            if k in mm and not re.match(r"^[A-Za-z0-9_.@:-]{1,120}$", mm[k]):
                errors.append("%s: %s has characters Fleet can't use." % (mm.get("name") or label, k))
        machines.append(mm)
    runs_on = {mm["id"]: mm["vm_on"] for mm in machines if mm.get("id") and mm.get("vm_on")}
    names = {mm["id"]: mm.get("name") or mm["id"] for mm in machines if mm.get("id")}
    circled = set()
    for mm in machines:
        if mm.get("vm_on") and (mm["vm_on"] not in ids or mm["vm_on"] == mm.get("id")):
            errors.append("%s: “runs on” must be another machine in the list." % mm.get("name", "?"))
        loop = [mm.get("id")]   # what it runs on, and what that runs on, ...: a circle never reaches a root
        while loop[-1] in runs_on and runs_on[loop[-1]] not in loop:
            loop.append(runs_on[loop[-1]])
        if len(loop) > 1 and runs_on.get(loop[-1]) == loop[0] and loop[0] not in circled:
            circled.update(loop)
            errors.append("%s: “runs on” goes round in a circle (%s). One of them has to run on its own hardware."
                          % (names[loop[0]], " → ".join(names[x] for x in loop + loop[:1])))
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
            if m.get(k) and k != "note":
                lines.append("%s = %s" % (k, json.dumps(m[k], ensure_ascii=False)))
        if m.get("note"):
            lines.append("[machine.note]")
            lines += ["%s = %s" % (k, json.dumps(m["note"][k], ensure_ascii=False)) for k in NOTE_KEYS if m["note"].get(k)]
        lines.append("")
    if os.path.exists(path):
        shutil.copy(path, path + ".bak")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    with open(tmp, "rb") as f:
        tomllib.load(f)  # never write a file Fleet can't read back
    os.replace(tmp, path)


# ---------- one process, looked at closely (the Details drop-down) ----------
# On demand only: the page asks while a process is open, at most once a second per process. Linux and
# Windows hosts run inspect_linux.py / inspect_windows.ps1 over SSH (read-only, ~1.5 s of sampling);
# this Mac is read with ps and lsof.
INSPECT_SECS = 1.5
INSPECT_LOCK = threading.Lock()
INSPECT_CACHE = {}   # (machine, pid) -> (time, result)
INSPECT_BUSY = {}    # (machine, pid) -> Event while a look is running
REACHES_OUT = {"/api/proc"}   # the GETs that start work on a machine: they need what a write needs (#287)


def inspect_mac(pid):
    def run(*cmd):
        try:
            return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10).stdout.decode("utf-8", "replace")
        except Exception:
            return ""
    head = run("ps", "-o", "pid=,ppid=,user=,nice=,pri=,rss=,vsz=,time=,state=,lstart=", "-p", str(pid)).split()
    if not head:
        return {"pid": pid, "gone": True}
    cmdline = run("ps", "-o", "command=", "-p", str(pid)).strip()
    name = run("ps", "-o", "comm=", "-p", str(pid)).strip().rsplit("/", 1)[-1]
    def cputime():
        t = run("ps", "-o", "time=", "-p", str(pid)).strip()
        try:
            parts = [float(x) for x in t.replace("-", ":").split(":")]
            v = 0.0
            for x in parts:
                v = v * 60 + x
            return v
        except Exception:
            return 0.0
    c0, t0 = cputime(), time.time()
    counts, samples = {}, 0
    end = t0 + INSPECT_SECS
    while True:
        # one line per thread; the state's first letter: R running, U uninterruptible (disk), S sleeping, I idle, T stopped
        lines = run("ps", "-M", "-p", str(pid)).splitlines()
        col = lines[0].find("STAT") if lines else -1
        for line in lines[1:] if col >= 0 else []:
            k = {"R": "cpu", "U": "disk", "S": "sleep", "I": "idle", "T": "stopped"}.get(line[col:col + 1], "other")
            counts[k] = counts.get(k, 0) + 1
        samples += 1
        if time.time() >= end:
            break
        time.sleep(0.12)
    dt = max(0.05, time.time() - t0)
    files, conns, fds = [], [], 0
    for line in run("lsof", "-n", "-P", "-p", str(pid)).splitlines()[1:]:
        parts = line.split(None, 8)
        if len(parts) < 9:
            continue
        fds += parts[3][:1].isdigit()
        typ, last = parts[4], parts[8]
        if typ in ("IPv4", "IPv6"):
            proto = "tcp" if "TCP" in line else "udp"
            st = last.rsplit("(", 1)[1].rstrip(")").lower().replace("listen", "listening") if "(" in last else ("listening" if "->" not in last else "connected")
            name_ = last.split(" (")[0]
            local, _, remote = name_.partition("->")
            conns.append({"proto": proto, "local": local, "remote": remote, "state": st})
        elif typ == "REG" and parts[3][:1].isdigit() and last.startswith("/") and len(files) < 20 and not last.startswith(("/System/", "/usr/lib/", "/dev/")):
            files.append(last)
    threads_n = max(0, len(run("ps", "-M", "-p", str(pid)).splitlines()) - 1)
    started = 0.0
    try:
        started = time.mktime(time.strptime(" ".join(head[9:14]), "%a %b %d %H:%M:%S %Y"))
    except Exception:
        pass
    rss = int(head[5]) * 1024 if head[5].isdigit() else 0
    return {"pid": pid, "name": name, "state": head[8][:1], "ppid": int(head[1]), "nice": int(head[3]) if head[3].lstrip("-").isdigit() else 0,
            "priority": int(head[4]) if head[4].isdigit() else 0, "threads_n": threads_n, "started": started, "last_cpu": -1,
            "user": head[2], "cmdline": cmdline, "exe": cmdline.split(" ")[0], "cwd": "", "affinity": "",
            "cpu": {"user": max(0.0, cputime() - c0) / dt, "system": None},
            "mem": {"rss": rss, "virt": int(head[6]) * 1024 if head[6].isdigit() else 0},
            "io": None, "waits": counts, "samples": samples, "dt": dt, "threads": [], "fds": fds, "fd_limit": -1,
            "files": files, "conns": conns[:40], "conns_n": len(conns), "cgroup": None, "cache": None,
            "cache_error": "macOS only lets root tools read CPU cache counters"}


# ---------------------------------------------------------------- Macs over SSH (#181)
# A remote Mac runs exactly the reader this Mac runs: its source, with the helpers it calls, streamed to
# `python3 -` (the system Python 3.9 of a Mac with the Command Line Tools is enough).
MAC_HELPERS = ["run", "size_bytes", "docker_pct", "netio", "parse_cputime", "fmt_secs", "human_cron", "JOB_GUARDS", "JOB_WRAPPERS", "JOB_ARGS", "job_name",
               "mac_gpu_stats", "MAC_TOOL_DIRS", "mac_path"]
# Where Docker Desktop (per user, then system-wide), OrbStack, Rancher Desktop and Homebrew (Colima's docker) put the
# docker CLI. sshd on a Mac runs a command with PATH=/usr/bin:/bin:/usr/sbin:/sbin and no login shell (path_helper
# runs only from /etc/zprofile), so none of them is on it; every other tool the reader calls is (#299).
MAC_TOOL_DIRS = ("~/.docker/bin", "~/.orbstack/bin", "~/.rd/bin", "/opt/homebrew/bin", "/usr/local/bin")


def mac_path(path, home):
    """PATH with MAC_TOOL_DIRS after what it already has (a directory already on it keeps its place)."""
    have = [d for d in (path or "").split(":") if d]
    return ":".join(have + [d for d in (home + d[1:] if d.startswith("~") else d for d in MAC_TOOL_DIRS) if d not in have])


MAC_IMPORTS = "import base64, collections, ctypes, ctypes.util, glob, json, os, platform, plistlib, re, shlex, shutil, subprocess, sys, tempfile, threading, time, zlib\n"  # the server's own imports but tomllib (3.11+)


def own_source(*names):
    """The source of this file's top-level functions, classes and constants (NAME = ...) by name, cut from the
    file itself (works however the module was loaded, unlike inspect.getsource)."""
    import ast
    text = open(os.path.abspath(__file__), encoding="utf-8").read()
    lines, found = text.splitlines(True), {}
    for node in ast.parse(text).body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names:
            start = min([node.lineno] + [d.lineno for d in node.decorator_list])
            found[node.name] = "".join(lines[start - 1:node.end_lineno])
        elif isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id in names:
            found[node.targets[0].id] = "".join(lines[node.lineno - 1:node.end_lineno])
    return [found[n] for n in names]


def mac_collector_script(interval):
    parts = [MAC_IMPORTS, "MB = %r\nGB = %r\nINTERVAL = %s\n" % (MB, GB, interval)] + own_source(*(MAC_HELPERS + ["MacCollector"]))
    parts.append('''
ONCE = globals().get("ONCE", False)
os.environ["PATH"] = mac_path(os.environ.get("PATH", ""), os.path.expanduser("~"))   # sshd's short PATH has no docker
c = MacCollector()
while True:
    began = time.time()
    try:
        r = c.snapshot()
        sys.stdout.write(base64.b64encode(zlib.compress(json.dumps(r).encode())).decode() + "\\n")
        sys.stdout.flush()
    except BrokenPipeError:
        sys.exit(0)
    if ONCE:
        break
    time.sleep(max(0.3, INTERVAL - (time.time() - began)))
''')
    return "\n\n".join(parts)


def mac_inspect_script(pid, secs):
    return MAC_IMPORTS + "INSPECT_SECS = %r\n\n" % secs + own_source("inspect_mac")[0] + "\n\nprint(json.dumps(inspect_mac(%d)))\n" % int(pid)


def windows_inspect_script(pid):
    with open(os.path.join(HERE, "inspect_windows.ps1"), encoding="utf-8") as f:
        return "$FleetPid=%d\n$FleetSecs=%s\n" % (pid, INSPECT_SECS) + ps_compact(f.read())


def inspect_process(m, pid):
    key = (m.id, pid)
    with INSPECT_LOCK:
        c = INSPECT_CACHE.get(key)
        if c and time.time() - c[0] < 1.0:
            return c[1]
        ev = INSPECT_BUSY.get(key)
        mine = ev is None
        if mine:
            ev = INSPECT_BUSY[key] = threading.Event()
    if not mine:   # someone is already looking: share their answer
        ev.wait(30)
        with INSPECT_LOCK:
            c = INSPECT_CACHE.get(key)
        return c[1] if c else {"pid": pid, "error": "no answer"}
    cfg = m.cfg
    try:
        # this computer: the inspector of what it runs on, as local_loop picks its collector (validate_config
        # drops a local machine's os); a machine over SSH: its configured os
        local = platform.system() if cfg.get("kind") == "local" else None
        if local == "Darwin":
            out = inspect_mac(pid)
        else:
            if local == "Windows":   # the short starter the local collector uses, the script on stdin (#269)
                cmd, stdin = ps_launch(windows_inspect_script(pid))
            elif local:
                cmd, stdin = [sys.executable, os.path.join(HERE, "inspect_linux.py"), str(pid), str(INSPECT_SECS)], None
            elif cfg.get("os") == "macos":
                cmd, stdin = ["ssh"] + SSH_MARK + [cfg["ssh"], "python3 -"], mac_inspect_script(pid, INSPECT_SECS).encode()
            elif cfg.get("os") == "windows":
                # like the collector: a short bootstrap any default shell runs (cmd.exe takes 8,191 characters), the script on stdin
                argv, stdin = ps_launch(windows_inspect_script(pid))
                cmd = ["ssh"] + SSH_MARK + [cfg["ssh"], " ".join(argv)]
            else:
                cmd = ["ssh"] + SSH_MARK + [cfg["ssh"], "python3 - %d %s" % (pid, INSPECT_SECS)]
                with open(os.path.join(HERE, "inspect_linux.py"), "rb") as f:
                    stdin = f.read()
            r = subprocess.run(cmd, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
            lines = [l for l in r.stdout.decode("utf-8", "replace").splitlines() if l.startswith("{")]
            if lines:
                out = json.loads(lines[-1])
            else:
                err = r.stderr.decode("utf-8", "replace").strip().splitlines()
                out = {"pid": pid, "error": (err[-1] if err else "no answer from %s" % m.name)[:300]}
    except subprocess.TimeoutExpired:
        out = {"pid": pid, "error": "%s took too long to answer" % m.name}
    except Exception as e:
        out = {"pid": pid, "error": str(e)[:300]}
    out["machine"], out["t"] = m.id, time.time()
    with INSPECT_LOCK:
        INSPECT_CACHE[key] = (time.time(), out)
        for k in [k for k, v in INSPECT_CACHE.items() if time.time() - v[0] > 120]:
            del INSPECT_CACHE[k]
        INSPECT_BUSY.pop(key, None)
    ev.set()
    return out


# Looking inside a process in Docker Desktop's Linux VM (#218): a throwaway helper container that sees the VM's
# processes, or Fleet's Linux inspector run inside the process's own container. Either runs inspect_linux.py.
HELPER_IMAGE = "python:3.12-slim"   # pulled once if it isn't there
VM_KEY = re.compile(r"^d:([0-9a-f]{12}):([1-9][0-9]{0,9})$")
EXEC_PRELUDE = """import json, os, sys
WANT_CMD = %r
WANT_AGE = %d
def _fleet_find():
    # the process inside its container: the same command line, started the same number of seconds ago
    up, hz, best = float(open("/proc/uptime").read().split()[0]), os.sysconf("SC_CLK_TCK"), None
    for d in os.listdir("/proc"):
        if not d.isdigit():
            continue
        try:
            cmd = open("/proc/%%s/cmdline" %% d, "rb").read().replace(b"\\0", b" ").decode("utf-8", "replace").strip()
            st = open("/proc/%%s/stat" %% d).read()
            age = up - int(st[st.rindex(")") + 2:].split()[19]) / hz
        except Exception:
            continue
        if cmd == WANT_CMD and (best is None or abs(age - WANT_AGE) < best[0]):
            best = (abs(age - WANT_AGE), int(d))
    return best[1] if best and best[0] <= 3 else None
_p = _fleet_find()
if _p is None:
    print(json.dumps({"pid": 0, "error": "Couldn't find that process inside its container."}))
    sys.exit(0)
sys.argv = ["-", str(_p), %r]
"""


def parse_vm_key(k):
    m = VM_KEY.match(k or "")
    return (m.group(1), int(m.group(2))) if m else None


def docker_vm_inspect_cmd(cid, pid, via, args, age):
    src = open(os.path.join(HERE, "inspect_linux.py"), "rb").read()
    if via == "helper":
        return (["docker", "run", "--rm", "-i", "--pid=host", "--cap-add=SYS_PTRACE", "--network=none", "--label", "fleet.helper=inspect",
                 HELPER_IMAGE, "python3", "-", str(pid), str(INSPECT_SECS)], src)
    if via == "exec":
        return ["docker", "exec", "-i", cid, "python3", "-"], (EXEC_PRELUDE % (args, int(age), str(INSPECT_SECS))).encode() + src
    raise ValueError("no such way to look: %r" % via)


def vm_inspect_error(via, text):
    text = text.strip()
    if via == "exec" and re.search(r"python3.*(not found|no such file)|executable file not found", text, re.I):
        return "This container has no python3 to run Fleet's inspector. Look with a helper container instead."
    return (text.splitlines()[-1].strip() if text else "no answer from Docker")[:300]


def inspect_docker_vm(m, cid, pid, via):
    key = (m.id, cid, pid, via)
    with INSPECT_LOCK:
        c = INSPECT_CACHE.get(key)
        if c and time.time() - c[0] < 1.0:
            return c[1]
    try:
        args, age = "", 0
        if via == "exec":   # its command line and age, to find it inside its container
            for line in run(["docker", "top", cid, "-eo", "pid,etimes,args"], timeout=5).splitlines()[1:]:
                f = line.split(None, 2)
                if len(f) == 3 and f[0] == str(pid) and f[1].isdigit():
                    args, age = f[2], int(f[1])
            if not args:
                return {"pid": pid, "gone": True}
        cmd, stdin = docker_vm_inspect_cmd(cid, pid, via, args, age)
        r = subprocess.run(cmd, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        lines = [l for l in r.stdout.decode("utf-8", "replace").splitlines() if l.startswith("{")]
        if lines:
            out = json.loads(lines[-1])
        else:   # docker exec reports a missing command on stdout, docker run on stderr
            out = {"pid": pid, "error": vm_inspect_error(via, (r.stderr + b"\n" + r.stdout).decode("utf-8", "replace"))}
    except subprocess.TimeoutExpired:
        out = {"pid": pid, "error": "Docker took too long to answer"}
    except Exception as e:
        out = {"pid": pid, "error": str(e)[:300]}
    out["machine"], out["t"], out["via"] = m.id, time.time(), via
    with INSPECT_LOCK:
        INSPECT_CACHE[key] = (time.time(), out)
    return out


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
            # herdr runs inside a terminal: with no herdr running, start it in the default one, then add the tab (#227)
            def tab():
                r = subprocess.run(["herdr", "tab", "create", "--label", title[:40], "--focus"], capture_output=True, text=True, timeout=10)
                out = (r.stdout or "") + "\n" + (r.stderr or "")   # errors come as JSON on stderr
                m = re.search(r'"(?:pane_id|paneId)"\s*:\s*"([^"]+)"', out) or re.search(r'"id"\s*:\s*"([^"]*pane[^"]*)"', out)
                return (m.group(1) if m else None), out
            pane, out = tab()
            if not pane and "server_not_running" in out:
                start = auto if auto != "herdr" else next((k for k in keys if k != "herdr"), "terminal")
                open_terminal(start, ["herdr"], "Herdr")
                for _ in range(40):
                    time.sleep(0.25)
                    pane, out = tab()
                    if pane or "server_not_running" not in out:
                        break
            if not pane:
                msg = re.search(r'"message"\s*:\s*"([^"]+)"', out)
                raise RuntimeError("Herdr didn't open a tab" + (": " + msg.group(1) if msg else "") + ". Start herdr, or pick another terminal.")
            if line:
                subprocess.run(["herdr", "pane", "run", pane, line], check=True, capture_output=True, timeout=10)
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
        # No page may frame Fleet: inside a frame the UI's own requests would pass allowed() (clickjacking).
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "frame-ancestors 'none'")
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
        u = urllib.parse.urlparse(self.path)
        # A look at a process opens an SSH session or runs a helper container. A page on any site can send a
        # no-cors GET with Fleet's own Host, so this GET passes the write gate too (#287).
        if not self.allowed(write=u.path in REACHES_OUT):
            self.send_error(403)
            return
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
        if u.path == "/api/ifs":
            return self.send_json(self.fleet.api_ifs(q.get("machine", [""])[0]))
        if u.path == "/api/disks":
            return self.send_json(self.fleet.api_disks(q.get("machine", [""])[0]))
        if u.path == "/api/proc":
            m = self.fleet.machines.get(q.get("machine", [""])[0])
            vk, via = parse_vm_key(q.get("key", [""])[0]), q.get("via", [""])[0]
            if q.get("key"):   # a process in Docker Desktop's VM, looked at the way the user picked (#218)
                if not m or not vk or via not in ("helper", "exec") or not (m.cfg.get("kind") == "local" and sys.platform == "darwin"):
                    return self.send_json({"error": "no such process"})
                return self.send_json(inspect_docker_vm(m, vk[0], vk[1], via))
            pid = q.get("pid", [""])[0]
            if not m or not pid.isdigit() or not 0 < int(pid) < 1 << 31:
                return self.send_json({"error": "no such machine or process"})
            return self.send_json(inspect_process(m, int(pid)))
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
                used = open_terminal(str(d.get("terminal") or self.fleet.cfg.get("terminal", "auto")), argv, title)   # one picked from Open in (#223), or the default
                return self.send_json({"ok": True, "terminal": used, "title": title})
            except Exception as e:
                return self.send_json({"ok": False, "error": str(e)[:300]})
        if u.path == "/api/prefs":
            d = self.read_json()
            if not isinstance(d, dict) or len(json.dumps(d)) > 65536:
                self.send_error(400)
                return
            save_prefs(d)
            return self.send_json({"prefs": load_prefs()})
        if u.path == "/api/tilepins":
            d = self.read_json()
            if not isinstance(d, dict) or len(d) > 500 or not all(isinstance(v, list) and len(v) <= 200 for v in d.values()):
                self.send_error(400)
                return
            save_tilepins({str(k)[:200]: [str(x)[:200] for x in v] for k, v in d.items() if v})
            return self.send_json({"tilepins": load_tilepins()})
        if u.path == "/api/connect":
            d = self.read_json()
            return self.send_json(self.fleet.api_connect(d if isinstance(d, dict) else {}))
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
    url = "http://127.0.0.1:%d/" % a.port
    if a.open and fleet_answers(url):
        # closing the window leaves its server running: open a window on that one instead of a second server
        # that would start a collector per machine and then fail to bind the port (issue #186)
        print("Fleet Live already on %s; opening a window on it" % url, flush=True)
        open_app_window(url)
        return
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
    print("Fleet Live on %s" % url, flush=True)
    if a.open:
        open_app_window(url)
    elif a.open_if_unseen:
        threading.Thread(target=reopen_if_unseen, args=(url, time.time()), daemon=True).start()
    if not a.no_watch:
        threading.Thread(target=watch_own_files, args=(url,), daemon=True, name="fleet-watch").start()
    srv.serve_forever()


def fleet_answers(url, timeout=1.5):
    """True when a Fleet Live already serves `url` (as Fleet.app asks: /api/fleet answers 200)."""
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(url + "api/fleet", timeout=timeout) as r:  # never via a proxy
            return r.status == 200
    except Exception:
        return False


def reopen_if_unseen(url, since, wait=8.0):
    """Open the app window unless a Fleet window polls after `since`. A visible page polls every 2 s, but
    Chrome runs the timers of a page hidden for 5 minutes (minimized or covered) only about once a minute,
    so a window seen in the last minute is waited for until a minute after its last poll."""
    deadline = max(since + wait, LAST_CLIENT[0] + HIDDEN_POLL_S)
    while LAST_CLIENT[0] < since and time.time() < deadline:
        time.sleep(max(0.0, min(1.0, deadline - time.time())))
    if LAST_CLIENT[0] < since:
        open_app_window(url)


def watch_own_files(url):
    """Fleet updates itself: server or collector changes restart the server (the page reconnects);
    UI changes reload the open page on their own. Either way, a closed window is reopened."""
    server_files = [os.path.join(HERE, f) for f in ("fleet_live.py", "collect_linux.py", "collect_windows.ps1")]
    ui_files = [os.path.join(HERE, "web", f) for f in ("index.html", "app.js", "themes.js")]
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
