// SPDX-License-Identifier: GPL-3.0-or-later
// The overview pages (issue #148): which view each kind of node opens, the rows of the where-cards per
// machine and per GPU, the "of capacity" and "of what's in use" percentages, the fleet's capacity without
// the machines that have no data, and the hover readout of every data-tip kind. Exact text throughout.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const H = 60, flat = v => new Array(H).fill(v);
// lab-linux, 20 cores and 64 GB: CPU 3 Base + 1 Compose + 2 Containers + 4 VMs = 10 cores (50%);
// memory 16 + 6.4 + 9.6 + 3.2 = 35.2 GB (55%); GPU 0 30% (Base), GPU 1 20% (Compose); disk 50 of 500 MB/s, network 5 of 125.
// The other machines read zero.
function fx2(){
  const fx = fixture(), lx = fx.fleet.machines.find(m => m.id === 'lx');
  lx.cap = [20, 64, 200, 500, 125];
  lx.base = {id: 'lx/base', h: {cpu: flat(3), mem: flat(16), gpu: flat(30), disk: flat(50), net: flat(5)}, g: ['gpu0']};
  lx.baseCron = [{id: 'lx/base/cron/0', name: 'backup', sched: '0 3 * * *', human: 'daily at 03:00', cmd: '/usr/local/bin/backup', last: 'next 03:00',
    running: false, state: 'idle', src: 'crontab', g: [], h: {}}];
  lx.compose = [{id: 'lx/compose/media', name: 'media', file: '/srv/media/compose.yml',
    services: [{id: 'lx/compose/media/app', name: 'app', image: 'media/app:2', status: 'Up 3 hours', g: ['gpu1'], h: {cpu: flat(1), mem: flat(6.4), gpu: flat(20)}}]}];
  lx.containers = [{id: 'lx/containers/web', name: 'web', image: 'nginx:1', status: 'Up 2 hours', g: [], h: {cpu: flat(2), mem: flat(9.6)}}];
  lx.vms = [{id: 'lx/vms/vm1', name: 'vm1', tile: 'vm', status: 'ok', os: 'VM', agent: 'seen from the host', cronLabel: 'Cron jobs', cap: [20, 64, 0, 1, 1],
    gpus: [], base: {id: 'lx/vms/vm1/base', h: {cpu: flat(4), mem: flat(3.2)}}, baseCron: [], compose: [], containers: [], vms: []}];
  fx.fleet.prefs = {tgroups: {'machines|root': [{id: 'g1', name: 'Lab', c: 2, ids: ['lx', 'lx2']}]}};
  return fx;
}
const VIEW = `[(document.querySelector('#main .hero h1').firstChild.textContent || '').trim(), [...document.querySelectorAll('#main .card-h h2, #main .state h2')].map(h => h.textContent)]`;
const ROWS = `[...document.querySelectorAll('#main .res')].map(r => [r.querySelector('.lab').firstChild.textContent, (r.querySelector('.lab small') || {textContent: ''}).textContent, r.querySelector('.tot').textContent,
  [...r.querySelectorAll('.kvs > span')].map(s => s.textContent), [...r.querySelectorAll('.sbar .s')].map(s => s.style.width), (r.querySelector('.sbar.empty') || {textContent: ''}).textContent])`;
