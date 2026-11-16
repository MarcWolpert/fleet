# SPDX-License-Identifier: GPL-3.0-or-later
"""collect_linux.py's parsers, fed the text each source prints (/proc/net/dev, sysfs CPU lists, crontabs, virsh,
QEMU command lines, nvidia-smi,
DRM debugfs clients, docker ps with each container's network namespace), and the parts that keep state
between readings (each process's TCP bytes from ss).
Importing the collector reads nothing from this machine: its reading loop runs only when the file runs as a
script, the way Fleet Live pipes it to `python3 -`. Every assertion is the exact result.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import importlib.util, json, os, subprocess, sys, unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(os.path.dirname(HERE), "collect_linux.py")
_LOADED = {}


def collector():
    """collect_linux.py as a module, loaded once."""
    if "m" not in _LOADED:
        spec = importlib.util.spec_from_file_location("collect_linux_under_test", SRC)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        _LOADED["m"] = m
    return _LOADED["m"]


def fresh_collector():
    """collect_linux.py as a new module, its state between readings empty."""
    spec = importlib.util.spec_from_file_location("collect_linux_fresh", SRC)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class Import(unittest.TestCase):
    def test_importing_takes_no_reading(self):
        code = ("import importlib.util, sys\n"
                "s = importlib.util.spec_from_file_location('c', sys.argv[1])\n"
                "m = importlib.util.module_from_spec(s)\n"
                "s.loader.exec_module(m)\n"
                "print(sorted(k for k in ('snapshot', 'netdev', 'cpulist', 'add_cron') if callable(getattr(m, k, None))))\n")
        p = subprocess.run([sys.executable, "-c", code, SRC], capture_output=True, text=True, timeout=30)
        self.assertEqual((p.returncode, p.stdout, p.stderr), (0, "['add_cron', 'cpulist', 'netdev', 'snapshot']\n", ""))


class NetDev(unittest.TestCase):
    def test_counters_per_interface(self):
        text = ("Inter-|   Receive                                                |  Transmit\n"
                " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n"
                "    lo:    4096      40    0    0    0     0          0         0     4096      40    0    0    0     0       0          0\n"
                "  eth0: 123456789  98765    0    3    0     0          0        12 987654321   54321    0    0    0     0       0          0\n"
                "   br0:      0       0    0    0    0     0          0         0       70       1    0    0    0     0       0          0\n")
        self.assertEqual(collector().netdev(text), {"lo": [4096, 4096], "eth0": [123456789, 987654321], "br0": [0, 70]})

    def test_nothing_without_counters(self):
        self.assertEqual(collector().netdev(""), {})


class CpuList(unittest.TestCase):
    def test_ranges_and_single_cpus(self):
        self.assertEqual(collector().cpulist("0-3,8,10-11\n"), {0, 1, 2, 3, 8, 10, 11})

    def test_empty_file_is_no_cpus(self):
        self.assertEqual(collector().cpulist(""), set())


class UserCrontab(unittest.TestCase):
    def test_jobs_of_a_user_crontab(self):
        text = ("SHELL=/bin/sh\n"
                "# m h dom mon dow command\n"
                "\n"
                "*/5 * * * * /usr/local/bin/backup --quick > /dev/null 2>&1\n"
                "@daily /usr/local/bin/rotate-logs\n"
                "0 4 * * 1\n")
        cron = []
        collector().add_cron(cron, text, "crontab")
        self.assertEqual(cron, [{"sched": "*/5 * * * *", "cmd": "/usr/local/bin/backup --quick > /dev/null 2>&1", "src": "crontab"},
                                {"sched": "@daily", "cmd": "/usr/local/bin/rotate-logs", "src": "crontab"}])


USERS = {"root", "daemon", "backup", "nobody"}


class SystemCrontabs(unittest.TestCase):
    """/etc/crontab and /etc/cron.d files have a user column before the command, except dcron's per-user crontabs,
    which Unraid keeps in /etc/cron.d (crontab -c /etc/cron.d)."""
    def jobs(self, text, src, users=USERS):
        cron = []
        collector().add_cron(cron, text, src, users)
        return [(j["sched"], j["cmd"]) for j in cron], {j["src"] for j in cron}

    def test_unraid_per_user_crontab_in_cron_d(self):
        text = ("# Generated docker monitoring schedule:\n"
                "10 0 * * * /usr/local/emhttp/plugins/dynamix.docker.manager/scripts/dockerupdate check &> /dev/null\n"
                "\n"
                "# Generated system monitoring schedule:\n"
                "*/1 * * * * /usr/local/emhttp/plugins/dynamix/scripts/monitor &> /dev/null\n"
                "\n"
                "# Generated mover schedule:\n"
                "40 3 * * * /usr/local/sbin/mover &> /dev/null\n")
        self.assertEqual(self.jobs(text, "/etc/cron.d/root"), (
            [("10 0 * * *", "/usr/local/emhttp/plugins/dynamix.docker.manager/scripts/dockerupdate check &> /dev/null"),
             ("*/1 * * * *", "/usr/local/emhttp/plugins/dynamix/scripts/monitor &> /dev/null"),
             ("40 3 * * *", "/usr/local/sbin/mover &> /dev/null")], {"/etc/cron.d/root"}))

    def test_cron_d_file_with_a_user_column(self):
        text = ("SHELL=/bin/sh\n"
                "30 3 * * 0 root test -e /run/systemd/system || SERVICE_MODE=1 /usr/lib/e2fsprogs/e2scrub_all_cron\n"
                "@reboot root /usr/local/bin/warm-cache --quiet\n"
                "*/10 * * * * daemon /usr/local/bin/poll\n")
        self.assertEqual(self.jobs(text, "/etc/cron.d/e2scrub_all"), (
            [("30 3 * * 0", "test -e /run/systemd/system || SERVICE_MODE=1 /usr/lib/e2fsprogs/e2scrub_all_cron"),
             ("@reboot", "/usr/local/bin/warm-cache --quiet"),
             ("*/10 * * * *", "/usr/local/bin/poll")], {"/etc/cron.d/e2scrub_all"}))

    def test_etc_crontab(self):
        text = "17 * * * * root cd / && run-parts --report /etc/cron.hourly\n25 6 * * * root test -x /usr/sbin/anacron || run-parts /etc/cron.daily\n"
        self.assertEqual(self.jobs(text, "/etc/crontab"), (
            [("17 * * * *", "cd / && run-parts --report /etc/cron.hourly"),
             ("25 6 * * *", "test -x /usr/sbin/anacron || run-parts /etc/cron.daily")], {"/etc/crontab"}))

    def test_a_user_crontab_never_has_a_user_column(self):
        # `backup` is a user here, but crontab -l is one user's own crontab: it's the command
        self.assertEqual(self.jobs("0 1 * * * backup --full /srv\n@hourly backup --quick\n", "crontab"), (
            [("0 1 * * *", "backup --full /srv"), ("@hourly", "backup --quick")], {"crontab"}))


def domiflist(*rows):
    """`virsh domiflist` output: a header, a rule, a row per interface (name, type, source, model, MAC)."""
    return (" Interface   Type     Source   Model    MAC\n" + "-" * 59 + "\n"
            + "".join(" %-11s %-8s %-8s %-8s %s\n" % r for r in rows) + "\n")


class FakeVirsh:
    """virsh with these running domains. Like virsh, domiflist takes the domain as --domain's value or as its first
    argument; a first argument that starts with a dash is an option it doesn't know (an error, nothing on stdout);
    a number is tried as a domain ID before it is tried as a name."""
    def __init__(self, domains):
        self.domains = domains  # [(id, name, domiflist output)]

    def __call__(self, cmd, timeout=8):
        if cmd == ["virsh", "list", "--name"]:
            return "".join(name + "\n" for _, name, _ in self.domains) + "\n"
        if cmd[:2] != ["virsh", "domiflist"] or len(cmd) < 3:
            return ""
        args = cmd[2:]
        if args[0] == "--domain" and len(args) == 2:
            dom = args[1]
        elif args[0].startswith("-") or len(args) != 1:
            return ""
        else:
            dom = args[0]
        for i, name, out in self.domains:
            if dom.isdigit() and int(dom) == i:
                return out
        for i, name, out in self.domains:
            if name == dom:
                return out
        return ""


class LibvirtVms(unittest.TestCase):
    DOMAINS = [(10, "Windows 10", domiflist(("vnet0", "bridge", "br0", "virtio", "52:54:00:00:00:0a"))),
               (3, "ubuntu-server", domiflist(("vnet1", "network", "default", "virtio", "52:54:00:00:00:03"))),
               (7, "-lab", domiflist(("vnet2", "bridge", "br0", "e1000e", "52:54:00:00:00:07"),
                                     ("vnet3", "bridge", "br1", "e1000e", "52:54:00:00:00:08")))]

    def vms(self, domains):
        c = collector()
        with mock.patch.object(c, "run", FakeVirsh(domains)):
            return c.libvirt_vms()

    def test_one_vm_per_line_of_virsh_list(self):
        self.assertEqual(self.vms(self.DOMAINS), [
            {"name": "Windows 10", "ifs": [{"if": "vnet0", "source": "br0", "mac": "52:54:00:00:00:0a"}]},
            {"name": "ubuntu-server", "ifs": [{"if": "vnet1", "source": "default", "mac": "52:54:00:00:00:03"}]},
            {"name": "-lab", "ifs": [{"if": "vnet2", "source": "br0", "mac": "52:54:00:00:00:07"},
                                     {"if": "vnet3", "source": "br1", "mac": "52:54:00:00:00:08"}]}])

    def test_two_names_that_share_a_word_stay_two_vms(self):
        self.assertEqual(self.vms([(1, "Windows 10", domiflist(("vnet0", "bridge", "br0", "virtio", "52:54:00:00:00:01"))),
                                   (2, "Windows 11", domiflist(("vnet1", "bridge", "br0", "virtio", "52:54:00:00:00:02")))]), [
            {"name": "Windows 10", "ifs": [{"if": "vnet0", "source": "br0", "mac": "52:54:00:00:00:01"}]},
            {"name": "Windows 11", "ifs": [{"if": "vnet1", "source": "br0", "mac": "52:54:00:00:00:02"}]}])

    def test_no_running_vms(self):
        self.assertEqual(self.vms([]), [])

    def test_no_libvirt(self):
        c = collector()
        with mock.patch.object(c, "run", lambda cmd, timeout=8: ""):
            self.assertEqual(c.libvirt_vms(), [])


def qemu_cmdline(*name):
    """/proc/<pid>/cmdline of a QEMU process as libvirt starts it (NUL-separated), with these -name arguments."""
    head = ["/usr/bin/qemu-system-x86_64"] + list(name)
    rest = ["-S", "-object", '{"qom-type":"secret","id":"masterKey0","format":"raw","file":"/var/lib/libvirt/qemu/domain-1-vm/master-key.aes"}',
            "-machine", "pc-q35-7.2,usb=off,dump-guest-core=off,memory-backend=pc.ram", "-accel", "kvm", "-cpu", "host,migratable=on",
            "-m", "8192", "-smp", "4,sockets=1,dies=1,cores=2,threads=2", "-netdev", '{"type":"tap","fd":"30","id":"hostnet0"}']
    return "\0".join(head + rest) + "\0"


class QemuVm(unittest.TestCase):
    def test_libvirt_name_with_spaces(self):
        self.assertEqual(collector().qemu_vm(qemu_cmdline("-name", "guest=Windows 10,debug-threads=on")), "Windows 10")

    def test_names_that_share_a_word_stay_apart(self):
        c = collector()
        self.assertEqual([c.qemu_vm(qemu_cmdline("-name", "guest=%s,debug-threads=on" % n)) for n in ("Windows 10", "Windows 11")],
                         ["Windows 10", "Windows 11"])

    def test_a_comma_in_the_name_is_written_twice(self):
        self.assertEqual(collector().qemu_vm(qemu_cmdline("-name", "guest=lab,,test,debug-threads=on")), "lab,test")

    def test_guest_key_after_another_key(self):
        self.assertEqual(collector().qemu_vm(qemu_cmdline("-name", "debug-threads=on,guest=Windows 10")), "Windows 10")

    def test_no_name_is_no_vm(self):
        c = collector()
        self.assertEqual([c.qemu_vm(qemu_cmdline()), c.qemu_vm("")], ["", ""])


def fake_nvidia_smi(full, basic=""):
    """nvidia-smi answering the collector's full --query-gpu with `full` and the basic one (old drivers) with `basic`."""
    def run(cmd, timeout=8):
        if cmd[0] != "nvidia-smi" or not cmd[1].startswith("--query-gpu="):
            return ""
        return full if "utilization.decoder" in cmd[1] else basic
    return run


