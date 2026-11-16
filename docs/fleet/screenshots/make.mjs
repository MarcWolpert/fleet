// SPDX-License-Identifier: GPL-3.0-or-later
// The README's screenshot tour (#282): a made-up fleet, drawn by Fleet Live's own page.
//
//   node docs/fleet/screenshots/make.mjs            every picture, into this folder
//   node docs/fleet/screenshots/make.mjs gpus net   just those
//   FLEET_SHOTS_OUT=dir node ...                    somewhere else, to compare before replacing them
//
// Nothing here reads a machine or starts a Fleet server: the page runs against the browser test harness's fixture
// server (live/tests/web/harness.mjs), which answers /api/* from the demo data below. Everything in it is invented:
// machine, project and container names are generic, every address comes from the documentation ranges
// (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24), and paths are a server's, never a home directory's.
// Needs Node 22+ and a Chromium (the harness says how one is found). Pictures are taken at 2x.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch, sleep} from '../../../live/tests/web/harness.mjs';
import {ui} from '../../../live/tests/web/fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const H = 60, GB = 1024 ** 3, NOW = Date.now() / 1000;

/* ---------- gentle, repeatable histories ---------- */
// The same numbers every run: a small seeded generator, keyed by the series' name.
function rng(key){
  let s = [...key].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// 60 readings that wander slowly around v (by about ±amp of it) and end on v, the value shown as "now"
function wave(key, v, amp = 0.15){
  if (!v) return new Array(H).fill(0);
  const r = rng(key), raw = [];
  let x = 0, dx = 0;
  for (let i = 0; i < H; i++){ dx = dx * 0.75 + (r() - 0.5) * 0.6; x = x * 0.9 + dx; raw.push(x); }
  const m = Math.max(...raw.map(Math.abs)) || 1, last = raw[H - 1] / m;
  return raw.map(p => Math.max(0, v * (1 + amp * (p / m - last))));
}
// a node's usage, [CPU cores, memory GB, GPU %, disk MB/s, network MB/s], as five histories
function use(key, [cpu, mem, gpu, disk, net], amp = 0.18){
  return {cpu: wave(key + ':cpu', cpu, amp), mem: wave(key + ':mem', mem, 0.03), gpu: wave(key + ':gpu', gpu, amp), disk: wave(key + ':disk', disk, 0.45), net: wave(key + ':net', net, 0.4)};
}
const sum = (...hs) => hs.reduce((a, h) => a.map((v, i) => v + h[i]), new Array(H).fill(0));
const flat = v => new Array(H).fill(v);

/* ---------- the demo fleet ---------- */
// home-server: a Linux box with two GPUs (an NVIDIA card for the photo library's ML, an Intel one for media
// transcoding), 24 logical CPUs in two CCDs, two Compose projects, three containers and three VMs, one of which
// (app-vm) Fleet also reads over SSH. studio is the Mac Fleet runs on; workstation a Windows PC; backup-box a
// small ARM board.
const HS = 'home-server';
const CCD0 = [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17], CCD1 = [6, 7, 8, 9, 10, 11, 18, 19, 20, 21, 22, 23];
const HS_GROUPS = [{name: 'CCD 0', cpus: CCD0}, {name: 'CCD 1', cpus: CCD1}];
const JOB = {thumbs: HS + '/base/cron/thumbnails-5f1c09a2', certbot: HS + '/base/cron/certbot-renew-0b7e44d1', check: HS + '/base/cron/restic-check-9a3d27c6'};

function svc(id, name, image, u, gpu = {}){
  const h = use(id, u);
  return {id, name, image, status: 'Up 6 days', h, gh: Object.fromEntries(Object.entries(gpu).map(([k, v]) => [k, wave(id + ':' + k, v, 0.2)]))};
}
function noGpu(n){ return {gpu0: flat(0), gpu1: flat(0)}; }

function homeServer(){
  const ml = svc(HS + '/compose/photos/ml', 'ml', 'ghcr.io/example/photos-ml:1.4', [2.6, 5.1, 38, 0.6, 0.1], {gpu0: 38});
  const media = svc(HS + '/containers/media', 'media', 'example/media-server:10.9', [1.1, 1.9, 31, 14, 6.5], {gpu1: 31});
  ml.h.gpu = ml.gh.gpu0; media.h.gpu = media.gh.gpu1;
  const job = (id, name, sched, human, cmd, src, last, u) => ({id, name, sched, human, cmd, src, last, running: !!u, state: '', h: use(id, u || [0, 0, 0, 0, 0], 0.5), gh: {gpu0: flat(0), gpu1: flat(0)}});
  const appVm = {id: 'app-vm', name: 'app-vm', tile: 'vm', status: 'ok', error: '', os: 'Ubuntu 24.04 LTS · x86_64', agent: 'ssh admin@app-vm', ssh: 'admin@app-vm', on: true,
    cronLabel: 'Cron jobs', cap: [4, 8, 0, 500, 125], ncpu: 4, cpu_model: 'QEMU Virtual CPU', groups: [], has_data: true, last_ok: NOW, uptime: '6 days', gpus: [],
    base: {id: 'app-vm/base', h: use('app-vm/base', [0.45, 2.1, 0, 1.0, 0.3])}, baseCron: [], compose: [],
    containers: [svc('app-vm/containers/api', 'api', 'example/api:2.3', [0.8, 1.5, 0, 0.5, 0.9]), svc('app-vm/containers/worker', 'worker', 'example/worker:2.3', [0.4, 1.1, 0, 0.8, 0.2])],
    vms: [], hostside: use('app-vm/hostside', [1.9, 8.2, 0, 2.5, 1.4]), hostside_gh: noGpu()};
  const seen = (name, cap, u) => ({id: HS + '/vms/' + name, name, tile: 'vm', status: 'ok', error: '', os: 'VM', agent: 'seen from the host', cap, gpus: [], cronLabel: 'Cron jobs',
    base: {id: HS + '/vms/' + name + '/base', h: use(HS + '/vms/' + name, u)}, baseCron: [], compose: [], containers: [], vms: [], hostside_gh: noGpu()});
  return {id: HS, name: HS, tile: 'server', status: 'ok', error: '', os: 'Ubuntu 24.04 LTS · x86_64', agent: 'ssh admin@home-server', ssh: 'admin@home-server', on: true,
    cronLabel: 'Cron jobs', cap: [24, 64, 200, 1000, 125], ncpu: 24, cpu_model: 'AMD Ryzen 9 7900X 12-Core Processor', groups: HS_GROUPS, has_data: true, last_ok: NOW, uptime: '23 days',
    gpus: [{name: 'NVIDIA GeForce RTX 4070', mem: '12 GB VRAM', m: nvidia(ml.gh.gpu0)}, {name: 'Intel Arc A380', mem: '6 GB VRAM', m: arc(media.gh.gpu1)}],
    base: {id: HS + '/base', h: use(HS + '/base', [0.8, 5.2, 0, 3.0, 0.4]), gh: {gpu0: flat(0), gpu1: flat(0)}},
    baseCron: [
      job(JOB.certbot, 'certbot-renew', '*-*-* 00,12:00:00', 'twice a day', 'certbot renew --quiet', 'systemd timer', 'next 12:00'),
      job(JOB.check, 'restic-check', '30 4 * * 0', 'Sundays at 04:30', '/srv/scripts/restic-check.sh', 'crontab (root)', 'next Sun 04:30'),
      job(JOB.thumbs, 'thumbnails', '*/15 * * * *', 'every 15 minutes', '/srv/scripts/thumbnails.sh', 'crontab (root)', 'running since 2 min', [0.55, 0.3, 0, 6.0, 0])],
    compose: [
      {id: HS + '/compose/gitea', name: 'gitea', file: '/srv/gitea/compose.yaml', services: [
        svc(HS + '/compose/gitea/gitea', 'gitea', 'gitea/gitea:1.22', [0.15, 0.45, 0, 0.3, 0.2]), svc(HS + '/compose/gitea/db', 'db', 'postgres:16', [0.05, 0.3, 0, 0.2, 0.1])]},
      {id: HS + '/compose/photos', name: 'photos', file: '/srv/photos/compose.yaml', services: [
        svc(HS + '/compose/photos/db', 'db', 'postgres:16', [0.45, 2.8, 0, 9.5, 0.5]), ml,
        svc(HS + '/compose/photos/redis', 'redis', 'redis:7', [0.12, 0.35, 0, 0.1, 0.6]), svc(HS + '/compose/photos/server', 'server', 'ghcr.io/example/photos-server:1.4', [0.9, 1.6, 0, 1.2, 1.8])]}],
    containers: [svc(HS + '/containers/backup', 'backup', 'restic/restic:0.17', [0.35, 0.6, 0, 22, 3.2]), media, svc(HS + '/containers/uptime', 'uptime', 'example/uptime:2', [0.04, 0.15, 0, 0, 0.02])],
    vms: [appVm, seen('ci-vm', [2, 4, 0, 500, 125], [0.3, 4.1, 0, 0.4, 0.1]), seen('dev-vm', [4, 8, 0, 500, 125], [1.1, 6.1, 0, 1.0, 0.3])]};
}
// Each GPU's tiles: most of what nvidia-smi gives for the RTX 4070 (busy with the photo library's ML; the memory
// controller and memory clock left out to keep the picture short), what i915/xe gives for the Arc A380 (decoding and
// encoding video)
function nvidia(util){
  const w = (k, v, a = 0.12) => wave('gpu0:' + k, v, a);
  return [['util', null, util], ['3d', null, w('3d', 2)], ['compute', null, util.map(v => v * 0.97)], ['copy', null, w('copy', 4, 0.4)], ['encode', null, flat(0)], ['decode', null, flat(0)],
    ['vram', 12 * GB, w('vram', 7.4 * GB, 0.03)], ['temp', null, w('temp', 61, 0.04)], ['power', 200, w('power', 96)], ['clock', 2475, w('clock', 2310, 0.05)],
    ['fan', null, w('fan', 38, 0.06)]];
}
function arc(util){
  const w = (k, v, a = 0.15) => wave('gpu1:' + k, v, a);
  return [['util', null, util], ['3d', null, w('3d', 3)], ['copy', null, w('copy', 6, 0.4)], ['video', null, util.map(v => v * 0.9)], ['vpp', null, w('vpp', 12)],
    ['temp', null, w('temp', 52, 0.04)], ['power', 75, w('power', 27)], ['clock', 2450, w('clock', 2000, 0.06)]];
}
function studio(){
  const id = 'studio', job = id + '/base/cron/brew-update-3c2e8f10';
  return {id, name: id, tile: 'desktop', status: 'ok', error: '', os: 'macOS 26.1 · arm64', agent: 'local', ssh: '', on: true, cronLabel: 'Cron & launchd jobs',
    cap: [16, 64, 100, 3000, 125], ncpu: 16, cpu_model: 'Apple M4 Max', has_data: true, last_ok: NOW, uptime: '4 days',
    groups: [{name: 'Performance cores', cpus: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]}, {name: 'Efficiency cores', cpus: [0, 1, 2, 3]}],
    gpus: [{name: 'Apple M4 Max GPU', mem: 'unified memory'}], base: {id: id + '/base', h: use(id + '/base', [2.4, 31, 14, 6, 0.8]), gh: {gpu0: wave(id + ':g', 14)}},
    baseCron: [{id: job, name: 'brew-update', sched: '0 9 * * *', human: 'daily at 09:00', cmd: 'brew update', src: 'launchd', last: 'next 09:00', running: false, h: use(job, [0, 0, 0, 0, 0]), gh: {gpu0: flat(0)}}],
    compose: [], containers: [], vms: []};
}
function workstation(){
  const id = 'workstation';
  return {id, name: id, tile: 'desktop', status: 'ok', error: '', os: 'Windows 11 Pro · AMD64', agent: 'ssh admin@workstation', ssh: 'admin@workstation', on: true, cronLabel: 'Scheduled tasks',
    cap: [28, 32, 100, 1500, 312], ncpu: 28, cpu_model: 'Intel Core i7-14700K', has_data: true, last_ok: NOW, uptime: '2 days',
    groups: [{name: 'Performance cores', cpus: [...Array(16).keys()]}, {name: 'Efficiency cores', cpus: [...Array(12).keys()].map(i => i + 16)}],
    gpus: [{name: 'NVIDIA GeForce RTX 4080', mem: '16 GB VRAM'}], base: {id: id + '/base', h: use(id + '/base', [3.1, 18.5, 22, 9, 1.1]), gh: {gpu0: wave(id + ':g', 22)}},
    baseCron: [], compose: [], containers: [], vms: []};
}
function backupBox(){
  const id = 'backup-box';
  return {id, name: id, tile: 'server', status: 'ok', error: '', os: 'Debian 12 · aarch64', agent: 'ssh admin@backup-box', ssh: 'admin@backup-box', on: true, cronLabel: 'Cron jobs',
    cap: [4, 8, 0, 200, 125], ncpu: 4, cpu_model: 'Cortex-A76', groups: [], gpus: [], has_data: true, last_ok: NOW, uptime: '41 days',
    base: {id: id + '/base', h: use(id + '/base', [0.3, 1.2, 0, 1.5, 0.2])}, baseCron: [], compose: [],
    containers: [svc(id + '/containers/sync', 'sync', 'example/sync:1.27', [0.25, 0.4, 0, 18, 3.1])], vms: []};
}

