# SPDX-License-Identifier: GPL-3.0-or-later
"""Releases (issue #58): one version, in fleet_live.py, that the changelog, the app bundle and the packages
all use; a release script that refuses to run when they disagree, before it touches anything."""
import os, re, subprocess, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)


def version():
    return re.search(r'^VERSION = "([^"]+)"', open(os.path.join(LIVE, "fleet_live.py"), encoding="utf-8").read(), re.M).group(1)


class Release(unittest.TestCase):
    def test_the_first_release_is_0_0_1(self):
        self.assertEqual(version(), "0.0.1")

    def test_the_changelog_starts_with_this_version(self):
        log = open(os.path.join(LIVE, "CHANGELOG.md"), encoding="utf-8").read()
        first = re.search(r"^## Fleet (\S+)", log, re.M)
        self.assertIsNotNone(first, "a '## Fleet <version>' section")
        self.assertEqual(first.group(1), version())

    def test_the_bundle_and_packages_take_the_version_from_one_place(self):
        plist = open(os.path.join(LIVE, "packaging", "macos", "Info.plist"), encoding="utf-8").read()
        self.assertIn("<string>@VERSION@</string>", plist)
        for script in ("macos/build_macos.sh", "linux/build_linux.sh"):
            text = open(os.path.join(LIVE, "packaging", script), encoding="utf-8").read()
            self.assertRegex(text, r'VERSION=\$\(sed -n .*"\$LIVE/fleet_live.py"\)', script)

    def test_the_release_script_refuses_a_version_that_isnt_this_one(self):
        r = subprocess.run(["sh", os.path.join(LIVE, "packaging", "release.sh"), "9.9.9"], capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("VERSION in live/fleet_live.py is " + version(), r.stderr)
        self.assertNotIn("fleet-v9.9.9", subprocess.run(["git", "tag", "-l", "fleet-v9.9.9"], capture_output=True, text=True, cwd=LIVE).stdout)


if __name__ == "__main__":
    unittest.main()
