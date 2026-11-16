// SPDX-License-Identifier: GPL-3.0-or-later
// CPU groups (#356): in Logical processors each group (a CCD, P- or E-cores, an Apple core cluster) folds to its
// header line, kept per machine and group in ui.json; and a third view, named for the grouping the machine has
// (Each CCD, Each core type, Each cluster), draws one graph per group: its processors' average over time.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch, heldPoll} from './harness.mjs';
import {fixture, ui, CCD0, CCD1} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const H = 60;
// Every processor with a history of its own, its reading now the last point of it, as the server sends them.
// lab-mac's cores in Apple's clusters; lab-linux-2 not grouped at all (one group, All processors).
function fx3(){
  const fx = fixture();
  for (const d of Object.values(fx.cpus)) d.cpus.forEach(c => { c.h = Array.from({length: H}, (_, i) => (c.n * 6 + i * 1.5) % 97); c.pct = c.h[H - 1]; });
  const clusters = [{name: 'Performance cores · cluster 0', cpus: [0, 1]}, {name: 'Performance cores · cluster 1', cpus: [2, 3]}, {name: 'Efficiency cores', cpus: [4, 5]}];
  fx.fleet.machines.find(m => m.id === 'mac').groups = clusters; fx.cpus.mac.groups = clusters;
  const all = [{name: 'All processors', cpus: [...Array(16).keys()]}];
  fx.fleet.machines.find(m => m.id === 'lx2').groups = all; fx.cpus.lx2.groups = all;
  return fx;
}
// keeps what /api/tilepins saved, as the server does, so a pin survives the next poll
function keepTilePins(fx){
  let posts = [];
  Object.defineProperty(fx, 'posts', {configurable: true, get: () => posts, set: v => {
    posts = v; const w = v[v.length - 1];
    if (w && w.path === '/api/tilepins') fx.fleet.tilepins = Object.fromEntries(Object.entries(JSON.parse(w.body)).filter(([, l]) => l.length));
  }});
  return fx;
}
async function open(fx, over = {}){
  const p = await browser.page(fx, {ui: ui(Object.assign({sel: 'lx', metric: 'cpu', cpuView: 'logical'}, over))});
  try { await p.waitFor(`document.querySelector('[data-lcpu], .cgtile, [data-card="graph"]')`); } catch (e) { await p.close(); throw e; }
  return p;
}
// Logical processors: each group top to bottom, its chevron [aria-expanded, name], header and the CPUs it shows
const GROUPS = `[...document.querySelectorAll('.lgroups > div')].map(g => { const b = g.querySelector('.lgh [data-lgfold]');
  return {name: g.querySelector('[data-lgroup]').textContent, fold: b ? [b.dataset.lgfold, b.getAttribute('aria-expanded'), b.getAttribute('aria-label')] : null,
    head: [...g.querySelectorAll('.lgh > span')].map(s => s.textContent), cpus: [...g.querySelectorAll('[data-lcpu]')].map(c => +c.dataset.lcpu)}; })`;
const groups = p => p.eval(GROUPS);
const avgOf = (fx, mid, cpus) => cpus.reduce((s, n) => s + fx.cpus[mid].cpus.find(c => c.n === n).pct, 0) / cpus.length;
const pctText = v => v >= 10 ? Math.round(v) + '%' : v >= .1 ? v.toFixed(1) + '%' : v > 0 ? '<0.1%' : '0%';
const g1 = (fx, name, cpus, open = true) => ({name, fold: [name, String(open), (open ? 'Fold ' : 'Unfold ') + name], head: [cpus.length + ' processors', 'average ' + pctText(avgOf(fx, 'lx', cpus))], cpus: open ? cpus : []});
const savedFolds = fx => (fx.posts || []).filter(w => w.path === '/api/prefs').map(w => JSON.parse(w.body).foldedCpuGroups);
const TOGGLE = `[...document.querySelectorAll('#main [data-cpuview]')].map(b => [b.dataset.cpuview, b.textContent, b.getAttribute('aria-pressed')])`;
// The whole-group view: each tile's group, its CPUs, value, lines, whether it's pressed, and its graph as percentages
const TILES = `[...document.querySelectorAll('.cgtile')].map(t => { const b = t.querySelector('.tsel'), pl = t.querySelector('svg polyline');
  return {name: t.querySelector('.kn').textContent, cpus: b.dataset.lgroup, value: t.querySelector('.kb').textContent, sub: t.querySelector('.km').textContent,
    pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label'), pinned: t.querySelector('[data-tpin]').getAttribute('aria-pressed'),
    line: pl.getAttribute('points').split(' ').map(xy => xy.split(',').map(Number)).map(([x, y]) => [x, (64 - y) / 58 * 100])}; })`;
