// SPDX-License-Identifier: GPL-3.0-or-later
// Themes: Fleet's own colours by default, 21 more built in, picked in Settings → Appearance and kept by the
// server (/api/prefs → ~/.config/fleet/ui.json); Import theme reads a VS Code colour theme or a Fleet theme.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {launch, WEB} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

// themes.js on its own, as the page loads it
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(WEB, 'themes.js'), 'utf8') + '\n;globalThis.T = {FLEET_THEMES, THEME_KEYS, themeTokens, themeContrast, readThemeFile, themeOklab: typeof themeOklab === "function" ? themeOklab : null};', ctx);
// (values from the vm's realm, as plain data, so deepEqual compares contents)
const plain = x => JSON.parse(JSON.stringify(x));
const {FLEET_THEMES, THEME_KEYS, themeContrast} = ctx.T;
const themeTokens = th => plain(ctx.T.themeTokens(th)), readThemeFile = (t, n) => plain(ctx.T.readThemeFile(t, n));

const VAR = k => `getComputedStyle(document.documentElement).getPropertyValue('--${k}').trim()`;
const SWATCHES = `[...document.querySelectorAll('.thsw-b')].map(b => b.textContent.trim())`;
const lastPrefs = fx => { const ps = (fx.posts || []).filter(x => x.path === '/api/prefs'); return ps.length ? JSON.parse(ps[ps.length - 1].body) : null; };
async function open(fx = fixture()){
  const p = await browser.page(fx, {ui: ui()});
  await p.waitFor(`document.querySelectorAll('.tree .row').length > 0`);
  return p;
}
async function settings(p){
  await p.eval(`(() => { document.querySelector('[data-settings]').click(); return true; })()`);
  await p.waitFor(`document.querySelectorAll('.thsw-b').length > 0`);
}
// a file chosen in the Import theme picker
const choose = (p, name, text) => p.eval(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, {type: 'application/json'})); const f = document.getElementById('themefile'); f.files = dt.files; f.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);

