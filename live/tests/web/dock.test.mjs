// SPDX-License-Identifier: GPL-3.0-or-later
// #1: the "Drop to dock Details here" zone must never outlive the drag that showed it.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch, sleep} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const ZONE = `!!document.getElementById('dockzone')`;
const state = p => p.eval(`({zone: ${ZONE}, docked: !!S.detailsDocked, panel: !!document.querySelector('.dpanel'), dockbtn: document.querySelector('.dockbtn').getAttribute('aria-pressed')})`);

async function open(over = {}){
  const p = await browser.page(fixture(), {ui: ui(over)});
  await p.waitFor(`document.querySelector('[data-details]') && document.querySelector('#tree .row')`);
  return p;
}

/* A real Chromium drag: CDP intercepts it after dragstart, then replays enter/over/drop like the OS would. */
async function realDrag(p){
  const r = await p.eval(`(() => { const b = document.querySelector('[data-details]').getBoundingClientRect(); return {x: b.left + b.width / 2, y: b.top + b.height / 2}; })()`);
  await p.send('Input.setInterceptDrags', {enabled: true});
  const got = new Promise(ok => { const off = p.on('Input.dragIntercepted', d => { off(); ok(d.data); }); });
  await p.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: r.x, y: r.y});
  await p.send('Input.dispatchMouseEvent', {type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1});
  await p.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: r.x + 30, y: r.y + 40, button: 'left', buttons: 1});
  const data = await Promise.race([got, sleep(4000).then(() => { throw new Error('the drag never started'); })]);
  const at = async (type, x, y = 500) => p.send('Input.dispatchDragEvent', {type, x, y, data});
  const release = async (x, y = 500) => { await p.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1}); await p.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: x - 5, y: y - 5, buttons: 0}); await sleep(80); };
  return {at, release};
}

/* Synthetic drag events, for the fallbacks no real drag can be made to hit on cue. */
async function synth(p){
  await p.eval(`(window.__dt = new DataTransfer(), window.__fire = (type, el, x, y, o = {}) => el.dispatchEvent(new DragEvent(type, Object.assign({bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: __dt}, o))), true)`);
}
// A drag whose pill a poll re-rendered mid-drag, and whose dragend never arrives (dropped outside the
// window, or an engine that doesn't fire it at a detached node).
async function stuck(p){
  await synth(p);
  await p.eval(`(() => { const pill = document.querySelector('[data-details]'); __fire('dragstart', pill, 900, 20); __fire('dragover', document.elementFromPoint(900, 500), 900, 500); renderAll(); return true; })()`);
  assert.equal(await p.eval(`document.querySelector('[data-details]') !== null`), true);
}

