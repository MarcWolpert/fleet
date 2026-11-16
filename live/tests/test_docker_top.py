# SPDX-License-Identifier: GPL-3.0-or-later
"""Details for a container on Docker Desktop (a Mac): its processes run in Docker's Linux VM, which
macOS can't see, so they are read with docker top and keyed d:<container>:<pid>, so the VM's PIDs
never meet this Mac's (#211)."""
import builtins, contextlib, importlib.util, io, json, os, sys, tempfile, threading, time, unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)
argv, sys.argv = sys.argv, ["fleet_live.py"]
try:
    spec = importlib.util.spec_from_file_location("fleet_live_dtop_test", os.path.join(LIVE, "fleet_live.py"))
    fl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fl)
finally:
    sys.argv = argv

TOP = """PID                 PPID                USER                STAT                TIME                RSS                 NLWP                COMMAND
3562                3539                root                Ss                  0                   872                 1                   /usr/bin/s6-svscan /etc/s6
3615                3562                1000                Ssl                 55                  188832              22                  /usr/local/bin/gitea web
3616                3562                root                Ss                  0                   4512                1                   sshd: /usr/sbin/sshd -D -e [listener] 0 of 10-100 startups
"""


def settle(m):
    """Let the docker top reads a request started in the background finish."""
    for e in m.__dict__.get("dtop", {}).get("c", {}).values():
        if e["reading"] is not None:
            e["reading"].join(5)


class DockerTop(unittest.TestCase):
    def test_parsed_with_the_command_line_whole(self):
        self.assertEqual(fl.parse_docker_top(TOP), [
            (3562, 3539, "root", "Ss", 0, 872, 1, "/usr/bin/s6-svscan /etc/s6"),
            (3615, 3562, "1000", "Ssl", 55, 188832, 22, "/usr/local/bin/gitea web"),
            (3616, 3562, "root", "Ss", 0, 4512, 1, "sshd: /usr/sbin/sshd -D -e [listener] 0 of 10-100 startups")])
        self.assertEqual(fl.parse_docker_top(""), [])
        self.assertEqual(fl.parse_docker_top("Error response from daemon: No such container: x"), [])

    def test_rows_keyed_apart_from_this_macs_with_cpu_from_cumulative_time(self):
        m = fl.Machine({"id": "here", "name": "here", "kind": "local"}, 3)
        view = {"containers": [{"id": "abc123def456", "name": "web"}]}
        own = {"cont": {"abc123def456": "here/compose/app/web"}, "vm": {}}
        tops = iter([TOP, TOP.replace("55                  188832", "61                  188832")])
        old = fl.run
        fl.run = lambda cmd, timeout=10: next(tops)
        try:
            first = m.docker_desktop_procs(view, own, now=100.0)
            m.docker_desktop_procs(view, own, now=103.0)   # starts the next read, off the request (PR 270 review)
            settle(m)
            second = m.docker_desktop_procs(view, own, now=103.0)
        finally:
            fl.run = old
        gitea = [r for r in second if r[0] == "d:abc123def456:3615"][0]
        # [key, name, user, state, cpu cores, mem GB, disk, gpu, threads, command, node, parent key, last CPU, gpus, disks, ifs, net]
        self.assertEqual(gitea, ["d:abc123def456:3615", "gitea", "1000", "Ssl", 2.0, round(188832 * 1024 / fl.GB, 5), 0.0, 0.0, 22,
                                 "/usr/local/bin/gitea web", "here/compose/app/web", "d:abc123def456:3562", -1, [], [], [], -1])
        self.assertEqual([r[0] for r in first], ["d:abc123def456:3562", "d:abc123def456:3615", "d:abc123def456:3616"])
        self.assertEqual([r[4] for r in first], [0.0, 0.0, 0.0], "no rate from one reading")
        self.assertEqual([r[1] for r in second], ["s6-svscan", "gitea", "sshd"])


