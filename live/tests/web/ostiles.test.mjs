// SPDX-License-Identifier: GPL-3.0-or-later
// Machine tiles show the OS at a glance (#214, icon set #23 "side tag split"): a strip down the right in the OS colour
// with its glyph, the kind icon moved left; everywhere a machine has a tile. No known OS, the plain tile.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const OS = sel => `[...document.querySelectorAll(${JSON.stringify(sel)})].map(e => e.dataset.os || '')`;

test('the tree, the space bar, the machine page and All machines show each machine\'s OS', async () => {
  const fx = fixture(); fx.fleet.pins = ['win'];
  fx.fleet.machines.find(m => m.id === 'lx2').os = 'Unraid 7.3.2 · x86_64';
  fx.fleet.machines.find(m => m.id === 'lx').vms = [{id: 'lx/vms/seen', name: 'seen', tile: 'vm', status: 'ok', os: 'VM', agent: 'seen from the host', cap: [1, 1, 0, 1, 1],
    gpus: [], cronLabel: 'Cron jobs', base: {id: 'lx/vms/seen/base'}, baseCron: [], compose: [], containers: [], vms: []}];
  const p = await browser.page(fx, {ui: ui({sel: 'fleet', open: {lx: true, 'lx/vms': true}})});
  try {
    await p.waitFor(`document.querySelector('#tree .row[data-select="lx/vms/seen"]') && document.querySelector('.mrow')`);
    // the tree keeps its line icons, with the OS tag beside the kind icon
    assert.deepEqual(await p.eval(`['lx', 'lx2', 'win', 'mac', 'lx/vms/seen'].map(id => (document.querySelector('#tree .row[data-select="' + id + '"] [data-os]') || {dataset: {}}).dataset.os || '')`),
      ['linux', 'linux', 'windows', 'macos', '']);
    assert.equal(await p.eval(`getComputedStyle(document.querySelector('#tree .row[data-select="lx"] .osico')).backgroundColor`), 'rgba(0, 0, 0, 0)', 'no block behind it');
    assert.deepEqual(await p.eval(OS('.space .tile')), ['', 'windows'], 'All machines, then the pinned Windows machine');
    assert.deepEqual((await p.eval(OS('.mrow .tile'))).sort(), ['linux', 'linux', 'macos', 'windows']);
    // tiles take their colours from the theme
    assert.match(await p.eval(`getComputedStyle(document.querySelector('.mrow .tile')).backgroundColor`), /\/ 0\.2\)$/, 'a 20% tint of the kind\'s theme colour');
    // the strip in the OS colour, with its glyph; the kind icon stays
    assert.equal(await p.eval(`document.querySelector('.mrow .tile[data-os="windows"] .os-strip').getAttribute('fill')`), 'var(--os-windows)');
    assert.equal(await p.eval(`!!document.querySelector('.mrow .tile[data-os="windows"] .os-glyph') && !!document.querySelector('.mrow .tile[data-os="windows"] .kind-icon')`), true);
    // the OS strip sits right of the kind icon, in the tree and in tiles
    const LEFT = sel => `(() => { const e = document.querySelector(${JSON.stringify(sel)}), st = e.querySelector('.os-strip').getBoundingClientRect(), ic = e.querySelector('.kind-icon').getBoundingClientRect(); return st.left >= ic.right - 0.5; })()`;
    assert.equal(await p.eval(LEFT('#tree .row[data-select="lx"] .osico')), true, 'tree');
    assert.equal(await p.eval(LEFT('.mrow .tile[data-os="windows"]')), true, 'tile');
    await p.eval(`(document.querySelector('#tree .row[data-select="mac"] .nm').click(), true)`);
    await p.waitFor(`document.querySelector('.hero .tile[data-os="macos"]')`);
    // the drawing fills its tile at every size (#222): the 46 px machine page tile, a pill, a row
    const FILL = sel => `(() => { const t = document.querySelector(${JSON.stringify(sel)}), a = t.getBoundingClientRect(), b = t.querySelector('svg').getBoundingClientRect(); return [Math.round(a.width), Math.round(b.width), Math.round(a.height), Math.round(b.height)]; })()`;
    for (const sel of ['.hero .tile.ostile', '.space .tile.ostile']){ const [tw, sw, th, sh] = await p.eval(FILL(sel)); assert.ok(tw > 20 && sw === tw && sh === th, `${sel}: ${tw}x${th} tile, ${sw}x${sh} drawing`); }
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Settings: each machine\'s card shows its OS, and changing the OS changes the tile', async () => {
  const fx = fixture();
  fx.config = {path: '/dev/null', interval: 3, terminals: [], status: {}, machines: [
    {id: 'lx', name: 'lab-linux', ssh: 'lx', os: 'linux', tile: 'server'}, {id: 'win', name: 'lab-windows', ssh: 'win', os: 'windows', tile: 'desktop'}]};
  const p = await browser.page(fx, {ui: ui({sel: 'fleet'})});
  try {
    await p.waitFor(`document.querySelector('#tree .row')`);
    await p.eval(`(openSettings(), true)`);
    await p.waitFor(`document.querySelectorAll('.mcard-h .tile').length === 2`);
    assert.deepEqual(await p.eval(OS('.mcard-h .tile')), ['linux', 'windows']);
    await p.eval(`(() => { const c = document.querySelector('[data-togglecard="0"]'); if (c.getAttribute('aria-expanded') !== 'true') c.click(); return true; })()`);
    await p.waitFor(`document.querySelector('[data-field="0:os"]')`);
    await p.eval(`(() => { const s = document.querySelector('[data-field="0:os"]'); s.value = 'macos'; s.dispatchEvent(new Event('change', {bubbles: true})); s.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
    await p.waitFor(`document.querySelector('.mcard-h .tile').dataset.os === 'macos'`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
