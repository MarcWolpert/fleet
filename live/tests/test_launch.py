# SPDX-License-Identifier: GPL-3.0-or-later
"""Opening Fleet again (issue #186): `fleet` and `fleet-live` run fleet_live.py --open, and closing the window
leaves its server running. When a Fleet Live already answers on the port, --open opens a window on it and
exits, before it reads the config, stops leftover collectors or starts any. Nothing here reads a machine:
the server's parts are stand-ins, and the Fleet that answers is a stub on a free port."""
import http.server, importlib.util, json, os, signal, sys, tempfile, threading, unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)
argv, sys.argv = sys.argv, ["fleet_live.py"]
try:
    spec = importlib.util.spec_from_file_location("fleet_live_launch_test", os.path.join(LIVE, "fleet_live.py"))
    fl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fl)
finally:
    sys.argv = argv


def stub(status):
    """A server on a free port that answers /api/fleet with `status`; returns (port, stop)."""
    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps({"machines": []}).encode() if status == 200 else b""
            self.send_response(status if self.path == "/api/fleet" else 404)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def log_message(self, *a):
            pass
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_address[1], lambda: (srv.shutdown(), srv.server_close())


def free_port():
    srv = http.server.HTTPServer(("127.0.0.1", 0), http.server.BaseHTTPRequestHandler)
    port = srv.server_address[1]
    srv.server_close()
    return port


class Launch(unittest.TestCase):
    def run_main(self, port):
        """main() with --open on `port`: returns what it did, with every part that would start something stood in for."""
        did = []
        with tempfile.TemporaryDirectory() as tmp:
            cfg = os.path.join(tmp, "machines.toml")
            with open(cfg, "w") as f:
                f.write("interval = 3\n")
            srv = mock.MagicMock()
            srv.serve_forever.side_effect = lambda: did.append("serve")
            with mock.patch.object(sys, "argv", ["fleet_live.py", "--port", str(port), "--config", cfg, "--open", "--no-watch"]), \
                 mock.patch.object(fl, "open_app_window", side_effect=lambda u: did.append("window " + u)), \
                 mock.patch.object(fl, "reap_leftover_collectors", side_effect=lambda: did.append("reap") or 0), \
                 mock.patch.object(fl, "Fleet", side_effect=lambda c: did.append("fleet")), \
                 mock.patch.object(fl.http.server, "ThreadingHTTPServer", side_effect=lambda a, h: did.append("bind %d" % a[1]) or srv), \
                 mock.patch.object(signal, "signal"):
                fl.main()
        return did

    def test_a_running_fleet_gets_a_window_and_nothing_starts(self):
        port, stop = stub(200)
        try:
            self.assertEqual(self.run_main(port), ["window http://127.0.0.1:%d/" % port])
        finally:
            stop()

    def test_with_no_fleet_on_the_port_it_starts_its_own(self):
        port = free_port()
        self.assertEqual(self.run_main(port), ["reap", "fleet", "bind %d" % port, "window http://127.0.0.1:%d/" % port, "serve"])

    def test_something_else_on_the_port_is_not_a_fleet(self):
        port, stop = stub(404)
        try:
            self.assertEqual(self.run_main(port), ["reap", "fleet", "bind %d" % port, "window http://127.0.0.1:%d/" % port, "serve"])
        finally:
            stop()


if __name__ == "__main__":
    unittest.main()