/* /api/procs: [pid, name, user, state, CPU cores, memory GB, disk MB/s, GPU %, threads, command, tree node, ppid, last CPU, [GPUs], [disks], [interfaces], network MB/s] */
function hsProcs(){
  const P = HS + '/compose/photos/', G = HS + '/compose/gitea/', C = HS + '/containers/', B = HS + '/base';
  const p = (pid, name, user, state, cpu, mem, disk, gpu, thr, cmd, node, ppid, last, gpus = [], net = 0) => [pid, name, user, state, cpu, mem, disk, gpu, thr, cmd, node, ppid, last, gpus, disk ? ['nvme0n1'] : [], net ? ['br0'] : [], net];
  return [
    p(3120, 'python3', 'root', 'R', 2.42, 4.8, 0.6, 38, 46, 'python3 -m ml.worker --device cuda:0 --batch 32', P + 'ml', 3101, 2, [0], 0.05),
    p(3184, 'python3', 'root', 'S', 0.18, 0.3, 0, 0, 4, 'python3 -m ml.api --port 3003', P + 'ml', 3101, 14, [], 0.05),
    p(2961, 'node', 'root', 'S', 0.62, 1.2, 0.8, 0, 22, 'node /app/dist/main.js', P + 'server', 2940, 7, [], 1.2),
    p(2988, 'node', 'root', 'S', 0.28, 0.4, 0.4, 0, 11, 'node /app/dist/workers.js', P + 'server', 2940, 19, [], 0.6),
    p(2874, 'redis-server', 'redis', 'S', 0.12, 0.35, 0.1, 0, 5, 'redis-server *:6379', P + 'redis', 2851, 9, [], 0.6),
    p(2790, 'postgres', 'postgres', 'S', 0.04, 0.9, 0, 0, 1, 'postgres -c shared_buffers=1GB', P + 'db', 2771, 4),
    p(3311, 'postgres', 'postgres', 'R', 0.31, 0.6, 7.9, 0, 1, 'postgres: photos SELECT', P + 'db', 2790, 15, [], 0.4),
    p(2802, 'postgres', 'postgres', 'S', 0.06, 0.8, 1.4, 0, 1, 'postgres: checkpointer', P + 'db', 2790, 3),
    p(2803, 'postgres', 'postgres', 'S', 0.04, 0.5, 0.2, 0, 1, 'postgres: walwriter', P + 'db', 2790, 21),
    p(4410, 'media-server', 'root', 'S', 0.35, 1.4, 1.2, 0, 38, '/app/bin/media-server --datadir /config', C + 'media', 4391, 10, [], 0.4),
    p(5127, 'ffmpeg', 'root', 'R', 0.74, 0.5, 12.8, 31, 9, 'ffmpeg -hwaccel qsv -i /media/films/sample.mkv -c:v hevc_qsv -f hls /transcode/stream.m3u8', C + 'media', 4410, 20, [1], 6.1),
    p(6002, 'restic', 'root', 'R', 0.33, 0.6, 22, 0, 12, 'restic backup /srv --tag nightly', C + 'backup', 5990, 8, [], 3.2),
    p(4502, 'uptime', 'root', 'S', 0.04, 0.15, 0, 0, 7, 'uptime-monitor --config /etc/uptime.yaml', C + 'uptime', 4490, 1, [], 0.02),
    p(3501, 'gitea', 'git', 'S', 0.15, 0.45, 0.3, 0, 14, '/usr/local/bin/gitea web', G + 'gitea', 3480, 5, [], 0.2),
    p(3530, 'postgres', 'postgres', 'S', 0.05, 0.3, 0.2, 0, 1, 'postgres', G + 'db', 3512, 18),
    p(7031, 'qemu-system-x86', 'libvirt-qemu', 'S', 1.9, 8.2, 2.5, 0, 9, 'qemu-system-x86_64 -name guest=app-vm -m 8192 -smp 4', 'app-vm', 1, 11, [], 1.4),
    p(7088, 'qemu-system-x86', 'libvirt-qemu', 'S', 1.1, 6.1, 1.0, 0, 9, 'qemu-system-x86_64 -name guest=dev-vm -m 8192 -smp 4', HS + '/vms/dev-vm', 1, 23, [], 0.3),
    p(7140, 'qemu-system-x86', 'libvirt-qemu', 'S', 0.3, 4.1, 0.4, 0, 7, 'qemu-system-x86_64 -name guest=ci-vm -m 4096 -smp 2', HS + '/vms/ci-vm', 1, 6, [], 0.1),
    p(8120, 'magick', 'root', 'R', 0.52, 0.3, 6.0, 0, 4, 'magick /srv/photos/upload/0f3a9c.heic -resize 1440x /srv/photos/thumbs/0f3a9c.webp', JOB.thumbs, 8117, 13),
    p(1210, 'dockerd', 'root', 'S', 0.21, 0.4, 0.3, 0, 31, '/usr/bin/dockerd -H fd://', B, 1, 16),
    p(1180, 'containerd', 'root', 'S', 0.09, 0.2, 0, 0, 24, '/usr/bin/containerd', B, 1, 22),
    p(1240, 'libvirtd', 'root', 'S', 0.03, 0.1, 0, 0, 19, '/usr/sbin/libvirtd --timeout 120', B, 1, 0),
    p(980, 'tailscaled', 'root', 'S', 0.04, 0.1, 0, 0, 15, '/usr/sbin/tailscaled --state=/var/lib/tailscale/tailscaled.state', B, 1, 12, [], 0.1),
    p(1, 'systemd', 'root', 'S', 0.01, 0.05, 0, 0, 1, '/sbin/init', B, 0, 1),
    p(1002, 'sshd', 'root', 'S', 0.0, 0.01, 0, 0, 1, 'sshd: /usr/sbin/sshd -D', B, 1, 17)];
}

