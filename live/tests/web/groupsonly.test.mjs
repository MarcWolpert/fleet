// SPDX-License-Identifier: GPL-3.0-or-later
// #59: the Fleet button in the machine tree's header shows only your groups and their subgroups (fleets,
// flotillas, divisions, …), as an overview of the group hierarchy, hiding the machines and everything in them.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const BTN = `document.querySelector('#tree-title [data-groupsonly]')`;
// every row in the tree, as id@depth (or the group box headers of the normal tree)
const ROWS = `[...document.querySelectorAll('#tree .row')].map(r => (r.dataset.select || r.dataset.netsel) + '@' + getComputedStyle(r).getPropertyValue('--d').trim())`;
const BOXES = `[...document.querySelectorAll('#tree .tgroup .tg-n')].map(e => e.textContent.trim()).sort()`;
const saved = () => `JSON.parse(localStorage.getItem('fleet-live-ui')).groupsOnly`;

// Groups at three places in the tree: machines at the top (Lab, Home), containers inside a grouped machine (Web
// tier, a subgroup of Lab), containers inside an ungrouped machine (Solo), the Pins only tree's own (Pinned pair),
// and the network tree's (never shown here).
function fx(over = {}){
  const f = fixture();
  f.fleet.machines[0].containers.push({id: 'lx/containers/db', name: 'db', image: 'postgres:16', status: 'Up 2 hours', g: []});
  f.fleet.prefs = {tgroups: Object.assign({
    'machines|root': [{id: 'gA', name: 'Lab', c: 2, ids: ['lx', 'win']}, {id: 'gB', name: 'Home', c: 3, ids: ['mac']}],
    'machines|lx/containers': [{id: 'gC', name: 'Web tier', c: 1, ids: ['lx/containers/web', 'lx/containers/db']}],
    'machines|lx2/containers': [{id: 'gD', name: 'Solo', c: 4, ids: ['lx2/containers/web']}],
    'pins|root': [{id: 'gP', name: 'Pinned pair', c: 5, ids: ['lx2', 'mac']}],
    'network|root': [{id: 'gN', name: 'Net group', c: 6, ids: ['net:m:lx', 'net:m:mac']}]
  }, over)};
  f.fleet.pins = ['lx2', 'mac'];
  return f;
}
async function open(over = {}, f = fx()){
  const p = await browser.page(f, {ui: ui(Object.assign({sel: 'fleet', open: {'lx/containers': true, 'lx2/containers': true}}, over)), height: 900});
  await p.waitFor(`(document.querySelectorAll('#tree .row').length > 0 || document.querySelector('#tree .tempty')) && ${BTN}`);
  return p;
}

