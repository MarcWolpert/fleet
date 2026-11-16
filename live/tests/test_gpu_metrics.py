# SPDX-License-Identifier: GPL-3.0-or-later
"""Every GPU's own metrics (issue #6): engines, memory, temperature, power, clocks, fan, from each
vendor and OS, as one shape: g["m"] = {metric: value}, g["lim"] = {metric: its maximum}.
Inputs are recorded from real machines (an Intel Arc A310 on i915, an RTX 3090 on Windows, an M5
Max Mac) plus an AMD card shaped like amdgpu's sysfs. Every assertion is the exact set."""
import importlib.util, os, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(HERE)
argv, sys.argv = sys.argv, ["fleet_live.py"]
try:
    spec = importlib.util.spec_from_file_location("fleet_live_gpu_test", os.path.join(LIVE, "fleet_live.py"))
    fl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fl)
finally:
    sys.argv = argv

MIB = 1024 * 1024
ARC = {"card": "card1", "pdev": "0000:03:00.0", "driver": "i915", "vendor": "Intel", "name": "Intel Arc A310", "mhz": 2000, "maxmhz": 2450,
       "busy": -1, "vram": [0, 0], "hwmon": {"temp": 54000, "energy": 3415581429382, "fan": 4286, "power_max": 31250000}}
AMD = {"card": "card2", "pdev": "0000:0a:00.0", "driver": "amdgpu", "vendor": "AMD", "name": "AMD Radeon RX 6600", "mhz": 2044, "maxmhz": 2491,
       "busy": 37, "vram": [8 * 1024 * MIB, 2 * 1024 * MIB], "memmhz": 875, "hwmon": {"temp": 61000, "power": 85000000, "fan": 1500, "power_max": 100000000}}
# nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,pci.bus_id,utilization.memory,temperature.gpu,
#   power.draw,power.limit,clocks.gr,clocks.max.gr,clocks.mem,fan.speed,utilization.encoder,utilization.decoder
NV = {"index": 0, "name": "NVIDIA RTX A4000", "util": 41.0, "memUsed": 1654.0, "memTotal": 16376.0, "pdev": "0000:83:00.0",
      "memUtil": 3.0, "temp": 47.0, "power": 36.7, "powerLimit": 140.0, "clock": 1410.0, "clockMax": 1950.0, "memClock": 7000.0, "fan": 30.0,
      "enc": 4.0, "dec": 12.0}


def machine():
    return fl.Machine({"id": "t", "name": "t", "kind": "local"}, 3)


class LinuxGpus(unittest.TestCase):
    def reading(self, t, energy, eng):
        arc = dict(ARC, hwmon=dict(ARC["hwmon"], energy=energy))
        return {"drm": [arc, AMD], "gpus": [NV],
                "gclients": [[500, ARC["pdev"], "7", eng, {"render": 1, "copy": 1, "video": 2, "video-enhance": 1}, 0],
                             [600, AMD["pdev"], "3", {"gfx": eng["render"] * 2, "dma": 0, "dec": eng["video"]}, {"gfx": 1, "dma": 1, "dec": 1}, 0]]}

    def test_each_vendor_reports_its_own_metrics_and_limits(self):
        m = machine()
        m.linux_gpus(self.reading(100.0, 3415581429382, {"render": 0, "copy": 0, "video": 0, "video-enhance": 0}), 100.0)
        # 3 s later: the Arc used 24 J (8 W), render busy 1.5 s (50%), video 0.6 s over 2 engines (10%)
        gpus, _ = m.linux_gpus(self.reading(103.0, 3415581429382 + 24000000, {"render": 1.5e9, "copy": 0.3e9, "video": 0.6e9, "video-enhance": 0}), 103.0)
        arc, amd, nv = gpus
        self.assertEqual({k: round(v, 3) for k, v in arc["m"].items()},
                         {"util": 50.0, "3d": 50.0, "copy": 10.0, "video": 10.0, "vpp": 0.0, "temp": 54.0, "power": 8.0, "clock": 2000.0, "fanrpm": 4286.0})
        self.assertEqual(arc["lim"], {"power": 31.25, "clock": 2450.0})
        self.assertEqual({k: round(v, 3) for k, v in amd["m"].items()},
                         {"util": 100.0, "3d": 100.0, "compute": 0.0, "copy": 0.0, "encode": 0.0, "decode": 20.0, "vram": 2 * 1024 * MIB, "temp": 61.0, "power": 85.0,
                          "clock": 2044.0, "memclock": 875.0, "fanrpm": 1500.0})
        self.assertEqual(amd["lim"], {"vram": 8 * 1024 * MIB, "power": 100.0, "clock": 2491.0})
        self.assertEqual(nv["m"], {"util": 41.0, "memctl": 3.0, "encode": 4.0, "decode": 12.0, "vram": 1654 * MIB, "temp": 47.0, "power": 36.7,
                                   "clock": 1410.0, "memclock": 7000.0, "fan": 30.0})
        self.assertEqual(nv["lim"], {"vram": 16376 * MIB, "power": 140.0, "clock": 1950.0})

    def test_an_old_driver_without_the_extra_fields(self):
        old = {k: NV[k] for k in ("index", "name", "util", "memUsed", "memTotal", "pdev")}
        gpus, _ = machine().linux_gpus({"drm": [], "gpus": [old], "gclients": []}, 100.0)
        self.assertEqual(gpus[0]["m"], {"util": 41.0, "vram": 1654 * MIB})
        self.assertEqual(gpus[0]["lim"], {"vram": 16376 * MIB})

    def test_a_passed_through_gpu_reports_nothing_of_its_own(self):
        pt = {"card": "", "pdev": "0000:84:00.0", "driver": "vfio-pci", "vendor": "NVIDIA", "name": "NVIDIA RTX 3060", "mhz": 0, "maxmhz": 0,
              "busy": -1, "vram": [0, 0], "passthrough": True}
        gpus, _ = machine().linux_gpus({"drm": [pt], "gpus": [], "gclients": []}, 100.0)
        self.assertEqual((gpus[0]["m"], gpus[0]["lim"]), ({}, {}))