// /api/cpus: home-server's 24 logical processors, CCD 0 a little busier than CCD 1
function hsCpus(){
  const cpus = [...CCD0, ...CCD1].sort((a, b) => a - b).map(n => {
    const base = CCD0.includes(n) ? 46 : 33, r = rng('cpu' + n), v = Math.min(96, Math.max(6, base + (r() - 0.5) * 50));
    return {n, mhz: Math.round(4700 + (r() - 0.5) * 900), core: String(n % 12), pct: v, h: wave('cpu' + n, v, 0.45).map(x => Math.min(100, x))};
  });
  return {model: 'AMD Ryzen 9 7900X 12-Core Processor', groups: HS_GROUPS, cpus};
}

// /api/proc: the ML worker, as inspect_linux.py reports it. It runs most of the time, but its instructions per cycle
// are low and a third of its cache references miss: it stalls on memory.
function mlWorker(){
  return {pid: 3120, name: 'python3', state: 'R', ppid: 3101, nice: 0, priority: 20, threads_n: 46, started: NOW - 6 * 86400 - 3 * 3600, last_cpu: 2, user: 'root',
    cmdline: 'python3 -m ml.worker --device cuda:0 --batch 32', exe: '/usr/local/bin/python3.12', cwd: '/app', affinity: '0-23',
    cpu: {user: 2.08, system: 0.34, ctx_vol: 860, ctx_invol: 140, run_s: 2.3, runq_s: 0.03},
    mem: {rss: 4.8 * GB, anon: 4.1 * GB, file: 0.7 * GB, shmem: 0, swap: 0, peak: 6.2 * GB, virt: 38 * GB, minflt: 1400, majflt: 0},
    io: {read: 0.6e6, write: 0.1e6, rchar: 2.4e6, blkio_delay: 0.01, delayacct: true},
    waits: {cpu: 11, gpu: 3, lock: 1, events: 1}, samples: 16, dt: 1.6,
    threads: [{tid: 3120, name: 'python3', cpu: 0.92, doing: 'cpu'}, {tid: 3138, name: 'worker-0', cpu: 0.61, doing: 'cpu'}, {tid: 3139, name: 'worker-1', cpu: 0.58, doing: 'cpu'},
      {tid: 3152, name: 'cuda-events', cpu: 0.07, doing: 'gpu'}, {tid: 3160, name: 'loader-0', cpu: 0.05, doing: 'lock'}],
    fds: 212, fd_limit: 1048576, files: ['/cache/models/clip-b32.bin', '/srv/photos/upload/0f3a9c.heic'],
    conns: [{proto: 'tcp', local: '203.0.113.21:41822', remote: '203.0.113.12:6379', state: 'established'}, {proto: 'tcp', local: '203.0.113.21:52210', remote: '203.0.113.13:5432', state: 'established'}], conns_n: 2,
    cgroup: {path: '/system.slice/docker-7c41e0b9a3d2.scope', cpu_limit: null, mem_limit: 8 * 1e9, mem_current: 5.1 * 1e9, throttled: 0, oom_kills: 0,
      pressure: {cpu: {some: {avg10: 4, avg60: 5, avg300: 5}}, memory: {some: {avg10: 1, avg60: 1, avg300: 0}}, io: {some: {avg10: 0, avg60: 0, avg300: 0}}}},
    cache: {refs: 2.1e7, misses: 7.1e6, miss_pct: 0.34, ipc: 0.62, threads: 46}, cache_error: '', machine: HS, t: NOW};
}

