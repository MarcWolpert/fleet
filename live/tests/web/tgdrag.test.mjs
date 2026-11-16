// SPDX-License-Identifier: GPL-3.0-or-later
// Moving tree items between custom groups by a drag handle (issue #22), or from the right-click menu.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const ROW = id => `document.querySelector('#tree .row[data-select="${id}"]')`;
const GROUPS = `[...document.querySelectorAll('#tree .tgroup')].map(g => ({name: g.querySelector('.tg-h').textContent.trim(), rows: [...g.querySelectorAll('.row')].map(r => r.dataset.select || r.dataset.netsel)}))`;
// drag a row's handle and drop it on an element (or on the tree's empty space)
const dnd = (p, id, target) => p.eval(`(() => { const h = ${ROW(id)}.querySelector('.tdrag'), t = ${target}; const dt = new DataTransfer(); const r = t.getBoundingClientRect(); const o = {bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 30, clientY: r.top + Math.min(8, r.height / 2)}; h.dispatchEvent(new DragEvent('dragstart', o)); t.dispatchEvent(new DragEvent('dragenter', o)); t.dispatchEvent(new DragEvent('dragover', o)); t.dispatchEvent(new DragEvent('drop', o)); h.dispatchEvent(new DragEvent('dragend', o)); return true; })()`);
const CLOSED = {lx: false, lx2: false, mac: false, win: false};
function fx2(){ const fx = fixture(); fx.fleet.prefs = {tgroups: {'machines|root': [{id: 'g1', name: 'Linux', c: 0, ids: ['lx', 'lx2']}, {id: 'g2', name: 'Desktops', c: 1, ids: ['mac']}]}}; return fx; }
async function open(fx, over = {}){
  const p = await browser.page(fx, {ui: ui(Object.assign({sel: 'fleet', open: CLOSED}, over)), height: 900});
  await p.waitFor(`document.querySelectorAll('#tree .tgroup').length > 0`);
  return p;
}

test('every row has a drag handle; dropping on a group moves the item into it', async () => {
  const fx = fx2();
  const p = await open(fx);
  try {
    assert.equal(await p.eval(`[...document.querySelectorAll('#tree .row')].every(r => r.querySelector('.tdrag[draggable="true"]'))`), true);
    await dnd(p, 'win', `document.querySelector('.tgroup[data-tgroup="g2"]')`);
    await p.waitFor(`${GROUPS}.find(g => g.name === 'Desktops').rows.length === 2`);
    assert.deepEqual(await p.eval(GROUPS), [{name: 'Linux', rows: ['lx', 'lx2']}, {name: 'Desktops', rows: ['mac', 'win']}]);
    await dnd(p, 'lx2', `document.querySelector('.tgroup[data-tgroup="g2"] .row[data-select="mac"]')`);   // onto a member: into its group
    await p.waitFor(`${GROUPS}.find(g => g.name === 'Desktops').rows.length === 3`);
    assert.deepEqual(await p.eval(GROUPS), [{name: 'Linux', rows: ['lx']}, {name: 'Desktops', rows: ['lx2', 'mac', 'win']}]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('dropping on empty space takes it out of its group; on an ungrouped sibling, the two make a new group', async () => {
  const fx = fixture(); fx.fleet.prefs = {tgroups: {'machines|root': [{id: 'g1', name: 'Linux', c: 0, ids: ['lx', 'lx2']}]}};
  const p = await open(fx);
  try {
    await dnd(p, 'lx2', `document.getElementById('tree')`);
    await p.waitFor(`${GROUPS}[0].rows.length === 1`);
    assert.deepEqual(await p.eval(GROUPS), [{name: 'Linux', rows: ['lx']}]);
    await dnd(p, 'win', ROW('mac'));
    await p.waitFor(`${GROUPS}.length === 2`);
    assert.deepEqual(await p.eval(GROUPS), [{name: 'Linux', rows: ['lx']}, {name: 'Group 1', rows: ['mac', 'win']}]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('an item can only move among its siblings', async () => {
  const fx = fx2();
  const p = await open(fx, {open: Object.assign({}, CLOSED, {lx: true})});
  try {
    await dnd(p, 'lx/base', `document.querySelector('.tgroup[data-tgroup="g2"]')`);
    await p.waitFor(`(document.getElementById('toast') || {}).textContent`);
    assert.match(await p.eval(`document.getElementById('toast').textContent`), /same level/);
    assert.deepEqual(await p.eval(GROUPS), [{name: 'Linux', rows: ['lx', 'lx/base', 'lx/containers', 'lx2']}, {name: 'Desktops', rows: ['mac']}]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the right-click menu moves it too', async () => {
  const fx = fx2();
  const p = await open(fx);
  const menu = id => p.eval(`(() => { const r = ${ROW(id)}.getBoundingClientRect(); ${ROW(id)}.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: r.left + 60, clientY: r.top + 5})); return [...document.querySelectorAll('#ctxmenu [role=menuitem]')].map(e => e.textContent.trim()); })()`);
  const pick = label => p.eval(`(() => { [...document.querySelectorAll('#ctxmenu [role=menuitem]')].find(e => e.textContent.trim() === ${JSON.stringify(label)}).click(); return true; })()`);
  try {
    const items = await menu('lx2');
    assert.deepEqual(items.filter(x => /^(Move to|Remove from)/.test(x)), ['Move to Desktops', 'Remove from Linux']);
    await pick('Move to Desktops');
    await p.waitFor(`${GROUPS}.find(g => g.name === 'Desktops').rows.length === 2`);
    assert.deepEqual((await menu('win')).filter(x => /^(Move to|Remove from)/.test(x)), ['Move to Linux', 'Move to Desktops']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
