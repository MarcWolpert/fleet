// SPDX-License-Identifier: GPL-3.0-or-later
// Disk I/O → Each disk and Network → Each interface (like Each GPU and Logical processors): a live tile per
// disk or interface; click one to see its traffic and the processes on it, click it again to let go, and
// ⌘/Ctrl- or Shift-click to pick several.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const H = 60, flat = v => new Array(H).fill(v);
const SHIFT = 8;
function disk(name, over){ return Object.assign({name, model: '', size: 0, rot: false, role: '', mounts: [], read: 0, write: 0, busy: 0, hr: flat(over.read || 0), hw: flat(over.write || 0)}, over); }
function nic(name, kind, over){ return Object.assign({name, kind, rx: 0, tx: 0, addrs: [], master: '', state: 'up', speed: '', hrx: flat(over.rx || 0), htx: flat(over.tx || 0), vm: '', dnet: '', members: 0, containers: 0}, over); }
function fx(){
  const f = fixture();
  f.disks.lx = {per_process: true, disks: [
    disk('sda', {model: 'Test HDD', size: 8e12, rot: true, role: 'data', mounts: ['/mnt/data'], write: 0.4, busy: 2}),
    disk('nvme0n1', {model: 'Test NVMe SSD', size: 2e12, role: 'system', mounts: ['/', '/boot', '/var'], read: 25, write: 3.2, busy: 18.4}),
    disk('sdc', {model: 'Test USB stick', size: 64e9, role: 'usb', busy: 0})]};
  f.disks.win = {per_process: false, disks: [disk('0 C:', {model: 'Test NVMe', size: 1e12, mounts: ['C:'], read: 1.5, busy: 4})]};
  f.disks.mac = {per_process: false, disks: [disk('disk0', {model: 'Test Apple SSD', size: 5e11, read: 2, busy: -1})]};
  f.ifs.lx = {per_process: true, ifs: [
    nic('vnet0', 'virtual', {speed: '10', vm: 'vm-a', rx: 0.002}),
    nic('docker0', 'bridge', {speed: '-1', dnet: 'bridge', addrs: ['172.17.0.1/16'], containers: 1}),
    nic('eth0', 'physical', {speed: '10000', addrs: ['10.0.0.2/24', 'fd00::2/64', 'fe80::2/64'], rx: 2.5, tx: 0.8}),
    nic('br0', 'bridge', {speed: '', members: 2}),
    nic('eth1', 'physical', {speed: '2500'}),
    nic('enp5s0', 'physical', {speed: '2500', state: 'down', master: 'br0'})]};
  f.ifs.win = {per_process: true, ifs: [
    nic('Ethernet', 'physical', {speed: '10 Gbps', addrs: ['10.0.0.3'], rx: 1, tx: 0.5}),
    nic('Wi-Fi', 'physical', {speed: '866.7 Mbps', state: 'Disconnected'}),
    nic('vEthernet (WSL)', 'virtual', {speed: '10 Gbps', desc: 'Hyper-V Virtual Ethernet Adapter'})]};
  return f;
}
const TILES = `[...document.querySelectorAll('.kgrid .kcell')].map(c => ({
  name: (c.querySelector('[data-dsel]') || c.querySelector('[data-isel]')).getAttribute(c.querySelector('[data-dsel]') ? 'data-dsel' : 'data-isel'),
  sel: c.classList.contains('sel'), down: c.classList.contains('down'),
  text: [...c.querySelectorAll('.kb, .km, .ks, .kr i')].map(x => x.textContent)}))`;