// /api/net: the tailnet, each machine's interfaces, bridges and what's attached to them
function net(){
  const ifc = (key, name, kind, rx, tx, extra = {}) => Object.assign({name, kind, rx, tx, addrs: [], state: 'up', speed: '', master: '', hrx: wave(key + name + ':rx', rx, 0.35), htx: wave(key + name + ':tx', tx, 0.35)}, extra);
  const m = (id, ip, extra) => Object.assign({id, name: id, status: 'ok', tailscale: {ip, online: true, direct: true}, ifs: [], containers: [], vms: [], dockernets: []}, extra);
  const c = (name, networks, rx, tx) => ({name, networks, net: rx + tx, rx, tx});
  return {tailnet: 'example.ts.net', machines: [
    m(HS, '198.51.100.10', {
      ifs: [ifc(HS, 'lo', 'loopback', 1, 1), ifc(HS, 'eno1', 'physical', 9.6, 4.1, {master: 'br0', speed: '2500'}), ifc(HS, 'br0', 'bridge', 9.6, 4.1, {addrs: ['192.0.2.10/24']}),
        ifc(HS, 'vnet0', 'virtual', 0.9, 0.5, {master: 'br0'}), ifc(HS, 'vnet1', 'virtual', 0.2, 0.1, {master: 'br0'}), ifc(HS, 'vnet2', 'virtual', 0.06, 0.04, {master: 'br0'}),
        ifc(HS, 'docker0', 'bridge', 5.9, 3.8), ifc(HS, 'br-6f1d2e3a4b5c', 'bridge', 1.6, 1.4), ifc(HS, 'br-0a9b8c7d6e5f', 'bridge', 0.2, 0.1),
        ifc(HS, 'tailscale0', 'virtual', 0.8, 2.6, {addrs: ['198.51.100.10/32']}), ifc(HS, 'veth1a2b3c', 'virtual', 1, 1, {master: 'docker0'})],
      vms: [{name: 'app-vm', ifs: [{if: 'vnet0'}]}, {name: 'dev-vm', ifs: [{if: 'vnet1'}]}, {name: 'ci-vm', ifs: [{if: 'vnet2'}]}],
      dockernets: [{name: 'bridge', id: 'f00dfeedbeef', driver: 'bridge'}, {name: 'photos_default', id: '6f1d2e3a4b5c', driver: 'bridge'}, {name: 'gitea_default', id: '0a9b8c7d6e5f', driver: 'bridge'}],
      containers: [c('backup', 'bridge', 0.1, 3.1), c('media', 'bridge', 0.4, 6.1), c('uptime', 'bridge', 0.01, 0.01),
        c('photos-server-1', 'photos_default', 0.7, 1.1), c('photos-ml-1', 'photos_default', 0.08, 0.02), c('photos-redis-1', 'photos_default', 0.3, 0.3), c('photos-db-1', 'photos_default', 0.25, 0.25),
        c('gitea', 'gitea_default', 0.1, 0.1), c('gitea-db', 'gitea_default', 0.05, 0.05)]}),
    m('studio', '198.51.100.20', {ifs: [ifc('studio', 'lo0', 'loopback', 1, 1), ifc('studio', 'en0', 'physical', 0.5, 0.3, {addrs: ['192.0.2.20/24'], speed: '10000'}), ifc('studio', 'utun4', 'virtual', 0.2, 0.1, {addrs: ['198.51.100.20/32']})]}),
    m('workstation', '198.51.100.30', {ifs: [ifc('workstation', 'Ethernet', 'physical', 0.7, 0.4, {addrs: ['192.0.2.30/24'], speed: '2500', desc: 'Intel Ethernet Controller I226-V'}), ifc('workstation', 'Tailscale', 'virtual', 0.1, 0.05, {addrs: ['198.51.100.30/32']})]}),
    m('backup-box', '198.51.100.40', {ifs: [ifc('backup-box', 'eth0', 'physical', 3.1, 0.2, {addrs: ['192.0.2.40/24'], speed: '1000'}), ifc('backup-box', 'docker0', 'bridge', 3.0, 0.1), ifc('backup-box', 'tailscale0', 'virtual', 0.05, 0.05, {addrs: ['198.51.100.40/32']})],
      containers: [c('sync', 'bridge', 3.0, 0.1)], dockernets: [{name: 'bridge', id: 'b0b0b0b0b0b0', driver: 'bridge'}]})]};
}

