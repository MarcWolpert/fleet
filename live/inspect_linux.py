# SPDX-License-Identifier: GPL-3.0-or-later
# Fleet Live: one look at one process on Linux, for the Details drop-down. Run as `python3 - PID SECONDS`
# (streamed over SSH like collect_linux.py). Read-only: /proc, /sys/fs/cgroup, and the CPU's own counters
# (perf_event_open, counting only; nothing is sampled or traced). Prints one JSON object.
#
# "What it waits on": every thread's state and wait channel, sampled every 0.1 s for SECONDS, plus the
# scheduler's own run-queue time (schedstat), its cgroup's pressure (PSI) and CPU throttling.
import ctypes, json, os, platform, struct, sys, time

HZ = os.sysconf("SC_CLK_TCK")
PID, DUR, P = 0, 1.5, "/proc/0"   # set by main() from the command line


def rd(p):
    try:
        with open(p) as f:
            return f.read()
    except Exception:
        return ""


def stat(path):
    """/proc/.../stat as {field number: value}, numbered as in proc(5) (3 = state, 14 = utime, …)."""
    s = rd(path)
    if not s:
        return None
    r = s.rfind(")")
    parts = s[r + 2:].split()
    d = {2: s[s.find("(") + 1:r]}
    for i, v in enumerate(parts):
        d[i + 3] = v
    return d


def kv(text):
    out = {}
    for line in text.splitlines():
        k, _, v = line.partition(":")
        out[k.strip()] = v.strip()
    return out


def kb(v):
    try:
        return int(v.split()[0]) * 1024
    except Exception:
        return 0


def rl(p):
    try:
        return os.readlink(p)
    except Exception:
        return ""


def tasks():
    try:
        return [int(t) for t in os.listdir(P + "/task")]
    except Exception:
        return []


def classify(st, wc):
    """A thread's state + wait channel → what it is doing or waiting on."""
    w = wc or ""
    if st == "R":
        return "cpu"
    if st in "TtXxZ":
        return "stopped"
    if st == "I":
        return "idle"
    if any(k in w for k in ("nvidia", "nv_", "drm_", "dma_fence", "i915", "amdgpu", "xe_", "kgsl", "nouveau")):
        return "gpu"
    if st == "D":
        if any(k in w for k in ("swap", "page_fault", "filemap_fault", "shrink", "compact", "reclaim", "migrat")):
            return "memory"
        if any(k in w for k in ("nfs", "cifs", "smb", "fuse", "rpc_", "ceph", "9p")):
            return "netfs"
        return "disk"
    if "futex" in w:
        return "lock"
    if any(k in w for k in ("ep_poll", "epoll", "do_select", "do_sys_poll", "core_sys_select", "poll_schedule")):
        return "events"
    if any(k in w for k in ("sk_wait", "inet_csk", "tcp_", "unix_stream", "sock_", "skb_", "udp", "netlink")):
        return "network"
    if any(k in w for k in ("io_uring", "io_cqring", "aio_")):
        return "io"
    if any(k in w for k in ("wait_on_page", "folio_wait", "io_schedule", "blk", "jbd2", "ext4", "xfs", "btrfs")):
        return "disk"
    if any(k in w for k in ("pipe_", "wait_woken", "n_tty", "tty_")):
        return "pipe"
    if any(k in w for k in ("nanosleep", "hrtimer", "schedule_timeout", "msleep")):
        return "timer"
    if "do_wait" in w:
        return "child"
    if any(k in w for k in ("sigsuspend", "sigtimedwait", "pause")):
        return "signal"
    return "sleep" if w in ("", "0") else "other"


# ---------- the CPU's counters: cache references and misses, instructions and cycles ----------
NR = {"x86_64": 298, "amd64": 298, "aarch64": 241, "arm64": 241, "i686": 336, "i386": 336, "armv7l": 364, "ppc64le": 319, "s390x": 331, "riscv64": 241}
COUNTERS = [("refs", 2), ("misses", 3), ("instructions", 1), ("cycles", 0)]  # PERF_COUNT_HW_*


