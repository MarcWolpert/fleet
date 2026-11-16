// SPDX-License-Identifier: GPL-3.0-or-later
// The zoom level by Settings when it isn't 100% (#225): Fleet.app tells the page (window.fleetZoomed); click to reset.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

test('110% shows by Settings, 100% hides it, and a click asks the app for 100%', async () => {
  const p = await browser.page(fixture(), {ui: ui({sel: 'fleet'})});
  const CHIP = `(() => { const c = document.getElementById('zoomchip'); return c && !c.hidden ? c.textContent.trim() : null; })()`;
  try {
    await p.waitFor(`document.querySelector('#tree .row')`);
    assert.equal(await p.eval(CHIP), null, 'nothing at 100%');
    await p.eval(`(window.webkit = {messageHandlers: {fleet: {postMessage: m => (window.__posts = window.__posts || []).push(m)}}}, window.fleetZoomed(1.1), true)`);
    assert.equal(await p.eval(CHIP), '110%');
    assert.equal(await p.eval(`(() => { const c = document.getElementById('zoomchip').getBoundingClientRect(), s = document.querySelector('.setbtn').getBoundingClientRect(); return c.right <= s.left + 1 && Math.abs((c.top + c.bottom) / 2 - (s.top + s.bottom) / 2) < 6; })()`), true, 'just left of Settings');
    await p.eval(`(document.getElementById('zoomchip').click(), true)`);
    assert.deepEqual(await p.eval(`(window.__posts || []).filter(m => m.zoom)`), [{zoom: 'reset'}]);
    await p.eval(`(window.fleetZoomed(0.9), true)`);
    assert.equal(await p.eval(CHIP), '90%');
    await p.eval(`(window.fleetZoomed(1), true)`);
    assert.equal(await p.eval(CHIP), null);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