const CARD = `(() => {
  const s = [...document.querySelectorAll('section.card')].find(x => x.querySelector('[data-diskclear], [data-ifclear]'));
  if (!s) return {hint: [...document.querySelectorAll('.lhint')].map(h => h.textContent)};
  return {title: s.querySelector('h2').textContent, sub: s.querySelector('.card-h .sub').textContent, legend: [...s.querySelectorAll('.legend span')].map(x => x.textContent),
    heading: s.querySelector('h3.cpuproc').textContent,
    rows: [...s.querySelectorAll('table.tbl tbody tr')].map(r => [...r.cells].map(c => c.textContent)),
    say: [...s.querySelectorAll(':scope > .sub, :scope > .note')].map(x => x.textContent)};
})()`;
const sub = `document.querySelector('.kgrid').closest('section').querySelector('.card-h .sub').textContent`;
async function open(fxs, over, toggle){
  const p = await browser.page(fxs, {ui: ui(Object.assign({sel: 'lx'}, over))});
  try {
    await p.waitFor(`document.querySelector('[data-${toggle}="each"]')`);
    await p.click(`[data-${toggle}="each"]`);
    await p.waitFor(`document.querySelector('.kgrid .kcell')`);
  } catch (e) { await p.close(); throw e; }
  return p;
}
const settle = p => p.waitFor(`PROCS.machine === S.sel || !document.querySelector('[data-diskclear], [data-ifclear]')`).then(() => p.waitFor(`!/Loading processes/.test(document.querySelector('main').textContent)`));