CONTS = [{"id": "aaa111aaa111", "name": "app-web-1"}, {"id": "bbb222bbb222", "name": "app-db-1"}, {"id": "ccc333ccc333", "name": "cache"}]
OWN = {"cont": {"aaa111aaa111": "here/compose/app/web", "bbb222bbb222": "here/compose/app/db", "ccc333ccc333": "here/containers/cache"}, "vm": {}}


def top_of(cputime):
    return TOP.replace("55                  188832", "%-20d188832" % cputime)


class DockerTopReads(unittest.TestCase):
    """PR 270 review: every /api/procs poll of this Mac ran one docker top per running container, whatever the page
    showed, and on the request thread, so the slowest one held back the whole refresh (5-6 s for one that hangs).
    Now only the containers the page shows are read, each at most once per reading interval, off the request thread."""

    def setUp(self):
        self.m = fl.Machine({"id": "here", "name": "here", "kind": "local"}, 3)
        self.calls = []

    def run_(self, answer=None):
        def run(cmd, timeout=10):
            self.calls.append(cmd[2])
            return answer(cmd[2]) if answer else TOP
        return mock.patch.object(fl, "run", run)

    def read(self, now, scope=None, wait=True, conts=CONTS):
        kw = {} if scope is None else {"scope": scope}
        rows = self.m.docker_desktop_procs({"containers": conts}, OWN, now=now, **kw)
        if wait:
            settle(self.m)
        return rows

    def test_only_the_containers_in_the_scope_are_read(self):
        want = {None: ["aaa111aaa111", "bbb222bbb222", "ccc333ccc333"], "here": ["aaa111aaa111", "bbb222bbb222", "ccc333ccc333"],
                "here/compose/app": ["aaa111aaa111", "bbb222bbb222"], "here/compose/app/web": ["aaa111aaa111"],
                "here/containers/cache": ["ccc333ccc333"], "here/compose/app/we": [], "here/base": [], "here/base/cron/x-1234abcd": []}
        got = {}
        for scope in want:
            self.setUp()
            with self.run_():
                rows = self.read(100.0, scope)
            got[scope] = sorted(self.calls)
            self.assertEqual(sorted({r[10] for r in rows}), sorted({OWN["cont"][c] for c in want[scope]}), scope)
        self.assertEqual(got, want)

    def test_each_container_is_read_at_most_once_per_reading_interval(self):
        with self.run_():
            for now in (100.0, 101.0, 102.0, 102.9):   # the page polls every 2 s or so; a reading comes every 3
                self.read(now, conts=CONTS[:1])
            self.assertEqual(self.calls, ["aaa111aaa111"])
            self.read(103.0, conts=CONTS[:1])
            self.assertEqual(self.calls, ["aaa111aaa111", "aaa111aaa111"])
            self.read(103.5)   # the others weren't read yet: they are now, and web isn't again
            self.assertEqual(sorted(self.calls), ["aaa111aaa111", "aaa111aaa111", "bbb222bbb222", "ccc333ccc333"])

    def test_a_request_gets_the_last_rows_at_once_while_a_slow_read_goes_on(self):
        go, outs = threading.Event(), iter([top_of(55), top_of(61)])
        def answer(cid):
            out = next(outs)
            if out != top_of(55):
                go.wait(10)   # this docker top hangs until the test lets it go
            return out
        with self.run_(answer):
            self.read(100.0, conts=CONTS[:1])
            began = time.monotonic()
            rows = self.read(103.0, wait=False, conts=CONTS[:1])
            took = time.monotonic() - began
            go.set()
            self.assertLess(took, 1.0, "the request waited for docker top")
            self.assertEqual([(r[0], r[4]) for r in rows if r[0].endswith(":3615")], [("d:aaa111aaa111:3615", 0.0)], "the last rows")
            self.read(103.0, conts=CONTS[:1])   # the read finishes
            rows = self.read(104.0, conts=CONTS[:1])
        self.assertEqual([(r[0], r[4]) for r in rows if r[0].endswith(":3615")], [("d:aaa111aaa111:3615", 2.0)], "6 s of CPU in 3 s")
        self.assertEqual(self.calls, ["aaa111aaa111", "aaa111aaa111"])

    def test_rows_too_old_to_show_are_waited_for_like_a_first_read(self):
        # a container nothing showed for a while (Details moved elsewhere) is read afresh before it's listed again
        later = TOP + "3700                3562                root                S                   0                   2048                1                   /usr/bin/later\n"
        outs = iter([TOP, later])
        with self.run_(lambda cid: next(outs)):
            first = self.read(100.0, wait=False, conts=CONTS[:1])
            again = self.read(130.0, wait=False, conts=CONTS[:1])
        self.assertEqual(([r[0] for r in first], [r[0] for r in again]),
                         (["d:aaa111aaa111:3562", "d:aaa111aaa111:3615", "d:aaa111aaa111:3616"],
                          ["d:aaa111aaa111:3562", "d:aaa111aaa111:3615", "d:aaa111aaa111:3616", "d:aaa111aaa111:3700"]))

    def test_a_container_that_is_gone_is_forgotten(self):
        with self.run_():
            self.read(100.0)
            self.read(101.0, conts=CONTS[:1])
        self.assertEqual(sorted(self.m.dtop["c"]), ["aaa111aaa111"])


