// SPDX-License-Identifier: GPL-3.0-or-later
// Pinning a division as a space (issue #24).
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const DIVS = {'machines|root': [{id: 'g1', name: 'Lab', c: 2, ids: ['lx', 'lx2']}], 'machines|lx': [{id: 'g2', name: 'Workloads', c: 4, ids: ['lx/base', 'lx/containers']}]};
function fx2(pins = []){ const fx = fixture(); fx.fleet.prefs = {tgroups: DIVS}; fx.fleet.pins = pins; return fx; }
async function open(fx, over = {}){
  const p = await browser.page(fx, {ui: ui(Object.assign({sel: 'fleet'}, over))});
  await p.waitFor(`document.querySelectorAll('#tree .row').length > 0 && document.querySelector('#main .hero')`);
  return p;
}

test('the + picker lists divisions first, and pins one to the space bar', async () => {
  const fx = fx2();
  const p = await open(fx);
  try {
    await p.eval(`(() => { document.querySelector('[data-addpin]').click(); return true; })()`);
    await p.waitFor(`document.querySelector('#picklist [data-pin]')`);
    const first = await p.eval(`[...document.querySelectorAll('#picklist [data-pin]')].slice(0, 2).map(b => b.dataset.pin)`);
    assert.deepEqual(first, ['div:g1', 'div:g2']);
    assert.match(await p.eval(`document.querySelector('#picklist').textContent`), /Divisions/);
    await p.eval(`(() => { document.querySelector('#picklist [data-pin="div:g1"]').click(); return true; })()`);
    await p.waitFor(`document.querySelector('#spaces [data-space="div:g1"]')`);
    assert.deepEqual(JSON.parse(fx.posts.filter(x => x.path === '/api/pins').pop().body), ['div:g1']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a division of machines: its space shows it and its members, and its usage like All machines', async () => {
  const p = await open(fx2(['div:g1']));
  try {
    assert.match(await p.eval(`document.querySelector('#spaces [data-pc="div:g1"]').textContent`), /%$/);
    await p.eval(`(() => { document.querySelector('#spaces [data-space="div:g1"]').click(); return true; })()`);
    await p.waitFor(`S.space === 'div:g1'`);
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#tree .row[aria-level="1"], #tree .row[aria-level="2"]')].map(r => r.dataset.select)`), ['div:g1', 'lx', 'lx2']);
    assert.equal(await p.eval(`document.querySelector('#main .hero h1').textContent`), 'Lab');
    assert.equal(await p.eval(`[...document.querySelectorAll('#main .mrow [data-select]')].map(b => b.dataset.select).join(',')`), 'lx,lx2');
    assert.ok(!(await p.eval(`document.getElementById('main').textContent`)).includes('NaN'));
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a division of containers on one host, and Details with a division selected', async () => {
  const p = await open(fx2(['div:g2']));
  try {
    await p.eval(`(() => { document.querySelector('#spaces [data-space="div:g2"]').click(); return true; })()`);
    await p.waitFor(`S.space === 'div:g2' && document.querySelector('#main .hero h1').textContent === 'Workloads'`);
    assert.match(await p.eval(`document.querySelector('#spaces [data-pc="div:g2"]').textContent`), /%$/);
    assert.ok(!(await p.eval(`document.getElementById('main').textContent`)).includes('NaN'));
    await p.eval(`(() => { document.querySelector('[data-details]').click(); return true; })()`);
    await p.waitFor(`document.querySelector('[data-details]').getAttribute('aria-pressed') === 'true'`);
    await new Promise(r => setTimeout(r, 300));
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