// /api/config: machines.toml as Settings and + Add a machine see it
function config(){
  return {path: '~/.config/fleet/machines.toml', interval: 3, terminal: 'auto', terminals: [['terminal', 'Terminal']], terminal_auto: 'Terminal',
    machines: [{id: 'studio', name: 'studio', kind: 'local', tile: 'desktop'}, {id: HS, name: HS, ssh: 'admin@home-server', os: 'linux', tile: 'server'},
      {id: 'app-vm', name: 'app-vm', ssh: 'admin@app-vm', os: 'linux', tile: 'vm', vm_on: HS}, {id: 'workstation', name: 'workstation', ssh: 'admin@workstation', os: 'windows', tile: 'desktop'},
      {id: 'backup-box', name: 'backup-box', ssh: 'admin@backup-box', os: 'linux', tile: 'server'}],
    status: Object.fromEntries([HS, 'app-vm', 'workstation', 'backup-box', 'studio'].map(id => [id, {status: 'ok', error: ''}]))};
}

// Groups in the tree (prefs.tgroups, '<tree>|<parent>'): a fleet of two machines at the top, a flotilla of two VMs and a
// division of two containers on home-server
const TGROUPS = {
  'machines|root': [{id: 'lab', name: 'Home lab', c: 0, ids: [HS, 'backup-box']}],
  [`machines|${HS}/vms`]: [{id: 'devvms', name: 'Dev VMs', c: 1, ids: [HS + '/vms/dev-vm', HS + '/vms/ci-vm']}],
  [`machines|${HS}/containers`]: [{id: 'services', name: 'Services', c: 2, ids: [HS + '/containers/media', HS + '/containers/uptime']}]};
