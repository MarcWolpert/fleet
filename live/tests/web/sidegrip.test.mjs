// SPDX-License-Identifier: GPL-3.0-or-later
// The tree panel resizes from its right edge (#393): drag (kept), double-click for the default, ←/→ from the keyboard;
// bounded; no grip in the narrow, stacked layout.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const W = `Math.round(document.querySelector('aside.side').getBoundingClientRect().width)`;
const drag = (p, dx) => p.eval(`(() => { const g = document.querySelector('aside.side .side-grip'), r = g.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + 200, o = xx => ({bubbles: true, clientX: xx, clientY: y, pointerId: 1, button: 0});
  g.dispatchEvent(new PointerEvent('pointerdown', o(x))); document.dispatchEvent(new PointerEvent('pointermove', o(x + ${dx} / 2))); document.dispatchEvent(new PointerEvent('pointermove', o(x + ${dx}))); document.dispatchEvent(new PointerEvent('pointerup', o(x + ${dx}))); return true; })()`);

test('drag the tree panel’s edge to resize it; kept; bounded; double-click resets; the keyboard too', async () => {
  const p = await browser.page(fixture(), {ui: ui({sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelector('aside.side .side-grip')`);
    assert.equal(await p.eval(W), 390);
    assert.equal(await p.eval(`document.querySelector('aside.side .side-grip').getAttribute('role')`), 'separator');
    await drag(p, 120);
    await p.waitFor(`${W} === 510`);
    assert.equal(await p.eval(`S.sideW`), 510);
    await p.eval(`(location.reload(), true)`);
    await p.waitFor(`document.querySelector('aside.side .side-grip') && ${W} === 510`);
    await drag(p, -800);
    await p.waitFor(`${W} === 240`, 3000);
    await p.eval(`(document.querySelector('aside.side .side-grip').dispatchEvent(new MouseEvent('dblclick', {bubbles: true})), true)`);
    await p.waitFor(`${W} === 390`);
    await p.eval(`(document.querySelector('aside.side .side-grip').focus(), true)`);
    await p.key('ArrowRight');
    await p.waitFor(`${W} === 410`);
    assert.equal(await p.eval(`document.querySelector('aside.side .side-grip').getAttribute('aria-valuenow')`), '410');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('dragged narrow, the tree drops its graphs so the names get the room; wider, they come back', async () => {
  const p = await browser.page(fixture(), {ui: ui({sel: 'lx'})});
  const SPARKS = `[...document.querySelectorAll('#tree .spark')].filter(e => getComputedStyle(e).display !== 'none').length`;
  try {
    await p.waitFor(`document.querySelector('#tree .spark')`);
    assert.ok(await p.eval(SPARKS) > 3);
    await drag(p, -100);   // 290 px
    await p.waitFor(`${W} === 290 && ${SPARKS} === 0`);
    await drag(p, 60);    // 350 px
    await p.waitFor(`${W} === 350 && ${SPARKS} > 3`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the narrow, stacked layout has no grip', async () => {
  const p = await browser.page(fixture(), {ui: ui({sel: 'lx'}), width: 800});
  try {
    await p.waitFor(`document.querySelector('#tree .row')`);
    assert.equal(await p.eval(`(() => { const g = document.querySelector('aside.side .side-grip'); return !g || getComputedStyle(g).display === 'none'; })()`), true);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