class ProcsAskForWhatTheyShow(unittest.TestCase):
    """/api/procs reads Docker Desktop's containers only for a view that lists their processes, and only those inside
    what it shows (scope); the CPU, disk and interface cards' lists (docker=0) never hold them."""

    def fleet(self):
        m = fl.Machine({"id": "here", "name": "here", "kind": "local"}, 3)
        m.view, m.status, m.fresh = {"t": 1.0, "procs": [], "containers": CONTS, "jobs": [], "gpu_procs": False}, "ok", True
        f = fl.Fleet.__new__(fl.Fleet)
        f.machines, f.lock, f.specs = {"here": m}, threading.Lock(), {"here": {"id": "here", "procs_owner": OWN, "vms": []}}
        return f, m

    def test_the_scope_reaches_the_reads_and_docker_0_reads_none(self):
        f, m = self.fleet()
        seen = []
        with mock.patch.object(fl.platform, "system", return_value="Darwin"), \
                mock.patch.object(m, "docker_desktop_procs", side_effect=lambda view, own, scope=None: seen.append(scope) or []):
            f.api_procs("here")
            f.api_procs("here", scope="here/compose/app")
            f.api_procs("here", docker=False)
        self.assertEqual(seen, [None, "here/compose/app"])

    def test_the_route_passes_them_on(self):
        import http.client, http.server
        fleet = mock.Mock()
        fleet.api_procs.return_value = {"procs": []}
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), fl.Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            with mock.patch.object(fl.Handler, "fleet", fleet, create=True):
                for path in ("/api/procs?machine=here", "/api/procs?machine=here&scope=here%2Fcompose%2Fapp%2Fweb", "/api/procs?machine=here&docker=0"):
                    c = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=5)
                    c.request("GET", path, headers={"Host": "127.0.0.1:%d" % srv.server_address[1]})
                    self.assertEqual(c.getresponse().status, 200, path)
                    c.close()
        finally:
            srv.shutdown()
            srv.server_close()
        self.assertEqual(fleet.api_procs.call_args_list, [mock.call("here", scope=None, docker=True), mock.call("here", scope="here/compose/app/web", docker=True),
                                                          mock.call("here", scope=None, docker=False)])


HZ, UPTIME = 100, 5000.0


def stat_line(pid, comm, ppid, start):
    """/proc/<pid>/stat: starttime (in clock ticks since boot) is field 22, the 20th after the ") " that ends comm."""
    return "%d (%s) S %d " % (pid, comm, ppid) + " ".join(["0"] * 17 + [str(start)] + ["0"] * 30) + "\n"


