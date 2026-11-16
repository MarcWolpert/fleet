// SPDX-License-Identifier: GPL-3.0-or-later
// Hand-made API answers shaped like a real Fleet Live server's (/api/fleet, /api/procs, /api/cpus).
// Every test gets a fresh copy, so it may change the data between polls.
//
//   lx    Linux, 16 CPUs in two CCDs, two NVIDIA GPUs; reports the last CPU (p[12]) and GPUs (p[13]) per process
//   lx2   the "nothing else" control: same process names, CPUs and GPUs as lx, other PIDs
//   win   Windows: one GPU, per-process GPUs reported, the last CPU not (-1)
//   mac   macOS: one unified GPU, neither reported
//
// modelFleet() is another fleet, with usage in it (history, Compose, cron jobs, VMs), for the model's arithmetic.
const H = 60;
const zeros = () => new Array(H).fill(0);

// A process row as /api/procs sends it:
// [pid, name, user, state, cpu cores, mem GB, disk MB/s, gpu %, threads, command, tree node, ppid, last CPU, [GPU positions], [disks], [interfaces], network MB/s]
function proc(pid, name, user, state, cpu, node, lastcpu, gpus, gpuPct = 0, disks = [], ifs = []){
  return [pid, name, user, state, cpu, 0.05 + (pid % 7) / 100, 0, gpuPct, 2, `/usr/bin/${name} --id ${pid}`, node, 1, lastcpu, gpus, disks, ifs, ifs.length ? 0.01 : 0];
}

export const CCD0 = [0, 1, 2, 3, 8, 9, 10, 11], CCD1 = [4, 5, 6, 7, 12, 13, 14, 15];

// lx's processes. CCD 0: 104 107 108 109 112. CCD 1: 101 102 103 105 106 110 111.
// GPU 0: 104 106 109 (109 idle). GPU 1: 105 106. Did I/O on nvme0n1: 101 103 111; on sda: 106. Traffic via eth0: 101 102 105 107.
export function lxProcs(base = 100, mid = 'lx'){
  const c = mid + '/containers/web', b = mid + '/base';
  return [
    proc(base + 1, 'nginx', 'root', 'S', 0.30, c, 4, [], 0, ['nvme0n1'], ['eth0']),
    proc(base + 2, 'nginx', 'www-data', 'S', 0.20, c, 12, [], 0, [], ['eth0']),
    proc(base + 3, 'postgres', 'postgres', 'S', 0.50, b, 5, [], 0, ['nvme0n1']),
    proc(base + 4, 'python3', 'marc', 'R', 1.20, b, 2, [0], 40),
    proc(base + 5, 'python3', 'marc', 'R', 0.90, b, 13, [1], 25, [], ['eth0']),
    proc(base + 6, 'ffmpeg', 'marc', 'R', 0.70, b, 6, [0, 1], 30, ['sda']),
    proc(base + 7, 'sshd', 'root', 'S', 0.01, b, 0, [], 0, [], ['eth0']),
    proc(base + 8, 'systemd', 'root', 'S', 0.02, b, 8, []),
    proc(base + 9, 'Xorg', 'root', 'S', 0.05, b, 3, [0], 0),
    proc(base + 10, 'kworker/4:1', 'root', 'I', 0, b, 4, []),
    proc(base + 11, 'redis-server', 'redis', 'S', 0.10, c, 14, [], 0, ['nvme0n1']),
    proc(base + 12, 'cron', 'root', 'S', 0, b, 1, [])
  ];
}

function machine(id, name, os, ncpu, groups, gpus, extra = {}){
  return Object.assign({id, name, tile: 'server', status: 'ok', error: '', os, agent: 'ssh ' + id, cronLabel: 'Cron jobs',
    gpus, cap: [ncpu, 64, 100 * gpus.length, 500, 125], ncpu, cpu_model: name + ' CPU', groups, has_data: true, last_ok: Date.now() / 1000,
    uptime: '3 days', ssh: id, base: {id: id + '/base', g: gpus.length ? ['gpu0'] : []}, baseCron: [], compose: [],
    containers: [{id: id + '/containers/web', name: 'web', image: 'nginx:1', status: 'Up 2 hours', g: []}], vms: []}, extra);
}
const NV = [{name: 'NVIDIA RTX A4000', mem: '16 GB VRAM'}, {name: 'NVIDIA RTX A2000', mem: '12 GB VRAM'}];
const groups2 = [{name: 'CCD 0', cpus: CCD0}, {name: 'CCD 1', cpus: CCD1}];

