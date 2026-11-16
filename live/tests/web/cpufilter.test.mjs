// SPDX-License-Identifier: GPL-3.0-or-later
// #3: in CPU → Logical processors, a CPU tile or a CCD heading filters the docked Details to the
// processes that last ran there (p[12]).
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch, sleep} from './harness.mjs';
import {fixture, ui, PIDS, CCD1} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const ALL_LX = [104, 105, 106, 103, 101, 102, 111, 109, 108, 107, 110, 112];
const CHIPS = `[...document.querySelectorAll('.dpanel [data-fchip]')].map(c => ({kind: c.dataset.fchip, text: c.querySelector('span').textContent, clear: !!c.querySelector('button[data-dfclear="' + c.dataset.fchip + '"]')}))`;
const NOTES = `[...document.querySelectorAll('.dpanel .note')].map(n => n.textContent)`;
const panel = p => p.eval(`({pids: ${PIDS}, chips: ${CHIPS}, notes: ${NOTES}})`);
const tile = n => `[data-lcpu="${n}"]`;

async function open(over = {}, fx = fixture()){
  const p = await browser.page(fx, {ui: ui(Object.assign({detailsDocked: true, metric: 'cpu', cpuView: 'logical'}, over))});
  await p.waitFor(`document.querySelector('[data-lcpu]') && (!S.detailsDocked || document.querySelectorAll('.dpanel .ptbl tbody tr').length)`);
  return p;
}
// The CCD headings carry their CPUs; find one by its label.
const clickGroup = async (p, name, opts) => {
  const cpus = await p.eval(`[...document.querySelectorAll('[data-lgroup]')].find(b => b.textContent === ${JSON.stringify(name)}).dataset.lgroup`);
  await p.click(`[data-lgroup="${cpus}"]`, opts);
};

