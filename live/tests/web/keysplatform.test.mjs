// SPDX-License-Identifier: GPL-3.0-or-later
// Keyboard shortcuts in each platform's own notation, and keys that work there (#325): on Linux and Windows, Fleet runs
// in a Chrome window, which keeps Ctrl+N, Ctrl+T and Ctrl+Tab for itself, so those get Alt+ keys that reach the page.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const KEYS = `[...document.querySelectorAll('#tutorial [role=tabpanel]:not([hidden]) tr')].map(r => [r.cells[0].textContent.trim(), [...r.querySelectorAll('kbd')].map(k => k.textContent.trim())])`;
async function list(p){
  await p.eval(`(openTutorial(2), true)`);
  await p.waitFor(`document.querySelector('#tutorial [role=tabpanel]:not([hidden]) tr')`);
  const rows = Object.fromEntries(await p.eval(KEYS));
  await p.eval(`(document.querySelector('#tutorial [data-tutclose]').click(), true)`);
  return rows;
}
const press = (p, key, o = {}) => p.eval(`(() => { const e = new KeyboardEvent('keydown', Object.assign({key: ${JSON.stringify(key)}, bubbles: true, cancelable: true}, ${JSON.stringify(o)})); document.body.dispatchEvent(e); return e.defaultPrevented; })()`);

for (const platform of ['Linux x86_64', 'Win32']){
  test(`${platform}: Ctrl, Alt and Shift spelled out, no Mac symbols, and keys the browser leaves to the page`, async () => {
    const fx = fixture(); fx.fleet.pins = ['lx'];
    const p = await browser.page(fx, {ui: ui({sel: 'fleet', space: 'fleet'}), platform});
    try {
      await p.waitFor(`document.querySelector('#tree .row')`);
      const rows = await list(p);
      assert.doesNotMatch(JSON.stringify(rows), /[⌘⌥⇧⌃⇥]/, 'no Mac symbols');
      assert.deepEqual(rows['Go to anything: machines, containers, jobs, commands'], ['Ctrl+K']);
      assert.deepEqual(rows['Dock Details beside the overview'], ['Ctrl+Shift+D']);
      assert.deepEqual(rows['CPU, Memory, GPU, Disk I/O, Network'], ['Alt+1 … Alt+5']);
      assert.deepEqual(rows['Bigger, smaller, actual size'], ['Ctrl+Plus', 'Ctrl+Minus', 'Ctrl+0']);
      assert.deepEqual(rows['Back, forward'], ['Alt+←', 'Alt+→']);
      assert.deepEqual(rows['New space: pick a grouping to pin'], ['Alt+N']);
      assert.deepEqual(rows['Open a terminal on the selection'], ['Alt+T']);
      assert.deepEqual(rows['Cycle through the spaces, or the other way'], ['Alt+PgDn', 'Alt+PgUp']);
      // and they work
      assert.equal(await press(p, 'n', {altKey: true, code: 'KeyN'}), true);
      await p.waitFor(`!document.getElementById('picker').hidden`);
      await p.eval(`(closePicker(false), true)`);
      assert.equal(await press(p, 'PageDown', {altKey: true, code: 'PageDown'}), true);
      await p.waitFor(`S.space === 'lx'`);
      assert.equal(await press(p, 'PageUp', {altKey: true, code: 'PageUp'}), true);
      await p.waitFor(`S.space === 'fleet'`);
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  });
}

test('a Mac keeps its own symbols', async () => {
  const p = await browser.page(fixture(), {ui: ui({sel: 'fleet'}), platform: 'MacIntel'});
  try {
    await p.waitFor(`document.querySelector('#tree .row')`);
    const rows = await list(p);
    assert.deepEqual(rows['Go to anything: machines, containers, jobs, commands'], ['⌘K']);
    assert.deepEqual(rows['New space: pick a grouping to pin'], ['⌘N']);
    assert.deepEqual(rows['Cycle through the spaces, or the other way'], ['⌃⇥', '⌃⇧⇥']);
    assert.deepEqual(rows['Bigger, smaller, actual size'], ['⌘+', '⌘−', '⌘0']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
