# SPDX-License-Identifier: GPL-3.0-or-later
"""#125: every Windows GPU is named by its own LUID. The GPU counters key each adapter by LUID; the collector
also sends DXGI's adapter list (LUID, name, VRAM size), so names, VRAM totals and nvidia-smi's numbers land
on the adapter they belong to, and GPUs are ordered by VRAM size, which doesn't change between readings.
Readings are hand-made in collect_windows.ps1's shape.

Run: python3 -m unittest discover -s live/tests -p 'test_*.py'   (or live/tests/run.sh)
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import fleet_live  # noqa: E402

MIB, GB = 1024 * 1024, 2 ** 30
L3090, LA2000, LIGPU, LAMD = "0x00000000_0x0000d1a3", "0x00000000_0x0000e4f2", "0x00000000_0x00010b7c", "0x00000000_0x00011c20"
# nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,utilization.memory,temperature.gpu,power.draw,
#   power.limit,clocks.gr,clocks.max.gr,clocks.mem,fan.speed,utilization.encoder,utilization.decoder
NV3090 = "0, NVIDIA GeForce RTX 3090, 3, 300, 24576, 1, 35, 25.50, 350.00, 210, 2100, 405, 30, 0, 0"
NVA2000 = "1, NVIDIA RTX A2000, 10, 1500, 6138, 5, 45, 15.20, 70.00, 600, 2100, 6000, 0, 0, 0"


def reading(gpus, adapters, nvidia=(), video=(), gproc=()):
    procs = [[pid, 4, name, 0.1, 1 << 20, 3, 0, "C:\\" + name] for pid, name in ((10, "python.exe"), (11, "dwm.exe"), (12, "explorer.exe"))]
    return {"t": 1000.0, "ncpu": 4, "lcpus": [{"n": n, "pct": 5.0, "mhz": 3000} for n in range(4)], "topo": [], "gpus": gpus,
            "adapters": adapters, "nvidia": list(nvidia), "videoNames": list(video), "gproc": list(gproc), "procs": procs, "ifs": [],
            "wsl": [], "containers": [], "dstats": [], "tasks": [], "mem": [16 << 30, 8 << 30], "diskBps": 0, "os": "Windows"}


def counted(luid, used, util, eng):
    return {"luid": luid, "util": util, "dedicated": used, "shared": 10 * MIB, "eng": eng}


def derive(r, m=None):
    return (m or fleet_live.Machine({"id": "w", "name": "w", "os": "windows"}, 3)).derive_windows(r)


def two_nvidia(a2000_used, rtx3090_used, order):
    """win-desktop's shape: an idle RTX 3090 (nvidia-smi index 0) beside an A2000 that drives the displays.
    The counters list adapters in `order`; DXGI lists the A2000 first (it has the primary display)."""
    c = {LA2000: counted(LA2000, a2000_used, 10.0, {"3D": 10.0}), L3090: counted(L3090, rtx3090_used, 3.0, {"Compute_0": 3.0})}
    return reading([c[x] for x in order],
                   [{"luid": "0x00000000_0x0000E4F2", "name": "NVIDIA RTX A2000", "vram": 6438256640.0},   # DXGI's LUID, upper case
                    {"luid": L3090, "name": "NVIDIA GeForce RTX 3090", "vram": 25390219264.0}],
                   nvidia=[NV3090, NVA2000], video=["NVIDIA RTX A2000", "NVIDIA GeForce RTX 3090"],
                   gproc=[[10, L3090, 3.0], [11, LA2000, 10.0]])


RTX3090 = {"name": "NVIDIA GeForce RTX 3090", "mem": "24 GB VRAM", "util": 3.0,
           "m": {"util": 3.0, "compute": 3.0, "vram": 300.0 * MIB, "shared": 10.0 * MIB, "memctl": 1.0, "temp": 35.0, "power": 25.5,
                 "clock": 210.0, "memclock": 405.0, "fan": 30.0, "encode": 0.0, "decode": 0.0, "3d": 0.0, "copy": 0.0},
           "lim": {"vram": 24576.0 * MIB, "power": 350.0, "clock": 2100.0}}
A2000 = {"name": "NVIDIA RTX A2000", "mem": "6 GB VRAM", "util": 10.0,
         "m": {"util": 10.0, "3d": 10.0, "vram": 1500.0 * MIB, "shared": 10.0 * MIB, "memctl": 5.0, "temp": 45.0, "power": 15.2,
               "clock": 600.0, "memclock": 6000.0, "fan": 0.0, "encode": 0.0, "decode": 0.0, "copy": 0.0},
         "lim": {"vram": 6138.0 * MIB, "power": 70.0, "clock": 2100.0}}


class NamedByLuid(unittest.TestCase):
    def test_each_adapter_gets_its_own_name_vram_and_nvidia_numbers(self):
        v = derive(two_nvidia(1500 * MIB, 300 * MIB, [LA2000, L3090]))   # the A2000 has more VRAM in use: the collector lists it first
        self.assertEqual(v["gpus"], [RTX3090, A2000])
        self.assertEqual({p[0]: p[13] for p in v["procs"]}, {10: [0], 11: [1], 12: []}, "each process on the GPU it runs on")
        self.assertEqual(v["host"][2], 13.0)
        self.assertEqual(v["cap"][2], 200.0)

    def test_the_order_holds_when_vram_use_crosses_over(self):
        m = fleet_live.Machine({"id": "w", "name": "w", "os": "windows"}, 3)
        first = derive(two_nvidia(1500 * MIB, 300 * MIB, [LA2000, L3090]), m)
        r = two_nvidia(1500 * MIB, 20000 * MIB, [L3090, LA2000])   # a job fills the 3090: now the collector lists it first
        r["t"] = 1003.0
        later = derive(r, m)
        shown = lambda v: [(g["name"], g["m"]["vram"] / MIB, g["m"]["temp"]) for g in v["gpus"]]
        self.assertEqual(shown(first), [("NVIDIA GeForce RTX 3090", 300.0, 35.0), ("NVIDIA RTX A2000", 1500.0, 45.0)])
        self.assertEqual(shown(later), [("NVIDIA GeForce RTX 3090", 20000.0, 35.0), ("NVIDIA RTX A2000", 1500.0, 45.0)])
        self.assertEqual({p[0]: p[13] for p in first["procs"]}, {10: [0], 11: [1], 12: []})
        self.assertEqual({p[0]: p[13] for p in later["procs"]}, {10: [0], 11: [1], 12: []})

    def test_amd_beside_an_intel_igpu_without_nvidia_smi(self):
        # Win32_VideoController lists the iGPU first; it has no dedicated memory in use, so the counters list only the AMD card.
        v = derive(reading([counted(LAMD, 2048 * MIB, 40.0, {"3D": 40.0, "Copy": 2.0})],
                           [{"luid": LIGPU, "name": "Intel(R) UHD Graphics 770", "vram": 134217728.0},
                            {"luid": LAMD, "name": "AMD Radeon RX 7900 XTX", "vram": 25753026560.0}],
                           video=["Intel(R) UHD Graphics 770", "AMD Radeon RX 7900 XTX"], gproc=[[10, LAMD, 40.0], [11, LIGPU, 5.0]]))
        self.assertEqual(v["gpus"], [{"name": "AMD Radeon RX 7900 XTX", "mem": "24 GB VRAM", "util": 40.0,
                                      "m": {"util": 40.0, "3d": 40.0, "copy": 2.0, "vram": 2048.0 * MIB, "shared": 10.0 * MIB, "encode": 0.0, "decode": 0.0},
                                      "lim": {"vram": 25753026560.0}}])
        self.assertEqual({p[0]: p[13] for p in v["procs"]}, {10: [0], 11: [], 12: []}, "the iGPU isn't one of this host's GPUs")

    def test_one_adapter_arrives_as_a_bare_object(self):
        # ConvertTo-Json writes a one-item array as the item itself.
        r = reading(counted(L3090, 300 * MIB, 3.0, {"Compute_0": 3.0}), {"luid": L3090, "name": "NVIDIA GeForce RTX 3090", "vram": 25390219264.0},
                    gproc=[[10, L3090, 3.0]])
        r["nvidia"], r["videoNames"] = NV3090, "NVIDIA GeForce RTX 3090"
        self.assertEqual(derive(r)["gpus"], [RTX3090])


LTWIN_A, LTWIN_B = "0x00000000_0x0000a001", "0x00000000_0x0000b002"
# Two RTX 3090s. nvidia-smi's GPU 0 (A) runs a training job; GPU 1 (B) drives the monitor, so DXGI lists B first.
NV_TWIN_A = "0, NVIDIA GeForce RTX 3090, 98, 20000, 24576, 60, 80, 350.00, 350.00, 1900, 2100, 9750, 85, 0, 0"
NV_TWIN_B = "1, NVIDIA GeForce RTX 3090, 5, 1500, 24576, 3, 45, 60.00, 350.00, 300, 2100, 405, 30, 0, 0"


def twins(a_used, b_used, nvidia=(NV_TWIN_A, NV_TWIN_B), t=1000.0):
    r = reading([counted(LTWIN_A, a_used, 98.0, {"Compute_0": 98.0}), counted(LTWIN_B, b_used, 5.0, {"3D": 5.0})],
                [{"luid": LTWIN_B, "name": "NVIDIA GeForce RTX 3090", "vram": 25390219264.0},
                 {"luid": LTWIN_A, "name": "NVIDIA GeForce RTX 3090", "vram": 25390219264.0}],
                nvidia=nvidia, video=["NVIDIA GeForce RTX 3090", "NVIDIA GeForce RTX 3090"], gproc=[[10, LTWIN_A, 98.0], [11, LTWIN_B, 5.0]])
    r["t"] = t
    return r


def nv_shown(v):
    """Each GPU, in Fleet's order: its name, VRAM in use (MiB, from the counters) and nvidia-smi's temperature and power."""
    return [(g["name"], g["m"]["vram"] / MIB, g["m"].get("temp"), g["m"].get("power")) for g in v["gpus"]]


class IdenticalCards(unittest.TestCase):
    """#307: two cards of one model have one name, and DXGI's order (the primary display's adapter first) needn't be
    nvidia-smi's. Each nvidia-smi row goes to the adapter whose dedicated VRAM in use is its memory.used (WDDM reports
    one number to both); when that can't tell them apart, the pairing the last reading found holds."""

    def test_the_card_driving_the_monitor_is_nvidia_smis_gpu_1(self):
        v = derive(twins(20000 * MIB, 1500 * MIB))
        self.assertEqual(nv_shown(v), [("NVIDIA GeForce RTX 3090", 1500.0, 45.0, 60.0), ("NVIDIA GeForce RTX 3090", 20000.0, 80.0, 350.0)])
        self.assertEqual({p[0]: p[13] for p in v["procs"]}, {10: [1], 11: [0], 12: []}, "the training job on its own card, GPU 1")

    def test_the_pairing_holds_when_their_use_is_the_same(self):
        m = fleet_live.Machine({"id": "w", "name": "w", "os": "windows"}, 3)
        derive(twins(20000 * MIB, 1500 * MIB), m)
        # the job ends: both cards hold 1500 MiB; A cools down, and nvidia-smi still calls it GPU 0
        later = derive(twins(1500 * MIB, 1500 * MIB, nvidia=(NV_TWIN_A.replace(", 20000,", ", 1500,").replace(", 80,", ", 50,"), NV_TWIN_B),
                             t=1003.0), m)
        self.assertEqual(nv_shown(later), [("NVIDIA GeForce RTX 3090", 1500.0, 45.0, 60.0), ("NVIDIA GeForce RTX 3090", 1500.0, 50.0, 350.0)])

    def test_cards_that_nothing_tells_apart_pair_in_order(self):
        # the control: the first reading, both cards alike: DXGI's first takes nvidia-smi's first, as before
        v = derive(twins(1500 * MIB, 1500 * MIB, nvidia=(NV_TWIN_A.replace(", 20000,", ", 1500,"), NV_TWIN_B)))
        self.assertEqual(nv_shown(v), [("NVIDIA GeForce RTX 3090", 1500.0, 80.0, 350.0), ("NVIDIA GeForce RTX 3090", 1500.0, 45.0, 60.0)])


