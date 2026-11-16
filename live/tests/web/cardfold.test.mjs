// SPDX-License-Identifier: GPL-3.0-or-later
// Every card on a page folds to its title line and unfolds again (#353): from a chevron in its header, a click on
// the header's empty area, or the keyboard. Kept per kind of card (not per page) in ui.json, through polls and restarts.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch, heldPoll} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

// Each card on the page, top to bottom: its kind, title, its chevron [kind, aria-expanded, name], and whether
// anything below its header shows.
const CARDS = `[...document.querySelectorAll('#main section.card')].map(c => {
  const b = c.querySelector(':scope > .card-h > [data-cardfold]'), shows = e => e.getClientRects().length > 0;
  return {kind: c.dataset.card || null, title: c.querySelector('.card-h h2').textContent,
    fold: b ? [b.dataset.cardfold, b.getAttribute('aria-expanded'), b.getAttribute('aria-label')] : null,
    body: [...c.children].filter(e => !e.matches('.card-h')).some(shows)};
})`;
const cards = p => p.eval(CARDS);
const open1 = (kind, title) => ({kind, title, fold: [kind, 'true', 'Fold ' + title], body: true});
const shut1 = (kind, title) => ({kind, title, fold: [kind, 'false', 'Unfold ' + title], body: false});
const LX = [['where', 'Where this machine’s usage goes'], ['graph', 'CPU'], ['gpus', 'GPUs: what runs on which'], ['inside', 'Inside lab-linux']];
const saved = fx => (fx.posts || []).filter(w => w.path === '/api/prefs').map(w => JSON.parse(w.body).foldedCards);
const shows = (p, sel) => p.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.getClientRects().length > 0; })()`);
// a poll that redraws the page: new numbers, so the main pane is rebuilt (each card is a new element)
async function redraw(p, fx, mark){
  await p.eval(`(document.querySelector(${JSON.stringify(mark)}).__old = 1, true)`);
  fx.fleet.machines.forEach(m => { m.uptime = String(Number.parseInt(m.uptime) + 1) + ' days'; });
  await p.eval(`(refreshNow(), true)`);
  await p.waitFor(`!document.querySelector(${JSON.stringify(mark)}).__old`);
}
async function open(fx, over = {}){
  const p = await browser.page(fx, {ui: ui(Object.assign({sel: 'lx', metric: 'cpu', cpuView: 'type'}, over))});
  try { await p.waitFor(`document.querySelectorAll('#main section.card').length >= 4`); } catch (e) { await p.close(); throw e; }
  return p;
}

test('every card on a machine\'s page and on All machines has a chevron that names it and says it\'s open', async () => {
  const fx = fixture(), p = await open(fx);
  try {
    assert.deepEqual(await cards(p), LX.map(([k, t]) => open1(k, t)));
    await p.click('#metrics [data-metric="gpu"]');   // the chart is Each GPU's here
    await p.waitFor(`document.querySelector('[data-cardfold="graph"]')`);
    await p.eval(`(document.querySelector('[data-gpuview="each"]').click(), true)`);
    await p.waitFor(`document.querySelector('[data-cardfold="eachgpu"]')`);
    assert.deepEqual(await cards(p), [open1('where', 'Where this machine’s usage goes'), open1('eachgpu', 'Each GPU'), open1('gpus', 'GPUs: what runs on which'), open1('inside', 'Inside lab-linux')]);
    await p.eval(`(goSpace('fleet'), true)`);
    await p.waitFor(`document.querySelector('#main .hero h1').textContent === 'All machines'`);
    assert.deepEqual(await cards(p), [open1('where', 'Where your fleet’s usage goes'), open1('graph', 'Fleet GPU'), open1('bymachine', 'By machine · GPU')]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the chevron folds a card to its title line and unfolds it; only that card, saved in ui.json', async () => {
  const fx = fixture(), p = await open(fx);
  try {
    await p.click('[data-cardfold="where"]');
    await p.waitFor(`document.querySelector('[data-card="where"]').classList.contains('folded')`);
    assert.deepEqual(await cards(p), [shut1(...LX[0]), ...LX.slice(1).map(([k, t]) => open1(k, t))]);
    await p.waitFor(`!prefsBusy`);
    assert.deepEqual(saved(fx), [['where']]);
    // just its title line: no taller than its header, and its neighbour in the row keeps its own height
    assert.equal(await p.eval(`(() => { const c = document.querySelector('[data-card="where"]'), h = c.querySelector('.card-h'); return c.getBoundingClientRect().height - h.getBoundingClientRect().height < 40; })()`), true);
    assert.equal(await p.eval(`document.querySelector('[data-card="where"]').getBoundingClientRect().height < document.querySelector('[data-card="graph"]').getBoundingClientRect().height / 2`), true);
    // a folded card's "of capacity / of what's in use" goes with its bars; its title and chevron stay
    assert.deepEqual([await shows(p, '[data-card="where"] [data-mode="cap"]'), await shows(p, '[data-card="where"] h2'), await shows(p, '[data-cardfold="where"]')], [false, true, true]);
    await p.click('[data-cardfold="where"]');
    await p.waitFor(`!document.querySelector('[data-card="where"]').classList.contains('folded')`);
    assert.deepEqual(await cards(p), LX.map(([k, t]) => open1(k, t)));
    assert.equal(await shows(p, '[data-card="where"] [data-mode="cap"]'), true);
    await p.waitFor(`!prefsBusy`);
    assert.deepEqual(saved(fx), [['where'], []]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a folded chart keeps its By type / Logical processors toggle, and the other view is a card of its own kind', async () => {
  const fx = fixture(), p = await open(fx);
  try {
    await p.click('[data-cardfold="graph"]');
    await p.waitFor(`document.querySelector('[data-card="graph"]').classList.contains('folded')`);
    assert.deepEqual([await shows(p, '[data-card="graph"] [data-cpuview="type"]'), await shows(p, '[data-card="graph"] [data-cpuview="logical"]'), await shows(p, '[data-card="graph"] .graph')], [true, true, false]);
    await p.click('[data-card="graph"] [data-cpuview="logical"]');
    await p.waitFor(`document.querySelector('[data-lcpu]')`);
    assert.deepEqual(await cards(p), [open1(...LX[0]), open1('logical', 'Logical processors'), open1(...LX[2]), open1(...LX[3])]);
    await p.click('[data-cpuview="type"]');
    await p.waitFor(`document.querySelector('[data-card="graph"]')`);
    assert.deepEqual(await cards(p), [open1(...LX[0]), shut1(...LX[1]), open1(...LX[2]), open1(...LX[3])]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('kept per kind of card, not per machine: another machine and All machines fold the same kind', async () => {
  const fx = fixture(), p = await open(fx);
  try {
    await p.click('[data-cardfold="inside"]');
    await p.click('[data-cardfold="where"]');
    await p.waitFor(`document.querySelectorAll('#main section.card.folded').length === 2`);
    await p.click('#tree [data-select="mac"].nm');
    await p.waitFor(`document.querySelector('#main .hero h1').firstChild.textContent.trim() === 'lab-mac'`);
    assert.deepEqual(await cards(p), [shut1('where', 'Where this machine’s usage goes'), open1('graph', 'CPU'), open1('gpus', 'GPU: what runs on it'), shut1('inside', 'Inside lab-mac')]);
    await p.eval(`(goSpace('fleet'), true)`);
    await p.waitFor(`document.querySelector('#main .hero h1').textContent === 'All machines'`);
    assert.deepEqual(await cards(p), [shut1('where', 'Where your fleet’s usage goes'), open1('graph', 'Fleet CPU'), open1('bymachine', 'By machine · CPU')]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('polls never unfold a card, and the chevron keeps keyboard focus through the redraw', async () => {
  const fx = fixture(), p = await open(fx);
  try {
    await p.click('[data-cardfold="gpus"]');
    await p.waitFor(`document.querySelector('[data-card="gpus"]').classList.contains('folded')`);
    await p.eval(`(document.querySelector('[data-cardfold="gpus"]').focus(), true)`);
    for (let i = 0; i < 2; i++){
      await redraw(p, fx, '[data-card="gpus"]');
      assert.deepEqual(await cards(p), [open1(...LX[0]), open1(...LX[1]), shut1(...LX[2]), open1(...LX[3])], 'poll ' + i);
      assert.equal(await p.eval(`document.activeElement.matches('[data-cardfold="gpus"]')`), true, 'focus, poll ' + i);
    }
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a poll the server answered before the fold was saved doesn\'t unfold it', async () => {
  const fx = fixture(), p = await open(fx);
  try {
    fx.holdFleet = true;
    const stale = await heldPoll(p, fx);   // made before the fold
    await p.click('[data-cardfold="where"]');
    await p.waitFor(`!prefsBusy && document.querySelector('[data-card="where"]').classList.contains('folded')`);
    assert.deepEqual(fx.fleet.prefs, {foldedCards: ['where']});
    stale();
    await heldPoll(p, fx);   // the page polls again, so the stale answer has been read and drawn
    assert.deepEqual((await cards(p))[0], shut1(...LX[0]));
    // and the next fold builds on this one
    await p.click('[data-cardfold="inside"]');
    await p.waitFor(`!prefsBusy && document.querySelector('[data-card="inside"]').classList.contains('folded')`);
    assert.deepEqual(fx.fleet.prefs, {foldedCards: ['where', 'inside']});
    assert.deepEqual(p.errors, []);
  } finally { fx.holdFleet = false; (fx.held || []).splice(0).forEach(send => send()); await p.close(); }
});

test('kept through a reload and a restart (ui.json), and the rest of ui.json is left as it was', async () => {
  const fx = fixture(); fx.fleet.prefs = {theme: 'nord', foldedCards: ['inside', 'bymachine']};
  const p = await open(fx);
  try {
    assert.deepEqual(await cards(p), [open1(...LX[0]), open1(...LX[1]), open1(...LX[2]), shut1(...LX[3])]);
    await p.click('[data-cardfold="graph"]');
    await p.waitFor(`!prefsBusy && document.querySelector('[data-card="graph"]').classList.contains('folded')`);
    assert.deepEqual(fx.fleet.prefs, {theme: 'nord', foldedCards: ['inside', 'bymachine', 'graph']});
    await p.reload();
    await p.waitFor(`document.querySelectorAll('#main section.card').length >= 4`);
    assert.deepEqual(await cards(p), [open1(...LX[0]), shut1(...LX[1]), open1(...LX[2]), shut1(...LX[3])]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
  // a restart: a new page with nothing kept in the browser, only what the server has
  const q = await browser.page(fx, {ui: ui({sel: 'fleet', metric: 'cpu'})});
  try {
    await q.waitFor(`document.querySelectorAll('#main section.card').length === 3`);
    assert.deepEqual(await cards(q), [open1('where', 'Where your fleet’s usage goes'), shut1('graph', 'Fleet CPU'), shut1('bymachine', 'By machine · CPU')]);
    assert.deepEqual(q.errors, []);
  } finally { await q.close(); }
});

test('Enter and Space on the chevron fold and unfold it, and focus stays on it', async () => {
  const fx = fixture(), p = await open(fx);
  try {
    await p.eval(`(document.querySelector('[data-cardfold="inside"]').focus(), true)`);
    await p.key('Enter');
    await p.waitFor(`document.querySelector('[data-card="inside"]').classList.contains('folded')`);
    assert.deepEqual((await cards(p))[3], shut1(...LX[3]));
    assert.equal(await p.eval(`document.activeElement.matches('[data-cardfold="inside"]')`), true);
    await p.key(' ', 'Space');
    await p.waitFor(`!document.querySelector('[data-card="inside"]').classList.contains('folded')`);
    assert.deepEqual((await cards(p))[3], open1(...LX[3]));
    assert.equal(await p.eval(`document.activeElement.matches('[data-cardfold="inside"]')`), true);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a click on the header\'s empty area or its title folds and unfolds; a click on a control in it doesn\'t', async () => {
  const fx = fixture(), p = await open(fx);
  try {
    await p.click('[data-card="where"] .card-h .grow');
    await p.waitFor(`document.querySelector('[data-card="where"]').classList.contains('folded')`);
    await p.click('[data-card="where"] .card-h h2');
    await p.waitFor(`!document.querySelector('[data-card="where"]').classList.contains('folded')`);
    await p.click('[data-card="where"] [data-mode="used"]');
    await p.waitFor(`S.mode === 'used'`);
    await p.click('[data-card="graph"] [data-cpuview="type"]');
    assert.deepEqual(await cards(p), LX.map(([k, t]) => open1(k, t)));
    await p.waitFor(`!prefsBusy`);
    assert.deepEqual(saved(fx), [['where'], []]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
