// SPDX-License-Identifier: GPL-3.0-or-later
// What a monitored host reports is data, never markup: the Details table shows every value as text (#166).
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch, sleep} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const IMG = '<img src=x onerror="window.__xss=(window.__xss||[]).concat(1)">';
const SVG = '<svg onload="window.__xss=(window.__xss||[]).concat(2)"></svg>';
const QUOTE = '"><img src=x onerror="window.__xss=(window.__xss||[]).concat(3)">';

test('Threads, Parent PID and PID show what the host sent as text', async () => {
  const fx = fixture();
  fx.fleet.prefs = {columns: {cpu: ['name', 'pid', 'threads', 'ppid', 'cmd']}};
  const rows = fx.procs.win.procs;   // nginx 301 and 302, postgres 303, ...
  rows[0][8] = IMG;      // threads
  rows[0][11] = SVG;     // ppid
  rows[1][0] = QUOTE;    // pid (also the row's data-pid)
  const p = await browser.page(fx, {ui: ui({sel: 'win', view: 'details'})});
  try {
    await p.waitFor(`document.querySelectorAll('.ptbl tbody tr[data-pid]').length === ${rows.length}`);
    await sleep(300);   // an injected image's onerror would have fired by now
    const cells = await p.eval(`(() => {
      const keys = [...document.querySelectorAll('.ptbl thead th')].map(th => th.dataset.colk);
      return [...document.querySelectorAll('.ptbl tbody tr[data-pid]')].map(tr => Object.fromEntries([...tr.children].map((td, i) => [keys[i], td.textContent]))).filter(c => c.name === 'nginx');
    })()`);
    assert.deepEqual(cells.map(c => [c.pid, c.threads, c.ppid]).sort(), [[QUOTE, '2', '1'], ['301', IMG, SVG]].sort());
    assert.deepEqual(await p.eval(`[document.querySelectorAll('.ptbl tbody img, .ptbl tbody svg').length, window.__xss || []]`), [0, []]);
    assert.deepEqual(await p.eval(`document.querySelector('.ptbl tbody tr[data-pid="301"] td:nth-child(3)').textContent`), IMG);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the same columns for ordinary rows: numbers, and — when there are none', async () => {
  const fx = fixture();
  fx.fleet.prefs = {columns: {cpu: ['pid', 'threads', 'ppid', 'lastcpu']}};
  fx.procs.win.procs[0][8] = 0;      // no thread count
  fx.procs.win.procs[0][11] = 0;     // no parent
  fx.procs.lx.procs[0][12] = 7;
  for (const [sel, want] of [['win', ['301', '—', '—', '—']], ['lx', ['101', '2', '1', 'cpu7']]]){
    const p = await browser.page(fx, {ui: ui({sel, view: 'details'})});
    try {
      await p.waitFor(`document.querySelectorAll('.ptbl tbody tr[data-pid]').length > 0`);
      const n = want[0];
      assert.deepEqual(await p.eval(`[...document.querySelector('.ptbl tbody tr[data-pid="${n}"]').children].map(td => td.textContent)`), want, sel);
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  }
});
