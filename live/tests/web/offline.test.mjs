// SPDX-License-Identifier: GPL-3.0-or-later
// The offline card: why a machine can't be read, and numbered steps to fix it, as readable sentences.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

test('a refused login reads as sentences: each step one flowing line of text, code and bold together', async () => {
  const fx = fixture();
  Object.assign(fx.fleet.machines.find(m => m.id === 'win'), {status: 'offline', has_data: false, error: 'user@lab-windows: Permission denied (publickey,password).'});
  const p = await browser.page(fx, {ui: ui({sel: 'win'}), width: 1400, height: 900});
  try {
    await p.waitFor(`document.querySelectorAll('.steps li').length === 3`);
    assert.match(await p.eval(`document.querySelector('.state h2, .state .st-t, .state b').textContent`), /didn.t accept the login|login/i);
    // each step is the number plus ONE block of text (inline code and bold flow inside it)
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('.steps li')].map(li => [...li.childNodes].filter(n => n.nodeType === 1 || n.textContent.trim()).length)`), [1, 1, 1]);
    // so the long second step wraps as a paragraph, not as a column per word group
    const h = await p.eval(`document.querySelectorAll('.steps li')[1].getBoundingClientRect().height`);
    assert.ok(h < 70, `step 2 is ${h}px tall`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a live VM under a host without a reading is in the tree, its share taken of its own capacity (#147)', async () => {
  const fx = fixture(), H = 60, flat = v => new Array(H).fill(v);
  const h = cpu => ({cpu: flat(cpu), mem: flat(8), gpu: flat(0), disk: flat(0), net: flat(0)});
  const vm = {id: 'win-vm', name: 'win-vm', tile: 'vm', status: 'ok', error: '', os: 'Windows', agent: 'ssh win-vm', cronLabel: 'Scheduled tasks',
    gpus: [], cap: [8, 32, 0, 300, 125], ncpu: 8, has_data: true, base: {id: 'win-vm/base', h: h(2), g: []}, baseCron: [], compose: [], containers: [], vms: []};
  // what the server sends for a host it has no reading of: no data, the placeholder capacity, its VMs
  Object.assign(fx.fleet.machines.find(m => m.id === 'win'), {status: 'offline', has_data: false, error: 'connection closed (exit 255)',
    cap: [1, 1, 0, 1, 1], gpus: [], containers: [], base: {id: 'win/base', g: []}, vms: [vm]});
  const p = await browser.page(fx, {ui: ui({sel: 'win-vm', open: {win: true, 'win/vms': true}})});
  try {
    await p.waitFor(`document.querySelector('[data-val="win-vm"]')`);
    // the host can't be read, so nothing under it has a share of it but the VM, of its own 8 CPUs; other hosts as before
    assert.deepEqual(await p.eval(`Object.fromEntries([...document.querySelectorAll('[data-val^="win"], [data-val^="lx/"]')].map(e => [e.dataset.val, e.textContent]))`),
      {win: 'offline', 'win/base': '—', 'win/vms': '—', 'win-vm': '25%', 'lx/base': '0%', 'lx/containers': '0%'});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