def nv(index, name, bus, **kw):
    g = {"index": index, "name": name, "util": 0.0, "memUsed": 0.0, "memTotal": 0.0, "pdev": bus}
    g.update(kw)
    return g


NO_EXTRA = dict.fromkeys(("memUtil", "temp", "power", "powerLimit", "clock", "clockMax", "memClock", "fan", "enc", "dec"))


class NvidiaGpus(unittest.TestCase):
    def gpus(self, full, basic=""):
        c = collector()
        with mock.patch.object(c, "run", fake_nvidia_smi(full, basic)):
            return c.nvidia_gpus()

    def test_fields_nvidia_smi_cannot_read(self):
        # a healthy card; an A100 in MIG mode (no utilization); a unified-memory part (no memory.used/total)
        full = ("0, NVIDIA RTX A4000, 41, 1654, 16376, 00000000:83:00.0, 3, 47, 36.70, 140.00, 1410, 1950, 7000, 30, 4, 12\n"
                "1, NVIDIA A100-SXM4-40GB, [N/A], 1024, 40960, 00000000:07:00.0, [N/A], 33, 61.20, 400.00, 1410, 1410, 1215, [N/A], [N/A], [N/A]\n"
                "2, NVIDIA GB10, 5, [N/A], [N/A], 0000000F:01:00.0, [N/A], 41, 11.50, [N/A], 2405, 3003, [N/A], [N/A], 0, 0\n")
        self.assertEqual(self.gpus(full), [
            nv(0, "NVIDIA RTX A4000", "0000:83:00.0", util=41.0, memUsed=1654.0, memTotal=16376.0, memUtil=3.0, temp=47.0, power=36.7,
               powerLimit=140.0, clock=1410.0, clockMax=1950.0, memClock=7000.0, fan=30.0, enc=4.0, dec=12.0),
            nv(1, "NVIDIA A100-SXM4-40GB", "0000:07:00.0", memUsed=1024.0, memTotal=40960.0, memUtil=None, temp=33.0, power=61.2,
               powerLimit=400.0, clock=1410.0, clockMax=1410.0, memClock=1215.0, fan=None, enc=None, dec=None),
            nv(2, "NVIDIA GB10", "000f:01:00.0", util=5.0, memUtil=None, temp=41.0, power=11.5, powerLimit=None, clock=2405.0, clockMax=3003.0,
               memClock=None, fan=None, enc=0.0, dec=0.0)])

    def test_a_gpu_after_an_xid_error(self):
        full = "0, NVIDIA GeForce RTX 3090, " + ", ".join(["[Unknown Error]"] * 3) + ", 00000000:01:00.0, " + ", ".join(["[Unknown Error]"] * 10) + "\n"
        self.assertEqual(self.gpus(full), [nv(0, "NVIDIA GeForce RTX 3090", "0000:01:00.0", **NO_EXTRA)])

    def test_old_driver_basic_query(self):
        full = 'Field "clocks.max.gr" is not a valid field to query.\n'
        basic = "0, Tesla K80, [Not Supported], 0, 11441, 00000000:04:00.0\n1, Tesla K80, 12, 300, 11441, 00000000:05:00.0\n"
        self.assertEqual(self.gpus(full, basic), [nv(0, "Tesla K80", "0000:04:00.0", memTotal=11441.0),
                                                  nv(1, "Tesla K80", "0000:05:00.0", util=12.0, memUsed=300.0, memTotal=11441.0)])

    def test_no_nvidia_gpu(self):
        self.assertEqual(self.gpus(""), [])


