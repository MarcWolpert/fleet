// SPDX-License-Identifier: GPL-3.0-or-later
// A disk or interface picked in Each disk / Each interface is kept in the saved UI state, but disks go away
// and interfaces get new names (a Compose project's br-<id> after down/up, a VM's tap after a restart).
// A pick that names nothing on the machine any more counts as not picked, like a GPU that's gone: no stale
// highlight, the hint is back, and Details isn't filtered to nothing. It comes back if the name does.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui, PIDS} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const ALL_LX = [104, 105, 106, 103, 101, 102, 111, 109, 108, 107, 110, 112];
const GONE_IF = 'br-0123456789ab', GONE_DISK = 'sdb';
const VIEW = `(() => {
  const bar = document.getElementById('dfbar'), shown = !!bar && !bar.hidden && bar.getBoundingClientRect().width > 0;
  const card = [...document.querySelectorAll('section.card')].find(s => s.querySelector('[data-ifclear], [data-diskclear]'));
  return {
    picked: [...document.querySelectorAll('.kcell.sel [data-isel], .kcell.sel [data-dsel]')].map(b => b.dataset.isel || b.dataset.dsel),
    hint: [...document.querySelectorAll('.lhint')].map(h => h.textContent),
    card: card ? card.querySelector('h2').textContent : null,
    chips: [...document.querySelectorAll('.dpanel [data-fchip], .dfchips [data-fchip]')].map(c => c.dataset.fchip + ': ' + c.querySelector('span').textContent),
    bar: shown ? [...bar.querySelectorAll('[data-barchip]')].map(c => c.dataset.barchip + ': ' + c.querySelector('span').textContent) : null
  };
})()`;
const IF_HINT = 'Click an interface to see its traffic and what uses it; ⌘/Ctrl- or Shift-click to pick several.';
const DISK_HINT = 'Click a disk to see its traffic and what uses it; ⌘/Ctrl- or Shift-click to pick several.';
async function open(over, fx = fixture(), ready = `document.querySelector('.kgrid .kcell')`){
  const p = await browser.page(fx, {ui: ui(Object.assign({sel: 'lx'}, over))});
  try { await p.waitFor(ready); } catch (e) { await p.close(); throw e; }
  return p;
}
const docked = `PROCS.machine === 'lx' && document.querySelector('.dpanel .ptbl')`;
// what Details lists once it has drawn its processes: their PIDs, or the line saying none match
const LISTED = `document.querySelector('.ptbl tbody tr.empty') ? document.querySelector('.ptbl tbody tr.empty').textContent : ${PIDS}`;
const listed = `PROCS.machine === 'lx' && document.querySelector('.ptbl tbody tr')`;

test('Each interface: a picked interface that is gone highlights nothing, and the hint is back', async () => {
  const p = await open({metric: 'net', ifView: 'each', ifSel: {mid: 'lx', names: [GONE_IF]}});
  try {
    assert.deepEqual(await p.eval(VIEW), {picked: [], hint: [IF_HINT], card: null, chips: [], bar: null});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Each disk: a picked disk that is gone highlights nothing, and the hint is back', async () => {
  const p = await open({metric: 'disk', diskView: 'each', diskSel: {mid: 'lx', names: [GONE_DISK]}});
  try {
    assert.deepEqual(await p.eval(VIEW), {picked: [], hint: [DISK_HINT], card: null, chips: [], bar: null});
  } finally { await p.close(); }
});

test('a pick of one interface that is there and one that is gone is a pick of the one that is there', async () => {
  const p = await open({metric: 'net', ifView: 'each', detailsDocked: true, ifSel: {mid: 'lx', names: ['eth0', GONE_IF]}}, fixture(), `${docked} && document.querySelector('.kcell.sel')`);
  try {
    assert.deepEqual(await p.eval(VIEW), {picked: ['eth0'], hint: [], card: 'eth0 · physical', chips: ['net: Traffic via eth0'], bar: ['net: eth0']});
    assert.deepEqual(await p.eval(PIDS), [105, 101, 102, 107]);
  } finally { await p.close(); }
});

test('Details docked on another metric: a disk and an interface that are gone filter nothing', async () => {
  const p = await open({metric: 'cpu', detailsDocked: true, ifSel: {mid: 'lx', names: [GONE_IF]}, diskSel: {mid: 'lx', names: [GONE_DISK]}}, fixture(), docked);
  try {
    await p.waitFor(listed);
    assert.deepEqual(await p.eval(LISTED), ALL_LX);
    assert.deepEqual(await p.eval(VIEW), {picked: [], hint: [], card: null, chips: [], bar: null});
  } finally { await p.close(); }
});

test('the full Details view: a gone interface filters nothing; a disk still there still filters', async () => {
  const p = await open({view: 'details', ifSel: {mid: 'lx', names: [GONE_IF]}, diskSel: {mid: 'lx', names: ['sda']}}, fixture(), `PROCS.machine === 'lx' && document.querySelector('.ptbl')`);
  try {
    await p.waitFor(listed);
    assert.deepEqual(await p.eval(LISTED), [106]);
    assert.deepEqual(await p.eval(VIEW), {picked: [], hint: [], card: null, chips: ['disk: I/O on sda'], bar: ['disk: sda']});
  } finally { await p.close(); }
});

test('an interface that comes back under its picked name is picked again', async () => {
  const fx = fixture();
  const p = await open({metric: 'net', ifView: 'each', ifSel: {mid: 'lx', names: [GONE_IF]}}, fx);
  try {
    assert.deepEqual((await p.eval(VIEW)).picked, []);
    fx.ifs.lx.ifs.push(Object.assign({}, fx.ifs.lx.ifs[1], {name: GONE_IF, dnet: 'shop_default'}));
    await p.waitFor(`document.querySelector('.kcell.sel')`, 8000);
    assert.deepEqual(await p.eval(VIEW), {picked: [GONE_IF], hint: [], card: GONE_IF + ' · Docker network · shop_default', chips: [], bar: null});
  } finally { await p.close(); }
});