def run_exec_finder(procs, pid, top, backwards=False):
    """Run the prelude docker_vm_inspect_cmd sends with docker exec, as python3 runs it inside the container, against a
    fake /proc: procs {container pid: (cmdline bytes or None for one that just exited, comm, ppid, seconds since it started)}. `top` is what docker top
    said of the container (VM pid, etimes, args), as inspect_docker_vm reads it. Returns the container PID the
    inspector is then run on, or the error it printed. /proc is listed in name order, or backwards."""
    out = "PID ELAPSED COMMAND\n" + "".join("%d %d %s\n" % row for row in top)
    with mock.patch.object(fl, "run", lambda cmd, timeout=10: out), mock.patch.object(fl.subprocess, "run") as sp:
        sp.return_value = mock.Mock(stdout=b'{"pid": 1}\n', stderr=b"")
        fl.INSPECT_CACHE.clear()
        fl.inspect_docker_vm(types_m(), "abc123def456", pid, "exec")
    stdin = sp.call_args.kwargs["input"].decode()
    prelude = stdin[:stdin.index(open(os.path.join(LIVE, "inspect_linux.py")).read())]
    with tempfile.TemporaryDirectory() as root:
        with open(os.path.join(root, "uptime"), "w") as f:
            f.write("%.2f 100.00\n" % UPTIME)
        for p, (cmdline, comm, ppid, age) in procs.items():
            os.mkdir(os.path.join(root, str(p)))
            if cmdline is None:   # it exited after /proc was listed: its files are gone
                continue
            with open(os.path.join(root, str(p), "cmdline"), "wb") as f:
                f.write(cmdline)
            with open(os.path.join(root, str(p), "stat"), "w") as f:
                f.write(stat_line(p, comm, ppid, int(round((UPTIME - age) * HZ))))
        os.mkdir(os.path.join(root, "self"))
        real_open, real_listdir = builtins.open, os.listdir
        moved = lambda path: os.path.join(root, path[len("/proc/"):]) if isinstance(path, str) and path.startswith("/proc/") else path
        argv, printed = sys.argv, io.StringIO()
        try:
            with mock.patch.object(builtins, "open", lambda path, *a, **k: real_open(moved(path), *a, **k)), \
                    mock.patch.object(os, "listdir", lambda path=".": sorted(real_listdir(root), reverse=backwards) if path == "/proc" else real_listdir(path)), \
                    mock.patch.object(os, "sysconf", lambda name: HZ if name == "SC_CLK_TCK" else os.sysconf(name)), \
                    contextlib.redirect_stdout(printed):
                try:
                    exec(compile(prelude, "<exec prelude>", "exec"), {"__name__": "__main__"})
                except SystemExit:
                    return json.loads(printed.getvalue())["error"]
            return int(sys.argv[1])
        finally:
            sys.argv = argv


def types_m():
    return fl.Machine({"id": "here", "name": "here", "kind": "local"}, 3)


GUNI = b"/usr/local/bin/python3\0/usr/local/bin/gunicorn\0-w\0003\0app:app\0"
GUNI_ARGS = "/usr/local/bin/python3 /usr/local/bin/gunicorn -w 3 app:app"
# a pre-fork server in its container: the master (7) and its workers (8, 9, 10) share a command line and started
# within the same second; in Docker's VM they are 3700, 3712, 3713, 3714 (a fork takes the next PID in both)
PREFORK = {1: (b"/sbin/tini\0--\0gunicorn\0", "tini", 0, 600.0), 7: (GUNI, "gunicorn", 1, 590.2),
           8: (GUNI, "gunicorn", 7, 590.0), 9: (GUNI, "gunicorn", 7, 590.0), 10: (GUNI, "gunicorn", 7, 590.0)}
PREFORK_TOP = [(3690, 600, "/sbin/tini -- gunicorn"), (3700, 590, GUNI_ARGS), (3712, 590, GUNI_ARGS), (3713, 590, GUNI_ARGS), (3714, 590, GUNI_ARGS)]


