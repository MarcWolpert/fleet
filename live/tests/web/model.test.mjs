// SPDX-License-Identifier: GPL-3.0-or-later
// The model's arithmetic, pinned (#169): on a fleet with usage in it (fixtures.mjs modelFleet()), every node's
// five metrics, every GPU tag, each GPU's split by type and what runs on it, and the fleet's totals, as exact
// sets. A job is a breakdown of its owner, never added on top; a VM counts toward its host by what the host
// sees of it, and its own tree by its inside view. Controls: an idle job, a stopped container, a container
// that uses no GPU, a VM seen only from its host, and a machine with no GPU.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {modelFleet, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

async function open(over = {}){
  const p = await browser.page({fleet: modelFleet(), procs: {}, cpus: {}}, {ui: ui(Object.assign({sel: 'host', metric: 'gpu'}, over))});
  try { await p.waitFor(`typeof nodes !== 'undefined' && !!nodes.host && !!document.querySelector('.hero')`); } catch (e) { await p.close(); throw e; }
  return p;
}
const R = `const r = v => +v.toFixed(3), ro = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r(v)]));`;

test('every node has exactly its own numbers: jobs inside their owner, VMs by what the host sees', async () => {
  const p = await open();
  try {
    assert.deepEqual(await p.eval(`(() => { ${R} return Object.fromEntries(Object.keys(nodes).sort().map(id => [id, METRICS.map(m => r(cur(nodes[id], m.id)))])); })()`), {
      'host':                    [9.8, 44, 185, 25, 4.7],
      'host/base':               [2.5, 9, 50, 12, 1],     // its own (2, 8, 30, 10, 1) and its running job
      'host/base/cron':          [0.5, 1, 20, 2, 0],
      'host/base/cron/0':        [0.5, 1, 20, 2, 0],
      'host/base/cron/1':        [0, 0, 0, 0, 0],
      'host/compose':            [4.5, 14, 90, 8, 0.7],
      'host/compose/ml':         [4.5, 14, 90, 8, 0.7],
      'host/compose/ml/db':      [0.5, 2, 0, 3, 0.2],
      'host/compose/ml/trainer': [4, 12, 90, 5, 0.5],
      'host/containers':         [0.3, 1, 0, 1, 2],
      'host/containers/old':     [0, 0, 0, 0, 0],
      'host/containers/web':     [0.3, 1, 0, 1, 2],
      'host/vms':                [2.5, 20, 45, 4, 1],
      'host/vms/other':          [0.5, 4, 0, 0, 0],
      'host/vms/other/base':     [0.5, 4, 0, 0, 0],
      'nog':                     [1.2, 5, 0, 2, 0.6],
      'nog/base':                [1, 4, 0, 2, 0.5],
      'nog/containers':          [0.2, 1, 0, 0, 0.1],
      'nog/containers/web':      [0.2, 1, 0, 0, 0.1],
      'vm1':                     [2, 16, 45, 4, 1],       // what the host sees of it; GPU as the guest sees it (#206)
      'vm1/base':                [1, 3, 40, 1, 0.5],
      'vm1/containers':          [0.5, 2, 5, 0, 0.5],
      'vm1/containers/app':      [0.5, 2, 5, 0, 0.5]});
    assert.deepEqual(await p.eval(`(() => { ${R} return {vm1: METRICS.map(m => r(cur(nodes.vm1.inside, m.id))), host: ro(byType(nodes.host, 'cpu')), vm1Own: ro(byType(nodes.vm1, 'cpu'))}; })()`),
      {vm1: [1.5, 5, 45, 1, 1], host: {base: 2.5, compose: 4.5, container: 0.3, vm: 2.5}, vm1Own: {base: 1, compose: 0, container: 0.5, vm: 0}});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('every node names exactly the GPUs it uses, and each GPU adds up to what runs on it', async () => {
  const p = await open();
  try {
    assert.deepEqual(await p.eval(`Object.fromEntries(Object.keys(nodes).sort().map(id => [id, whichGpu(nodes[id])]).filter(([, w]) => w))`), {
      'host': 'GPU0+1', 'host/base': 'GPU0+1', 'host/base/cron': 'GPU1', 'host/base/cron/0': 'GPU1', 'host/compose': 'GPU0+1', 'host/compose/ml': 'GPU0+1',
      'host/compose/ml/trainer': 'GPU0+1', 'host/vms': 'GPU1', 'vm1': 'GPU1', 'vm1/base': 'GPU0', 'vm1/containers': 'GPU0', 'vm1/containers/app': 'GPU0'});
    assert.deepEqual(await p.eval(`(() => { ${R} const cons = (m, k) => gpuConsumers(nodes[m], k).map(c => [c.n.id, r(c.v)]); return {
      bt: {gpu0: ro(gpuBt(nodes.host, 'gpu0')), gpu1: ro(gpuBt(nodes.host, 'gpu1')), vm1: ro(gpuBt(nodes.vm1, 'gpu0'))},
      consumers: {gpu0: cons('host', 'gpu0'), gpu1: cons('host', 'gpu1'), vm1: cons('vm1', 'gpu0')},
      hist: {gpu0: gpuHist(nodes.host, 'gpu0')[H-1], gpu1: gpuHist(nodes.host, 'gpu1')[H-1], vm1: gpuHist(nodes.vm1, 'gpu0')[H-1]}}; })()`), {
      bt: {gpu0: {base: 5, compose: 85, container: 0, vm: 0}, gpu1: {base: 45, compose: 5, container: 0, vm: 50}, vm1: {base: 40, compose: 0, container: 5, vm: 0}},
      consumers: {gpu0: [['host/compose/ml/trainer', 85], ['host/base', 5]], gpu1: [['vm1', 50], ['host/base', 45], ['host/compose/ml/trainer', 5]], vm1: [['vm1/base', 40], ['vm1/containers/app', 5]]},
      hist: {gpu0: 90, gpu1: 100, vm1: 45}});
    // the page says the same: the host's per-GPU bars and its "what runs on which" card
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('.res')].filter(e => /^GPU \\d/.test(e.querySelector('.lab').textContent)).map(e => e.querySelector('.tot').firstChild.textContent)`), ['90% used', '100% used']);
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('.gpus .gpu')].map(b => [b.querySelector('.gpu-h .v').textContent, ...[...b.querySelectorAll('.gpu-rank .namebtn')].map(n => n.textContent)])`),
      [['90%', 'trainer', 'Base system'], ['100%', 'vm1', 'Base system', 'trainer']]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the fleet adds up its machines by type, against the capacity of the ones with data', async () => {
  const p = await open({sel: 'fleet'});
  try {
    assert.deepEqual(await p.eval(`(() => { ${R} const c = ctxOf('fleet'); return Object.fromEntries(METRICS.map(m => [m.id, {bt: ro(c.bt(m.id)), cap: r(c.cap(m.id))}])); })()`), {
      cpu:  {bt: {base: 3.5, compose: 4.5, container: 0.5, vm: 2.5}, cap: 24},
      mem:  {bt: {base: 13, compose: 14, container: 2, vm: 20}, cap: 96},
      gpu:  {bt: {base: 50, compose: 90, container: 0, vm: 45}, cap: 200},
      disk: {bt: {base: 14, compose: 8, container: 1, vm: 4}, cap: 1000},
      net:  {bt: {base: 1.5, compose: 0.7, container: 2.1, vm: 1}, cap: 250}});
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('.hero-stats .hs')].map(e => [e.querySelector('.k').textContent, e.querySelector('.v').textContent])`),
      [['CPU', '46%'], ['Memory', '51%'], ['GPU', '93%']]);   // GPU: 185 of 200
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
