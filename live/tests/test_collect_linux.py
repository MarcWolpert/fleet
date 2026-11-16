# SPDX-License-Identifier: GPL-3.0-or-later
"""collect_linux.py's parts that keep state between readings, fed hand-made command output in the shape
the real commands print (nothing is run and no machine is read). The collector's functions are loaded
without its loop.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)


def load_collector():
    """collect_linux.py up to its loop, as a namespace (a fresh one each time: no state carries over)."""
    path = os.path.join(LIVE, "collect_linux.py")
    src = open(path, encoding="utf-8").read()
    ns = {"__name__": "collect_linux_test"}
    exec(compile(src[:src.index("\ntry:\n    INTERVAL")], path, "exec"), ns)
    return ns


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
        c = load_collector()
        got = []
        for text, live in steps:
            c["run"] = lambda cmd, timeout=8, text=text: text if cmd[0] == "ss" else ""
            procs = [[pid, 1, "x", "S", 0, 0, 1, "root", 0, "", "", "", "x", 0] for pid in live]
            got.append({pid: (u["ifs"], u["b"]) for pid, u in c["net_users"](IFADDR, procs).items()})
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
