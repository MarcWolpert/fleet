// SPDX-License-Identifier: GPL-3.0-or-later
// Divisions: custom groups in the trees (issue #8, named in #23): drag a box over siblings to group them; each group has a coloured
// outline and a name; only items at the same level group; Pins only and the network tree keep their own.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const ROW = id => `document.querySelector('#tree .row[data-select="${id}"]')`;
const NROW = name => `[...document.querySelectorAll('#tree .row[data-netsel]')].find(r => r.textContent.includes(${JSON.stringify(name)}))`;
// press on the first row, drag to the bottom of the last, let go (and the click that follows a drag)
const drag = (p, from, to) => p.eval(`(() => { const a = (${from}).getBoundingClientRect(), b = (${to}).getBoundingClientRect(); const x0 = a.left + 40, y0 = a.top + 5, x1 = b.left + 70, y1 = b.bottom - 4; const t = document.elementFromPoint(x0, y0); const o = (x, y) => ({bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1}); t.dispatchEvent(new PointerEvent('pointerdown', o(x0, y0))); for (let i = 1; i <= 6; i++) document.dispatchEvent(new PointerEvent('pointermove', o(x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6))); document.dispatchEvent(new PointerEvent('pointerup', o(x1, y1))); t.dispatchEvent(new MouseEvent('click', o(x1, y1))); return true; })()`);
const GROUPS = `[...document.querySelectorAll('#tree .tgroup')].map(g => ({name: g.querySelector('.tg-n').textContent.trim(), rows: [...g.querySelectorAll('.row')].map(r => r.dataset.select || r.dataset.netsel)}))`;
const ORDER = `[...document.querySelectorAll('#tree .row[data-select]')].map(r => r.dataset.select)`;
const saved = fx => { const ps = (fx.posts || []).filter(x => x.path === '/api/prefs'); return ps.length ? JSON.parse(ps[ps.length - 1].body).tgroups : undefined; };
const CLOSED = {lx: false, lx2: false, mac: false, win: false};
async function open(over, fx = fixture()){
  const p = await browser.page(fx, {ui: ui(over), height: 900});
  await p.waitFor(`document.querySelectorAll('#tree .row').length > 0`);
  return p;
}

