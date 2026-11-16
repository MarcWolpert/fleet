// SPDX-License-Identifier: GPL-3.0-or-later
// An open drop-down holds (#411): its process stays in Details while it's open, even once it no longer matches a
// selection filter (a CCD it has moved off), and a reload for Fleet's own changed files waits until it's closed.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// a copy of web/ whose files the second test changes, as an edit to a checkout does
const WEB = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-web-'));
fs.cpSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web'), WEB, {recursive: true});
process.env.FLEET_TEST_WEB = WEB;
const {launch} = await import('./harness.mjs');
const {fixture, ui} = await import('./fixtures.mjs');

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); fs.rmSync(WEB, {recursive: true, force: true}); });

const SLOW = 20000;
const CCD1 = [8, 9, 10, 11, 12, 13, 14, 15];
const settle = ms => new Promise(r => setTimeout(r, ms));
function fx1(){
  const fx = fixture();
  let n = 0;
  fx.proc = (m, pid) => ({pid, name: 'x', state: 'S', cmdline: 'x --serve', waits: {events: 10, lock: 2}, samples: 12, dt: 1.5, cpu: {user: 0.1, system: 0, run_s: 0.1, runq_s: 0}, t: Date.now() / 1000 + (++n)});
  return fx;
}
const ROWS = `[...document.querySelectorAll('.ptbl tbody tr[data-pid]')].map(r => +r.dataset.pid)`;

test('the open process stays in Details after it moves off the selected CCD, marked, till you close it', async () => {
  const fx = fx1();
  const p = await browser.page(fx, {ui: Object.assign(ui({sel: 'lx', view: 'details'}), {cpuSel: {mid: 'lx', cpus: CCD1}})});
  try {
    await p.waitFor(`document.querySelectorAll('.ptbl tbody tr[data-pid]').length > 1`, SLOW);
    const rows = await p.eval(ROWS), pid = rows[1];
    assert.ok(fx.procs.lx.procs.filter(q => rows.includes(q[0])).every(q => CCD1.includes(q[12])), 'Details shows CCD 1’s');
    await p.eval(`(document.querySelector('.ptbl tbody tr[data-pid="${pid}"] td:nth-child(4)').click(), true)`);
    await p.waitFor(`document.querySelector('tr.pinsp') && INSP.looks >= 1`, SLOW);
    // it moves to CPU 2, on CCD 0
    fx.procs.lx.procs.find(q => q[0] === pid)[12] = 2;
    for (let i = 0; i < 3; i++){ await p.eval(`(refreshNow(), true)`); await settle(400); }
    assert.ok((await p.eval(ROWS)).includes(pid), 'its row is still there');
    assert.equal(await p.eval(`!!document.querySelector('tr.pinsp')`), true, 'and its drop-down');
    assert.ok(await p.eval(`INSP.looks`) >= 3, 'still looking');
    const row = await p.eval(`(() => { const r = document.querySelector('.ptbl tbody tr[data-pid="${pid}"]'); return [r.classList.contains('held'), r.title]; })()`);
    assert.deepEqual(row, [true, 'Open, so it stays: it no longer last ran on CCD 1']);
    // a process still on CCD 1 isn't marked
    assert.equal(await p.eval(`document.querySelector('.ptbl tbody tr[data-pid="${rows[0]}"]').classList.contains('held')`), false);
    // closed: it goes, as the filter says
    await p.eval(`(closeInspect(), true)`);
    await p.waitFor(`!${ROWS}.includes(${pid})`, SLOW);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a reload for Fleet’s changed files waits while a drop-down is open', async () => {
  const fx = fx1();
  const p = await browser.page(fx, {ui: ui({sel: 'lx', view: 'details'})});
  try {
    await p.waitFor(`document.querySelectorAll('.ptbl tbody tr[data-pid]').length > 3`, SLOW);
    await p.eval(`(document.querySelectorAll('.ptbl tbody tr[data-pid]')[2].querySelector('td:nth-child(4)').click(), true)`);
    await p.waitFor(`document.querySelector('tr.pinsp')`, SLOW);
    await p.eval(`(window.__same = 1, true)`);
    const later = new Date(Date.now() + 60000);
    fs.utimesSync(path.join(WEB, 'app.js'), later, later);
    await settle(4500);   // the check runs every 1.5 s
    assert.equal(await p.eval(`window.__same === 1 && !!document.querySelector('tr.pinsp')`), true, 'not reloaded while it’s open');
    await p.eval(`(closeInspect(), true)`);
    await p.waitFor(`window.__same === undefined`, SLOW);   // closed: now it reloads
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
