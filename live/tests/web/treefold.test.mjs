// SPDX-License-Identifier: GPL-3.0-or-later
// Folding the whole tree (#333): a row of its own at the bottom of the tree, right above Auto and Add a machine, with two
// toggles. ~ collapses everything and pushes what was open on a stack; pressed again it pops that back. F~ (force)
// opens every node at every depth, or closes every one when all are open. Each tree has its own stack; it's kept.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const OPEN = `[...document.querySelectorAll('#tree [data-toggle]')].filter(b => b.classList.contains('open')).map(b => b.dataset.toggle).sort()`;
const SHUT = `[...document.querySelectorAll('#tree [data-toggle]')].filter(b => !b.classList.contains('open')).map(b => b.dataset.toggle)`;
const press = (p, k) => p.eval(`(document.querySelector('#treefold [data-fold="${k}"]').click(), true)`);

test('~ collapses everything and comes back to just what was open; F~ opens every node at every depth, then closes them', async () => {
  const fx = fixture();
  const p = await browser.page(fx, {ui: ui({sel: 'fleet', open: {lx: true, 'lx/containers': true, mac: true}})});
  try {
    await p.waitFor(`document.querySelector('#treefold [data-fold="~"]')`);
    const pos = await p.eval(`(() => { const r = document.getElementById('treefold').getBoundingClientRect(), f = document.querySelector('.side-foot').getBoundingClientRect(), t = document.getElementById('tree').getBoundingClientRect(); return {above: Math.abs(r.bottom - f.top) < 1.5, below: r.top >= t.bottom - 1.5}; })()`);
    assert.deepEqual(pos, {above: true, below: true}, 'its own row, right above Auto and Add a machine');
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#treefold [data-fold]')].map(b => b.textContent.trim())`), ['~', 'F~']);
    const before = await p.eval(OPEN);
    assert.ok(before.includes('lx/containers'));
    await press(p, '~');
    await p.waitFor(`(${OPEN}).length === 0`);
    assert.equal(await p.eval(`document.querySelector('#treefold [data-fold="~"]').getAttribute('aria-pressed')`), 'true');
    assert.match(await p.eval(`document.querySelector('#treefold [data-fold="~"]').getAttribute('aria-label')`), /back/i);
    // kept through a reload
    await p.eval(`(location.reload(), true)`);
    await p.waitFor(`document.querySelector('#treefold [data-fold="~"]') && document.querySelectorAll('#tree [data-toggle]').length > 3`);
    assert.deepEqual(await p.eval(OPEN), []);
    await press(p, '~');
    await p.waitFor(`JSON.stringify(${OPEN}) === ${JSON.stringify(JSON.stringify(before))}`);
    assert.equal(await p.eval(`document.querySelector('#treefold [data-fold="~"]').getAttribute('aria-pressed')`), 'false');
    // force: every node at every depth, then none
    await press(p, 'F~');
    await p.waitFor(`(${SHUT}).length === 0 && (${OPEN}).length > ${before.length}`);
    assert.equal(await p.eval(`foldNodes().every(foldIsOpen)`), true, 'every node with children, drawn or not');
    await press(p, 'F~');
    await p.waitFor(`(${OPEN}).length === 0`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('~ is a toggle: opening rows by hand after it doesn\'t lose the way back; F~ leaves the saved state alone', async () => {
  const fx = fixture();
  const p = await browser.page(fx, {ui: ui({sel: 'fleet', open: {lx: true}})});
  try {
    await p.waitFor(`document.querySelector('#treefold [data-fold="~"]')`);
    const first = await p.eval(OPEN);
    await press(p, '~');
    await p.waitFor(`(${OPEN}).length === 0`);
    await p.eval(`(document.querySelector('#tree [data-toggle="mac"]').click(), true)`);   // you open one by hand
    await p.waitFor(`(${OPEN}).includes('mac')`);
    await press(p, 'F~');   // force doesn't touch what ~ keeps
    await p.waitFor(`(${SHUT}).length === 0`);
    assert.equal(await p.eval(`S.foldStack.machines.length`), 1);
    await press(p, '~');   // back to what was open before ~
    await p.waitFor(`JSON.stringify(${OPEN}) === ${JSON.stringify(JSON.stringify(first))}`);
    assert.equal(await p.eval(`S.foldStack.machines.length`), 0);
    await press(p, '~');   // and it collapses again
    await p.waitFor(`(${OPEN}).length === 0`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the network tree folds with its own stack, and groups fold with the rest', async () => {
  const fx = fixture();
  fx.fleet.prefs = Object.assign({}, fx.fleet.prefs, {tgroups: {'machines|root': [{id: 'g1', name: 'Lab', kind: 'fleet', ids: ['lx', 'lx2']}]}});
  const p = await browser.page(fx, {ui: ui({sel: 'fleet', open: {lx: true}})});
  try {
    await p.waitFor(`document.querySelector('#tree .tgroup')`);
    await press(p, 'F~');
    await p.waitFor(`(${SHUT}).length === 0`);
    assert.equal(await p.eval(`document.querySelector('[data-tgfold="g1"]').getAttribute('aria-expanded')`), 'true');
    await press(p, '~');
    await p.waitFor(`(${OPEN}).length === 0 && document.querySelector('[data-tgfold="g1"]').getAttribute('aria-expanded') === 'false'`);
    await p.eval(`(document.querySelector('[data-tree="network"]').click(), true)`);
    await p.waitFor(`S.tree === 'network' && document.querySelectorAll('#tree .row').length`);
    assert.equal(await p.eval(`document.querySelector('#treefold [data-fold="~"]').getAttribute('aria-pressed')`), 'false', 'its own stack');
    await press(p, '~');
    await p.waitFor(`(${OPEN}).length === 0`);
    assert.equal(await p.eval(`S.foldStack.network.length`), 1);
    assert.equal(await p.eval(`S.foldStack.machines.length`), 1);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

// #394: a toggle for the tree's graphs, at the right of the ~ / F~ row; kept.
test('the graphs toggle hides and shows the tree’s graphs, and is kept', async () => {
  const p = await browser.page(fixture(), {ui: ui({sel: 'fleet', open: {lx: true}})});
  const SHOWN = `[...document.querySelectorAll('#tree .spark')].filter(e => getComputedStyle(e).display !== 'none').length`;
  try {
    await p.waitFor(`document.querySelector('#treefold [data-sparks]')`);
    const r = await p.eval(`(() => { const t = document.getElementById('treefold').getBoundingClientRect(), b = document.querySelector('#treefold [data-sparks]').getBoundingClientRect(), f = document.querySelector('#treefold [data-fold="F~"]').getBoundingClientRect(); return {right: t.right - b.right, after: b.left > f.right}; })()`);
    assert.ok(r.after && r.right < 20, 'at the right of the row: ' + JSON.stringify(r));
    assert.equal(await p.eval(`document.querySelector('#treefold [data-sparks]').getAttribute('aria-pressed')`), 'true');
    assert.ok(await p.eval(SHOWN) > 3);
    await p.eval(`(document.querySelector('#treefold [data-sparks]').click(), true)`);
    await p.waitFor(`${SHOWN} === 0`);
    assert.equal(await p.eval(`document.querySelector('#treefold [data-sparks]').getAttribute('aria-pressed')`), 'false');
    await p.eval(`(location.reload(), true)`);
    await p.waitFor(`document.querySelector('#tree .spark') && document.querySelector('#treefold [data-sparks]')`);
    assert.equal(await p.eval(SHOWN), 0, 'kept');
    await p.eval(`(document.querySelector('#treefold [data-sparks]').click(), true)`);
    await p.waitFor(`${SHOWN} > 3`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
