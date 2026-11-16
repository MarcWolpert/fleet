// SPDX-License-Identifier: GPL-3.0-or-later
// Polls with the Network tree open (#144): /api/net (tailscale status, which can take seconds) comes on its own,
// so the fleet's numbers never wait for it, and only one is asked for at a time.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const nm = (id, name) => ({id, name, status: 'ok', tailscale: {ip: '100.64.0.' + id.length, online: true, direct: true}, ifs: [], containers: [], vms: [], dockernets: []});
// HOLD.net: each /api/net request waits in HOLD.nets until a test sends it (HOLD.netCalls counts them)
const WRAP = `(() => {
  const of = window.fetch, H = window.HOLD = {net: false, nets: [], netCalls: 0};
  window.fetch = function(u, o){
    const args = arguments;
    if (String(u) === '/api/net'){ H.netCalls++; if (H.net) return new Promise(ok => H.nets.push(() => ok(of.apply(window, args)))); }
    return of.apply(window, args);
  };
  return true;
})()`;
const NROWS = `[...document.querySelectorAll('#tree .row[data-netsel]')].map(r => r.dataset.netsel)`;
const PC = `document.querySelector('#spaces [data-pc="lx"]').textContent`;

test('a slow /api/net holds back nothing from /api/fleet, and only one is on its way at a time', async () => {
  const fx = fixture(); fx.fleet.pins = ['lx'];
  fx.net = {tailnet: 'tailnet', machines: [nm('lx', 'lab-linux'), nm('mac', 'lab-mac')]};
  const p = await browser.page(fx, {ui: ui({tree: 'network', netSel: 'net:tailnet'})});
  try {
    await p.waitFor(`JSON.stringify(${NROWS}) === '["net:tailnet","net:m:lx","net:m:mac"]'`);
    await p.eval(WRAP);
    await p.eval(`(() => { HOLD.net = true; return true; })()`);
    await p.waitFor(`HOLD.nets.length === 1`);                 // tailscale is slow: the next /api/net doesn't answer
    Object.assign(fx.fleet.machines.find(m => m.id === 'lx'), {status: 'offline', has_data: false});
    await p.waitFor(`${PC} === 'offline'`);                    // the fleet's data comes through anyway
    Object.assign(fx.fleet.machines.find(m => m.id === 'lx'), {status: 'ok', has_data: true});
    await p.waitFor(`/%$/.test(${PC})`);                       // and again, poll after poll
    assert.equal(await p.eval(`HOLD.netCalls`), 1, 'no second /api/net while one is on its way');
    // once it answers, the tree takes in what it says
    fx.net.machines.push(nm('lx2', 'lab-linux-2'));
    await p.eval(`(() => { HOLD.net = false; HOLD.nets.shift()(); return true; })()`);
    await p.waitFor(`JSON.stringify(${NROWS}) === '["net:tailnet","net:m:lx","net:m:lx2","net:m:mac"]'`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('an /api/net answer that comes after you leave the Network tree leaves the machine tree alone', async () => {
  const fx = fixture();
  fx.net = {tailnet: 'tailnet', machines: [nm('lx', 'lab-linux')]};
  const p = await browser.page(fx, {ui: ui({tree: 'network', netSel: 'net:tailnet'})});
  try {
    await p.waitFor(`document.querySelector('#tree .row[data-netsel="net:m:lx"]')`);
    await p.eval(WRAP);
    await p.eval(`(() => { HOLD.net = true; return true; })()`);
    await p.waitFor(`HOLD.nets.length === 1`);
    await p.click('[data-tree="machines"]');
    await p.waitFor(`document.querySelectorAll('#tree .row.machine').length === 4`);
    await p.eval(`(() => { window.N0 = HOLD.netCalls; HOLD.nets.shift()(); return true; })()`);
    await new Promise(r => setTimeout(r, 2500));               // the answer has come, and a poll since
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#tree .row.machine .nm')].map(e => e.textContent)`), ['lab-linux', 'lab-linux-2', 'lab-mac', 'lab-windows']);
    assert.deepEqual(await p.eval(NROWS), []);
    assert.equal(await p.eval(`HOLD.netCalls - window.N0`), 0, 'no /api/net for the machine tree');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
