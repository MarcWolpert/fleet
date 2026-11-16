// SPDX-License-Identifier: GPL-3.0-or-later
// Details columns: a layout per detail type (CPU, Memory, GPU, Disk I/O, Network), arranged from a
// right-click menu on the column headers, saved by the server (/api/prefs → ~/.config/fleet/ui.json).
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch, heldPoll} from './harness.mjs';
import {fixture, ui, PIDS} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const HEADS = `[...document.querySelectorAll('.ptbl thead th')].map(th => th.textContent.replace(/[↓↑]/g, '').trim())`;
const KEYS = `[...document.querySelectorAll('.ptbl thead th')].map(th => th.dataset.colk)`;
const MENU = `(() => { const m = document.getElementById('colmenu'); return m && !m.hidden ? {title: m.querySelector('.cm-h').firstChild.textContent.trim(), quick: (m.querySelector('.cm-quick b') || {}).textContent || '', on: [...m.querySelectorAll('[data-colvis]')].filter(c => c.checked).map(c => c.dataset.colvis)} : null; })()`;
const lastPost = fx => { const ps = (fx.posts || []).filter(x => x.path === '/api/prefs'); return ps.length ? JSON.parse(ps[ps.length - 1].body) : null; };
const rightClick = (p, key) => p.eval(`(() => { const th = document.querySelector('.ptbl thead th[data-colk=${JSON.stringify(key)}]'); const r = th.getBoundingClientRect(); th.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5})); return true; })()`);
const click = (p, sel) => p.eval(`(() => { document.querySelector(${JSON.stringify(sel)}).click(); return true; })()`);
const tick = (p, key, on) => p.eval(`(() => { const c = document.querySelector('[data-colvis=${JSON.stringify(key)}]'); c.checked = ${on}; c.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);

async function open(over = {}, fx = fixture()){
  const p = await browser.page(fx, {ui: ui(Object.assign({view: 'details'}, over))});
  await p.waitFor(`document.querySelectorAll('.ptbl tbody tr').length > 0`);
  return p;
}

test('each detail type has its own default columns', async () => {
  const want = {
    cpu: ['Name', 'PID', 'Runs in', 'User', 'Status', 'CPU', 'Memory', 'Threads', 'CPU group', 'Command line'],
    mem: ['Name', 'PID', 'Runs in', 'User', 'Memory', 'CPU', 'Threads', 'Command line'],
    gpu: ['Name', 'PID', 'Runs in', 'GPU', 'Which GPU', 'CPU', 'Memory', 'Command line'],
    disk: ['Name', 'PID', 'Runs in', 'Disk', 'Disks used', 'CPU', 'Memory', 'Command line'],
    net: ['Name', 'PID', 'Runs in', 'Network', 'Interfaces', 'CPU', 'Memory', 'Command line']
  };
  for (const [metric, heads] of Object.entries(want)){
    const p = await open({metric});
    try {
      assert.deepEqual(await p.eval(HEADS), heads, metric);
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  }
});

test('right-clicking a header opens the Columns menu for that type, with the column picked out', async () => {
  const p = await open({metric: 'disk'});
  try {
    await rightClick(p, 'disks');
    assert.deepEqual(await p.eval(MENU), {title: 'Columns · Disk I/O details', quick: 'Disks used', on: ['name', 'pid', 'owner', 'disk', 'disks', 'cpu', 'mem', 'cmd']});
    await p.eval(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); return true; })()`);
    assert.equal(await p.eval(MENU), null);
  } finally { await p.close(); }
});

