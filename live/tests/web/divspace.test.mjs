// SPDX-License-Identifier: GPL-3.0-or-later
// Pinning a division as a space (issue #24).
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, modelFleet, ui} from './fixtures.mjs';

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
    assert.match(await p.eval(`document.querySelector('#picklist').textContent`), /Groups/);
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

// A group's share comes from what's in it, not from where it was saved (#294). Pins only keeps its groups under
// 'pins|root' whatever they hold, and a box drawn inside a group's own space is saved under 'machines|div:<id>'.
// A group of machines adds up their capacity; a group on one machine is a share of that machine; a group whose
// members are on several machines, of the machines they run on. modelFleet's numbers (CPU cores): host 9.8 of 16,
// nog 1.2 of 8; host/base 2.5, host/containers/web 0.3, nog/containers/web 0.2.
const MIXED = {
  'pins|root': [{id: 'gx', name: 'Webs', ids: ['host/containers/web', 'nog/containers/web']}, {id: 'gy', name: 'Mine', ids: ['host/containers/web', 'host/base']}],
  'machines|root': [{id: 'g1', name: 'Lab', ids: ['host', 'nog']}],
  'machines|div:g1': [{id: 'g7', name: 'Inner', ids: ['host', 'nog']}],
  'machines|host': [{id: 'g2', name: 'Workloads', ids: ['host/base', 'host/containers']}],
  'machines|div:g2': [{id: 'g8', name: 'Inside', ids: ['host/base', 'host/containers']}]};
function mixedFx(pins){ const fx = {fleet: modelFleet(), procs: {}, cpus: {}}; fx.fleet.prefs = {tgroups: MIXED}; fx.fleet.pins = pins; return fx; }
const PILLS = `[...document.querySelectorAll('#spaces [data-space]')].map(b => [b.dataset.space, b.closest('.space').title, b.querySelector('[data-pc]').textContent, [...b.querySelectorAll('[data-mini] i')].map(i => /width:([^;]+)/.exec(i.getAttribute('style'))[1])])`;
const w = v => v.toFixed(2) + '%', FLEET = [w(3.5 / 24 * 100), w(4.5 / 24 * 100), w(0.5 / 24 * 100), w(2.5 / 24 * 100)];   // base, compose, containers, VMs of 24 cores
const ALLPILLS = [
  ['fleet', 'All machines', '46%', FLEET],
  ['host/containers/web', 'web · on lab-host', '1.9%', ['1.9%']],
  ['nog/containers/web', 'web · on lab-nogpu', '2.5%', ['2.5%']],
  ['host/base', 'Base system · on lab-host', '16%', ['15.6%']],
  ['div:gx', 'Webs', '2.1%', [w(0), w(0), w(0.5 / 24 * 100), w(0)]],   // 0.5 of host and nog's 24 cores
  ['div:gy', 'Mine · on lab-host', '18%', ['17.5%']],                     // 2.8 of host's 16
  ['div:g1', 'Lab', '46%', FLEET],
  ['div:g7', 'Inner', '46%', FLEET],
  ['div:g2', 'Workloads · on lab-host', '18%', ['17.5%']],
  ['div:g8', 'Inside · on lab-host', '18%', ['17.5%']]];

test("groups in Pins only and inside a group's space: pinned, each reads its share, and the space bar draws them all", async () => {
  const pins = ALLPILLS.slice(1).map(x => x[0]);
  for (const pinsOnly of [false, true]){
    const p = await browser.page(mixedFx(pins), {ui: ui({sel: 'fleet', pinsOnly})});
    try {
      await p.waitFor(`document.querySelectorAll('#spaces [data-space]').length > 1 && document.querySelector('#main .hero')`).catch(() => null);
      assert.deepEqual(p.errors, []);
      assert.deepEqual(await p.eval(PILLS), ALLPILLS);
      assert.ok(await p.eval(`!!document.querySelector('#spaces [data-addpin]')`));
      if (pinsOnly) assert.deepEqual(await p.eval(`[...document.querySelectorAll('#tree .row[data-select^="div:"]')].map(r => [r.dataset.select, r.querySelector('[data-val]').textContent])`),
        [['div:g7', '46%'], ['div:g8', '18%'], ['div:g1', '46%'], ['div:gy', '18%'], ['div:gx', '2.1%'], ['div:g2', '18%']]);   // by name: Inner, Inside, Lab, Mine, Webs, Workloads
      assert.ok(!(await p.eval(`document.body.textContent`)).includes('NaN'));
    } finally { await p.close(); }
  }
});

