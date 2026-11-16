// SPDX-License-Identifier: GPL-3.0-or-later
// ⌘+ ⌘− ⌘0 size only the terminals while you're in them (#351). In Fleet.app the View menu takes those keys, so the page
// tells the app when the terminals are the panel you're in, and the app's zoom calls the page's fleetTermZoom then.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

function fx1(){
  const fx = fixture();
  fx.config = {path: '/dev/null', interval: 3, machines: [], status: {}, terminal: 'auto', terminal_auto: 'Ghostty', terminals: [['ghostty', 'Ghostty']]};
  let n = 0;
  fx.onPost = (path, body) => path === '/api/inline-terminal' ? {ok: true, id: 's' + (++n), url: '/fake.html', title: 'lab-linux', group: 's' + n} : path.startsWith('/api/inline-terminal/') ? {ok: true} : null;
  return fx;
}
// focus moving and a terminal's frame starting take a while under a full suite's load
const SLOW = 20000;
// The frame takes focus when it loads, if the terminals have it (a tab does): under a full suite's load that can come
// after the test focuses a tab, and the keys then go to the stand-in page, which has no bridge to pass them on
const FRAME_LOADED = `new Promise(r => { const f = document.querySelector('#tdrawer iframe');
  const done = () => { try { return f.contentWindow.location.href !== 'about:blank' && f.contentDocument.readyState === 'complete'; } catch (e) { return true; } };
  if (done()) r(true); else f.addEventListener('load', () => r(true), {once: true}); })`;
const press = async (p, key, code, modifiers, vk) => { for (const type of ['keyDown', 'keyUp']) await p.send('Input.dispatchKeyEvent', {type, key, code, modifiers, windowsVirtualKeyCode: vk}); };

test('Fleet.app: in the terminals the keys size them, and the app is told so; elsewhere they zoom Fleet', async () => {
  const fx = fx1();
  const p = await browser.page(fx, {ui: ui({sel: 'lx'}), native: true});
  try {
    await p.waitFor(`document.querySelector('.hero [data-terminal="lx"]')`, SLOW);
    await p.eval(`(openInline('lx'), true)`);
    await p.waitFor(`document.querySelector('#tdrawer iframe')`, SLOW);
    await p.eval(FRAME_LOADED);
    await p.eval(`(document.querySelector('#tdrawer [role=tab]').focus(), true)`);
    await p.waitFor(`window.nativePosts.some(m => m.termFocus === true)`, SLOW);
    await press(p, '=', 'Equal', 4, 187);
    await p.waitFor(`PREFS.termFont === 14`, SLOW);
    assert.equal(await p.eval(`window.nativePosts.filter(m => m.zoom).length`), 0, 'Fleet doesn’t zoom');
    // what the app calls when its View menu takes the key (⌘− ⌘0)
    await p.eval(`(window.fleetTermZoom('out'), window.fleetTermZoom('out'), true)`);
    await p.waitFor(`PREFS.termFont === 12`, SLOW);
    await p.eval(`(window.fleetTermZoom('reset'), true)`);
    await p.waitFor(`PREFS.termFont === 13`, SLOW);
    // back in the tree: the app hears it, and the keys zoom Fleet again
    await p.eval(`(() => { const r = document.querySelector('#tree .row'); r.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true})); r.focus(); return true; })()`);
    await p.waitFor(`window.nativePosts.length && window.nativePosts.filter(m => 'termFocus' in m).pop().termFocus === false`, SLOW);
    await press(p, '=', 'Equal', 4, 187);
    await p.waitFor(`window.nativePosts.some(m => m.zoom === 'in')`, SLOW);
    assert.equal(await p.eval(`PREFS.termFont`), 13);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a browser (Linux, Windows): Ctrl+= Ctrl+- Ctrl+0 in the terminals size only them', async () => {
  const fx = fx1();
  const p = await browser.page(fx, {ui: ui({sel: 'lx'}), platform: 'Linux x86_64'});
  try {
    await p.waitFor(`document.querySelector('.hero [data-terminal="lx"]')`, SLOW);
    await p.eval(`(openInline('lx'), true)`);
    await p.waitFor(`document.querySelector('#tdrawer iframe')`, SLOW);
    await p.eval(FRAME_LOADED);
    await p.eval(`(document.querySelector('#tdrawer [role=tab]').focus(), true)`);
    await p.waitFor(`PANEL === 'term'`, SLOW);
    await press(p, '-', 'Minus', 2, 189);
    await p.waitFor(`PREFS.termFont === 12`, SLOW);
    await press(p, '0', 'Digit0', 2, 48);
    await p.waitFor(`PREFS.termFont === 13`, SLOW);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
