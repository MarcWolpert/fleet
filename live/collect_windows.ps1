# SPDX-License-Identifier: GPL-3.0-or-later
# Fleet Live: one read-only snapshot of a Windows machine, printed as JSON.
# Sent over SSH as `powershell -EncodedCommand`; installs and changes nothing.
# Runs as a loop: one compact JSON line every $FleetInterval seconds (prepended
# by the collector) until the SSH connection closes. The first line also carries
# the logical-processor topology (P/E efficiency class, L3 groups); scheduled
# tasks and adapter addresses refresh every 10th line.
$ErrorActionPreference = 'SilentlyContinue'; $ProgressPreference = 'SilentlyContinue'
if (-not $FleetInterval) { $FleetInterval = 3 }
$loop = 0; $taskCache = @(); $addrCache = @{}; $cmdCache = @{}
# Stop when Fleet goes away. Fleet keeps our stdin open and never writes to it, so the pending read
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
$born = Get-Date
while ($true) {
if ($lifeline -and $lifeline.IsCompleted) { exit 0 }
if ($sshd -and -not (Get-Process -Id $sshd -ErrorAction SilentlyContinue)) { exit 0 }
if (((Get-Date) - $born).TotalHours -ge 6) { exit 0 }
$started = Get-Date
$o = [ordered]@{}
$o.t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$o.os = $os.Caption; $o.build = $os.BuildNumber; $o.host = $env:COMPUTERNAME; $o.arch = $env:PROCESSOR_ARCHITECTURE
$o.uptime = ((Get-Date) - $os.LastBootUpTime).TotalSeconds
$o.ncpu = [int]$cs.NumberOfLogicalProcessors
$o.cpu_model = (@(Get-CimInstance Win32_Processor)[0].Name).Trim()
$o.mem = @([double]$cs.TotalPhysicalMemory, [double]$os.FreePhysicalMemory * 1024)

$paths = @('\Processor(*)\% Processor Time', '\Processor Information(*)\Processor Frequency',
  '\PhysicalDisk(_Total)\Disk Bytes/sec',
  '\GPU Engine(*)\Utilization Percentage', '\GPU Adapter Memory(*)\Dedicated Usage', '\Memory\Available Bytes')
$samples = (Get-Counter -Counter $paths -SampleInterval 1 -MaxSamples 1).CounterSamples
$lcpu = @{}; $freq = @{}; $procs = @{}; $eng = @{}; $pidGpu = @{}; $adMem = @{}
foreach ($s in $samples) {
  $parts = $s.Path.Split('\'); $counter = $parts[-1]; $set = $parts[-2]; $inst = $s.InstanceName; $v = $s.CookedValue
  if ($set -like 'processor(*') { if ($inst -ne '_total') { $lcpu[[int]$inst] = $v } }
  elseif ($set -like 'processor information(*') { if ($inst -match '^(\d+),(\d+)$') { $freq[[int]$Matches[2] + 64 * [int]$Matches[1]] = $v } }
  elseif ($set -like 'physicaldisk(*') { $o.diskBps = $v }
  elseif ($set -like 'process(*') {
    $inst = $set.Substring(8, $set.Length - 9)   # keeps svchost#12 distinct
    if ($inst -eq '_total' -or $inst -eq 'idle') { continue }
    if (-not $procs.ContainsKey($inst)) { $procs[$inst] = @{} }
    $procs[$inst][$counter] = $v
  }
  elseif ($set -eq 'memory') { $o.mem[1] = $v }
  elseif ($set -like 'gpu engine(*') {
    if ($inst -match '^pid_(\d+)_luid_(0x[0-9a-f]+_0x[0-9a-f]+)_phys_(\d+)_eng_(\d+)_engtype_(.*)$') {
      $key = $Matches[2] + '|' + $Matches[4]; $eng[$key] = [double]$eng[$key] + $v
      $pk = $Matches[1] + '|' + $Matches[2]; if ($v -gt [double]$pidGpu[$pk]) { $pidGpu[$pk] = $v }
    }
  }
  elseif ($set -like 'gpu adapter memory(*') { if ($inst -match 'luid_(0x[0-9a-f]+_0x[0-9a-f]+)_phys') { $adMem[$Matches[1]] = $v } }
}
$o.lcpus = @($lcpu.Keys | Sort-Object | ForEach-Object { @{ n = $_; pct = $lcpu[$_]; mhz = [int]$freq[$_] } })

# GPUs: real adapters are the ones with dedicated memory; NVIDIA names and totals from nvidia-smi.
$gpuUtil = @{}
foreach ($k in $eng.Keys) { $l = $k.Split('|')[0]; if ($eng[$k] -gt [double]$gpuUtil[$l]) { $gpuUtil[$l] = $eng[$k] } }
$o.gpus = @($adMem.Keys | Where-Object { $adMem[$_] -gt 0 } | Sort-Object { - $adMem[$_] } | ForEach-Object { @{ luid = $_; util = [double]$gpuUtil[$_]; dedicated = $adMem[$_] } })
$o.nvidia = @(nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>$null)
$o.videoNames = @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name })
$o.gproc = @($pidGpu.Keys | ForEach-Object { $gp = $_.Split('|'); ,@([int]$gp[0], $gp[1], $pidGpu[$_]) })

