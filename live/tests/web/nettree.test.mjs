// SPDX-License-Identifier: GPL-3.0-or-later
// The Network tree: what each row shows. A container's traffic keeps both directions, received and sent (#177).
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
