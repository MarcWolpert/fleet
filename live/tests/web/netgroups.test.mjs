// SPDX-License-Identifier: GPL-3.0-or-later
// Network groups (#407): a group of networks (interfaces) is a response; a group of machines whose networks are grouped
// into responses is a cutter. Each has its own name, icon and colour, apart from the network tree's other kinds.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const h = v => new Array(60).fill(v);
const nif = (name, kind) => ({name, kind, rx: 0.1, tx: 0.1, hrx: h(0.1), htx: h(0.1), addrs: [], state: 'up', speed: '1000'});
const nm = (id, name) => ({id, name, status: 'ok', tailscale: {ip: '100.64.0.' + id.length, online: true, direct: true},
  ifs: [nif('eth0', 'physical'), nif('eth1', 'physical'), nif('wg0', 'virtual')], containers: [], vms: [], dockernets: []});

function fx1(tgroups){
  const fx = fixture();
  fx.net = {tailnet: 'tailnet', machines: [nm('lx', 'lab-linux'), nm('mac', 'lab-mac'), nm('win', 'lab-windows')]};
  fx.fleet.prefs = {tgroups};
  return fx;
}

test('the kind: networks make a response; machines whose networks are in responses make a cutter', async () => {
  const p = await browser.page(fx1({}), {ui: ui({tree: 'network', sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelector('#tree .row')`);
    assert.equal(await p.eval(`groupKind([{kind: 'if'}, {kind: 'if'}])`), 'response');
    assert.equal(await p.eval(`(PREFS.tgroups = {'network|net:m:lx': [{id: 'r', name: 'R', ids: ['net:if:lx:eth0', 'net:if:lx:eth1']}]}, groupKind([{kind: 'nmachine', id: 'net:m:lx'}, {kind: 'nmachine', id: 'net:m:mac'}]))`), 'cutter');
    assert.equal(await p.eval(`groupKind([{kind: 'nmachine', id: 'net:m:mac'}, {kind: 'nmachine', id: 'net:m:win'}])`), 'fleet', 'machines without responses stay a fleet');
    assert.deepEqual(await p.eval(`[GKIND.response, GKIND.cutter]`), [['Response', 'response'], ['Cutter', 'cutter']]);
    assert.equal(await p.eval(`newGroupName([], ['net:if:mac:eth0', 'net:if:mac:wg0'])`), 'Response 1');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('in the network tree: a response and a cutter show their kind, icon and colour, apart from the others', async () => {
  const fx = fx1({'network|net:m:lx': [{id: 'r1', name: 'Uplinks', ids: ['net:if:lx:eth0', 'net:if:lx:eth1']}],
                  'network|net:tailnet': [{id: 'c1', name: 'Ships', ids: ['net:m:lx', 'net:m:mac']}, {id: 'f1', name: 'Rest', ids: ['net:m:win']}]});
  const p = await browser.page(fx, {ui: ui({tree: 'network', netSel: 'net:tailnet', sel: 'lx', open: {'net:m:lx': true}})});
  try {
    await p.waitFor(`document.querySelectorAll('#tree .tgroup').length >= 2`);
    const gs = await p.eval(`Object.fromEntries([...document.querySelectorAll('#tree .tgroup')].map(g => [g.dataset.tgroup, {kind: g.dataset.kind, label: (g.querySelector('.tg-k') || {}).textContent, icon: (g.querySelector('.tg-ic svg[data-icon]') || {dataset: {}}).dataset.icon, color: getComputedStyle(g).getPropertyValue('--gc').trim()}]))`);
    assert.equal(gs.c1.kind, 'cutter'); assert.equal(gs.c1.label, 'cutter'); assert.equal(gs.c1.icon, 'gcutter');
    assert.ok(gs.r1, 'the response shows under its machine');
    assert.equal(gs.r1.kind, 'response'); assert.equal(gs.r1.label, 'response'); assert.equal(gs.r1.icon, 'gresponse');
    const colours = [gs.c1.color, gs.r1.color, gs.f1 ? gs.f1.color : '', await p.eval(`getComputedStyle(document.documentElement).getPropertyValue('--g-division').trim()`)];
    assert.match(gs.c1.color, /^#|^rgb/); assert.match(gs.r1.color, /^#|^rgb/, JSON.stringify(colours));
    await p.shot('netgroups');
    assert.equal(new Set(colours.filter(Boolean)).size, colours.filter(Boolean).length, 'apart from the network tree’s other kinds: ' + JSON.stringify(colours));
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