test('hide, move and add change only this type, and are saved to the server', async () => {
  const fx = fixture();
  const p = await open({metric: 'cpu'}, fx);
  try {
    await rightClick(p, 'user');
    await click(p, '[data-colact="hide|user"]');
    assert.deepEqual(await p.eval(KEYS), ['name', 'pid', 'owner', 'state', 'cpu', 'mem', 'threads', 'cpugroup', 'cmd']);
    await click(p, '[data-colact="right|name"]');
    assert.deepEqual((await p.eval(KEYS)).slice(0, 3), ['pid', 'name', 'owner']);
    await tick(p, 'ppid', true);
    assert.deepEqual((await p.eval(KEYS)).slice(-2), ['cmd', 'ppid']);
    await p.waitFor(`true`);
    const saved = lastPost(fx);
    assert.deepEqual(saved.columns, {cpu: ['pid', 'name', 'owner', 'state', 'cpu', 'mem', 'threads', 'cpugroup', 'cmd', 'ppid']});
    // the other types keep their defaults
    // a metric pill shows that metric's overview; Details opens again on that type, with its own layout
    await p.eval(`(() => { document.querySelector('[data-colact="close|"]').click(); document.querySelector('[data-metric="mem"]').click(); document.querySelector('[data-details]').click(); return true; })()`);
    await p.waitFor(`document.querySelectorAll('.ptbl thead th').length > 0`);
    assert.deepEqual(await p.eval(KEYS), ['name', 'pid', 'owner', 'user', 'mem', 'cpu', 'threads', 'cmd']);
    // rows still say which process they are, whatever the column order
    assert.equal((await p.eval(PIDS)).length > 0, true);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a layout the server already has is used as is (it survives restarts), and never hides the last column', async () => {
  const fx = fixture();
  fx.fleet.prefs = {columns: {cpu: ['name', 'cpu', 'pid'], net: ['pid']}};
  let p = await open({metric: 'cpu'}, fx);
  try {
    assert.deepEqual(await p.eval(HEADS), ['Name', 'CPU', 'PID']);
  } finally { await p.close(); }
  p = await open({metric: 'net', group: 'user'}, fx);
  try {
    assert.deepEqual(await p.eval(KEYS), ['pid']);
    // group header rows span exactly the visible columns
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('.ptbl tr.gh td')].map(td => td.colSpan)`).then(a => [...new Set(a)]), [1]);
    await rightClick(p, 'pid');
    assert.equal(await p.eval(`document.querySelector('[data-colvis="pid"]').disabled`), true);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Reset to default restores the type\'s default columns', async () => {
  const fx = fixture();
  fx.fleet.prefs = {columns: {gpu: ['cmd', 'name']}};
  const p = await open({metric: 'gpu'}, fx);
  try {
    assert.deepEqual(await p.eval(KEYS), ['cmd', 'name']);
    await rightClick(p, 'name');
    await click(p, '[data-colact="reset|"]');
    assert.deepEqual(await p.eval(KEYS), ['name', 'pid', 'owner', 'gpu', 'gpus', 'cpu', 'mem', 'cmd']);
    assert.deepEqual(lastPost(fx).columns.gpu, ['name', 'pid', 'owner', 'gpu', 'gpus', 'cpu', 'mem', 'cmd']);
  } finally { await p.close(); }
});

test('a poll the server answered before a column change was saved doesn\'t bring the old layout back', async () => {
  // The server reads ui.json as it builds /api/fleet and sends it after; a save can start and finish in between.
  const fx = fixture();
  const p = await open({metric: 'cpu'}, fx);
  const noUser = ['name', 'pid', 'owner', 'state', 'cpu', 'mem', 'threads', 'cpugroup', 'cmd'];
  try {
    fx.holdFleet = true;
    const stale = await heldPoll(p, fx);  // made with the default layout
    await rightClick(p, 'user');
    await click(p, '[data-colact="hide|user"]');
    await p.waitFor(`!prefsBusy`);
    assert.deepEqual(fx.fleet.prefs, {columns: {cpu: noUser}});
    stale();
    await heldPoll(p, fx);  // the page polls again, so the stale answer has been read and drawn
    assert.deepEqual(await p.eval(KEYS), noUser);
    // and the next change builds on the new layout
    await click(p, '[data-colact="right|name"]');
    await p.waitFor(`!prefsBusy`);
    assert.deepEqual(fx.fleet.prefs, {columns: {cpu: ['pid', 'name', 'owner', 'state', 'cpu', 'mem', 'threads', 'cpugroup', 'cmd']}});
    assert.deepEqual(await p.eval(KEYS), ['pid', 'name', 'owner', 'state', 'cpu', 'mem', 'threads', 'cpugroup', 'cmd']);
    assert.deepEqual(p.errors, []);
  } finally { fx.holdFleet = false; (fx.held || []).splice(0).forEach(send => send()); await p.close(); }
});