class Counters:
    def __init__(self, tids):
        self.groups, self.error, self.names = [], "", [n for n, _ in COUNTERS]
        nr = NR.get(platform.machine().lower())
        if not nr:
            self.error = "not supported on this CPU architecture"
            return
        try:
            self.libc = ctypes.CDLL(None, use_errno=True)
        except Exception:
            self.error = "no C library to ask"
            return
        self.nr = nr
        for tid in tids[:64]:
            g = self.open_group(tid)
            if g:
                self.groups.append(g)
            elif not self.groups and self.error:
                return

    def open_one(self, tid, config, group):
        # struct perf_event_attr, the first 64 bytes (PERF_ATTR_SIZE_VER0): type, size, config, sample_period,
        # sample_type, read_format (GROUP | TOTAL_TIME_ENABLED | TOTAL_TIME_RUNNING), flags (exclude_kernel,
        # exclude_hv: user-space counts, allowed at perf_event_paranoid 2), wakeup_events, bp_type, config1
        attr = struct.pack("<IIQQQQQIIQ", 0, 64, config, 0, 0, 8 | 1 | 2, (1 << 5) | (1 << 6), 0, 0, 0)
        buf = ctypes.create_string_buffer(attr, 64)
        fd = self.libc.syscall(ctypes.c_long(self.nr), buf, ctypes.c_long(tid), ctypes.c_long(-1), ctypes.c_long(group), ctypes.c_long(0))
        if fd < 0:
            e = ctypes.get_errno()
            if not self.error:
                self.error = {2: "this machine doesn't expose CPU counters (usual in VMs)", 95: "this machine doesn't expose CPU counters (usual in VMs)",
                              1: "not allowed here (kernel.perf_event_paranoid)", 13: "not allowed here (kernel.perf_event_paranoid)",
                              24: "too many open files", 3: "the thread ended"}.get(e, "unavailable (error %d)" % e)
            return -1
        return fd

    def open_group(self, tid):
        lead = self.open_one(tid, COUNTERS[0][1], -1)
        if lead < 0:
            return None
        fds = [lead]
        for _, cfg in COUNTERS[1:]:
            fd = self.open_one(tid, cfg, lead)
            if fd < 0:
                break
            fds.append(fd)
        return fds

    def read(self):
        tot = dict((n, 0.0) for n in self.names)
        for fds in self.groups:
            try:
                data = os.read(fds[0], 8 * (3 + len(fds)))
            except Exception:
                continue
            nr, enabled, running = struct.unpack_from("<QQQ", data, 0)
            vals = struct.unpack_from("<%dQ" % nr, data, 24)
            scale = (enabled / running) if running else 0.0
            for i, v in enumerate(vals):
                tot[self.names[i]] += v * scale
        return tot

    def close(self):
        for fds in self.groups:
            for fd in fds:
                try:
                    os.close(fd)
                except Exception:
                    pass


# ---------- cgroup: limits, pressure, throttling ----------
def cgroup_dir():
    for line in rd(P + "/cgroup").splitlines():
        if line.startswith("0::"):
            d = "/sys/fs/cgroup" + line[3:].strip()
            return line[3:].strip(), d if os.path.isdir(d) else ""
    return "", ""


def psi(path):
    out = {}
    for line in rd(path).splitlines():
        parts = line.split()
        if parts and parts[0] in ("some", "full"):
            out[parts[0]] = dict((k, float(v)) for k, v in (x.split("=") for x in parts[1:]) if k.startswith("avg"))
    return out


def cg_snapshot(d):
    if not d:
        return {}
    c = {}
    for line in rd(d + "/cpu.stat").splitlines():
        k, _, v = line.partition(" ")
        c[k] = int(v or 0)
    return c


# ---------- sockets ----------
def hexaddr(h):
    ip, port = h.split(":")
    port = int(port, 16)
    if len(ip) == 8:
        a = ".".join(str(int(ip[i:i + 2], 16)) for i in (6, 4, 2, 0))
    else:
        words = [ip[i:i + 8] for i in range(0, 32, 8)]
        b = b"".join(struct.pack("<I", int(w, 16)) for w in words)
        if b[:12] == b"\0" * 10 + b"\xff\xff":
            a = ".".join(str(x) for x in b[12:])
        else:
            a = ":".join("%x" % int.from_bytes(b[i:i + 2], "big") for i in range(0, 16, 2))
    return a, port


TCP_STATES = {"01": "established", "02": "syn-sent", "03": "syn-recv", "04": "fin-wait", "05": "fin-wait", "06": "time-wait", "07": "closed",
              "08": "close-wait", "09": "last-ack", "0A": "listening", "0B": "closing"}


