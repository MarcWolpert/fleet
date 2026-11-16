// SPDX-License-Identifier: GPL-3.0-or-later
// Keyboard shortcuts: ⌘ on a Mac and Ctrl elsewhere (the events below carry both, so this runs anywhere).
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui, PIDS} from './fixtures.mjs';

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

test('⌘F in Details puts the cursor in its filter; Esc clears it, then leaves it', async () => {
  const p = await open({view: 'details'});
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

test('⌥1–5 pick the metric, ⌘1–9 and ⌘⇧[ ⌘⇧] pick the space', async () => {
  const fx = fixture(); fx.fleet.pins = ['lx'];
  const p = await open({}, fx);
  try {
    await press(p, '™', {alt: true, code: 'Digit2'});
    assert.equal(await p.eval(`document.querySelector('[data-metric="mem"]').getAttribute('aria-pressed')`), 'true');
    await press(p, '2', {mod: true, code: 'Digit2'});
    await p.waitFor(`document.querySelector('[data-space="lx"]').getAttribute('aria-pressed') === 'true'`);
    await press(p, '{', {mod: true, shift: true, code: 'BracketLeft'});   // ⌘⇧[ : the previous space (⌘[ is Back)
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

test('the Go to list\'s row style stays in Go to: the spacers in card headers stay plain spacers (regression)', async () => {
  const p = await open({sel: 'lx'});
  try {
    await p.waitFor(`document.querySelectorAll('#main .card-h .grow').length >= 2`);
    // every spacer: no padding, no minimum height, no pointer
    const SPACERS = `[...new Set([...document.querySelectorAll('#main .card-h .grow')].map(s => { const c = getComputedStyle(s); return [c.padding, c.minHeight, c.cursor].join(' '); }))]`;
    assert.deepEqual(await p.eval(SPACERS), ['0px auto auto']);
    // the machine view's "Where this machine's usage goes" header is one line: its toggle sits beside its title
    assert.equal(await p.eval(`(() => { const h = [...document.querySelectorAll('#main .card-h')].find(h => h.querySelector('.seg')); const t = h.querySelector('h2').getBoundingClientRect(), s = h.querySelector('.seg').getBoundingClientRect(); return s.top < t.bottom && t.top < s.bottom; })()`), true);
    // Go to's rows keep their look
    await press(p, 'k', {mod: true, code: 'KeyK'});
    await p.waitFor(`document.querySelector('#gotolist [data-goi]')`);
    assert.equal(await p.eval(`(() => { const c = getComputedStyle(document.querySelector('#gotolist [data-goi]')); return [c.display, c.minHeight, c.padding, c.cursor].join(' '); })()`), 'flex 36px 5px 10px pointer');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('⌘F and Go to\'s Find a process select a leftover filter, and a refresh keeps it selected, so typing replaces it (regression)', async () => {
  const fx = fixture();
  const p = await open({view: 'details', filter: 'postgres'}, fx);
  const SELN = `(() => { const f = document.getElementById('pfilter'); return [document.activeElement === f, f.value, f.selectionStart, f.selectionEnd]; })()`;
  try {
    await p.waitFor(`${PIDS}.length === 1`);
    // ⌘F in Details, then a poll that changes the page
    await press(p, 'f', {mod: true, code: 'KeyF'});
    assert.deepEqual(await p.eval(SELN), [true, 'postgres', 0, 8]);
    fx.procs.lx.procs[2][4] = 0.75;   // postgres: 3.1% to 4.7% of 16 cores
    await p.eval(`(refreshNow(), true)`);
    await p.waitFor(`document.querySelector('.ptbl tbody tr[data-pid="103"]').textContent.includes('4.7%')`);
    assert.deepEqual(await p.eval(SELN), [true, 'postgres', 0, 8]);
    await p.send('Input.insertText', {text: 'nginx'});
    await p.waitFor(`${PIDS}.length === 2`);
    assert.deepEqual(await p.eval(SELN), [true, 'nginx', 5, 5]);
    assert.deepEqual(await p.eval(PIDS), [101, 102]);
    // from the overview, Go to's Find a process opens Details on the filter; the process list arriving keeps it selected
    await p.eval(`(() => { const f = document.getElementById('pfilter'); f.value = 'postgres'; f.dispatchEvent(new Event('input', {bubbles: true})); f.blur(); return true; })()`);
    await press(p, 'd', {mod: true, code: 'KeyD'});
    await p.waitFor(`!document.getElementById('pfilter')`);
    await press(p, 'k', {mod: true, code: 'KeyK'});
    await p.waitFor(`document.activeElement && document.activeElement.id === 'gotoq'`);
    await p.eval(`(() => { const i = document.getElementById('gotoq'); i.value = 'find a process'; i.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
    await press(p, 'Enter');
    await p.waitFor(`${PIDS}.length === 1`);
    assert.deepEqual(await p.eval(SELN), [true, 'postgres', 0, 8]);
    await p.send('Input.insertText', {text: 'nginx'});
    await p.waitFor(`${PIDS}.length === 2`);
    assert.deepEqual(await p.eval(SELN), [true, 'nginx', 5, 5]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

// Go to's Find a process, typed into Go to and run
async function findProcess(p){
  await press(p, 'k', {mod: true, code: 'KeyK'});
  await p.waitFor(`document.activeElement && document.activeElement.id === 'gotoq'`);
  await p.eval(`(() => { const i = document.getElementById('gotoq'); i.value = 'find a process'; i.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
  await press(p, 'Enter');
}
const WHERE = `(() => { const f = document.activeElement; return {tree: S.tree, view: S.view, docked: !!S.detailsDocked,
  pressed: [...document.querySelectorAll('[data-tree]')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.tree),
  netRows: document.querySelectorAll('#tree .row[data-netsel]').length, machineRows: document.querySelectorAll('#tree .row[data-select]').length > 0,
  focus: f && f.id === 'pfilter' ? (f.closest('.dpanel') ? 'docked filter' : 'Details filter') : (f && (f.id || f.tagName))}; })()`;

test('Find a process with Details docked and the network tree showing: the machine tree, the docked panel\'s filter (regression)', async () => {
  const p = await open({tree: 'network', detailsDocked: true, sel: 'lx'});
  try {
    await p.waitFor(`document.querySelectorAll('#tree .row[data-netsel]').length > 0`);
    await findProcess(p);
    await p.waitFor(`document.activeElement && document.activeElement.id === 'pfilter'`, 1500).catch(() => {});
    const w = await p.eval(WHERE);
    assert.deepEqual(w, {tree: 'machines', view: 'overview', docked: true, pressed: ['machines'], netRows: 0, machineRows: true, focus: 'docked filter'});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Find a process with Details docked and nothing selected: the full Details view\'s filter (regression)', async () => {
  const p = await open({detailsDocked: true, sel: 'fleet'});
  try {
    await p.waitFor(`document.querySelector('.dpanel .dhead')`);
    await findProcess(p);
    await p.waitFor(`document.activeElement && document.activeElement.id === 'pfilter'`, 1500).catch(() => {});
    const w = await p.eval(WHERE);
    assert.deepEqual(w, {tree: 'machines', view: 'details', docked: false, pressed: ['machines'], netRows: 0, machineRows: true, focus: 'Details filter'});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Go to\'s Import a theme while Settings is open keeps the unsaved Settings and opens the file chooser (regression)', async () => {
  const p = await open();
  const choosers = [];
  try {
    await p.send('Page.setInterceptFileChooserDialog', {enabled: true});
    p.on('Page.fileChooserOpened', e => choosers.push(e.mode));
    await press(p, ',', {mod: true, code: 'Comma'});
    await p.waitFor(`document.querySelector('#sheet [data-addmachine]')`);
    await p.click('#sheet [data-addmachine]');
    await p.waitFor(`document.activeElement && document.activeElement.dataset.field === '0:name'`);
    await p.send('Input.insertText', {text: 'my new box'});
    await press(p, 'k', {mod: true, code: 'KeyK'});
    await p.waitFor(`document.activeElement && document.activeElement.id === 'gotoq'`);
    await p.eval(`(() => { const i = document.getElementById('gotoq'); i.value = 'import'; i.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
    await p.key('Enter');
    await p.waitFor(`!document.getElementById('goto')`);
    const t0 = Date.now(); while (!choosers.length && Date.now() - t0 < 3000) await new Promise(r => setTimeout(r, 40));
    await new Promise(r => setTimeout(r, 300));   // a refetch of the settings would land by now
    assert.deepEqual(await p.eval(`({open: SET.open, machines: SET.draft.machines, shown: [...document.querySelectorAll('#sheet [data-field$=":name"]')].map(i => i.value)})`),
      {open: true, machines: [{id: '', name: 'my new box', ssh: '', os: 'linux', tile: 'terminal'}], shown: ['my new box']});
    assert.deepEqual(choosers, ['selectSingle']);
    // with Settings closed it opens Settings first, as before
    await p.eval(`(closeSettings(), true)`);
    await press(p, 'k', {mod: true, code: 'KeyK'});
    await p.waitFor(`document.activeElement && document.activeElement.id === 'gotoq'`);
    await p.eval(`(() => { const i = document.getElementById('gotoq'); i.value = 'import'; i.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
    await p.key('Enter');
    const t1 = Date.now(); while (choosers.length < 2 && Date.now() - t1 < 3000) await new Promise(r => setTimeout(r, 40));
    assert.deepEqual(await p.eval(`({open: SET.open, machines: SET.draft.machines})`), {open: true, machines: []});
    assert.deepEqual(choosers, ['selectSingle', 'selectSingle']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('after a click in the page or Details, the arrows scroll it and leave the tree alone; after a click in the tree they move through it (regression)', async () => {
  const p = await open({view: 'details', sel: 'lx'});
  // a synthetic arrow on whatever has focus: did the page take it?
  const arrow = key => p.eval(`(() => { const t = document.activeElement || document.body; const e = new KeyboardEvent('keydown', {key: ${JSON.stringify(key)}, bubbles: true, cancelable: true}); t.dispatchEvent(e); return {sel: S.sel, taken: e.defaultPrevented}; })()`);
  try {
    await p.waitFor(`${PIDS}.length === 12`);
    await p.click('.ptbl tbody tr[data-pid="103"] td:last-child');   // a cell in Details for lab-linux
    await p.waitFor(`!document.activeElement || document.activeElement === document.body || !document.activeElement.closest('#tree')`);
    assert.deepEqual(await arrow('ArrowDown'), {sel: 'lx', taken: false});
    assert.deepEqual(await arrow('ArrowUp'), {sel: 'lx', taken: false});
    // a click on the page's own heading, focus on the body: still the page's
    await p.click('#main .wrap h1, #main .wrap .dtitle b');
    assert.equal(await p.eval(`document.activeElement === document.body`), true);
    assert.deepEqual(await arrow('ArrowDown'), {sel: 'lx', taken: false});
    // in the tree, the arrows are the tree's
    const next = await p.eval(`(() => { const rows = [...document.querySelectorAll('#tree .row')], i = rows.findIndex(r => r.dataset.select === 'lx'); return rows[i + 1].dataset.select; })()`);
    await p.click('#tree .row[data-select="lx"] .nm');
    await p.eval(`(document.activeElement && document.activeElement.blur(), true)`);   // a redraw can leave the focus on the body
    assert.deepEqual(await arrow('ArrowDown'), {sel: next, taken: true});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
