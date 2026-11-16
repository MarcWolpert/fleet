// SPDX-License-Identifier: GPL-3.0-or-later
// The machine tree, Pins only and the + picker, row by row: pinned first, then natural alphabetical order (at the
// top and inside groups), VMs under their host, offline and stale machines. The fleet below adds to the shared
// fixture what it lacks: a machine whose name sorts by number, two VMs (one off), a second container, an offline
// machine that never reported and a stale one, and pins.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

function hostVm(host, name, status){   // a VM seen from its host, shaped like the server's spec for one
  const id = host.id + '/vms/' + name;
  return {id, name, tile: 'vm', status, os: 'VM', agent: 'seen from the host', cap: [host.ncpu, 64, 0, 1, 1], gpus: [], cronLabel: 'Cron jobs',
    base: {id: id + '/base', g: []}, baseCron: [], compose: [], containers: [], vms: []};
}
function fleet(pins){
  const fx = fixture(), ms = fx.fleet.machines, by = id => ms.find(m => m.id === id);
  const lx10 = structuredClone(by('lx2'));
  Object.assign(lx10, {id: 'lx10', name: 'lab-linux-10', ssh: 'lx10', base: {id: 'lx10/base', g: []}, containers: [{id: 'lx10/containers/web', name: 'web', image: 'nginx:1', status: 'Up 2 hours', g: []}]});
  ms.push(lx10);
  const lx = by('lx');
  lx.containers.push({id: 'lx/containers/api', name: 'api', image: 'api:2', status: 'Up 5 hours', g: []});
  lx.vms = [hostVm(lx, 'win11', 'off'), hostVm(lx, 'ubuntu', 'ok')];
  Object.assign(by('lx2'), {status: 'offline'});                                          // reconnecting: stale
  Object.assign(by('win'), {status: 'offline', has_data: false, containers: []});         // never reported
  fx.fleet.pins = pins;
  return fx;
}
const ROWS = `[...document.querySelectorAll('#tree .row')].map(r => r.dataset.select + '@' + getComputedStyle(r).getPropertyValue('--d').trim())`;
const MACHINES = `Object.fromEntries([...document.querySelectorAll('#tree .row.machine')].map(r => [r.dataset.select, [[...r.classList].filter(c => !['row', 'machine'].includes(c)).sort().join(' '), r.querySelector('.val').textContent.endsWith('%') ? '%' : r.querySelector('.val').textContent]]))`;
const SPACES = `[...document.querySelectorAll('#spaces [data-space]')].map(b => b.dataset.space)`;

test('the machine tree: pinned first, then natural order, at the top and in groups; VMs under their host', async () => {
  const p = await browser.page(fleet(['mac', 'lx/containers/web']), {ui: ui({sel: 'fleet', open: {'lx/containers': true}})});
  try {
    await p.waitFor(`document.querySelector('#tree .row[data-select="lx/vms/ubuntu"]')`);
    assert.deepEqual(await p.eval(ROWS), [
      'mac@0', 'mac/base@1', 'mac/containers@1',
      'lx@0', 'lx/base@1', 'lx/containers@1', 'lx/containers/web@2', 'lx/containers/api@2', 'lx/vms@1', 'lx/vms/ubuntu@2', 'lx/vms/win11@2',
      'lx2@0', 'lx2/base@1', 'lx2/containers@1',
      'lx10@0', 'lx10/base@1', 'lx10/containers@1',
      'win@0', 'win/base@1']);
    // each machine's status class and value: a share of its host while it has data, else why it has none
    assert.deepEqual(await p.eval(MACHINES), {mac: ['ok', '%'], lx: ['ok', '%'], 'lx/vms/ubuntu': ['ok', '%'], 'lx/vms/win11': ['off', '%'],
      lx2: ['stale', '%'], lx10: ['ok', '%'], win: ['offline', 'offline']});
    assert.deepEqual(await p.eval(SPACES), ['fleet', 'mac', 'lx/containers/web']);
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#tree [data-pin][aria-pressed="true"]')].map(b => b.dataset.pin)`), ['mac', 'lx/containers/web']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Pins only: just the pins, by name, each with what it holds', async () => {
  const p = await browser.page(fleet(['mac', 'lx/containers/web', 'lx10']), {ui: ui({sel: 'fleet', pinsOnly: true})});
  try {
    await p.waitFor(`document.querySelector('#tree .row[data-select="lx/containers/web"]')`);
    assert.deepEqual(await p.eval(ROWS), ['lx10@0', 'lx10/base@1', 'lx10/containers@1', 'mac@0', 'mac/base@1', 'mac/containers@1', 'lx/containers/web@0']);
    await p.click('#tree-title [data-pinsonly="0"]');
    await p.waitFor(`document.querySelectorAll('#tree .row.machine').length === 7`);
    assert.deepEqual((await p.eval(ROWS)).filter(r => r.endsWith('@0')), ['lx10@0', 'mac@0', 'lx@0', 'lx2@0', 'win@0']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the + picker offers every machine, VM, group, project and container in tree order, and a search narrows it', async () => {
  const fx = fleet(['mac']);
  const p = await browser.page(fx, {ui: ui({sel: 'fleet'})});
  const LIST = `[...document.querySelectorAll('#picklist [data-pin]')].map(b => b.dataset.pin + ' ' + b.querySelector('.pk').textContent + (b.getAttribute('aria-pressed') === 'true' ? ' pinned' : ''))`;
  try {
    await p.waitFor(`document.querySelectorAll('#tree .row.machine').length === 7`);
    await p.click('[data-addpin]');
    await p.waitFor(`document.querySelector('#picklist [data-pin]')`);
    assert.deepEqual(await p.eval(LIST), [
      'mac machine · 2 pinned', 'mac/base Base system', 'mac/containers group · 1', 'mac/containers/web container',
      'lx machine · 3', 'lx/base Base system', 'lx/containers group · 2', 'lx/containers/api container', 'lx/containers/web container',
      'lx/vms group · 2', 'lx/vms/ubuntu VM · 1', 'lx/vms/ubuntu/base Base system', 'lx/vms/win11 VM · 1', 'lx/vms/win11/base Base system',
      'lx2 machine · 2', 'lx2/base Base system', 'lx2/containers group · 1', 'lx2/containers/web container',
      'lx10 machine · 2', 'lx10/base Base system', 'lx10/containers group · 1', 'lx10/containers/web container',
      'win machine · 1', 'win/base Base system']);
    await p.eval(`(() => { const q = document.getElementById('pickq'); q.value = 'ubuntu'; q.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
    await p.waitFor(`document.querySelectorAll('#picklist [data-pin]').length === 2`);
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#picklist [data-pin]')].map(b => [b.dataset.pin, b.querySelector('.pw') ? b.querySelector('.pw').textContent : ''])`),
      [['lx/vms/ubuntu', 'lab-linux › VMs'], ['lx/vms/ubuntu/base', 'lab-linux › VMs › ubuntu']]);
    await p.eval(`(() => { const q = document.getElementById('pickq'); q.value = 'nothing like this'; q.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
    await p.waitFor(`!document.querySelector('#picklist [data-pin]')`);
    assert.match(await p.eval(`document.getElementById('picklist').textContent`), /Nothing matches/);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
