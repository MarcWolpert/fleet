// SPDX-License-Identifier: GPL-3.0-or-later
// CPU → Logical processors: pinned CPUs and pinned CPU groups go first and are saved through
// /api/tilepins; the Sort menu orders the tiles in each group by number, usage or clock.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

// The server keeps what /api/tilepins saved (dropping empty lists) and sends it back with every
// /api/fleet, so a pin has to survive the next poll and a reload.
function keepTilePins(fx){
  let posts = [];
  Object.defineProperty(fx, 'posts', {configurable: true, get: () => posts, set: v => {
    posts = v; const w = v[v.length - 1];
    if (w && w.path === '/api/tilepins') fx.fleet.tilepins = Object.fromEntries(Object.entries(JSON.parse(w.body)).filter(([, l]) => l.length));
  }});
  return fx;
}
// lab-linux's readings, with ties: CPUs 1 and 9 both at 63 %, CPUs 2 and 11 both at 3.011 GHz, CPU 3's clock unknown.
const PCT = {0: 0, 1: 63, 2: 14, 3: 21, 8: 56, 9: 63, 10: 70, 11: 77, 4: 28, 5: 35, 6: 42, 7: 49, 12: 84, 13: 91, 14: 98, 15: 5};
function fx2(){
  const fx = keepTilePins(fixture());
  for (const id of ['lx', 'lx2']) fx.cpus[id].cpus.forEach(c => { c.pct = PCT[c.n]; c.mhz = c.n === 2 ? 3011 : c.n === 3 ? 0 : 3000 + c.n; });
  return fx;
}
// Each group, top to bottom: its name, whether it is pinned, and its tiles in order (* = pinned).
const TILES = `[...document.querySelectorAll('.lgroups > div')].map(g => ({group: g.querySelector('[data-lgroup]').textContent, pinned: g.querySelector('.lgh [data-tpin]').getAttribute('aria-pressed') === 'true',
  cpus: [...g.querySelectorAll('.lcell')].map(c => (c.classList.contains('pinned') && c.querySelector('[data-tpin]').getAttribute('aria-pressed') === 'true' ? '*' : '') + c.querySelector('[data-lcpu]').dataset.lcpu)}))`;