# /sys/kernel/debug/dri/<pci address>/clients, printed by the kernel's drm_clients_info() (drivers/gpu/drm/drm_debugfs.c):
# the process name right-aligned in 20 columns, its tgid, the minor, master and authenticated flags, uid and magic.
CLIENTS = [("Plex Transcoder", 12345, 128, "n", "y", 0), ("Web Content", 2201, 128, "n", "y", 1000), ("Xorg", 1100, 0, "y", "y", 0),
           ("Worker 3", 4242, 128, "n", "y", 1000), ("ffmpeg", 1234567, 128, "n", "y", 0), ("<unknown>", 880, 128, "n", "y", 0)]


def clients_file(rows, names=False):
    """The clients file, optionally with the client-name column newer kernels add at the end."""
    head = "%20s %5s %3s master a %5s %10s" % ("command", "tgid", "dev", "uid", "magic") + (" %20s" % "name" if names else "")
    return "".join(l + "\n" for l in [head] + ["%20s %5d %3d   %c    %c %5d %10u" % (comm, pid, minor, master, auth, uid, 0)
                                                + (" %20s" % "<unset>" if names else "") for comm, pid, minor, master, auth, uid in rows])


class DebugfsClients(unittest.TestCase):
    PIDS = {"12345", "2201", "1100", "4242", "1234567", "880"}

    def test_names_with_spaces_and_digits(self):
        self.assertEqual(collector().debugfs_pids(clients_file(CLIENTS)), self.PIDS)

    def test_with_the_client_name_column(self):
        self.assertEqual(collector().debugfs_pids(clients_file(CLIENTS, names=True)), self.PIDS)

    def test_no_clients(self):
        self.assertEqual([collector().debugfs_pids(clients_file([])), collector().debugfs_pids("")], [set(), set()])


