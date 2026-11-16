// SPDX-License-Identifier: GPL-3.0-or-later
// The terminals below the page, by default (#338): a tab for each connected computer, each started when you first go
// to it; tabs follow connections; minimize (left of the first tab) and restore (bottom left of the pane, or ⌘J);
// + opens Go to anything with just what can have a terminal.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const posts = (fx, path) => (fx.posts || []).filter(x => x.path === path).map(x => JSON.parse(x.body));
const TABS = `[...document.querySelectorAll('#tdrawer [role=tab]')].map(t => t.textContent.trim() + (t.getAttribute('aria-selected') === 'true' ? ' *' : ''))`;
const near = (a, b) => Math.abs(a - b) < 1.5;

function fx1(){
  const fx = fixture();
  fx.config = {path: '/dev/null', interval: 3, machines: [], status: {}, terminal: 'auto', terminal_auto: 'Ghostty', terminals: [['ghostty', 'Ghostty']]};
  fx.terms = {terminals: [], tmux: true, ttyd: true};
  let n = 0;
  fx.onPost = (path, body) => {
    if (path === '/api/inline-terminal'){ const b = JSON.parse(body), m = fx.fleet.machines.find(x => x.id === b.node); n++; return {ok: true, id: 's' + n, url: '/fake-' + n + '.html', title: m ? m.name : 'web'}; }
    if (path === '/api/inline-terminal/close') return {ok: true};
    return null;
  };
  return fx;
}