test('a CPU tile filters the docked Details to what last ran on that CPU', async () => {
  const p = await open();
  try {
    assert.deepEqual(await panel(p), {pids: ALL_LX, chips: [], notes: []}, 'before: everything');
    await p.click(tile(4));
    assert.deepEqual(await panel(p), {pids: [101, 110], chips: [{kind: 'cpu', text: 'Last ran on CPU 4', clear: true}], notes: []});
    assert.match(await p.eval(`document.querySelector('.dpanel [data-fchip="cpu"]').title`), /last ran on CPU 4.*move between processors/s);
    assert.equal(await p.eval(`document.querySelector('${tile(4)}').getAttribute('aria-pressed')`), 'true');
    await sleep(2300);
    assert.deepEqual((await panel(p)).pids, [101, 110], 'still filtered after a poll');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a CCD heading filters to the whole CCD; clicking it again clears the filter', async () => {
  const p = await open();
  try {
    await clickGroup(p, 'CCD 1');
    assert.deepEqual(await panel(p), {pids: [105, 106, 103, 101, 102, 111, 110], chips: [{kind: 'cpu', text: 'Last ran on CCD 1', clear: true}], notes: []});
    assert.match(await p.eval(`document.querySelector('.dpanel [data-fchip="cpu"]').title`), /CCD 1 \(CPUs 4–7, 12–15\)/);
    await clickGroup(p, 'CCD 1');
    assert.deepEqual(await panel(p), {pids: ALL_LX, chips: [], notes: []});
  } finally { await p.close(); }
});

test('the chip\'s × clears the filter and the tile selection', async () => {
  const p = await open();
  try {
    await p.click(tile(13));
    assert.deepEqual((await panel(p)).pids, [105]);
    await p.click('.dpanel [data-dfclear="cpu"]');
    assert.deepEqual(await panel(p), {pids: ALL_LX, chips: [], notes: []});
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('[data-lcpu][aria-pressed="true"], [data-lgroup][aria-pressed="true"]')].length`), 0);
  } finally { await p.close(); }
});

test('several CPUs, and several whole CCDs, name themselves on the chip', async () => {
  const p = await open();
  try {
    await p.click(tile(4)); await p.click(tile(12), {modifiers: 8});
    assert.deepEqual(await panel(p), {pids: [101, 102, 110], chips: [{kind: 'cpu', text: 'Last ran on CPUs 4, 12', clear: true}], notes: []});
    await clickGroup(p, 'CCD 0'); await clickGroup(p, 'CCD 1', {modifiers: 8});
    assert.deepEqual(await panel(p), {pids: ALL_LX, chips: [{kind: 'cpu', text: 'Last ran on CCD 0 + CCD 1', clear: true}], notes: []});
  } finally { await p.close(); }
});

test('it combines with the text filter and with Group by', async () => {
  const p = await open({filter: 'nginx'});
  try {
    await clickGroup(p, 'CCD 1');
    assert.deepEqual((await panel(p)).pids, [101, 102], 'nginx on CCD 1');
    await clickGroup(p, 'CCD 0');
    assert.deepEqual(await panel(p), {pids: [], chips: [{kind: 'cpu', text: 'Last ran on CCD 0', clear: true}], notes: []}, 'no nginx on CCD 0, and no "not reported" note');
    assert.equal(await p.eval(`document.querySelector('.dpanel tr.empty').textContent`), 'No process matches CCD 0 + “nginx” right now.');
    await p.eval(`(() => { const i = document.getElementById('pfilter'); i.value = ''; i.dispatchEvent(new Event('input', {bubbles: true})); const s = document.getElementById('pgroup'); s.value = 'user'; s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('.dpanel tr.gh [data-gtoggle]')].map(b => b.dataset.gtoggle)`), ['marc', 'root'], 'users with processes on CCD 0');
    await p.click('.dpanel [data-gtoggle="root"]');
    assert.deepEqual((await panel(p)).pids, [109, 108, 107, 112]);
  } finally { await p.close(); }
});

test('the filter belongs to the machine it was made on (same names on another host stay out)', async () => {
  const p = await open();
  try {
    await p.click(tile(4));
    assert.deepEqual((await panel(p)).pids, [101, 110]);
    await p.click('#tree [data-select="lx2"].nm');
    await p.waitFor(`${PIDS}.length && ${PIDS}[0] > 200`);
    assert.deepEqual(await panel(p), {pids: ALL_LX.map(x => x + 100), chips: [], notes: []}, 'lab-linux-2 is unfiltered');
  } finally { await p.close(); }
});

test('a host that doesn\'t report the last CPU says so, and Details stays unfiltered by it', async () => {
  const p = await open({sel: 'win'});
  try {
    await p.click(tile(2));
    assert.deepEqual(await panel(p), {pids: ALL_LX.map(x => x + 200), chips: [{kind: 'cpu', text: 'Last ran on CPU 2', clear: true}],
      notes: ['Windows doesn’t report which processor a process last ran on, so Details isn’t filtered by CPU 2.']});
  } finally { await p.close(); }
});

test('without a docked Details, a click does what it did before: the selection card, no filter', async () => {
  const p = await open({detailsDocked: false});
  try {
    await p.click(tile(4));
    await p.waitFor(`document.querySelector('h3.cpuproc + .scroll-x')`);
    assert.deepEqual(await p.eval(`({panel: !!document.querySelector('.dpanel'), chips: document.querySelectorAll('[data-fchip]').length, card: document.querySelector('.card-h h2') && [...document.querySelectorAll('.card-h h2')].map(h => h.textContent).includes('CPU 4'), on: [...document.querySelectorAll('h3.cpuproc + .scroll-x tbody tr')].map(r => +r.children[1].textContent)})`),
      {panel: false, chips: 0, card: true, on: [101, 110]});
  } finally { await p.close(); }
});

test('the full Details view follows the selection too, and its title names it', async () => {
  const p = await browser.page(fixture(), {ui: ui({view: 'details', cpuSel: {mid: 'lx', cpus: CCD1}})});
  try {
    await p.waitFor(`PROCS.machine === 'lx' && document.querySelector('.ptbl')`);
    assert.deepEqual(await p.eval(`({pids: ${PIDS}, chips: [...document.querySelectorAll('[data-fchip]')].map(c => c.textContent), title: document.querySelector('.hero h1').textContent})`),
      {pids: [105, 106, 103, 101, 102, 111, 110], chips: ['Last ran on CCD 1'], title: 'Details · lab-linux · CCD 1 (CPUs 4–7, 12–15)'});
  } finally { await p.close(); }
});

// The /api requests each poll makes (everything after one /api/fleet up to the next), for two whole polls.
async function twoPolls(p){
  const seen = [], off = p.on('Network.requestWillBeSent', r => { const u = new URL(r.request.url); if (u.pathname.startsWith('/api/')) seen.push(u.pathname + u.search); });
  try {
    const end = Date.now() + 8000;
    while (seen.filter(u => u === '/api/fleet').length < 3 && Date.now() < end) await sleep(40);
  } finally { off(); }
  const at = seen.reduce((a, u, i) => u === '/api/fleet' ? a.concat([i]) : a, []);
  assert.ok(at.length >= 3, 'three polls in 8 s');
  return [seen.slice(at[0] + 1, at[1]).sort(), seen.slice(at[1] + 1, at[2]).sort()];
}

const EACH = ['/api/cpus?machine=lx', '/api/procs?machine=lx'];
for (const [docked, pick, want, name] of [
  [true, true, EACH, 'a CPU pick with Details docked reads the machine\'s processes once per poll, not twice'],
  [true, false, EACH, 'Details docked, nothing picked: the processes once per poll'],
  // the selection card's list never holds Docker Desktop's processes, so it asks for none (#312)
  [false, true, ['/api/cpus?machine=lx', '/api/procs?machine=lx&docker=0'], 'a CPU pick without Details docked: the processes once per poll, for the selection card'],
  [false, false, ['/api/cpus?machine=lx'], 'nothing docked, nothing picked: no processes at all']]){
  test(name, async () => {
    const p = await open({detailsDocked: docked});
    try {
      if (pick) await p.click(tile(4));
      await p.waitFor(`PROCS.machine === 'lx' || ${!docked && !pick}`);
      assert.deepEqual(await twoPolls(p), [want, want]);
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  });
}
