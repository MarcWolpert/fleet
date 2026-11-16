# SPDX-License-Identifier: GPL-3.0-or-later
"""Details for a container on Docker Desktop (a Mac): its processes run in Docker's Linux VM, which
macOS can't see, so they are read with docker top and keyed d:<container>:<pid>, so the VM's PIDs
never meet this Mac's (#211)."""
import importlib.util, os, sys, threading, time, unittest
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