def sockets(inodes):
    conns = []
    for proto, f in (("tcp", "tcp"), ("tcp", "tcp6"), ("udp", "udp"), ("udp", "udp6")):
        for line in rd(P + "/net/" + f).splitlines()[1:]:
            parts = line.split()
            if len(parts) < 10 or parts[9] not in inodes:
                continue
            la, lp = hexaddr(parts[1])
            ra, rp = hexaddr(parts[2])
            st = TCP_STATES.get(parts[3], parts[3]) if proto == "tcp" else ("listening" if rp == 0 else "connected")
            conns.append({"proto": proto, "local": "%s:%d" % (la, lp), "remote": "%s:%d" % (ra, rp) if rp else "", "state": st})
    return conns


# ---------- one reading ----------
def snapshot(tids):
    s = stat(P + "/stat")
    io = kv(rd(P + "/io"))
    st = kv(rd(P + "/status"))
    th, sched = {}, {}
    for t in tids:
        ts = stat("%s/task/%d/stat" % (P, t))
        if not ts:
            continue
        sch = rd("%s/task/%d/schedstat" % (P, t)).split()
        if len(sch) >= 2:
            sched[t] = (int(sch[0]), int(sch[1]))   # ns on a core, ns waiting in a run queue, over the thread's life
        th[t] = int(ts[14]) + int(ts[15])
    return {"t": time.time(), "stat": s, "io": io, "status": st, "threads": th, "sched": sched}


def sched_split(a, b, dt):
    """(running, queued for a core) in core-seconds per second, from each thread's schedstat change. A thread
    that exits during the look has no reading at the end and adds nothing (its lifetime would be subtracted);
    one that starts during it began at zero, so all of its time is inside the look."""
    run = wait = 0
    for t, (r1, w1) in b["sched"].items():
        r0, w0 = a["sched"].get(t, (0, 0))
        run += max(0, r1 - r0)
        wait += max(0, w1 - w0)
    return run / 1e9 / dt, wait / 1e9 / dt


