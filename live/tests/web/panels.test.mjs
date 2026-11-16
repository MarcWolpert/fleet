// SPDX-License-Identifier: GPL-3.0-or-later
// Panels: the one you're in has a soft outline, ⌘F searches that panel (the tree, the overview or
// Details), and Back/Forward retrace where you've been.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const press = (p, key, o = {}) => p.eval(`(() => { const t = document.activeElement || document.body; t.dispatchEvent(new KeyboardEvent('keydown', Object.assign({key: ${JSON.stringify(key)}, code: ${JSON.stringify(o.code || '')}, bubbles: true, cancelable: true}, ${JSON.stringify(o.mod ? {metaKey: true, ctrlKey: true} : {})}, ${JSON.stringify({altKey: !!o.alt, shiftKey: !!o.shift})}))); return true; })()`);
const down = (p, sel) => p.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true})); return true; })()`);
const type = (p, id, v) => p.eval(`(() => { const i = document.getElementById(${JSON.stringify(id)}); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
const ACTIVE = `[...document.querySelectorAll('.pactive')].map(e => e.matches('aside.side') ? 'tree' : e.matches('.dpanel') ? 'details' : 'main')`;
const TREE = `[...document.querySelectorAll('#tree .row .nm')].map(e => e.textContent)`;
const SEL = `(document.querySelector('#tree .row.sel .nm') || {}).textContent`;
async function open(over = {}, fx = fixture()){
  const p = await browser.page(fx, {ui: ui(over)});
  await p.waitFor(`document.querySelectorAll('#tree .row').length > 0 && document.querySelector('#main .hero')`);
  return p;
}

test('the panel you are in has a soft outline, and only that one', async () => {
  const p = await open({detailsDocked: true});
  try {
    await p.waitFor(`document.querySelector('.dpanel')`);
    await down(p, '#tree .row');
    assert.deepEqual(await p.eval(ACTIVE), ['tree']);
    await down(p, '#main .wrap .hero');
    assert.deepEqual(await p.eval(ACTIVE), ['main']);
    await down(p, '.dpanel');
    assert.deepEqual(await p.eval(ACTIVE), ['details']);
    // it survives a re-render of the page
    await p.eval(`(lastMainHTML = '', renderMain(), true)`);
    assert.deepEqual(await p.eval(ACTIVE), ['details']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('⌘F in the tree filters the tree: matches and the path to them, nothing else; Esc brings it all back', async () => {
  const p = await open();
  try {
    const all = await p.eval(TREE);
    await down(p, '#tree .row');
    await press(p, 'f', {mod: true, code: 'KeyF'});
    await p.waitFor(`document.activeElement && document.activeElement.id === 'tfq'`);
    assert.equal(await p.eval(`document.querySelector('[data-details]').getAttribute('aria-pressed')`), 'false');
    await type(p, 'tfq', 'web');
    await p.waitFor(`${TREE}.length === 12`);
    assert.deepEqual(await p.eval(TREE), ['lab-linux', 'Containers', 'web', 'lab-linux-2', 'Containers', 'web', 'lab-mac', 'Containers', 'web', 'lab-windows', 'Containers', 'web']);
    await type(p, 'tfq', 'no such thing');
    await p.waitFor(`${TREE}.length === 0`);
    await press(p, 'Escape');
    await p.waitFor(`${TREE}.length === ${all.length}`);
    assert.equal(await p.eval(`document.getElementById('tfq') && !document.getElementById('tfq').closest('[hidden]')`), false);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('⌘F in the overview finds in the overview, and never jumps to Details', async () => {
  const p = await open();
  try {
    await down(p, '#main .hero');
    await press(p, 'f', {mod: true, code: 'KeyF'});
    await p.waitFor(`document.activeElement && document.activeElement.id === 'mfq'`);
    await type(p, 'mfq', 'web');
    await p.waitFor(`document.querySelectorAll('#main .fmatch').length > 0`);
    const n = await p.eval(`document.querySelectorAll('#main .fmatch').length`);
    assert.equal(await p.eval(`document.querySelectorAll('#main .fcur').length`), 1);
    assert.equal(await p.eval(`document.getElementById('mfcount').textContent`), `1 of ${n}`);
    assert.ok(await p.eval(`[...document.querySelectorAll('#main .fmatch')].every(e => /web/i.test(e.textContent))`));
    assert.equal(await p.eval(`document.querySelector('[data-details]').getAttribute('aria-pressed')`), 'false');
    // highlights come back after the page re-renders
    await p.eval(`(lastMainHTML = '', renderMain(), true)`);
    assert.equal(await p.eval(`document.querySelectorAll('#main .fmatch').length`), n);
    await press(p, 'Escape');
    await p.waitFor(`document.querySelectorAll('#main .fmatch').length === 0`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('⌘F in docked Details filters its processes', async () => {
  const p = await open({detailsDocked: true});
  try {
    await p.waitFor(`document.querySelector('.dpanel #pfilter')`);
    await down(p, '.dpanel');
    await press(p, 'f', {mod: true, code: 'KeyF'});
    await p.waitFor(`document.activeElement && document.activeElement.id === 'pfilter'`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Back and Forward retrace where you have been: ⌘[ ⌘], the ‹ › buttons and the mouse side buttons', async () => {
  const p = await open({sel: 'lx'});
  try {
    assert.equal(await p.eval(`document.querySelector('[data-nav="back"]').disabled`), true);
    await p.eval(`(() => { [...document.querySelectorAll('#tree .row .nm')].find(e => e.textContent === 'lab-mac').click(); return true; })()`);
    await p.waitFor(`${SEL} === 'lab-mac'`);
    await p.eval(`(() => { document.querySelector('[data-metric="mem"]').click(); return true; })()`);
    assert.equal(await p.eval(`document.querySelector('[data-nav="back"]').disabled`), false);
    await press(p, '[', {mod: true, code: 'BracketLeft'});                     // back: Memory → CPU
    await p.waitFor(`document.querySelector('[data-metric="cpu"]').getAttribute('aria-pressed') === 'true'`);
    assert.equal(await p.eval(SEL), 'lab-mac');
    await p.eval(`(() => { document.querySelector('[data-nav="back"]').click(); return true; })()`);   // back: lab-mac → lab-linux
    await p.waitFor(`${SEL} === 'lab-linux'`);
    assert.equal(await p.eval(`document.querySelector('[data-nav="back"]').disabled`), true);
    await p.eval(`(() => { document.dispatchEvent(new MouseEvent('mouseup', {button: 4, bubbles: true})); return true; })()`);  // forward
    await p.waitFor(`${SEL} === 'lab-mac'`);
    await press(p, ']', {mod: true, code: 'BracketRight'});                    // forward: Memory again
    await p.waitFor(`document.querySelector('[data-metric="mem"]').getAttribute('aria-pressed') === 'true'`);
    assert.equal(await p.eval(`document.querySelector('[data-nav="fwd"]').disabled`), true);
    // going somewhere new from the middle drops the old forward path
    await press(p, '[', {mod: true, code: 'BracketLeft'});
    await p.waitFor(`document.querySelector('[data-metric="cpu"]').getAttribute('aria-pressed') === 'true'`);
    await p.eval(`(() => { document.querySelector('[data-metric="disk"]').click(); return true; })()`);
    assert.equal(await p.eval(`document.querySelector('[data-nav="fwd"]').disabled`), true);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