class ExecFindsTheProcess(unittest.TestCase):
    """PR 273 review: docker exec runs inside the container, where the process has another PID. The prelude found it by
    command line and age, the closest match winning: a pre-fork server's master and workers share both, so a click on
    the master could inspect a worker, and nothing said so."""

    def test_each_of_a_pre_fork_servers_look_alikes_is_itself(self):
        got = {vm: run_exec_finder(PREFORK, vm, PREFORK_TOP) for vm in (3700, 3712, 3713, 3714)}
        self.assertEqual(got, {3700: 7, 3712: 8, 3713: 9, 3714: 10})

    def test_in_any_order_proc_lists_them(self):
        self.assertEqual({vm: run_exec_finder(PREFORK, vm, PREFORK_TOP, backwards=True) for vm in (3700, 3712, 3713, 3714)},
                         {3700: 7, 3712: 8, 3713: 9, 3714: 10})

    def test_when_one_came_or_went_since_docker_top_it_does_not_guess(self):
        gone = {k: v for k, v in PREFORK.items() if k != 8}   # worker 8 exited between docker top and docker exec
        self.assertEqual(run_exec_finder(gone, 3713, PREFORK_TOP),
                         "Its container runs other processes just like it, and Fleet couldn't tell which one it is. Look with a helper container instead.")

    def test_nothing_else_a_process_without_look_alikes_is_found_by_its_command_line_and_age(self):
        procs = {1: (b"/sbin/tini\0--\0node\0server.js\0", "tini", 0, 300.0), 6: (b"node\0server.js\0", "node", 1, 299.4)}
        top = [(4100, 300, "/sbin/tini -- node server.js"), (4107, 299, "node server.js")]
        self.assertEqual((run_exec_finder(procs, 4107, top), run_exec_finder(procs, 4100, top)), (6, 1))


class ExecFinderEdges(unittest.TestCase):
    """PR 273 review: the finder's parts most likely to be wrong, run (not only compiled): where starttime is in
    /proc/<pid>/stat, the 3 s it allows, and command lines whose NULs differ from docker top's text."""

    def one(self, cmdline, age, args="node server.js", etimes=299, comm="node"):
        return run_exec_finder({6: (cmdline, comm, 1, age)}, 4107, [(4107, etimes, args)])

    def test_starttime_is_field_22_whatever_the_process_calls_itself(self):
        # comm may hold spaces and parentheses: the fields are counted from the last ")"
        self.assertEqual([self.one(b"node\0server.js\0", 299.4, comm=c) for c in ("node", "my (odd) node", "a) S 1 2 3")], [6, 6, 6])

    def test_three_seconds_either_way_and_no_more(self):
        got = {age: self.one(b"node\0server.js\0", age) for age in (296.1, 299.0, 301.9, 302.5, 295.5)}
        nf = "Couldn't find that process inside its container."
        self.assertEqual(got, {296.1: 6, 299.0: 6, 301.9: 6, 302.5: nf, 295.5: nf})

    def test_command_lines_as_docker_top_shows_them(self):
        cases = {b"node\0server.js\0": "node server.js",                         # argv, NUL after each
                 b"node\0server.js": "node server.js",                            # no NUL after the last
                 b"nginx: worker process\0\0\0\0\0\0": "nginx: worker process",      # a rewritten argv, padded
                 b"sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups\0": "sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups"}
        self.assertEqual({k: self.one(k, 299.4, args=v) for k, v in cases.items()}, {k: 6 for k in cases})

    def test_nothing_else_another_command_line_is_not_it(self):
        nf = "Couldn't find that process inside its container."
        self.assertEqual([self.one(b"node\0server.js\0--inspect\0", 299.4), self.one(b"node\0worker.js\0", 299.4)], [nf, nf])

    def test_a_process_that_exits_while_proc_is_read_is_passed_over(self):
        procs = dict(PREFORK)
        procs[11] = (None, "gone", 7, 1.0)   # listed, then gone before its files are read
        self.assertEqual(run_exec_finder(procs, 3713, PREFORK_TOP), 9)


