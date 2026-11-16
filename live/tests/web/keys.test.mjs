// SPDX-License-Identifier: GPL-3.0-or-later
// Keyboard shortcuts: ⌘ on a Mac and Ctrl elsewhere (the events below carry both, so this runs anywhere).
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

// a key pressed on whatever has focus
const press = (p, key, o = {}) => p.eval(`(() => { const t = document.activeElement || document.body; t.dispatchEvent(new KeyboardEvent('keydown', Object.assign({key: ${JSON.stringify(key)}, code: ${JSON.stringify(o.code || '')}, bubbles: true, cancelable: true}, ${JSON.stringify(o.mod ? {metaKey: true, ctrlKey: true} : {})}, ${JSON.stringify({altKey: !!o.alt, shiftKey: !!o.shift})}))); return true; })()`);
const SEL = `(document.querySelector('#tree .row.sel') || {}).dataset?.select || null`;
async function open(over = {}, fx = fixture()){
  const p = await browser.page(fx, {ui: ui(over)});
  await p.waitFor(`document.querySelectorAll('#tree .row').length > 0`);
  return p;
}

test('⌘F opens Details and puts the cursor in its filter; Esc clears it, then leaves it', async () => {
  const p = await open();
  try {
    await press(p, 'f', {mod: true, code: 'KeyF'});
    await p.waitFor(`document.activeElement && document.activeElement.id === 'pfilter'`);
    await p.eval(`(() => { const f = document.getElementById('pfilter'); f.value = 'nginx'; f.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
    await press(p, 'Escape');
    assert.equal(await p.eval(`document.getElementById('pfilter').value`), '');
    await press(p, 'Escape');
    assert.notEqual(await p.eval(`document.activeElement && document.activeElement.id`), 'pfilter');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('⌥1–5 pick the metric, ⌘1–9 and ⌘[ ⌘] pick the space', async () => {
  const fx = fixture(); fx.fleet.pins = ['lx'];
  const p = await open({}, fx);
  try {
    await press(p, '™', {alt: true, code: 'Digit2'});
    assert.equal(await p.eval(`document.querySelector('[data-metric="mem"]').getAttribute('aria-pressed')`), 'true');
    await press(p, '2', {mod: true, code: 'Digit2'});
    await p.waitFor(`document.querySelector('[data-space="lx"]').getAttribute('aria-pressed') === 'true'`);
    await press(p, '[', {mod: true, code: 'BracketLeft'});
    await p.waitFor(`document.querySelector('[data-space="fleet"]').getAttribute('aria-pressed') === 'true'`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('arrows move through the tree, expand, collapse and go to the parent', async () => {
  const p = await open({sel: 'lx', open: {lx: false}});
  try {
    assert.equal(await p.eval(SEL), 'lx');
    await press(p, 'ArrowRight');                         // expand lab-linux
    await p.waitFor(`document.querySelector('#tree .row.sel').getAttribute('aria-expanded') === 'true'`);
    await press(p, 'ArrowDown');                          // its first child
    const child = await p.eval(SEL);
    assert.notEqual(child, 'lx');
    assert.equal(await p.eval(`document.querySelector('#tree .row.sel').getAttribute('aria-level')`), '2');
    await press(p, 'ArrowLeft');                          // a leaf: back to its parent
    assert.equal(await p.eval(SEL), 'lx');
    await press(p, 'ArrowLeft');                          // collapse
    await p.waitFor(`document.querySelector('#tree .row.sel').getAttribute('aria-expanded') === 'false'`);
    await press(p, 'ArrowDown');
    assert.equal(await p.eval(`document.querySelector('#tree .row.sel').getAttribute('aria-level')`), '1');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('P pins the selection; ? lists every shortcut and Esc closes the list', async () => {
  const fx = fixture();
  const p = await open({sel: 'lx'}, fx);
  try {
    await press(p, 'p');
    await p.waitFor(`document.querySelector('[data-space="lx"]')`);
    assert.deepEqual(JSON.parse((fx.posts || []).filter(x => x.path === '/api/pins').pop().body), ['lx']);
    await press(p, '?');
    await p.waitFor(`document.getElementById('keys')`);
    const rows = await p.eval(`document.querySelectorAll('#keys .keytbl tr').length`);
    assert.ok(rows >= 12, `${rows} shortcuts listed`);
    // keys typed in a sheet don't reach the page behind it
    await press(p, 'd', {mod: true, code: 'KeyD'});
    assert.equal(await p.eval(`document.querySelector('[data-details]').getAttribute('aria-pressed')`), 'false');
    await press(p, 'Escape');
    assert.equal(await p.eval(`!!document.getElementById('keys')`), false);
    await press(p, 'd', {mod: true, code: 'KeyD'});
    await p.waitFor(`document.querySelector('[data-details]').getAttribute('aria-pressed') === 'true'`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('⌘K goes to anything: a machine, a command or a theme', async () => {
  const p = await open({sel: 'lx'});
  const go = async q => {
    await press(p, 'k', {mod: true, code: 'KeyK'});
    await p.waitFor(`document.activeElement && document.activeElement.id === 'gotoq'`);
    await p.eval(`(() => { const i = document.getElementById('gotoq'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
    await press(p, 'Enter');
    assert.equal(await p.eval(`!!document.getElementById('goto')`), false);
  };
  try {
    await go('lab-mac');
    await p.waitFor(`document.querySelector('#tree .row.sel .nm').textContent === 'lab-mac'`);
    await go('network tree');
    await p.waitFor(`document.querySelector('[data-tree="network"]').getAttribute('aria-pressed') === 'true' || document.querySelector('[data-tree="network"]').classList.contains('on')`);
    await go('theme dracula');
    await p.waitFor(`getComputedStyle(document.documentElement).getPropertyValue('--chrome').trim() === '#191a21'`);
    // Esc closes it without doing anything
    await press(p, 'k', {mod: true, code: 'KeyK'});
    await p.waitFor(`document.getElementById('goto')`);
    await press(p, 'Escape');
    assert.equal(await p.eval(`!!document.getElementById('goto')`), false);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
