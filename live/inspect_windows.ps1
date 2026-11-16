# SPDX-License-Identifier: GPL-3.0-or-later
# Fleet Live: one look at one process on Windows, for the Details drop-down. The server prepends
# $FleetPid and $FleetSecs and runs it with -EncodedCommand over SSH. Read-only. Prints one JSON object.
# "What it waits on": every thread's state and wait reason (System.Diagnostics.ProcessThread), sampled.
$ErrorActionPreference = 'SilentlyContinue'
$p = Get-Process -Id $FleetPid
if (-not $p) { '{"pid":' + $FleetPid + ',"gone":true}'; exit }
$w0 = Get-CimInstance Win32_Process -Filter "ProcessId=$FleetPid"
$t0 = Get-Date; $cpu0 = $p.TotalProcessorTime.TotalSeconds; $usr0 = $p.UserProcessorTime.TotalSeconds
$counts = @{}; $samples = 0; $per = @{}
$end = (Get-Date).AddSeconds($FleetSecs)
do {
  $p.Refresh()
  foreach ($t in $p.Threads) {
    $s = [string]$t.ThreadState
    $k = switch ($s) {
      'Running' { 'cpu' } 'Ready' { 'cpuwait' } 'Standby' { 'cpuwait' } 'Terminated' { 'stopped' }
      'Wait' {
        switch ([string]$t.WaitReason) {
          'UserRequest' { 'events' } 'Executive' { 'other' } 'ExecutionDelay' { 'timer' } 'Suspended' { 'stopped' }
          'LpcReceive' { 'pipe' } 'LpcReply' { 'pipe' } 'EventPairHigh' { 'lock' } 'EventPairLow' { 'lock' }
          'FreePage' { 'memory' } 'PageIn' { 'memory' } 'SystemAllocation' { 'memory' } 'VirtualMemory' { 'memory' } 'PageOut' { 'memory' }
          default { 'other' }
        }
      }
      default { 'other' }
    }
    $counts[$k] = 1 + [int]$counts[$k]
    if (-not $per.ContainsKey($t.Id)) { $per[$t.Id] = @{} }
    $per[$t.Id][$k] = 1 + [int]$per[$t.Id][$k]
  }
  $samples++
  Start-Sleep -Milliseconds 120
} while ((Get-Date) -lt $end)
$p.Refresh()
$w1 = Get-CimInstance Win32_Process -Filter "ProcessId=$FleetPid"
$dt = [Math]::Max(0.05, ((Get-Date) - $t0).TotalSeconds)
$threads = @($p.Threads | ForEach-Object {
  $pc = $per[$_.Id]; $doing = ''
  if ($pc) { $doing = ($pc.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1).Key }
  [pscustomobject]@{ tid = $_.Id; name = ''; cpu = 0; total = $_.TotalProcessorTime.TotalSeconds; doing = $doing; prio = $_.CurrentPriority }
} | Sort-Object total -Descending | Select-Object -First 16)
$conns = @(Get-NetTCPConnection -OwningProcess $FleetPid | Select-Object -First 40 | ForEach-Object {
  [pscustomobject]@{ proto = 'tcp'; local = "$($_.LocalAddress):$($_.LocalPort)"; remote = $(if ($_.RemotePort) { "$($_.RemoteAddress):$($_.RemotePort)" } else { '' }); state = ([string]$_.State).ToLower() -replace 'listen', 'listening' }
})
$udp = @(Get-NetUDPEndpoint -OwningProcess $FleetPid | Select-Object -First 20 | ForEach-Object { [pscustomobject]@{ proto = 'udp'; local = "$($_.LocalAddress):$($_.LocalPort)"; remote = ''; state = 'listening' } })
$owner = ''
$o = Invoke-CimMethod -InputObject $w1 -MethodName GetOwner
if ($o -and $o.User) { $owner = $(if ($o.Domain) { "$($o.Domain)\$($o.User)" } else { $o.User }) }
$started = 0
if ($p.StartTime) { $started = ([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds() / 1000 }
$out = [ordered]@{
  pid = $FleetPid; name = $p.ProcessName; state = 'R'; ppid = [int]$w1.ParentProcessId; nice = 0; priority = [int]$p.BasePriority
  priority_class = [string]$p.PriorityClass; threads_n = $p.Threads.Count; started = $started; last_cpu = -1; user = $owner
  cmdline = [string]$w1.CommandLine; exe = [string]$w1.ExecutablePath; cwd = ''; affinity_mask = [string]$p.ProcessorAffinity
  cpu = [ordered]@{ user = ($p.UserProcessorTime.TotalSeconds - $usr0) / $dt; system = (($p.TotalProcessorTime.TotalSeconds - $cpu0) - ($p.UserProcessorTime.TotalSeconds - $usr0)) / $dt }
  mem = [ordered]@{ rss = $p.WorkingSet64; private = $p.PrivateMemorySize64; peak = $p.PeakWorkingSet64; paged = $p.PagedMemorySize64; virt = $p.VirtualMemorySize64
    faults = ([double]$w1.PageFaults - [double]$w0.PageFaults) / $dt }
  io = [ordered]@{ read = ([double]$w1.ReadTransferCount - [double]$w0.ReadTransferCount) / $dt; write = ([double]$w1.WriteTransferCount - [double]$w0.WriteTransferCount) / $dt
    other = ([double]$w1.OtherTransferCount - [double]$w0.OtherTransferCount) / $dt }
  waits = $counts; samples = $samples; dt = $dt
  threads = $threads; fds = $p.HandleCount; fd_limit = -1; handles = $p.HandleCount; files = @()
  conns = @($conns + $udp); conns_n = $conns.Count + $udp.Count; cgroup = $null; cache = $null
  cache_error = 'Windows doesn''t expose per-process CPU cache counters without a kernel driver'
}
$out | ConvertTo-Json -Compress -Depth 5
