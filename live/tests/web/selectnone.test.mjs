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