test('a box over 3 of 4 machines groups exactly those 3, outlined, and saves it; the drag selects nothing', async () => {
  const fx = fixture();
  const p = await open({sel: 'fleet', open: CLOSED}, fx);
  try {
    await drag(p, ROW('lx'), ROW('mac'));
    await p.waitFor(`document.querySelector('#tree .tgroup')`);
    assert.deepEqual(await p.eval(GROUPS), [{name: 'Fleet 1', rows: ['lx', 'lx2', 'mac']}]);
    assert.deepEqual(await p.eval(ORDER), ['lx', 'lx2', 'mac', 'win']);
    assert.notEqual(await p.eval(`getComputedStyle(document.querySelector('#tree .tgroup')).getPropertyValue('--gc').trim()`), '');
    assert.equal(await p.eval(`S.sel`), 'fleet');
    const g = saved(fx)['machines|root'];
    assert.equal(g.length, 1);
    assert.deepEqual(g[0].ids, ['lx', 'lx2', 'mac']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a box across two levels groups nothing and says why', async () => {
  const fx = fixture();
  const p = await open({sel: 'fleet', open: Object.assign({}, CLOSED, {lx: true})}, fx);
  try {
    await drag(p, ROW('lx'), ROW('lx/base'));
    await p.waitFor(`(document.getElementById('toast') || {}).textContent`);
    assert.match(await p.eval(`document.getElementById('toast').textContent`), /same level/);
    assert.deepEqual(await p.eval(GROUPS), []);
    assert.equal(saved(fx), undefined);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('groups the server has are drawn at load (they survive restarts), members together where the first one sits', async () => {
  const fx = fixture();
  fx.fleet.prefs = {tgroups: {'machines|root': [{id: 'g1', name: 'Lab', c: 2, ids: ['lx', 'win']}]}};
  const p = await open({sel: 'fleet', open: CLOSED}, fx);
  try {
    await p.waitFor(`document.querySelector('#tree .tgroup')`);
    assert.deepEqual(await p.eval(GROUPS), [{name: 'Lab', rows: ['lx', 'win']}]);
    assert.deepEqual(await p.eval(ORDER), ['lx', 'win', 'lx2', 'mac']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Pins only keeps its own groups, and any pins can be grouped', async () => {
  const fx = fixture(); fx.fleet.pins = ['lx', 'mac', 'win'];
  const p = await open({sel: 'fleet', pinsOnly: true, open: CLOSED}, fx);
  try {
    await drag(p, ROW('mac'), ROW('win'));
    await p.waitFor(`document.querySelector('#tree .tgroup')`);
    assert.deepEqual(await p.eval(GROUPS), [{name: 'Fleet 1', rows: ['mac', 'win']}]);
    assert.deepEqual(Object.keys(saved(fx)), ['pins|root']);
    await p.eval(`(() => { document.querySelector('[data-pinsonly="0"]').click(); return true; })()`);
    await p.waitFor(`${ORDER}.length === 4`);
    assert.deepEqual(await p.eval(GROUPS), []);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a group\'s right-click menu renames it, pins it, and disbands it', async () => {
  const fx = fixture();
  fx.fleet.prefs = {tgroups: {'machines|root': [{id: 'g1', name: 'Fleet 1', c: 0, ids: ['lx', 'lx2']}]}};
  const p = await open({sel: 'fleet', open: CLOSED}, fx);
  const menu = () => p.eval(`(() => { const h = document.querySelector('#tree .tg-h'), r = h.getBoundingClientRect(); h.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 5})); return [...document.querySelectorAll('#ctxmenu [role=menuitem]')].map(e => e.textContent.trim()); })()`);
  const pick = label => p.eval(`(() => { [...document.querySelectorAll('#ctxmenu [role=menuitem]')].find(e => e.textContent.trim() === ${JSON.stringify(label)}).click(); return true; })()`);
  try {
    await p.waitFor(`document.querySelector('#tree .tg-h')`);
    assert.deepEqual(await menu(), ['Rename', 'Pin as a space', 'Disband fleet']);
    await pick('Rename');
    await p.waitFor(`document.activeElement && document.activeElement.classList.contains('tg-name')`);
    await p.eval(`(() => { const i = document.activeElement; i.value = 'Media boxes'; i.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); return true; })()`);
    await p.waitFor(`${GROUPS}[0] && ${GROUPS}[0].name === 'Media boxes'`);
    assert.equal(saved(fx)['machines|root'][0].name, 'Media boxes');
    await menu(); await pick('Disband fleet');
    await p.waitFor(`!document.querySelector('#tree .tgroup')`);
    assert.deepEqual(saved(fx)['machines|root'], []);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the network tree groups its machines the same way', async () => {
  const fx = fixture();
  const nm = (id, name) => ({id, name, status: 'ok', ts: {ip: '100.64.0.' + id.length, online: true, direct: true}, ifs: []});
  fx.net = {tailnet: 'tailnet', machines: [nm('lx', 'lab-linux'), nm('lx2', 'lab-linux-2'), nm('mac', 'lab-mac')]};
  const p = await open({tree: 'network', netSel: 'net:tailnet'}, fx);
  try {
    await p.waitFor(`${NROW('lab-mac')}`);
    await drag(p, NROW('lab-linux'), NROW('lab-linux-2'));
    await p.waitFor(`document.querySelector('#tree .tgroup')`);
    const g = await p.eval(GROUPS);
    assert.equal(g.length, 1);
    assert.equal(g[0].rows.length, 2);
    assert.deepEqual(Object.keys(saved(fx)), ['network|net:tailnet']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
