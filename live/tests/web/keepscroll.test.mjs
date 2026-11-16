// SPDX-License-Identifier: GPL-3.0-or-later
// Where you've scrolled stays put (#221): through every poll, a machine reconnecting, and a reload of the page.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch, sleep} from './harness.mjs';
import {fixture, ui, lxProcs} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const POS = `(() => ({main: document.querySelector('main').scrollTop, details: (document.querySelector('.dpanel') || {}).scrollTop || 0}))()`;
function many(){ const out = []; for (let i = 0; i < 25; i++) out.push(...lxProcs(1000 + i * 20, 'lx')); return out; }

test('docked Details and the page beside it keep their place through polls, a reconnect and a reload', async () => {
  const fx = fixture();
  fx.procs.lx = {procs: many(), gpu_procs: true, ready: true};
  const lx = fx.fleet.machines.find(m => m.id === 'lx');
  const p = await browser.page(fx, {ui: ui({sel: 'lx', metric: 'cpu', cpuView: 'logical', detailsDocked: true, dockW: 560}), height: 700});
  try {
    await p.waitFor(`document.querySelectorAll('.dpanel .ptbl tbody tr[data-pid]').length > 100 && document.querySelector('main').scrollHeight > 1400`);
    await p.eval(`(document.querySelector('main').scrollTop = 600, document.querySelector('.dpanel').scrollTop = 900, true)`);
    await sleep(200);
    const at = await p.eval(POS);
    assert.ok(at.main >= 590 && at.details >= 890, JSON.stringify(at));
    // polls with new numbers, then the machine reconnecting and coming back
    lx.cpu_model = 'changed 1'; await p.eval(`refreshNow()`); await sleep(400);
    Object.assign(lx, {status: 'connecting'}); await p.eval(`refreshNow()`); await sleep(400);
    Object.assign(lx, {status: 'ok', cpu_model: 'changed 2'}); await p.eval(`refreshNow()`); await sleep(400);
    assert.deepEqual(await p.eval(POS), at, 'through polls and a reconnect');
    // and a reload of the page (Fleet reloads it when its UI changes)
    await p.eval(`(location.reload(), true)`);
    await sleep(500);
    await p.waitFor(`document.querySelectorAll('.dpanel .ptbl tbody tr[data-pid]').length > 100`);
    await p.waitFor(`(() => { const a = ${POS}; return Math.abs(a.main - ${at.main}) < 2 && Math.abs(a.details - ${at.details}) < 2; })()`, 4000);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