def main():
    global PID, DUR, P
    PID = int(sys.argv[1])
    DUR = max(0.5, min(5.0, float(sys.argv[2]) if len(sys.argv) > 2 else 1.5))
    P = "/proc/%d" % PID
    if not os.path.isdir(P):
        print(json.dumps({"pid": PID, "gone": True}))
        return
    tids = tasks()
    # the busiest threads first, so the counters (at most 64 threads) cover where the time goes
    a = snapshot(tids)
    cg_rel, cg = cgroup_dir()
    cg0 = cg_snapshot(cg)
    ctr = Counters(sorted(tids, key=lambda t: -a["threads"].get(t, 0)))
    c0 = ctr.read() if ctr.groups else None
    counts, samples, per = {}, 0, {}
    end = time.time() + DUR
    while True:
        for t in tasks():
            ts = stat("%s/task/%d/stat" % (P, t))
            if not ts:
                continue
            k = classify(ts[3], rd("%s/task/%d/wchan" % (P, t)).strip())
            counts[k] = counts.get(k, 0) + 1
            per.setdefault(t, {})
            per[t][k] = per[t].get(k, 0) + 1
        samples += 1
        if time.time() >= end:
            break
        time.sleep(0.1)
    c1 = ctr.read() if ctr.groups else None
    ctr.close()
    tids = tasks()
    b = snapshot(tids)
    cg1 = cg_snapshot(cg)
    if not b["stat"]:
        print(json.dumps({"pid": PID, "gone": True}))
        return
    dt = max(0.05, b["t"] - a["t"])
    s, st = b["stat"], b["status"]
    d = lambda f: int(s[f]) - int(a["stat"][f]) if a["stat"] else 0
    run_s, runq_s = sched_split(a, b, dt)
    boot = time.time() - float(rd("/proc/uptime").split()[0])
    # threads: their CPU over the sample and what they mostly did
    names = {}
    for t in tids:
        names[t] = rd("%s/task/%d/comm" % (P, t)).strip()
    threads = []
    for t in tids:
        cpu = (b["threads"].get(t, 0) - a["threads"].get(t, b["threads"].get(t, 0))) / HZ / dt
        pc = per.get(t, {})
        threads.append({"tid": t, "name": names.get(t, ""), "cpu": round(cpu, 3), "doing": max(pc, key=pc.get) if pc else ""})
    threads.sort(key=lambda x: -x["cpu"])
    # files and sockets
    fds, inodes, files = 0, set(), []
    try:
        for fd in os.listdir(P + "/fd"):
            fds += 1
            try:
                l = os.readlink("%s/fd/%s" % (P, fd))
            except Exception:
                continue
            if l.startswith("socket:["):
                inodes.add(l[8:-1])
            elif l.startswith("/") and not l.startswith(("/dev/", "/proc/", "/sys/")) and len(files) < 40:
                files.append(l)
    except Exception:
        fds = -1
    fdlim = -1
    for line in rd(P + "/limits").splitlines():
        if line.startswith("Max open files"):
            try:
                fdlim = int(line.split()[3])
            except Exception:
                pass
    conns = sockets(inodes) if inodes else []
    # cgroup limits and pressure
    cgi = {}
    if cg:
        cm = rd(cg + "/cpu.max").split()
        mm = rd(cg + "/memory.max").strip()
        cgi = {"path": cg_rel,
               "cpu_limit": (int(cm[0]) / int(cm[1])) if len(cm) == 2 and cm[0] != "max" else None,
               "mem_limit": int(mm) if mm.isdigit() else None,
               "mem_current": int(rd(cg + "/memory.current").strip() or 0),
               "pressure": {"cpu": psi(cg + "/cpu.pressure"), "memory": psi(cg + "/memory.pressure"), "io": psi(cg + "/io.pressure")},
               "throttled": ((cg1.get("throttled_usec", 0) - cg0.get("throttled_usec", 0)) / 1e6 / dt) if cg0 else 0,
               "oom_kills": int(kv(rd(cg + "/memory.events").replace(" ", ":")).get("oom_kill", "0") or 0)}
    def gid_user(uid):
        for line in rd("/etc/passwd").splitlines():
            p = line.split(":")
            if len(p) > 2 and p[2] == uid:
                return p[0]
        return uid
    uid = (st.get("Uid", "") or "?").split()[0]
    cache = None
    if c0 and c1:
        dd = dict((k, c1[k] - c0[k]) for k in c1)
        cache = {"refs": dd["refs"] / dt, "misses": dd["misses"] / dt, "instructions": dd.get("instructions", 0) / dt, "cycles": dd.get("cycles", 0) / dt,
                 "miss_pct": (dd["misses"] / dd["refs"]) if dd["refs"] > 0 else None,
                 "ipc": (dd["instructions"] / dd["cycles"]) if dd.get("cycles") else None, "threads": len(ctr.groups)}
    out = {
        "pid": PID, "name": s[2], "state": s[3], "ppid": int(s[4]), "nice": int(s[19]), "priority": int(s[18]),
        "threads_n": int(s[20]), "started": boot + int(s[22]) / HZ, "last_cpu": int(s[39]) if 39 in s else -1,
        "user": gid_user(uid), "cmdline": rd(P + "/cmdline").replace("\0", " ").strip()[:2000],
        "exe": rl(P + "/exe"), "cwd": rl(P + "/cwd"),
        "affinity": st.get("Cpus_allowed_list", ""),
        "cpu": {"user": d(14) / HZ / dt, "system": d(15) / HZ / dt,
                "ctx_vol": (int(st.get("voluntary_ctxt_switches", 0)) - int(a["status"].get("voluntary_ctxt_switches", 0))) / dt,
                "ctx_invol": (int(st.get("nonvoluntary_ctxt_switches", 0)) - int(a["status"].get("nonvoluntary_ctxt_switches", 0))) / dt,
                "run_s": run_s, "runq_s": runq_s},
        "mem": {"rss": kb(st.get("VmRSS", "0")), "anon": kb(st.get("RssAnon", "0")), "file": kb(st.get("RssFile", "0")),
                "shmem": kb(st.get("RssShmem", "0")), "swap": kb(st.get("VmSwap", "0")), "peak": kb(st.get("VmHWM", "0")),
                "virt": kb(st.get("VmSize", "0")), "minflt": d(10) / dt, "majflt": d(12) / dt},
        "io": {"read": (int(b["io"].get("read_bytes", 0)) - int(a["io"].get("read_bytes", 0))) / dt,
               "write": (int(b["io"].get("write_bytes", 0)) - int(a["io"].get("write_bytes", 0))) / dt,
               "rchar": (int(b["io"].get("rchar", 0)) - int(a["io"].get("rchar", 0))) / dt,
               "blkio_delay": d(42) / HZ / dt if 42 in s else None, "delayacct": rd("/proc/sys/kernel/task_delayacct").strip() == "1"},
        "waits": counts, "samples": samples, "dt": dt,
        "threads": threads[:16], "fds": fds, "fd_limit": fdlim, "files": files[:20],
        "conns": conns[:40], "conns_n": len(conns), "cgroup": cgi,
        "cache": cache, "cache_error": "" if cache else (ctr.error or "no counters"),
    }
    print(json.dumps(out))


if __name__ == "__main__":   # also true for `python3 -`, as the server runs it
    main()