class InspectDockerVm(unittest.TestCase):
    """inspect_docker_vm: docker top to find it for exec, then docker run or docker exec, and the answer or the error."""

    def setUp(self):
        fl.INSPECT_CACHE.clear()
        self.addCleanup(fl.INSPECT_CACHE.clear)
        self.m = types_m()

    def look(self, via, stdout=b"", stderr=b"", top=PREFORK_TOP, pid=3700, raises=None, keep=False):
        if not keep:
            fl.INSPECT_CACHE.clear()
        out = "PID ELAPSED COMMAND\n" + "".join("%d %d %s\n" % row for row in top)
        with mock.patch.object(fl, "run", lambda cmd, timeout=10: out), mock.patch.object(fl.subprocess, "run") as sp, \
                mock.patch.object(fl.time, "time", return_value=1000.0):
            sp.return_value = mock.Mock(stdout=stdout, stderr=stderr)
            if raises:
                sp.side_effect = raises
            got = fl.inspect_docker_vm(self.m, "abc123def456", pid, via)
        return got, [c.args[0][:3] for c in sp.call_args_list]

    def test_the_last_json_line_is_the_answer(self):
        got, ran = self.look("exec", stdout=b'Unable to find image\n{"pid": 1}\nnoise\n{"pid": 7, "name": "gunicorn"}\n')
        self.assertEqual((got, ran), ({"pid": 7, "name": "gunicorn", "machine": "here", "t": 1000.0, "via": "exec"}, [["docker", "exec", "-i"]]))

    def test_a_process_docker_top_no_longer_lists_is_gone_and_nothing_runs(self):
        self.assertEqual(self.look("exec", pid=3799), ({"pid": 3799, "gone": True}, []))

    def test_exec_says_a_missing_python3_from_stdout_and_a_helper_its_error_from_stderr(self):
        miss = b'OCI runtime exec failed: exec failed: unable to start container process: exec: "python3": executable file not found in $PATH: unknown\n'
        self.assertEqual(self.look("exec", stdout=miss)[0]["error"], "This container has no python3 to run Fleet's inspector. Look with a helper container instead.")
        got, ran = self.look("helper", stderr=b"Unable to find image 'python:3.12-slim' locally\ndocker: Error response from daemon: pull access denied.\n")
        self.assertEqual((got["error"], ran), ("docker: Error response from daemon: pull access denied.", [["docker", "run", "--rm"]]))
        self.assertEqual(self.look("helper")[0]["error"], "no answer from Docker")

    def test_docker_that_takes_too_long_says_so(self):
        got, _ = self.look("helper", raises=fl.subprocess.TimeoutExpired(["docker"], 120))
        self.assertEqual(got, {"pid": 3700, "error": "Docker took too long to answer", "machine": "here", "t": 1000.0, "via": "helper"})

    def test_a_second_look_within_a_second_is_the_first_one(self):
        first, _ = self.look("helper", stdout=b'{"pid": 3700}\n')
        again, ran = self.look("helper", stdout=b'{"pid": 3700, "other": 1}\n', keep=True)
        self.assertEqual((again, ran), (first, []))


