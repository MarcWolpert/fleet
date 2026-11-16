// SPDX-License-Identifier: GPL-3.0-or-later
// A pick in Each GPU, Each disk or Each interface reads the machine's process list only when something on
// the page shows it: the picked disk's or interface's card (Details, docked or full, reads it on its own).
// The picked GPU's card lists tree nodes, not processes, and a By type graph shows no picked card at all.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const H = 60, flat = v => new Array(H).fill(v);
function fx(){
  const f = fixture();
  f.disks = {lx: {per_process: true, disks: [{name: 'nvme0n1', model: 'Test NVMe', size: 1e12, rot: false, role: 'system', mounts: ['/'], read: 1, write: 2, busy: 5, hr: flat(1), hw: flat(2)}]}};
  f.ifs = {lx: {per_process: true, ifs: [{name: 'eth0', kind: 'physical', rx: 1, tx: 1, addrs: ['10.0.0.2/24'], master: '', state: 'up', speed: '1000', hrx: flat(1), htx: flat(1), vm: '', dnet: '', members: 0, containers: 0}]}};
  return f;
}
// /api/procs reads over three polls, after the page has settled
async function procReads(over){
  const p = await browser.page(fx(), {ui: ui(Object.assign({sel: 'lx', detailsDocked: false}, over))});
  try {
    await p.waitFor(`document.querySelector('.grid2')`);
    await p.eval(`(async () => { for (let i = 0; i < 2; i++){ while (busy) await new Promise(r => setTimeout(r, 20)); await refreshNow(); } return true; })()`);
    const urls = [];
    const off = p.on('Network.requestWillBeSent', e => { if (new URL(e.request.url).pathname === '/api/procs') urls.push(e.request.url); });
    await p.eval(`(async () => { for (let i = 0; i < 3; i++){ while (busy) await new Promise(r => setTimeout(r, 20)); await refreshNow(); } return true; })()`);
    off();
    assert.deepEqual(p.errors, []);
    return urls.length;
  } finally { await p.close(); }
}

const reads = n => n === 0 ? 'none' : n >= 3 ? 'every poll' : n + ' of 3 polls';
const CASES = {
  'GPU picked, Each GPU': {metric: 'gpu', gpuView: 'each', gpuSel: {mid: 'lx', keys: ['gpu0']}},
  'GPU picked, By type': {metric: 'gpu', gpuView: 'type', gpuSel: {mid: 'lx', keys: ['gpu0']}},
  'disk picked, By type': {metric: 'disk', diskView: 'type', diskSel: {mid: 'lx', names: ['nvme0n1']}},
  'disk picked, Each disk': {metric: 'disk', diskView: 'each', diskSel: {mid: 'lx', names: ['nvme0n1']}},
  'interface picked, By type': {metric: 'net', ifView: 'type', ifSel: {mid: 'lx', names: ['eth0']}},
  'interface picked, Each interface': {metric: 'net', ifView: 'each', ifSel: {mid: 'lx', names: ['eth0']}},
  'nothing picked, Each disk': {metric: 'disk', diskView: 'each'},
  'CPU, with picks elsewhere': {metric: 'cpu', diskSel: {mid: 'lx', names: ['nvme0n1']}, ifSel: {mid: 'lx', names: ['eth0']}, gpuSel: {mid: 'lx', keys: ['gpu1']}}
};

test('the process list is read only while a picked disk\'s or interface\'s card shows it', async () => {
  const got = {};
  for (const [k, over] of Object.entries(CASES)) got[k] = reads(await procReads(over));
  assert.deepEqual(got, {
    'GPU picked, Each GPU': 'none', 'GPU picked, By type': 'none',
    'disk picked, By type': 'none', 'disk picked, Each disk': 'every poll',
    'interface picked, By type': 'none', 'interface picked, Each interface': 'every poll',
    'nothing picked, Each disk': 'none', 'CPU, with picks elsewhere': 'none'});
});