const STATS = `[...document.querySelectorAll('#main .hero-stats .hs')].map(s => [s.querySelector('.k').textContent, s.querySelector('.v').textContent, s.querySelector('.s').textContent])`;
const TIP = `(() => { const t = document.getElementById('tip'); if (t.hidden) return null; return [t.querySelector('.t').textContent.trim(), t.querySelector('.u').textContent, [...t.querySelectorAll('.r')].map(r => [r.children[0].textContent, r.children[1].textContent])]; })()`;
async function open(fx, sel, over = {}){
  const p = await browser.page(fx, {ui: ui(Object.assign({sel}, over))});
  try { await p.waitFor(`document.querySelector('#main .hero h1')`); } catch (e) { await p.close(); throw e; }
  return p;
}
async function hover(p, sel, at = 'centre'){
  const r = await p.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({block: 'center', inline: 'center'}); const b = e.getBoundingClientRect(); return {x: ${at === 'right' ? 'b.right - 1' : 'b.left + b.width / 2'}, y: b.top + b.height / 2}; })()`);
  if (!r) throw new Error('no element for ' + sel);
  await p.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: r.x, y: r.y});
  return p.waitFor(TIP).catch(() => null);
}

test('each kind of node opens its own view, with its own cards and nothing else', async () => {
  const fx = fx2();
  Object.assign(fx.fleet.machines.find(m => m.id === 'win'), {status: 'offline', has_data: false, error: ''});
  const p = await open(fx, 'fleet');
  try {
    const views = {};
    for (const sel of ['fleet', 'div:g1', 'lx', 'lx/vms/vm1', 'lx/compose', 'lx/compose/media', 'lx/compose/media/app', 'lx/containers', 'lx/containers/web',
      'lx/vms', 'lx/base', 'lx/base/cron', 'lx/base/cron/0', 'win']){
      await p.eval(`(select(${JSON.stringify(sel)}), true)`);
      await p.waitFor(`S.sel === ${JSON.stringify(sel)} && document.querySelector('#main .hero h1')`);
      views[sel] = await p.eval(VIEW);
    }
    assert.deepEqual(views, {
      'fleet': ['All machines', ['Where your fleet’s usage goes', 'Fleet CPU', 'By machine · CPU']],
      'div:g1': ['Lab', ['Where Lab’s usage goes', 'Lab CPU', 'By machine · CPU']],
      'lx': ['lab-linux', ['Where this machine’s usage goes', 'CPU', 'GPUs: what runs on which', 'Inside lab-linux']],
      'lx/vms/vm1': ['vm1', ['Where this VM’s usage goes', 'CPU', 'Inside vm1']],
      'lx/compose': ['Docker Compose', ['Where Docker Compose’s CPU goes', 'CPU', 'Inside Docker Compose']],
      'lx/compose/media': ['media', ['Where media’s CPU goes', 'CPU', 'Inside media']],
      'lx/compose/media/app': ['app', ['CPU', 'Details']],
      'lx/containers': ['Containers', ['Where Containers’s CPU goes', 'CPU', 'Inside Containers']],
      'lx/containers/web': ['web', ['CPU', 'Details']],
      'lx/vms': ['VMs', ['Where VMs’s CPU goes', 'CPU', 'Inside VMs']],
      'lx/base': ['Base system', ['Cron jobs in Base system', 'CPU']],
      'lx/base/cron': ['Cron jobs in Base system', ['Jobs', 'CPU from cron jobs']],
      'lx/base/cron/0': ['backup', ['Schedule', 'CPU']],
      'win': ['lab-windows', ['Fleet can’t reach lab-windows']]});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a machine\'s where-card: one row per metric and per GPU, as shares of capacity, then of what\'s in use', async () => {
  const p = await open(fx2(), 'lx');
  try {
    assert.deepEqual(await p.eval(ROWS), [
      ['CPU', '', '50% used10 cores of 20 cores', ['Base 15%', 'Compose 5.0%', 'Containers 10%', 'VMs 20%', 'Free 50%'], ['15%', '5%', '10%', '20%'], ''],
      ['Memory', '', '55% used35 GB of 64 GB', ['Base 25%', 'Compose 10%', 'Containers 15%', 'VMs 5.0%', 'Free 45%'], ['25%', '10%', '15%', '5%'], ''],
      ['GPU 0', 'NVIDIA RTX A4000', '30% used30% of 1 GPU', ['Base 30%', 'Free 70%'], ['30%'], ''],
      ['GPU 1', 'NVIDIA RTX A2000', '20% used20% of 1 GPU', ['Compose 20%', 'Free 80%'], ['20%'], ''],
      ['Disk I/O', '', '10% used50 MB/s of 500 MB/s (peak seen)', ['Base 10%', 'Free 90%'], ['10%'], ''],
      ['Network', '', '4.0% used5.0 MB/s of 125 MB/s (link speed)', ['Base 4.0%', 'Free 96%'], ['4%'], '']]);
    await p.click('#main [data-mode="used"]');
    await p.waitFor(`S.mode === 'used' && document.querySelector('#main [data-mode="used"]').getAttribute('aria-pressed') === 'true'`);
    assert.deepEqual(await p.eval(ROWS), [
      ['CPU', '', '50% used10 cores of 20 cores', ['Base 30%', 'Compose 10%', 'Containers 20%', 'VMs 40%'], ['30%', '10%', '20%', '40%'], ''],
      ['Memory', '', '55% used35 GB of 64 GB', ['Base 45%', 'Compose 18%', 'Containers 27%', 'VMs 9.1%'], ['45.455%', '18.182%', '27.273%', '9.091%'], ''],
      ['GPU 0', 'NVIDIA RTX A4000', '30% used30% of 1 GPU', ['Base 100%'], ['100%'], ''],
      ['GPU 1', 'NVIDIA RTX A2000', '20% used20% of 1 GPU', ['Compose 100%'], ['100%'], ''],
      ['Disk I/O', '', '10% used50 MB/s of 500 MB/s (peak seen)', ['Base 100%'], ['100%'], ''],
      ['Network', '', '4.0% used5.0 MB/s of 125 MB/s (link speed)', ['Base 100%'], ['100%'], '']]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a VM with no GPU gets an empty GPU row; a one-GPU machine one GPU row', async () => {
  const fx = fx2();
  let p = await open(fx, 'lx/vms/vm1');
  try {
    assert.deepEqual(await p.eval(ROWS), [
      ['CPU', '', '20% used4.0 cores of 20 cores', ['Base 20%', 'Free 80%'], ['20%'], ''],
      ['Memory', '', '5.0% used3.2 GB of 64 GB', ['Base 5.0%', 'Free 95%'], ['5%'], ''],
      ['GPU', '', '—', [], [], 'no GPU here'],
      ['Disk I/O', '', '0% used0 MB/s of 1.0 MB/s (peak seen)', ['Free 100%'], [], ''],
      ['Network', '', '0% used0 MB/s of 1.0 MB/s (link speed)', ['Free 100%'], [], '']]);
  } finally { await p.close(); }
  p = await open(fx, 'mac');
  try {
    assert.deepEqual((await p.eval(ROWS)).map(r => r.slice(0, 2)), [['CPU', ''], ['Memory', ''], ['GPU 0', 'Apple M5 GPU'], ['Disk I/O', ''], ['Network', '']]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the fleet\'s capacity leaves out a machine that never reported, and keeps one that is reconnecting', async () => {
  const fx = fx2();
  Object.assign(fx.fleet.machines.find(m => m.id === 'win'), {status: 'offline', has_data: false, error: ''});   // 8 cores, 1 GPU: left out
  Object.assign(fx.fleet.machines.find(m => m.id === 'lx2'), {status: 'offline', error: 'timed out', last_ok: Date.now() / 1000 - 30});   // stale: still counts
  const p = await open(fx, 'fleet');
  try {
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#main .hero .facts span')].map(s => s.textContent)`), ['2 of 4 machines live', '1 VMs', '1 scheduled jobs', '42 cores', '192 GB RAM']);
    assert.deepEqual(await p.eval(STATS), [['CPU', '24%', '10 cores of 42 cores'], ['Memory', '18%', '35 GB of 192 GB'], ['GPU', '10%', '50% of 5 GPUs']]);
    assert.deepEqual((await p.eval(ROWS)).map(r => r.slice(0, 4)), [
      ['CPU', '', '24% used10 cores of 42 cores', ['Base 7.1%', 'Compose 2.4%', 'Containers 4.8%', 'VMs 9.5%', 'Free 76%']],
      ['Memory', '', '18% used35 GB of 192 GB', ['Base 8.3%', 'Compose 3.3%', 'Containers 5.0%', 'VMs 1.7%', 'Free 82%']],
      ['GPU', 'all 5 GPUs', '10% used50% of 5 GPUs', ['Base 6.0%', 'Compose 4.0%', 'Free 90%']],
      ['Disk I/O', '', '3.3% used50 MB/s of 1500 MB/s (peak seen)', ['Base 3.3%', 'Free 97%']],
      ['Network', '', '1.3% used5.0 MB/s of 375 MB/s (link speed)', ['Base 1.3%', 'Free 99%']]]);
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#main .mrow')].map(r => [r.querySelector('[data-select]').dataset.select, (r.querySelector('.sbar.empty') || {textContent: ''}).textContent, r.querySelector('.tot').textContent])`), [
      ['lx', '', '50% used100% of fleet CPU'], ['lx2', '', '0% used0% of fleet CPU'], ['mac', '', '0% used0% of fleet CPU'], ['win', 'Fleet can’t reach lab-windows', '—']]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the hover readout of every data-tip kind', async () => {
  const fx = fx2();
  let p = await open(fx, 'lx');
  try {
    assert.equal(await p.eval(TIP), null);
    assert.deepEqual(await hover(p, '#main .res [data-tip="seg|lx|cpu|vm"]'), ['VMs', 'lab-linux · CPU', [['Using', '4.0 cores'], ['of capacity', '20%'], ['of what’s in use', '40%']]]);
    assert.deepEqual(await hover(p, '#main .res [data-tip="gseg|lx|gpu1|compose"]'), ['Docker Compose', 'lab-linux · GPU 1 · NVIDIA RTX A2000', [['of this GPU', '20%'], ['of what’s in use', '100%']]]);
    assert.deepEqual(await hover(p, '#main .gpus [data-tip="gpu|lx|gpu0|lx/base"]'), ['Base system', 'GPU 0 · NVIDIA RTX A4000', [['of this GPU', '30%']]]);
    assert.deepEqual(await hover(p, '#main .tbl [data-tip="child|lx/containers/web|cpu"]'), ['web', 'CPU', [['Using', '2.0 cores'], ['of lab-linux', '10%'], ['of Containers', '100%']]]);
    assert.deepEqual(await hover(p, '#main [data-graph]', 'right'), ['now', 'CPU', [['VMs', '4.0 cores'], ['Containers', '2.0 cores'], ['Docker Compose', '1.0 cores'], ['Base system', '3.0 cores'], ['Total', '10 cores']]]);
    await p.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: 2, y: 2});
    await p.waitFor(`${TIP} === null`);
  } finally { await p.close(); }
  p = await open(fx, 'fleet');
  try {
    assert.deepEqual(await hover(p, '#main .res [data-tip="seg|fleet|cpu|base"]'), ['Base system', 'All machines · CPU', [['Using', '3.0 cores'], ['of capacity', '6.0%'], ['of what’s in use', '30%']]]);
    assert.deepEqual(await hover(p, '#main .mrow [data-tip="seg|lx|cpu|container"]'), ['Containers', 'lab-linux · CPU', [['Using', '2.0 cores'], ['of capacity', '10%'], ['of what’s in use', '20%']]]);
  } finally { await p.close(); }
  p = await open(fx, 'lx/compose/media/app');
  try {
    assert.deepEqual(await hover(p, '#main .tiles [data-tip="child|lx/compose/media/app|mem"]'), ['app', 'Memory', [['Using', '6.4 GB'], ['of lab-linux', '10%'], ['of media', '100%']]]);
  } finally { await p.close(); }
  p = await open(fx, 'lx/base/cron/0');
  try {
    assert.deepEqual(await hover(p, '#main .tiles [data-tip="child|lx/base/cron/0|cpu"]'), ['backup', 'CPU · idle', [['Using', '0 cores'], ['of lab-linux', '0%'], ['of Base system', '0%']]]);
  } finally { await p.close(); }
  p = await open(fx, 'lx/vms');
  try {
    assert.deepEqual(await hover(p, '#main .rank [data-tip="child|lx/vms/vm1|cpu"]'), ['vm1', 'CPU', [['Using', '4.0 cores'], ['of lab-linux', '20%'], ['of VMs', '100%']]]);
  } finally { await p.close(); }
  p = await open(fx, 'lx', {cpuView: 'logical'});
  try {
    await p.waitFor(`document.querySelector('#main [data-tip="lcpu|lx|12"]')`);
    assert.deepEqual(await hover(p, '#main [data-tip="lcpu|lx|12"]'), ['CPU 12', 'CCD 1 · core 4', [['Utilization', '84%'], ['Frequency', '3.01 GHz']]]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