const tiles = p => p.eval(TILES);
const NUMBER = [{group: 'CCD 0', pinned: false, cpus: ['0', '1', '2', '3', '8', '9', '10', '11']}, {group: 'CCD 1', pinned: false, cpus: ['4', '5', '6', '7', '12', '13', '14', '15']}];
const saved = fx => (fx.posts || []).filter(w => w.path === '/api/tilepins').map(w => JSON.parse(w.body));
async function open(fx, sel = 'lx'){
  const p = await browser.page(fx, {ui: ui({sel, metric: 'cpu', cpuView: 'logical'})});
  try { await p.waitFor(`document.querySelector('[data-lcpu]')`); } catch (e) { await p.close(); throw e; }
  return p;
}
const pin = (p, spec) => p.click(`[data-tpin="${spec}"]`);   // a real click: the pin sits above the tile's own button
const sortBy = (p, v) => p.eval(`(() => { const s = document.querySelector('[data-tilesort="cpu"]'); s.value = '${v}'; s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
// Wait for the next poll to land and render (each poll brings a new DATA).
const nextPoll = async p => { await p.eval(`(DATA.__seen = 1, true)`); await p.waitFor(`!DATA.__seen && !busy`, 5000); };

test('Sort orders the tiles in each group by number, usage or clock, ties by CPU number; Number is the default', async () => {
  const p = await open(fx2());
  try {
    assert.deepEqual(await p.eval(`[...document.querySelector('[data-tilesort="cpu"]').options].map(o => [o.value, o.textContent, o.selected])`),
      [['number', 'Number', true], ['usage', 'Usage', false], ['clock', 'Clock', false]]);
    assert.deepEqual(await tiles(p), NUMBER);
    await sortBy(p, 'usage');
    assert.deepEqual(await tiles(p), [{group: 'CCD 0', pinned: false, cpus: ['11', '10', '1', '9', '8', '3', '2', '0']}, {group: 'CCD 1', pinned: false, cpus: ['14', '13', '12', '7', '6', '5', '4', '15']}]);
    await sortBy(p, 'clock');
    assert.deepEqual(await tiles(p), [{group: 'CCD 0', pinned: false, cpus: ['2', '11', '10', '9', '8', '1', '0', '3']}, {group: 'CCD 1', pinned: false, cpus: ['15', '14', '13', '12', '7', '6', '5', '4']}]);
    await nextPoll(p);
    assert.equal(await p.eval(`document.querySelector('[data-tilesort="cpu"]').value`), 'clock', 'the choice stays across a poll');
    await sortBy(p, 'number');
    assert.deepEqual(await tiles(p), NUMBER);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a pinned CPU goes first in its group, a pinned group goes first; each pin is saved, survives a poll and a reload, and unpins', async () => {
  const fx = fx2();
  const p = await open(fx);
  try {
    await pin(p, 'cpu|lx|13');
    assert.deepEqual(await tiles(p), [NUMBER[0], {group: 'CCD 1', pinned: false, cpus: ['*13', '4', '5', '6', '7', '12', '14', '15']}]);
    assert.deepEqual(await p.eval(`(b => [b.getAttribute('aria-label'), b.title])(document.querySelector('[data-tpin="cpu|lx|13"]'))`), ['Unpin CPU 13 to the top', 'Unpin']);
    await pin(p, 'cpugroup|lx|CCD 1');
    await pin(p, 'cpu|lx|14');
    const pinned = [{group: 'CCD 1', pinned: true, cpus: ['*13', '*14', '4', '5', '6', '7', '12', '15']}, NUMBER[0]];
    assert.deepEqual(await tiles(p), pinned);
    await sortBy(p, 'usage');
    assert.deepEqual(await tiles(p), [{group: 'CCD 1', pinned: true, cpus: ['*14', '*13', '12', '7', '6', '5', '4', '15']}, {group: 'CCD 0', pinned: false, cpus: ['11', '10', '1', '9', '8', '3', '2', '0']}], 'pins first, then Sort');
    await sortBy(p, 'number');
    await nextPoll(p); await nextPoll(p);
    assert.deepEqual(await tiles(p), pinned, 'after a poll');
    await p.reload();
    await p.waitFor(`document.querySelector('[data-lcpu]')`);
    assert.deepEqual(await tiles(p), pinned, 'after a reload');
    await pin(p, 'cpu|lx|13');
    await pin(p, 'cpugroup|lx|CCD 1');
    assert.deepEqual(await tiles(p), [NUMBER[0], {group: 'CCD 1', pinned: false, cpus: ['*14', '4', '5', '6', '7', '12', '13', '15']}]);
    assert.equal(await p.eval(`(S.cpuSel && S.cpuSel.cpus.length) || 0`), 0, 'a pin click picks no CPU');
    assert.deepEqual(saved(fx), [{'cpu|lx': ['13']}, {'cpu|lx': ['13'], 'cpugroup|lx': ['CCD 1']}, {'cpu|lx': ['13', '14'], 'cpugroup|lx': ['CCD 1']},
      {'cpu|lx': ['14'], 'cpugroup|lx': ['CCD 1']}, {'cpu|lx': ['14'], 'cpugroup|lx': []}]);
    await nextPoll(p);
    assert.deepEqual(fx.fleet.tilepins, {'cpu|lx': ['14']});
    assert.deepEqual(await tiles(p), [NUMBER[0], {group: 'CCD 1', pinned: false, cpus: ['*14', '4', '5', '6', '7', '12', '13', '15']}], 'unpinned for good');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('pins belong to the machine they were made on: the same CPUs and groups on another host stay in order', async () => {
  const fx = fx2();
  fx.fleet.tilepins = {'cpu|lx': ['13', '14'], 'cpugroup|lx': ['CCD 1']};
  const p = await open(fx, 'lx2');
  try {
    assert.deepEqual(await tiles(p), NUMBER);
    assert.deepEqual(saved(fx), []);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