const CONNECT = {auto: 'Always on', presets: {'Always on': [HS, 'app-vm', 'backup-box']}, starts: [HS, 'app-vm', 'backup-box']};

function demo({prefs = {}, pins = ['app-vm', HS + '/compose/photos']} = {}){
  return {
    fleet: {t: NOW, interval: 3, window_s: 180, pins, prefs, connect: CONNECT, machines: [backupBox(), homeServer(), studio(), workstation()]},
    procs: {[HS]: {procs: hsProcs(), gpu_procs: true}},
    cpus: {[HS]: hsCpus()},
    net: net(),
    config: config(),
    proc: (mid, pid) => mid === HS && +pid === 3120 ? mlWorker() : {pid, error: 'not in the demo'}
  };
}

/* ---------- the pictures ---------- */
// Each: the window (width, height; 1440 x 900 by default), the saved UI state (ui), the demo's prefs and pins, what to
// do once the page is up (act), and either the whole window or one dialog on its own (float: shown without the page
// behind it, on a transparent background).
const CLOSED = {studio: false, workstation: false, 'backup-box': false};
const evalClick = sel => `(() => { document.querySelector(${JSON.stringify(sel)}).click(); return true; })()`;
// scroll the main pane so the card holding sel starts at its top
const toCard = sel => p => p.eval(`(() => { const c = document.querySelector(${JSON.stringify(sel)}).closest('.card'), m = document.getElementById('main'); m.scrollTop += c.getBoundingClientRect().top - m.getBoundingClientRect().top - 16; return true; })()`);
const SHOTS = {
  // The hero: All machines, the tree with home-server open, and where the fleet's usage goes.
  fleet: {ui: {sel: 'fleet', open: Object.assign({[HS + '/base']: true, [HS + '/compose']: true, [HS + '/compose/photos']: false, [HS + '/containers']: true, 'app-vm': false}, CLOSED)}},
  // A machine's page, CPU → Logical processors, grouped by CCD.
  cpus: {height: 1012, ui: {sel: HS, metric: 'cpu', cpuView: 'logical', open: Object.assign({[HS + '/vms']: false}, CLOSED)},
    ready: `document.querySelectorAll('[data-lcpu]').length === 24`},
  // GPU → Each GPU: a group of live tiles per GPU.
  gpus: {width: 1500, ui: {sel: HS, metric: 'gpu', gpuView: 'each', open: Object.assign({[HS + '/vms']: false}, CLOSED)},
    ready: `document.querySelectorAll('.ggroups > .ggroup').length === 2`, act: toCard('.ggroups')},
  // Details docked beside a Compose project, the ML worker's drop-down open.
  details: {height: 1030, ui: {sel: HS + '/compose/photos', detailsDocked: true, dockW: 760, open: Object.assign({[HS + '/compose']: true, [HS + '/compose/photos']: true, [HS + '/vms']: false}, CLOSED)},
    prefs: {columns: {cpu: ['name', 'pid', 'owner', 'state', 'cpu', 'mem', 'threads']}},
    ready: `document.querySelectorAll('.ptbl tbody tr[data-pid]').length === 9`,
    act: async p => { await p.eval(evalClick('tr[data-pid="3120"] td:nth-child(4)')); await p.waitFor(`document.querySelector('tr.pinsp [data-verdict="membw"]')`); }},
  // Groups: a fleet, a flotilla and a division, each outlined in its kind's colour; the fleet pinned as a space.
  groups: {ui: {sel: 'div:lab', open: Object.assign({[HS + '/containers']: true, [HS + '/vms']: true, 'app-vm': false}, CLOSED)},
    prefs: {tgroups: TGROUPS}, pins: ['div:lab', HS + '/compose/photos', 'app-vm'], ready: `document.querySelectorAll('#tree .tgroup').length === 3`},
  // The network tree, in a light theme: home-server's bridges, what's attached to each.
  net: {ui: {sel: 'fleet', tree: 'network', netSel: 'net:if:home-server:br0', open: Object.assign({'net:m:backup-box': false, 'net:m:studio': false, 'net:m:workstation': false,
    'net:if:home-server:br0': true, 'net:if:home-server:br-6f1d2e3a4b5c': true, 'net:if:home-server:br-0a9b8c7d6e5f': false, 'net:if:home-server:docker0': false})},
    prefs: {theme: 'github-light'}, ready: `document.querySelectorAll('#tree .row[data-netsel]').length > 10 && document.querySelector('#main .tbl')`},
  // Auto → Choose machines…: which machines Fleet connects to when it starts.
  connect: {ui: {sel: 'fleet', open: CLOSED},
    act: async p => { await p.eval(`(openChooseMachines(), true)`); await p.waitFor(`document.querySelector('#choosem [data-chm]')`); },
    float: '#choosem'},
  // Settings → Appearance: themes, colour vision and contrast.
  appearance: {height: 990, ui: {sel: 'fleet', open: CLOSED},
    act: async p => {
      await p.eval(evalClick('[data-settings]')); await p.waitFor(`document.querySelectorAll('.thsw-b').length > 0`);
      await p.eval(`(() => { const b = document.querySelector('#sheet .sheet-b'), s = document.querySelector('.thgrid').closest('section'); b.scrollTop += s.getBoundingClientRect().top - b.getBoundingClientRect().top; return true; })()`);
    }, float: '#sheet .sheet'}
};

