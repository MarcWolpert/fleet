// SPDX-License-Identifier: GPL-3.0-or-later
// #354: Details groups hold still. A selected group header (clicked or focused) keeps the groups in the order they
// had, the way an open process holds the rows; selecting elsewhere, Esc or Resume live order lets go. An option by
// Group by stops the groups moving at all, in every grouping, and is kept in ui.json. Their numbers keep updating,
// new groups come in last and ended ones go.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch, sleep} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const HEADS = `[...document.querySelectorAll('.ptbl tr.gh button[data-gtoggle]')].map(b => b.dataset.gtoggle)`;
const SELECTED = `[...document.querySelectorAll('.ptbl tr.gh.gsel button[data-gtoggle]')].map(b => b.dataset.gtoggle)`;
// the note that the groups are held, and which group's row it is in
const HOLD = `[...document.querySelectorAll('.ghhold')].map(h => h.closest('tr.gh').querySelector('[data-gtoggle]').dataset.gtoggle + ': ' + h.querySelector('#ghhold').textContent).join(' | ')`;
const CPUOF = g => `(document.querySelector('.ptbl tr.gh button[data-gtoggle="${g}"] span').textContent.match(/CPU ([^ ]+)/) || [])[1]`;
const header = g => `.ptbl tr.gh button[data-gtoggle=${JSON.stringify(g)}]`;
const lastPost = fx => { const ps = (fx.posts || []).filter(x => x.path === '/api/prefs'); return ps.length ? JSON.parse(ps[ps.length - 1].body) : null; };
const view = p => p.eval(`({heads: ${HEADS}, selected: ${SELECTED}, hold: ${HOLD}})`);

