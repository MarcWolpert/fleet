// SPDX-License-Identifier: GPL-3.0-or-later
// Selecting nothing in a tree shows everything (issue #21).
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

// a click on the tree's empty space, below its rows
const clickEmpty = p => p.eval(`(() => { const t = document.getElementById('tree'), r = t.getBoundingClientRect(), last = t.lastElementChild.getBoundingClientRect(); const x = r.left + 30, y = Math.min(r.bottom - 4, last.bottom + 20); const el = document.elementFromPoint(x, y); for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0})); return el === t; })()`);

test('the machine tree: a click on empty space selects nothing and shows All machines; a row click still selects', async () => {
  const p = await browser.page(fixture(), {ui: ui({sel: 'mac'})});
  try {
    await p.waitFor(`document.querySelector('#tree .row.sel')`);
    assert.equal(await clickEmpty(p), true, 'the click landed on the tree itself');
    await p.waitFor(`S.sel === 'fleet' && !document.querySelector('#tree .row.sel')`);
    assert.equal(await p.eval(`document.querySelector('#crumbs .cur').textContent`), 'All machines');
    await p.eval(`(() => { document.querySelector('#tree .row[data-select="lx"] .nm').click(); return true; })()`);
    await p.waitFor(`S.sel === 'lx'`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Esc in the tree selects nothing too', async () => {
  const p = await browser.page(fixture(), {ui: ui({sel: 'mac'})});
  try {
    await p.waitFor(`document.querySelector('#tree .row.sel')`);
    await p.eval(`(() => { const b = document.querySelector('#tree .row.sel .nm'); b.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true})); b.focus(); b.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true})); return true; })()`);
    await p.waitFor(`S.sel === 'fleet'`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the network tree: a click on empty space shows the whole tailnet', async () => {
  const fx = fixture();
  fx.net = {tailnet: 'tailnet', machines: [{id: 'lx', name: 'lab-linux', status: 'ok', ts: {ip: '100.64.0.1', online: true, direct: true}, ifs: [{name: 'eth0', kind: 'ethernet', state: 'up', addrs: ['10.0.0.2/24'], rx: 0, tx: 0}]}]};
  const p = await browser.page(fx, {ui: ui({tree: 'network', netSel: 'net:tailnet'})});
  try {
    await p.waitFor(`document.querySelectorAll('#tree .row').length > 1`);
    await p.eval(`(() => { [...document.querySelectorAll('#tree .row[data-netsel]')].pop().querySelector('[data-netsel]').click(); return true; })()`);
    await p.waitFor(`S.netSel !== 'net:tailnet'`);
    assert.equal(await clickEmpty(p), true);
    await p.waitFor(`S.netSel === 'net:tailnet'`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('from inside a pinned space, nothing selected means the top level: All machines, not the space', async () => {
  const fx = fixture(); fx.fleet.pins = ['lx'];
  const p = await browser.page(fx, {ui: ui({space: 'lx', sel: 'lx/base'})});
  try {
    await p.waitFor(`document.querySelector('#tree .row.sel')`);
    assert.equal(await clickEmpty(p), true);
    await p.waitFor(`S.sel === 'fleet' && S.space === 'fleet'`);
    assert.equal(await p.eval(`document.querySelector('[data-space="fleet"]').getAttribute('aria-pressed')`), 'true');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

// Esc closes the innermost thing first: an open Details drop-down closes before the tree lets go of its selection,
// even when the tree was the last thing touched, and the space stays. A drop-down that isn't on screen doesn't take
// the Esc (#292).
for (const [name, over] of [['Details', {view: 'details'}], ['docked Details', {view: 'overview', detailsDocked: true}]])
  test(`Esc after touching the tree closes an open drop-down in ${name} first, and keeps the space; the next Esc selects nothing`, async () => {
    const fx = fixture(); fx.fleet.pins = ['lx']; fx.proc = () => ({pid: 103, error: 'not needed here'});
    const p = await browser.page(fx, {ui: ui(Object.assign({space: 'lx', sel: 'lx'}, over))});
    try {
      await p.waitFor(`document.querySelector('tr[data-pid="103"]') && document.querySelector('#tree [data-toggle="lx"]')`);
      await p.click('tr[data-pid="103"]');
      await p.waitFor(`document.querySelector('tr.pinsp') && INSP.pid === 103`);
      await p.click('#tree [data-toggle="lx"]');
      await p.waitFor(`PANEL === 'tree'`);
      await p.key('Escape');
      await p.waitFor(`!document.querySelector('tr.pinsp')`).catch(() => null);
      assert.deepEqual(await p.eval(`({pid: INSP.pid, drop: !!document.querySelector('tr.pinsp'), sel: S.sel, space: S.space})`), {pid: 0, drop: false, sel: 'lx', space: 'lx'});
      await p.key('Escape');
      await p.waitFor(`S.sel === 'fleet'`).catch(() => null);
      assert.deepEqual(await p.eval(`({pid: INSP.pid, sel: S.sel, space: S.space})`), {pid: 0, sel: 'fleet', space: 'fleet'});
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  });

test('Esc in the tree still selects nothing when the drop-down left open is not on screen (Details closed)', async () => {
  const fx = fixture(); fx.fleet.pins = ['lx']; fx.proc = () => ({pid: 103, error: 'not needed here'});
  const p = await browser.page(fx, {ui: ui({space: 'lx', sel: 'lx', view: 'details'})});
  try {
    await p.waitFor(`document.querySelector('tr[data-pid="103"]')`);
    await p.click('tr[data-pid="103"]');
    await p.waitFor(`INSP.pid === 103`);
    await p.eval(`(() => { S.view = 'overview'; save(); lastMainHTML = ''; renderAll(); return true; })()`);
    await p.waitFor(`!document.querySelector('.ptbl') && document.querySelector('#tree [data-toggle="lx"]')`);
    await p.click('#tree [data-toggle="lx"]');
    await p.waitFor(`PANEL === 'tree'`);
    await p.key('Escape');
    await p.waitFor(`S.sel === 'fleet'`).catch(() => null);
    assert.deepEqual(await p.eval(`({sel: S.sel, space: S.space})`), {sel: 'fleet', space: 'fleet'});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
