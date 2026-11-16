# SPDX-License-Identifier: GPL-3.0-or-later
"""Fleet.app (live/packaging/macos/FleetApp.swift) and the page it shows: what the app calls in the page
must be there, and goes through the same checks as the page's own keys. Read from the sources, and the
app's plain functions compiled on their own with test inputs: the app itself is never started here (it
would start a Fleet Live server)."""
import os, re, shutil, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)
SWIFT = open(os.path.join(LIVE, "packaging", "macos", "FleetApp.swift"), encoding="utf-8").read()
JS = open(os.path.join(LIVE, "web", "app.js"), encoding="utf-8").read()
SWIFTC = shutil.which("swiftc") if sys.platform == "darwin" else None


def func(name):
    """The Swift source of one func of the app, to the brace that closes it."""
    m = re.search(r"func %s\(" % re.escape(name), SWIFT)
    if not m:
        return ""
    depth, i = 0, SWIFT.index("{", m.end())
    for j in range(i, len(SWIFT)):
        depth += {"{": 1, "}": -1}.get(SWIFT[j], 0)
        if depth == 0:
            return SWIFT[m.start():j + 1]
    return ""


class PageHooks(unittest.TestCase):
    def test_every_page_function_the_app_calls_is_there(self):
        called = sorted(set(re.findall(r"window\.(\w+) && window\.\1\(", SWIFT)))
        self.assertTrue(called)
        self.assertEqual([f for f in called if not re.search(r"^window\.%s = " % f, JS, re.M)], [])

    def test_menu_items_are_refused_where_the_keys_are(self):
        # #187: a key the page leaves alone (Settings open, ⌘T while typing) goes on to the menu item
        self.assertIn("window.fleetMenu && window.fleetMenu(", func("pageCommand"))
        self.assertNotIn("fleetCommand", SWIFT)

    def test_the_page_knows_the_text_size(self):
        # #189: a CSS px is pageZoom points; told the zoom, the page reports its title bar in points
        self.assertIn("window.fleetNativeZoom && window.fleetNativeZoom(\\(Double(web.pageZoom)))", func("tellZoom"))
        self.assertIn("tellZoom()", func("zoom"))
        self.assertRegex(SWIFT, r"didFinish n: WKNavigation!\) \{[^\n]*tellZoom\(\)")



def swift_run(funcs, main):
    """Compile the app's `funcs` with `main` (Foundation only) and run it: its output."""
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "main.swift")
        with open(src, "w", encoding="utf-8") as f:
            f.write("import Foundation\n" + "\n".join(func(n) for n in funcs) + "\n" + main + "\n")
        r = subprocess.run([SWIFTC, "-o", os.path.join(tmp, "t"), src], capture_output=True, text=True)
        if r.returncode:
            raise AssertionError("doesn't compile: " + r.stderr[-600:])
        return subprocess.run([os.path.join(tmp, "t")], capture_output=True, text=True, check=True).stdout


class ServerStops(unittest.TestCase):
    """#190: the server Fleet.app started stops on its own (machines.toml it can't read, the port taken, a
    crash): the app says so, with the end of Fleet.log, instead of reloading an empty window forever."""
    def test_the_app_hears_when_its_server_stops(self):
        self.assertRegex(func("startServer"), r"p\.terminationHandler = \{[^}]*self\.serverStopped\(")

    def test_it_says_why_and_offers_to_start_again(self):
        f = func("serverStopped")
        self.assertIn("guard !quitting, p === server", f)
        self.assertIn("if serverAnswers() { server = nil; return }", f)   # another Fleet Live took over: use it
        self.assertIn("NSAlert()", f)
        self.assertIn("logTail(", f)
        self.assertIn("startServer()", f)
        self.assertIn("NSApp.terminate(nil)", f)

    def test_quitting_stops_it_without_saying_so(self):
        f = func("applicationWillTerminate")
        self.assertIn("quitting = true", f)
        self.assertLess(f.index("quitting = true"), f.index("p.terminate()"))


@unittest.skipUnless(SWIFTC, "needs the Swift compiler (Xcode's command line tools) on a Mac")
class Compiled(unittest.TestCase):
    def test_the_app_compiles(self):
        r = subprocess.run([SWIFTC, "-typecheck", os.path.join(LIVE, "packaging", "macos", "FleetApp.swift")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr[-2000:])

    def test_the_alert_shows_the_end_of_the_log(self):
        log = "Fleet Live on http://127.0.0.1:4518/\nTraceback (most recent call last):\n  File \"fleet_live.py\", line 2004, in main\n\n" \
              "    cfg = tomllib.load(f)\ntomllib.TOMLDecodeError: Expected '=' after a key in a key/value pair (at line 3, column 5)\n\n"
        out = swift_run(["logTail"], "print(logTail(%s, lines: 3))\nprint(logTail(\"\", lines: 3).isEmpty)" % swift_str(log))
        self.assertEqual(out, "  File \"fleet_live.py\", line 2004, in main\n    cfg = tomllib.load(f)\n"
                              "tomllib.TOMLDecodeError: Expected '=' after a key in a key/value pair (at line 3, column 5)\ntrue\n")


def swift_str(s):
    """A Swift string literal of s."""
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


if __name__ == "__main__":
    unittest.main()