test('every built-in theme sets every token, as plain colours, with readable text', () => {
  assert.equal(FLEET_THEMES.length, 22);
  assert.equal(FLEET_THEMES[0].id, 'fleet');
  assert.ok(FLEET_THEMES.some(t => t.name === 'Monokai Dimmed'));
  assert.equal(new Set(FLEET_THEMES.map(t => t.id)).size, 22);
  for (const th of FLEET_THEMES){
    const {vars} = themeTokens(th);
    assert.deepEqual(Object.keys(vars), plain(THEME_KEYS), th.name);
    for (const [k, v] of Object.entries(vars)) assert.match(v, /^#[0-9a-f]{6}([0-9a-f]{2})?$/, `${th.name} ${k}`);
    for (const k of ['ink', 'ink-2', 'ink-3']) assert.ok(themeContrast(vars[k], vars.card) >= 4.5, `${th.name}: ${k} on cards`);
    assert.ok(themeContrast(vars['on-accent'], vars['accent-bg']) >= 3.5, `${th.name}: button text`);
  }
  // Fleet is exactly the stylesheet's own colours
  assert.deepEqual(themeTokens(FLEET_THEMES[0]).vars, plain(Object.fromEntries(THEME_KEYS.map(k => [k, FLEET_THEMES[0].c[k]]))));
});

test('a VS Code theme with comments and trailing commas imports, and only colours get through', () => {
  const th = readThemeFile(`// my theme
  {
    "$schema": "vscode://schemas/color-theme", /* not a comment inside a string: // */
    "name": "Sunset Drive",
    "type": "dark",
    "colors": {
      "editor.background": "#202030",
      "editor.foreground": "#e0d0f0",
      "sideBar.background": "#1a1a28",
      "button.background": "#c04080",
      "terminal.ansiGreen": "#50c080",
      "terminal.ansiBlue": "#4080e0",
      "editorWarning.foreground": "#e09040;} body{display:none",
    },
    "tokenColors": [{"scope": ["comment"], "settings": {"foreground": "#808090"}}, {"scope": "constant.numeric", "settings": {"foreground": "#e07040"}},],
  }`, 'sunset-color-theme.json');
  assert.equal(th.id, 'custom-sunset-drive');
  assert.equal(th.name, 'Sunset Drive');
  assert.equal(th.dark, true);
  assert.equal(th.c.win, '#202030');
  assert.equal(th.c.chrome, '#1a1a28');
  assert.equal(th.c['accent-bg'], '#c04080');
  assert.equal(th.c['t-compose'], '#4080e0');
  assert.equal(th.c['t-vm'], '#e07040');
  assert.equal(th.c.warn, undefined);
  assert.throws(() => ctx.T.readThemeFile('{"name": "x", "include": "./base.json"}', 'x.json'), e => /no editor colours/.test(e.message));
  assert.throws(() => ctx.T.readThemeFile('not json', 'x.json'), e => /JSON/.test(e.message));
  // a Fleet theme names tokens directly
  const f = readThemeFile('{"name": "Paper", "type": "light", "colors": {"chrome": "#eeeeee", "ink": "#222222", "accent": "#0055cc"}}', 'paper.json');
  assert.deepEqual([f.dark, f.c.chrome, f.c.accent], [false, '#eeeeee', '#0055cc']);
});

// Text is painted on the frame (chrome and chrome-2: the page and the space bar), the main view (win), the side
// bar (side) and the cards: the main text reads on all of them at 4.5:1, the quieter text (ink-2, ink-3) at 3:1.
const SURFACES = ['chrome', 'chrome-2', 'win', 'side', 'card'];
function readable(v, name){
  for (const s of SURFACES) for (const [k, min] of [['ink', 4.5], ['ink-2', 3], ['ink-3', 3]])
    assert.ok(themeContrast(v[k], v[s]) >= min, `${name}: ${k} on ${s} is ${themeContrast(v[k], v[s]).toFixed(2)}:1`);
}

test('a light VS Code theme takes its frame from a light bar, never a dark or coloured one', async t => {
  const imp = (type, colors) => readThemeFile(JSON.stringify({name: 'Paper', type, colors}), 'paper.json');
  const light = {'editor.background': '#ffffff', 'editor.foreground': '#333333'};
  const cases = [
    // the classic light theme: a light title bar and side bar, a dark activity bar → the darker of the light bars
    ['dark activity bar', imp('light', {...light, 'sideBar.background': '#f3f3f3', 'titleBar.activeBackground': '#dddddd', 'activityBar.background': '#2c2c2c'}),
      {win: '#ffffff', chrome: '#dddddd', side: '#f3f3f3', ink: '#333333'}],
    // a coloured title bar over a light side bar → the side bar
    ['coloured title bar', imp('light', {...light, 'sideBar.background': '#f3f3f3', 'titleBar.activeBackground': '#007acc'}),
      {win: '#ffffff', chrome: '#f3f3f3', side: '#f3f3f3', ink: '#333333'}],
    // the coloured title bar is the only bar → no frame from the file (Fleet derives one from the editor)
    ['only a coloured title bar', imp('light', {...light, 'titleBar.activeBackground': '#007acc'}), {win: '#ffffff', ink: '#333333'}],
    // every bar is dark, the side bar too → neither the frame nor the side bar comes from the file
    ['all bars dark', imp('light', {...light, 'sideBar.background': '#252526', 'titleBar.activeBackground': '#3c3c3c', 'activityBar.background': '#2c2c2c'}),
      {win: '#ffffff', ink: '#333333'}],
    // control: a dark theme still takes its darkest bar, a coloured title bar or not
    ['dark theme', imp('dark', {'editor.background': '#1e1e1e', 'editor.foreground': '#d4d4d4', 'sideBar.background': '#181818', 'titleBar.activeBackground': '#007acc', 'activityBar.background': '#2c2c2c'}),
      {win: '#1e1e1e', chrome: '#181818', side: '#181818', ink: '#d4d4d4'}]
  ];
  for (const [what, th, c] of cases) await t.test(what, () => {
    assert.deepEqual(th, {id: 'custom-paper', name: 'Paper', dark: what === 'dark theme', c});
    readable(themeTokens(th).vars, what);
  });
  assert.equal(themeTokens(cases[2][1]).vars.chrome, '#f0f0f0');
});

test('Fleet is the default; Settings → Appearance picks a theme, applies it at once and saves it', async () => {
  const fx = fixture();
  const p = await open(fx);
  try {
    assert.equal(await p.eval(VAR('chrome')), '#141416');
    await settings(p);
    const names = await p.eval(SWATCHES);
    assert.equal(names.length, 22);
    assert.equal(names[0], 'Fleet');
    assert.equal(await p.eval(`document.querySelector('.thsw.on .thsw-b').dataset.themeid`), 'fleet');
    await p.eval(`(() => { document.querySelector('[data-themeid="monokai-dimmed"]').click(); return true; })()`);
    assert.equal(await p.eval(VAR('win')), '#1e1e1e');
    assert.equal(await p.eval(`document.querySelector('.thsw.on .thsw-b').dataset.themeid`), 'monokai-dimmed');
    await p.waitFor(`true`);
    assert.equal(lastPrefs(fx).theme, 'monokai-dimmed');
    assert.equal(JSON.parse(await p.eval(`localStorage.getItem('fleet-theme')`)).id, 'monokai-dimmed');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the theme the server has is used at load (it survives restarts), light themes included', async () => {
  const fx = fixture();
  fx.fleet.prefs = {theme: 'github-light'};
  const p = await open(fx);
  try {
    await p.waitFor(`${VAR('card')} === '#ffffff'`);
    assert.equal(await p.eval(`document.documentElement.style.colorScheme`), 'light');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Import theme adds the theme, applies it, saves it, and it can be removed again', async () => {
  const fx = fixture();
  const p = await open(fx);
  try {
    await settings(p);
    assert.equal(await p.eval(`document.querySelector('[data-importtheme]').textContent.trim()`), 'Import theme');
    await choose(p, 'broken.json', '{ nope');
    await p.waitFor(`document.querySelector('.thmsg.bad')`);
    assert.match(await p.eval(`document.querySelector('.thmsg').textContent`), /Couldn’t import broken\.json: it isn’t a JSON file/);
    await choose(p, 'ocean-color-theme.json', '{"name": "Deep Ocean", "type": "dark", "colors": {"editor.background": "#0f1c2e", "editor.foreground": "#cfe3ff", "focusBorder": "#3fa7ff"}}');
    await p.waitFor(`[...document.querySelectorAll('.thsw-b')].some(b => b.textContent.includes('Deep Ocean'))`);
    assert.equal(await p.eval(`document.querySelector('.thsw.on .thsw-b').dataset.themeid`), 'custom-deep-ocean');
    assert.equal(await p.eval(VAR('win')), '#0f1c2e');
    await p.waitFor(`true`);
    const saved = lastPrefs(fx);
    assert.equal(saved.theme, 'custom-deep-ocean');
    assert.equal(saved.themes[0].c.win, '#0f1c2e');
    await p.eval(`(() => { document.querySelector('[data-rmtheme="custom-deep-ocean"]').click(); return true; })()`);
    assert.equal(await p.eval(SWATCHES + '.length'), 22);
    assert.equal(await p.eval(VAR('chrome')), '#141416');
    await p.waitFor(`true`);
    assert.deepEqual([lastPrefs(fx).theme, lastPrefs(fx).themes], ['fleet', []]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('every theme gives the six kinds of group six distinct colours (#25)', () => {
  const KINDS = ['g-fleet', 'g-flotilla', 'g-division', 'g-section', 'g-squadron', 'g-taskforce'];
  assert.ok(ctx.T.themeOklab, 'themeOklab');
  for (const th of FLEET_THEMES){
    const v = themeTokens(th).vars, lab = KINDS.map(k => ctx.T.themeOklab(v[k]));
    assert.equal(v['g-flotilla'], v['t-vm'], th.name);
    assert.equal(v['g-division'], v['t-container'], th.name);
    assert.equal(v['g-squadron'], v['t-compose'], th.name);
    let worst = 99, pair = '';
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++){ const d = Math.hypot(lab[i][0] - lab[j][0], lab[i][1] - lab[j][1], lab[i][2] - lab[j][2]) * 100; if (d < worst){ worst = d; pair = KINDS[i] + '/' + KINDS[j]; } }
    assert.ok(worst >= 10, `${th.name}: ${pair} only ΔE ${worst.toFixed(1)} apart`);
  }
});