class NamesWithoutTheVendor(unittest.TestCase):
    """#307: older GeForce and Quadro drivers name a card without "NVIDIA " in nvidia-smi, while Windows' adapter name has
    it; they are one card. Another model is still another card."""
    L1080, LP2000 = "0x00000000_0x0000c003", "0x00000000_0x0000c004"

    def test_older_drivers(self):
        r = reading([counted(self.L1080, 2000 * MIB, 40.0, {"3D": 40.0}), counted(self.LP2000, 500 * MIB, 2.0, {"3D": 2.0})],
                    [{"luid": self.L1080, "name": "NVIDIA GeForce GTX 1080", "vram": 8589934592.0},
                     {"luid": self.LP2000, "name": "NVIDIA Quadro P2000", "vram": 5368709120.0}],
                    nvidia=["0, GeForce GTX 1080, 40, 2000, 8192, 20, 70, 120.00, 180.00, 1600, 1900, 5000, 50, 0, 0",
                            "1, Quadro P2000, 2, 500, 5120, 1, 40, 18.00, 75.00, 300, 1480, 3500, 30, 0, 0"])
        self.assertEqual(nv_shown(derive(r)), [("NVIDIA GeForce GTX 1080", 2000.0, 70.0, 120.0), ("NVIDIA Quadro P2000", 500.0, 40.0, 18.0)])

    def test_another_model_is_not_this_card(self):
        r = reading([counted(self.L1080, 2000 * MIB, 40.0, {"3D": 40.0})],
                    [{"luid": self.L1080, "name": "NVIDIA GeForce GTX 1080 Ti", "vram": 11811160064.0}],
                    nvidia=["0, GeForce GTX 1080, 40, 2000, 8192, 20, 70, 120.00, 180.00, 1600, 1900, 5000, 50, 0, 0"])
        self.assertEqual(nv_shown(derive(r)), [("NVIDIA GeForce GTX 1080 Ti", 2000.0, None, None)])


