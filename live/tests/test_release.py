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

    @unittest.skipUnless(sys.platform == "darwin" and shutil.which("swiftc"), "needs macOS and swiftc")
    def test_the_mac_build_works_from_a_folder_with_a_space_in_its_name(self):
        # a checkout under "My Code", and a TMPDIR with a space: --check, and a whole build, app and zip
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            repo, work = os.path.join(tmp, "My Code"), os.path.join(tmp, "tmp dir")
            live = os.path.join(repo, "live")
            os.makedirs(os.path.join(live, "web")); os.makedirs(os.path.join(live, "packaging", "icon")); os.makedirs(work)
            shutil.copy(os.path.join(os.path.dirname(LIVE), "COPYING"), repo)
            shutil.copytree(os.path.join(LIVE, "packaging", "macos"), os.path.join(live, "packaging", "macos"))
            shutil.copy(os.path.join(LIVE, "packaging", "icon", "Fleet.icns"), os.path.join(live, "packaging", "icon"))
            for f in ("fleet_live.py", "collect_linux.py", "collect_windows.ps1", "inspect_linux.py", "inspect_windows.ps1", "machines.example.toml"):
                shutil.copy(os.path.join(LIVE, f), live)
            for f in ("index.html", "app.js", "themes.js", "icon.svg"):
                shutil.copy(os.path.join(LIVE, "web", f), os.path.join(live, "web"))
            shutil.copytree(os.path.join(LIVE, "web", "fonts"), os.path.join(live, "web", "fonts"))   # the terminals' symbols font (#387)
            build = os.path.join(live, "packaging", "macos", "build_macos.sh")
            env = dict(os.environ, TMPDIR=work)
            r = subprocess.run(["sh", build, "--arch", "arm64", "--check"], capture_output=True, text=True, timeout=300, env=env)
            self.assertEqual((r.returncode, [l for l in r.stderr.splitlines() if "error" in l.lower()]), (0, []), "--check")
            r = subprocess.run(["sh", build, "--arch", "arm64"], capture_output=True, text=True, timeout=600, env=env)
            self.assertEqual(r.returncode, 0, r.stderr)
            # the zip opens to a folder: the app, its README and the script that installs it (#361)
            zips = [f for f in os.listdir(os.path.join(live, "dist")) if f.endswith("-macos-arm64.zip")]
            names = subprocess.run(["zipinfo", "-1", os.path.join(live, "dist", zips[0])], capture_output=True, text=True).stdout.splitlines()
            top = names[0].split("/")[0]
            for want in ("Fleet.app/Contents/MacOS/Fleet", "README.txt", "Install Fleet.command"):
                self.assertIn(top + "/" + want, names)
            self.assertTrue(top.startswith("Fleet-"), top)
            app = os.path.join(live, "dist", "Fleet.app", "Contents", "MacOS", "Fleet")
            self.assertEqual(subprocess.run(["lipo", "-archs", app], capture_output=True, text=True).stdout.split(), ["arm64"])
            self.assertEqual(sorted(os.listdir(os.path.join(live, "dist"))), ["Fleet-%s-macos-arm64.zip" % version(), "Fleet.app"])
            self.assertEqual(os.listdir(work), [], "the build cleans up after itself")


class ReleaseNotes(unittest.TestCase):
    """The changelog section becomes the release notes word for word, so it promises only the Macs the release
    builds for, and the release script and RELEASING.md count the packages it publishes."""
    RELEASE = os.path.join(LIVE, "packaging", "release.sh")
    RELEASING = os.path.join(os.path.dirname(LIVE), "docs", "fleet", "RELEASING.md")
    MACS = {"arm64": "Apple silicon", "x86_64": "Intel"}
    COUNT = {2: "two", 3: "three", 4: "four"}

    def notes(self):
        # the section release.sh passes to gh as --notes-file
        log = open(os.path.join(LIVE, "CHANGELOG.md"), encoding="utf-8").read().splitlines()
        start = log.index("## Fleet " + version()) + 1
        end = next((i for i in range(start, len(log)) if log[i].startswith("## ")), len(log))
        return " ".join(log[start:end])

    def assets(self):
        text = open(self.RELEASE, encoding="utf-8").read()
        line = [l for l in text.splitlines() if l.strip().startswith("gh release create")][0]
        # gh release create "$TAG" <the files> --title …
        return [w for w in line.split()[4:] if w.startswith('"$') and not w.startswith('"$NOTES')]

    def test_the_notes_name_exactly_the_macs_the_release_builds_for(self):
        text = open(self.RELEASE, encoding="utf-8").read()
        built = set(re.findall(r'build_macos\.sh" --arch (\w+)', text))
        self.assertEqual(built, {"arm64"})
        m = re.search(r"For macOS \(Fleet\.app, ([^)]*)\)", self.notes())
        self.assertIsNotNone(m, "the notes say which Macs Fleet.app runs on")
        self.assertEqual(set(x.strip() for x in re.split(r",| and ", m.group(1))), {self.MACS[a] for a in built})

    def test_the_script_and_releasing_md_count_the_packages_a_release_publishes(self):
        n = len(self.assets())
        self.assertEqual(n, 3)
        said = []
        for path in (self.RELEASE, self.RELEASING):
            text = open(path, encoding="utf-8").read()
            said += [(os.path.basename(path), w.lower()) for w in re.findall(r"\b(both|two|three|four)\s+packages\b", text, re.I)]
        self.assertTrue(said, "they say how many packages a release has")
        self.assertEqual([w for _, w in said if w != self.COUNT[n]], [], said)


class MacInstall(unittest.TestCase):
    """The release's Fleet.app is signed ad hoc and isn't notarized, so a downloaded copy is quarantined and
    Gatekeeper stops its first launch: the README's Install row for macOS says how to get past that."""
    def test_the_readme_says_how_to_open_the_app_gatekeeper_stops(self):
        build = open(os.path.join(LIVE, "packaging", "macos", "build_macos.sh"), encoding="utf-8").read()
        release = open(os.path.join(LIVE, "packaging", "release.sh"), encoding="utf-8").read()
        self.assertRegex(build, r"codesign [^\n]*--sign - ", "signed ad hoc")
        self.assertFalse(any(w in build + release for w in ("notarytool", "stapler")), "not notarized (if it is, this row needs no help)")
        readme = open(os.path.join(os.path.dirname(LIVE), "README.md"), encoding="utf-8").read().splitlines()
        rows = [l for l in readme if l.startswith("| **macOS** (Apple silicon) |")]
        self.assertEqual(len(rows), 1, "one macOS row in Install")
        for words in ("isn't notarized", "System Settings › Privacy & Security", "Open Anyway", "xattr -dr com.apple.quarantine /Applications/Fleet.app"):
            self.assertIn(words, rows[0])


if __name__ == "__main__":
    unittest.main()
