// SPDX-License-Identifier: GPL-3.0-or-later
// The docked Details panel: resizing it by its left edge (#150).
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch, sleep} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const W = 1500;  // the window's width; a drag to x makes the panel W - x - 8 px wide
async function open(over = {}, fx = fixture()){
  const p = await browser.page(fx, {ui: ui(Object.assign({sel: 'lx', detailsDocked: true}, over)), width: W});
  await p.waitFor(`document.querySelectorAll('.dpanel .ptbl tbody tr[data-pid]').length === 12`);
  return p;
}
const WIDTH = `(() => { const d = document.querySelector('.dpanel'); let saved = null; try { saved = JSON.parse(localStorage.getItem('fleet-live-ui')).dockW; } catch (e) {} return {panel: d && d.style.width, dockW: S.dockW == null ? null : S.dockW, saved: saved == null ? null : saved}; })()`;
// A poll, as the timer runs it (after any poll already in flight).
const POLL = `(async () => { while (busy) await new Promise(r => setTimeout(r, 20)); await refreshNow(); return true; })()`;
const CPU101 = `document.querySelector('.dpanel tr[data-pid="101"]').textContent`;

/* A real mouse drag on the resize handle, through CDP, so pointer capture behaves as it does for a person. */
async function grab(p){
  const r = await p.eval(`(() => { const b = document.querySelector('.dpanel [data-resize]').getBoundingClientRect(); return {x: b.left + b.width / 2, y: b.top + 200}; })()`);
  const mouse = (type, x, buttons = 1) => p.send('Input.dispatchMouseEvent', Object.assign({type, x, y: r.y, buttons, button: buttons || type !== 'mouseMoved' ? 'left' : 'none'}, type === 'mouseMoved' ? {} : {clickCount: 1}));
  await mouse('mouseMoved', r.x, 0);
  await mouse('mousePressed', r.x);
  return {
    to: async x => { await mouse('mouseMoved', x); await sleep(30); },
    release: async x => { await mouse('mouseReleased', x, 0); await sleep(30); }
  };
}

test('a poll landing mid-drag does not cut the resize short: the panel follows the mouse and the width is saved (regression)', async () => {
  const fx = fixture();
  const p = await open({}, fx);
  try {
    assert.deepEqual(await p.eval(WIDTH), {panel: '560px', dockW: null, saved: null}, 'precondition: the default width');
    const d = await grab(p);
    await d.to(900);
    assert.deepEqual(await p.eval(WIDTH), {panel: '592px', dockW: 592, saved: null}, 'the first move');
    fx.procs.lx.procs[0][4] = 0.42;                        // the poll brings a new reading
    await p.eval(POLL);
    await d.to(800);
    assert.deepEqual(await p.eval(WIDTH), {panel: '692px', dockW: 692, saved: null}, 'a move after the poll still resizes');
    await d.to(700);
    await d.release(700);
    assert.deepEqual(await p.eval(WIDTH), {panel: '792px', dockW: 792, saved: 792}, 'released: the width is kept and saved');
    assert.ok((await p.eval(CPU101)).includes('2.6%'), 'and the reading the poll brought is on screen');
    await p.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: 1100, y: 400, buttons: 0}); await sleep(30);
    assert.deepEqual(await p.eval(WIDTH), {panel: '792px', dockW: 792, saved: 792}, 'a later move with no button held resizes nothing');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a cancelled resize ends it: the width so far is saved and polls show up again', async () => {
  const fx = fixture();
  const p = await open({}, fx);
  try {
    const d = await grab(p);
    await d.to(850);
    await p.eval(`(document.querySelector('.dpanel [data-resize]').dispatchEvent(new PointerEvent('pointercancel', {bubbles: true, pointerId: 1})), true)`);
    assert.deepEqual(await p.eval(WIDTH), {panel: '642px', dockW: 642, saved: 642});
    await d.release(850);
    fx.procs.lx.procs[0][4] = 0.42;
    await p.eval(POLL);
    assert.ok((await p.eval(CPU101)).includes('2.6%'), 'a poll after the cancel renders');
    assert.deepEqual(await p.eval(WIDTH), {panel: '642px', dockW: 642, saved: 642});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('control: a drag past either end stops at the panel\'s least and greatest width', async () => {
  const p = await open();
  try {
    const d = await grab(p);
    await d.to(1400);
    assert.deepEqual(await p.eval(WIDTH), {panel: '360px', dockW: 360, saved: null}, 'narrowest');
    await d.to(100);
    await d.release(100);
    assert.deepEqual(await p.eval(WIDTH), {panel: `${W - 520}px`, dockW: W - 520, saved: W - 520}, 'widest');
  } finally { await p.close(); }
});