class WithoutAdapterList(unittest.TestCase):
    """DXGI couldn't be read: a name or nvidia-smi row is used only where it can't belong to another adapter."""

    def test_two_adapters_are_not_named_by_position(self):
        r = two_nvidia(1500 * MIB, 300 * MIB, [LA2000, L3090])
        r["adapters"] = []
        v = derive(r)
        self.assertEqual([(g["name"], g["mem"], g["lim"]) for g in v["gpus"]], [("GPU 0", "", {}), ("GPU 1", "", {})])
        self.assertEqual([g["m"]["vram"] for g in v["gpus"]], [300.0 * MIB, 1500.0 * MIB], "a stable order: by LUID")
        self.assertNotIn("temp", v["gpus"][0]["m"])
        self.assertNotIn("temp", v["gpus"][1]["m"])
        self.assertEqual({p[0]: p[13] for p in v["procs"]}, {10: [0], 11: [1], 12: []})

    def test_a_lone_adapter_takes_the_lone_nvidia_row(self):
        r = reading([counted(L3090, 300 * MIB, 3.0, {"Compute_0": 3.0})], [], nvidia=[NV3090],
                    video=["NVIDIA GeForce RTX 3090", "Microsoft Remote Display Adapter"], gproc=[[10, L3090, 3.0]])
        self.assertEqual(derive(r)["gpus"], [RTX3090])

    def test_a_lone_adapter_without_nvidia_smi_takes_a_lone_video_name(self):
        r = reading([counted(LAMD, 2048 * MIB, 40.0, {"3D": 40.0})], [], video=["AMD Radeon RX 7900 XTX"], gproc=[[10, LAMD, 40.0]])
        self.assertEqual([(g["name"], g["mem"]) for g in derive(r)["gpus"]], [("AMD Radeon RX 7900 XTX", "")])
        r["videoNames"] = ["AMD Radeon RX 7900 XTX", "Parsec Virtual Display Adapter"]
        self.assertEqual([(g["name"], g["mem"]) for g in derive(r)["gpus"]], [("GPU 0", "")], "two names: either could be it")

    def test_no_gpu(self):
        v = derive(reading([], [], video=["Microsoft Basic Display Adapter"]))
        self.assertEqual((v["gpus"], v["gpu_procs"], v["cap"][2]), ([], False, 0.0))


class Collector(unittest.TestCase):
    """collect_windows.ps1 sends DXGI's adapter list, with each LUID written the way the GPU counters write it."""

    def test_the_collector_reads_dxgi_and_sends_adapters(self):
        src = open(os.path.join(os.path.dirname(fleet_live.__file__), "collect_windows.ps1"), encoding="utf-8").read()
        has = {k: k in src for k in ("CreateDXGIFactory1", '"0x{0:x8}_0x{1:x8}|{2}|{3}"', "$o.adapters = $adapters", "Sort-Object { - $adMem[$_] }")}
        self.assertEqual(has, {"CreateDXGIFactory1": True, '"0x{0:x8}_0x{1:x8}|{2}|{3}"': True, "$o.adapters = $adapters": True,
                               "Sort-Object { - $adMem[$_] }": False}, "the server orders GPUs, by VRAM size")


if __name__ == "__main__":
    unittest.main()
