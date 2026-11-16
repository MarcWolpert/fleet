// SPDX-License-Identifier: GPL-3.0-or-later
// Each GPU (issue #6): like the CCD viewer, every GPU is a group of live tiles, one per metric that GPU
// reports (engines, memory, sensors), with nothing invented for metrics it doesn't report.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const H = 60, flat = v => new Array(H).fill(v);
const GB = 1024 ** 3;
// an NVIDIA card with everything nvidia-smi gives, and an Intel card with what i915 gives
const NVM = [['util', null, flat(41)], ['3d', null, flat(41)], ['compute', null, flat(0)], ['copy', null, flat(2)], ['encode', null, flat(4)], ['decode', null, flat(12)],
  ['memctl', null, flat(3)], ['vram', 16 * GB, flat(4 * GB)], ['temp', null, flat(47)], ['power', 140, flat(36.7)], ['clock', 1950, flat(1410)], ['memclock', null, flat(7000)], ['fan', null, flat(30)]];
const INTEL = [['util', null, flat(50)], ['3d', null, flat(50)], ['copy', null, flat(10)], ['video', null, flat(10)], ['vpp', null, flat(0)],
  ['temp', null, flat(54)], ['power', 31.25, flat(8)], ['clock', 2450, flat(0)], ['fanrpm', null, flat(4286)]];
const MAC = [['util', null, flat(15)], ['3d', null, flat(13)], ['tiler', null, flat(9)], ['sysmem', null, flat(3.2 * GB)]];

const GROUPS = `[...document.querySelectorAll('.ggroups > .ggroup')].map(g => ({gpu: g.querySelector('[data-gsel]').dataset.gsel, tiles: [...g.querySelectorAll('[data-gm]')].map(t => t.dataset.gm)}))`;
const TILE = (gpu, k) => `document.querySelector('.ggroup[data-gpu="${gpu}"] [data-gm="${k}"]')`;
async function open(fx, sel = 'lx'){
  const p = await browser.page(fx, {ui: ui({sel, metric: 'gpu', gpuView: 'each'})});
  try { await p.waitFor(`document.querySelectorAll('.ggroups > .ggroup').length > 0`); } catch (e) { await p.close(); throw e; }
  return p;
}
function fx2(){
  const fx = fixture(), lx = fx.fleet.machines.find(m => m.id === 'lx');
  lx.gpus = [Object.assign({}, lx.gpus[0], {m: NVM}), {name: 'Intel Arc A310', mem: 'up to 2.45 GHz', m: INTEL}];
  fx.fleet.machines.find(m => m.id === 'mac').gpus[0].m = MAC;
  return fx;
}

test('every GPU is a group with one tile per metric it reports, in one order, nothing else', async () => {
  const p = await open(fx2());
  try {
    assert.deepEqual(await p.eval(GROUPS), [
      {gpu: 'gpu0', tiles: ['util', '3d', 'compute', 'copy', 'encode', 'decode', 'memctl', 'vram', 'temp', 'power', 'clock', 'memclock', 'fan']},
      {gpu: 'gpu1', tiles: ['util', '3d', 'copy', 'video', 'vpp', 'temp', 'power', 'clock', 'fanrpm']}]);
    const text = async (g, k) => (await p.eval(`${TILE(g, k)}.textContent`)).replace(/\s+/g, ' ').trim();
    assert.match(await text('gpu0', 'vram'), /VRAM.*4\.0 GB.*of 16 GB/);
    assert.match(await text('gpu0', 'decode'), /Video decode.*12%/);
    assert.match(await text('gpu0', 'power'), /Power.*37 W.*of 140 W/);
    assert.match(await text('gpu0', 'clock'), /Clock.*1\.41 GHz.*of 1\.95 GHz/);
    assert.match(await text('gpu0', 'temp'), /Temperature.*47 °C/);
    assert.match(await text('gpu1', 'fanrpm'), /Fan.*4,286 rpm/);
    assert.match(await text('gpu1', 'clock'), /Clock.*0 MHz.*of 2\.45 GHz/);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a Mac GPU shows what macOS reports; a GPU without metrics still shows its utilisation', async () => {
  const fx = fx2();
  let p = await open(fx, 'mac');
  try {
    assert.deepEqual(await p.eval(GROUPS), [{gpu: 'gpu0', tiles: ['util', '3d', 'tiler', 'sysmem']}]);
    assert.match(await p.eval(`${TILE('gpu0', '3d')}.textContent`), /Renderer/);
  } finally { await p.close(); }
  p = await open(fx, 'win');   // this fixture's Windows GPU has no metrics: utilisation from its history only
  try {
    assert.deepEqual(await p.eval(GROUPS), [{gpu: 'gpu0', tiles: ['util']}]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('clicking a GPU\'s tile picks that GPU, as before; a pinned metric goes first in its group and is saved', async () => {
  const fx = fx2();
  const p = await open(fx);
  try {
    await p.eval(`(() => { ${TILE('gpu1', 'video')}.querySelector('[data-gsel]').click(); return true; })()`);
    await p.waitFor(`document.querySelector('.ggroup[data-gpu="gpu1"]').classList.contains('sel')`);
    assert.equal(await p.eval(`document.querySelector('.ggroup[data-gpu="gpu0"]').classList.contains('sel')`), false);
    await p.eval(`(() => { ${TILE('gpu0', 'temp')}.querySelector('[data-tpin]').click(); return true; })()`);
    await p.waitFor(`${GROUPS}[0].tiles[0] === 'temp'`);
    assert.deepEqual((await p.eval(GROUPS))[0].tiles.slice(0, 3), ['temp', 'util', '3d']);
    const post = (fx.posts || []).filter(x => x.path === '/api/tilepins').pop();
    assert.ok(post && post.body.includes('gpu0:temp'), 'saved');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
