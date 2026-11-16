// SPDX-License-Identifier: GPL-3.0-or-later
// CPU → Logical processors on its own: a machine the server has no per-processor readings for, and
// keyboard focus on the card's controls across the polls that redraw it.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch, sleep} from './harness.mjs';
import {fixture, ui, CCD1} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

// Two VMs on lab-linux that Fleet doesn't poll itself, shaped as the server sends them, so /api/cpus
// answers {} for both: one the host lists (status ok), one configured but reachable only through its host.
const GUEST = 'lx/vms/guest', SEEN = 'lx/vms/seen';
function withVms(){
  const fx = fixture(), lx = fx.fleet.machines.find(m => m.id === 'lx');
  const vm = (id, name, extra) => Object.assign({id, name, tile: 'vm', os: 'VM', cap: [16, 64, 0, 1, 1], gpus: [], cronLabel: 'Cron jobs',
    base: {id: id + '/base'}, baseCron: [], compose: [], containers: [], vms: [], procs: []}, extra);
  lx.vms = [vm(GUEST, 'guest', {status: 'ok', agent: 'seen from the host'}),
            vm(SEEN, 'seen', {status: 'hostonly', agent: 'ssh seen', has_data: false, error: 'not reachable · showing what its host sees'})];
  return fx;
}
const H2 = `[...document.querySelectorAll('#main > .wrap .card-h h2, #main .split > .wrap .card-h h2')].map(h => h.textContent)`;
const LCARD = `(() => { const c = [...document.querySelectorAll('#main .card')].find(c => c.querySelector('.card-h h2')?.textContent === 'Logical processors'); if (!c) return null; const h = c.querySelector('.card-h'); return {sub: h.querySelector('.sub').textContent, body: [...c.children].filter(e => e !== h).map(e => e.textContent)}; })()`;
const state = p => p.eval(`({card: ${LCARD}, conn: document.getElementById('conn').hidden, h1: document.querySelector('#main .hero h1')?.firstChild.textContent.trim() ?? null})`);

for (const [id, name] of [[GUEST, 'guest'], [SEEN, 'seen']]){
  test(`a VM the server has no per-processor readings for (${name}) says so, and the page keeps working`, async () => {
    const p = await browser.page(withVms(), {ui: ui({sel: id, metric: 'cpu', cpuView: 'logical', detailsDocked: true})});
    try {
      await p.waitFor(`'${id}' in CPUS`);
      await sleep(2300);   // a poll after /api/cpus answered {}
      assert.deepEqual(await state(p), {card: {sub: '', body: [`No per-processor readings for ${name}.`]}, conn: true, h1: name});
      await p.click('#metrics [data-metric="mem"]');
      await p.waitFor(`!${LCARD}`);
      assert.deepEqual((await p.eval(H2)).slice(0, 2), [`Where this VM’s usage goes`, 'Memory'], 'Memory replaced Logical processors');
      await p.click('#tree [data-select="lx"].nm');
      await p.waitFor(`document.querySelector('#main .hero h1').firstChild.textContent.trim() === 'lab-linux'`);
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  });
}

test('the control: a machine Fleet polls itself shows all its processors', async () => {
  const p = await browser.page(withVms(), {ui: ui({sel: 'lx', metric: 'cpu', cpuView: 'logical'})});
  try {
    await p.waitFor(`document.querySelector('[data-lcpu]')`);
    assert.equal((await state(p)).card.sub, 'lab-linux CPU · 16 processors');
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('[data-lcpu]')].map(b => +b.dataset.lcpu)`), [0, 1, 2, 3, 8, 9, 10, 11, 4, 5, 6, 7, 12, 13, 14, 15]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

// The card changes on every poll (percentages, sparklines), so the main pane is redrawn every 2 s.
const CONTROLS = ['[data-tilesort="cpu"]', '[data-lcpu="4"]', `[data-lgroup="${CCD1.join(',')}"]`, '[data-tpin="cpu|lx|4"]', '[data-tpin="cpugroup|lx|CCD 1"]', '[data-cpuview="type"]'];
test('every control in the card keeps keyboard focus across a poll that redraws it', async () => {
  const fx = fixture();
  const p = await browser.page(fx, {ui: ui({sel: 'lx', metric: 'cpu', cpuView: 'logical'})});
  try {
    await p.waitFor(`document.querySelector('[data-lcpu]')`);
    const kept = {};
    for (const [i, sel] of CONTROLS.entries()){
      await p.eval(`(document.querySelector(${JSON.stringify(sel)}).focus(), document.activeElement.__before = 1, document.activeElement.matches(${JSON.stringify(sel)}))`);
      fx.cpus.lx.cpus[0].pct = 50 + i;   // the next poll brings a new reading for CPU 0
      await p.waitFor(`document.querySelector('[data-lcpu="0"]').getAttribute('aria-label') === 'CPU 0, ${50 + i}%'`);
      kept[sel] = await p.eval(`({focused: document.activeElement.matches(${JSON.stringify(sel)}), redrawn: !document.activeElement.__before})`);
    }
    assert.deepEqual(kept, Object.fromEntries(CONTROLS.map(s => [s, {focused: true, redrawn: true}])));
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('stepping through Sort with the keyboard keeps focus on it', async () => {
  const p = await browser.page(fixture(), {ui: ui({sel: 'lx', metric: 'cpu', cpuView: 'logical'})});
  try {
    await p.waitFor(`document.querySelector('[data-lcpu]')`);
    await p.eval(`(document.querySelector('[data-tilesort="cpu"]').focus(), true)`);
    const steps = [];
    for (const v of ['usage', 'clock', 'number']){   // what ↓ does on a closed select: a new value and a change event
      steps.push(await p.eval(`(() => { const s = document.activeElement; if (!s.matches('select')) return 'focus lost'; s.value = '${v}'; s.dispatchEvent(new Event('change', {bubbles: true})); const a = document.activeElement; return a.matches('[data-tilesort="cpu"]') ? a.value : 'focus lost'; })()`));
    }
    assert.deepEqual(steps, ['usage', 'clock', 'number']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
