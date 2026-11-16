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

test('the machine tree: a click on empty space does nothing; the All machines row shows All machines (#327)', async () => {
  const p = await browser.page(fixture(), {ui: ui({sel: 'mac'})});
  const ALL = `document.querySelector('#tree [data-allrow]')`;
  try {
    await p.waitFor(`document.querySelector('#tree .row.sel')`);
    assert.equal(await p.eval(`${ALL} === document.getElementById('tree').firstElementChild`), true, 'at the top of the tree');
    assert.match(await p.eval(`${ALL}.textContent`), /All machines/);
    assert.equal(await clickEmpty(p), true, 'the click landed on the tree itself');
    await new Promise(ok => setTimeout(ok, 300));
    assert.equal(await p.eval(`S.sel`), 'mac', 'empty space does nothing');
    await p.eval(`(${ALL}.querySelector('.nm').click(), true)`);
    await p.waitFor(`S.sel === 'fleet' && ${ALL}.classList.contains('sel')`);
    assert.equal(await p.eval(`${ALL}.getAttribute('aria-selected')`), 'true');
    assert.equal(await p.eval(`document.querySelector('#crumbs .cur').textContent`), 'All machines');
    assert.equal(await p.eval(`document.querySelectorAll('#tree .sel').length`), 1, 'only it is selected');
    await p.eval(`(() => { document.querySelector('#tree .row[data-select="lx"] .nm').click(); return true; })()`);
    await p.waitFor(`S.sel === 'lx' && !${ALL}.classList.contains('sel')`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Pins only: the row reads Pins only and shows that view', async () => {
  const fx = fixture(); fx.fleet.pins = ['lx', 'mac'];
  const p = await browser.page(fx, {ui: ui({sel: 'lx', pinsOnly: true})});
  try {
    await p.waitFor(`document.querySelector('#tree [data-allrow]')`);
    assert.match(await p.eval(`document.querySelector('#tree [data-allrow]').textContent`), /Pins only.*2 pinned/);
    await p.eval(`(document.querySelector('#tree [data-allrow] .nm').click(), true)`);
    await p.waitFor(`S.sel === 'fleet' && document.querySelector('#crumbs .cur').textContent === 'Pins only'`);
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

test('the network tree: a click on empty space does nothing; its tailnet row is the whole network (#327)', async () => {
  const fx = fixture();
  fx.net = {tailnet: 'tailnet', machines: [{id: 'lx', name: 'lab-linux', status: 'ok', ts: {ip: '100.64.0.1', online: true, direct: true}, ifs: [{name: 'eth0', kind: 'ethernet', state: 'up', addrs: ['10.0.0.2/24'], rx: 0, tx: 0}]}]};
  const p = await browser.page(fx, {ui: ui({tree: 'network', netSel: 'net:tailnet'})});
  try {
    await p.waitFor(`document.querySelectorAll('#tree .row').length > 1`);
    await p.eval(`(() => { [...document.querySelectorAll('#tree .row[data-netsel]')].pop().querySelector('[data-netsel]').click(); return true; })()`);
    await p.waitFor(`S.netSel !== 'net:tailnet'`);
    const was = await p.eval(`S.netSel`);
    assert.equal(await clickEmpty(p), true);
    await new Promise(ok => setTimeout(ok, 300));
    assert.equal(await p.eval(`S.netSel`), was, 'empty space does nothing');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('from inside a pinned space, the All machines row goes to the top level: All machines, not the space', async () => {
  const fx = fixture(); fx.fleet.pins = ['lx'];
  const p = await browser.page(fx, {ui: ui({space: 'lx', sel: 'lx/base'})});
  try {
    await p.waitFor(`document.querySelector('#tree .row.sel')`);
    await p.eval(`(document.querySelector('#tree [data-allrow] .nm').click(), true)`);
    await p.waitFor(`S.sel === 'fleet' && S.space === 'fleet'`);
    assert.equal(await p.eval(`document.querySelector('[data-space="fleet"]').getAttribute('aria-pressed')`), 'true');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
