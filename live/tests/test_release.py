# SPDX-License-Identifier: GPL-3.0-or-later
"""Releases (issue #58): one version, in fleet_live.py, that the changelog, the app bundle and the packages
all use; a release script that refuses to run when they disagree, before it touches anything."""
import os, re, shutil, subprocess, sys, unittest

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


class Packages(unittest.TestCase):
    """#226: a release publishes macOS arm64, Linux x64 and Linux arm64."""
    def test_a_release_publishes_mac_arm64_linux_x64_and_linux_arm64(self):
        text = open(os.path.join(LIVE, "packaging", "release.sh"), encoding="utf-8").read()
        line = [l for l in text.splitlines() if l.strip().startswith("gh release create")][0]
        self.assertEqual(line.split()[4:7], ['"$MAC"', '"$LINUX_X64"', '"$LINUX_ARM64"'])
        self.assertIn('MAC="$LIVE/dist/Fleet-$WANT-macos-arm64.zip"', text)
        self.assertIn('LINUX_X64="$LIVE/dist/fleet-$WANT-linux-x64.tar.gz"', text)
        self.assertIn('LINUX_ARM64="$LIVE/dist/fleet-$WANT-linux-arm64.tar.gz"', text)
        self.assertIn('"$HERE/macos/build_macos.sh" --arch arm64', text)

    @unittest.skipUnless(sys.platform == "darwin" and shutil.which("swiftc"), "needs macOS and swiftc")
    def test_the_mac_build_takes_one_architecture(self):
        r = subprocess.run(["sh", os.path.join(LIVE, "packaging", "macos", "build_macos.sh"), "--arch", "arm64", "--check"], capture_output=True, text=True, timeout=300)
        self.assertEqual((r.returncode, [l for l in r.stderr.splitlines() if "error" in l.lower()]), (0, []))


if __name__ == "__main__":
    unittest.main()
