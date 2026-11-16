// SPDX-License-Identifier: GPL-3.0-or-later
// #334: Details columns have a divider between header cells; dragging one resizes the column to its left (kept
// per detail type, double-click resets it), dragging a header onto another moves the column there, and both
// have keyboard equivalents that are announced. Polls never undo a drag or a width, and nothing jumps mid-drag.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch, heldPoll, sleep} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const KEYS = `[...document.querySelectorAll('.ptbl thead th')].map(th => th.dataset.colk)`;
// each header cell's key, left and right edges and width, in whole pixels
const GEOM = `Object.fromEntries([...document.querySelectorAll('.ptbl thead th')].map(th => { const r = th.getBoundingClientRect(); return [th.dataset.colk, {l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width)}]; }))`;
const GRIP = k => `.ptbl thead th[data-colk="${k}"] [data-colgrip]`;
const SAY = `(document.getElementById('colsay') || {}).textContent || ''`;
const CPU = ['name', 'pid', 'owner', 'user', 'state', 'cpu', 'mem', 'threads', 'cpugroup', 'cmd'];
const lastPost = fx => { const ps = (fx.posts || []).filter(x => x.path === '/api/prefs'); return ps.length ? JSON.parse(ps[ps.length - 1].body) : null; };

async function open(over = {}, fx = fixture(), opts = {}){
  const p = await browser.page(fx, Object.assign({ui: ui(Object.assign({view: 'details'}, over))}, opts));
  await p.waitFor(`document.querySelectorAll('.ptbl tbody tr').length > 0`);
  return p;
}
const centre = (p, sel) => p.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return {x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2)}; })()`);
// a real mouse: press, move in steps (each awaited), release
const mouse = (p, type, x, y, o = {}) => p.send('Input.dispatchMouseEvent', Object.assign({type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1}, o));
async function press(p, x, y){ await mouse(p, 'mouseMoved', x, y, {buttons: 0, button: 'none'}); await mouse(p, 'mousePressed', x, y); }
async function moveTo(p, x, y){ await mouse(p, 'mouseMoved', x, y); await sleep(20); }
// a key on whatever has focus, as the browser sends it (Alt = 1, Shift = 8)
const VK = {ArrowLeft: 37, ArrowRight: 39, Delete: 46, Escape: 27};
async function key(p, k, modifiers = 0){
  await p.send('Input.dispatchKeyEvent', {type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: VK[k], modifiers});
  await p.send('Input.dispatchKeyEvent', {type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: VK[k], modifiers});
}
// how often the page has read lx's process list (a poll has reached Details when this moves)
function counted(fx){
  const c = {reads: 0}; let answer = fx.procs.lx;
  Object.defineProperty(fx.procs, 'lx', {get(){ c.reads++; return answer; }, set(v){ answer = v; }, configurable: true});
  return c;
}
async function aPoll(p, c){ const r0 = c.reads; await p.eval(`(refreshNow(), true)`); for (const end = Date.now() + 6000; c.reads <= r0; await sleep(40)) if (Date.now() > end) throw new Error('no poll'); await sleep(250); }

test('a divider shows between header cells, and reads in every theme, colour-vision mode and higher contrast', async () => {
  const p = await open({metric: 'cpu'});
  try {
    // one grip per column, at its right edge; the pipe shows between cells, not after the last one
    const grips = await p.eval(`[...document.querySelectorAll('.ptbl thead th')].map(th => { const g = th.querySelector('[data-colgrip]'), r = th.getBoundingClientRect(), a = g && getComputedStyle(g, '::after'), gr = g && g.getBoundingClientRect();
      return g ? {k: g.dataset.colgrip, role: g.getAttribute('role'), tab: g.tabIndex, label: g.getAttribute('aria-label'), atEdge: Math.abs(gr.right - r.right) <= 1, pipe: a.opacity !== '0' && a.display !== 'none' && parseFloat(a.width) >= 1 && parseFloat(a.height) >= 8} : null; })`);
    assert.deepEqual(grips, CPU.map((k, i) => ({k, role: 'separator', tab: 0, label: 'Resize the ' + ['Name', 'PID', 'Runs in', 'User', 'Status', 'CPU', 'Memory', 'Threads', 'CPU group', 'Command line'][i] + ' column', atEdge: true, pipe: i < CPU.length - 1})));
    // the pipe against the header behind it, flattened as it's painted: 3:1 or more everywhere
    const worst = await p.eval(`(() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', {willReadFrequently: true});
      const paint = (...cs) => { cx.clearRect(0, 0, 1, 1); cs.forEach(c => { cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); }); return [...cx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
      const lum = c => { const [r, g, b] = c.map(v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const out = [];
      for (const th of FLEET_THEMES) for (const [cvd, contrast] of [['', false], ['deutan', false], ['mono', false], ['', true]]){
        PREFS = Object.assign({}, PREFS, {theme: th.id, cvd, contrast}); applyTheme(currentTheme());
        const head = document.querySelector('.ptbl thead th'), bg = getComputedStyle(head).backgroundColor, pipe = getComputedStyle(head.querySelector('[data-colgrip]'), '::after').backgroundColor;
        out.push({id: th.id + (cvd ? '+' + cvd : '') + (contrast ? '+hc' : ''), r: ratio(paint(bg, pipe), paint(bg))});
      }
      return out.sort((a, b) => a.r - b.r).slice(0, 3).map(o => o.id + ' ' + o.r.toFixed(2));
    })()`);
    assert.ok(worst.every(s => +s.split(' ')[1] >= 3), 'the faintest pipes: ' + worst.join(', '));
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
  // the docked panel's table has them too
  const d = await browser.page(fixture(), {ui: ui({sel: 'lx', detailsDocked: true, dockW: 640})});
  try {
    await d.waitFor(`document.querySelectorAll('.dpanel .ptbl tbody tr[data-pid]').length > 0`);
    assert.deepEqual(await d.eval(`[...document.querySelectorAll('.dpanel .ptbl thead th [data-colgrip]')].map(g => g.dataset.colgrip)`), CPU);
  } finally { await d.close(); }
});

test('dragging a divider resizes the column to its left, holds still through polls, and is kept per detail type', async () => {
  const fx = fixture(), c = counted(fx);
  const p = await open({metric: 'cpu'}, fx);
  try {
    const g0 = await p.eval(GEOM), at = await centre(p, GRIP('owner'));
    assert.ok(Math.abs(at.x - g0.owner.r) <= 5, 'the grip sits on the right edge of Runs in');
    await p.eval(`(document.querySelector('.ptbl').__before = 1, true)`);
    await press(p, at.x, at.y);
    for (const dx of [10, 25, 40, 60]){
      await moveTo(p, at.x + dx, at.y);
      const g = await p.eval(GEOM);
      assert.ok(Math.abs(g.owner.w - (g0.owner.w + dx)) <= 1, `Runs in follows the pointer (+${dx}): ${g.owner.w} vs ${g0.owner.w + dx}`);
      assert.deepEqual([g.name, g.pid], [g0.name, g0.pid], 'the columns to its left stay where they were');
      assert.ok(Math.abs(g.user.l - (g0.user.l + dx)) <= 1, 'the ones to its right move with it');
    }
    // a poll mid-drag: the table isn't rebuilt (the drag would be lost) and the width isn't undone
    fx.procs.lx.procs[0][1] = 'nginx-new';
    await aPoll(p, c);
    assert.equal(await p.eval(`document.querySelector('.ptbl').__before`), 1, 'not rebuilt while dragging');
    assert.ok(Math.abs((await p.eval(GEOM)).owner.w - (g0.owner.w + 60)) <= 1);
    await mouse(p, 'mouseReleased', at.x + 60, at.y);
    await p.waitFor(`!prefsBusy && [...document.querySelectorAll('.ptbl tbody td')].some(td => td.textContent === 'nginx-new')`);
    const w = g0.owner.w + 60, g1 = await p.eval(GEOM);
    assert.ok(Math.abs(g1.owner.w - w) <= 1, `kept after letting go: ${g1.owner.w} vs ${w}`);
    assert.deepEqual(lastPost(fx).colWidths, {cpu: {owner: g1.owner.w}});
    assert.equal(await p.eval(SAY), `Runs in: ${g1.owner.w} px wide`);
    // a poll after doesn't undo it, and the sort didn't change
    await aPoll(p, c);
    assert.ok(Math.abs((await p.eval(GEOM)).owner.w - w) <= 1);
    assert.equal(await p.eval(`document.querySelector('.ptbl thead th[aria-sort]').dataset.colk`), 'cpu');
    // never narrower than a sensible minimum
    const at2 = await centre(p, GRIP('owner'));
    await press(p, at2.x, at2.y); await moveTo(p, at2.x - 150, at2.y); await moveTo(p, at2.x - 400, at2.y); await mouse(p, 'mouseReleased', at2.x - 400, at2.y);
    await p.waitFor(`!prefsBusy`);
    assert.equal(lastPost(fx).colWidths.cpu.owner, 40);
    assert.equal((await p.eval(GEOM)).owner.w, 40);
    // another detail type has its own (none), and this one's survives a reload
    await p.eval(`(() => { document.querySelector('[data-metric="mem"]').click(); document.querySelector('[data-details]').click(); return true; })()`);
    await p.waitFor(`document.querySelector('.ptbl thead th[data-colk="threads"]') && !document.querySelector('.ptbl thead th[data-colk="state"]')`);
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('.ptbl thead th')].filter(th => th.style.width || th.classList.contains('fw')).length`), 0, 'Memory details: every column is automatic');
    await p.eval(`(() => { document.querySelector('[data-metric="cpu"]').click(); document.querySelector('[data-details]').click(); return true; })()`);
    await p.waitFor(`document.querySelector('.ptbl thead th[data-colk="state"]')`);
    await p.reload();
    await p.waitFor(`document.querySelectorAll('.ptbl tbody tr').length > 0`);
    assert.equal((await p.eval(GEOM)).owner.w, 40, 'after a reload');
    // a double-click on the divider gives it back its automatic width
    const at3 = await centre(p, GRIP('owner'));
    await press(p, at3.x, at3.y); await mouse(p, 'mouseReleased', at3.x, at3.y);
    await mouse(p, 'mousePressed', at3.x, at3.y, {clickCount: 2}); await mouse(p, 'mouseReleased', at3.x, at3.y, {clickCount: 2});
    await p.waitFor(`!prefsBusy && !document.querySelector('.ptbl thead th[data-colk="owner"]').style.width`);
    assert.deepEqual(lastPost(fx).colWidths, {cpu: {}});
    assert.ok((await p.eval(GEOM)).owner.w > 90, 'it fits its content again');
    assert.equal(await p.eval(SAY), 'Runs in: automatic width');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('dragging a header onto another moves that column there, with a drop indicator; a click still sorts', async () => {
  const fx = fixture(), c = counted(fx);
  const p = await open({metric: 'cpu'}, fx);
  try {
    const g0 = await p.eval(GEOM), from = await centre(p, '.ptbl thead th[data-colk="cpu"]');
    await p.eval(`(document.querySelector('.ptbl').__before = 1, true)`);
    await press(p, from.x, from.y);
    // over the left half of PID: it would go between Name and PID
    for (const x of [from.x - 10, from.x - 200, g0.pid.l + 6]) await moveTo(p, x, from.y);
    const mid = await p.eval(`(() => { const d = document.getElementById('coldrop'), r = d && d.getBoundingClientRect(); return {shown: !!d && !d.hidden && r.width > 0 && r.height > 0, x: r ? Math.round(r.left + r.width / 2) : null, moving: [...document.querySelectorAll('.ptbl thead th.colmoving')].map(th => th.dataset.colk)}; })()`);
    assert.equal(mid.shown, true, 'a drop indicator shows');
    assert.ok(Math.abs(mid.x - g0.pid.l) <= 2, `between Name and PID: ${mid.x} vs ${g0.pid.l}`);
    assert.deepEqual(mid.moving, ['cpu'], 'and the column being moved is marked');
    // polls go on, but the table holds still under the drag
    await aPoll(p, c);
    assert.equal(await p.eval(`document.querySelector('.ptbl').__before`), 1);
    assert.deepEqual(await p.eval(GEOM), g0, 'nothing moved yet');
    await mouse(p, 'mouseReleased', g0.pid.l + 6, from.y);
    await p.waitFor(`!prefsBusy && ${KEYS}[1] === 'cpu'`);
    const moved = ['name', 'cpu', 'pid', 'owner', 'user', 'state', 'mem', 'threads', 'cpugroup', 'cmd'];
    assert.deepEqual(await p.eval(KEYS), moved);
    assert.deepEqual(lastPost(fx).columns, {cpu: moved}, 'the same saved order the Columns menu edits');
    assert.equal(await p.eval(`!!document.getElementById('coldrop') && !document.getElementById('coldrop').hidden`), false, 'the indicator goes');
    assert.equal(await p.eval(SAY), 'CPU moved to column 2 of 10');
    // letting go was not a click: the sort is as it was
    assert.equal(await p.eval(`document.querySelector('.ptbl thead th[aria-sort]').dataset.colk + ' ' + document.querySelector('.ptbl thead th[aria-sort]').getAttribute('aria-sort')`), 'cpu descending');
    // past the last column: to the end
    const g1 = await p.eval(GEOM), name = await centre(p, '.ptbl thead th[data-colk="name"]');
    await press(p, name.x, name.y); await moveTo(p, name.x + 40, name.y); await moveTo(p, g1.cmd.r - 3, name.y); await mouse(p, 'mouseReleased', g1.cmd.r - 3, name.y);
    await p.waitFor(`!prefsBusy && ${KEYS}[9] === 'name'`);
    assert.deepEqual(await p.eval(KEYS), ['cpu', 'pid', 'owner', 'user', 'state', 'mem', 'threads', 'cpugroup', 'cmd', 'name']);
    // Esc mid-drag puts it back
    const pid = await centre(p, '.ptbl thead th[data-colk="pid"]');
    await press(p, pid.x, pid.y); await moveTo(p, pid.x + 150, pid.y);
    await key(p, 'Escape');
    await mouse(p, 'mouseReleased', pid.x + 150, pid.y);
    await sleep(200);
    assert.deepEqual(await p.eval(KEYS), ['cpu', 'pid', 'owner', 'user', 'state', 'mem', 'threads', 'cpugroup', 'cmd', 'name']);
    // a plain click on a header still sorts by it
    await p.click('.ptbl thead th[data-colk="pid"] button');
    await p.waitFor(`document.querySelector('.ptbl thead th[aria-sort]').dataset.colk === 'pid'`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

for (const platform of ['MacIntel', 'Linux x86_64']){
  test(`keyboard (${platform}): ←/→ on a divider resize, Delete resets; Alt+←/→ on a header moves it; each is announced`, async () => {
    const fx = fixture();
    const p = await open({metric: 'cpu'}, fx, {platform});
    try {
      const g0 = await p.eval(GEOM);
      await p.eval(`(document.querySelector(${JSON.stringify(GRIP('user'))}).focus(), true)`);
      await key(p, 'ArrowRight'); await key(p, 'ArrowRight');
      await p.waitFor(`!prefsBusy && (${GEOM}).user.w === ${g0.user.w + 20}`);
      assert.deepEqual(lastPost(fx).colWidths, {cpu: {user: g0.user.w + 20}});
      assert.equal(await p.eval(SAY), `User: ${g0.user.w + 20} px wide`);
      assert.equal(await p.eval(`document.activeElement.dataset.colgrip`), 'user', 'the divider keeps the focus');
      await key(p, 'ArrowLeft', 8);   // Shift: a bigger step
      await p.waitFor(`(${GEOM}).user.w === ${g0.user.w - 30}`);
      await key(p, 'Delete');
      await p.waitFor(`!prefsBusy && Math.abs((${GEOM}).user.w - ${g0.user.w}) <= 1`);
      assert.deepEqual(lastPost(fx).colWidths, {cpu: {}});
      assert.equal(await p.eval(SAY), 'User: automatic width');
      // a header: Alt+← moves its column one place left, the focus stays on it, and nothing else happens (no Back)
      await p.eval(`(document.querySelector('.ptbl thead th[data-colk="cpu"] button').focus(), true)`);
      await key(p, 'ArrowLeft', 1);
      await p.waitFor(`!prefsBusy && ${KEYS}[4] === 'cpu'`);
      assert.deepEqual(await p.eval(KEYS), ['name', 'pid', 'owner', 'user', 'cpu', 'state', 'mem', 'threads', 'cpugroup', 'cmd']);
      assert.deepEqual(lastPost(fx).columns, {cpu: ['name', 'pid', 'owner', 'user', 'cpu', 'state', 'mem', 'threads', 'cpugroup', 'cmd']});
      assert.equal(await p.eval(SAY), 'CPU moved to column 5 of 10');
      assert.equal(await p.eval(`document.activeElement.dataset.sort`), 'cpu');
      await key(p, 'ArrowRight', 1); await key(p, 'ArrowRight', 1);
      await p.waitFor(`!prefsBusy && ${KEYS}[6] === 'cpu'`);
      assert.equal(await p.eval(SAY), 'CPU moved to column 7 of 10');
      assert.equal(await p.eval(`JSON.parse(localStorage.getItem('fleet-live-ui')).view`), 'details', 'still in Details');
      assert.equal(await p.eval(`document.querySelector('.ptbl thead th[aria-sort]').dataset.colk`), 'cpu', 'and the sort is as it was');
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  });
}

test('a poll the server answered before a width was saved doesn\'t bring the old width back', async () => {
  const fx = fixture();
  const p = await open({metric: 'cpu'}, fx);
  try {
    const g0 = await p.eval(GEOM);
    fx.holdFleet = true;
    const stale = await heldPoll(p, fx);   // made before the width was saved
    await p.eval(`(document.querySelector(${JSON.stringify(GRIP('name'))}).focus(), true)`);
    await key(p, 'ArrowRight');
    await p.waitFor(`!prefsBusy`);
    assert.deepEqual(fx.fleet.prefs, {colWidths: {cpu: {name: g0.name.w + 10}}});
    stale();
    await heldPoll(p, fx);
    assert.equal((await p.eval(GEOM)).name.w, g0.name.w + 10);
    assert.deepEqual(p.errors, []);
  } finally { fx.holdFleet = false; (fx.held || []).splice(0).forEach(send => send()); await p.close(); }
});

test('Reset to default in the Columns menu gives every column its automatic width back too, for that type only', async () => {
  const fx = fixture();
  fx.fleet.prefs = {colWidths: {cpu: {name: 200, cmd: 90}, mem: {name: 150}}, columns: {cpu: ['cmd', 'name', 'pid']}};
  const p = await open({metric: 'cpu'}, fx);
  try {
    assert.deepEqual(await p.eval(`[${KEYS}, (${GEOM}).name.w, (${GEOM}).cmd.w]`), [['cmd', 'name', 'pid'], 200, 90]);
    await p.eval(`(() => { const th = document.querySelector('.ptbl thead th[data-colk="name"]'), r = th.getBoundingClientRect(); th.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5})); document.querySelector('[data-colact="reset|"]').click(); return true; })()`);
    await p.waitFor(`!prefsBusy && ${KEYS}.length === 10`);
    assert.deepEqual(await p.eval(KEYS), CPU);
    assert.equal(await p.eval(`document.querySelectorAll('.ptbl thead th.fw, .ptbl tbody td.fw').length`), 0);
    const saved = lastPost(fx);
    assert.deepEqual([saved.columns.cpu, saved.colWidths], [CPU, {cpu: {}, mem: {name: 150}}]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
