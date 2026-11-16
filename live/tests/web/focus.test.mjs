// SPDX-License-Identifier: GPL-3.0-or-later
// A refresh rebuilds the main pane; keyboard focus comes back to the same control, even where a view draws
// the same button twice (issue #121): a group's ranked list and Inside table, a machine's GPU card and Inside
// table, All machines' two "of capacity / of what's in use" switches.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const H = 60, flat = v => new Array(H).fill(v);
function fx2(){
  const fx = fixture(), lx = fx.fleet.machines.find(m => m.id === 'lx');
  lx.base = {id: 'lx/base', h: {cpu: flat(1), gpu: flat(20)}, g: ['gpu0']};
  lx.containers = [
    {id: 'lx/containers/web', name: 'web', image: 'nginx:1', status: 'Up 2 hours', g: ['gpu0'], h: {cpu: flat(0.4), gpu: flat(10)}},
    {id: 'lx/containers/db', name: 'db', image: 'postgres:16', status: 'Up 2 hours', g: [], h: {cpu: flat(0.2)}}];
  return fx;
}
// where focus is: [its data-select or data-mode, the part of the page it is in]
const FOCUSED = `(() => { const a = document.activeElement; if (!a || !a.dataset) return null; return [a.dataset.select || a.dataset.mode || '', a.closest('tbody') ? 'table' : a.closest('.gpus') ? 'gpu card' : a.closest('.rank') ? 'ranked' : a.closest('section') ? a.closest('section').querySelector('h2').textContent : '']; })()`;
const refresh = p => p.eval(`(lastMainHTML = '', renderMain(), true)`);
const focus = (p, sel, i) => p.eval(`(() => { const e = document.querySelectorAll('#main ' + ${JSON.stringify(sel)})[${i}]; e.focus(); return document.activeElement === e; })()`);
async function open(fx, sel){
  const p = await browser.page(fx, {ui: ui({sel})});
  try { await p.waitFor(`document.querySelector('#main .hero h1')`); } catch (e) { await p.close(); throw e; }
  return p;
}

test('a group\'s Inside table keeps focus on its own row, not the ranked list\'s', async () => {
  const p = await open(fx2(), 'lx/containers');
  try {
    assert.equal(await p.eval(`document.querySelectorAll('#main [data-select="lx/containers/db"]').length`), 2);
    assert.equal(await focus(p, '[data-select="lx/containers/db"]', 1), true);
    assert.deepEqual(await p.eval(FOCUSED), ['lx/containers/db', 'table']);
    await refresh(p);
    assert.deepEqual(await p.eval(FOCUSED), ['lx/containers/db', 'table']);
    await refresh(p);
    assert.deepEqual(await p.eval(FOCUSED), ['lx/containers/db', 'table']);
    // the control: the ranked list's copy stays where it is too
    assert.equal(await focus(p, '[data-select="lx/containers/db"]', 0), true);
    await refresh(p);
    assert.deepEqual(await p.eval(FOCUSED), ['lx/containers/db', 'ranked']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a machine\'s Inside table keeps focus on Base system, not the GPU card\'s', async () => {
  const p = await open(fx2(), 'lx');
  try {
    assert.equal(await p.eval(`document.querySelectorAll('#main [data-select="lx/base"]').length`), 2);
    assert.equal(await focus(p, '[data-select="lx/base"]', 1), true);
    await refresh(p);
    assert.deepEqual(await p.eval(FOCUSED), ['lx/base', 'table']);
    assert.equal(await focus(p, '[data-select="lx/containers/web"]', 1), true);
    await refresh(p);
    assert.deepEqual(await p.eval(FOCUSED), ['lx/containers/web', 'table']);
    assert.equal(await focus(p, '[data-select="lx/containers/web"]', 0), true);
    await refresh(p);
    assert.deepEqual(await p.eval(FOCUSED), ['lx/containers/web', 'gpu card']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('All machines keeps focus on the By machine switch, not the where-card\'s', async () => {
  const p = await open(fx2(), 'fleet');
  try {
    assert.equal(await p.eval(`document.querySelectorAll('#main [data-mode="used"]').length`), 2);
    assert.equal(await focus(p, '[data-mode="used"]', 1), true);
    await refresh(p);
    assert.deepEqual(await p.eval(FOCUSED), ['used', 'By machine · CPU']);
    assert.equal(await focus(p, '[data-mode="used"]', 0), true);
    await refresh(p);
    assert.deepEqual(await p.eval(FOCUSED), ['used', 'Where your fleet’s usage goes']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('when a copy before it goes away, focus stays on the same control', async () => {
  const fx = fx2();
  const p = await open(fx, 'lx');
  try {
    assert.equal(await focus(p, '[data-select="lx/containers/web"]', 1), true);
    fx.fleet.machines.find(m => m.id === 'lx').containers[0].h.gpu = flat(0);   // web stops using the GPU: it leaves the GPU card
    await p.eval(`(refreshNow(), true)`);
    await p.waitFor(`document.querySelectorAll('#main [data-select="lx/containers/web"]').length === 1`);
    assert.deepEqual(await p.eval(FOCUSED), ['lx/containers/web', 'table']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