def ps_line(name, cid, image, project, service, networks):
    """One line of `docker ps --no-trunc --format '{{json .}}'`."""
    labels = ",".join("%s=%s" % kv for kv in (("com.docker.compose.project", project), ("com.docker.compose.service", service),
                                                ("com.docker.compose.project.config_files", "/srv/%s/compose.yaml" % project)) if project)
    return json.dumps({"Command": "\"/init\"", "ID": cid, "Image": image, "Labels": labels, "Names": name, "Networks": networks,
                       "State": "running", "Status": "Up 2 days"})


def container(name, cid, image, project, service, networks, rx, tx):
    """The collector's entry for that docker ps line."""
    return {"id": cid[:12], "name": name, "image": image, "status": "Up 2 days", "project": project, "service": service,
            "file": "/srv/%s/compose.yaml" % project if project else "", "networks": networks, "rx": rx, "tx": tx}


def netdev_text(rx, tx):
    return ("Inter-|   Receive                                                |  Transmit\n"
            " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n"
            "    lo:    5000      50    0    0    0     0          0         0     5000      50    0    0    0     0       0          0\n"
            "  eth0: %d    1000    0    0    0     0          0         0 %d     900    0    0    0     0       0          0\n" % (rx, tx))


HOST_NS, VPN_NS, PLEX_NS = "net:[4026531840]", "net:[4026532900]", "net:[4026533000]"
VPN, QBIT, ARR, PLEX, HA, GONE = ("%02x" % n * 32 for n in (0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6))
# docker ps lists the newest first
QBIT_C = ("qbittorrent", QBIT, "linuxserver/qbittorrent", "media", "qbittorrent", "")
ARR_C = ("sonarr", ARR, "linuxserver/sonarr", "media", "sonarr", "")
VPN_C = ("gluetun", VPN, "qmcgaw/gluetun", "media", "gluetun", "media_default")
PLEX_C = ("plex", PLEX, "plexinc/pms-docker", "", "", "bridge")
HA_C = ("homeassistant", HA, "homeassistant/home-assistant", "", "", "host")
GONE_C = ("exited", GONE, "busybox", "", "", "bridge")


