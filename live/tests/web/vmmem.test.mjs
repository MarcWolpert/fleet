// SPDX-License-Identifier: GPL-3.0-or-later
// A VM Fleet also reads over SSH sits under its host twice over: as a part of the host, it costs what the host
// gives it (its QEMU process: what htop and the hypervisor count); on its own page, it is what the guest reports.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const H = 60, flat = v => new Array(H).fill(v);
const hist = (cpu, mem) => ({cpu: flat(cpu), mem: flat(mem), gpu: flat(0), disk: flat(0), net: flat(0)});
function fx1(){
  const fx = fixture(), lx = fx.fleet.machines.find(m => m.id === 'lx');
  lx.base.h = hist(1, 8);   // the host's own 8 GB; its 'web' container uses nothing
  // the guest says 40 GB of its 60 GB are in use (a ballooned guest says more than the host gives it); the host gives it 6 GB
  lx.vms = [{id: 'guest', name: 'lab-guest', tile: 'vm', status: 'ok', error: '', os: 'Linux · x86_64', agent: 'ssh guest', cronLabel: 'Cron jobs',
    gpus: [], cap: [8, 60, 0, 500, 125], ncpu: 8, groups: [], has_data: true, last_ok: Date.now() / 1000, ssh: 'guest',
    base: {id: 'guest/base', h: hist(1, 40), g: []}, baseCron: [], compose: [], containers: [], vms: [], hostside: hist(1.5, 6)}];
  return fx;
}
const ROWPCT = id => `(document.querySelector('#tree .row[data-select="${id}"]') || {}).textContent`;
const MEMSTAT = `[...document.querySelectorAll('.hero .hs')].find(e => /Memory/i.test(e.textContent)).textContent.replace(/\\s+/g, ' ')`;

test('on its host, a VM counts what the host gives it: the VMs row, its own row and the host\'s total', async () => {
  const p = await browser.page(fx1(), {ui: ui({sel: 'lx', metric: 'mem', open: {lx: true, 'lx/vms': true}})});
  try {
    await p.waitFor(`document.querySelector('#tree .row[data-select="guest"]') && document.querySelector('.hero .hs')`);
    assert.match(await p.eval(ROWPCT('lx/vms')), /9\.4%/);    // 6 of the host's 64 GB, not 40
    assert.match(await p.eval(ROWPCT('guest')), /9\.4%/);
    assert.match(await p.eval(MEMSTAT), /14(\.0)? GB of 64/);   // 8 + 6, not 8 + 40
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('on its own page, a VM shows what the guest reports', async () => {
  const p = await browser.page(fx1(), {ui: ui({sel: 'guest', metric: 'mem', open: {lx: true, 'lx/vms': true}})});
  try {
    await p.waitFor(`document.querySelector('.hero .hs') && /lab-guest/.test(document.querySelector('.hero h1').textContent)`);
    assert.match(await p.eval(MEMSTAT), /40(\.0)? GB of 60/);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
