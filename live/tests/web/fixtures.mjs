// SPDX-License-Identifier: GPL-3.0-or-later
// Hand-made API answers shaped like a real Fleet Live server's (/api/fleet, /api/procs, /api/cpus, /api/disks, /api/ifs).
// Every test gets a fresh copy, so it may change the data between polls.
//
//   lx    Linux, 16 CPUs in two CCDs, two NVIDIA GPUs, two disks, two interfaces; reports the last CPU (p[12]) and GPUs (p[13]) per process
//   lx2   the "nothing else" control: same process names, CPUs and GPUs as lx, other PIDs
//   win   Windows: one GPU, per-process GPUs reported, the last CPU not (-1)
//   mac   macOS: one unified GPU, neither reported
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

// /api/disks and /api/ifs: lx's disks and interfaces, the ones its processes name
export function lxDisks(){
  const h = v => new Array(H).fill(v);
  return {per_process: true, disks: [
    {name: 'nvme0n1', model: 'Test NVMe SSD', size: 2e12, rot: false, role: 'system', mounts: ['/', '/boot'], read: 12.5, write: 3.2, busy: 18, hr: h(12.5), hw: h(3.2)},
    {name: 'sda', model: 'Test HDD', size: 8e12, rot: true, role: 'data', mounts: ['/mnt/data'], read: 0, write: 0.4, busy: 2, hr: h(0), hw: h(0.4)}]};
}
export function lxIfs(){
  const h = v => new Array(H).fill(v);
  return {per_process: true, ifs: [
    {name: 'eth0', kind: 'physical', rx: 2.5, tx: 0.8, addrs: ['10.0.0.2/24'], master: '', state: 'up', speed: '10000', hrx: h(2.5), htx: h(0.8), vm: '', dnet: '', members: 0, containers: 0},
    {name: 'docker0', kind: 'bridge', rx: 0.1, tx: 0.1, addrs: ['172.17.0.1/16'], master: '', state: 'up', speed: '-1', hrx: h(0.1), htx: h(0.1), vm: '', dnet: 'bridge', members: 0, containers: 1}]};
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
    cpus: {lx: cpusOf(groups2), lx2: cpusOf(groups2), win: cpusOf(winGroups), mac: cpusOf(macGroups)},
    disks: {lx: lxDisks(), lx2: lxDisks()},
    ifs: {lx: lxIfs(), lx2: lxIfs()}
  };
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