// Text in view that the page cut short with an ellipsis, printed so each picture can be checked. A few are the page's
// own design (a long GPU name in a usage card, a Docker bridge's name beside its network's tag); anything else is a sign
// the window is too narrow for that view.
const CUT = `[...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.bottom > 0 && r.top < innerHeight && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow === 'ellipsis' && !e.closest('[hidden]'); }).map(e => e.textContent.trim().slice(0, 40))`;

async function shoot(browser, name, spec, out){
  const width = spec.width || 1440, height = spec.height || 900;
  const fx = demo({prefs: spec.prefs || {}, pins: spec.pins});
  const p = await browser.page(fx, {ui: ui(spec.ui), width, height});
  try {
    await p.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 2, mobile: false});
    await p.waitFor(`document.querySelectorAll('#tree .row').length > 0`);
    if (spec.ready) await p.waitFor(spec.ready, 10000);
    if (spec.act) await spec.act(p);
    await sleep(2500);   // a poll or two: every card drawn with the data in place
    let clip = {x: 0, y: 0, width, height};
    if (spec.float){   // the dialog alone: nothing behind it, no shadow, no focus ring
      await p.send('Emulation.setDefaultBackgroundColorOverride', {color: {r: 0, g: 0, b: 0, a: 0}});
      clip = await p.eval(`(() => { const st = document.createElement('style'); st.textContent = 'html, body { background: transparent !important; } body > :not(.sheet-bg) { visibility: hidden !important; } .sheet-bg { background: transparent !important; backdrop-filter: none !important; } .sheet { box-shadow: none !important; }'; document.head.appendChild(st); document.activeElement && document.activeElement.blur(); const r = document.querySelector(${JSON.stringify(spec.float)}).getBoundingClientRect(); return {x: r.left, y: r.top, width: r.width, height: r.height}; })()`);
    }
    const cut = await p.eval(CUT);
    if (cut.length) console.warn(`${name}: cut short: ${cut.join(' | ')}`);
    const {data} = await p.send('Page.captureScreenshot', {format: 'png', clip: Object.assign({scale: 1}, clip)});
    fs.writeFileSync(out, Buffer.from(data, 'base64'));
    if (p.errors.length) throw new Error(name + ': the page threw: ' + p.errors.join('; '));
  } finally { await p.close(); }
}

const want = process.argv.slice(2), names = want.length ? want : Object.keys(SHOTS);
for (const n of names) if (!SHOTS[n]) { console.error(`no picture called ${n}; there are: ${Object.keys(SHOTS).join(', ')}`); process.exit(2); }
const browser = await launch();
try {
  for (const n of names){
    const out = path.join(process.env.FLEET_SHOTS_OUT || HERE, n + '.png');
    await shoot(browser, n, SHOTS[n], out);
    console.log(`${path.relative(process.cwd(), out)}  ${Math.round(fs.statSync(out).size / 1024)} KB`);
  }
} finally { await browser.close(); }