test('Each disk: one tile per disk, by name, each with its role, model, size, kind, mounts and rates; nothing else', async () => {
  const p = await open(fx(), {metric: 'disk'}, 'diskview');
  try {
    assert.equal(await p.eval(sub), '3 disks · click one to see what uses it');
    assert.deepEqual(await p.eval(TILES), [
      {name: 'nvme0n1', sel: false, down: false, text: ['18% busy', 'system · Test NVMe SSD', '2.0 TB · SSD · / · /boot', '↓ 25 MB/s', '↑ 3.2 MB/s']},
      {name: 'sda', sel: false, down: false, text: ['2.0% busy', 'data · Test HDD', '8.0 TB · HDD · /mnt/data', '↓ 0', '↑ 400 KB/s']},
      {name: 'sdc', sel: false, down: false, text: ['0% busy', 'usb · Test USB stick', '64 GB · SSD', '↓ 0', '↑ 0']}]);
    assert.deepEqual(await p.eval(CARD), {hint: ['Click a disk to see its traffic and what uses it; ⌘/Ctrl- or Shift-click to pick several.']});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Each disk: a click picks one disk and lists the processes doing I/O on it; a second click lets go', async () => {
  const p = await open(fx(), {metric: 'disk'}, 'diskview');
  try {
    await p.click('[data-dsel="sda"]'); await settle(p);
    assert.deepEqual((await p.eval(TILES)).filter(t => t.sel).map(t => t.name), ['sda']);
    assert.deepEqual(await p.eval(CARD), {title: 'sda · data · Test HDD', sub: '↓ read and ↑ write, stacked', legend: ['read', 'write'], heading: 'Doing I/O on this disk',
      rows: [['ffmpeg', '106', 'Base system', '0', 'sda']], say: []});
    await p.click('[data-dsel="sdc"]'); await settle(p);
    assert.deepEqual(await p.eval(CARD), {title: 'sdc · usb · Test USB stick', sub: '↓ read and ↑ write, stacked', legend: ['read', 'write'], heading: 'Doing I/O on this disk',
      rows: [], say: ['No process did I/O on this disk in the last reading.']}, 'a plain click moves the pick');
    await p.click('[data-dsel="sdc"]');
    assert.deepEqual((await p.eval(TILES)).filter(t => t.sel).map(t => t.name), []);
    assert.deepEqual(await p.eval(CARD), {hint: ['Click a disk to see its traffic and what uses it; ⌘/Ctrl- or Shift-click to pick several.']});
    assert.deepEqual(await p.eval(`S.diskSel`), {mid: 'lx', names: []});
  } finally { await p.close(); }
});

test('Each disk: Shift-click adds a disk and takes it away again', async () => {
  const p = await open(fx(), {metric: 'disk'}, 'diskview');
  try {
    await p.click('[data-dsel="nvme0n1"]');
    await p.click('[data-dsel="sda"]', {modifiers: SHIFT}); await settle(p);
    assert.deepEqual((await p.eval(TILES)).filter(t => t.sel).map(t => t.name), ['nvme0n1', 'sda']);
    assert.deepEqual(await p.eval(CARD), {title: '2 disks: sda, nvme0n1', sub: '↓ read and ↑ write, stacked', legend: ['read', 'write'], heading: 'Doing I/O on these disks',
      rows: [['nginx', '101', 'web', '0', 'nvme0n1'], ['postgres', '103', 'Base system', '0', 'nvme0n1'], ['ffmpeg', '106', 'Base system', '0', 'sda'], ['redis-server', '111', 'web', '0', 'nvme0n1']], say: []});
    await p.click('[data-dsel="nvme0n1"]', {modifiers: SHIFT}); await settle(p);
    assert.deepEqual((await p.eval(TILES)).filter(t => t.sel).map(t => t.name), ['sda']);
    assert.equal((await p.eval(CARD)).title, 'sda · data · Test HDD');
    await p.click('[data-diskclear]');
    assert.deepEqual(await p.eval(CARD), {hint: ['Click a disk to see its traffic and what uses it; ⌘/Ctrl- or Shift-click to pick several.']});
    assert.equal(await p.eval(`S.diskSel`), null);
  } finally { await p.close(); }
});

test('Each disk on Windows and macOS: the disk\'s traffic, and a note that the OS doesn\'t say which process uses it', async () => {
  for (const [mid, os, title, tile] of [
    ['win', 'Windows', '0 C: · Test NVMe', {name: '0 C:', sel: false, down: false, text: ['4.0% busy', 'Test NVMe', '1.0 TB · SSD · C:', '↓ 1.5 MB/s', '↑ 0']}],
    ['mac', 'macOS', 'disk0 · Test Apple SSD', {name: 'disk0', sel: false, down: false, text: ['', 'Test Apple SSD', '500 GB · SSD', '↓ 2.0 MB/s', '↑ 0']}]]){
    const p = await open(fx(), {sel: mid, metric: 'disk'}, 'diskview');
    try {
      assert.deepEqual(await p.eval(TILES), [tile], mid);
      await p.click(`[data-dsel="${tile.name}"]`); await settle(p);
      assert.deepEqual(await p.eval(CARD), {title, sub: '↓ read and ↑ write, stacked', legend: ['read', 'write'], heading: 'Doing I/O on this disk', rows: [],
        say: [`${os} doesn’t report which disk each process uses, so Fleet can’t list processes per disk here.`]}, mid);
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  }
});

test('Each interface: one tile per interface, physical then bridges then virtual, with its speed, kind and addresses; nothing else', async () => {
  const p = await open(fx(), {metric: 'net'}, 'ifview');
  try {
    assert.equal(await p.eval(sub), '6 interfaces · click one to see what uses it');
    assert.deepEqual(await p.eval(TILES), [
      {name: 'enp5s0', sel: false, down: true, text: ['down', 'physical', 'in br0', '↓ 0', '↑ 0']},
      {name: 'eth0', sel: false, down: false, text: ['10 Gb/s', 'physical', '10.0.0.2/24 · fd00::2/64', '↓ 2.5 MB/s', '↑ 800 KB/s']},
      {name: 'eth1', sel: false, down: false, text: ['2.5 Gb/s', 'physical', '', '↓ 0', '↑ 0']},
      {name: 'br0', sel: false, down: false, text: ['', 'bridge · 2 members', '', '↓ 0', '↑ 0']},
      {name: 'docker0', sel: false, down: false, text: ['', 'Docker network · bridge', '172.17.0.1/16', '↓ 0', '↑ 0']},
      {name: 'vnet0', sel: false, down: false, text: ['10 Mb/s', 'VM tap · vm-a', '', '↓ 2 KB/s', '↑ 0']}]);
    assert.deepEqual(await p.eval(CARD), {hint: ['Click an interface to see its traffic and what uses it; ⌘/Ctrl- or Shift-click to pick several.']});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Each interface on Windows: link speeds as Windows writes them ("10 Gbps")', async () => {
  const p = await open(fx(), {sel: 'win', metric: 'net'}, 'ifview');
  try {
    assert.deepEqual(await p.eval(TILES), [
      {name: 'Ethernet', sel: false, down: false, text: ['10 Gb/s', 'physical', '10.0.0.3', '↓ 1.0 MB/s', '↑ 500 KB/s']},
      {name: 'Wi-Fi', sel: false, down: true, text: ['down', 'physical', '', '↓ 0', '↑ 0']},
      {name: 'vEthernet (WSL)', sel: false, down: false, text: ['10 Gb/s', 'Hyper-V Virtual Ethernet Adapter', '', '↓ 0', '↑ 0']}]);
  } finally { await p.close(); }
});

test('Each interface: a click picks one and lists who talks through it; Shift-click adds one; a second click lets go', async () => {
  const p = await open(fx(), {metric: 'net'}, 'ifview');
  try {
    await p.click('[data-isel="eth0"]'); await settle(p);
    assert.deepEqual((await p.eval(TILES)).filter(t => t.sel).map(t => t.name), ['eth0']);
    assert.deepEqual(await p.eval(CARD), {title: 'eth0 · physical', sub: '↓ in and ↑ out, stacked', legend: ['in', 'out'], heading: 'Using this interface',
      rows: [['python3', '105', 'Base system', '10 KB/s', 'eth0'], ['nginx', '101', 'web', '10 KB/s', 'eth0'], ['nginx', '102', 'web', '10 KB/s', 'eth0'], ['sshd', '107', 'Base system', '10 KB/s', 'eth0']], say: []});
    await p.click('[data-isel="docker0"]', {modifiers: SHIFT}); await settle(p);
    assert.deepEqual((await p.eval(TILES)).filter(t => t.sel).map(t => t.name), ['eth0', 'docker0']);
    assert.deepEqual(await p.eval(CARD).then(c => [c.title, c.heading, c.rows.map(r => r[1])]), ['2 interfaces: docker0, eth0', 'Using these interfaces', ['105', '101', '102', '107']]);
    await p.click('[data-isel="docker0"]'); await settle(p);
    assert.deepEqual((await p.eval(TILES)).filter(t => t.sel).map(t => t.name), ['docker0'], 'a plain click on one of two picks just that one');
    assert.deepEqual(await p.eval(CARD), {title: 'docker0 · Docker network · bridge', sub: '↓ in and ↑ out, stacked', legend: ['in', 'out'], heading: 'Using this interface',
      rows: [], say: ['Nothing is talking through this interface right now.']});
    await p.click('[data-isel="docker0"]');
    assert.deepEqual(await p.eval(CARD), {hint: ['Click an interface to see its traffic and what uses it; ⌘/Ctrl- or Shift-click to pick several.']});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a pick on one machine picks nothing on another with the same disk and interface names', async () => {
  for (const [toggle, over, hint] of [
    ['diskview', {metric: 'disk', diskSel: {mid: 'lx', names: ['sda']}}, 'Click a disk to see its traffic and what uses it; ⌘/Ctrl- or Shift-click to pick several.'],
    ['ifview', {metric: 'net', ifSel: {mid: 'lx', names: ['eth0']}}, 'Click an interface to see its traffic and what uses it; ⌘/Ctrl- or Shift-click to pick several.']]){
    const p = await open(fx(), Object.assign({sel: 'lx2'}, over), toggle);
    try {
      assert.deepEqual((await p.eval(TILES)).filter(t => t.sel).map(t => t.name), [], toggle);
      assert.deepEqual(await p.eval(CARD), {hint: [hint]}, toggle);
    } finally { await p.close(); }
  }
});
