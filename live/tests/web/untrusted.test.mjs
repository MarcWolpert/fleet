// SPDX-License-Identifier: GPL-3.0-or-later
// What a monitored host reports about itself (here its GPUs' names) is shown as text, never run as markup
// (issue #91): an admin of any machine or VM guest can name a device `<img src=x onerror=...>`.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch, sleep} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const H = 60, flat = v => new Array(H).fill(v);
const EVIL0 = 'NVIDIA <img src=x onerror="window.__xss=(window.__xss||0)+1">';
const EVIL1 = 'A & B <b id="inj">card</b>';
// lx's GPUs get names a hostile host could report; web runs on both, db (a second container) on GPU 1 only,
// idle (a third) on none
function fx2(){
  const fx = fixture(), lx = fx.fleet.machines.find(m => m.id === 'lx');
  lx.gpus = [{name: EVIL0, mem: '16 GB VRAM'}, {name: EVIL1, mem: '12 GB VRAM'}];
  lx.containers = [
    {id: 'lx/containers/web', name: 'web', image: 'nginx:1', status: 'Up 2 hours', g: ['gpu0', 'gpu1'], h: {cpu: flat(0.2), gpu: flat(30)}},
    {id: 'lx/containers/db', name: 'db', image: 'postgres:16', status: 'Up 2 hours', g: ['gpu1'], h: {cpu: flat(0.1), gpu: flat(10)}},
    {id: 'lx/containers/idle', name: 'idle', image: 'busybox:1', status: 'Up 2 hours', g: [], h: {cpu: flat(0.01)}}];
  return fx;
}
const DD = dt => `(() => { const t = [...document.querySelectorAll('#main .dl dt')].find(e => e.textContent === ${JSON.stringify(dt)}); return t ? t.nextElementSibling.textContent : null; })()`;
const INJECTED = `({img: document.querySelectorAll('#main img, #tree img').length, b: document.querySelectorAll('#inj').length, ran: window.__xss || 0})`;
async function open(fx, sel, metric = 'cpu'){
  const p = await browser.page(fx, {ui: ui({sel, metric, open: {lx: true, 'lx/containers': true}})});
  try { await p.waitFor(`document.querySelector('#main .hero h1')`); } catch (e) { await p.close(); throw e; }
  return p;
}

test('a container\'s Details card shows its GPUs\' reported names as text, exactly', async () => {
  const p = await open(fx2(), 'lx/containers/web');
  try {
    await p.waitFor(`${DD('GPU')} != null`);
    assert.equal(await p.eval(DD('GPU')), `GPU 0 (${EVIL0}) + GPU 1 (${EVIL1})`);
    await sleep(200);   // an injected onerror would have fired by now
    assert.deepEqual(await p.eval(INJECTED), {img: 0, b: 0, ran: 0});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('one GPU, no GPU in use, and the GPU tile beside it (the controls) are all text too', async () => {
  const fx = fx2();
  let p = await open(fx, 'lx/containers/db');
  try {
    await p.waitFor(`${DD('GPU')} != null`);
    assert.equal(await p.eval(DD('GPU')), `GPU 1 (${EVIL1})`);
    const tile = await p.eval(`[...document.querySelectorAll('#main .tiles .st')].find(t => t.querySelector('.k').textContent === 'GPU').querySelector('.s').textContent`);
    assert.equal(tile, `on GPU 1 (${EVIL1})`);
    assert.deepEqual(await p.eval(INJECTED), {img: 0, b: 0, ran: 0});
  } finally { await p.close(); }
  p = await open(fx, 'lx/containers/idle');
  try {
    await p.waitFor(`${DD('GPU')} != null`);
    assert.equal(await p.eval(DD('GPU')), 'none in use');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('with GPU picked, the tree\'s GPU tags and the machine\'s GPU card show the names as text', async () => {
  const p = await open(fx2(), 'lx', 'gpu');
  try {
    await p.waitFor(`document.querySelector('#tree .row[data-select="lx/containers/web"] .gtag')`);
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#tree .row[data-select^="lx/containers/"] .gtag')].map(g => [g.closest('.row').dataset.select, g.textContent, g.title])`),
      [['lx/containers/db', 'GPU1', `GPU 1 (${EVIL1})`], ['lx/containers/web', 'GPU0+1', `GPU 0 (${EVIL0}) + GPU 1 (${EVIL1})`]]);
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#main .gpus .gn')].map(e => e.textContent)`), [EVIL0, EVIL1]);
    await sleep(200);
    assert.deepEqual(await p.eval(INJECTED), {img: 0, b: 0, ran: 0});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
