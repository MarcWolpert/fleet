// SPDX-License-Identifier: GPL-3.0-or-later
// The Mac app drags its window from the space bar's empty parts, so the page tells it where the pills and
// buttons are. Every time they move (a pill's percentage grows each poll, a pin), it says so again.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const PLUS = `(() => { const r = document.querySelector('[data-addpin]').getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); })()`;
const LAST = `(() => { const m = (window.__posts || []).filter(x => x.regions).pop(); return m ? m.regions.map(r => r.map(Math.round)) : []; })()`;

test('when a pill gets wider, the app hears where + is now', async () => {
  const fx = fixture(); fx.fleet.pins = ['lx'];
  const p = await browser.page(fx, {ui: ui({sel: 'fleet'})});
  try {
    await p.waitFor(`document.querySelector('[data-addpin]') && document.querySelector('[data-pc="lx"]')`);
    await p.eval(`(window.webkit = {messageHandlers: {fleet: {postMessage: m => (window.__posts = window.__posts || []).push(m)}}}, true)`);
    const was = await p.eval(PLUS);
    await p.eval(`(document.querySelector('[data-pc="fleet"]').textContent = '100.0% and then some', true)`);
    const now = await p.eval(PLUS);
    assert.ok(now[0] > was[0] + 20, 'the + moved right');
    await p.waitFor(`${LAST}.some(r => r[0] === ${now[0]})`);
    assert.ok((await p.eval(LAST)).some(r => JSON.stringify(r) === JSON.stringify(now)), 'reported where + is now');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
