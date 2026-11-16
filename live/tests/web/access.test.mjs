// SPDX-License-Identifier: GPL-3.0-or-later
// Colour vision (#219) and higher contrast (#220), in Settings › Appearance.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {launch, WEB} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

// themes.js on its own, as the page loads it
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(WEB, 'themes.js'), 'utf8') + '\n;globalThis.T = {FLEET_THEMES, GROUP_KEYS, themeTokens, themeAccess, themeContrast, CVD_SAFE, CVD_MONO};', ctx);
const plain = x => JSON.parse(JSON.stringify(x));
const {FLEET_THEMES, themeContrast} = ctx.T, GROUP_KEYS = plain(ctx.T.GROUP_KEYS);

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

// Machado, Oliveira & Fernandes (2009), severity 1.0, applied to linear RGB; OKLab ΔE ×100 between the results
const M = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
  none: [[1, 0, 0], [0, 1, 0], [0, 0, 1]]};
const lin = v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
function oklab([r, g, b]){
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
    s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function seen(hex, kind){
  const c = [1, 3, 5].map(i => lin(parseInt(hex.slice(i, i + 2), 16))), m = M[kind];
  return oklab(m.map(row => Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2]))));
}
const dE = (a, b, kind) => { const p = seen(a, kind), q = seen(b, kind); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100; };
function worst(hexes, kind){ let w = Infinity; for (let i = 0; i < hexes.length; i++) for (let j = i + 1; j < hexes.length; j++) w = Math.min(w, dE(hexes[i], hexes[j], kind)); return w; }

const VARS = keys => `(() => { const cs = getComputedStyle(document.documentElement); return ${JSON.stringify(keys)}.map(k => cs.getPropertyValue('--' + k).trim()); })()`;
const openAppearance = async p => { await p.eval(`(openSettings(), true)`); await p.waitFor(`document.querySelector('#sheet [data-cvd]')`); };

