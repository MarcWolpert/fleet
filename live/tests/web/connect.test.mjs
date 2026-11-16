// SPDX-License-Identifier: GPL-3.0-or-later
// Turning a machine's connection off and on by hand (the dot on its tree row), and 'Connect automatically'
// (beside + Add a machine): which machines Fleet connects to when it starts, All, None or a saved set.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

// plays the server's part of /api/connect
function fx1(){
  const fx = fixture();
  fx.fleet.machines.forEach(m => { m.on = true; });
  fx.fleet.connect = {auto: 'all', presets: {'Lab boxes': ['lx']}, starts: ['lx', 'lx2', 'win', 'mac']};
  fx.onPost = (path, body) => {
    if (path !== '/api/connect') return null;
    const d = JSON.parse(body || '{}'), c = fx.fleet.connect;
    if ('machine' in d){ const m = fx.fleet.machines.find(x => x.id === d.machine); m.on = d.on; m.status = d.on ? 'connecting' : 'disabled'; m.has_data = !!d.on; }
    else if ('save' in d){ c.presets[d.save] = fx.fleet.machines.filter(m => m.on).map(m => m.id); c.auto = d.save; }
    else if ('delete' in d){ delete c.presets[d.delete]; if (c.auto === d.delete) c.auto = 'all'; }
    else if ('auto' in d) c.auto = d.auto;
    return {ok: true, connect: c};
  };
  return fx;
}
const posts = fx => (fx.posts || []).filter(x => x.path === '/api/connect').map(x => JSON.parse(x.body));
const MENU = `[...document.querySelectorAll('#ctxmenu [role=menuitem], #ctxmenu .cx-sep')].map(e => e.classList.contains('cx-sep') ? '—' : e.textContent.trim())`;
const pick = (p, label) => p.eval(`(() => { [...document.querySelectorAll('#ctxmenu [role=menuitem]')].find(e => e.textContent.trim() === ${JSON.stringify(label)}).click(); return true; })()`);

test('the dot on a machine\'s row turns its connection off and on; off, its page offers Connect', async () => {
  const fx = fx1();
  const p = await browser.page(fx, {ui: ui({sel: 'fleet'})});
  try {
    await p.waitFor(`document.querySelector('#tree [data-conn="lx"]')`);
    assert.equal(await p.eval(`document.querySelector('#tree [data-conn="lx"]').getAttribute('aria-pressed')`), 'true');
    await p.eval(`(document.querySelector('#tree [data-conn="lx"]').click(), true)`);
    await p.waitFor(`document.querySelector('#tree [data-conn="lx"]').getAttribute('aria-pressed') === 'false'`);
    assert.deepEqual(posts(fx), [{machine: 'lx', on: false}]);
    assert.equal(await p.eval(`S.sel`), 'fleet', 'the click toggles, it does not select');
    assert.match(await p.eval(`document.querySelector('#tree .row[data-select="lx"]').textContent`), /off/);
    await p.eval(`(document.querySelector('#tree .row[data-select="lx"] .nm').click(), true)`);
    await p.waitFor(`/Not connected/.test((document.querySelector('#main .state') || {}).textContent || '')`);
    await p.eval(`(document.querySelector('#main .state [data-conn="lx"]').click(), true)`);
    await p.waitFor(`document.querySelector('#tree [data-conn="lx"]').getAttribute('aria-pressed') === 'true'`);
    assert.deepEqual(posts(fx).pop(), {machine: 'lx', on: true});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Connect automatically: All, a saved set or None; save what is connected now as a set; delete one', async () => {
  const fx = fx1();
  const p = await browser.page(fx, {ui: ui({sel: 'fleet'})});
  try {
    await p.waitFor(`document.querySelector('[data-autoconn]')`);
    assert.match(await p.eval(`document.querySelector('[data-autoconn]').textContent`), /Auto: All/);
    await p.eval(`(document.querySelector('[data-autoconn]').click(), true)`);
    await p.waitFor(`document.querySelector('#ctxmenu [role=menuitem]')`);
    assert.deepEqual(await p.eval(MENU), ['✓ All machines', 'Lab boxes', 'None', '—', 'Save what’s connected now as a set…', 'Delete “Lab boxes”']);
    await pick(p, 'Lab boxes');
    await p.waitFor(`/Auto: Lab boxes/.test(document.querySelector('[data-autoconn]').textContent)`);
    assert.deepEqual(posts(fx), [{auto: 'Lab boxes'}]);
    await p.eval(`(document.querySelector('[data-autoconn]').click(), true)`);
    await p.waitFor(`document.querySelector('#ctxmenu [role=menuitem]')`);
    await pick(p, 'Save what’s connected now as a set…');
    await p.waitFor(`document.activeElement && document.activeElement.id === 'autoname'`);
    await p.eval(`(() => { const i = document.activeElement; i.value = 'Evening'; i.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); return true; })()`);
    await p.waitFor(`/Auto: Evening/.test(document.querySelector('[data-autoconn]').textContent)`);
    assert.deepEqual(posts(fx).pop(), {save: 'Evening'});
    await p.eval(`(document.querySelector('[data-autoconn]').click(), true)`);
    await p.waitFor(`document.querySelector('#ctxmenu [role=menuitem]')`);
    await pick(p, 'Delete “Evening”');
    await p.waitFor(`/Auto: All/.test(document.querySelector('[data-autoconn]').textContent)`);
    assert.deepEqual(posts(fx).pop(), {delete: 'Evening'});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the tree footer: Auto on the left, Add a machine on the right edge', async () => {
  const p = await browser.page(fx1(), {ui: ui({sel: 'fleet'})});
  try {
    await p.waitFor(`document.querySelector('.side-foot [data-autoconn]')`);
    const r = await p.eval(`(() => { const f = document.querySelector('.side-foot').getBoundingClientRect(), a = document.querySelector('[data-autoconn]').getBoundingClientRect(), m = document.querySelector('[data-addmachinedlg]').getBoundingClientRect(); return {autoLeft: Math.round(a.left - f.left), addRight: Math.round(f.right - m.right), order: a.right <= m.left}; })()`);
    assert.equal(r.order, true, 'Auto before Add a machine');
    assert.ok(r.autoLeft <= 16, `Auto at the left (${r.autoLeft}px in)`);
    assert.ok(r.addRight <= 16, `Add a machine at the right (${r.addRight}px in)`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a VM stopped on its host reads stopped, not off; off means only that its connection is turned off (#215)', async () => {
  const fx = fx1();
  Object.assign(fx.fleet.machines.find(m => m.id === 'lx2'), {status: 'off', has_data: false});
  const p = await browser.page(fx, {ui: ui({sel: 'fleet'})});
  const TITLE = `document.querySelector('#tree [data-conn="lx2"]').title`;
  try {
    await p.waitFor(`document.querySelector('#tree [data-conn="lx2"]')`);
    assert.match(await p.eval(`document.querySelector('#tree .row[data-select="lx2"]').textContent`), /stopped/);
    assert.doesNotMatch(await p.eval(`document.querySelector('#tree .row[data-select="lx2"]').textContent`), /\boff\b/);
    assert.equal(await p.eval(TITLE), 'stopped on its host · click to disconnect');
    await p.eval(`(document.querySelector('#tree [data-conn="lx2"]').click(), true)`);
    await p.waitFor(`${TITLE} === 'off · click to connect'`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