class IdleGpus(unittest.TestCase):
    def test_an_idle_gpu_still_lists_its_engines_and_clock(self):
        idle = dict(ARC, mhz=0, hwmon={})
        gpus, _ = machine().linux_gpus({"drm": [idle], "gpus": [], "gclients": []}, 100.0)
        self.assertEqual(gpus[0]["m"], {"util": 0.0, "3d": 0.0, "copy": 0.0, "video": 0.0, "vpp": 0.0, "clock": 0.0})
        self.assertEqual(gpus[0]["lim"], {"clock": 2450.0})

    def test_windows_without_engine_instances_uses_nvidia_smi_encoder_and_decoder(self):
        r = {"gpus": [{"luid": "0x0_0x1", "util": 0.0, "dedicated": 1, "shared": 0, "eng": {}}],
             "nvidia": ["0, NVIDIA GeForce RTX 3090, 0, 1654, 24576, 3, 27, 36.70, 350.00, 210, 2100, 405, 0, 6, 11"], "videoNames": [], "gproc": []}
        gpus, _ = machine().windows_gpus(r)
        self.assertEqual({k: gpus[0]["m"][k] for k in ("3d", "copy", "encode", "decode")}, {"3d": 0.0, "copy": 0.0, "encode": 6.0, "decode": 11.0})


class WindowsGpus(unittest.TestCase):
    def test_engines_by_type_shared_memory_and_nvidia_smi(self):
        r = {"gpus": [{"luid": "0x0_0xf563", "util": 12.5, "dedicated": 1734344704, "shared": 69120000,
                       "eng": {"3d": 12.5, "copy": 1.0, "videodecode": 5.0, "videoencode": 0.0, "compute_0": 3.0, "cuda": 7.0, "security": 0.0, "legacyoverlay": 0.0}},
                      {"luid": "0x0_0x107e7", "util": 0.0, "dedicated": 4096, "shared": 8192, "eng": {"3d": 0.0}}],
             # index,name,utilization.gpu,memory.used,memory.total,utilization.memory,temperature.gpu,power.draw,power.limit,clocks.gr,clocks.max.gr,clocks.mem,fan.speed,utilization.encoder,utilization.decoder
             "nvidia": ["0, NVIDIA GeForce RTX 3090, 13, 1654, 24576, 3, 27, 36.70, 350.00, 210, 2100, 405, 0, 0, 5"],
             "videoNames": ["NVIDIA GeForce RTX 3090", "Microsoft Basic Render Driver"], "gproc": []}
        gpus, _ = machine().windows_gpus(r)
        self.assertEqual([g["name"] for g in gpus], ["NVIDIA GeForce RTX 3090", "Microsoft Basic Render Driver"])
        self.assertEqual(gpus[0]["m"], {"util": 12.5, "3d": 12.5, "copy": 1.0, "decode": 5.0, "encode": 0.0, "compute": 7.0, "vram": 1734344704,
                                        "shared": 69120000, "memctl": 3.0, "temp": 27.0, "power": 36.7, "clock": 210.0, "memclock": 405.0, "fan": 0.0})
        self.assertEqual(gpus[0]["lim"], {"vram": 24576 * MIB, "power": 350.0, "clock": 2100.0})
        self.assertEqual(gpus[1]["m"], {"util": 0.0, "3d": 0.0, "copy": 0.0, "encode": 0.0, "decode": 0.0, "vram": 4096, "shared": 8192})
        self.assertEqual(gpus[1]["lim"], {})


class MacGpu(unittest.TestCase):
    IOREG = ('"PerformanceStatistics" = {"In use system memory (driver)"=0,"Alloc system memory"=8608137216,"Tiler Utilization %"=9,'
             '"recoveryCount"=0,"lastRecoveryTime"=0,"Renderer Utilization %"=13,"TiledSceneBytes"=1900544,"Device Utilization %"=15,'
             '"SplitSceneCount"=0,"Allocated PB Size"=326631424,"In use system memory"=3247849472}')

    def test_device_renderer_tiler_and_memory_in_use(self):
        self.assertEqual(fl.mac_gpu_stats(self.IOREG), [{"util": 15.0, "3d": 13.0, "tiler": 9.0, "sysmem": 3247849472.0}])
        self.assertEqual(fl.mac_gpu_stats(""), [])


class Spec(unittest.TestCase):
    def test_metrics_go_out_in_one_order_with_their_limits(self):
        g = {"m": {"fan": 30.0, "util": 41.0, "vram": 5.0, "decode": 12.0, "zzz": 1.0}, "lim": {"vram": 16.0}}
        self.assertEqual(fl.gpu_metric_order(g), [("util", None), ("decode", None), ("vram", 16.0), ("fan", None), ("zzz", None)])


if __name__ == "__main__":
    unittest.main()