test('real drag: dropping Details on the right docks it and leaves no drop zone', async () => {
  const p = await open();
  try {
    const d = await realDrag(p);
    await d.at('dragEnter', 900); await d.at('dragOver', 900);
    assert.equal(await p.eval(ZONE), true, 'the zone shows while dragging');
    await d.at('dragOver', 1300);
    assert.equal(await p.eval(`document.getElementById('dockzone').classList.contains('hot')`), true, 'the zone lights up over the right side');
    await d.at('drop', 1300);
    assert.deepEqual(await state(p), {zone: false, docked: true, panel: true, dockbtn: 'true'}, 'right after the drop');
    await d.release(1300);
    assert.deepEqual(await state(p), {zone: false, docked: true, panel: true, dockbtn: 'true'}, 'after the mouse is released and moves');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('real drag: dropping on the left docks nothing and leaves no drop zone', async () => {
  const p = await open();
  try {
    const d = await realDrag(p);
    await d.at('dragEnter', 400); await d.at('dragOver', 400);
    assert.equal(await p.eval(`document.getElementById('dockzone').classList.contains('hot')`), false, 'the left side is not a dock target');
    await d.at('drop', 400);
    await d.release(400);
    assert.deepEqual(await state(p), {zone: false, docked: false, panel: false, dockbtn: 'false'});
  } finally { await p.close(); }
});

test('real drag: a cancelled drag leaves no drop zone', async () => {
  const p = await open();
  try {
    const d = await realDrag(p);
    await d.at('dragEnter', 1300); await d.at('dragOver', 1300);
    await d.at('dragCancel', 1300);
    await d.release(1300);
    assert.deepEqual(await state(p), {zone: false, docked: false, panel: false, dockbtn: 'false'});
  } finally { await p.close(); }
});

test('a drop on the right removes the zone itself, without waiting for dragend', async () => {
  const p = await open();
  try {
    await synth(p);
    await p.eval(`(() => { const pill = document.querySelector('[data-details]'); __fire('dragstart', pill, 900, 20); const t = document.elementFromPoint(1300, 500); __fire('dragover', t, 1300, 500); __fire('drop', t, 1300, 500); return true; })()`);
    assert.deepEqual(await state(p), {zone: false, docked: true, panel: true, dockbtn: 'true'});
  } finally { await p.close(); }
});

test('a dragend fired at a pill that a poll detached mid-drag still ends the drag', async () => {
  const p = await open();
  try {
    await synth(p);
    await p.eval(`(() => { const pill = document.querySelector('[data-details]'); __fire('dragstart', pill, 900, 20); __fire('dragover', document.elementFromPoint(900, 500), 900, 500); renderAll(); __fire('dragend', pill, 400, 500); return !pill.isConnected; })()`);
    assert.deepEqual(await state(p), {zone: false, docked: false, panel: false, dockbtn: 'false'});
  } finally { await p.close(); }
});

test('fallback: the first mouse move with no button held ends a drag whose dragend was lost', async () => {
  const p = await open();
  try {
    await stuck(p);
    assert.equal(await p.eval(ZONE), true, 'precondition: the zone is stuck');
    await p.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: 700, y: 400, buttons: 0});
    await sleep(50);
    assert.deepEqual(await state(p), {zone: false, docked: false, panel: false, dockbtn: 'false'});
  } finally { await p.close(); }
});

test('fallback: Escape ends it', async () => {
  const p = await open();
  try {
    await stuck(p);
    await p.key('Escape');
    assert.equal(await p.eval(ZONE), false);
  } finally { await p.close(); }
});

test('fallback: the window losing focus ends it', async () => {
  const p = await open();
  try {
    await stuck(p);
    await p.eval(`window.dispatchEvent(new FocusEvent('blur'))`);
    assert.equal(await p.eval(ZONE), false);
  } finally { await p.close(); }
});

test('fallback: the drag leaving the window ends it, and coming back shows it again', async () => {
  const p = await open();
  try {
    await synth(p);
    await p.eval(`(() => { const pill = document.querySelector('[data-details]'); __fire('dragstart', pill, 900, 20); __fire('dragover', document.elementFromPoint(900, 500), 900, 500); __fire('dragleave', document.documentElement, 0, 0, {relatedTarget: null}); return true; })()`);
    assert.equal(await p.eval(ZONE), false, 'gone once the drag is outside the window');
    await p.eval(`(() => { const t = document.elementFromPoint(1300, 500); __fire('dragenter', t, 1300, 500); __fire('dragover', t, 1300, 500); return true; })()`);
    assert.equal(await p.eval(ZONE), true, 'back when the same drag returns');
    await p.eval(`__fire('drop', document.elementFromPoint(1300, 500), 1300, 500)`);
    assert.deepEqual(await state(p), {zone: false, docked: true, panel: true, dockbtn: 'true'});
  } finally { await p.close(); }
});

test('control: nothing ends a drag that is still going', async () => {
  const p = await open();
  try {
    await synth(p);
    await p.eval(`(() => { const pill = document.querySelector('[data-details]'); __fire('dragstart', pill, 900, 20); __fire('dragover', document.elementFromPoint(900, 500), 900, 500); return true; })()`);
    await p.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: 910, y: 505, button: 'left', buttons: 1});
    assert.equal(await p.eval(ZONE), true, 'a move with the button held');
    await p.eval(`__fire('dragleave', document.elementFromPoint(900, 500), 905, 500, {relatedTarget: document.querySelector('#main')})`);
    assert.equal(await p.eval(ZONE), true, 'leaving one element for another inside the window');
    await p.eval(`__fire('dragover', document.elementFromPoint(1300, 500), 1300, 500)`);
    assert.equal(await p.eval(`document.getElementById('dockzone').classList.contains('hot')`), true, 'still a live drag');
  } finally { await p.close(); }
});

test('control: a plain click on the pill still opens the full Details view, with no zone', async () => {
  const p = await open();
  try {
    await p.click('[data-details]');
    assert.deepEqual(await p.eval(`({zone: ${ZONE}, view: S.view, docked: !!S.detailsDocked})`), {zone: false, view: 'details', docked: false});
  } finally { await p.close(); }
});
