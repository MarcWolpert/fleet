// SPDX-License-Identifier: GPL-3.0-or-later
// Right-click menus (issue #7): one menu system; what's in the menu depends on what you clicked.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

// right-click an element; returns whether the page took the event (a menu of its own)
const rclick = (p, sel) => p.eval(`(() => { const e = typeof ${JSON.stringify(sel)} === 'string' ? document.querySelector(${JSON.stringify(sel)}) : null; const r = e.getBoundingClientRect(); const ev = new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: r.left + 8, clientY: r.top + 8}); e.dispatchEvent(ev); return ev.defaultPrevented; })()`);
const MENU = `(() => { const m = document.getElementById('ctxmenu'); if (!m || m.hidden) return null; return {title: (m.querySelector('.cx-h') || {}).textContent || '', items: [...m.querySelectorAll('[role=menuitem], .cx-sep')].map(e => e.classList.contains('cx-sep') ? '—' : e.textContent.trim())}; })()`;
const pick = (p, label) => p.eval(`(() => { [...document.querySelectorAll('#ctxmenu [role=menuitem]')].find(e => e.textContent.trim() === ${JSON.stringify(label)}).click(); return true; })()`);
const row = name => `[...document.querySelectorAll('#tree .row')].find(r => r.querySelector('.nm').textContent === ${JSON.stringify(name)})`;
async function open(over, fx = fixture()){
  const p = await browser.page(fx, {ui: ui(over)});
  await p.waitFor(`document.querySelectorAll('#tree .row').length > 0 && document.querySelector('#main .hero')`);
  return p;
}

