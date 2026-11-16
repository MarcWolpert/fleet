// SPDX-License-Identifier: GPL-3.0-or-later
// A VM's share of its host is measured from the host side (the hypervisor's view); the VM's own tree is
// measured from inside it (CLAUDE.md, the tree model). The server takes the host-side figure out of the
// host's Base system and sends it as the VM's hostside, so the host adds up Base + containers + what the
// hypervisor sees of each VM, never the VM's inside view.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const H = 60, flat = v => new Array(H).fill(v);
const h = (cpu, mem, gpu, disk, net) => ({cpu: flat(cpu), mem: flat(mem), gpu: flat(gpu), disk: flat(disk), net: flat(net)});
const NONE = {baseCron: [], compose: [], containers: [], vms: [], gpus: []};
function vm(id, over){
  return Object.assign({id, name: id, tile: 'vm', status: 'ok', error: '', os: 'Linux · x86_64', agent: 'ssh ' + id, cronLabel: 'Cron jobs',
    cap: [4, 32, 0, 500, 125], ncpu: 4, groups: [], has_data: true, last_ok: Date.now() / 1000, base: {id: id + '/base', h: h(0, 0, 0, 0, 0)}}, NONE, over);
}
// lab-host uses 11.5 cores and 52 GB in all. Its hypervisor sees vm1 use 4 cores and 32 GB (inside, vm1 uses
// 1.5 cores and 6 GB), vm2 (unreachable) 1 core and 8 GB, and "other" (not in the config) 0.5 cores and 4 GB.
function fx(){
  return {fleet: {t: Date.now() / 1000, interval: 3, window_s: 180, pins: [], machines: [
    Object.assign(vm('host', {name: 'lab-host', tile: 'server', cap: [16, 64, 0, 500, 125], ncpu: 16, base: {id: 'host/base', h: h(5.5, 6, 0, 12, 2)}}), {
      containers: [{id: 'host/containers/web', name: 'web', image: 'nginx:1', status: 'Up', g: [], h: h(0.5, 2, 0, 2, 1)}],
      vms: [
        vm('vm1', {base: {id: 'vm1/base', h: h(1, 5, 0, 1, 0.5)}, hostside: h(4, 32, 0, 6, 2),
                   containers: [{id: 'vm1/containers/app', name: 'app', image: 'app:1', status: 'Up', g: [], h: h(0.5, 1, 0, 0, 0.5)}]}),
        vm('vm2', {status: 'hostonly', has_data: false, cap: [1, 1, 0, 1, 1], base: {id: 'vm2/base', h: h(1, 8, 0, 0, 0)}, hostside: h(1, 8, 0, 0, 0)}),
        vm('host/vms/other', {name: 'other', agent: 'seen from the host', cap: [16, 64, 0, 1, 1], base: {id: 'host/vms/other/base', h: h(0.5, 4, 0, 0, 0)}})]})
  ]}, procs: {}, cpus: {}};
}
const NOW = `(() => { const now = n => Object.fromEntries(METRICS.map(m => [m.id, +cur(n, m.id).toFixed(3)])); return {
  host: now(nodes.host), vms: now(nodes['host/vms']), byType: byType(nodes.host, 'mem'), fleet: ctxOf('fleet').bt('mem'),
  share: Object.fromEntries(['vm1', 'vm2', 'host/vms/other'].map(id => [id, +shareOfHost(nodes[id], 'mem').toFixed(3)])),
  vm1Own: byType(nodes.vm1, 'mem')}; })()`;

test('a host counts each VM by what its hypervisor sees, and each VM keeps its own inside view', async () => {
  const p = await browser.page(fx(), {ui: ui({sel: 'host', metric: 'mem', open: {'host/vms': true}})});
  try {
    await p.waitFor(`typeof nodes !== 'undefined' && !!nodes.host`);
    assert.deepEqual(await p.eval(NOW), {
      host: {cpu: 11.5, mem: 52, gpu: 0, disk: 20, net: 5},
      vms: {cpu: 5.5, mem: 44, gpu: 0, disk: 6, net: 2},
      byType: {base: 6, compose: 0, container: 2, vm: 44},
      fleet: {base: 6, compose: 0, container: 2, vm: 44},
      share: {vm1: 50, vm2: 12.5, 'host/vms/other': 6.25},
      vm1Own: {base: 5, compose: 0, container: 1, vm: 0}});
    // the tree's "% of host" column and the host's own hero say the same
    assert.deepEqual(await p.eval(`['host', 'host/vms', 'vm1', 'vm2', 'host/vms/other'].map(id => document.querySelector('[data-val="' + id + '"]').textContent)`),
      ['81%', '69%', '50%', '13%', '6.3%']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a VM\'s own page shows its inside view, and its share of the host from the host side', async () => {
  const p = await browser.page(fx(), {ui: ui({sel: 'vm1', metric: 'mem', open: {'host/vms': true}})});
  try {
    const stats = await p.waitFor(`document.querySelectorAll('.hero-stats .hs').length && [...document.querySelectorAll('.hero-stats .hs')].map(e => [e.querySelector('.k').textContent, e.querySelector('.v').textContent, e.querySelector('.s').textContent])`);
    assert.deepEqual(stats, [['CPU', '38%', '1.5 cores of 4.0 cores'], ['Memory', '19%', '6.0 GB of 32 GB'], ['GPU', '—', 'no GPU'], ['of host Memory', '50%', 'lab-host']]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