function cpusOf(groups){
  const ns = groups.flatMap(g => g.cpus).sort((a, b) => a - b);
  return {model: 'test CPU', groups, cpus: ns.map(n => ({n, mhz: 3000 + n, core: String(n % 8), pct: (n * 7) % 100, h: zeros()}))};
}

export function fixture(){
  const winGroups = [{name: 'CCD 0', cpus: [0, 1, 2, 3]}, {name: 'CCD 1', cpus: [4, 5, 6, 7]}];
  const macGroups = [{name: 'Performance cores', cpus: [0, 1, 2, 3]}, {name: 'Efficiency cores', cpus: [4, 5]}];
  const strip = rows => rows.map(p => p.slice(0, 13).concat([[], [], [], -1]));
  return {
    fleet: {t: Date.now() / 1000, interval: 3, window_s: 180, pins: [], machines: [
      machine('lx', 'lab-linux', 'Linux · x86_64', 16, groups2, NV),
      machine('lx2', 'lab-linux-2', 'Linux · x86_64', 16, groups2, NV),
      machine('win', 'lab-windows', 'Windows · AMD64', 8, winGroups, [{name: 'NVIDIA GeForce RTX 3090', mem: '24 GB VRAM'}]),
      machine('mac', 'lab-mac', 'macOS 26 · arm64', 6, macGroups, [{name: 'Apple M5 GPU', mem: 'unified memory'}])
    ]},
    procs: {
      lx: {procs: lxProcs(100, 'lx'), gpu_procs: true},
      lx2: {procs: lxProcs(200, 'lx2'), gpu_procs: true},
      win: {procs: lxProcs(300, 'win').map(p => { const q = p.slice(); q[12] = -1; q[13] = p[13].length ? [0] : []; return q; }), gpu_procs: true},
      mac: {procs: strip(lxProcs(400, 'mac')).map(p => { p[12] = -1; return p; }), gpu_procs: false}
    },
    cpus: {lx: cpusOf(groups2), lx2: cpusOf(groups2), win: cpusOf(winGroups), mac: cpusOf(macGroups)}
  };
}

