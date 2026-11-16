// SPDX-License-Identifier: GPL-3.0-or-later
// The docked Details panel: resizing it by its left edge (#150); docking, popping out and closing it from its
// buttons, what it shows with All machines selected, and a later poll's processes in it (#162).
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch, sleep} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const W = 1500;  // the window's width; a drag to x makes the panel W - x - 8 px wide
const PANEL12 = `document.querySelectorAll('.dpanel .ptbl tbody tr[data-pid]').length === 12`;
async function open(over = {}, fx = fixture(), ready = PANEL12){
  const p = await browser.page(fx, {ui: ui(Object.assign({sel: 'lx', detailsDocked: true}, over)), width: W});
  await p.waitFor(ready);
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

/* ---------- docking, popping out and closing from the buttons (#162) ---------- */
// All a dock button changes: the view, whether Details is docked, the panel or the full Details view (each by
// its title), the processes listed in either, both toolbar buttons' aria-pressed and what the panel button does next,
// and what's saved.
const STATE = `(() => {
  const d = document.querySelector('.dpanel'), h1 = document.querySelector('#main > .wrap .hero h1'), b = document.querySelector('.dockbtn');
  const full = h1 && /^Details/.test(h1.textContent) ? document.querySelector('#main > .wrap') : null;
  let s = {}; try { s = JSON.parse(localStorage.getItem('fleet-live-ui')) || {}; } catch (e) {}
  return {view: S.view, docked: !!S.detailsDocked, panel: d ? d.querySelector('.dtitle b').textContent : null, full: full ? h1.textContent : null,
    procs: (d || full) ? (d || full).querySelectorAll('.ptbl tbody tr[data-pid]').length : 0,
    pill: document.querySelector('[data-details]').getAttribute('aria-pressed'), dockbtn: b.getAttribute('aria-pressed'), next: b.hasAttribute('data-closedock') ? 'close' : 'dock',
    saved: {view: s.view, docked: !!s.detailsDocked}};
})()`;
const OVERVIEW = {view: 'overview', docked: false, panel: null, full: null, procs: 0, pill: 'false', dockbtn: 'false', next: 'dock', saved: {view: 'overview', docked: false}};
const DOCKED = {view: 'overview', docked: true, panel: 'Details · lab-linux', full: null, procs: 12, pill: 'true', dockbtn: 'true', next: 'close', saved: {view: 'overview', docked: true}};
const FULL = {view: 'details', docked: false, panel: null, full: 'Details · lab-linux', procs: 12, pill: 'true', dockbtn: 'false', next: 'dock', saved: {view: 'details', docked: false}};
const OVERVIEW_READY = `document.querySelector('.dockbtn') && document.querySelector('#main > .wrap .hero')`;
const FULL_READY = `document.querySelectorAll('#main > .wrap .ptbl tbody tr[data-pid]').length === 12`;

test('the toolbar panel button docks Details beside the overview, and pressed again closes it', async () => {
  const p = await open({detailsDocked: false}, fixture(), OVERVIEW_READY);
  try {
    assert.deepEqual(await p.eval(STATE), OVERVIEW, 'precondition');
    await p.click('.dockbtn');
    await p.waitFor(PANEL12);
    assert.deepEqual(await p.eval(STATE), DOCKED, 'docked');
    await p.click('.dockbtn');
    assert.deepEqual(await p.eval(STATE), OVERVIEW, 'closed');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

for (const [name, button] of [['"Dock to the right"', '#main .hero [data-dock]'], ['the toolbar panel button', '.dockbtn']])
  test(`in the full Details view, ${name} docks Details beside the overview`, async () => {
    const p = await open({detailsDocked: false, view: 'details'}, fixture(), FULL_READY);
    try {
      assert.deepEqual(await p.eval(STATE), FULL, 'precondition');
      await p.click(button);
      await p.waitFor(PANEL12);
      assert.deepEqual(await p.eval(STATE), DOCKED);
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  });

test('Pop out in the panel header opens the full Details view and leaves nothing docked', async () => {
  const p = await open();
  try {
    assert.deepEqual(await p.eval(STATE), DOCKED, 'precondition');
    await p.click('.dpanel [data-undock]');
    assert.deepEqual(await p.eval(STATE), FULL);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Close in the panel header takes the panel off screen and leaves the overview', async () => {
  const p = await open();
  try {
    await p.click('.dpanel .dhead [data-closedock]');
    assert.deepEqual(await p.eval(STATE), OVERVIEW);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('with All machines selected the panel asks for a machine and lists nothing; picking one fills it, Close closes it', async () => {
  const p = await open({sel: 'fleet'}, fixture(), `document.querySelector('.dpanel .dtitle')`);
  const PLACE = `(() => { const d = document.querySelector('.dpanel'); return {title: d.querySelector('.dtitle b').textContent, says: d.querySelector('.dtitle span').textContent, procs: d.querySelectorAll('tr[data-pid]').length, buttons: [...d.querySelectorAll('.dhead button')].map(b => b.getAttribute('aria-label'))}; })()`;
  const ASKS = {title: 'Details', says: 'Select a machine or anything in it to see its processes.', procs: 0, buttons: ['Close the Details panel']};
  try {
    assert.deepEqual(await p.eval(PLACE), ASKS);
    await p.eval(POLL);
    assert.deepEqual(await p.eval(PLACE), ASKS, 'a poll lists nothing in it either');
    await p.eval(`(() => { [...document.querySelectorAll('#tree .row .nm')].find(e => e.textContent === 'lab-linux').click(); return true; })()`);
    await p.waitFor(PANEL12);
    assert.deepEqual(await p.eval(PLACE), {title: 'Details · lab-linux', says: '12 processes on lab-linux', procs: 12, buttons: ['Pop out Details', 'Close the Details panel']});
    await p.click('[data-space="fleet"]');
    assert.deepEqual(await p.eval(PLACE), ASKS, 'back to All machines');
    await p.click('.dpanel [data-closedock]');
    assert.deepEqual(await p.eval(`({docked: !!S.detailsDocked, panel: !!document.querySelector('.dpanel'), dockbtn: document.querySelector('.dockbtn').getAttribute('aria-pressed')})`), {docked: false, panel: false, dockbtn: 'false'});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a later poll brings the new /api/procs reading into the docked panel: changed, new and gone processes', async () => {
  const fx = fixture();
  const p = await open({}, fx);
  const ROWS = `[...document.querySelectorAll('.dpanel .ptbl tbody tr[data-pid]')].map(r => +r.dataset.pid).sort((a, b) => a - b)`;
  const SAYS = `document.querySelector('.dpanel .dtitle span').textContent`;
  try {
    assert.deepEqual(await p.eval(ROWS), [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112]);
    assert.ok((await p.eval(CPU101)).includes('1.9%'), 'nginx 101 at 0.30 of 16 cores');
    const rsync = fx.procs.lx.procs[7].slice(); rsync[0] = 113; rsync[1] = 'rsync'; rsync[9] = '/usr/bin/rsync --id 113';
    fx.procs.lx.procs[0][4] = 0.42;                                       // 101 changes
    fx.procs.lx.procs = fx.procs.lx.procs.filter(r => r[0] !== 112).concat([rsync]);   // 112 exits, 113 starts
    await p.eval(POLL);
    assert.deepEqual(await p.eval(ROWS), [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 113]);
    assert.ok((await p.eval(CPU101)).includes('2.6%'), 'nginx 101 at 0.42 of 16 cores');
    assert.ok((await p.eval(`document.querySelector('.dpanel tr[data-pid="113"]').textContent`)).includes('rsync'));
    assert.equal(await p.eval(SAYS), '12 processes on lab-linux');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
