// SPDX-License-Identifier: GPL-3.0-or-later
// What a monitored host reports is data, never markup: the Details table shows every value as text (#166), and
// what it reports about itself (here its GPUs' names) is shown as text, never run as markup (#91): an admin of any
// machine or VM guest can name a device `<img src=x onerror=...>`.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch, sleep} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const IMG = '<img src=x onerror="window.__xss=(window.__xss||[]).concat(1)">';
const SVG = '<svg onload="window.__xss=(window.__xss||[]).concat(2)"></svg>';
const QUOTE = '"><img src=x onerror="window.__xss=(window.__xss||[]).concat(3)">';

test('Threads, Parent PID and PID show what the host sent as text', async () => {
  const fx = fixture();
  fx.fleet.prefs = {columns: {cpu: ['name', 'pid', 'threads', 'ppid', 'cmd']}};
  const rows = fx.procs.win.procs;   // nginx 301 and 302, postgres 303, ...
  rows[0][8] = IMG;      // threads
  rows[0][11] = SVG;     // ppid
  rows[1][0] = QUOTE;    // pid (also the row's data-pid)
  const p = await browser.page(fx, {ui: ui({sel: 'win', view: 'details'})});
  try {
    await p.waitFor(`document.querySelectorAll('.ptbl tbody tr[data-pid]').length === ${rows.length}`);
    await sleep(300);   // an injected image's onerror would have fired by now
    const cells = await p.eval(`(() => {
      const keys = [...document.querySelectorAll('.ptbl thead th')].map(th => th.dataset.colk);
      return [...document.querySelectorAll('.ptbl tbody tr[data-pid]')].map(tr => Object.fromEntries([...tr.children].map((td, i) => [keys[i], td.textContent]))).filter(c => c.name === 'nginx');
    })()`);
    assert.deepEqual(cells.map(c => [c.pid, c.threads, c.ppid]).sort(), [[QUOTE, '2', '1'], ['301', IMG, SVG]].sort());
    assert.deepEqual(await p.eval(`[document.querySelectorAll('.ptbl tbody img, .ptbl tbody svg').length, window.__xss || []]`), [0, []]);
    assert.deepEqual(await p.eval(`document.querySelector('.ptbl tbody tr[data-pid="301"] td:nth-child(3)').textContent`), IMG);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the same columns for ordinary rows: numbers, and — when there are none', async () => {
  const fx = fixture();
  fx.fleet.prefs = {columns: {cpu: ['pid', 'threads', 'ppid', 'lastcpu']}};
  fx.procs.win.procs[0][8] = 0;      // no thread count
  fx.procs.win.procs[0][11] = 0;     // no parent
  fx.procs.lx.procs[0][12] = 7;
  for (const [sel, want] of [['win', ['301', '—', '—', '—']], ['lx', ['101', '2', '1', 'cpu7']]]){
    const p = await browser.page(fx, {ui: ui({sel, view: 'details'})});
    try {
      await p.waitFor(`document.querySelectorAll('.ptbl tbody tr[data-pid]').length > 0`);
      const n = want[0];
      assert.deepEqual(await p.eval(`[...document.querySelector('.ptbl tbody tr[data-pid="${n}"]').children].map(td => td.textContent)`), want, sel);
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  }
});

test('Which GPU shows what the host sent as text, and the GPUs of ordinary rows', async () => {
  // #307: 'Which GPU' is one of the GPU layout's default columns
  const fx = fixture();
  fx.procs.lx.procs[0][13] = [IMG];   // nginx 101
  const p = await browser.page(fx, {ui: ui({sel: 'lx', metric: 'gpu', view: 'details'})});
  try {
    await p.waitFor(`document.querySelectorAll('.ptbl tbody tr[data-pid]').length === ${fx.procs.lx.procs.length}`);
    await sleep(300);   // an injected image's onerror would have fired by now
    const gpus = await p.eval(`(() => {
      const i = [...document.querySelectorAll('.ptbl thead th')].findIndex(th => th.dataset.colk === 'gpus');
      return Object.fromEntries([...document.querySelectorAll('.ptbl tbody tr[data-pid]')].map(tr => [tr.dataset.pid, tr.children[i].textContent]));
    })()`);
    const none = Object.fromEntries(fx.procs.lx.procs.map(r => [String(r[0]), '—']));
    assert.deepEqual(gpus, Object.assign(none, {101: 'GPU' + IMG, 104: 'GPU0', 105: 'GPU1', 106: 'GPU0+1', 109: 'GPU0'}));
    assert.deepEqual(await p.eval(`[document.querySelectorAll('.ptbl tbody img, .ptbl tbody svg').length, window.__xss || []]`), [0, []]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the processes on picked processors, interfaces and disks show a host\'s PID as text', async () => {
  // #307: these cards list /api/procs rows too. nginx 101 last ran on CPU 4, talks via eth0 and did I/O on nvme0n1.
  for (const [card, over, want] of [
    ['processors', {metric: 'cpu', cpuView: 'logical', cpuSel: {mid: 'lx', cpus: [4]}}, [['nginx', IMG], ['kworker/4:1', '110']]],
    ['interfaces', {metric: 'net', ifView: 'each', ifSel: {mid: 'lx', names: ['eth0']}},
      [['python3', '105'], ['nginx', IMG], ['nginx', '102'], ['sshd', '107']]],
    ['disks', {metric: 'disk', diskView: 'each', diskSel: {mid: 'lx', names: ['nvme0n1']}}, [['nginx', IMG], ['postgres', '103'], ['redis-server', '111']]]]){
    const fx = fixture();
    fx.procs.lx.procs[0][0] = IMG;
    const p = await browser.page(fx, {ui: ui(Object.assign({sel: 'lx'}, over))});
    try {
      const TABLE = `[...document.querySelectorAll('#main table.tbl')].filter(t => [...t.querySelectorAll('thead th')].some(th => th.textContent === 'PID'))`;
      const ROWS = `${TABLE}.flatMap(t => [...t.querySelectorAll('tbody tr')].map(r => [r.cells[0].textContent, r.cells[1].textContent]))`;
      await p.waitFor(`${ROWS}.length === ${want.length}`);
      await sleep(300);   // an injected image's onerror would have fired by now
      assert.deepEqual(await p.eval(ROWS), want, card);
      assert.deepEqual(await p.eval(`[document.querySelectorAll('#main table.tbl tbody img').length, window.__xss || []]`), [0, []], card);
      assert.deepEqual(p.errors, [], card);
    } finally { await p.close(); }
  }
});

// ---- the names of a host's GPUs (#91)
const H = 60, flat = v => new Array(H).fill(v);
const EVIL0 = 'NVIDIA <img src=x onerror="window.__xss=(window.__xss||0)+1">';
const EVIL1 = 'A & B <b id="inj">card</b>';
// lx's GPUs get names a hostile host could report; web runs on both, db (a second container) on GPU 1 only,
// idle (a third) on none
function fx2(){
  const fx = fixture(), lx = fx.fleet.machines.find(m => m.id === 'lx');
  lx.gpus = [{name: EVIL0, mem: '16 GB VRAM'}, {name: EVIL1, mem: '12 GB VRAM'}];
  lx.containers = [
    {id: 'lx/containers/web', name: 'web', image: 'nginx:1', status: 'Up 2 hours', g: ['gpu0', 'gpu1'], h: {cpu: flat(0.2), gpu: flat(30)}},
    {id: 'lx/containers/db', name: 'db', image: 'postgres:16', status: 'Up 2 hours', g: ['gpu1'], h: {cpu: flat(0.1), gpu: flat(10)}},
    {id: 'lx/containers/idle', name: 'idle', image: 'busybox:1', status: 'Up 2 hours', g: [], h: {cpu: flat(0.01)}}];
  return fx;
}
const DD = dt => `(() => { const t = [...document.querySelectorAll('#main .dl dt')].find(e => e.textContent === ${JSON.stringify(dt)}); return t ? t.nextElementSibling.textContent : null; })()`;
const INJECTED = `({img: document.querySelectorAll('#main img, #tree img').length, b: document.querySelectorAll('#inj').length, ran: window.__xss || 0})`;
async function open(fx, sel, metric = 'cpu'){
  const p = await browser.page(fx, {ui: ui({sel, metric, open: {lx: true, 'lx/containers': true}})});
  try { await p.waitFor(`document.querySelector('#main .hero h1')`); } catch (e) { await p.close(); throw e; }
  return p;
}

test('a container\'s Details card shows its GPUs\' reported names as text, exactly', async () => {
  const p = await open(fx2(), 'lx/containers/web');
  try {
    await p.waitFor(`${DD('GPU')} != null`);
    assert.equal(await p.eval(DD('GPU')), `GPU 0 (${EVIL0}) + GPU 1 (${EVIL1})`);
    await sleep(200);   // an injected onerror would have fired by now
    assert.deepEqual(await p.eval(INJECTED), {img: 0, b: 0, ran: 0});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('one GPU, no GPU in use, and the GPU tile beside it (the controls) are all text too', async () => {
  const fx = fx2();
  let p = await open(fx, 'lx/containers/db');
  try {
    await p.waitFor(`${DD('GPU')} != null`);
    assert.equal(await p.eval(DD('GPU')), `GPU 1 (${EVIL1})`);
    const tile = await p.eval(`[...document.querySelectorAll('#main .tiles .st')].find(t => t.querySelector('.k').textContent === 'GPU').querySelector('.s').textContent`);
    assert.equal(tile, `on GPU 1 (${EVIL1})`);
    assert.deepEqual(await p.eval(INJECTED), {img: 0, b: 0, ran: 0});
  } finally { await p.close(); }
  p = await open(fx, 'lx/containers/idle');
  try {
    await p.waitFor(`${DD('GPU')} != null`);
    assert.equal(await p.eval(DD('GPU')), 'none in use');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('with GPU picked, the tree\'s GPU tags and the machine\'s GPU card show the names as text', async () => {
  const p = await open(fx2(), 'lx', 'gpu');
  try {
    await p.waitFor(`document.querySelector('#tree .row[data-select="lx/containers/web"] .gtag')`);
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#tree .row[data-select^="lx/containers/"] .gtag')].map(g => [g.closest('.row').dataset.select, g.textContent, g.title])`),
      [['lx/containers/db', 'GPU1', `GPU 1 (${EVIL1})`], ['lx/containers/web', 'GPU0+1', `GPU 0 (${EVIL0}) + GPU 1 (${EVIL1})`]]);
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#main .gpus .gn')].map(e => e.textContent)`), [EVIL0, EVIL1]);
    await sleep(200);
    assert.deepEqual(await p.eval(INJECTED), {img: 0, b: 0, ran: 0});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