test('colour vision: each kind swaps in colours that stay apart for it, statuses change shape, and it is saved', async () => {
  const fx = fixture();
  const p = await browser.page(fx, {ui: ui({sel: 'fleet'})});
  try {
    await p.waitFor(`document.querySelector('#tree .row')`);
    await openAppearance(p);
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#sheet [data-cvd] option')].map(o => o.value)`), ['', 'protan', 'deutan', 'tritan', 'mono']);
    for (const kind of ['protan', 'deutan', 'tritan']){
      await p.eval(`(() => { const s = document.querySelector('#sheet [data-cvd]'); s.value = ${JSON.stringify(kind)}; s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
      await p.waitFor(`document.documentElement.dataset.cvd === ${JSON.stringify(kind)}`);
      const [base, compose, container, vm, run, warn, stale] = await p.eval(VARS(['t-base', 't-compose', 't-container', 't-vm', 'run', 'warn', 'stale']));
      assert.ok(worst([base, compose, container, vm], kind) >= 8, `${kind}: the four workload types stay apart (${worst([base, compose, container, vm], kind).toFixed(1)})`);
      assert.ok(worst([run, warn, stale], kind) >= 8, `${kind}: live, offline and stale stay apart`);
      assert.ok(worst([compose, container, vm], 'none') >= 15, 'and apart for typical vision too');
    }
    // statuses don't rely on colour alone
    assert.notEqual(await p.eval(`(() => { const d = document.createElement('i'); d.className = 'sdot offline'; document.body.appendChild(d); const r = getComputedStyle(d).borderRadius; d.remove(); return r; })()`), '50%');
    const last = JSON.parse((fx.posts || []).filter(x => x.path === '/api/prefs').pop().body);
    assert.equal(last.cvd, 'tritan');
    await p.eval(`(() => { const s = document.querySelector('#sheet [data-cvd]'); s.value = 'mono'; s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
    await p.waitFor(`document.documentElement.dataset.cvd === 'mono'`);
    const greys = await p.eval(VARS(['t-base', 't-compose', 't-container', 't-vm']));
    assert.ok(worst(greys, 'none') >= 8, 'monochromacy: four shades apart by lightness');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('higher contrast: the faintest text is 7:1 or more on a dark and a light theme; it and colour vision survive a reload', async () => {
  for (const theme of ['fleet', 'catppuccin-latte']){
    const fx = fixture(); fx.fleet.prefs = {theme};
    const p = await browser.page(fx, {ui: ui({sel: 'fleet'})});
    try {
      await p.waitFor(`document.querySelector('#tree .row')`);
      await openAppearance(p);
      await p.eval(`(() => { const c = document.querySelector('#sheet [data-hc]'); c.click(); return true; })()`);
      await p.waitFor(`document.documentElement.classList.contains('hc')`);
      const [ink, ink2, ink3, win] = await p.eval(VARS(['ink', 'ink-2', 'ink-3', 'win']));
      assert.equal(ink2, ink, 'secondary text as strong as body text');
      assert.ok(await p.eval(`themeContrast(${JSON.stringify(ink3)}, ${JSON.stringify(win)})`) >= 7, `${theme}: faintest text ≥ 7:1`);
      assert.equal(JSON.parse((fx.posts || []).filter(x => x.path === '/api/prefs').pop().body).contrast, true);
    } finally { await p.close(); }
  }
  const fx = fixture(); fx.fleet.prefs = {contrast: true, cvd: 'deutan'};
  const p = await browser.page(fx, {ui: ui({sel: 'fleet'})});
  try {
    await p.waitFor(`document.documentElement.classList.contains('hc') && document.documentElement.dataset.cvd === 'deutan'`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

// The colour-vision colours sit on the theme's own surfaces: statuses are the text of the offline, auth and dns pills,
// group colours are a desktop tile's glyph and a group's outline in the tree. Each keeps the 3:1 that status colours get
// with the mode off (and that non-text UI needs) on the cards, the main view and the side bar, on every built-in theme,
// dark and light, and the colours still stay apart for the reader they're for.
test('colour vision keeps statuses and group colours at 3:1 on every theme\'s surfaces, and still apart (#219)', () => {
  const STATUS = ['run', 'warn', 'stale'], SERIES = ['t-base', 't-compose', 't-container', 't-vm'];
  assert.ok(FLEET_THEMES.some(t => !t.dark) && FLEET_THEMES.some(t => t.dark), 'light and dark themes both checked');
  for (const th of FLEET_THEMES) for (const kind of ['protan', 'deutan', 'tritan', 'mono']){
    const off = plain(ctx.T.themeTokens(th)), v = plain(ctx.T.themeAccess(ctx.T.themeTokens(th), {cvd: kind})).vars;
    const pal = plain((kind === 'mono' ? ctx.T.CVD_MONO : ctx.T.CVD_SAFE)[off.dark ? 'dark' : 'light']), name = `${th.name}, ${kind}`;
    for (const k of [...STATUS, ...GROUP_KEYS]) for (const s of ['card', 'win', 'side'])
      assert.ok(themeContrast(v[k], v[s]) >= 3, `${name}: ${k} ${v[k]} on ${s} ${v[s]} is ${themeContrast(v[k], v[s]).toFixed(2)}:1`);
    // only the mode's own colours change, and a colour of the checked palette that already reads is kept as it is
    // (monochromacy's group greys close up instead, and keep their order)
    for (const k of Object.keys(v)) if (!(k in pal)) assert.equal(v[k], off.vars[k], `${name}: ${k} is the theme's`);
    for (const [k, x] of Object.entries(pal)) if (!(kind === 'mono' && GROUP_KEYS.includes(k)) && ['card', 'win', 'side'].every(s => themeContrast(x, v[s]) >= 3))
      assert.equal(v[k], x, `${name}: ${k} kept`);
    const byL = xs => GROUP_KEYS.slice().sort((a, b) => seen(xs[a], 'none')[0] - seen(xs[b], 'none')[0]);
    if (kind === 'mono') assert.deepEqual(byL(v), byL(pal), `${name}: the group greys keep their order`);
    const view = kind === 'mono' ? 'none' : kind, at = ks => ks.map(k => v[k]);
    assert.ok(worst(at(STATUS), view) >= 8, `${name}: live, offline and stale stay apart (${worst(at(STATUS), view).toFixed(1)})`);
    assert.ok(worst(at(SERIES), view) >= 8, `${name}: the four workload types stay apart`);
    // six greys between 3:1 and white leave about 7 between neighbours on the lightest dark cards (Nord's)
    const gmin = kind === 'mono' ? 5 : 8;
    assert.ok(worst(at(GROUP_KEYS), view) >= gmin, `${name}: the six kinds of group stay apart (${worst(at(GROUP_KEYS), view).toFixed(1)})`);
  }
});
