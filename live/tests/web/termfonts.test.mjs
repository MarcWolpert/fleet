// SPDX-License-Identifier: GPL-3.0-or-later
// The terminals' fonts (#408): Settings › Terminal picks one Fleet carries (Fira Code, JetBrains Mono, Source Code Pro,
// Hack), one you installed, or a font list of your own, with a preview; you install and remove your own there. ttyd's
// page is on another port, so Fleet sends it the font's data, and it changes font live.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const LIVE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIRA = fs.readFileSync(path.join(LIVE, 'web', 'fonts', 'FiraCode-Regular.woff2'));
const SLOW = 20000;
const face = (file, weight) => ({url: '/fonts/' + file, weight, style: 'normal'});
const CARRIED = [['Fira Code', 'FiraCode'], ['JetBrains Mono', 'JetBrainsMono'], ['Source Code Pro', 'SourceCodePro'], ['Hack', 'Hack']]
  .map(([family, f]) => ({family, own: false, faces: [face(f + '-Regular.woff2', '400'), face(f + '-Bold.woff2', '700')]}));
const MINE = {family: 'Iosevka', own: true, faces: [{url: '/api/font?f=Iosevka-Regular.woff2', weight: '400', style: 'normal'}]};

function fx1(fonts){
  const fx = fixture();
  fx.config = {path: '/dev/null', interval: 3, machines: [], status: {}, terminal: 'auto', terminal_auto: 'Ghostty', terminals: [['ghostty', 'Ghostty']]};
  fx.fonts = {fonts: fonts || CARRIED.concat([MINE])};
  fx.fontData = {'Iosevka-Regular.woff2': FIRA};
  return fx;
}
const posts = (fx, p) => (fx.posts || []).filter(w => w.path === p);
const pick = v => `(() => { const s = document.querySelector('#sheet [data-termfont]'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`;
const OPTIONS = `[...document.querySelectorAll('#sheet [data-termfont] option')].map(o => (o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label + ': ' : '') + o.textContent)`;