class ProcRouteGate(unittest.TestCase):
    """/api/proc?key=d:<container>:<pid>&via=...: only for this computer when it is a Mac (Docker Desktop), only by a
    way Fleet knows, only for a well-formed key; anything else is refused and nothing is run."""

    def ask(self, query, platform_name="darwin"):
        import http.client, http.server
        fleet = mock.Mock()
        fleet.machines = {"here": fl.Machine({"id": "here", "name": "here", "kind": "local"}, 3),
                          "nas": fl.Machine({"id": "nas", "name": "nas", "ssh": "nas", "os": "linux"}, 3)}
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), fl.Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        seen = []
        try:
            with mock.patch.object(fl.Handler, "fleet", fleet, create=True), mock.patch.object(fl.sys, "platform", platform_name), \
                    mock.patch.object(fl, "inspect_docker_vm", lambda m, cid, pid, via: seen.append((m.id, cid, pid, via)) or {"pid": pid}):
                c = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=5)
                c.request("GET", "/api/proc?" + query, headers={"Host": "127.0.0.1:%d" % srv.server_address[1]})
                body = json.loads(c.getresponse().read())
                c.close()
        finally:
            srv.shutdown()
            srv.server_close()
        return body, seen

    def test_a_vm_process_of_this_mac_by_a_known_way(self):
        self.assertEqual(self.ask("machine=here&key=d:abc123def456:3615&via=helper"), ({"pid": 3615}, [("here", "abc123def456", 3615, "helper")]))
        self.assertEqual(self.ask("machine=here&key=d:abc123def456:3615&via=exec")[1], [("here", "abc123def456", 3615, "exec")])

    def test_nothing_else(self):
        no = ({"error": "no such process"}, [])
        cases = {"an unknown way": "machine=here&key=d:abc123def456:3615&via=ssh", "no way": "machine=here&key=d:abc123def456:3615",
                 "a bad key": "machine=here&key=d:abc123def456:3615;id&via=helper", "a short id": "machine=here&key=d:abc123:3615&via=helper",
                 "another machine": "machine=nas&key=d:abc123def456:3615&via=helper", "no machine": "machine=gone&key=d:abc123def456:3615&via=helper"}
        got = {k: self.ask(q) for k, q in cases.items()}
        got["not a Mac"] = self.ask("machine=here&key=d:abc123def456:3615&via=helper", platform_name="linux")
        self.assertEqual(got, dict({k: no for k in cases}, **{"not a Mac": no}))


class LookInside(unittest.TestCase):
    """#218: a helper container, or the inspector run inside the process's own container."""
    def test_a_helper_container_sees_the_vm_and_runs_fleets_inspector(self):
        cmd, stdin = fl.docker_vm_inspect_cmd("abc123def456", 3615, "helper", "/usr/local/bin/gitea web", 52660)
        self.assertEqual(cmd[:3], ["docker", "run", "--rm"])
        for a in ("--pid=host", "--cap-add=SYS_PTRACE", "--network=none", "-i"):
            self.assertIn(a, cmd)
        self.assertEqual(cmd[-5:], [fl.HELPER_IMAGE, "python3", "-", "3615", str(fl.INSPECT_SECS)])
        self.assertEqual(stdin, open(os.path.join(LIVE, "inspect_linux.py"), "rb").read())

    def test_exec_finds_the_process_in_its_container_by_command_line_and_age(self):
        cmd, stdin = fl.docker_vm_inspect_cmd("abc123def456", 3615, "exec", "/usr/local/bin/gitea web", 52660)
        self.assertEqual(cmd, ["docker", "exec", "-i", "abc123def456", "python3", "-"])
        text = stdin.decode()
        self.assertIn("WANT_CMD = '/usr/local/bin/gitea web'", text)
        self.assertIn("WANT_AGE = 52660", text)
        self.assertTrue(text.endswith(open(os.path.join(LIVE, "inspect_linux.py")).read()))
        compile(text, "<exec>", "exec")   # one valid script

    def test_a_container_without_python3_says_so(self):
        real = 'OCI runtime exec failed: exec failed: unable to start container process: exec: "python3": executable file not found in $PATH'
        self.assertEqual(fl.vm_inspect_error("exec", real), "This container has no python3 to run Fleet's inspector. Look with a helper container instead.")
        self.assertEqual(fl.vm_inspect_error("helper", "docker: Error response from daemon: x\n"), "docker: Error response from daemon: x")
        self.assertEqual(fl.vm_inspect_error("helper", ""), "no answer from Docker")

    def test_only_a_docker_desktop_key_and_a_known_way(self):
        self.assertEqual(fl.parse_vm_key("d:abc123def456:3615"), ("abc123def456", 3615))
        for bad in ("d:abc:1", "d:ABC123DEF456:1", "d:abc123def456:x", "d:abc123def456:0", "3615", "d:abc123def456:1;rm"):
            self.assertIsNone(fl.parse_vm_key(bad), bad)
        with self.assertRaises(ValueError):
            fl.docker_vm_inspect_cmd("abc123def456", 1, "ssh", "", 0)


if __name__ == "__main__":
    unittest.main()
