// SPDX-License-Identifier: GPL-3.0-or-later
// Details for a container on Docker Desktop (#211): its processes come from docker top, inside Docker's Linux VM.
// They're keyed d:<container>:<pid>, so the VM's PID 1 never meets this Mac's PID 1; the PID column shows the VM's
// number with a VM tag, and clicking one says why Fleet can't look inside it instead of inspecting a Mac process.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const vmRow = (pid, ppid, name, cmd, cpu) => [`d:abc123:${pid}`, name, 'root', 'S', cpu, 0.01, 0, 0, 1, cmd, 'mac/containers/web', `d:abc123:${ppid}`, -1, [], [], [], -1];

test('a container\'s processes from Docker\'s VM: listed under it, PID with a VM tag, no clash with the Mac\'s PID 1', async () => {
  const fx = fixture();
  const launchd = [1, 'launchd', 'root', 'S', 0.01, 0.02, 0, 0, 4, '/sbin/launchd', 'mac/base', 0, -1, [], [], [], 0];
  fx.procs.mac.procs = [launchd, ...fx.procs.mac.procs, vmRow(1, 0, 'tini', '/sbin/tini -- node server.js', 0), vmRow(7, 1, 'node', 'node server.js', 1.5)];
  fx.procs.mac.ready = true;
  const p = await browser.page(fx, {ui: ui({sel: 'mac', view: 'details'})});
  const ROWS = `[...document.querySelectorAll('.ptbl tbody tr[data-pid]')].map(r => r.dataset.pid)`;
  try {
    await p.waitFor(`${ROWS}.includes('d:abc123:7')`);
    const rows = await p.eval(ROWS);
    assert.ok(rows.includes('1') && rows.includes('d:abc123:1'), 'both PID 1s, apart');
    const pidCell = await p.eval(`document.querySelector('tr[data-pid="d:abc123:7"]').textContent.replace(/\\s+/g, ' ')`);
    assert.match(pidCell, /^node7 VM(web|$)/);   // name, then the VM's PID with its tag, then where it runs
    // its drop-down opens with what Fleet knows from docker top, without asking the server to inspect a Mac PID (#217)
    await p.eval(`(document.querySelector('tr[data-pid="d:abc123:7"] td').click(), true)`);
    await p.waitFor(`document.querySelector('tr.pinsp')`);
    const panel = await p.eval(`document.querySelector('tr.pinsp').textContent.replace(/\\s+/g, ' ')`);
    assert.match(panel, /node PID 7 in Docker’s VM/);
    assert.match(panel, /node server\.js/);
    assert.match(panel, /Runs in\s*web/);
    assert.match(panel, /Threads\s*1/);
    assert.match(panel, /inside that VM/);
    assert.deepEqual(fx.procCalls || [], [], 'no /api/proc for a VM process until you choose how to look');
    // #218: choose how to look inside; the full drop-down follows from that answer
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('tr.pinsp [data-vmlook]')].map(b => b.dataset.vmlook)`), ['helper', 'exec']);
    fx.proc = (mid, pid) => ({pid: 7, name: 'node', cmdline: 'node server.js', waits: {cpu: 3, sleep: 7}, samples: 10, dt: 1.5, cpu: {run_s: 0.3, runq_s: 0}});
    await p.eval(`(document.querySelector('tr.pinsp [data-vmlook="helper"]').click(), true)`);
    await p.waitFor(`(fx => fx)(true) && /through a helper container/.test(document.querySelector('tr.pinsp').textContent)`);
    await p.waitFor(`!document.querySelector('tr.pinsp [data-vmlook]')`);
    assert.deepEqual(fx.procCalls.slice(0, 1), ['mac:d:abc123:7:helper']);
    await p.eval(`(document.querySelector('tr[data-pid="d:abc123:7"] td').click(), true)`);
    await p.waitFor(`!document.querySelector('tr.pinsp')`);
    // sorting by PID uses the number
    await p.eval(`(() => { const th = [...document.querySelectorAll('.ptbl thead th')].find(t => /PID/.test(t.textContent)); (th.querySelector('button') || th).click(); return true; })()`);
    await p.waitFor(`${ROWS}.length > 3`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

// PR 270 review: on this Mac each /api/procs runs docker top for Docker Desktop's containers, so the page says what it
// shows: Details its node (scope, unless that is the whole machine), and the lists of the CPU, disk and interface
// cards that no Docker Desktop row is ever in (docker=0).
async function procsAsked(p){
  const seen = [], off = p.on('Network.requestWillBeSent', r => { const u = new URL(r.request.url); if (u.pathname === '/api/procs') seen.push(u.search); });
  try { await p.eval(`(refreshNow(), true)`); await p.waitFor(`!busy`); await p.eval(`(refreshNow(), true)`); await p.waitFor(`!busy`); } finally { off(); }
  return [...new Set(seen)];
}
for (const [name, over, want] of [
  ['Details of the whole machine reads all of it', {sel: 'mac', view: 'details'}, ['?machine=mac']],
  ['Details of everything: the first machine, all of it', {sel: 'fleet', view: 'details'}, ['?machine=lx']],
  ['Details of one container reads that one', {sel: 'mac/containers/web', view: 'details'}, ['?machine=mac&scope=mac%2Fcontainers%2Fweb']],
  ['Details of Base system reads what is under it', {sel: 'mac/base', view: 'details'}, ['?machine=mac&scope=mac%2Fbase']],
  ['the docked Details beside a container the same', {sel: 'mac/containers/web', detailsDocked: true}, ['?machine=mac&scope=mac%2Fcontainers%2Fweb']],
  ['a CPU pick\'s list has none', {sel: 'lx', metric: 'cpu', cpuView: 'logical', cpuSel: {mid: 'lx', cpus: [4]}}, ['?machine=lx&docker=0']],
  ['a disk pick\'s list has none', {sel: 'lx', metric: 'disk', diskView: 'each', diskSel: {mid: 'lx', names: ['nvme0n1']}}, ['?machine=lx&docker=0']],
  ['an interface pick\'s list has none', {sel: 'lx', metric: 'net', ifView: 'each', ifSel: {mid: 'lx', names: ['eth0']}}, ['?machine=lx&docker=0']]]){
  test('/api/procs asks for what the page shows: ' + name, async () => {
    const fx = fixture();
    const p = await browser.page(fx, {ui: ui(Object.assign({open: {mac: true, 'mac/containers': true}}, over))});
    try {
      await p.waitFor(`document.querySelector('#main .hero h1')`);
      assert.deepEqual(await procsAsked(p), want);
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  });
}

// PR 273 review: inside its container (docker exec) the process has a PID of its own, which the drop-down names, so
// what it shows says which process it is; through a helper, the VM's PID is the one it looked at.
for (const [via, said, want] of [['exec', {pid: 12}, 'node PID 7 in Docker’s VM · PID 12 inside its container'],
                                 ['helper', {pid: 7}, 'node PID 7 in Docker’s VM · through a helper container'],
                                 ['exec', {pid: '12<b>x</b>'}, 'node PID 7 in Docker’s VM · inside its container']]){
  test(`a look ${via === 'exec' ? 'inside its container' : 'through a helper'} names the PID it looked at${typeof said.pid === 'string' ? ' (nothing else: only a number)' : ''}`, async () => {
    const fx = fixture();
    fx.procs.mac.procs = [...fx.procs.mac.procs, vmRow(1, 0, 'tini', '/sbin/tini -- node server.js', 0), vmRow(7, 1, 'node', 'node server.js', 1.5)];
    fx.procs.mac.ready = true;
    fx.proc = () => Object.assign({name: 'node', cmdline: 'node server.js', waits: {cpu: 3, sleep: 7}, samples: 10, dt: 1.5, cpu: {run_s: 0.3, runq_s: 0}}, said);
    const p = await browser.page(fx, {ui: ui({sel: 'mac', view: 'details'})});
    try {
      await p.waitFor(`document.querySelector('tr[data-pid="d:abc123:7"]')`);
      await p.eval(`(document.querySelector('tr[data-pid="d:abc123:7"] td').click(), true)`);
      await p.waitFor(`document.querySelector('tr.pinsp [data-vmlook="${via}"]')`);
      await p.eval(`(document.querySelector('tr.pinsp [data-vmlook="${via}"]').click(), true)`);
      await p.waitFor(`document.querySelector('tr.pinsp [data-wait]')`);
      assert.equal(await p.eval(`document.querySelector('tr.pinsp .insp-h > div').firstChild.parentElement.textContent.replace(/node server\\.js$/, '').replace(/\\s+/g, ' ').trim()`), want);
      assert.equal(await p.eval(`document.querySelector('tr.pinsp .insp-h b + .mono').children.length`), 0);
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  });
}