test('Settings › Terminal: the fonts Fleet carries, yours, or a list of your own, with a preview', async () => {
  const fx = fx1();
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.eval(`(openSettings(), true)`);
    await p.waitFor(`document.querySelectorAll('#sheet [data-termfont] option').length > 5`, SLOW);
    assert.deepEqual(await p.eval(OPTIONS), ['Fleet’s default: a Nerd Font you have, or Menlo', 'Fleet carries: Fira Code', 'Fleet carries: JetBrains Mono',
      'Fleet carries: Source Code Pro', 'Fleet carries: Hack', 'Yours: Iosevka', 'A font list of your own…']);
    assert.equal(await p.eval(`document.querySelector('#sheet [data-termfont]').value`), '');
    assert.equal(await p.eval(`document.querySelector('#sheet [data-termfontfamily]').hidden`), true);
    await p.eval(pick('Fira Code'));
    await p.waitFor(`PREFS.termFontFamily === '"Fira Code", monospace'`);
    assert.equal(JSON.parse(posts(fx, '/api/prefs').pop().body).termFontFamily, '"Fira Code", monospace');
    // the preview is in the font itself, which Fleet's page loads from its own files
    assert.match(await p.eval(`getComputedStyle(document.querySelector('#sheet .tfont-prev')).fontFamily`), /^"Fira Code", "Fleet Symbols", monospace$/);
    await p.waitFor(`[...document.fonts].some(f => f.family.replace(/"/g, '') === 'Fira Code' && f.status === 'loaded')`, SLOW);
    // reopened, it shows what you chose
    await p.eval(`(closeSheet(), openSettings(), true)`);
    await p.waitFor(`document.querySelector('#sheet [data-termfont]') && document.querySelector('#sheet [data-termfont]').value === 'Fira Code'`, SLOW);
    // a list of your own: the field to write it in
    await p.eval(pick('custom'));
    assert.equal(await p.eval(`document.querySelector('#sheet [data-termfontfamily]').hidden`), false);
    await p.eval(`(() => { const i = document.querySelector('#sheet [data-termfontfamily]'); i.value = '"Iosevka Term", monospace'; i.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
    await p.waitFor(`PREFS.termFontFamily === '"Iosevka Term", monospace'`);
    await p.eval(pick(''));
    await p.waitFor(`PREFS.termFontFamily === ''`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('install a font of your own, then remove it', async () => {
  const fx = fx1(CARRIED.slice());
  fx.onPost = (p, body) => {
    if (p === '/api/fonts/install'){ fx.fonts.fonts.push(MINE); return {ok: true, family: 'Iosevka'}; }
    if (p === '/api/fonts/remove'){ fx.fonts.fonts = fx.fonts.fonts.filter(f => f !== MINE); return {ok: true, removed: 1}; }
    return null;
  };
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.eval(`(openSettings(), true)`);
    await p.waitFor(`document.querySelectorAll('#sheet [data-termfont] option').length === 6`, SLOW);
    assert.equal(await p.eval(`document.querySelector('#sheet [data-fontremove]').hidden`), true, 'nothing of yours to remove');
    await p.eval(`(() => { const i = document.querySelector('#sheet [data-fontfile]'), dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(FIRA.toString('base64'))}), c => c.charCodeAt(0))], 'Iosevka-Regular.woff2'));
      i.files = dt.files; i.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
    await p.waitFor(`PREFS.termFontFamily === '"Iosevka", monospace'`, SLOW);
    const w = posts(fx, '/api/fonts/install')[0];
    assert.equal(w.url, '/api/fonts/install?name=Iosevka-Regular.woff2');
    assert.equal(w.headers['x-fleet'], '1');
    assert.equal(Number(w.headers['content-length']), FIRA.length, 'the file as it is');
    await p.waitFor(`document.querySelector('#sheet [data-termfont]').value === 'Iosevka'`, SLOW);
    assert.match(await p.eval(`document.querySelector('#sheet [data-fontremove]').textContent`), /Remove Iosevka/);
    assert.equal(await p.eval(`document.querySelector('#sheet [data-fontremove]').hidden`), false);
    await p.eval(`(document.querySelector('#sheet [data-fontremove]').click(), true)`);
    await p.waitFor(`PREFS.termFontFamily === ''`, SLOW);
    assert.deepEqual(JSON.parse(posts(fx, '/api/fonts/remove')[0].body), {family: 'Iosevka'});
    await p.waitFor(`document.querySelectorAll('#sheet [data-termfont] option').length === 6 && document.querySelector('#sheet [data-termfont]').value === ''`, SLOW);
    // what isn't a font is turned away by the server, which says why
    fx.onPost = (p) => p === '/api/fonts/install' ? {ok: false, error: 'That isn’t a font file.'} : null;
    await p.eval(`(() => { const i = document.querySelector('#sheet [data-fontfile]'), dt = new DataTransfer();
      dt.items.add(new File(['hello'], 'notes.ttf')); i.files = dt.files; i.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
    await p.waitFor(`/That isn’t a font file/.test(document.querySelector('#sheet [data-fontmsg]').textContent)`, SLOW);
    assert.equal(await p.eval(`PREFS.termFontFamily`), '');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the terminals get the font’s data once each, and again when one reloads', async () => {
  const fx = fx1();
  fx.fleet.prefs = {termFontFamily: '"Fira Code", monospace'};
  fx.onPost = p => p === '/api/inline-terminal' ? {ok: true, id: 's1', url: '/fonts/FiraCode-OFL.txt', title: 'lab-linux'} : p.startsWith('/api/inline-terminal/') ? {ok: true} : null;
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelector('.hero [data-terminal="lx"]')`, SLOW);
    await p.eval(`(openInline('lx'), true)`);
    await p.waitFor(`document.querySelector('#tdrawer iframe') && document.querySelector('#tdrawer iframe').contentDocument && document.querySelector('#tdrawer iframe').contentDocument.readyState === 'complete'`, SLOW);
    const LOG = `(() => { const w = document.querySelector('#tdrawer iframe').contentWindow; w.got = []; w.addEventListener('message', e => w.got.push(e.data)); return true; })()`;
    const GOT = `document.querySelector('#tdrawer iframe').contentWindow.got.filter(d => d.fleet === 'termFont').map(d => [d.family, (d.faces || []).map(f => [f.family, f.weight, f.style, f.data instanceof f.data.constructor && f.data.byteLength])])`;
    await p.eval(LOG);
    await p.eval(`(sendTermFont(), true)`);
    await p.waitFor(`${GOT}.some(m => m[1].length)`, SLOW);
    const fam = '"Fira Code", "Fleet Symbols", monospace';
    assert.deepEqual((await p.eval(GOT)).filter(m => m[1].length), [[fam, [['Fira Code', '400', 'normal', FIRA.length], ['Fira Code', '700', 'normal', fs.statSync(path.join(LIVE, 'web', 'fonts', 'FiraCode-Bold.woff2')).size]]]]);
    // a size change: no data again
    await p.eval(`(setTermFont(15), true)`);
    await p.waitFor(`${GOT}.length >= 2`, SLOW);
    await new Promise(r => setTimeout(r, 300));
    assert.equal((await p.eval(GOT)).filter(m => m[1].length).length, 1, 'once');
    // the terminal's page reloads (and says it's ready): the data goes again
    await p.eval(LOG);
    await p.eval(`(document.querySelector('#tdrawer iframe').contentWindow.eval("parent.postMessage({fleet: 'termReady'}, '*')"), true)`);
    await p.waitFor(`${GOT}.some(m => m[1].length)`, SLOW);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('ttyd’s page adds the font it’s sent, then measures and draws with it', async () => {
  const src = fs.readFileSync(path.join(LIVE, 'fleet_live.py'), 'utf8');
  const js = src.match(/TTYD_BRIDGE_JS = r"""([\s\S]*?)"""/)[1];
  const fam = '"Fira Code", "Fleet Symbols", monospace';
  // ttyd started with the font already in its options: the page must still measure again once the font is in
  const term = `window.term={sets:[],options:{fontSize:13,get fontFamily(){return this._f},set fontFamily(v){this._f=v;term.sets.push(v)},_f:${JSON.stringify(fam)}},rows:24,refresh(){},clearTextureAtlas(){},fit(){
    parent.postMessage({fleet:'ack',family:this.options.fontFamily,sets:this.sets.slice(),loaded:[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family.replace(/"/g,'')+' '+f.weight)},'*')}}`;
  const page = `<html><body><script>${term}</script><script>${js}</script></body></html>`;
  const fx = fx1();
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.eval(`(window.__acks = [], addEventListener('message', e => { if (e.data && e.data.fleet === 'ack') __acks.push(e.data); }),
      window.__f = Object.assign(document.createElement('iframe'), {srcdoc: ${JSON.stringify(page)}}), document.body.appendChild(__f), true)`);
    await p.waitFor(`__f.contentWindow && __f.contentWindow.term`, SLOW);
    await p.eval(`fetch('/fonts/FiraCode-Regular.woff2').then(r => r.arrayBuffer()).then(b => (__f.contentWindow.postMessage({fleet: 'termFont', size: 13, family: ${JSON.stringify(fam)},
      faces: [{family: 'Fira Code', weight: '400', style: 'normal', data: b}, {family: 'Fira</style>', weight: '400', style: 'normal', data: b}, {family: 'Fira Code', weight: '700', style: 'normal', data: 'not data'}]}, '*'), true))`);
    await p.waitFor(`__acks.some(a => a.loaded.includes('Fira Code 400'))`, SLOW);
    const a = await p.eval(`__acks.find(a => a.loaded.includes('Fira Code 400'))`);
    assert.equal(a.family, fam);
    assert.ok(a.sets.length >= 2 && a.sets[a.sets.length - 1] === fam, 'set again, so the terminal measures with the font: ' + JSON.stringify(a.sets));
    assert.deepEqual(a.loaded, ['Fira Code 400'], 'only a good face with a good name');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
