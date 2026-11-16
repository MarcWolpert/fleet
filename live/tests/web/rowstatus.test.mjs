// SPDX-License-Identifier: GPL-3.0-or-later
// A machine row's status look follows the machine from poll to poll (#129): the class on the row (ok, stale,
// offline, off, …) that greys its name or value changes with its status dot, without redrawing the tree.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

// each machine row's classes, sorted
const ROWS = `Object.fromEntries([...document.querySelectorAll('#tree .row.machine')].map(r => [r.dataset.select, [...r.classList].sort().join(' ')]))`;
const INK = `Object.fromEntries([...document.querySelectorAll('#tree .row.machine')].map(r => [r.dataset.select, getComputedStyle(r.querySelector('.nm')).color + ' / ' + getComputedStyle(r.querySelector('.val')).color]))`;
const status = (fx, id, st, hasData = true) => Object.assign(fx.fleet.machines.find(m => m.id === id), {status: st, has_data: hasData});

test('a machine that changes status between polls changes its row\'s look with its dot', async () => {
  const fx = fixture();
  status(fx, 'lx2', 'offline');                       // reconnecting: it has data, so it's stale
  status(fx, 'win', 'off', false);
  const p = await browser.page(fx, {ui: ui({sel: 'fleet'})});
  try {
    await p.waitFor(`document.querySelectorAll('#tree .row.machine').length === 4`);
    assert.deepEqual(await p.eval(ROWS), {lx: 'machine ok row', lx2: 'machine row stale', mac: 'machine ok row', win: 'machine off row'});
    const live = (await p.eval(INK)).mac;
    await p.eval(`(() => { window.R0 = [...document.querySelectorAll('#tree .row.machine')]; return true; })()`);
    status(fx, 'lx', 'offline');                      // lab-linux starts reconnecting
    status(fx, 'lx2', 'ok');                          // lab-linux-2 is back
    status(fx, 'win', 'offline', false);              // lab-windows is on but doesn't answer
    await p.waitFor(`['lx', 'lx2', 'win'].map(id => document.querySelector('[data-sdot="' + id + '"]').className).join() === 'sdot stale,sdot ok,sdot offline'`);
    assert.deepEqual(await p.eval(ROWS), {lx: 'machine row stale', lx2: 'machine ok row', mac: 'machine ok row', win: 'machine offline row'});
    const ink = await p.eval(INK);
    assert.equal(ink.lx2, live, 'lab-linux-2 is live again: its name and value look like lab-mac\'s');
    assert.notEqual(ink.lx.split(' / ')[1], live.split(' / ')[1], 'lab-linux is stale: its value is grey');
    assert.notEqual(ink.win.split(' / ')[0], live.split(' / ')[0], 'lab-windows is offline: its name is grey');
    // nothing else: a poll patched the rows in place, it didn't redraw the tree
    assert.equal(await p.eval(`[...document.querySelectorAll('#tree .row.machine')].every((r, i) => r === window.R0[i])`), true);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a selected machine keeps its selection while its status changes', async () => {
  const fx = fixture();
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelector('#tree .row.machine[data-select="lx"].sel')`);
    status(fx, 'lx', 'offline');
    await p.waitFor(`document.querySelector('[data-sdot="lx"]').className === 'sdot stale'`);
    assert.equal(await p.eval(`[...document.querySelector('#tree .row.machine[data-select="lx"]').classList].sort().join(' ')`), 'machine row sel stale');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a VM its host sees but that isn\'t running looks off, not reconnecting', async () => {
  const fx = fixture(), lx = fx.fleet.machines.find(m => m.id === 'lx');
  const vm = (name, status) => ({id: 'lx/vms/' + name, name, tile: 'vm', status, os: 'VM', agent: 'seen from the host', cap: [16, 64, 0, 1, 1], gpus: [],
    cronLabel: 'Cron jobs', base: {id: 'lx/vms/' + name + '/base', g: []}, baseCron: [], compose: [], containers: [], vms: []});   // as the server sends one: no has_data
  lx.vms = [vm('ubuntu', 'ok'), vm('win11', 'off')];
  const p = await browser.page(fx, {ui: ui({sel: 'lx/vms/win11', open: {'lx/vms': true}})});
  try {
    await p.waitFor(`document.querySelector('#tree .row[data-select="lx/vms/win11"]') && document.querySelector('#main .hero h1')`);
    assert.deepEqual(await p.eval(`['ubuntu', 'win11'].map(n => { const r = document.querySelector('#tree .row[data-select="lx/vms/' + n + '"]'), d = r.querySelector('.sdot'); return [[...r.classList].sort().join(' '), d.className, d.title]; })`),
      [['machine ok row', 'sdot ok', 'live'], ['machine off row sel', 'sdot off', 'off']]);
    assert.equal(await p.eval(`document.querySelector('#main .hero h1 .sdot').className`), 'sdot off');
    assert.equal(await p.eval(`!!document.querySelector('#main .spill')`), false, 'no "reconnecting" pill');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
