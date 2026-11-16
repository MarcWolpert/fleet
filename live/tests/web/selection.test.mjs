// SPDX-License-Identifier: GPL-3.0-or-later
// A refresh rebuilds the main pane every couple of seconds. Text someone has selected there (an image name,
// a cron command, a Compose file to copy) stays selected: the refresh waits until the selection is gone
// (issue #134). Anything you do still redraws at once, and the rest of the window keeps refreshing.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const H = 60, flat = v => new Array(H).fill(v);
function fx2(){
  const fx = fixture(), lx = fx.fleet.machines.find(m => m.id === 'lx');
  lx.containers = [{id: 'lx/containers/web', name: 'web', image: 'registry.example/team/web:1.4.2', status: 'Up 2 hours', g: [], h: {cpu: flat(0.4)}}];
  lx.baseCron = [{id: 'lx/base/cron/0', name: 'backup', sched: '0 3 * * *', human: 'daily at 03:00', cmd: '/usr/local/bin/backup --all --to /mnt/backups',
    last: '', running: true, state: 'running', src: 'crontab', g: [], h: {cpu: flat(0.2)}}];
  return fx;
}
const setCpu = (fx, i, v) => { const lx = fx.fleet.machines.find(m => m.id === 'lx'); (i === 'web' ? lx.containers[0] : lx.baseCron[0]).h.cpu = flat(v); };
const SELECT = sel => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); const r = document.createRange(); r.selectNodeContents(e); getSelection().removeAllRanges(); getSelection().addRange(r); return getSelection().toString(); })()`;
const SELECTED = `getSelection().toString()`;
const TILE = k => `[...document.querySelectorAll('#main .tiles .st')].find(t => t.querySelector('.k').textContent === ${JSON.stringify(k)}).querySelector('.v').textContent`;
const IMAGE = `#main .dl dd code`;
async function open(fx, sel, opts = {}){
  const p = await browser.page(fx, Object.assign({ui: ui({sel, open: {lx: true, 'lx/containers': true, 'lx/base': true, 'lx/base/cron': true}})}, opts));
  try { await p.waitFor(`document.querySelector('#main .hero h1') && document.querySelector('#tree .row')`); } catch (e) { await p.close(); throw e; }
  return p;
}

test('an image name stays selected across refreshes; the next refresh after it is let go shows the new reading', async () => {
  const fx = fx2();
  const p = await open(fx, 'lx/containers/web');
  try {
    assert.equal(await p.eval(TILE('CPU')), '0.40 cores');
    assert.equal(await p.eval(SELECT(IMAGE)), 'registry.example/team/web:1.4.2');
    setCpu(fx, 'web', 0.9);
    await p.eval(`(refreshNow(), true)`);
    await p.waitFor(`document.querySelector('#tree [data-val="lx/containers/web"]').textContent === '5.6%'`);   // the refresh came in: the tree has it
    await p.eval(`(refreshNow(), true)`);
    await p.waitFor(`!busy`);
    assert.equal(await p.eval(SELECTED), 'registry.example/team/web:1.4.2');
    assert.equal(await p.eval(`document.querySelector(${JSON.stringify(IMAGE)}) === getSelection().anchorNode || document.querySelector(${JSON.stringify(IMAGE)}).contains(getSelection().anchorNode)`), true);
    assert.equal(await p.eval(TILE('CPU')), '0.40 cores');
    await p.eval(`(getSelection().removeAllRanges(), refreshNow(), true)`);
    await p.waitFor(`${TILE('CPU')} === '0.90 cores'`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a cron command stays selected the same way', async () => {
  const fx = fx2();
  const p = await open(fx, 'lx/base/cron/0');
  try {
    const cmd = `[...document.querySelectorAll('#main .dl dt')].find(e => e.textContent === 'Command').nextElementSibling.querySelector('code')`;
    assert.equal(await p.eval(`(() => { const r = document.createRange(); r.selectNodeContents(${cmd}); getSelection().removeAllRanges(); getSelection().addRange(r); return getSelection().toString(); })()`),
      '/usr/local/bin/backup --all --to /mnt/backups');
    setCpu(fx, 'cron', 0.7);
    await p.eval(`(refreshNow(), true)`);
    await p.waitFor(`document.querySelector('#tree [data-val="lx/base/cron/0"]') && document.querySelector('#tree [data-val="lx/base/cron/0"]').textContent === '4.4%'`);
    assert.equal(await p.eval(SELECTED), '/usr/local/bin/backup --all --to /mnt/backups');
    assert.equal(await p.eval(TILE('CPU')), '0.20 cores');
    await p.eval(`(getSelection().removeAllRanges(), refreshNow(), true)`);
    await p.waitFor(`${TILE('CPU')} === '0.70 cores'`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the controls: a selection outside the main pane doesn\'t hold it, and choosing something redraws at once', async () => {
  const fx = fx2();
  const p = await open(fx, 'lx/containers/web');
  try {
    assert.equal(await p.eval(SELECT('#tree .row[data-select="lx"] .nm')), 'lab-linux');
    setCpu(fx, 'web', 0.9);
    await p.eval(`(refreshNow(), true)`);
    await p.waitFor(`${TILE('CPU')} === '0.90 cores'`);
    assert.equal(await p.eval(SELECT(IMAGE)), 'registry.example/team/web:1.4.2');
    await p.eval(`(select('lx'), true)`);
    await p.waitFor(`document.querySelector('#main .hero h1').firstChild.textContent.trim() === 'lab-linux'`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
