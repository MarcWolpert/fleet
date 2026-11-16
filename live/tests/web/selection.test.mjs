// SPDX-License-Identifier: GPL-3.0-or-later
// A refresh rebuilds the main pane every couple of seconds. Text someone has selected there (an image name, a cron
// command, a command line in Details, a Compose file to copy) survives it (#134, #155): it stays on its own process
// row when the rows re-sort, and goes when that process exits. Anything you do still redraws at once.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui, PIDS} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const H = 60, flat = v => new Array(H).fill(v);
function fx2(){
  const fx = fixture(), lx = fx.fleet.machines.find(m => m.id === 'lx');
  lx.containers = [{id: 'lx/containers/web', name: 'web', image: 'registry.example/team/web:1.4.2', status: 'Up 2 hours', g: [], h: {cpu: flat(0.4)}}];
  lx.baseCron = [{id: 'lx/base/cron/0', name: 'backup', sched: '0 3 * * *', human: 'daily at 03:00', cmd: '/usr/local/bin/backup --all --to /mnt/backups',
    last: '', running: true, state: 'running', src: 'crontab', g: [], h: {cpu: flat(0.2)}}];
  return fx;
}
const setCpu = (fx, i, v) => { const lx = fx.fleet.machines.find(m => m.id === 'lx'); (i === 'web' ? lx.containers[0] : lx.baseCron[0]).h.cpu = flat(v); };
const SELECT = sel => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); const r = document.createRange(); r.selectNodeContents(e); getSelection().removeAllRanges(); getSelection().addRange(r); return getSelection().toString(); })()`;
const SELECTED = `getSelection().toString()`;
const TILE = k => `[...document.querySelectorAll('#main .tiles .st')].find(t => t.querySelector('.k').textContent === ${JSON.stringify(k)}).querySelector('.v').textContent`;
const IMAGE = `#main .dl dd code`;
async function open(fx, sel, opts = {}){
  const p = await browser.page(fx, Object.assign({ui: ui({sel, open: {lx: true, 'lx/containers': true, 'lx/base': true, 'lx/base/cron': true}})}, opts));
  try { await p.waitFor(`document.querySelector('#main .hero h1') && document.querySelector('#tree .row')`); } catch (e) { await p.close(); throw e; }
  return p;
}