async function open(over = {}, fx = fixture()){
  const p = await browser.page(fx, {ui: ui(Object.assign({view: 'details'}, over))});
  await p.waitFor(`document.querySelectorAll('.ptbl tr.gh').length > 0`);
  return p;
}
const choose = (p, group) => p.eval(`(() => { const s = document.getElementById('pgroup'); s.value = ${JSON.stringify(group)}; s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
async function key(p, k){
  const vk = {Escape: 27, Tab: 9}[k];
  await p.send('Input.dispatchKeyEvent', {type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: vk});
  await p.send('Input.dispatchKeyEvent', {type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: vk});
}
// how often the page has read lx's process list: a poll has reached Details when this moves
function counted(fx){
  const c = {reads: 0}; const answer = fx.procs.lx;
  Object.defineProperty(fx.procs, 'lx', {get(){ c.reads++; return answer; }, configurable: true});
  return c;
}
async function aPoll(p, c){ const r0 = c.reads; await p.eval(`(refreshNow(), true)`); for (const end = Date.now() + 6000; c.reads <= r0; await sleep(40)) if (Date.now() > end) throw new Error('no poll'); await sleep(250); }
// lx's processes, to change between polls: by PID, or a new one
const procs = fx => fx.procs.lx.procs;
const pid = (fx, n) => procs(fx).find(q => q[0] === n);
function add(fx, n, user, state, cpu){ const q = procs(fx)[0].slice(); Object.assign(q, {0: n, 1: 'worker', 2: user, 3: state, 4: cpu, 10: 'lx/base', 12: 0}); procs(fx).push(q); }
const drop = (fx, n) => procs(fx).splice(procs(fx).findIndex(q => q[0] === n), 1);

test('a clicked group header holds the groups in place through polls; numbers update, new groups go last, ended ones go; Esc lets go', async () => {
  const fx = fixture(), c = counted(fx);
  const p = await open({group: 'user'}, fx);
  try {
    assert.deepEqual(await view(p), {heads: ['marc', 'postgres', 'root', 'www-data', 'redis'], selected: [], hold: ''});
    await p.click(header('root'));   // opens it, and selects it
    assert.deepEqual(await view(p), {heads: ['marc', 'postgres', 'root', 'www-data', 'redis'], selected: ['root'], hold: 'root: Order held'});
    // a poll that would reorder them: postgres and redis get busy, alice turns up (busiest of all), www-data's one process ends
    pid(fx, 103)[4] = 5; pid(fx, 111)[4] = 4; drop(fx, 102); add(fx, 150, 'alice', 'R', 9);
    await aPoll(p, c);
    assert.deepEqual(await view(p), {heads: ['marc', 'postgres', 'root', 'redis', 'alice'], selected: ['root'], hold: 'root: Order held'});
    assert.deepEqual([await p.eval(CPUOF('postgres')), await p.eval(CPUOF('alice'))], ['31%', '56%'], 'their numbers keep updating');
    assert.equal(await p.eval(`document.activeElement.dataset.gtoggle`), 'root');
    await aPoll(p, c);
    assert.deepEqual((await view(p)).heads, ['marc', 'postgres', 'root', 'redis', 'alice'], 'and the next poll too');
    // Esc lets go: the live order, busiest first
    await key(p, 'Escape');
    await p.waitFor(`${HEADS}[0] === 'alice'`);
    assert.deepEqual(await view(p), {heads: ['alice', 'postgres', 'redis', 'marc', 'root'], selected: [], hold: ''});
    assert.equal(await p.eval(`JSON.parse(localStorage.getItem('fleet-live-ui')).sel`), 'lx', 'the tree keeps its selection (Esc let go of the group first)');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a click from one group header to another opens that one too and moves the selection; the order still holds', async () => {
  const fx = fixture(), c = counted(fx);
  const p = await open({group: 'user'}, fx);
  try {
    await p.click(header('root'));
    pid(fx, 111)[4] = 9;   // redis would go first
    await aPoll(p, c);
    await p.click(header('marc'));   // the focus moving with the press must not swallow the click
    assert.deepEqual(await view(p), {heads: ['marc', 'postgres', 'root', 'www-data', 'redis'], selected: ['marc'], hold: 'marc: Order held'});
    assert.deepEqual(await p.eval(`JSON.parse(localStorage.getItem('fleet-live-ui')).groupOpen`), {user: ['root', 'marc']});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('focusing a header selects it too; Tab to the next keeps holding; a click elsewhere or Resume live order lets go', async () => {
  const fx = fixture(), c = counted(fx);
  const p = await open({group: 'user'}, fx);
  try {
    await p.eval(`(document.getElementById('pfilter').focus(), document.querySelector(${JSON.stringify(header('postgres'))}).focus(), true)`);
    assert.deepEqual(await view(p), {heads: ['marc', 'postgres', 'root', 'www-data', 'redis'], selected: ['postgres'], hold: 'postgres: Order held'});
    pid(fx, 111)[4] = 9;   // redis would go first
    await aPoll(p, c);
    assert.deepEqual((await view(p)).heads, ['marc', 'postgres', 'root', 'www-data', 'redis']);
    await key(p, 'Tab');
    await p.waitFor(`document.activeElement.dataset.gtoggle === 'root'`);
    assert.deepEqual(await view(p), {heads: ['marc', 'postgres', 'root', 'www-data', 'redis'], selected: ['root'], hold: 'root: Order held'});
    // a click in the filter: selected elsewhere
    await p.click('#pfilter');
    await p.waitFor(`${HEADS}[0] === 'redis'`);
    assert.deepEqual(await view(p), {heads: ['redis', 'marc', 'postgres', 'root', 'www-data'], selected: [], hold: ''});
    // select again; Resume live order lets go too
    await p.click(header('marc'));
    pid(fx, 103)[4] = 20;   // postgres would go first
    await aPoll(p, c);
    assert.deepEqual((await view(p)).heads, ['redis', 'marc', 'postgres', 'root', 'www-data']);
    await p.click('.ghhold [data-gselclose]');
    await p.waitFor(`${HEADS}[0] === 'postgres'`);
    assert.deepEqual(await view(p), {heads: ['postgres', 'redis', 'marc', 'root', 'www-data'], selected: [], hold: ''});
    // another Group by: nothing selected there
    await p.click(header('root'));
    await choose(p, 'state');
    assert.deepEqual(await view(p), {heads: ['sleeping', 'running', 'idle'], selected: [], hold: ''});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Hold group order: groups stop moving in every grouping while their numbers update; kept in ui.json; off moves them again', async () => {
  const fx = fixture(), c = counted(fx);
  const p = await open({group: 'cpugroup'}, fx);
  try {
    assert.equal(await p.eval(`(() => { const b = document.getElementById('pghold'); return b && b.type === 'checkbox' && !b.checked && b.closest('.dtools').contains(document.getElementById('pgroup')); })()`), true, 'by Group by, off');
    await p.click('#pghold');
    await p.waitFor(`!prefsBusy`);
    assert.equal(lastPost(fx).holdGroups, true);
    // each grouping, with a change that would reorder it
    const changes = {
      cpugroup: () => { pid(fx, 108)[4] = 9; },     // CCD 0 would go first
      owner: () => { pid(fx, 111)[4] = 20; },       // the web container would
      user: () => { pid(fx, 102)[4] = 50; },        // www-data would
      state: () => { pid(fx, 104)[4] = 200; }       // running would
    };
    const held = {};
    for (const [mode, change] of Object.entries(changes)){
      await choose(p, mode);
      held[mode] = await p.eval(HEADS);
      change();
      await aPoll(p, c);
      assert.deepEqual(await p.eval(HEADS), held[mode], mode + ' holds still');
    }
    assert.deepEqual(held, {cpugroup: ['CCD 1', 'CCD 0'], owner: ['lx/base', 'lx/containers/web'], user: ['redis', 'root', 'marc', 'postgres', 'www-data'], state: ['sleeping', 'running', 'idle']});
    assert.equal(await p.eval(CPUOF('running')), '1260%', 'its numbers keep updating');
    // new groups come in last; ended ones go
    add(fx, 150, 'alice', 'D', 300); drop(fx, 110);   // a busy process in disk wait; the only idle one ends
    await aPoll(p, c);
    assert.deepEqual(await p.eval(HEADS), ['sleeping', 'running', 'disk wait']);
    // with it on, a selected group needs no "holding" bar
    await p.click(header('running'));
    assert.deepEqual(await view(p), {heads: ['sleeping', 'running', 'disk wait'], selected: ['running'], hold: ''});
    // kept: after a reload it's still on, and the groups are where they were (live, disk wait would be first)
    await p.reload();
    await p.waitFor(`document.querySelectorAll('.ptbl tr.gh').length > 0`);
    assert.equal(await p.eval(`document.getElementById('pghold').checked`), true);
    assert.deepEqual(await p.eval(HEADS), ['sleeping', 'running', 'disk wait']);
    // off: the live order again, busiest first
    await p.click('#pghold');
    await p.waitFor(`${HEADS}[0] === 'disk wait'`);
    assert.deepEqual(await p.eval(HEADS), ['disk wait', 'running', 'sleeping']);
    await p.waitFor(`!prefsBusy`);
    assert.equal(lastPost(fx).holdGroups, false);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
