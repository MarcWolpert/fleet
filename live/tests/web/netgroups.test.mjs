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
    assert.ok(gs.f1, 'the fleet shows'); assert.equal(gs.f1.kind, 'fleet');
    const colours = [gs.c1.color, gs.r1.color, gs.f1.color, ...await p.eval(`['--g-division', '--g-taskforce'].map(v => getComputedStyle(document.documentElement).getPropertyValue(v).trim())`)];
    assert.match(gs.c1.color, /^#|^rgb/); assert.match(gs.r1.color, /^#|^rgb/, JSON.stringify(colours));
    await p.shot('netgroups');
    assert.equal(new Set(colours.filter(Boolean)).size, colours.filter(Boolean).length, 'apart from the network tree’s other kinds: ' + JSON.stringify(colours));
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

// #407 review: a bridge's ports grouped under the bridge are a response too; a response whose networks are gone isn't;
// finding in the tree doesn't change a group's kind
const nmb = (id, name) => Object.assign(nm(id, name), {ifs: [nif('br0', 'bridge'), Object.assign(nif('eth0', 'physical'), {master: 'br0'}), Object.assign(nif('eth1', 'physical'), {master: 'br0'}), nif('wg0', 'virtual')]});
test('the kind holds: a bridge’s ports, networks that are gone, finding in the tree', async () => {
  const fx = fx1({'network|net:if:lx:br0': [{id: 'r1', name: 'Ports', ids: ['net:if:lx:eth0', 'net:if:lx:eth1']}],
                  'network|net:tailnet': [{id: 'c1', name: 'Ships', ids: ['net:m:lx', 'net:m:mac']}]});
  fx.net.machines[0] = nmb('lx', 'lab-linux');
  const p = await browser.page(fx, {ui: ui({tree: 'network', netSel: 'net:tailnet', sel: 'lx', open: {'net:m:lx': true, 'net:if:lx:br0': true}})});
  const KINDS = `Object.fromEntries([...document.querySelectorAll('#tree .tgroup')].map(g => [g.dataset.tgroup, g.dataset.kind]))`;
  try {
    await p.waitFor(`document.querySelectorAll('#tree .tgroup').length >= 2`);
    assert.deepEqual(await p.eval(KINDS), {c1: 'cutter', r1: 'response'});
    // the ports' group remembered for networks that have gone (a stopped VM's vnet0 and vnet1): no response, so a fleet
    assert.equal(await p.eval(`(PREFS.tgroups = Object.assign({}, PREFS.tgroups, {'network|net:m:mac': [{id: 'r2', name: 'Gone', ids: ['net:if:mac:vnet0', 'net:if:mac:vnet1']}]}),
      groupKind([netNodes['net:m:mac'], netNodes['net:m:win']]))`), 'fleet');
    // found in the tree, lab-mac alone: its group is still a cutter
    await p.eval(`(TF.q = 'lab-mac', renderTree(), true)`);
    await p.waitFor(`document.querySelector('#tree .tgroup[data-tgroup="c1"]')`);
    assert.equal(await p.eval(`document.querySelector('#tree .tgroup[data-tgroup="c1"]').dataset.kind`), 'cutter');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a name Fleet gave follows the kind; disbanding the response makes the cutter a fleet again', async () => {
  const fx = fx1({'network|net:tailnet': [{id: 'c1', name: 'Fleet 1', ids: ['net:m:lx', 'net:m:mac']}, {id: 'f2', name: 'Home', ids: ['net:m:win']}]});
  const p = await browser.page(fx, {ui: ui({tree: 'network', netSel: 'net:tailnet', sel: 'lx', open: {'net:m:lx': true}})});
  const G = `Object.fromEntries([...document.querySelectorAll('#tree .tgroup')].map(g => [g.querySelector('.tg-n').textContent, [g.dataset.kind, g.querySelector('.tg-ic svg[data-icon]').dataset.icon]]))`;
  const saved = () => JSON.parse(fx.posts.filter(w => w.path === '/api/prefs').pop().body).tgroups;
  try {
    await p.waitFor(`document.querySelectorAll('#tree .tgroup').length >= 2`);
    // drop eth1 onto eth0 in lab-linux: a response, and the fleet holding lab-linux becomes a cutter, named for it
    await p.eval(`(moveToGroup('network|net:m:lx', 'net:if:lx:eth1', null, 'net:if:lx:eth0'), true)`);
    await p.waitFor(`document.querySelectorAll('#tree .tgroup').length >= 3`);
    assert.deepEqual(await p.eval(G), {'Cutter 1': ['cutter', 'gcutter'], 'Response 1': ['response', 'gresponse'], Home: ['fleet', 'gfleet']});
    assert.deepEqual(saved()['network|net:tailnet'].map(g => g.name), ['Cutter 1', 'Home'], 'saved, and your own name kept');
    const rid = saved()['network|net:m:lx'][0].id;
    assert.deepEqual(await p.eval(`[ctxFor(document.querySelector('#tree .tgroup[data-tgroup="c1"] .tg-h')).items.filter(Boolean).pop().label,
      ctxFor(document.querySelector('#tree .tgroup[data-tgroup="${rid}"] .tg-h')).items.filter(Boolean).pop().label]`), ['Disband cutter', 'Disband response']);
    // more machines: Fleet names the next group of them a cutter, after Cutter 1
    assert.deepEqual(await p.eval(`[newGroupName([], ['net:m:lx', 'net:m:win']), newGroupName([{name: 'Cutter 1'}], ['net:m:lx', 'net:m:win'])]`), ['Cutter 1', 'Cutter 2']);
    // disband the response: a fleet again
    await p.eval(`(updGroup('network|net:m:lx', '${rid}', null), true)`);
    await p.waitFor(`document.querySelectorAll('#tree .tgroup').length === 2`);
    assert.deepEqual(await p.eval(G), {'Fleet 1': ['fleet', 'gfleet'], Home: ['fleet', 'gfleet']});
    assert.deepEqual(saved()['network|net:tailnet'].map(g => g.name), ['Fleet 1', 'Home']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('every theme and colour vision gives a response and a cutter their own colours', async () => {
  const p = await browser.page(fx1({}), {ui: ui({tree: 'network', sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelector('#tree .row')`);
    const each = await p.eval(`allThemes().flatMap(th => ['', 'deutan', 'protan', 'tritan'].map(cvd => {
      PREFS = Object.assign({}, PREFS, {theme: th.id, cvd}); applyTheme(currentTheme());
      const v = k => getComputedStyle(document.documentElement).getPropertyValue('--g-' + k).trim().toLowerCase();
      return [th.id + '/' + cvd, v('response') === v('squadron') && v('cutter') === v('flotilla'), new Set(['response', 'cutter', 'fleet', 'division', 'taskforce'].map(v)).size];
    }))`);
    assert.deepEqual(each.filter(([, alias, n]) => !alias || n !== 5), [], 'each pair: the alias holds, and five colours apart');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