test('a terminal for each connected computer from the start; each starts when you go to it; tabs follow connections', async () => {
  const fx = fx1();
  fx.fleet.machines.find(m => m.id === 'mac').status = 'offline';
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelectorAll('#tdrawer [role=tab]').length === 3`);
    assert.deepEqual(await p.eval(TABS), ['lab-linux *', 'lab-linux-2', 'lab-windows']);
    await p.waitFor(`document.querySelector('#tdrawer iframe')`);
    assert.deepEqual(posts(fx, '/api/inline-terminal').map(x => x.node), ['lx'], 'only the one you are on starts');
    await p.eval(`(document.querySelectorAll('#tdrawer [data-tdtab]')[2].click(), true)`);
    await p.waitFor(`document.querySelectorAll('#tdrawer iframe').length === 2`);
    assert.deepEqual(posts(fx, '/api/inline-terminal').map(x => x.node), ['lx', 'win']);
    // lab-mac connects: its tab comes; lab-windows drops: its tab (and terminal) stay
    fx.fleet.machines.find(m => m.id === 'mac').status = 'ok';
    fx.fleet.machines.find(m => m.id === 'win').status = 'offline';
    await p.eval(`(refreshNow(), true)`);
    await p.waitFor(`document.querySelectorAll('#tdrawer [role=tab]').length === 4`);
    assert.deepEqual(await p.eval(TABS), ['lab-linux', 'lab-linux-2', 'lab-windows *', 'lab-mac']);
    // closing one you never started: it goes, and doesn't come back on the next refresh
    await p.eval(`(document.querySelectorAll('#tdrawer .td-tab')[1].querySelector('.td-x').click(), true)`);
    await p.waitFor(`document.querySelectorAll('#tdrawer [role=tab]').length === 3`);
    await p.waitFor(`(PREFS.termClosed || []).includes('lx2')`);
    await p.eval(`(refreshNow(), true)`);
    await p.eval(`new Promise(r => setTimeout(r, 300))`);
    assert.deepEqual(await p.eval(TABS), ['lab-linux', 'lab-windows *', 'lab-mac']);
    assert.deepEqual(posts(fx, '/api/inline-terminal/close'), [], 'nothing to end: it never started');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('minimize, left of the first tab; restore, bottom left of the pane, or ⌘J; kept, and the terminals keep running', async () => {
  const fx = fx1();
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  const cmdJ = async () => { for (const type of ['keyDown', 'keyUp']) await p.send('Input.dispatchKeyEvent', {type, key: 'j', code: 'KeyJ', modifiers: 4, windowsVirtualKeyCode: 74}); };
  try {
    await p.waitFor(`document.querySelector('#tdrawer iframe')`);
    const r = await p.eval(`(() => { const m = document.querySelector('#tdrawer [data-tdmin]').getBoundingClientRect(), t = document.querySelector('#tdrawer [role=tab]').getBoundingClientRect(); return {m: m.right, t: t.left}; })()`);
    assert.ok(r.m <= r.t, 'left of the first tab');
    await p.eval(`(document.querySelector('#tdrawer iframe').__mark = 1, document.querySelector('#tdrawer [data-tdmin]').click(), true)`);
    await p.waitFor(`document.getElementById('tdrawer').hidden`);
    const box = await p.eval(`(() => { const c = document.getElementById('mcol').getBoundingClientRect(), m = document.querySelector('main').getBoundingClientRect(), b = document.querySelector('[data-tdrestore]'), r = b && !b.hidden && b.getBoundingClientRect(); return {fill: Math.abs(m.bottom - c.bottom) < 1.5, r: r && {l: r.left - m.left, b: m.bottom - r.bottom, w: r.width}}; })()`);
    assert.ok(box.fill, 'the page fills the pane');
    assert.ok(box.r && box.r.l >= 0 && box.r.l < 32 && box.r.b >= 0 && box.r.b < 32 && box.r.w > 16, 'restore sits at the bottom left: ' + JSON.stringify(box.r));
    await p.waitFor(`PREFS.termMin === true`);
    assert.equal(posts(fx, '/api/prefs').pop().termMin, true, 'kept');
    await p.eval(`(document.querySelector('[data-tdrestore]').click(), true)`);
    await p.waitFor(`!document.getElementById('tdrawer').hidden`);
    assert.equal(await p.eval(`document.querySelector('#tdrawer iframe').__mark`), 1, 'the same terminal');
    assert.equal(await p.eval(`document.querySelector('[data-tdrestore]').hidden`), true);
    // ⌘J from the terminals' bar (inside a terminal, Fleet's script in ttyd's page passes it on: inline.test.mjs)
    await p.eval(`(document.querySelector('#tdrawer [role=tab]').focus(), true)`);
    await cmdJ();
    await p.waitFor(`document.getElementById('tdrawer').hidden`);
    await cmdJ();
    await p.waitFor(`!document.getElementById('tdrawer').hidden`);
    assert.equal(posts(fx, '/api/inline-terminal/close').length, 0, 'minimizing ends nothing');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a minimized panel stays minimized after a reload', async () => {
  const fx = fx1();
  fx.fleet.prefs = Object.assign({}, fx.fleet.prefs, {termMin: true});
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelector('[data-tdrestore]') && !document.querySelector('[data-tdrestore]').hidden`);
    assert.equal(await p.eval(`!document.getElementById('tdrawer') || document.getElementById('tdrawer').hidden`), true);
    assert.deepEqual(posts(fx, '/api/inline-terminal'), [], 'nothing starts while it is minimized');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('+ opens Go to anything with just what can have a terminal; picking one opens its terminal', async () => {
  const fx = fx1();
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelector('#tdrawer [data-tdadd]')`);
    await p.eval(`(document.querySelector('#tdrawer [data-tdadd]').click(), true)`);
    await p.waitFor(`document.getElementById('goto')`);
    assert.match(await p.eval(`document.getElementById('gotoq').placeholder`), /terminal/i);
    const kinds = await p.eval(`[...new Set(GOTO.items.map(x => x.n ? x.n.kind : 'command'))].sort()`);
    assert.deepEqual(kinds, ['container', 'machine']);
    await p.eval(`(() => { const q = document.getElementById('gotoq'); q.value = 'web'; q.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
    await p.waitFor(`GOTO.items.length && GOTO.items[0].n.kind === 'container'`);
    await p.eval(`(document.querySelector('#gotolist [data-goi="0"]').click(), true)`);
    await p.waitFor(`!document.getElementById('goto')`);
    await p.waitFor(`document.querySelectorAll('#tdrawer [role=tab]').length === 5`);
    assert.match(posts(fx, '/api/inline-terminal').pop().node, /\/containers\/web$/);
    assert.equal(await p.eval(`S.sel`), 'lx', 'it does not go anywhere');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

// #412: in Go to anything, terminal: and a name opens a terminal there, in the terminals below the page
test('⌘K: terminal: lists what can have a terminal, filtered by what follows; Enter opens one there', async () => {
  const fx = fx1();
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  const type = v => p.eval(`(() => { const q = document.getElementById('gotoq'); q.value = ${JSON.stringify(v)}; q.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
  const enter = () => p.eval(`(document.getElementById('gotoq').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})), true)`);
  try {
    await p.waitFor(`document.querySelectorAll('#tdrawer [role=tab]').length === 4`);
    await p.eval(`(openGoto(), true)`);
    await p.waitFor(`document.getElementById('gotoq')`);
    assert.match(await p.eval(`document.getElementById('gotoq').placeholder`), /terminal:/);
    // the prefix alone: just what can have a terminal, as the terminals' + lists them
    await type('terminal:');
    const all = await p.eval(`GOTO.items.map(x => x.n.id)`);
    assert.deepEqual(await p.eval(`[...new Set(GOTO.items.map(x => x.n ? x.n.kind : 'command'))].sort()`), ['container', 'machine']);
    assert.deepEqual(all, await p.eval(`(GOTO.mode = 'term', GOTO.q = '', (() => { const ids = gotoItems().map(x => x.n.id); GOTO.mode = ''; GOTO.q = 'terminal:'; return ids; })())`));
    // any case, no space: what follows filters
    await type('Terminal:web');
    await p.waitFor(`GOTO.items.length && GOTO.items.every(x => x.n && /web/.test(x.n.name))`);
    await enter();
    await p.waitFor(`!document.getElementById('goto')`);
    await p.waitFor(`document.querySelectorAll('#tdrawer [role=tab]').length === 5`);
    assert.match(posts(fx, '/api/inline-terminal').pop().node, /\/containers\/web$/);
    assert.equal(await p.eval(`S.sel`), 'lx', 'the page stays where it is');
    // without the prefix, a name goes there, as before
    await p.eval(`(openGoto(), true)`);
    await type('web');
    await p.waitFor(`GOTO.items.length && GOTO.items[0].n && /web/.test(GOTO.items[0].n.name)`);
    await enter();
    await p.waitFor(`/\\/containers\\/web$/.test(S.sel)`);
    assert.equal(await p.eval(`document.querySelectorAll('#tdrawer [role=tab]').length`), 5, 'no new terminal');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

// #395: t shows or hides the terminals, r goes into the one you're on; not while typing in a field
test('t shows or hides the terminals; r puts you in the one you’re on; neither while typing', async () => {
  const fx = fx1();
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  const press = async k => { await p.send('Input.dispatchKeyEvent', {type: 'keyDown', key: k, code: 'Key' + k.toUpperCase(), text: k, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0)}); await p.send('Input.dispatchKeyEvent', {type: 'keyUp', key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0)}); };
  try {
    await p.waitFor(`document.querySelector('#tdrawer iframe')`);
    await p.eval(`(document.querySelector('#tree [tabindex], #tree button').focus(), true)`);
    await press('t');
    await p.waitFor(`document.getElementById('tdrawer').hidden && PREFS.termMin === true`);
    await press('t');
    await p.waitFor(`!document.getElementById('tdrawer').hidden && PREFS.termMin === false`);
    await p.eval(`(document.querySelector('#tree [tabindex], #tree button').focus(), true)`);
    await press('r');
    await p.waitFor(`document.activeElement && document.activeElement.tagName === 'IFRAME' && !!document.activeElement.closest('#tdrawer')`);
    // typing in a field: the letters are the field's
    await p.eval(`(document.querySelector('#tree [tabindex], #tree button').focus(), openTreeFind(), true)`);
    await p.waitFor(`document.activeElement && document.activeElement.id === 'tfq'`);
    await press('t');
    await p.eval(`new Promise(r => setTimeout(r, 200))`);
    assert.equal(await p.eval(`document.getElementById('tdrawer').hidden`), false);
    assert.equal(await p.eval(`document.getElementById('tfq').value`), 't');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