if ($loop % 3 -eq 0) { $cmdCache = @{}; foreach ($wp in Get-CimInstance Win32_Process) { $cmdCache[[int]$wp.ProcessId] = @([int]$wp.ParentProcessId, [string]$wp.CommandLine) } }
$plist = New-Object System.Collections.ArrayList
foreach ($gp in Get-Process) {
  if ($gp.Id -eq 0) { continue }
  $wc = $cmdCache[[int]$gp.Id]; $cmd = ''; $ppid = 0
  if ($wc) { $ppid = $wc[0]; if ($wc[1]) { $cmd = [string]$wc[1] } }
  if ($cmd.Length -gt 300) { $cmd = $cmd.Substring(0, 300) }
  $cpu = 0.0; try { $cpu = $gp.TotalProcessorTime.TotalSeconds } catch {}
  [void]$plist.Add(@([int]$gp.Id, $ppid, $gp.ProcessName, $cpu, [double]$gp.PrivateMemorySize64, [int]$gp.Threads.Count, -1, $cmd))
}
$o.procs = $plist
$o.perr = [string]$Error[0]; $Error.Clear()
$o.ifs = @(Get-NetAdapter | ForEach-Object {
  $st = Get-NetAdapterStatistics -Name $_.Name
  @{ name = $_.Name; desc = $_.InterfaceDescription; status = [string]$_.Status; speed = [string]$_.LinkSpeed; virtual = [bool]$_.Virtual
     rx = [double]$st.ReceivedBytes; tx = [double]$st.SentBytes
     addrs = $(if ($loop % 10 -eq 0 -or -not $addrCache.ContainsKey($_.Name)) { $addrCache[$_.Name] = @(Get-NetIPAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 | ForEach-Object { "$($_.IPAddress)/$($_.PrefixLength)" }) }; $addrCache[$_.Name]) }
})

$wsl = @(); $raw = (wsl.exe -l -v | Out-String) -replace "`0", ''
foreach ($line in $raw -split "`r?`n") { if ($line -match '^\s*(\*)?\s*(\S+)\s+(Running|Stopped|Installing|Converting)\s+(\d)') { $wsl += @{ name = $Matches[2]; state = $Matches[3]; default = [bool]$Matches[1] } } }
$o.wsl = $wsl

$o.containers = @(); $o.dstats = @()
if (@($wsl | Where-Object { $_.name -eq 'docker-desktop' -and $_.state -eq 'Running' }).Count -gt 0) {
  $o.containers = @(docker ps --no-trunc --format '{{json .}}' 2>$null)
  $o.dstats = @(docker stats --no-stream --format '{{json .}}' 2>$null)
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
# If Fleet Live went away, the pipe is gone: stop instead of looping on silently.
try { [Console]::Out.WriteLine(($o | ConvertTo-Json -Depth 6 -Compress)); [Console]::Out.Flush() } catch { exit 0 }
$loop++
$left = $FleetInterval - ((Get-Date) - $started).TotalSeconds
if ($left -gt 0) { Start-Sleep -Milliseconds ([int]($left * 1000)) }
}
