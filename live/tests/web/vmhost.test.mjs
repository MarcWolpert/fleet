// SPDX-License-Identifier: GPL-3.0-or-later
// A VM's share of its host is measured from the host side; its own page from inside it (issue #98). The
// server leaves the host's view of a VM (its QEMU process) out of Base system and sends it as `hostside`,
// so the host's totals add up only when the VM counts as its host sees it, not as the guest does.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const H = 60, flat = v => new Array(H).fill(v);
// lab-linux: 64 GB, 40 GB in use. 16 GB of it is "guest" as the host sees it (it says it uses 6 GB of its own 16),
// 2 GB is "other", a VM only the host sees; Base system is the 22 GB left. CPU: 2 + 1.5 (guest says 0.5) + 0.25 of 16 cores.
function fx2(){
  const fx = fixture(), lx = fx.fleet.machines.find(m => m.id === 'lx');
  lx.base = {id: 'lx/base', h: {cpu: flat(2), mem: flat(22)}, g: []};
  lx.vms = [
    {id: 'lx-guest', name: 'guest', tile: 'vm', status: 'ok', error: '', os: 'Linux · x86_64', agent: 'ssh lx-guest', ssh: 'lx-guest', cronLabel: 'Cron jobs',
      cap: [4, 16, 0, 500, 125], ncpu: 4, cpu_model: '', gpus: [], groups: [], has_data: true, last_ok: Date.now() / 1000,
      base: {id: 'lx-guest/base', h: {cpu: flat(0.5), mem: flat(6)}, g: []}, baseCron: [], compose: [], containers: [], vms: [],
      hostside: {cpu: flat(1.5), mem: flat(16), gpu: flat(0), disk: flat(0), net: flat(0)}},
    {id: 'lx/vms/other', name: 'other', tile: 'vm', status: 'ok', os: 'VM', agent: 'seen from the host', cronLabel: 'Cron jobs',
      cap: [16, 64, 0, 1, 1], gpus: [], base: {id: 'lx/vms/other/base', h: {cpu: flat(0.25), mem: flat(2)}}, baseCron: [], compose: [], containers: [], vms: []}];
  return fx;
}
const STATS = `[...document.querySelectorAll('#main .hero-stats .hs')].map(s => [s.querySelector('.k').textContent, s.querySelector('.v').textContent, s.querySelector('.s').textContent])`;
const WHERE = label => `(() => { const r = [...document.querySelectorAll('#main .res')].find(r => r.querySelector('.lab').firstChild.textContent === ${JSON.stringify(label)}); return r && [r.querySelector('.tot').textContent, [...r.querySelectorAll('.kvs > span')].map(s => s.textContent)]; })()`;
const INSIDE = `[...document.querySelectorAll('#main .tbl tbody tr')].map(tr => [tr.querySelector('[data-select]').dataset.select, tr.children[2].textContent, tr.lastElementChild.textContent])`;
async function open(fx, sel){
  const p = await browser.page(fx, {ui: ui({sel, metric: 'mem', open: {lx: true, 'lx/vms': true}})});
  try { await p.waitFor(`document.querySelector('#main .hero h1') && document.querySelector('#tree .row[data-select="lx-guest"]')`); } catch (e) { await p.close(); throw e; }
  return p;
}

test('the host\'s stats, where-card and Inside table count a VM as the host sees it', async () => {
  const p = await open(fx2(), 'lx');
  try {
    assert.deepEqual((await p.eval(STATS)).slice(0, 2), [['CPU', '23%', '3.8 cores of 16 cores'], ['Memory', '63%', '40 GB of 64 GB']]);
    assert.deepEqual(await p.eval(WHERE('Memory')), ['63% used40 GB of 64 GB', ['Base 34%', 'VMs 28%', 'Free 38%']]);
    assert.deepEqual((await p.eval(INSIDE)).filter(r => r[0].includes('vms') || r[0] === 'lx-guest'), [
      ['lx/vms', '18 GB', '28%'], ['lx-guest', '16 GB', '25%'], ['lx/vms/other', '2.0 GB', '3.1%']]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('All machines and the tree add the host up the same way', async () => {
  const p = await open(fx2(), 'fleet');
  try {
    assert.deepEqual((await p.eval(STATS))[1], ['Memory', '16%', '40 GB of 256 GB']);
    assert.deepEqual(await p.eval(`['lx', 'lx-guest', 'lx/vms/other'].map(id => document.querySelector('#tree [data-val="' + id + '"]').textContent)`), ['63%', '25%', '3.1%']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the VM\'s own page is from inside it; only its share of the host is the host\'s view', async () => {
  const p = await open(fx2(), 'lx-guest');
  try {
    assert.deepEqual(await p.eval(STATS), [['CPU', '13%', '0.50 cores of 4.0 cores'], ['Memory', '38%', '6.0 GB of 16 GB'], ['GPU', '—', 'no GPU'], ['of host Memory', '25%', 'lab-linux']]);
    assert.deepEqual(await p.eval(WHERE('Memory')), ['38% used6.0 GB of 16 GB', ['Base 38%', 'Free 63%']]);
    assert.deepEqual(await p.eval(INSIDE), [['lx-guest/base', '6.0 GB', '38%']]);   // its Base system's share of the VM itself
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
