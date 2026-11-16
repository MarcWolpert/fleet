// SPDX-License-Identifier: GPL-3.0-or-later
// The terminals' Reset, and templates you save and launch (#352): Reset (after asking) ends the terminals and goes back
// to the default setup; a template keeps which terminals there are, on what, named what, with their commands and
// splits; launch one from the Templates dialog or ⌘K; rename and delete them. Kept in ui.json.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch, sleep} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const posts = (fx, path) => (fx.posts || []).filter(x => x.path === path).map(x => JSON.parse(x.body));
const sent = async (fx, path, n) => { for (let i = 0; i < 150 && posts(fx, path).length < n; i++) await sleep(20); return posts(fx, path); };
const TABS = `[...document.querySelectorAll('#tdrawer [role=tab]')].map(t => t.textContent.trim())`;
const barMenu = p => p.eval(`(() => { const b = document.querySelector('#tdrawer .td-bar') || document.querySelector('[data-tdrestore]'), r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: r.right - 140, clientY: r.top + r.height / 2})); return true; })()`);
const pick = (p, label) => p.eval(`(() => { const e = [...document.querySelectorAll('#ctxmenu [role=menuitem]')].find(e => (e.querySelector('.cx-l') || e).textContent.trim() === ${JSON.stringify(label)}); e.click(); return true; })()`);

function fx1(withTerms){
  const fx = fixture();
  fx.config = {path: '/dev/null', interval: 3, machines: [], status: {}, terminal: 'auto', terminal_auto: 'Ghostty', terminals: [['ghostty', 'Ghostty']]};
  if (withTerms) fx.terms = {terminals: [], tmux: true, ttyd: true};
  let n = 0;
  fx.onPost = (path, body) => {
    const b = JSON.parse(body);
    if (path === '/api/inline-terminal'){ n++; const m = fx.fleet.machines.find(x => x.id === b.node); return {ok: true, id: 's' + n, url: '/fake-' + n + '.html', title: m ? m.name : b.node, group: b.group || 's' + n}; }
    if (path.startsWith('/api/inline-terminal/')) return {ok: true};
    return null;
  };
  return fx;
}

test('Reset asks, then ends the terminals and brings back a tab per connected computer at the default size', async () => {
  const fx = fx1(true);
  fx.fleet.prefs = Object.assign({}, fx.fleet.prefs, {termClosed: ['lx2', 'win', 'mac'], termFont: 16});
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelector('#tdrawer iframe')`);
    assert.deepEqual(await p.eval(TABS), ['lab-linux']);
    await barMenu(p);
    await p.waitFor(`document.querySelector('#ctxmenu [role=menuitem]')`);
    await pick(p, 'Reset the terminals…');
    await p.waitFor(`document.querySelector('#termdlg [data-tdreset]')`);
    assert.match(await p.eval(`document.getElementById('termdlg').textContent`), /ends the 1 terminal/);
    await p.eval(`(document.querySelector('#termdlg [data-tdcancel]').click(), true)`);
    await p.waitFor(`!document.getElementById('termdlg')`);
    assert.equal(posts(fx, '/api/inline-terminal/close').length, 0, 'Cancel changes nothing');
    await barMenu(p);
    await p.waitFor(`document.querySelector('#ctxmenu [role=menuitem]')`);
    await pick(p, 'Reset the terminals…');
    await p.waitFor(`document.querySelector('#termdlg [data-tdreset]')`);
    await p.eval(`(document.querySelector('#termdlg [data-tdreset]').click(), true)`);
    await p.waitFor(`document.querySelectorAll('#tdrawer [role=tab]').length === 4`);
    assert.deepEqual(await p.eval(TABS), ['lab-linux', 'lab-linux-2', 'lab-windows', 'lab-mac']);
    assert.deepEqual(await sent(fx, '/api/inline-terminal/close', 1), [{id: 's1'}]);
    await p.waitFor(`PREFS.termFont === undefined && (PREFS.termClosed || []).length === 0`);
    assert.equal(await p.eval(`termFont()`), 13);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('save the terminals as a template; launch it from the dialog or ⌘K, with its splits and names; delete it', async () => {
  const fx = fx1(false);
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelector('.hero [data-terminal="lx"]')`);
    await p.eval(`(openInline('lx'), true)`);
    await p.waitFor(`document.querySelectorAll('#tdrawer iframe').length === 1`);
    await p.eval(`(splitInline(), true)`);
    await p.waitFor(`document.querySelectorAll('#tdrawer iframe').length === 2`);
    await p.eval(`(() => { const s = TD.list[1]; s.title = 'logs'; return true; })()`);
    await p.eval(`(openInline('mac'), true)`);
    await p.waitFor(`document.querySelectorAll('#tdrawer iframe').length === 3`);
    await barMenu(p);
    await p.waitFor(`document.querySelector('#ctxmenu [role=menuitem]')`);
    await pick(p, 'Save as a template…');
    await p.waitFor(`document.querySelector('#termdlg input[data-tdtname]')`);
    await p.eval(`(() => { const i = document.querySelector('#termdlg input[data-tdtname]'); i.value = 'Morning'; document.querySelector('#termdlg [data-tdsave]').click(); return true; })()`);
    await p.waitFor(`!document.getElementById('termdlg') && (PREFS.termTemplates || []).length === 1`);
    const t = await p.eval(`PREFS.termTemplates[0]`);
    assert.equal(t.name, 'Morning');
    assert.deepEqual(t.terms.map(x => [x.node, x.tab, x.title || '']), [['lx', 0, ''], ['lx', 0, 'logs'], ['mac', 1, '']]);
    assert.equal(posts(fx, '/api/prefs').pop().termTemplates[0].name, 'Morning', 'kept');
    // close them all, then launch it from the Templates dialog
    await p.eval(`(closeTermGroup(termGroups()[1].g), closeTermGroup(termGroups()[0].g), true)`);
    await p.waitFor(`!TD.list.length`);
    const made = posts(fx, '/api/inline-terminal').length;
    await p.eval(`(openTermTemplates(), true)`);
    await p.waitFor(`document.querySelector('#termdlg [data-tdlaunch="0"]')`);
    assert.match(await p.eval(`document.getElementById('termdlg').textContent`), /Morning/);
    await p.eval(`(document.querySelector('#termdlg [data-tdlaunch="0"]').click(), true)`);
    await p.waitFor(`document.querySelectorAll('#tdrawer iframe').length === 3`);
    const asked = (await sent(fx, '/api/inline-terminal', made + 3)).slice(made);
    assert.deepEqual(asked.map(x => [x.node, x.group || '']), [['lx', ''], ['lx', 's4'], ['mac', '']], 'the split joins its tab');
    assert.deepEqual(await p.eval(TABS), ['lab-linux · logs', 'lab-mac']);
    assert.ok((await sent(fx, '/api/inline-terminal/update', 1)).some(x => x.id === 's5' && x.title === 'logs'), 'its name');
    // ⌘K knows it
    await p.eval(`(openGoto(), true)`);
    await p.eval(`(() => { const q = document.getElementById('gotoq'); q.value = 'Morning'; q.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
    await p.waitFor(`GOTO.items.length && GOTO.items[0].label === 'Launch terminals: Morning'`);
    await p.eval(`(closeGoto(), true)`);
    // delete it
    await p.eval(`(openTermTemplates(), true)`);
    await p.waitFor(`document.querySelector('#termdlg [data-tddelete="0"]')`);
    await p.eval(`(document.querySelector('#termdlg [data-tddelete="0"]').click(), true)`);
    await p.waitFor(`(PREFS.termTemplates || []).length === 0`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