test('pinning a Pins only group of containers on two machines, from the + picker', async () => {
  const fx = mixedFx(['host/containers/web', 'nog/containers/web']);
  const p = await browser.page(fx, {ui: ui({sel: 'fleet', pinsOnly: true})});
  try {
    await p.waitFor(`document.querySelector('#tree .tgroup[data-tgroup="gx"]')`);
    await p.eval(`(() => { document.querySelector('[data-addpin]').click(); return true; })()`);
    await p.waitFor(`document.querySelector('#picklist [data-pin="div:gx"]')`);
    await p.eval(`(() => { document.querySelector('#picklist [data-pin="div:gx"]').click(); return true; })()`);
    await p.waitFor(`document.querySelector('#spaces [data-space="div:gx"]')`).catch(() => null);
    assert.deepEqual(p.errors, []);
    await p.waitFor(`!pinsSaves`);
    assert.deepEqual(await p.eval(PILLS), [ALLPILLS[0], ALLPILLS[1], ALLPILLS[2], ALLPILLS[4]]);
    assert.deepEqual(JSON.parse(fx.posts.filter(x => x.path === '/api/pins').pop().body), ['host/containers/web', 'nog/containers/web', 'div:gx']);
  } finally { await p.close(); }
});

// Details lists one machine's processes. A group with no machine of its own (a group of machines, or of things on
// several machines) is like All machines there: the docked panel asks for a machine, and the full view shows its
// first member, as All machines shows its first machine. A group on one machine lists what's in it (#294).
const DPANEL = `(() => { const d = document.querySelector('.dpanel .dtitle'); return d ? [d.querySelector('b').textContent, d.querySelector('span').textContent] : null; })()`;
const FULL = `(() => { const h = document.querySelector('#main .hero h1'); return h ? [h.textContent, [...document.querySelectorAll('#main .hero .facts span')].map(s => s.textContent).slice(0, 2)] : null; })()`;
const PIDLIST = `[...document.querySelectorAll('#main .ptbl tbody tr[data-pid]')].map(r => +r.dataset.pid).sort((a, b) => a - b)`;
const LX = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112];
for (const [name, divs, sel, full, fullPids, docked] of [
  ['a group of machines', DIVS, 'div:g1', ['Details · lab-linux', ['12 processes', 'on lab-linux']], LX, ['Details', 'Select a machine or anything in it to see its processes.']],
  ['a group on one machine (the control)', DIVS, 'div:g2', ['Details · Workloads', ['12 processes', 'on lab-linux']], LX, ['Details · Workloads', '12 processes on lab-linux']]])
  test(`Details with ${name} selected: docked and full, never stuck on loading`, async () => {
    const fx = fixture(); fx.fleet.prefs = {tgroups: divs}; fx.fleet.pins = [sel];
    const p = await browser.page(fx, {ui: ui({sel, space: sel, detailsDocked: true, pinsOnly: sel === 'div:gw'})});
    try {
      await p.waitFor(`document.querySelector('.dpanel .dtitle')`);
      for (let i = 0; i < 3; i++){ await p.eval(`(() => { refreshNow(); return true; })()`); await p.waitFor(`!busy`); }
      assert.deepEqual(await p.eval(DPANEL), docked);
      await p.eval(`(() => { document.querySelector('[data-undock]') ? document.querySelector('[data-undock]').click() : document.querySelector('[data-details]').click(); return true; })()`);
      await p.waitFor(`S.view === 'details' && !S.detailsDocked`);
      await p.waitFor(`!/loading/.test(document.querySelector('#main .hero .facts').textContent)`).catch(() => null);
      assert.deepEqual(await p.eval(FULL), full);
      assert.deepEqual(await p.eval(PIDLIST), fullPids);
      assert.equal(await p.eval(`S.sel`), sel);
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  });