const tiles = p => p.eval(TILES);

test('each group\'s header has a chevron that folds the group to that line and unfolds it, saved per machine', async () => {
  const fx = fx3(), p = await open(fx);
  try {
    assert.deepEqual(await groups(p), [g1(fx, 'CCD 0', CCD0), g1(fx, 'CCD 1', CCD1)]);
    await p.click('[data-lgfold="CCD 1"]');
    await p.waitFor(`document.querySelector('[data-lgfold="CCD 1"]').getAttribute('aria-expanded') === 'false'`);
    assert.deepEqual(await groups(p), [g1(fx, 'CCD 0', CCD0), g1(fx, 'CCD 1', CCD1, false)]);
    await p.waitFor(`!prefsBusy`);
    assert.deepEqual(savedFolds(fx), [{lx: ['CCD 1']}]);
    await p.click('[data-lgfold="CCD 0"]');
    await p.waitFor(`document.querySelector('[data-lgfold="CCD 0"]').getAttribute('aria-expanded') === 'false'`);
    assert.deepEqual(await groups(p), [g1(fx, 'CCD 0', CCD0, false), g1(fx, 'CCD 1', CCD1, false)]);
    await p.click('[data-lgfold="CCD 1"]');
    await p.waitFor(`document.querySelector('[data-lgfold="CCD 1"]').getAttribute('aria-expanded') === 'true'`);
    assert.deepEqual(await groups(p), [g1(fx, 'CCD 0', CCD0, false), g1(fx, 'CCD 1', CCD1)]);
    await p.waitFor(`!prefsBusy`);
    assert.deepEqual(savedFolds(fx), [{lx: ['CCD 1']}, {lx: ['CCD 1', 'CCD 0']}, {lx: ['CCD 0']}]);
    // the same group on another machine is its own: lab-linux-2's... and lab-windows' CCD 0 stays open
    await p.click('#tree [data-select="win"].nm');
    await p.waitFor(`document.querySelector('#main .hero h1').firstChild.textContent.trim() === 'lab-windows' && document.querySelector('[data-lcpu]')`);
    assert.deepEqual((await groups(p)).map(g => [g.name, g.fold[1], g.cpus]), [['CCD 0', 'true', [0, 1, 2, 3]], ['CCD 1', 'true', [4, 5, 6, 7]]]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a click on a group header\'s empty area folds it; its name still selects the group, its pin still pins it', async () => {
  const fx = keepTilePins(fx3()), p = await open(fx);
  try {
    await p.click('.lgroups > div:nth-child(2) .lgh > span');   // "8 processors"
    await p.waitFor(`document.querySelector('[data-lgfold="CCD 1"]').getAttribute('aria-expanded') === 'false'`);
    await p.click(`[data-lgroup="${CCD1.join(',')}"]`);
    await p.waitFor(`S.cpuSel && S.cpuSel.cpus.length === 8`);
    assert.deepEqual(await p.eval(`S.cpuSel`), {mid: 'lx', cpus: CCD1});
    await p.click('[data-tpin="cpugroup|lx|CCD 1"]');
    await p.waitFor(`document.querySelector('.lgroups > div [data-lgroup]').textContent === 'CCD 1'`);
    assert.deepEqual(await groups(p), [g1(fx, 'CCD 1', CCD1, false), g1(fx, 'CCD 0', CCD0)]);
    await p.click('.lgroups > div:nth-child(1) .lgh > span:last-child');   // "average …"
    await p.waitFor(`document.querySelector('[data-lgfold="CCD 1"]').getAttribute('aria-expanded') === 'true'`);
    assert.deepEqual(await groups(p), [g1(fx, 'CCD 1', CCD1), g1(fx, 'CCD 0', CCD0)]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a folded group stays folded through polls, a stale poll, a reload and a restart; focus stays on its chevron', async () => {
  const fx = fx3(), p = await open(fx);
  try {
    fx.holdFleet = true;
    const stale = await heldPoll(p, fx);   // made before the fold
    await p.click('[data-lgfold="CCD 0"]');
    await p.waitFor(`!prefsBusy && document.querySelector('[data-lgfold="CCD 0"]').getAttribute('aria-expanded') === 'false'`);
    assert.deepEqual(fx.fleet.prefs, {foldedCpuGroups: {lx: ['CCD 0']}});
    stale();
    const next = await heldPoll(p, fx);   // the page polls again, so the stale answer has been read and drawn
    assert.deepEqual(await groups(p), [g1(fx, 'CCD 0', CCD0, false), g1(fx, 'CCD 1', CCD1)]);
    fx.holdFleet = false; next();
    await p.eval(`(document.querySelector('[data-lgfold="CCD 0"]').focus(), true)`);
    for (let i = 0; i < 2; i++){
      fx.cpus.lx.cpus[4].pct = 50 + i;   // a new reading: the card is redrawn
      await p.waitFor(`document.querySelector('[data-lcpu="4"]').getAttribute('aria-label') === 'CPU 4, ${50 + i}%'`);
      assert.deepEqual((await groups(p))[0], g1(fx, 'CCD 0', CCD0, false));
      assert.equal(await p.eval(`document.activeElement.matches('[data-lgfold="CCD 0"]')`), true, 'focus, poll ' + i);
    }
    await p.reload();
    await p.waitFor(`document.querySelector('[data-lcpu]')`);
    assert.deepEqual(await groups(p), [g1(fx, 'CCD 0', CCD0, false), g1(fx, 'CCD 1', CCD1)]);
    assert.deepEqual(p.errors, []);
  } finally { fx.holdFleet = false; (fx.held || []).splice(0).forEach(send => send()); await p.close(); }
  const q = await open(fx);   // a restart: only what the server kept
  try { assert.deepEqual(await groups(q), [g1(fx, 'CCD 0', CCD0, false), g1(fx, 'CCD 1', CCD1)]); assert.deepEqual(q.errors, []); } finally { await q.close(); }
});

test('Enter and Space on a group\'s chevron fold and unfold it', async () => {
  const fx = fx3(), p = await open(fx);
  try {
    await p.eval(`(document.querySelector('[data-lgfold="CCD 1"]').focus(), true)`);
    await p.key('Enter');
    await p.waitFor(`document.querySelector('[data-lgfold="CCD 1"]').getAttribute('aria-expanded') === 'false'`);
    assert.deepEqual((await groups(p))[1], g1(fx, 'CCD 1', CCD1, false));
    await p.key(' ', 'Space');
    await p.waitFor(`document.querySelector('[data-lgfold="CCD 1"]').getAttribute('aria-expanded') === 'true'`);
    assert.deepEqual((await groups(p))[1], g1(fx, 'CCD 1', CCD1));
    assert.equal(await p.eval(`document.activeElement.matches('[data-lgfold="CCD 1"]')`), true);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the third view is named for the grouping each machine has, and only a grouped machine has it', async () => {
  const fx = fx3(), p = await open(fx, {cpuView: 'type'});
  const want = third => [['type', 'By type', 'true'], ['logical', 'Logical processors', 'false']].concat(third ? [['groups', third, 'false']] : []);
  try {
    const seen = {};
    for (const [id, name] of [['lx', 'lab-linux'], ['win', 'lab-windows'], ['mac', 'lab-mac'], ['lx2', 'lab-linux-2']]){
      await p.click(`#tree [data-select="${id}"].nm`);
      await p.waitFor(`document.querySelector('#main .hero h1').firstChild.textContent.trim() === '${name}' && document.querySelector('[data-cpuview]')`);
      seen[id] = await p.eval(TOGGLE);
    }
    assert.deepEqual(seen, {lx: want('Each CCD'), win: want('Each CCD'), mac: want('Each cluster'), lx2: want(null)});
    const mac = fixture(), q = await open(mac, {sel: 'mac', cpuView: 'type'});   // Performance and Efficiency cores, no clusters
    try { assert.deepEqual(await q.eval(TOGGLE), want('Each core type')); } finally { await q.close(); }
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Each CCD: one graph per CCD, its processors\' average over time, the same number its header shows', async () => {
  const fx = fx3(), p = await open(fx);
  try {
    const heads = (await groups(p)).map(g => [g.name, g.head[1]]);
    await p.click('[data-cpuview="groups"]');
    await p.waitFor(`document.querySelectorAll('.cgtile').length === 2`);
    assert.equal(await p.eval(`S.cpuView`), 'groups');
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#main .card-h h2')].map(h => h.textContent)`), ['Where this machine’s usage goes', 'Each CCD', 'GPUs: what runs on which', 'Inside lab-linux']);
    assert.deepEqual(await p.eval(`document.querySelector('[data-card="cpugroups"] .card-h .sub').textContent`), 'lab-linux CPU · 16 processors in 2 CCDs');
    assert.deepEqual(await p.eval(TOGGLE), [['type', 'By type', 'false'], ['logical', 'Logical processors', 'false'], ['groups', 'Each CCD', 'true']]);
    const ts = await tiles(p);
    assert.deepEqual(ts.map(t => [t.name, 'average ' + t.value]), heads, 'the value is the header\'s average');
    assert.deepEqual(ts.map(t => [t.name, t.cpus, t.sub, t.pressed, t.label, t.pinned]), [
      ['CCD 0', CCD0.join(','), '8 processors · CPUs 0–3, 8–11', 'false', 'CCD 0, average ' + pctText(avgOf(fx, 'lx', CCD0)), 'false'],
      ['CCD 1', CCD1.join(','), '8 processors · CPUs 4–7, 12–15', 'false', 'CCD 1, average ' + pctText(avgOf(fx, 'lx', CCD1)), 'false']]);
    for (const [t, cpus] of [[ts[0], CCD0], [ts[1], CCD1]]){
      const hist = cpus.map(n => fx.cpus.lx.cpus.find(c => c.n === n).h), want = Array.from({length: H}, (_, i) => hist.reduce((s, h) => s + h[i], 0) / cpus.length);
      assert.equal(t.line.length, H);
      t.line.forEach(([x, v], i) => { assert.ok(Math.abs(x - i / (H - 1) * 100) < 0.06, `${t.name} x ${i}`); assert.ok(Math.abs(v - want[i]) < 0.1, `${t.name} at ${i}: ${v} vs ${want[i]}`); });
      assert.ok(Math.abs(t.line[H - 1][1] - avgOf(fx, 'lx', cpus)) < 0.1, t.name + ' now');
    }
    // kept: through a poll with new readings, and a reload
    fx.cpus.lx.cpus.forEach(c => { c.h = c.h.slice(1).concat([50]); c.pct = 50; });
    await p.waitFor(`document.querySelector('.cgtile .kb').textContent === '50%'`);
    assert.deepEqual((await tiles(p)).map(t => [t.name, t.value]), [['CCD 0', '50%'], ['CCD 1', '50%']]);
    await p.reload();
    await p.waitFor(`document.querySelectorAll('.cgtile').length === 2`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('each core type and each cluster: one graph per group too', async () => {
  for (const [fx, names] of [[fixture(), ['Performance cores', 'Efficiency cores']], [fx3(), ['Performance cores · cluster 0', 'Performance cores · cluster 1', 'Efficiency cores']]]){
    const p = await open(fx, {sel: 'mac', cpuView: 'groups'});
    try {
      await p.waitFor(`document.querySelectorAll('.cgtile').length === ${names.length}`);
      const ts = await tiles(p);
      assert.deepEqual(ts.map(t => t.name), names);
      assert.deepEqual(ts.map(t => t.value), fx.cpus.mac.groups.map(g => pctText(avgOf(fx, 'mac', g.cpus))));
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  }
});

test('a machine that isn\'t grouped shows Logical processors instead, and the next grouped one its groups again', async () => {
  const fx = fx3(), p = await open(fx, {sel: 'lx2', cpuView: 'groups'});
  try {
    await p.waitFor(`document.querySelector('[data-lcpu]')`);
    assert.deepEqual(await p.eval(TOGGLE), [['type', 'By type', 'false'], ['logical', 'Logical processors', 'true']]);
    assert.equal(await p.eval(`document.querySelectorAll('.cgtile').length`), 0);
    await p.click('#tree [data-select="lx"].nm');
    await p.waitFor(`document.querySelectorAll('.cgtile').length === 2`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('in Each CCD a click picks a CCD, ⌘-click adds one, its pin pins it as in Logical processors, and right-click offers both', async () => {
  const fx = keepTilePins(fx3()), p = await open(fx, {cpuView: 'groups'});
  try {
    await p.waitFor(`document.querySelectorAll('.cgtile').length === 2`);
    await p.click(`.cgtile [data-lgroup="${CCD1.join(',')}"]`);
    await p.waitFor(`document.querySelector('[data-cpuclear]')`);
    assert.deepEqual(await p.eval(`S.cpuSel`), {mid: 'lx', cpus: CCD1});
    assert.deepEqual((await tiles(p)).map(t => [t.name, t.pressed]), [['CCD 0', 'false'], ['CCD 1', 'true']]);
    assert.equal(await p.eval(`document.querySelector('[data-card="cpupick"] h2').textContent`), 'CCD 1 · CPUs 4–7, 12–15');
    await p.click(`.cgtile [data-lgroup="${CCD0.join(',')}"]`, {modifiers: 4});   // ⌘
    await p.waitFor(`S.cpuSel.cpus.length === 16`);
    assert.deepEqual((await tiles(p)).map(t => t.pressed), ['true', 'true']);
    await p.click('.cgtile [data-tpin="cpugroup|lx|CCD 1"]');
    await p.waitFor(`document.querySelector('.cgtile .kn').textContent === 'CCD 1'`);
    assert.deepEqual((await tiles(p)).map(t => [t.name, t.pinned]), [['CCD 1', 'true'], ['CCD 0', 'false']]);
    assert.deepEqual(fx.fleet.tilepins, {'cpugroup|lx': ['CCD 1']});
    const menu = `(() => { const m = document.getElementById('ctxmenu'); return m && !m.hidden ? {title: m.querySelector('.cx-h').textContent, items: [...m.querySelectorAll('[role=menuitem]')].map(e => e.textContent.trim())} : null; })()`;
    await p.eval(`(() => { const e = document.querySelector('.cgtile:nth-child(2) .tsel'), r = e.getBoundingClientRect(); e.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: r.left + 8, clientY: r.top + 8})); return true; })()`);
    assert.deepEqual(await p.eval(menu), {title: 'CCD 0', items: ['See what runs on CCD 0', 'Pin CCD 0']});
    await p.eval(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); return true; })()`);
    // Logical processors shows the same pin and the same pick
    await p.click('[data-cpuview="logical"]');
    await p.waitFor(`document.querySelector('[data-lcpu]')`);
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('.lgroups > div')].map(g => [g.querySelector('[data-lgroup]').textContent, g.querySelector('.lgh [data-tpin]').getAttribute('aria-pressed'), g.querySelector('[data-lgroup]').getAttribute('aria-pressed')])`),
      [['CCD 1', 'true', 'true'], ['CCD 0', 'false', 'true']]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
