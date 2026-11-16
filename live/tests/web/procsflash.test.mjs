// SPDX-License-Identifier: GPL-3.0-or-later
// When Fleet restarts or a machine reconnects, its process list is "not ready" for a few seconds (not
// "no processes"): Details keeps what it shows, filter and all, and never flashes empty.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui, lxProcs} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const ROWS = `document.querySelectorAll('.dpanel .ptbl tbody tr[data-pid]').length`;

test('docked Details keeps its processes while the list is not ready, then takes the fresh one', async () => {
  const fx = fixture();
  let answer = fx.procs.lx, reads = 0;
  Object.defineProperty(fx.procs, 'lx', {get(){ reads++; return answer; }, configurable: true});
  const p = await browser.page(fx, {ui: ui({sel: 'lx', detailsDocked: true, dockW: 640})});
  try {
    await p.waitFor(`${ROWS} === 12`);
    // the fewest rows Details ever shows from here on, even for one frame
    await p.eval(`(window.__min = 12, new MutationObserver(() => { window.__min = Math.min(window.__min, ${ROWS}); }).observe(document.querySelector('.dpanel'), {childList: true, subtree: true, characterData: true}), true)`);
    answer = {procs: [], ready: false};
    const r0 = reads;
    await p.waitFor(`true`);
    while (reads < r0 + 2) await new Promise(ok => setTimeout(ok, 100));   // two polls of "not ready"
    await new Promise(ok => setTimeout(ok, 300));
    assert.equal(await p.eval(ROWS), 12);
    assert.equal(await p.eval(`window.__min`), 12, 'never flashed empty');
    answer = {procs: lxProcs(100, 'lx').slice(0, 3), gpu_procs: true, ready: true};
    await p.waitFor(`${ROWS} === 3`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
