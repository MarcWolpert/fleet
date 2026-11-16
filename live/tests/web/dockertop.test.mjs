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
    assert.deepEqual(fx.procCalls || [], [], 'no /api/proc for a VM process');
    await p.eval(`(document.querySelector('tr[data-pid="d:abc123:7"] td').click(), true)`);
    await p.waitFor(`!document.querySelector('tr.pinsp')`);
    // sorting by PID uses the number
    await p.eval(`(() => { const th = [...document.querySelectorAll('.ptbl thead th')].find(t => /PID/.test(t.textContent)); (th.querySelector('button') || th).click(); return true; })()`);
    await p.waitFor(`${ROWS}.length > 3`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
