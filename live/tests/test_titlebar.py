# SPDX-License-Identifier: GPL-3.0-or-later
"""The Mac app's title bar: a click drags the window only on the space bar's empty parts, at any page
zoom (Cmd+ / Cmd-). The page reports its pills and buttons in CSS pixels; the window gets clicks in its
own points, which are CSS pixels times the zoom. The hit test lives in TitleBar.swift; this compiles it
with a small driver and runs it."""
import os, platform, shutil, subprocess, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)
SWIFT = os.path.join(LIVE, "packaging", "macos", "TitleBar.swift")

# The space bar as the page reports it (CSS px, top-left origin): the All machines pill, a pinned
# pill and the + button, in a 56 px band.
DRIVER = r'''
import Foundation
let regions = [NSRect(x: 46, y: 8, width: 122, height: 40), NSRect(x: 176, y: 8, width: 110, height: 40), NSRect(x: 297, y: 12, width: 30, height: 30)]
let clicks: [(CGFloat, CGFloat, CGFloat)] = [
    (310, 27, 1.0), (600, 27, 1.0), (310, 70, 1.0),
    (345, 27, 1.1), (172, 27, 1.1), (700, 27, 1.1), (700, 66, 1.1),
    (262, 25, 0.9), (280, 25, 0.9),
]
for (x, y, z) in clicks { print(titleBarDrags(NSPoint(x: x, y: y), band: 56, regions: regions, zoom: z) ? "drag" : "page") }
'''


@unittest.skipUnless(platform.system() == "Darwin" and shutil.which("swiftc"), "needs macOS and swiftc")
class TitleBar(unittest.TestCase):
    def test_clicks_reach_the_page_on_its_pills_and_buttons_at_every_zoom(self):
        with tempfile.TemporaryDirectory() as d:
            main = os.path.join(d, "main.swift")
            with open(main, "w") as f:
                f.write(DRIVER)
            exe = os.path.join(d, "titlebar")
            subprocess.run(["swiftc", "-o", exe, SWIFT, main], check=True, capture_output=True, timeout=300)
            out = subprocess.run([exe], check=True, capture_output=True, text=True, timeout=30).stdout.split()
        self.assertEqual(out, [
            "page", "drag", "page",            # 100%: on +, on empty bar, below the bar
            "page", "page", "drag", "page",    # 110%: + (drawn at 327-360 pt), the right end of All machines (172 pt = 156 px), empty bar, below the bar (56 px = 61.6 pt)
            "drag", "page",                    # 90%: the gap before + (262 pt = 291 px), then + itself (280 pt = 311 px)
        ])

    def test_the_app_builds_with_it(self):
        # the build script's own source list, typechecked (what a build compiles, without the build)
        r = subprocess.run(["sh", os.path.join(LIVE, "packaging", "macos", "build_macos.sh"), "--check"], capture_output=True, text=True, timeout=300)
        self.assertEqual((r.returncode, [l for l in r.stderr.splitlines() if "error:" in l]), (0, []))


if __name__ == "__main__":
    unittest.main()
