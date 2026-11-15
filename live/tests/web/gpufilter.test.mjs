// SPDX-License-Identifier: GPL-3.0-or-later
// #4: a GPU picked in GPU → Each GPU filters the docked Details too (AND with the CPU/CCD filter), and a
// filter bar left of the view pills, plus a mark on the CPU/GPU pills, says what Details is filtered to.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui, PIDS, CCD1} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const ALL_LX = [104, 105, 106, 103, 101, 102, 111, 109, 108, 107, 110, 112];
const CCD1_PIDS = [105, 106, 103, 101, 102, 111, 110];
const STATE = `(() => {
  const bar = document.getElementById('dfbar');
  const shown = !!bar && !bar.hidden && bar.getBoundingClientRect().width > 0;
  return {
    pids: ${PIDS},
    chips: [...document.querySelectorAll('.dpanel [data-fchip]')].map(c => c.dataset.fchip + ': ' + c.querySelector('span').textContent),
    notes: [...document.querySelectorAll('.dpanel .note')].map(n => n.textContent),
    bar: shown ? [...bar.querySelectorAll('[data-barchip]')].map(c => c.dataset.barchip + ': ' + c.querySelector('span').textContent + (c.querySelector('[data-dfclear="' + c.dataset.barchip + '"]') ? ' ×' : '')) : null,
    clearAll: shown && !!bar.querySelector('[data-dfclear="all"]'),
    marked: [...document.querySelectorAll('#metrics [data-metric].filtered')].map(b => b.dataset.metric)
  };
})()`;
const state = p => p.eval(STATE);

async function open(over = {}){
  const p = await browser.page(fixture(), {ui: ui(Object.assign({detailsDocked: true, metric: 'gpu', gpuView: 'each'}, over))});
  await p.waitFor(`(!S.detailsDocked || (PROCS.machine === S.sel && document.querySelector('.dpanel .ptbl'))) && document.querySelector('#metrics [data-metric]')`);
  return p;
}

