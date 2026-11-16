// SPDX-License-Identifier: GPL-3.0-or-later
// Polls with the Network tree open (#144): /api/net (tailscale status, which can take seconds) comes on its own,
// so the fleet's numbers never wait for it, and only one is asked for at a time. A poll fills in the tree's rates in
// place and redraws its rows only when they change (#157).
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

// #157: a poll patches the Network tree's rates in place, and redraws it only when its rows change
const ifc = (name, kind, rx, tx, extra = {}) => Object.assign({name, kind, rx, tx, addrs: [], state: 'up', speed: '', master: ''}, extra);
function netFx(){
  const fx = fixture();
  fx.net = {tailnet: 'tailnet', machines: [
    Object.assign(nm('lx', 'lab-linux'), {ifs: [ifc('eth0', 'physical', 1.5, 0.25), ifc('docker0', 'bridge', 0.1, 0.2)],
      containers: [{name: 'web', networks: 'bridge', net: 0.05, rx: 0.02, tx: 0.03}], dockernets: [{name: 'bridge', id: 'abc', driver: 'bridge'}]}),
    Object.assign(nm('mac', 'lab-mac'), {ifs: [ifc('en0', 'physical', 0.5, 0.5)]})
  ]};
  return fx;
}
const RATES = `Object.fromEntries([...document.querySelectorAll('#tree .row[data-netsel]')].map(r => [r.dataset.netsel, [...r.querySelectorAll('.nrate span')].map(s => s.textContent).join(' ')]))`;
const center = sel => `(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return {x: b.left + b.width / 2, y: b.top + b.height / 2}; })()`;

test('a poll updates the Network tree\'s rates in place: the rows stay, focus stays, a click across a poll lands', async () => {
  const fx = netFx();
  const p = await browser.page(fx, {ui: ui({tree: 'network', netSel: 'net:tailnet', open: {'net:if:lx:docker0': true}})});
  try {
    await p.waitFor(`document.querySelector('#tree .row[data-netsel="net:c:lx:web"]')`);
    assert.deepEqual(await p.eval(RATES), {
      'net:tailnet': '↓ 2.0 MB/s ↑ 750 KB/s', 'net:m:lx': '↓ 1.5 MB/s ↑ 250 KB/s', 'net:if:lx:docker0': '↓ 100 KB/s ↑ 200 KB/s',
      'net:c:lx:web': '↓ 20 KB/s ↑ 30 KB/s', 'net:if:lx:eth0': '↓ 1.5 MB/s ↑ 250 KB/s', 'net:m:mac': '↓ 500 KB/s ↑ 500 KB/s', 'net:if:mac:en0': '↓ 500 KB/s ↑ 500 KB/s'});
    await p.eval(`(() => { window.R0 = [...document.querySelectorAll('#tree .row')]; document.querySelector('.row[data-netsel="net:m:lx"] .nm').focus(); return true; })()`);
    Object.assign(fx.net.machines[0].ifs[0], {rx: 3});
    await p.waitFor(`${RATES}['net:m:lx'] === '↓ 3.0 MB/s ↑ 250 KB/s'`);
    assert.deepEqual(await p.eval(RATES), {
      'net:tailnet': '↓ 3.5 MB/s ↑ 750 KB/s', 'net:m:lx': '↓ 3.0 MB/s ↑ 250 KB/s', 'net:if:lx:docker0': '↓ 100 KB/s ↑ 200 KB/s',
      'net:c:lx:web': '↓ 20 KB/s ↑ 30 KB/s', 'net:if:lx:eth0': '↓ 3.0 MB/s ↑ 250 KB/s', 'net:m:mac': '↓ 500 KB/s ↑ 500 KB/s', 'net:if:mac:en0': '↓ 500 KB/s ↑ 500 KB/s'});
    assert.equal(await p.eval(`[...document.querySelectorAll('#tree .row')].every((r, i) => r === window.R0[i]) && document.querySelectorAll('#tree .row').length === window.R0.length`), true, 'the same rows, patched');
    assert.equal(await p.eval(`document.activeElement === document.querySelector('.row[data-netsel="net:m:lx"] .nm')`), true, 'focus stays on lab-linux');
    // press on lab-mac, a poll comes, release: the click selects it
    const at = await p.eval(center('.row[data-netsel="net:m:mac"] .nm'));
    await p.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: at.x, y: at.y});
    await p.send('Input.dispatchMouseEvent', {type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1});
    Object.assign(fx.net.machines[0].ifs[0], {rx: 4});
    await p.waitFor(`${RATES}['net:m:lx'] === '↓ 4.0 MB/s ↑ 250 KB/s'`);
    await p.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1});
    await p.waitFor(`S.netSel === 'net:m:mac'`);
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#tree .row.sel')].map(r => r.dataset.netsel)`), ['net:m:mac']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a poll that brings a new interface redraws the Network tree with it', async () => {
  const fx = netFx();
  const p = await browser.page(fx, {ui: ui({tree: 'network', netSel: 'net:tailnet'})});
  try {
    await p.waitFor(`document.querySelector('#tree .row[data-netsel="net:if:mac:en0"]')`);
    fx.net.machines[1].ifs.push(ifc('utun4', 'virtual', 0.002, 0.001));
    await p.waitFor(`document.querySelector('#tree .row[data-netsel="net:if:mac:utun4"]')`);
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#tree .row[data-netsel]')].map(r => r.dataset.netsel)`),
      ['net:tailnet', 'net:m:lx', 'net:if:lx:docker0', 'net:if:lx:eth0', 'net:m:mac', 'net:if:mac:en0', 'net:if:mac:utun4']);
    assert.equal(await p.eval(`${RATES}['net:if:mac:utun4']`), '↓ 2 KB/s ↑ 1 KB/s');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
