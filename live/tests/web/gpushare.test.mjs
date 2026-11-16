// SPDX-License-Identifier: GPL-3.0-or-later
// Which GPU each workload uses, and how much of it, is measured: the server sends every node's per-GPU
// history (gh), and the per-GPU bars, the "what runs on which" card, the consumers and the GPU tags read
// it. Nothing is split evenly over a workload's GPUs, and Base system is not put on GPU 0.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const H = 60, flat = v => new Array(H).fill(v);
const h = (cpu, mem, gpu, disk, net) => ({cpu: flat(cpu), mem: flat(mem), gpu: flat(gpu), disk: flat(disk), net: flat(net)});
const gh = (g0, g1) => ({gpu0: flat(g0), gpu1: flat(g1)});
const NV = [{name: 'NVIDIA RTX A4000', mem: '16 GB VRAM'}, {name: 'NVIDIA RTX A2000', mem: '12 GB VRAM'}];
function machine(id, name, gpus, over){
  return Object.assign({id, name, tile: 'server', status: 'ok', error: '', os: 'Linux · x86_64', agent: 'ssh ' + id, cronLabel: 'Cron jobs',
    cap: [16, 64, 100 * gpus.length, 500, 125], ncpu: 16, groups: [], has_data: true, last_ok: Date.now() / 1000, gpus,
    baseCron: [], compose: [], containers: [], vms: []}, over);
}
// GPU 0 at 90%: the trainer 85, the rest of the host 5. GPU 1 at 70%: the trainer's helper 5, a running
// job 20, bare-metal ffmpeg and the rest 45. g is the GPU key list older servers sent instead: it must not matter.
function fx(){
  return {fleet: {t: Date.now() / 1000, interval: 3, window_s: 180, pins: [], machines: [
    machine('lx', 'lab-linux', NV, {
      base: {id: 'lx/base', g: ['gpu0'], h: h(2, 8, 50, 0, 0), gh: gh(5, 45)},
      baseCron: [{id: 'lx/base/cron/0', name: 'render.sh', sched: '*/5 * * * *', running: true, g: ['gpu0'], h: h(0.5, 1, 20, 0, 0), gh: gh(0, 20)},
                 {id: 'lx/base/cron/1', name: 'backup.sh', sched: '0 3 * * *', running: false, g: [], h: h(0, 0, 0, 0, 0), gh: gh(0, 0)}],
      compose: [{id: 'lx/compose/ml', name: 'ml', file: '/srv/ml/compose.yaml', services: [
        {id: 'lx/compose/ml/trainer', name: 'trainer', image: 'train:1', status: 'Up', g: ['gpu0', 'gpu1'], h: h(4, 12, 90, 0, 0), gh: gh(85, 5)}]}],
      containers: [{id: 'lx/containers/web', name: 'web', image: 'nginx:1', status: 'Up', g: [], h: h(0.3, 1, 0, 0, 0), gh: gh(0, 0)}]}),
    machine('nog', 'lab-nogpu', [], {base: {id: 'nog/base', g: [], h: h(1, 4, 0, 0, 0), gh: {}},
      containers: [{id: 'nog/containers/web', name: 'web', image: 'nginx:1', status: 'Up', g: [], h: h(0.3, 1, 0, 0, 0), gh: {}}]})
  ]}, procs: {}, cpus: {}};
}
const MODEL = `(() => {
  const r = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(3)]));
  const ids = ['lx/base', 'lx/base/cron/0', 'lx/base/cron/1', 'lx/compose/ml', 'lx/compose/ml/trainer', 'lx/containers/web', 'nog/base', 'nog/containers/web'];
  return {
    total: +cur(nodes.lx, 'gpu').toFixed(3),
    bt: {gpu0: r(gpuBt(nodes.lx, 'gpu0')), gpu1: r(gpuBt(nodes.lx, 'gpu1'))},
    consumers: {gpu0: gpuConsumers(nodes.lx, 'gpu0').map(c => [c.n.id, +c.v.toFixed(3)]), gpu1: gpuConsumers(nodes.lx, 'gpu1').map(c => [c.n.id, +c.v.toFixed(3)])},
    tags: Object.fromEntries(ids.map(id => [id, whichGpu(nodes[id])])),
    hist: {gpu0: gpuHist(nodes.lx, 'gpu0')[H-1], gpu1: gpuHist(nodes.lx, 'gpu1')[H-1]}};
})()`;

test('each GPU shows what each workload measurably uses of it, and Base system where it runs', async () => {
  const p = await browser.page(fx(), {ui: ui({sel: 'lx', metric: 'gpu'})});
  try {
    await p.waitFor(`typeof nodes !== 'undefined' && !!nodes.lx && document.querySelectorAll('.gpus .gpu').length === 2`);
    assert.deepEqual(await p.eval(MODEL), {
      total: 160,
      bt: {gpu0: {base: 5, compose: 85, container: 0, vm: 0}, gpu1: {base: 65, compose: 5, container: 0, vm: 0}},
      consumers: {gpu0: [['lx/compose/ml/trainer', 85], ['lx/base', 5]], gpu1: [['lx/base', 65], ['lx/compose/ml/trainer', 5]]},
      tags: {'lx/base': 'GPU0+1', 'lx/base/cron/0': 'GPU1', 'lx/base/cron/1': '', 'lx/compose/ml': 'GPU0+1', 'lx/compose/ml/trainer': 'GPU0+1',
             'lx/containers/web': '', 'nog/base': '', 'nog/containers/web': ''},
      hist: {gpu0: 90, gpu1: 70}});
    // the "what runs on which" card says the same
    const card = await p.eval(`[...document.querySelectorAll('.gpus .gpu')].map(b => ({total: b.querySelector('.gpu-h .v').textContent,
      rows: [...b.querySelectorAll('.gpu-rank .namebtn')].map(n => [n.textContent, n.nextElementSibling.nextElementSibling.textContent])}))`);
    assert.deepEqual(card, [{total: '90%', rows: [['trainer', '85%'], ['Base system', '5.0%']]}, {total: '70%', rows: [['Base system', '65%'], ['trainer', '5.0%']]}]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
