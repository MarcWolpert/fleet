# SPDX-License-Identifier: GPL-3.0-or-later
"""Docker Desktop on a Mac runs containers in its own Linux VM. Fleet lists the containers directly
(docker stats) and folds that VM into Base system, so it must recognise the VM however Docker started
it: as its child (older versions), or, with Apple's Virtualization framework, as an XPC service under
launchd that macOS holds Docker responsible for (#210)."""
import importlib.util, os, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)
argv, sys.argv = sys.argv, ["fleet_live.py"]
try:
    spec = importlib.util.spec_from_file_location("fleet_live_dd_test", os.path.join(LIVE, "fleet_live.py"))
    fl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fl)
finally:
    sys.argv = argv

VZ = "/System/Library/Frameworks/Virtualization.framework/Versions/A/XPCServices/com.apple.Virtualization.VirtualMachine.xpc/Contents/MacOS/com.apple.Virtualization.VirtualMachine"


def row(pid, ppid, cmd):
    # the Mac reader's process rows: p[0] pid, p[1] ppid, p[10] command line, p[11] owner
    return [pid, ppid, os.path.basename(cmd.split()[0]), "u", "S", 0.0, 0.0, 0, 0.0, 1, cmd, ""]


PROCS = [row(1, 0, "/sbin/launchd"),
         row(72496, 1, "/Applications/Docker.app/Contents/MacOS/com.docker.backend"),
         row(72527, 72496, "/Applications/Docker.app/Contents/MacOS/com.docker.virtualization --kernel x"),
         row(72530, 1, VZ),                                         # Docker's VM, an XPC service under launchd
         row(800, 1, "/Applications/UTM.app/Contents/MacOS/UTM"),
         row(801, 1, VZ),                                           # a UTM VM, the same kind of process
         row(900, 72496, "/usr/local/bin/qemu-system-aarch64 -name docker")]   # an older Docker: its own child
BY_PID = {p[0]: p for p in PROCS}


class DockerDesktopVm(unittest.TestCase):
    def test_docker_s_vm_however_it_was_started_and_no_other(self):
        is_dvm = fl.MacCollector.is_docker_vm
        self.assertTrue(is_dvm(BY_PID[72530], BY_PID, 72496), "an XPC service macOS holds Docker responsible for")
        self.assertTrue(is_dvm(BY_PID[900], BY_PID, 0), "Docker's own child")
        self.assertFalse(is_dvm(BY_PID[72530], BY_PID, 0), "nothing ties it to Docker")
        self.assertFalse(is_dvm(BY_PID[801], BY_PID, 800), "UTM's VM is a VM")

    def test_who_macos_holds_responsible(self):
        if sys.platform != "darwin":
            self.skipTest("macOS only")
        self.assertGreater(fl.MacCollector.responsible_pid(os.getpid()), 0)
        self.assertEqual(fl.MacCollector.responsible_pid(-5), 0)


if __name__ == "__main__":
    unittest.main()