test('a process row: its drop-down, where it runs, and copying its PID, name or command line', async () => {
  const fx = fixture(); fx.proc = () => ({pid: 103, error: 'not needed here'});
  const p = await open({view: 'details', sel: 'lx'}, fx);
  try {
    await p.waitFor(`document.querySelectorAll('.ptbl tbody tr[data-pid]').length === 12`);
    assert.equal(await rclick(p, 'tr[data-pid="103"]'), true);
    assert.deepEqual(await p.eval(MENU), {title: 'postgres · PID 103', items: ['Show details', 'Show Base system in the tree', 'Show only Base system', '—', 'Copy PID', 'Copy name', 'Copy command line']});
    await pick(p, 'Copy command line');
    assert.equal(await p.eval(MENU), null);
    await p.waitFor(`(document.getElementById('toast') || {}).textContent === 'Copied the command line'`);
    assert.equal(await p.eval(`window.__fleetCopied`), '/usr/bin/postgres --id 103');
    await rclick(p, 'tr[data-pid="103"]');
    await pick(p, 'Show details');
    await p.waitFor(`document.querySelector('tr.pinsp')`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('tree rows: a machine, a container and the base system each get their own menu', async () => {
  const p = await open({sel: 'lx', open: {lx: true, 'lx/containers': true}});
  try {
    await rclick(p, `#tree .row[data-select="lx"]`);
    assert.deepEqual(await p.eval(MENU), {title: 'lab-linux', items: ['Open', 'Show its processes', 'Pin as a space', 'Open a terminal', 'Disconnect', '—', 'Copy name', 'Copy SSH destination']});
    await p.eval(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); return true; })()`);
    assert.equal(await p.eval(MENU), null);
    await p.waitFor(`document.querySelector('#tree .row[data-select="lx/containers/web"]')`);
    await rclick(p, `#tree .row[data-select="lx/containers/web"]`);
    assert.deepEqual(await p.eval(MENU), {title: 'web', items: ['Open', 'Show its processes', 'Pin as a space', 'Open a terminal', '—', 'Copy name']});
    await pick(p, 'Pin as a space');
    await p.waitFor(`document.querySelector('[data-space="lx/containers/web"]')`);
    await rclick(p, `#tree .row[data-select="lx/base"]`);
    assert.deepEqual(await p.eval(MENU), {title: 'Base system', items: ['Open', 'Show its processes', 'Pin as a space', '—', 'Copy name']});
    await pick(p, 'Show its processes');
    await p.waitFor(`document.querySelector('[data-details]').getAttribute('aria-pressed') === 'true'`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a CPU tile, a CCD and a space pill', async () => {
  const fx = fixture(); fx.fleet.pins = ['lx'];
  const p = await open({sel: 'lx', metric: 'cpu', cpuView: 'logical'}, fx);
  try {
    await p.waitFor(`document.querySelector('[data-lcpu="4"]')`);
    await rclick(p, '[data-lcpu="4"]');
    assert.deepEqual(await p.eval(MENU), {title: 'CPU 4', items: ['See what runs on CPU 4', 'Add CPU 4 to the selection', 'Pin CPU 4']});
    await pick(p, 'See what runs on CPU 4');
    await p.waitFor(`document.querySelector('[data-lcpu="4"]').getAttribute('aria-pressed') === 'true'`);
    await rclick(p, '[data-lgroup]');
    assert.deepEqual(await p.eval(MENU), {title: 'CCD 0', items: ['See what runs on CCD 0', 'Pin CCD 0']});
    await p.eval(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); return true; })()`);
    await rclick(p, '[data-space="lx"]');
    assert.deepEqual(await p.eval(MENU), {title: 'lab-linux', items: ['Open', 'Unpin']});
    await p.eval(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); return true; })()`);
    await rclick(p, '[data-space="fleet"]');
    assert.deepEqual(await p.eval(MENU), {title: 'All machines', items: ['Open']});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a GPU metric tile', async () => {
  const fx = fixture(), lx = fx.fleet.machines.find(m => m.id === 'lx');
  lx.gpus[0] = Object.assign({}, lx.gpus[0], {m: [['util', null, new Array(60).fill(3)], ['temp', null, new Array(60).fill(50)]]});
  const p = await open({sel: 'lx', metric: 'gpu', gpuView: 'each'}, fx);
  try {
    await p.waitFor(`document.querySelector('.ggroup [data-gm="temp"]')`);
    await rclick(p, '.ggroup[data-gpu="gpu0"] [data-gm="temp"]');
    assert.deepEqual(await p.eval(MENU), {title: 'GPU 0 · Temperature', items: ['See what runs on GPU 0', 'Pin Temperature']});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the keyboard opens it on what has focus, moves through it, runs an item; elsewhere the page leaves the right-click alone', async () => {
  const p = await open({sel: 'lx'});
  try {
    await p.eval(`(() => { document.querySelector('#tree .row[data-select="lx"] .nm').focus(); document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key: 'F10', shiftKey: true, bubbles: true, cancelable: true})); return true; })()`);
    await p.waitFor(`document.activeElement && document.activeElement.closest('#ctxmenu')`);
    assert.equal(await p.eval(`document.activeElement.textContent.trim()`), 'Open');
    await p.eval(`(() => { document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true})); return true; })()`);
    assert.equal(await p.eval(`document.activeElement.textContent.trim()`), 'Show its processes');
    await p.eval(`(() => { document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); return true; })()`);
    await p.waitFor(`document.querySelector('[data-details]').getAttribute('aria-pressed') === 'true'`);
    assert.equal(await p.eval(MENU), null);
    assert.equal(await rclick(p, '#main .hero h1'), false);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

// Tiles redraw on every poll, because their numbers change, and the menu stays open across that. So an item must act
// on the tile it names, not on the button the menu opened on: that one is gone by the time a person picks (#292).
const redraw = p => p.eval(`(() => { const was = CTX.origin; lastMainHTML = ''; renderMain(); return !!was && !was.isConnected; })()`);
async function stalePick(p, sel, label){
  await rclick(p, sel);
  assert.equal(await redraw(p), true, 'the redraw replaced the tile the menu opened on');
  await pick(p, label);
  assert.equal(await p.eval(MENU), null);
}
const TPIN = k => p => p.waitFor(`!tpinBusy && JSON.stringify(TPINS[${JSON.stringify(k)}] || [])`).then(JSON.parse);
const tpinsWith = async (p, k, want) => { await p.waitFor(`!tpinBusy && JSON.stringify(TPINS[${JSON.stringify(k)}] || []) === ${JSON.stringify(JSON.stringify(want))}`).catch(() => null); return TPIN(k)(p); };

test('a CPU tile and a CCD: every item still works after a poll redrew the tiles', async () => {
  const p = await open({sel: 'lx', metric: 'cpu', cpuView: 'logical'});
  try {
    await p.waitFor(`document.querySelector('[data-lcpu="4"]')`);
    const sel = () => p.eval(`JSON.stringify(S.cpuSel || null)`).then(JSON.parse);
    await stalePick(p, '[data-lcpu="4"]', 'See what runs on CPU 4');
    assert.deepEqual(await sel(), {mid: 'lx', cpus: [4]});
    await stalePick(p, '[data-lcpu="5"]', 'Add CPU 5 to the selection');
    assert.deepEqual(await sel(), {mid: 'lx', cpus: [4, 5]});
    await stalePick(p, '[data-lcpu="4"]', 'Take CPU 4 out of the selection');
    assert.deepEqual(await sel(), {mid: 'lx', cpus: [5]});
    await stalePick(p, '[data-lcpu="4"]', 'Pin CPU 4');
    assert.deepEqual(await tpinsWith(p, 'cpu|lx', ['4']), ['4']);
    await stalePick(p, '[data-lcpu="4"]', 'Unpin CPU 4');
    assert.deepEqual(await tpinsWith(p, 'cpu|lx', []), []);
    await stalePick(p, '[data-lgroup="4,5,6,7,12,13,14,15"]', 'See what runs on CCD 1');
    assert.deepEqual(await sel(), {mid: 'lx', cpus: [4, 5, 6, 7, 12, 13, 14, 15]});
    await stalePick(p, '[data-lgroup="4,5,6,7,12,13,14,15"]', 'Pin CCD 1');
    assert.deepEqual(await tpinsWith(p, 'cpugroup|lx', ['CCD 1']), ['CCD 1']);
    assert.deepEqual(await TPIN('cpu|lx')(p), []);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a GPU header and a GPU metric tile: every item still works after a poll redrew the tiles', async () => {
  const fx = fixture(), lx = fx.fleet.machines.find(m => m.id === 'lx');
  lx.gpus = lx.gpus.map(g => Object.assign({}, g, {m: [['util', null, new Array(60).fill(3)], ['temp', null, new Array(60).fill(50)]]}));
  const p = await open({sel: 'lx', metric: 'gpu', gpuView: 'each'}, fx);
  try {
    await p.waitFor(`document.querySelector('.ggroup[data-gpu="gpu1"] [data-gm="temp"]')`);
    const sel = () => p.eval(`JSON.stringify(S.gpuSel || null)`).then(JSON.parse);
    await stalePick(p, '.ggroup[data-gpu="gpu1"] .lgh', 'See what runs on GPU 1');
    assert.deepEqual(await sel(), {mid: 'lx', keys: ['gpu1']});
    await stalePick(p, '.ggroup[data-gpu="gpu0"] [data-gm="temp"]', 'See what runs on GPU 0');
    assert.deepEqual(await sel(), {mid: 'lx', keys: ['gpu0']});
    await stalePick(p, '.ggroup[data-gpu="gpu1"] .lgh', 'Pin GPU 1');
    assert.deepEqual(await tpinsWith(p, 'gpu|lx', ['gpu1']), ['gpu1']);
    await stalePick(p, '.ggroup[data-gpu="gpu0"] [data-gm="temp"]', 'Pin Temperature');
    assert.deepEqual(await tpinsWith(p, 'gpum|lx', ['gpu0:temp']), ['gpu0:temp']);
    assert.deepEqual(await sel(), {mid: 'lx', keys: ['gpu0']});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a disk tile and an interface tile: every item still works after a poll redrew the tiles', async () => {
  const p = await open({sel: 'lx', metric: 'disk', diskView: 'each'});
  try {
    await p.waitFor(`document.querySelector('[data-dsel="sda"]')`);
    const sel = k => p.eval(`JSON.stringify(S.${k} || null)`).then(JSON.parse);
    await stalePick(p, '[data-dsel="sda"]', 'See what runs on sda');
    assert.deepEqual(await sel('diskSel'), {mid: 'lx', names: ['sda']});
    await stalePick(p, '[data-dsel="nvme0n1"]', 'Add nvme0n1 to the selection');
    assert.deepEqual(await sel('diskSel'), {mid: 'lx', names: ['sda', 'nvme0n1']});
    await stalePick(p, '[data-dsel="sda"]', 'Take sda out of the selection');
    assert.deepEqual(await sel('diskSel'), {mid: 'lx', names: ['nvme0n1']});
    await stalePick(p, '[data-dsel="sda"]', 'Pin sda');
    assert.deepEqual(await tpinsWith(p, 'disk|lx', ['sda']), ['sda']);
    await p.eval(`(() => { S.metric = 'net'; S.ifView = 'each'; save(); renderAll(); refreshNow(); return true; })()`);
    await p.waitFor(`document.querySelector('[data-isel="docker0"]')`);
    await stalePick(p, '[data-isel="eth0"]', 'See what runs on eth0');
    assert.deepEqual(await sel('ifSel'), {mid: 'lx', names: ['eth0']});
    await stalePick(p, '[data-isel="docker0"]', 'Add docker0 to the selection');
    assert.deepEqual(await sel('ifSel'), {mid: 'lx', names: ['eth0', 'docker0']});
    await stalePick(p, '[data-isel="docker0"]', 'Pin docker0');
    assert.deepEqual(await tpinsWith(p, 'net|lx', ['docker0']), ['docker0']);
    assert.deepEqual(await sel('diskSel'), {mid: 'lx', names: ['nvme0n1']});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
