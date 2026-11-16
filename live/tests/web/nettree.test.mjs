// SPDX-License-Identifier: GPL-3.0-or-later
// The Network tree: what each row shows. A container's traffic keeps both directions, received and sent (#177).
// Row by row: interfaces under their master, containers under their Docker network's bridge, VM interfaces named,
// loopback, veth and host-network containers left out, machines adding up only their physical interfaces.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const ifc = (name, kind, rx, tx, extra = {}) => Object.assign({name, kind, rx, tx, addrs: [], state: 'up', speed: '', master: ''}, extra);
const nm = (id, name, extra = {}) => Object.assign({id, name, status: 'ok', tailscale: {ip: '100.64.0.' + id.length, online: true, direct: true}, ifs: [], containers: [], vms: [], dockernets: []}, extra);
const RATE = id => `[...document.querySelectorAll('#tree .row[data-netsel="${id}"] .nrate span')].map(s => s.textContent).join(' ')`;
const HERO = `[...document.querySelectorAll('#main .hero-stats .hs')].map(h => [h.querySelector('.k').textContent, h.querySelector('.v').textContent, h.querySelector('.s').textContent])`;

test('a container shows what it received as in and what it sent as out, in its row, its view and its bridge\'s table', async () => {
  const fx = fixture();
  fx.net = {tailnet: 'tailnet', machines: [nm('lx', 'lab-linux', {ifs: [ifc('eth0', 'physical', 1.5, 0.25), ifc('docker0', 'bridge', 0.2, 0.05)],
    containers: [{name: 'backup', networks: 'bridge', net: 0.05, rx: 0.01, tx: 0.04}, {name: 'web', networks: 'bridge', net: 0.3, rx: 0.2, tx: 0.1}],
    dockernets: [{name: 'bridge', id: 'abc', driver: 'bridge'}]})]};
  const p = await browser.page(fx, {ui: ui({tree: 'network', netSel: 'net:c:lx:backup', open: {'net:if:lx:docker0': true}})});
  try {
    await p.waitFor(`document.querySelector('#tree .row[data-netsel="net:c:lx:web"]')`);
    assert.deepEqual(await p.eval(`[${RATE('net:c:lx:backup')}, ${RATE('net:c:lx:web')}]`), ['↓ 10 KB/s ↑ 40 KB/s', '↓ 200 KB/s ↑ 100 KB/s']);
    assert.deepEqual(await p.eval(HERO), [['In', '10 KB/s', 'received'], ['Out', '40 KB/s', 'sent']]);
    await p.click('#tree .row[data-netsel="net:if:lx:docker0"] .nm');
    await p.waitFor(`document.querySelector('#main .tbl tbody tr')`);
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#main .tbl tbody tr')].map(r => [...r.cells].map(c => c.textContent))`),
      [['backup', 'container', '', '10 KB/s', '40 KB/s'], ['web', 'container', '', '200 KB/s', '100 KB/s']]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the Network tree, row by row: interfaces under their master, containers under their network\'s bridge, totals of physical interfaces', async () => {
  const fx = fixture();
  fx.net = {tailnet: 'tailnet', machines: [
    nm('lx', 'lab-linux', {
      ifs: [ifc('lo', 'loopback', 9, 9), ifc('eth0', 'physical', 1, 0.5), ifc('eth1', 'physical', 2, 0.25, {master: 'br0'}), ifc('br0', 'bridge', 2, 0.25),
            ifc('vnet0', 'virtual', 0.1, 0.2, {master: 'br0'}), ifc('docker0', 'bridge', 0.3, 0.3), ifc('br-0123456789ab', 'bridge', 0.05, 0.05),
            ifc('vethabc', 'virtual', 0.3, 0.3, {master: 'docker0'})],
      containers: [{name: 'web', networks: 'bridge', net: 0.3, rx: 0.2, tx: 0.1}, {name: 'db', networks: 'backend', net: 0.1, rx: 0.05, tx: 0.05},
                   {name: 'hostnet', networks: 'host', net: 0, rx: 0, tx: 0}],
      vms: [{name: 'ubuntu', ifs: [{if: 'vnet0'}], net: 0.3}],
      dockernets: [{name: 'bridge', id: 'ffffffffffff', driver: 'bridge'}, {name: 'backend', id: '0123456789ab', driver: 'bridge'}, {name: 'host', id: 'eeeeeeeeeeee', driver: 'host'}]}),
    nm('mac', 'lab-mac', {ifs: [ifc('lo0', 'loopback', 1, 1), ifc('en0', 'physical', 0.5, 0.5), ifc('utun3', 'virtual', 0.01, 0.01)]}),
    nm('nas', 'nas', {status: 'offline', error: 'ssh: connect to host nas port 22: Operation timed out'})]};
  const open = {'net:if:lx:br0': true, 'net:if:lx:docker0': true, 'net:if:lx:br-0123456789ab': true};
  const p = await browser.page(fx, {ui: ui({tree: 'network', netSel: 'net:tailnet', open})});
  const ROWS = `[...document.querySelectorAll('#tree .row[data-netsel]')].map(r => r.dataset.netsel + '@' + getComputedStyle(r).getPropertyValue('--d').trim() + (r.querySelector('.count') ? ' ' + r.querySelector('.count').textContent : '') + (r.querySelector('.sdot') ? ' ' + r.querySelector('.sdot').className.replace('sdot ', '') : ''))`;
  try {
    await p.waitFor(`document.querySelector('#tree .row[data-netsel="net:c:lx:db"]')`);
    assert.deepEqual(await p.eval(ROWS), [
      'net:tailnet@0',
      'net:m:lx@1 ok',
      'net:if:lx:br-0123456789ab@2 backend', 'net:c:lx:db@3',
      'net:if:lx:br0@2', 'net:if:lx:eth1@3', 'net:if:lx:vnet0@3 ubuntu',
      'net:if:lx:docker0@2 bridge', 'net:c:lx:web@3',
      'net:if:lx:eth0@2',
      'net:m:mac@1 ok', 'net:if:mac:en0@2', 'net:if:mac:utun3@2',
      'net:m:nas@1 offline']);
    // a machine and the tailnet add up only physical interfaces (eth1 counts though it sits under br0)
    assert.deepEqual(await p.eval(`[${RATE('net:tailnet')}, ${RATE('net:m:lx')}, ${RATE('net:m:mac')}, ${RATE('net:m:nas')}]`),
      ['↓ 3.5 MB/s ↑ 1.3 MB/s', '↓ 3.0 MB/s ↑ 750 KB/s', '↓ 500 KB/s ↑ 500 KB/s', '↓ 0 ↑ 0']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
