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

test('one click folds a group to its header; another brings it back exactly as it was (#53)', async () => {
  const fx = fixture();
  fx.fleet.prefs = {tgroups: {'machines|root': [{id: 'g1', name: 'Lab', ids: ['lx', 'lx2']}]}};
  const p = await open({sel: 'fleet', open: Object.assign({}, CLOSED, {lx: true})}, fx);
  const ROWS = `[...document.querySelectorAll('#tree .tgroup[data-tgroup="g1"] .row')].map(r => r.dataset.select)`;
  try {
    await p.waitFor(`document.querySelector('.tgroup[data-tgroup="g1"] [data-tgfold]')`);
    const before = await p.eval(ROWS);
    assert.deepEqual(before.slice(0, 2), ['lx', 'lx/base']);
    await p.eval(`(() => { document.querySelector('.tgroup[data-tgroup="g1"] [data-tgfold]').click(); return true; })()`);
    await p.waitFor(`${ROWS}.length === 0`);
    assert.equal(await p.eval(`document.querySelector('.tgroup[data-tgroup="g1"] [data-tgfold]').getAttribute('aria-expanded')`), 'false');
    assert.match(await p.eval(`document.querySelector('.tgroup[data-tgroup="g1"] .tg-h').textContent`), /2/);
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#tree .row')].map(r => r.dataset.select)`), ['mac', 'win']);   // the rest of the tree as it was
    assert.equal(await p.eval(`S.sel`), 'fleet');
    await p.eval(`(() => { document.querySelector('.tgroup[data-tgroup="g1"] [data-tgfold]').click(); return true; })()`);
    await p.waitFor(`${ROWS}.length > 0`);
    assert.deepEqual(await p.eval(ROWS), before);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

// Renaming a group survives the tree being redrawn while you type: a poll that brings other rows (the network tree's,
// or a new node in the machine tree) leaves the name field, what's in it and its focus alone, so the rest of the name
// is typed into it, not read as shortcuts ('p' pins, '/' finds). The redraw happens once the name is in (#293).
const typeKeys = async (p, text) => { for (const c of text){ await p.send('Input.dispatchKeyEvent', {type: 'keyDown', key: c, text: c}); await p.send('Input.dispatchKeyEvent', {type: 'keyUp', key: c}); } };
const NAMEBOX = `(() => { const i = document.querySelector('#tree input.tg-name'); return i ? {value: i.value, focused: document.activeElement === i} : null; })()`;
const dblHeader = p => p.eval(`(() => { const h = document.querySelector('#tree .tg-h'); h.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, cancelable: true})); return true; })()`);
test('renaming a group in the network tree survives a poll that brings other rows', async () => {
  const fx = fixture();
  const nm = (id, name) => ({id, name, status: 'ok', ts: {ip: '100.64.0.' + id.length, online: true, direct: true}, ifs: []});
  fx.net = {tailnet: 'tailnet', machines: [nm('lx', 'lab-linux'), nm('lx2', 'lab-linux-2'), nm('mac', 'lab-mac')]};
  fx.fleet.prefs = {tgroups: {'network|net:tailnet': [{id: 'gn', name: 'Linux', ids: ['net:m:lx', 'net:m:lx2']}]}};
  const p = await open({tree: 'network', netSel: 'net:tailnet'}, fx);
  try {
    await p.waitFor(`${NROW('lab-mac')} && document.querySelector('#tree .tg-h')`);
    await dblHeader(p);
    await p.waitFor(`document.activeElement && document.activeElement.classList.contains('tg-name')`);
    await p.eval(`(document.activeElement.select(), true)`);
    await typeKeys(p, 'Proxmox h');
    await p.waitFor(`!netBusy && (refreshNet(), true)`);   // the same rows: only the rates (#157)
    await p.waitFor(`!netBusy`);
    assert.deepEqual(await p.eval(NAMEBOX), {value: 'Proxmox h', focused: true});
    fx.net.machines.push(nm('win', 'lab-windows'));
    await p.waitFor(`(refreshNet(), NET.machines.length === 4)`);
    await p.waitFor(`!netBusy`);
    assert.deepEqual(await p.eval(NAMEBOX), {value: 'Proxmox h', focused: true});
    await typeKeys(p, 'osts/p');
    assert.deepEqual(await p.eval(NAMEBOX), {value: 'Proxmox hosts/p', focused: true});
    await p.key('Enter');
    await p.waitFor(`${NROW('lab-windows')} && !document.querySelector('#tree input.tg-name')`);
    assert.deepEqual(await p.eval(GROUPS), [{name: 'Proxmox hosts/p', rows: ['net:m:lx', 'net:m:lx2']}]);
    assert.equal(saved(fx)['network|net:tailnet'][0].name, 'Proxmox hosts/p');
    assert.deepEqual(await p.eval(`({pins: PINS, find: !!(document.getElementById('treefind') && !document.getElementById('treefind').hidden), mfind: TF.open || false})`), {pins: [], find: false, mfind: false});
    assert.deepEqual((fx.posts || []).filter(x => x.path === '/api/pins'), []);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('renaming a group in the machine tree survives a poll that brings a new node', async () => {
  const fx = fixture();
  fx.fleet.prefs = {tgroups: {'machines|root': [{id: 'g1', name: 'Lab', ids: ['lx', 'lx2']}]}};
  const p = await open({sel: 'win', open: Object.assign({}, CLOSED, {mac: true, 'mac/containers': true})}, fx);
  try {
    await p.waitFor(`${ROW('mac/containers/web')} && document.querySelector('#tree .tg-h')`);
    await dblHeader(p);
    await p.waitFor(`document.activeElement && document.activeElement.classList.contains('tg-name')`);
    await p.eval(`(document.activeElement.select(), true)`);
    await typeKeys(p, 'Proxmox h');
    const mac = fx.fleet.machines.find(m => m.id === 'mac');
    mac.containers = mac.containers.concat([{id: 'mac/containers/db', name: 'db', image: 'postgres:1', status: 'Up 2 hours', g: []}]);
    await p.waitFor(`(refreshNow(), !!nodes['mac/containers/db'])`);
    await p.waitFor(`!busy`);
    assert.deepEqual(await p.eval(NAMEBOX), {value: 'Proxmox h', focused: true});
    await typeKeys(p, 'osts/p');
    assert.deepEqual(await p.eval(NAMEBOX), {value: 'Proxmox hosts/p', focused: true});
    await p.key('Enter');
    await p.waitFor(`${ROW('mac/containers/db')} && !document.querySelector('#tree input.tg-name')`);
    assert.deepEqual(await p.eval(GROUPS), [{name: 'Proxmox hosts/p', rows: ['lx', 'lx2']}]);
    assert.equal(saved(fx)['machines|root'][0].name, 'Proxmox hosts/p');
    assert.deepEqual(await p.eval(`({pins: PINS, sel: S.sel, tf: !!TF.open})`), {pins: [], sel: 'win', tf: false});
    assert.deepEqual((fx.posts || []).filter(x => x.path === '/api/pins'), []);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

// The box groups what you can see: rows scrolled out of the tree's view (above or below it) stay out of it, even when
// the box is dragged past the tree's edge into the title above. A hidden row at another level doesn't refuse the
// box, and a hidden sibling doesn't join (#293).
const cloneMachine = (m, id, name) => Object.assign(JSON.parse(JSON.stringify(m).split('"' + m.id + '/').join('"' + id + '/').split('"' + m.id + '"').join('"' + id + '"')), {name});
function manyMachines(){
  const fx = fixture(), lx2 = fx.fleet.machines.find(m => m.id === 'lx2');
  for (let i = 3; i <= 12; i++) fx.fleet.machines.push(cloneMachine(lx2, 'lab' + i, 'lab-' + String(i).padStart(2, '0')));
  return fx;
}
const allClosed = fx => Object.fromEntries(fx.fleet.machines.map(m => [m.id, false]));
// press in a row, drag straight up to y, let go (and the click that follows a drag)
const dragUpTo = (p, from, y1) => p.eval(`(() => { const a = (${from}).getBoundingClientRect(); const x0 = a.left + 40, y0 = a.top + a.height / 2; const t = document.elementFromPoint(x0, y0); const o = (x, y) => ({bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1}); t.dispatchEvent(new PointerEvent('pointerdown', o(x0, y0))); for (let i = 1; i <= 6; i++) document.dispatchEvent(new PointerEvent('pointermove', o(x0 + 10 * i, y0 + (${y1} - y0) * i / 6))); document.dispatchEvent(new PointerEvent('pointerup', o(x0 + 60, ${y1}))); t.dispatchEvent(new MouseEvent('click', o(x0 + 60, ${y1}))); return true; })()`);
const VISIBLE = `(() => { const t = document.getElementById('tree').getBoundingClientRect(); return [...document.querySelectorAll('#tree .row[data-select]')].filter(r => { const b = r.getBoundingClientRect(); return Math.min(b.bottom, t.bottom) - Math.max(b.top, t.top) >= b.height / 2; }).map(r => r.dataset.select); })()`;
for (const [name, open] of [
  ['hidden siblings above stay out of it', {}],
  ['a hidden row at another level does not refuse it', {lab3: true}]])
  test(`a box dragged past the top of a scrolled tree groups only the rows you can see: ${name}`, async () => {
    const fx = manyMachines();
    const p = await browser.page(fx, {ui: ui({sel: 'fleet', open: Object.assign(allClosed(fx), open)}), height: 600});
    try {
      await p.waitFor(`document.querySelectorAll('#tree .row').length > 10`);
      await p.eval(`(() => { const t = document.getElementById('tree'); t.scrollTop = 98; return true; })()`);
      const seen = await p.eval(VISIBLE), top3 = seen.slice(0, 3);
      assert.equal(await p.eval(`document.getElementById('tree').scrollTop`), 98);   // three rows (and the tree's padding) out of view
      assert.deepEqual(top3, open.lab3 ? ['lab4', 'lab5', 'lab6'] : ['lab6', 'lab7', 'lab8']);
      const titleTop = await p.eval(`document.getElementById('tree-title').getBoundingClientRect().top`);
      await dragUpTo(p, ROW(top3[2]), titleTop - 25);   // about 90 px above the tree's top: three hidden rows' worth
      await p.waitFor(`document.querySelector('#tree .tgroup') || (document.getElementById('toast') || {}).textContent`);
      assert.equal(await p.eval(`(document.getElementById('toast') || {}).textContent || ''`), '');
      assert.deepEqual(saved(fx)['machines|root'].map(g => g.ids), [top3]);
      assert.deepEqual(Object.keys(saved(fx)), ['machines|root']);
      assert.deepEqual(await p.eval(`[...document.querySelectorAll('#tree .tgroup .row')].map(r => r.dataset.select)`), top3);
      assert.equal(await p.eval(`S.sel`), 'fleet');
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  });
