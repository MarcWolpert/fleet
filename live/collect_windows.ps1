# SPDX-License-Identifier: GPL-3.0-or-later
# Fleet Live: one read-only snapshot of a Windows machine, printed as JSON.
# Sent over SSH as one base64 line on stdin to a short `powershell -EncodedCommand` bootstrap; installs and changes nothing.
# Runs as a loop: one compact JSON line every $FleetInterval seconds (prepended
# by the collector) until the SSH connection closes. The first line also carries
# the logical-processor topology (P/E efficiency class, L3 groups); scheduled
# tasks, adapter addresses and the GPU adapter list refresh every 10th line.
$ErrorActionPreference = 'SilentlyContinue'; $ProgressPreference = 'SilentlyContinue'
if (-not $FleetInterval) { $FleetInterval = 3 }
$loop = 0; $taskCache = @(); $addrCache = @{}; $cmdCache = @{}; $diskInfo = @{}; $pnetCache = @{}; $adapters = @()
# External programs get 8 seconds (like collect_linux.py's run(..., timeout=8)) and are killed after that: a wedged
# WSL service, Docker engine or GPU driver must not hold up the loop, or the checks that end it never run again.
function Start-Bounded($exe, $argline) {
  $si = New-Object Diagnostics.ProcessStartInfo $exe, $argline
  $si.UseShellExecute = $false; $si.CreateNoWindow = $true; $si.RedirectStandardOutput = $true; $si.RedirectStandardError = $true
  try { $p = [Diagnostics.Process]::Start($si); @{ p = $p; out = $p.StandardOutput.ReadToEndAsync(); err = $p.StandardError.ReadToEndAsync() } } catch { $null }
}
function Wait-Bounded($job, $secs = 8) {
  if (-not $job) { return '' }
  try { if ($job.out.Wait([int]($secs * 1000))) { [void]$job.p.WaitForExit(1000); return $job.out.Result } } catch {}
  try { $job.p.Kill() } catch {}
  ''
}
function UnixNow { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0 }
# (a function's output unrolls: callers wrap Invoke-Bounded in @() to keep one line a list)
function Invoke-Bounded($exe, $argline) { @((Wait-Bounded (Start-Bounded $exe $argline)) -split "`r?`n" | Where-Object { $_ }) }
# Stop when Fleet goes away. Fleet keeps our stdin open and writes nothing after this script, so the pending read
# completes (EOF) the moment the SSH session ends for any reason; also stop if our parent shell is
# gone, and after 6 hours in any case (Fleet reconnects).
$lifeline = $null
try { $stdin = [Console]::OpenStandardInput(); $lifeline = $stdin.ReadAsync((New-Object byte[] 1), 0, 1) } catch {}
# On Windows the pipe often never reports EOF (children inherit its handles), so the reliable signal
# is the SSH session process itself: find the nearest sshd ancestor and exit when it is gone.
$sshd = $null; $anc = $PID
for ($k = 0; $k -lt 8 -and -not $sshd; $k++) {
  $pp = (Get-CimInstance Win32_Process -Filter "ProcessId=$anc").ParentProcessId
  if (-not $pp) { break }
  $pn = (Get-Process -Id $pp -ErrorAction SilentlyContinue).ProcessName
  if ($pn -like 'sshd*') { $sshd = $pp } else { $anc = $pp }
}
# The GPU counters know adapters only by LUID; DXGI's adapter list gives each LUID its name and VRAM size.
try { Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class FleetDxgi {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Desc {   // DXGI_ADAPTER_DESC1
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
    public uint VendorId, DeviceId, SubSysId, Revision;
    public UIntPtr DedicatedVideoMemory, DedicatedSystemMemory, SharedSystemMemory;
    public uint LuidLow; public int LuidHigh; public uint Flags;
  }
  // Only the methods called are typed; the others keep their vtable slots (IDXGIObject 4, IDXGIAdapter 3, IDXGIFactory 5).
  [ComImport, Guid("29038f61-3839-4626-91fd-086879011a05"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAdapter1 {
    void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
    void EnumOutputs(); void GetDesc(); void CheckInterfaceSupport();
    [PreserveSig] int GetDesc1(out Desc desc);
  }
  [ComImport, Guid("770aae78-f26f-4dba-a829-253c83d1b387"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IFactory1 {
    void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
    void EnumAdapters(); void MakeWindowAssociation(); void GetWindowAssociation(); void CreateSwapChain(); void CreateSoftwareAdapter();
    [PreserveSig] int EnumAdapters1(uint index, out IAdapter1 adapter);
  }
  [DllImport("dxgi.dll")]
  static extern int CreateDXGIFactory1(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object factory);
  // Returns "luid|dedicated VRAM bytes|name" for every adapter, the LUID written as the GPU counters write it.
  public static string[] Read() {
    var res = new List<string>();
    Guid iid = typeof(IFactory1).GUID; object o;
    if (CreateDXGIFactory1(ref iid, out o) != 0) return res.ToArray();
    var f = (IFactory1)o;
    try {
      IAdapter1 a;
      for (uint i = 0; f.EnumAdapters1(i, out a) == 0; i++) {
        try {
          Desc d;
          if (a.GetDesc1(out d) == 0 && (d.Flags & 2) != 0) continue;   // DXGI_ADAPTER_FLAG_SOFTWARE: Microsoft Basic Render Driver
          if (a.GetDesc1(out d) == 0)
            res.Add(string.Format("0x{0:x8}_0x{1:x8}|{2}|{3}", d.LuidHigh, d.LuidLow, (ulong)d.DedicatedVideoMemory, d.Description));
        } finally { Marshal.ReleaseComObject(a); }
      }
    } finally { Marshal.ReleaseComObject(f); }
    return res.ToArray();
  }
}
'@ } catch {}
$born = Get-Date
while ($true) {
if ($lifeline -and $lifeline.IsCompleted) { exit 0 }
if ($sshd -and -not (Get-Process -Id $sshd -ErrorAction SilentlyContinue)) { exit 0 }
if (((Get-Date) - $born).TotalHours -ge 6) { exit 0 }
$started = Get-Date
$o = [ordered]@{}
# t stamps the reading; tp, tn and td stamp the cumulative counters (process CPU time, adapter bytes, docker stats) when
# they are read, after work that runs only on some readings, so each rate divides by its own counter's time.
$o.t = UnixNow
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$o.os = $os.Caption; $o.build = $os.BuildNumber; $o.host = $env:COMPUTERNAME; $o.arch = $env:PROCESSOR_ARCHITECTURE
$o.uptime = ((Get-Date) - $os.LastBootUpTime).TotalSeconds
$o.ncpu = [int]$cs.NumberOfLogicalProcessors
$o.cpu_model = (@(Get-CimInstance Win32_Processor)[0].Name).Trim()
$o.mem = @([double]$cs.TotalPhysicalMemory, [double]$os.FreePhysicalMemory * 1024)

$wsl = @(); $raw = (Wait-Bounded (Start-Bounded 'wsl.exe' '-l -v')) -replace "`0", ''
foreach ($line in $raw -split "`r?`n") { if ($line -match '^\s*(\*)?\s*(\S+)\s+(Running|Stopped|Installing|Converting)\s+(\d)') { $wsl += @{ name = $Matches[2]; state = $Matches[3]; default = [bool]$Matches[1] } } }
$o.wsl = $wsl
# docker stats takes 1-2 s (the daemon waits for a second sample of every container): it runs alongside the counters'
# 1 s sample and the process list, and is collected after them, so a reading still fits its interval
$dockerUp = @($wsl | Where-Object { $_.name -eq 'docker-desktop' -and $_.state -eq 'Running' }).Count -gt 0
$ds = $null; if ($dockerUp) { $ds = Start-Bounded 'docker' 'stats --no-stream --format "{{json .}}"' }

# Task Manager's Speed: the frequency scaled by % Processor Performance (over 100 in turbo); fleet_live.py does the sum
$paths = @('\Processor(*)\% Processor Time', '\Processor Information(*)\Processor Frequency',
  '\Processor Information(*)\% Processor Performance', '\Processor Information(*)\% of Maximum Frequency',
  '\PhysicalDisk(*)\Disk Bytes/sec', '\PhysicalDisk(*)\Disk Read Bytes/sec', '\PhysicalDisk(*)\Disk Write Bytes/sec', '\PhysicalDisk(*)\% Idle Time',
  '\GPU Engine(*)\Utilization Percentage', '\GPU Adapter Memory(*)\Dedicated Usage', '\GPU Adapter Memory(*)\Shared Usage', '\Memory\Available Bytes')
$samples = (Get-Counter -Counter $paths -SampleInterval 1 -MaxSamples 1).CounterSamples
$lcpu = @{}; $freq = @{}; $perf = @{}; $maxf = @{}; $procs = @{}; $eng = @{}; $pidGpu = @{}; $adMem = @{}; $adShared = @{}; $pd = @{}
foreach ($s in $samples) {
  $parts = $s.Path.Split('\'); $counter = $parts[-1]; $set = $parts[-2]; $inst = $s.InstanceName; $v = $s.CookedValue
  if ($set -like 'processor(*') { if ($inst -ne '_total') { $lcpu[[int]$inst] = $v } }
  elseif ($set -like 'processor information(*') { if ($inst -match '^(\d+),(\d+)$') { $lp = [int]$Matches[2] + 64 * [int]$Matches[1]
    if ($counter -eq 'processor frequency') { $freq[$lp] = $v } elseif ($counter -eq '% processor performance') { $perf[$lp] = $v } else { $maxf[$lp] = $v } } }
  elseif ($set -like 'physicaldisk(*') {
    if ($inst -eq '_total') { if ($counter -eq 'disk bytes/sec') { $o.diskBps = $v } }
    else { if (-not $pd.ContainsKey($inst)) { $pd[$inst] = @{} }; $pd[$inst][$counter] = $v }
  }
  elseif ($set -like 'process(*') {
    $inst = $set.Substring(8, $set.Length - 9)   # keeps svchost#12 distinct
    if ($inst -eq '_total' -or $inst -eq 'idle') { continue }
    if (-not $procs.ContainsKey($inst)) { $procs[$inst] = @{} }
    $procs[$inst][$counter] = $v
  }
  elseif ($set -eq 'memory') { $o.mem[1] = $v }
  elseif ($set -like 'gpu engine(*') {
    if ($inst -match '^pid_(\d+)_luid_(0x[0-9a-f]+_0x[0-9a-f]+)_phys_(\d+)_eng_(\d+)_engtype_(.*)$') {
      $key = $Matches[2] + '|' + $Matches[4] + '|' + $Matches[5]; $eng[$key] = [double]$eng[$key] + $v   # adapter|engine|type
      $pk = $Matches[1] + '|' + $Matches[2]; if ($v -gt [double]$pidGpu[$pk]) { $pidGpu[$pk] = $v }
    }
  }
  elseif ($set -like 'gpu adapter memory(*') { if ($inst -match 'luid_(0x[0-9a-f]+_0x[0-9a-f]+)_phys') { if ($counter -like 'shared*') { $adShared[$Matches[1]] = $v } else { $adMem[$Matches[1]] = $v } } }
}
$o.lcpus = @($lcpu.Keys | Sort-Object | ForEach-Object { @{ n = $_; pct = $lcpu[$_]; mhz = [int]$freq[$_]; perf = [double]$perf[$_]; maxf = [double]$maxf[$_] } })

# GPUs: an adapter with dedicated memory in use, or a hardware adapter in DXGI's list (an integrated GPU has no dedicated
# memory, only shared; virtual displays aren't in DXGI's list, and its software adapter is skipped), listed in LUID order.
# Fleet names and orders them by LUID (DXGI's adapter list) and pairs nvidia-smi's rows by name.
$gpuUtil = @{}
foreach ($k in $eng.Keys) { $l = $k.Split('|')[0]; if ($eng[$k] -gt [double]$gpuUtil[$l]) { $gpuUtil[$l] = $eng[$k] } }
# each engine type (3d, copy, videodecode, ...) at its busiest engine, per adapter, like Task Manager
$engT = @{}
foreach ($k in $eng.Keys) { $p = $k.Split('|'); $tk = $p[0] + '|' + $p[2]; if ($eng[$k] -gt [double]$engT[$tk]) { $engT[$tk] = $eng[$k] } }
$cands = @(@($adMem.Keys) + @($adShared.Keys) | Sort-Object -Unique)
# the adapter list first, again when an adapter is new (a driver restart gives it a new LUID)
if ($loop % 10 -eq 0 -or @($cands | Where-Object { $adMem[$_] -gt 0 -and $adapters.luid -notcontains $_ }).Count) {
  $adapters = @(try { [FleetDxgi]::Read() | ForEach-Object { $f = $_.Split('|', 3); @{ luid = $f[0]; vram = [double]$f[1]; name = $f[2] } } } catch {}) }
$hw = @{}; foreach ($a in $adapters) { $hw[[string]$a.luid] = 1 }
$o.gpus = @($cands | Where-Object { $adMem[$_] -gt 0 -or $hw.ContainsKey($_) } | ForEach-Object {
  $l = $_; $e = @{}; foreach ($tk in $engT.Keys) { $p = $tk.Split('|', 2); if ($p[0] -eq $l) { $e[$p[1]] = $engT[$tk] } }
  @{ luid = $l; util = [double]$gpuUtil[$l]; dedicated = [double]$adMem[$l]; shared = [double]$adShared[$l]; eng = $e } })
$o.adapters = $adapters
# NVIDIA's own numbers; drivers without the newer fields fail the whole query, so fall back to the basic one
$nv = @(Invoke-Bounded 'nvidia-smi' '--query-gpu=index,name,utilization.gpu,memory.used,memory.total,utilization.memory,temperature.gpu,power.draw,power.limit,clocks.gr,clocks.max.gr,clocks.mem,fan.speed,utilization.encoder,utilization.decoder --format=csv,noheader,nounits')
if (-not ($nv | Where-Object { $_ -match ',' })) { $nv = @(Invoke-Bounded 'nvidia-smi' '--query-gpu=index,name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits') }
$o.nvidia = $nv
$o.videoNames = @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name })
$o.gproc = @($pidGpu.Keys | ForEach-Object { $gp = $_.Split('|'); ,@([int]$gp[0], $gp[1], $pidGpu[$_]) })

# A running process's parent and command line never change: ask WMI for just those, about PIDs not seen before, and
# forget PIDs that are gone. Re-reading every process took seconds. Windows reuses freed PIDs, often for the same
# program, so each process is known by its name and its start time: a new process on an old PID is asked about too.
# (A protected process's start time can't be read; it is known by its name alone, the same every reading.)
$gps = @(Get-Process | Where-Object { $_.Id -ne 0 })
$live = @{}; foreach ($gp in $gps) { $st = ''; try { $st = $gp.StartTime.Ticks } catch {}; $live[[int]$gp.Id] = $gp.ProcessName + '|' + $st }
foreach ($k in @($cmdCache.Keys)) { if (-not $live.ContainsKey($k)) { $cmdCache.Remove($k) } }
$miss = @($gps | Where-Object { $wc = $cmdCache[[int]$_.Id]; -not $wc -or $wc[2] -ne $live[[int]$_.Id] })
if ($miss.Count) {
  $q = @{ ClassName = 'Win32_Process'; Property = @('ProcessId', 'ParentProcessId', 'CommandLine') }
  if ($miss.Count -le 100) { $q.Filter = ($miss | ForEach-Object { "Handle='$($_.Id)'" }) -join ' OR ' }
  $res = @(Get-CimInstance @q)
  if ($res.Count) {
    # one gone before WMI saw it: don't ask again
    foreach ($gp in $miss) { $cmdCache[[int]$gp.Id] = @(0, '', $live[[int]$gp.Id]) }
    foreach ($wp in $res) { $id = [int]$wp.ProcessId; if ($live.ContainsKey($id)) { $cmdCache[$id] = @([int]$wp.ParentProcessId, [string]$wp.CommandLine, $live[$id]) } }
  }
}
$plist = New-Object System.Collections.ArrayList
$o.tp = UnixNow
foreach ($gp in $gps) {
  $wc = $cmdCache[[int]$gp.Id]; $cmd = ''; $ppid = 0
  if ($wc) { $ppid = $wc[0]; if ($wc[1]) { $cmd = [string]$wc[1] } }
  if ($cmd.Length -gt 300) { $cmd = $cmd.Substring(0, 300) }
  $cpu = 0.0; try { $cpu = $gp.TotalProcessorTime.TotalSeconds } catch {}
  [void]$plist.Add(@([int]$gp.Id, $ppid, $gp.ProcessName, $cpu, [double]$gp.PrivateMemorySize64, [int]$gp.Threads.Count, -1, $cmd))
}
$o.procs = $plist
$o.perr = [string]$Error[0]; $Error.Clear()
if ($loop % 10 -eq 0) { $diskInfo = @{}
  foreach ($dd in Get-PhysicalDisk) { $diskInfo[[string]$dd.DeviceId] = @{ model = [string]$dd.FriendlyName; size = [double]$dd.Size; media = [string]$dd.MediaType } } }
$o.disks = @(foreach ($k in $pd.Keys) {
  $num = ($k -split ' ')[0]; $letters = (($k -split ' ', 2) | Select-Object -Skip 1) -join ' '
  $di = $diskInfo[$num]
  @{ name = "Disk $num"; letters = $letters; model = $(if ($di) { $di.model } else { '' }); size = $(if ($di) { $di.size } else { 0 })
     rot = $(if ($di) { $di.media -eq 'HDD' } else { $false }); read = [double]$pd[$k]['disk read bytes/sec']; write = [double]$pd[$k]['disk write bytes/sec']
     busy = [math]::Max(0, 100 - [double]$pd[$k]['% idle time']) }
})
if ($loop % 3 -eq 0) { $ipIf = @{}; foreach ($ia in Get-NetIPAddress) { $ipIf[[string]$ia.IPAddress] = [string]$ia.InterfaceAlias }
  $pn = @{}; foreach ($tc in Get-NetTCPConnection -State Established) { $ifn = $ipIf[[string]$tc.LocalAddress]; if ($ifn) { $k = [string]$tc.OwningProcess; if (-not $pn.ContainsKey($k)) { $pn[$k] = @{} }; $pn[$k][$ifn] = 1 } }
  $pnetCache = @{}; foreach ($k in $pn.Keys) { $pnetCache[$k] = @($pn[$k].Keys) } }
$o.pnet = $pnetCache
$ast = @{}; $o.tn = UnixNow; foreach ($st in Get-NetAdapterStatistics) { $ast[[string]$st.Name] = $st }
$o.ifs = @(Get-NetAdapter | ForEach-Object {
  $st = $ast[[string]$_.Name]
  @{ name = $_.Name; desc = $_.InterfaceDescription; status = [string]$_.Status; speed = [string]$_.LinkSpeed; virtual = [bool]$_.Virtual
     rx = [double]$st.ReceivedBytes; tx = [double]$st.SentBytes
     addrs = $(if ($loop % 10 -eq 0 -or -not $addrCache.ContainsKey($_.Name)) { $addrCache[$_.Name] = @(Get-NetIPAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 | ForEach-Object { "$($_.IPAddress)/$($_.PrefixLength)" }) }; $addrCache[$_.Name]) }
})

$o.containers = @(); $o.dstats = @()
if ($dockerUp) {
  $o.containers = @(Invoke-Bounded 'docker' 'ps --no-trunc --format "{{json .}}"')
  $o.dstats = @((Wait-Bounded $ds) -split "`r?`n" | Where-Object { $_ })
  $o.td = UnixNow; try { $o.td = ([DateTimeOffset]$ds.p.ExitTime.ToUniversalTime()).ToUnixTimeMilliseconds() / 1000.0 } catch {}
}

if ($loop % 10 -eq 0) { $taskCache = @(Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\Microsoft\*' } | ForEach-Object {
  $i = $_ | Get-ScheduledTaskInfo
  $a = @($_.Actions)[0]
  @{ name = $_.TaskName; path = $_.TaskPath; state = [string]$_.State
     cmd = (("" + $a.Execute + " " + $a.Arguments).Trim())
     triggers = @($_.Triggers | ForEach-Object { ($_.CimClass.CimClassName -replace '^MSFT_Task', '' -replace 'Trigger$', '') + $(if ($_.StartBoundary) { ' ' + ([datetime]$_.StartBoundary).ToString('HH:mm') } else { '' }) })
     last = $(if ($i.LastRunTime -and $i.LastRunTime.Year -gt 2000) { $i.LastRunTime.ToString('yyyy-MM-dd HH:mm') } else { '' })
     next = $(if ($i.NextRunTime) { $i.NextRunTime.ToString('yyyy-MM-dd HH:mm') } else { '' }) }
}) }
$o.tasks = $taskCache

if ($loop -eq 0) {
  Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class FleetTopo {
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool GetLogicalProcessorInformationEx(int rel, IntPtr buf, ref int len);
  // Returns "cpu:coreIndex:efficiencyClass:l3Index" for every logical processor in group 0..n.
  public static string[] Read() {
    int len = 0; GetLogicalProcessorInformationEx(0xffff, IntPtr.Zero, ref len);
    IntPtr buf = Marshal.AllocHGlobal(len);
    var core = new Dictionary<int,int>(); var eff = new Dictionary<int,int>(); var l3 = new Dictionary<int,int>();
    try {
      if (!GetLogicalProcessorInformationEx(0xffff, buf, ref len)) return new string[0];
      int off = 0, ci = 0, li = 0;
      while (off < len) {
        IntPtr p = IntPtr.Add(buf, off); int rel = Marshal.ReadInt32(p); int size = Marshal.ReadInt32(p, 4);
        if (rel == 0) { int ec = Marshal.ReadByte(p, 9); long mask = Marshal.ReadInt64(p, 32); int grp = Marshal.ReadInt16(p, 40);
          for (int b = 0; b < 64; b++) if ((mask >> b & 1) == 1) { core[grp*64+b] = ci; eff[grp*64+b] = ec; } ci++; }
        else if (rel == 2 && Marshal.ReadByte(p, 8) == 3) { long mask = Marshal.ReadInt64(p, 40); int grp = Marshal.ReadInt16(p, 48);
          for (int b = 0; b < 64; b++) if ((mask >> b & 1) == 1) l3[grp*64+b] = li; li++; }
        off += size;
      }
    } finally { Marshal.FreeHGlobal(buf); }
    var res = new List<string>();
    foreach (var k in core.Keys) res.Add(k + ":" + core[k] + ":" + eff[k] + ":" + (l3.ContainsKey(k) ? l3[k] : -1));
    return res.ToArray();
  }
}
'@
  $o.topo = [FleetTopo]::Read()
}
# If Fleet Live went away, the pipe is gone: stop instead of looping on silently. (Windows PowerShell 5.1 does not
# throw on a broken pipe, so there the lifeline and sshd checks at the top of the loop are what end it.)
try { [Console]::Out.WriteLine(($o | ConvertTo-Json -Depth 6 -Compress)); [Console]::Out.Flush() } catch { exit 0 }
$loop++
$left = $FleetInterval - ((Get-Date) - $started).TotalSeconds
if ($left -gt 0) { Start-Sleep -Milliseconds ([int]($left * 1000)) }
}