class DockerContainers(unittest.TestCase):
    """qbittorrent and sonarr join gluetun's namespace (network_mode: service:gluetun), plex has its own, homeassistant is
    on the host network, and one container has no process left to read."""
    FIRST = {VPN[:12]: "2000", QBIT[:12]: "2100", ARR[:12]: "2200", PLEX[:12]: "3000", HA[:12]: "4000"}
    STARTED = {VPN[:12]: 51000, QBIT[:12]: 51900, ARR[:12]: 51400, PLEX[:12]: 40000, HA[:12]: 30000}
    NS = {"1": HOST_NS, "2000": VPN_NS, "2100": VPN_NS, "2200": VPN_NS, "3000": PLEX_NS, "4000": HOST_NS}
    DEV = {VPN_NS: netdev_text(9000000, 700000), PLEX_NS: netdev_text(120000, 4400000), HOST_NS: netdev_text(77000000, 66000000)}

    def containers(self, ps, first, started):
        c = collector()
        out = "".join(ps_line(*x) + "\n" for x in ps)
        with mock.patch.object(c, "run", lambda cmd, timeout=8: out if cmd[:2] == ["docker", "ps"] else ""), \
             mock.patch.object(c, "netns", lambda pid: self.NS.get(str(pid), "")), \
             mock.patch.object(c, "rd", lambda path: self.DEV.get(self.NS.get(path.split("/")[2], ""), "") if path.endswith("/net/dev") else ""):
            return c.docker_containers(first, started)

    def test_a_shared_namespace_counts_once_at_its_owner(self):
        self.assertEqual(self.containers([QBIT_C, ARR_C, VPN_C, PLEX_C, HA_C, GONE_C], self.FIRST, self.STARTED), [
            container(*QBIT_C, 0, 0), container(*ARR_C, 0, 0), container(*VPN_C, 9000000, 700000),
            container(*PLEX_C, 120000, 4400000), container(*HA_C, 0, 0), container(*GONE_C, 0, 0)])

    def test_a_joiner_left_alone_in_the_namespace_counts_it(self):
        # the only container seen in its namespace counts it
        self.assertEqual(self.containers([ARR_C], {ARR[:12]: "2200"}, {ARR[:12]: 51400}), [container(*ARR_C, 9000000, 700000)])

    def test_no_docker(self):
        self.assertEqual(self.containers([], self.FIRST, self.STARTED), [])


