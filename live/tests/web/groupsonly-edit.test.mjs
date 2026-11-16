// SPDX-License-Identifier: GPL-3.0-or-later
// Groups only (#59), continued (#84): a group's right-click menu renames and disbands it there too, and any
// group without subgroups expands to show what's in it, and folds back.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const ROWS = `[...document.querySelectorAll('#tree .row')].map(r => r.dataset.select + '@' + getComputedStyle(r).getPropertyValue('--d').trim())`;
function fx(){
  const f = fixture();
  f.fleet.machines[0].containers.push({id: 'lx/containers/db', name: 'db', image: 'postgres:16', status: 'Up 2 hours', g: []});
  f.fleet.prefs = {tgroups: {'machines|root': [{id: 'gA', name: 'Lab', ids: ['lx', 'win']}], 'machines|lx/containers': [{id: 'gC', name: 'Web tier', ids: ['lx/containers/web', 'lx/containers/db']}]}};
  return f;
}
async function open(f = fx()){
  const p = await browser.page(f, {ui: ui({sel: 'fleet', groupsOnly: true}), height: 900});
  await p.waitFor(`document.querySelector('#tree .row[data-select="div:gC"]')`);
  return p;
}
const menu = (p, id) => p.eval(`(() => { const r = document.querySelector('#tree .row[data-select="${id}"]'), b = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: b.left + 60, clientY: b.top + 5})); return [...document.querySelectorAll('#ctxmenu [role=menuitem]')].map(e => e.textContent.trim()); })()`);
const pick = (p, label) => p.eval(`(() => { [...document.querySelectorAll('#ctxmenu [role=menuitem]')].find(e => e.textContent.trim() === ${JSON.stringify(label)}).click(); return true; })()`);
const saved = f => { const ps = (f.posts || []).filter(x => x.path === '/api/prefs'); return ps.length ? JSON.parse(ps[ps.length - 1].body).tgroups : null; };

test('a group\'s menu in Groups only renames it in place and disbands it', async () => {
  const f = fx(); const p = await open(f);
  try {
    const items = await menu(p, 'div:gC');
    assert.ok(items.includes('Rename') && items.includes('Disband division'), JSON.stringify(items));
    await pick(p, 'Rename');
    await p.waitFor(`document.activeElement && document.activeElement.classList.contains('tg-name')`);
    await p.eval(`(() => { const i = document.activeElement; i.value = 'Storefront'; i.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); return true; })()`);
    await p.waitFor(`document.querySelector('#tree .row[data-select="div:gC"] .nm').textContent === 'Storefront'`);
    assert.equal(saved(f)['machines|lx/containers'][0].name, 'Storefront');
    await menu(p, 'div:gA'); await pick(p, 'Disband fleet');
    await p.waitFor(`!document.querySelector('#tree .row[data-select="div:gA"]')`);
    assert.deepEqual(saved(f)['machines|root'], []);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a group without subgroups expands to show what\'s in it, and folds back', async () => {
  const p = await open();
  try {
    assert.deepEqual(await p.eval(ROWS), ['div:gA@0', 'div:gC@1']);
    const chev = `document.querySelector('#tree .row[data-select="div:gC"] [data-tgfold]')`;
    assert.equal(await p.eval(`${chev}.getAttribute('aria-expanded')`), 'false');
    await p.eval(`(${chev}.click(), true)`);
    await p.waitFor(`${ROWS}.length === 4`);
    assert.deepEqual(await p.eval(ROWS), ['div:gA@0', 'div:gC@1', 'lx/containers/db@2', 'lx/containers/web@2']);
    // a member opens like any row
    await p.eval(`(() => { document.querySelector('#tree .row[data-select="lx/containers/web"] .nm').click(); return true; })()`);
    await p.waitFor(`S.sel === 'lx/containers/web'`);
    await p.eval(`(${chev}.click(), true)`);
    await p.waitFor(`${ROWS}.length === 2`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
