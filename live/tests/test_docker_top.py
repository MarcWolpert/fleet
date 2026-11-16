# SPDX-License-Identifier: GPL-3.0-or-later
"""Details for a container on Docker Desktop (a Mac): its processes run in Docker's Linux VM, which
macOS can't see, so they are read with docker top and keyed d:<container>:<pid>, so the VM's PIDs
never meet this Mac's (#211)."""
import importlib.util, os, sys, unittest

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


if __name__ == "__main__":
    unittest.main()
