// SPDX-License-Identifier: GPL-3.0-or-later
// A group's kind, name and colour come from what's in it (issue #25): fleet, flotilla, division, section,
// squadron or task force; each kind has its own colour from the theme, and every kind can be pinned.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const TG = {'machines|root': [{id: 'g1', name: 'Lab', ids: ['lx', 'lx2']}], 'machines|lx': [{id: 'g2', name: 'Stuff', ids: ['lx/base', 'lx/containers']}],
  'machines|lx/containers': [{id: 'g3', name: 'Web tier', ids: ['lx/containers/web']}]};
async function open(over = {}){
  const fx = fixture(); fx.fleet.prefs = {tgroups: TG};
  const p = await browser.page(fx, {ui: ui(Object.assign({sel: 'fleet', open: {lx: true, 'lx/containers': true, lx2: false, mac: false, win: false}}, over))});
  await p.waitFor(`document.querySelectorAll('#tree .tgroup').length === 3`);
  return [p, fx];
}

test('the kind comes from the members', async () => {
  const [p] = await open();
  try {
    assert.deepEqual(await p.eval(`[groupKind([{kind: 'machine'}, {kind: 'machine'}]), groupKind([{kind: 'machine', parent: {}}, {kind: 'machine', parent: {}}]), groupKind([{kind: 'container'}]),
      groupKind([{kind: 'cron'}, {kind: 'cron'}]), groupKind([{kind: 'project'}, {kind: 'service'}]), groupKind([{kind: 'machine'}, {kind: 'container'}]),
      groupKind([{kind: 'machine'}, {kind: 'machine', parent: {}}]), groupKind([{kind: 'base'}, {kind: 'group'}]), groupKind([{kind: 'nmachine'}]), groupKind([{kind: 'ncontainer'}]), groupKind([{kind: 'if'}])]`),
      ['fleet', 'flotilla', 'division', 'section', 'squadron', 'taskforce', 'taskforce', 'taskforce', 'fleet', 'division', 'taskforce']);
  } finally { await p.close(); }
});

test('each group shows its kind in its own colour from the theme', async () => {
  const [p] = await open();
  try {
    const gs = await p.eval(`[...document.querySelectorAll('#tree .tgroup')].map(g => ({id: g.dataset.tgroup, kind: g.dataset.kind, name: g.querySelector('.tg-n').textContent, label: g.querySelector('.tg-k').textContent, color: getComputedStyle(g).getPropertyValue('--gc').trim()}))`);
    assert.deepEqual(gs.map(g => [g.id, g.kind, g.name, g.label]), [['g1', 'fleet', 'Lab', 'fleet'], ['g2', 'taskforce', 'Stuff', 'task force'], ['g3', 'division', 'Web tier', 'division']]);
    assert.equal(new Set(gs.map(g => g.color)).size, 3, JSON.stringify(gs.map(g => g.color)));
    assert.ok(gs.every(g => /^#|^rgb/.test(g.color)), 'theme colours');
    // a division is in the theme's container colour, like its members' icons
    assert.equal(await p.eval(`getComputedStyle(document.querySelector('.tgroup[data-tgroup="g3"]')).getPropertyValue('--gc').trim() === getComputedStyle(document.documentElement).getPropertyValue('--t-container').trim()`), true);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('every kind can be pinned: the picker lists them with their kinds, and the group menu pins too', async () => {
  const [p, fx] = await open();
  try {
    await p.eval(`(() => { document.querySelector('[data-addpin]').click(); return true; })()`);
    await p.waitFor(`document.querySelector('#picklist [data-pin="div:g3"]')`);
    assert.deepEqual(await p.eval(`['g1', 'g2', 'g3'].map(g => document.querySelector('#picklist [data-pin="div:' + g + '"] .pk').textContent.split(' · ')[0])`), ['fleet', 'task force', 'division']);
    await p.eval(`(() => { document.querySelector('#picklist [data-pin="div:g3"]').click(); return true; })()`);
    await p.waitFor(`document.querySelector('#spaces [data-space="div:g3"]')`);
    await p.eval(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); return true; })()`);
    await p.eval(`(() => { const h = document.querySelector('.tgroup[data-tgroup="g2"] .tg-h'), r = h.getBoundingClientRect(); h.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 4})); return true; })()`);
    await p.eval(`(() => { [...document.querySelectorAll('#ctxmenu [role=menuitem]')].find(e => e.textContent.trim() === 'Pin as a space').click(); return true; })()`);
    await p.waitFor(`document.querySelector('#spaces [data-space="div:g2"]')`);
    await p.eval(`(() => { document.querySelector('#spaces [data-space="div:g2"]').click(); return true; })()`);
    await p.waitFor(`S.space === 'div:g2' && document.querySelector('#main .hero h1').textContent === 'Stuff'`);
    assert.ok(!(await p.eval(`document.getElementById('main').textContent`)).includes('NaN'));
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('clicking a group\'s header selects it and shows its own all-up view (#49)', async () => {
  const [p] = await open();
  const pick = id => p.eval(`(() => { document.querySelector('.tgroup[data-tgroup="${id}"] .tg-n').click(); return true; })()`);
  try {
    await pick('g1');
    await p.waitFor(`S.sel === 'div:g1' && document.querySelector('#main .hero h1').textContent === 'Lab'`);
    assert.equal(await p.eval(`[...document.querySelectorAll('#main .mrow [data-select]')].map(b => b.dataset.select).join(',')`), 'lx,lx2');
    assert.equal(await p.eval(`document.querySelector('.tgroup[data-tgroup="g1"]').classList.contains('sel')`), true);
    assert.equal(await p.eval(`document.querySelector('#crumbs .cur').textContent`), 'Lab');
    assert.equal(await p.eval(`S.space`), 'fleet');
    await pick('g3');
    await p.waitFor(`S.sel === 'div:g3' && document.querySelector('#main .hero h1').textContent === 'Web tier'`);
    assert.equal(await p.eval(`document.querySelector('.tgroup[data-tgroup="g1"]').classList.contains('sel')`), false);
    assert.ok(!(await p.eval(`document.getElementById('main').textContent`)).includes('NaN'));
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('each kind has its own icon, on its header, its pill, the picker and its page (#54)', async () => {
  const [p] = await open();
  try {
    const kinds = ['fleet', 'flotilla', 'division', 'section', 'squadron', 'taskforce'];
    assert.deepEqual(await p.eval(`${JSON.stringify(kinds)}.map(k => typeof IC['g' + k])`), kinds.map(() => 'string'));
    assert.equal(await p.eval(`new Set(${JSON.stringify(kinds)}.map(k => IC['g' + k])).size`), 6);
    assert.deepEqual(await p.eval(`['g1', 'g2', 'g3'].map(g => iconOf(nodes['div:' + g]))`), ['gfleet', 'gtaskforce', 'gdivision']);
    assert.equal(await p.eval(`!!document.querySelector('.tgroup[data-tgroup="g3"] .tg-h svg[data-icon="gdivision"]')`), true);
    await p.eval(`(() => { document.querySelector('.tgroup[data-tgroup="g1"] .tg-n').click(); return true; })()`);
    await p.waitFor(`S.sel === 'div:g1'`);
    assert.equal(await p.eval(`!!document.querySelector('#main .hero .tile svg[data-icon="gfleet"]')`), true);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

