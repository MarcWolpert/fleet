// SPDX-License-Identifier: GPL-3.0-or-later
// The harness itself: the real index.html + app.js load against the fixture API without errors.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui, PIDS, byCpuDesc} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

test('the page renders every fixture machine and nothing else', async () => {
  const p = await browser.page(fixture(), {ui: ui({sel: 'fleet'})});
  try {
    const names = await p.waitFor(`document.querySelectorAll('#tree .row.machine').length >= 4 && [...document.querySelectorAll('#tree .row.machine .nm')].map(e => e.textContent)`);
    assert.deepEqual(names, ['lab-linux', 'lab-linux-2', 'lab-mac', 'lab-windows']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the full Details view lists the selected machine\'s processes, by CPU', async () => {
  const fx = fixture();
  const p = await browser.page(fx, {ui: ui({view: 'details'})});
  try {
    const pids = await p.waitFor(`document.querySelectorAll('.ptbl tbody tr').length && ${PIDS}`);
    assert.deepEqual(pids, byCpuDesc(fx.procs.lx.procs));
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