// A fleet with usage in it, for the model's arithmetic (/api/fleet only). Every series is flat, so "now" is
// the same as any point in the history. Usage is [CPU cores, memory GB, GPU %, disk MB/s, network MB/s].
//
//   host  Linux, 16 CPUs, 64 GB, two GPUs. Base system (2, 8, 30, 10, 1) on GPU 0 5% and GPU 1 25%, plus its
//         jobs: render.sh running (0.5, 1, 20, 2, 0) on GPU 1, backup.sh idle. Compose project ml: trainer
//         (4, 12, 90, 5, 0.5) on GPU 0 85% and GPU 1 5%, db (0.5, 2, 0, 3, 0.2). Containers: web (0.3, 1, 0, 1, 2)
//         and old, stopped. VMs: vm1, reachable, which the host sees use (2, 16, 50, 4, 1), all of it on GPU 1;
//         inside, its Base system (1, 3, 40, 1, 0.5) and container app (0.5, 2, 5, 0, 0.5) on its one vGPU.
//         other, seen only from the host: (0.5, 4, 0, 0, 0).
//   nog   Linux, 8 CPUs, 32 GB, no GPU: Base system (1, 4, 0, 2, 0.5) and container web (0.2, 1, 0, 0, 0.1).
export function modelFleet(){
  const flat = v => new Array(H).fill(v);
  const h = (cpu, mem, gpu, disk, net) => ({cpu: flat(cpu), mem: flat(mem), gpu: flat(gpu), disk: flat(disk), net: flat(net)});
  const gh = (...g) => Object.fromEntries(g.map((v, i) => ['gpu' + i, flat(v)]));
  const m = (id, name, ncpu, mem, gpus, over) => Object.assign({id, name, tile: 'server', status: 'ok', error: '', os: 'Linux · x86_64', agent: 'ssh ' + id,
    cronLabel: 'Cron jobs', cap: [ncpu, mem, 100 * gpus.length, 500, 125], ncpu, cpu_model: name + ' CPU', groups: [], has_data: true,
    last_ok: Date.now() / 1000, uptime: '3 days', ssh: id, gpus, baseCron: [], compose: [], containers: [], vms: []}, over);
  const c = (id, name, u, g, status = 'Up 2 hours') => ({id, name, image: name + ':1', status, h: h(...u), gh: g});
  return {t: Date.now() / 1000, interval: 3, window_s: 180, pins: [], machines: [
    m('host', 'lab-host', 16, 64, [{name: 'NVIDIA RTX A4000', mem: '16 GB VRAM'}, {name: 'NVIDIA RTX A2000', mem: '12 GB VRAM'}], {
      base: {id: 'host/base', h: h(2, 8, 30, 10, 1), gh: gh(5, 25)},
      baseCron: [{id: 'host/base/cron/0', name: 'render.sh', sched: '*/5 * * * *', human: 'every 5 minutes', running: true, h: h(0.5, 1, 20, 2, 0), gh: gh(0, 20)},
                 {id: 'host/base/cron/1', name: 'backup.sh', sched: '0 3 * * *', human: 'at 03:00', running: false, h: h(0, 0, 0, 0, 0), gh: gh(0, 0)}],
      compose: [{id: 'host/compose/ml', name: 'ml', file: '/srv/ml/compose.yaml', services: [
        c('host/compose/ml/trainer', 'trainer', [4, 12, 90, 5, 0.5], gh(85, 5)), c('host/compose/ml/db', 'db', [0.5, 2, 0, 3, 0.2], gh(0, 0))]}],
      containers: [c('host/containers/web', 'web', [0.3, 1, 0, 1, 2], gh(0, 0)), c('host/containers/old', 'old', [0, 0, 0, 0, 0], gh(0, 0), 'Exited (0) 2 days ago')],
      vms: [
        m('vm1', 'vm1', 4, 16, [{name: 'NVIDIA GRID vGPU', mem: '4 GB VRAM'}], {tile: 'vm', base: {id: 'vm1/base', h: h(1, 3, 40, 1, 0.5), gh: gh(40)},
          containers: [c('vm1/containers/app', 'app', [0.5, 2, 5, 0, 0.5], gh(5))], hostside: h(2, 16, 50, 4, 1), hostside_gh: gh(0, 50)}),
        m('host/vms/other', 'other', 16, 64, [], {tile: 'vm', agent: 'seen from the host', cap: [16, 64, 0, 1, 1],
          base: {id: 'host/vms/other/base', h: h(0.5, 4, 0, 0, 0)}, hostside_gh: gh(0, 0)})]}),
    m('nog', 'lab-nogpu', 8, 32, [], {base: {id: 'nog/base', h: h(1, 4, 0, 2, 0.5), gh: {}}, containers: [c('nog/containers/web', 'web', [0.2, 1, 0, 0, 0.1], {})]})
  ]};
}

// Saved UI state for a test page (what app.js keeps in localStorage).
export function ui(over = {}){
  return Object.assign({space: 'fleet', sel: 'lx', metric: 'cpu', view: 'overview', mode: 'cap', open: {}, tree: 'machines',
    netSel: 'net:tailnet', cpuView: 'type', sort: {k: 'cpu', dir: -1}, group: 'none', filter: ''}, over);
}

// The PIDs listed in the Details table, top to bottom.
// Rows carry data-pid: Details columns can be reordered or hidden, so PID isn't always the 2nd cell.
export const PIDS = `[...document.querySelectorAll('.ptbl tbody tr[data-pid]')].map(r => +r.dataset.pid)`;
export const byCpuDesc = rows => rows.slice().sort((a, b) => b[4] - a[4]).map(p => p[0]);