test('the Fleet button sits in the tree header, off by default; on, the tree is just the group hierarchy', async () => {
  const p = await open();
  try {
    assert.deepEqual(await p.eval(`(() => { const b = ${BTN}; return {pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label'), tip: b.title, icon: (() => { const t = document.createElement('div'); t.innerHTML = icon('gfleet'); return b.querySelector('svg').innerHTML === t.querySelector('svg').innerHTML; })()}; })()`),
      {pressed: 'false', label: 'Groups only', tip: 'Groups only: show just your groups and subgroups (fleets, flotillas, divisions, …), without the machines in them', icon: true});
    assert.deepEqual(await p.eval(BOXES), ['Home', 'Lab', 'Solo', 'Web tier'], 'before: the normal tree, groups drawn as boxes around their members');
    await p.click('#tree-title [data-groupsonly]');
    assert.equal(await p.eval(`${BTN}.getAttribute('aria-pressed')`), 'true');
    assert.deepEqual(await p.eval(ROWS), ['div:gB@0', 'div:gA@0', 'div:gC@1', 'div:gD@0'], 'Home, Lab › Web tier, Solo: nothing else');
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#tree .row')].map(r => r.querySelector('.nm').textContent + ' · ' + r.querySelector('.tgk').textContent + ' · ' + (r.querySelector('.count') || {}).textContent + (r.querySelector('.tgw') ? ' · ' + r.querySelector('.tgw').textContent : ''))`),
      ['Home · Fleet · 1', 'Lab · Fleet · 2', 'Web tier · Division · 2', 'Solo · Division · 1 · on lab-linux-2']);
    assert.deepEqual(await p.eval(`document.querySelectorAll('#tree .row.machine, #tree .row.container, #tree .row.base, #tree .tgroup').length`), 0);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('it persists across a reload, and turning it off brings the normal tree back as it was', async () => {
  const p = await open();
  try {
    await p.click('#tree-title [data-groupsonly]');
    assert.equal(await p.eval(saved()), true);
    await p.reload();
    await p.waitFor(`document.querySelectorAll('#tree .row').length > 0`);
    assert.deepEqual(await p.eval(ROWS), ['div:gB@0', 'div:gA@0', 'div:gC@1', 'div:gD@0']);
    await p.click('#tree-title [data-groupsonly]');
    assert.equal(await p.eval(saved()), false);
    assert.deepEqual(await p.eval(BOXES), ['Home', 'Lab', 'Solo', 'Web tier']);
    assert.equal(await p.eval(`document.querySelectorAll('#tree .row.machine').length`), 4);
  } finally { await p.close(); }
});

test('a group\'s chevron folds away its subgroups (the same fold as its box in the normal tree)', async () => {
  const p = await open({groupsOnly: true});
  try {
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#tree [data-tgfold]')].map(b => b.dataset.tgfold + ':' + b.getAttribute('aria-expanded'))`), ['gA:true'], 'only Lab has subgroups');
    await p.click('#tree [data-tgfold="gA"]');
    assert.deepEqual(await p.eval(ROWS), ['div:gB@0', 'div:gA@0', 'div:gD@0']);
    assert.deepEqual(await p.eval(`S.gfold`), {gA: true});
    await p.click('#tree [data-tgfold="gA"]');
    assert.deepEqual(await p.eval(ROWS), ['div:gB@0', 'div:gA@0', 'div:gC@1', 'div:gD@0']);
  } finally { await p.close(); }
});

test('selecting a group opens its own view, as before', async () => {
  const p = await open({groupsOnly: true});
  try {
    await p.click('#tree .row[data-select="div:gA"] .nm');
    assert.deepEqual(await p.eval(`({sel: S.selected || S.sel, h1: document.querySelector('#main h1').textContent.trim(), selRow: document.querySelector('#tree .row.sel').dataset.select})`), {sel: 'div:gA', h1: 'Lab', selRow: 'div:gA'});
    await p.click('#tree .row[data-select="div:gC"] .nm');
    assert.deepEqual(await p.eval(`({sel: S.sel, h1: document.querySelector('#main h1').textContent.trim()})`), {sel: 'div:gC', h1: 'Web tier'});
  } finally { await p.close(); }
});

test('with Pins only, it shows the Pins only tree\'s groups and pinned groups (with their subgroups)', async () => {
  const f = fx();
  f.fleet.pins = ['lx2', 'mac', 'div:gA'];
  const p = await open({groupsOnly: true, pinsOnly: true}, f);
  try {
    assert.deepEqual(await p.eval(ROWS), ['div:gA@0', 'div:gC@1', 'div:gP@0']);
    await p.click('#tree-title [data-pinsonly="0"]');
    assert.deepEqual(await p.eval(ROWS), ['div:gA@0', 'div:gC@1', 'div:gB@0', 'div:gD@0'], 'All machines again, still groups only; the pinned Lab goes first, as pinned groups do in the normal tree');
  } finally { await p.close(); }
});

test('no groups yet: it says how to make one', async () => {
  const f = fixture();
  const p = await open({groupsOnly: true}, f);
  try {
    assert.deepEqual(await p.eval(ROWS), []);
    assert.match(await p.eval(`document.querySelector('#tree .tempty').textContent`), /^No groups yet\. Draw a box over two or more items at the same level/);
  } finally { await p.close(); }
});

test('⌘F in the tree finds groups by name, keeping the path to them', async () => {
  const p = await open({groupsOnly: true});
  try {
    await p.eval(`(TF.q = 'web', renderTree(), true)`);
    assert.deepEqual(await p.eval(ROWS), ['div:gA@0', 'div:gC@1']);
    await p.eval(`(TF.q = 'zzz', renderTree(), true)`);
    assert.match(await p.eval(`document.querySelector('#tree .tempty').textContent`), /Nothing in the tree matches/);
  } finally { await p.close(); }
});

test('a box drawn over the rows makes no group here, and the network tree is unchanged', async () => {
  const f = fx();
  const p = await open({groupsOnly: true}, f);
  try {
    await p.eval(`(() => { const a = document.querySelector('#tree .row[data-select="div:gB"]').getBoundingClientRect(), b = document.querySelector('#tree .row[data-select="div:gD"]').getBoundingClientRect();
      const t = document.getElementById('tree'), at = (type, x, y) => (type.startsWith('pointer') ? (type === 'pointerdown' ? t : document) : document).dispatchEvent(new PointerEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1}));
      at('pointerdown', a.left + 40, a.top + 5); at('pointermove', b.left + 70, b.bottom - 3); at('pointerup', b.left + 70, b.bottom - 3); return true; })()`);
    assert.equal((f.posts || []).filter(x => x.path === '/api/prefs').length, 0, 'nothing saved');
    assert.deepEqual(await p.eval(`Object.keys(PREFS.tgroups).sort()`), ['machines|lx/containers', 'machines|lx2/containers', 'machines|root', 'network|root', 'pins|root'], 'no new group');
    assert.deepEqual(await p.eval(ROWS), ['div:gB@0', 'div:gA@0', 'div:gC@1', 'div:gD@0']);
    assert.deepEqual(p.errors, []);
    await p.click('[data-tree="network"]');
    await p.waitFor(`document.getElementById('tree-title').textContent === 'Network'`);
    assert.equal(await p.eval(`!!${BTN}`), false, 'no Fleet button in the network tree');
  } finally { await p.close(); }
});