test('a GPU picked in Each GPU filters the docked Details to the processes on it', async () => {
  const p = await open();
  try {
    assert.deepEqual(await state(p), {pids: ALL_LX, chips: [], notes: [], bar: null, clearAll: false, marked: []}, 'before');
    await p.click('[data-gsel="gpu0"]');
    assert.deepEqual(await state(p), {pids: [104, 106, 109], chips: ['gpu: On GPU 0'], notes: [], bar: ['gpu: GPU 0 ×'], clearAll: false, marked: ['gpu']});
    assert.match(await p.eval(`document.querySelector('.dpanel [data-fchip="gpu"]').title`), /GPU 0 \(NVIDIA RTX A4000\)/);
    await p.click('[data-gsel="gpu1"]', {modifiers: 8});
    assert.deepEqual((await state(p)).chips, ['gpu: On GPU 0 + GPU 1']);
    assert.deepEqual((await state(p)).pids, [104, 105, 106, 109]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('CPU/CCD and GPU filters combine with AND, and the bar sits left of the pills', async () => {
  const p = await open({cpuSel: {mid: 'lx', cpus: CCD1}});
  try {
    assert.deepEqual(await state(p), {pids: CCD1_PIDS, chips: ['cpu: Last ran on CCD 1'], notes: [], bar: ['cpu: CCD 1 ×'], clearAll: false, marked: ['cpu']});
    await p.click('[data-gsel="gpu1"]');
    assert.deepEqual(await state(p), {pids: [105, 106], chips: ['cpu: Last ran on CCD 1', 'gpu: On GPU 1'], notes: [],
      bar: ['cpu: CCD 1 ×', 'gpu: GPU 1 ×'], clearAll: true, marked: ['cpu', 'gpu']});
    await p.click('[data-gsel="gpu0"]');
    assert.deepEqual((await state(p)).pids, [106], 'CCD 1 and GPU 0');
    assert.equal(await p.eval(`document.getElementById('dfbar').getBoundingClientRect().right <= document.getElementById('metrics').getBoundingClientRect().left`), true);
    assert.match(await p.eval(`document.getElementById('dfbar').textContent`), /^Filter/);
  } finally { await p.close(); }
});

test('each filter clears on its own, from the bar or from the panel', async () => {
  const p = await open({cpuSel: {mid: 'lx', cpus: CCD1}, gpuSel: {mid: 'lx', keys: ['gpu0']}});
  try {
    assert.deepEqual((await state(p)).pids, [106]);
    await p.click('#dfbar [data-dfclear="gpu"]');
    assert.deepEqual(await state(p), {pids: CCD1_PIDS, chips: ['cpu: Last ran on CCD 1'], notes: [], bar: ['cpu: CCD 1 ×'], clearAll: false, marked: ['cpu']});
    assert.equal(await p.eval(`document.querySelector('[data-gsel="gpu0"]').getAttribute('aria-pressed')`), 'false', 'the GPU is no longer selected');
    await p.click('[data-gsel="gpu0"]');
    await p.click('#dfbar [data-dfclear="cpu"]');
    assert.deepEqual(await state(p), {pids: [104, 106, 109], chips: ['gpu: On GPU 0'], notes: [], bar: ['gpu: GPU 0 ×'], clearAll: false, marked: ['gpu']});
    await p.click('.dpanel [data-dfclear="gpu"]');
    assert.deepEqual(await state(p), {pids: ALL_LX, chips: [], notes: [], bar: null, clearAll: false, marked: []});
  } finally { await p.close(); }
});

test('Clear all clears both', async () => {
  const p = await open({cpuSel: {mid: 'lx', cpus: CCD1}, gpuSel: {mid: 'lx', keys: ['gpu1']}});
  try {
    await p.click('#dfbar [data-dfclear="all"]');
    assert.deepEqual(await state(p), {pids: ALL_LX, chips: [], notes: [], bar: null, clearAll: false, marked: []});
    assert.deepEqual(await p.eval(`[S.cpuSel, S.gpuSel]`), [null, null]);
  } finally { await p.close(); }
});

test('the bar stays while another view is shown, since Details is still filtered', async () => {
  const p = await open({cpuSel: {mid: 'lx', cpus: [4]}, gpuSel: {mid: 'lx', keys: ['gpu0']}});
  try {
    await p.click('#metrics [data-metric="mem"]');
    assert.deepEqual(await state(p), {pids: [], chips: ['cpu: Last ran on CPU 4', 'gpu: On GPU 0'], notes: [], bar: ['cpu: CPU 4 ×', 'gpu: GPU 0 ×'], clearAll: true, marked: ['cpu', 'gpu']});
  } finally { await p.close(); }
});

test('no bar and no marks when nothing is filtered by them', async () => {
  let p = await open({detailsDocked: false, cpuSel: {mid: 'lx', cpus: CCD1}, gpuSel: {mid: 'lx', keys: ['gpu0']}});
  try {
    assert.deepEqual(await p.eval(`({bar: ${STATE}.bar, marked: ${STATE}.marked, panel: !!document.querySelector('.dpanel')})`), {bar: null, marked: [], panel: false}, 'Details not docked');
  } finally { await p.close(); }
  p = await open({sel: 'lx2', cpuSel: {mid: 'lx', cpus: CCD1}, gpuSel: {mid: 'lx', keys: ['gpu0']}});
  try {
    await p.waitFor(`${PIDS}.length && ${PIDS}[0] > 200`);
    assert.deepEqual(await state(p), {pids: ALL_LX.map(x => x + 100), chips: [], notes: [], bar: null, clearAll: false, marked: []}, 'Details shows another machine');
  } finally { await p.close(); }
});

test('Windows reports GPUs per process (not the last CPU): the GPU filter works there', async () => {
  const p = await open({sel: 'win'});
  try {
    await p.click('[data-gsel="gpu0"]');
    assert.deepEqual(await state(p), {pids: [304, 305, 306, 309], chips: ['gpu: On GPU 0'], notes: [], bar: ['gpu: GPU 0 ×'], clearAll: false, marked: ['gpu']});
  } finally { await p.close(); }
});

test('a host that doesn\'t report GPUs per process says so, and Details stays unfiltered by it', async () => {
  const p = await open({sel: 'mac'});
  try {
    await p.click('[data-gsel="gpu0"]');
    assert.deepEqual(await state(p), {pids: ALL_LX.map(x => x + 300), chips: ['gpu: On GPU 0'], notes: ['macOS doesn’t report which GPU a process uses, so Details isn’t filtered by GPU 0.'],
      bar: ['gpu: GPU 0 ×'], clearAll: false, marked: ['gpu']});
    assert.equal(await p.eval(`document.querySelector('#dfbar [data-barchip="gpu"]').classList.contains('na')`), true, 'the bar shows it as not applied');
  } finally { await p.close(); }
});

test('disks (their Each disk view) combine with the CPU filter the same way', async () => {
  const p = await open({cpuSel: {mid: 'lx', cpus: CCD1}, diskSel: {mid: 'lx', names: ['nvme0n1']}});
  try {
    assert.deepEqual(await state(p), {pids: [103, 101, 111], chips: ['cpu: Last ran on CCD 1', 'disk: I/O on nvme0n1'], notes: [],
      bar: ['cpu: CCD 1 ×', 'disk: nvme0n1 ×'], clearAll: true, marked: ['cpu', 'disk']});
    await p.click('#dfbar [data-dfclear="disk"]');
    assert.deepEqual((await state(p)).pids, CCD1_PIDS);
  } finally { await p.close(); }
});

test('the full Details view is filtered too, and the bar says so', async () => {
  const p = await open({detailsDocked: false, view: 'details', gpuSel: {mid: 'lx', keys: ['gpu1']}});
  try {
    await p.waitFor(`PROCS.machine === 'lx' && document.querySelector('.ptbl')`);
    assert.deepEqual(await state(p), {pids: [105, 106], chips: [], notes: [], bar: ['gpu: GPU 1 ×'], clearAll: false, marked: ['gpu']});
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('[data-fchip]')].map(c => c.textContent)`), ['On GPU 1']);
  } finally { await p.close(); }
});