test('an image name stays selected across refreshes; the next refresh after it is let go shows the new reading', async () => {
  const fx = fx2();
  const p = await open(fx, 'lx/containers/web');
  try {
    assert.equal(await p.eval(TILE('CPU')), '0.40 cores');
    assert.equal(await p.eval(SELECT(IMAGE)), 'registry.example/team/web:1.4.2');
    setCpu(fx, 'web', 0.9);
    await p.eval(`(refreshNow(), true)`);
    await p.waitFor(`document.querySelector('#tree [data-val="lx/containers/web"]').textContent === '5.6%'`);   // the refresh came in: the tree has it
    await p.eval(`(refreshNow(), true)`);
    await p.waitFor(`!busy`);
    assert.equal(await p.eval(SELECTED), 'registry.example/team/web:1.4.2');
    assert.equal(await p.eval(`document.querySelector(${JSON.stringify(IMAGE)}) === getSelection().anchorNode || document.querySelector(${JSON.stringify(IMAGE)}).contains(getSelection().anchorNode)`), true);
    assert.equal(await p.eval(TILE('CPU')), '0.40 cores');
    await p.eval(`(getSelection().removeAllRanges(), refreshNow(), true)`);
    await p.waitFor(`${TILE('CPU')} === '0.90 cores'`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a cron command stays selected the same way', async () => {
  const fx = fx2();
  const p = await open(fx, 'lx/base/cron/0');
  try {
    const cmd = `[...document.querySelectorAll('#main .dl dt')].find(e => e.textContent === 'Command').nextElementSibling.querySelector('code')`;
    assert.equal(await p.eval(`(() => { const r = document.createRange(); r.selectNodeContents(${cmd}); getSelection().removeAllRanges(); getSelection().addRange(r); return getSelection().toString(); })()`),
      '/usr/local/bin/backup --all --to /mnt/backups');
    setCpu(fx, 'cron', 0.7);
    await p.eval(`(refreshNow(), true)`);
    await p.waitFor(`document.querySelector('#tree [data-val="lx/base/cron/0"]') && document.querySelector('#tree [data-val="lx/base/cron/0"]').textContent === '4.4%'`);
    assert.equal(await p.eval(SELECTED), '/usr/local/bin/backup --all --to /mnt/backups');
    assert.equal(await p.eval(TILE('CPU')), '0.20 cores');
    await p.eval(`(getSelection().removeAllRanges(), refreshNow(), true)`);
    await p.waitFor(`${TILE('CPU')} === '0.70 cores'`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the controls: a selection outside the main pane doesn\'t hold it, and choosing something redraws at once', async () => {
  const fx = fx2();
  const p = await open(fx, 'lx/containers/web');
  try {
    assert.equal(await p.eval(SELECT('#tree .row[data-select="lx"] .nm')), 'lab-linux');
    setCpu(fx, 'web', 0.9);
    await p.eval(`(refreshNow(), true)`);
    await p.waitFor(`${TILE('CPU')} === '0.90 cores'`);
    assert.equal(await p.eval(SELECT(IMAGE)), 'registry.example/team/web:1.4.2');
    await p.eval(`(select('lx'), true)`);
    await p.waitFor(`document.querySelector('#main .hero h1').firstChild.textContent.trim() === 'lab-linux'`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

// ---- in Details and on a machine page (#155)

// select characters a..b (b null: to the end) of the first text under the element, as a person would
const select = (p, sel, a, b = null) => p.eval(`(() => { const t = document.querySelector(${JSON.stringify(sel)}), n = document.createTreeWalker(t, NodeFilter.SHOW_TEXT).nextNode();
  const r = document.createRange(); r.setStart(n, ${a}); r.setEnd(n, ${b == null ? 'n.length' : b}); getSelection().removeAllRanges(); getSelection().addRange(r); return getSelection().toString(); })()`);
const SEL = `(() => { const s = getSelection(), row = n => n && (n.nodeType === 1 ? n : n.parentElement).closest('tr[data-pid]');
  return {text: s.toString(), rows: s.rangeCount ? [row(s.anchorNode), row(s.focusNode)].map(r => r ? +r.dataset.pid : null) : [], inPage: s.rangeCount ? document.contains(s.anchorNode) && document.contains(s.focusNode) : null}; })()`;
const CMD = pid => `.ptbl tr[data-pid="${pid}"] td.cmd span`;
const procOf = (fx, pid) => fx.procs.lx.procs.find(p => p[0] === pid);

async function details(fx, opts = {}){
  const p = await browser.page(fx, Object.assign({ui: ui({view: 'details'})}, opts));
  await p.waitFor(`${PIDS}.length === 12`);
  return p;
}
async function refresh(p, until){ await p.eval(`(refreshNow(), true)`); await p.waitFor(until); }

test('a command line selected in Details is still selected after a refresh that changed the numbers', async () => {
  const fx = fixture();
  const p = await details(fx);
  try {
    assert.equal(await select(p, CMD(103), 0), '/usr/bin/postgres --id 103');
    procOf(fx, 101)[4] = 0.42;                                   // a new reading: every row is rebuilt
    await refresh(p, `document.querySelector('tr[data-pid="101"]').textContent.includes('2.6%')`);
    assert.deepEqual(await p.eval(SEL), {text: '/usr/bin/postgres --id 103', rows: [103, 103], inPage: true});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the selection follows its process when the rows re-sort, part of a command line too', async () => {
  const fx = fixture();
  const p = await details(fx);
  try {
    assert.equal(await select(p, CMD(103), 9, 17), 'postgres');
    procOf(fx, 103)[4] = 3.0;                                    // postgres jumps to the top of the CPU sort
    await refresh(p, `${PIDS}[0] === 103`);
    assert.deepEqual(await p.eval(SEL), {text: 'postgres', rows: [103, 103], inPage: true});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a drag that a refresh lands in the middle of goes on selecting the same text', async () => {
  const fx = fixture();
  const p = await details(fx);
  try {
    const r = await p.eval(`(() => { const g = document.createRange(); g.selectNodeContents(document.querySelector(${JSON.stringify(CMD(103))})); const b = g.getBoundingClientRect(); return {x0: b.left + 1, x1: b.right - 1, y: b.top + b.height / 2}; })()`);
    const mouse = (type, x, o) => p.send('Input.dispatchMouseEvent', Object.assign({type, x, y: r.y, button: 'left', clickCount: 1}, o));
    await mouse('mouseMoved', r.x0, {button: 'none', buttons: 0});
    await mouse('mousePressed', r.x0, {buttons: 1});
    await mouse('mouseMoved', (r.x0 + r.x1) / 2, {buttons: 1});
    procOf(fx, 101)[4] = 0.42;                                   // the poll lands mid-drag
    await refresh(p, `document.querySelector('tr[data-pid="101"]').textContent.includes('2.6%')`);
    await mouse('mouseMoved', r.x1, {buttons: 1});
    await mouse('mouseReleased', r.x1, {buttons: 0});
    assert.deepEqual(await p.eval(SEL), {text: '/usr/bin/postgres --id 103', rows: [103, 103], inPage: true});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the docked Details keeps it too, beside a machine page that is rebuilt', async () => {
  const fx = fixture();
  const p = await browser.page(fx, {ui: ui({detailsDocked: true})});
  try {
    await p.waitFor(`document.querySelectorAll('.dpanel .ptbl tbody tr[data-pid]').length === 12`);
    assert.equal(await select(p, '.dpanel ' + CMD(106), 0), '/usr/bin/ffmpeg --id 106');
    procOf(fx, 101)[4] = 0.42;
    await refresh(p, `document.querySelector('.dpanel tr[data-pid="101"]').textContent.includes('2.6%')`);
    assert.deepEqual(await p.eval(SEL), {text: '/usr/bin/ffmpeg --id 106', rows: [106, 106], inPage: true});
  } finally { await p.close(); }
});

test('text selected on a machine page (not in a process row) survives a refresh', async () => {
  const fx = fixture();
  const p = await browser.page(fx, {ui: ui()});
  try {
    await p.waitFor(`document.querySelector('#main .hero h1')`);
    assert.equal(await select(p, '#main .hero h1', 0, 9), 'lab-linux');
    fx.fleet.machines.find(m => m.id === 'lx').uptime = '4 days';
    await refresh(p, `document.querySelector('#main .hero .facts').textContent.includes('up 4 days')`);
    assert.deepEqual(await p.eval(SEL), {text: 'lab-linux', rows: [null, null], inPage: true});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('nothing else: when the selected process exits, nothing is selected (not another row)', async () => {
  const fx = fixture();
  const p = await details(fx);
  try {
    await select(p, CMD(103), 0);
    fx.procs.lx.procs = fx.procs.lx.procs.filter(q => q[0] !== 103);
    await refresh(p, `${PIDS}.length === 11`);
    assert.equal((await p.eval(SEL)).text, '');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the list keeps its scroll in the full Details view as well (#18)', async () => {
  const fx = fixture();
  const p = await details(fx, {height: 480});
  try {
    const top = await p.eval(`(() => { const s = document.querySelector('.pscroll'); s.scrollTop = 120; return s.scrollTop; })()`);
    assert.ok(top > 50, `the list scrolls (${top})`);
    procOf(fx, 101)[4] = 0.42;
    await refresh(p, `document.querySelector('tr[data-pid="101"]').textContent.includes('2.6%')`);
    assert.equal(await p.eval(`document.querySelector('.pscroll').scrollTop`), top);
  } finally { await p.close(); }
});