def ss(*conns):
    """`ss -tinpH state established`: one line per connection (no State column with a state filter), then
    its TCP info. conns: (local, peer, [(name, pid)], bytes sent, bytes received)."""
    out = []
    for local, peer, users, sent, got in conns:
        who = ",".join('("%s",pid=%d,fd=%d)' % (name, pid, 3 + i) for i, (name, pid) in enumerate(users))
        out.append("0      0      %-22s %-22s users:(%s)" % (local, peer, who))
        out.append("\t cubic wscale:7,7 rto:204 rtt:0.42/0.2 ato:40 mss:1448 pmtu:1500 rcvmss:536 advmss:1448 cwnd:10 "
                   "bytes_sent:%d bytes_acked:%d bytes_received:%d segs_out:21 segs_in:30 send 275Mbps lastsnd:4" % (sent, sent, got))
    return "\n".join(out) + ("\n" if out else "")


IFADDR = {"198.51.100.5": "eth0", "198.51.100.6": "br0"}
NGINX, SSHD, SSHD_USER, CURL = ("nginx", 300), ("sshd", 400), ("sshd", 401), ("curl", 500)


class ProcessNetwork(unittest.TestCase):
    """pnet[pid]["b"] counts the bytes a process's TCP connections moved since the collector started, so it
    only grows: connections that close keep what they moved, and a new one counts in full."""

    def readings(self, *steps):
        """steps: (ss output, live pids); returns pnet per step as {pid: (interfaces, bytes)}."""
        c = fresh_collector()
        got = []
        for text, live in steps:
            c.run = lambda cmd, timeout=8, text=text: text if cmd[0] == "ss" else ""
            procs = [[pid, 1, "x", "S", 0, 0, 1, "root", 0, "", "", "", "x", 0] for pid in live]
            got.append({pid: (u["ifs"], u["b"]) for pid, u in c.net_users(IFADDR, procs).items()})
        return got

    def test_closed_and_new_connections(self):
        a = ("198.51.100.5:443", "192.0.2.10:50001")
        b = ("198.51.100.5:443", "192.0.2.11:50002")
        c = ("198.51.100.5:443", "192.0.2.12:50003")
        s = ("198.51.100.5:22", "192.0.2.20:60000")
        d = ("198.51.100.6:40000", "192.0.2.30:443")
        got = self.readings(
            # the first reading only sets where counting starts
            (ss(a + ([NGINX], 1000, 500), b + ([NGINX], 4000, 1000), s + ([SSHD, SSHD_USER], 1500, 500)), (300, 400, 401)),
            # a grew 600, b closed, c is new (300 in full); the ssh session grew 500, for both of its processes
            (ss(a + ([NGINX], 1400, 700), c + ([NGINX], 200, 100), s + ([SSHD, SSHD_USER], 1800, 700)), (300, 400, 401)),
            # nginx has nothing open but keeps its count; curl's first connection counts in full
            (ss(s + ([SSHD, SSHD_USER], 1850, 750), d + ([CURL], 100, 600)), (300, 400, 401, 500)),
            # the session's second process has gone: its count goes with it
            (ss(s + ([SSHD], 1850, 750), d + ([CURL], 200, 800)), (300, 400, 500)),
            # ss gave nothing (it failed, or nothing is open): the counts hold
            ("", (300, 400, 500)),
            # and carry on from the last reading ss answered
            (ss(s + ([SSHD], 1900, 750), d + ([CURL], 200, 900)), (300, 400, 500)),
        )
        self.assertEqual(got, [
            {"300": (["eth0"], 0), "400": (["eth0"], 0), "401": (["eth0"], 0)},
            {"300": (["eth0"], 900), "400": (["eth0"], 500), "401": (["eth0"], 500)},
            {"300": ([], 900), "400": (["eth0"], 600), "401": (["eth0"], 600), "500": (["br0"], 700)},
            {"300": ([], 900), "400": (["eth0"], 600), "500": (["br0"], 1000)},
            {"300": ([], 900), "400": ([], 600), "500": ([], 1000)},
            {"300": ([], 900), "400": (["eth0"], 650), "500": (["br0"], 1100)},
        ])

    def test_a_process_with_no_connection_is_not_listed(self):
        s = ("198.51.100.5:22", "192.0.2.20:60000")
        got = self.readings((ss(s + ([SSHD], 100, 100)), (400, 600)), (ss(s + ([SSHD], 150, 100)), (400, 600)))
        self.assertEqual(got, [{"400": (["eth0"], 0)}, {"400": (["eth0"], 50)}])


if __name__ == "__main__":
    unittest.main()
