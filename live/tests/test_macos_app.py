# SPDX-License-Identifier: GPL-3.0-or-later
"""Fleet.app (live/packaging/macos/FleetApp.swift) and the page it shows: what the app calls in the page
must be there, and goes through the same checks as the page's own keys. Read from the sources: the app
itself is never started here (it would start a Fleet Live server)."""
import os, re, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)
SWIFT = open(os.path.join(LIVE, "packaging", "macos", "FleetApp.swift"), encoding="utf-8").read()
JS = open(os.path.join(LIVE, "web", "app.js"), encoding="utf-8").read()


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


if __name__ == "__main__":
    unittest.main()
