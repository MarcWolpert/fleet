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

// Each tile's pin, hit where a mouse would click it (its centre): the element there must be the pin, not the
// tile's select button under it. A label too long for its tile used to clip the pin, which sat inside it (#291).
// The tile is scrolled into view, never the pin: scrollIntoView would also scroll the clipping label.
const PIN_MISSES = `[...document.querySelectorAll('.ggroup [data-gm]')].map(t => {
  const pin = t.querySelector('[data-tpin]'); t.scrollIntoView({block: 'center'});
  const b = pin.getBoundingClientRect(), at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2), tb = t.getBoundingClientRect();
  const inside = b.width > 0 && b.left >= tb.left && b.right <= tb.right;
  return (at && at.closest('[data-tpin]') === pin && inside) ? null : t.closest('.ggroup').dataset.gpu + ':' + t.dataset.gm + ' hits ' + (at ? at.className : 'nothing');
}).filter(Boolean)`;

test('every GPU metric tile\'s pin can be clicked with a mouse, at every width; the label gives way instead (#291)', async () => {
  const fx = fx2(), lx = fx.fleet.machines.find(m => m.id === 'lx');
  // the longest labels next to wide values: Mem. controller at 100%, Mem. clock at 10.50 GHz, Temperature, Video encode
  lx.gpus[0].m = NVM.map(([k, lim, h]) => [k, lim, k === 'memctl' ? flat(100) : k === 'memclock' ? flat(10500) : k === 'encode' ? flat(100) : k === 'temp' ? flat(100) : h]);
  for (const width of [1500, 1100, 900]){
    const p = await browser.page(fx, {ui: ui({sel: 'lx', metric: 'gpu', gpuView: 'each'}), width});
    try {
      await p.waitFor(`document.querySelectorAll('.ggroups > .ggroup').length === 2`);
      assert.deepEqual(await p.eval(PIN_MISSES), [], `at ${width}px`);
      if (width === 900){   // a real click on Mem. controller's pin pins it, and doesn't pick the GPU
        const at = await p.eval(`(() => { const t = ${TILE('gpu0', 'memctl')}; t.scrollIntoView({block: 'center'}); const b = t.querySelector('[data-tpin]').getBoundingClientRect(); return {x: b.left + b.width / 2, y: b.top + b.height / 2}; })()`);
        await p.clickAt(at.x, at.y);
        await p.waitFor(`${GROUPS}[0].tiles[0] === 'memctl'`);
        assert.equal(await p.eval(`document.querySelectorAll('.ggroup.sel').length`), 0, 'no GPU picked');
        // the label is still there, cut short if it must be, and says what it is in full on hover
        assert.match(await p.eval(`${TILE('gpu0', 'memctl')}.querySelector('.lt').textContent`), /^Mem\. controller$/);
      }
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  }
});

test('Base is counted on each GPU by what it uses there, not all on GPU 0 (#116)', async () => {
  const fx = fx2(), lx = fx.fleet.machines.find(m => m.id === 'lx'), lx2 = fx.fleet.machines.find(m => m.id === 'lx2');
  const h = g => ({cpu: flat(1), mem: flat(2), gpu: flat(g), disk: flat(0), net: flat(0)});
  lx.base = {id: 'lx/base', h: h(150), g: ['gpu0', 'gpu1'], gh: {gpu0: flat(50), gpu1: flat(100)}};
  lx2.base = {id: 'lx2/base', h: h(150), g: ['gpu0']};   // the control: without gh, Base is split over its tags as before
  const p = await open(fx);
  try {
    const on = (mid, k) => p.eval(`gpuConsumers(nodes['${mid}'], '${k}').map(c => [c.n.id, c.v])`);
    assert.deepEqual([await on('lx', 'gpu0'), await on('lx', 'gpu1')], [[['lx/base', 50]], [['lx/base', 100]]]);
    assert.equal(await p.eval(`whichGpu(nodes['lx/base'])`), 'GPU0+1');
    assert.deepEqual([await on('lx2', 'gpu0'), await on('lx2', 'gpu1')], [[['lx2/base', 150]], []]);
    assert.equal(await p.eval(`whichGpu(nodes['lx2/base'])`), 'GPU0');
    // GPUs: what runs on which
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('.gpus > .gpu')].map(g => [g.querySelector('.v').textContent, [...g.querySelectorAll('.rank .namebtn')].map(b => [b.dataset.select, b.nextElementSibling.nextElementSibling.textContent])])`),
      [['50%', [['lx/base', '50%']]], ['100%', [['lx/base', '100%']]]]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

// A picked GPU and the Usage sort read the GPU's own utilisation, like its tiles. The server tags Base
// system gpu0 whichever GPU it runs on (#116), so the tree's per-GPU split can't stand in for it.
const PICKED = `[...document.querySelectorAll('section.card')].filter(s => s.querySelector('[data-gpuclear]')).map(s => ({
  title: s.querySelector('h2').textContent, sub: s.querySelector('.card-h .sub').textContent,
  legend: [...s.querySelectorAll('.legend span')].map(x => x.textContent),
  rank: [...s.querySelectorAll('.gpu-rank .namebtn')].map(b => b.textContent.trim() + ' ' + b.nextElementSibling.nextElementSibling.textContent),
  note: [...s.querySelectorAll(':scope > .sub')].map(x => x.textContent)}))`;
const ORDER = `[...document.querySelectorAll('.ggroups > .ggroup')].map(g => g.dataset.gpu)`;
// lab-linux's two GPUs at their own utilisation; Base system's GPU use tagged gpu0, as the server sends it
function own(u0, u1, baseGpu){
  const fx = fixture(), lx = fx.fleet.machines.find(m => m.id === 'lx');
  lx.gpus = [Object.assign({}, lx.gpus[0], {m: [['util', null, u0], ['temp', null, flat(40)]]}), Object.assign({}, lx.gpus[1], {m: [['util', null, u1]]})];
  lx.base.h = {gpu: baseGpu};
  return fx;
}
async function picked(fx, keys, over = {}){
  const p = await browser.page(fx, {ui: ui(Object.assign({sel: 'lx', metric: 'gpu', gpuView: 'each', gpuSel: {mid: 'lx', keys}}, over))});
  try { await p.waitFor(`${PICKED}.length === ${keys.length}`); } catch (e) { await p.close(); throw e; }
  return p;
}
const spike = (v, i, at) => { const a = flat(v); a[i] = at; return a; };
const BUSY = 'Nothing in the tree is counted on this GPU, though it’s busy. Details lists the processes using it.';

test('a bare-metal process on GPU 1: GPU 1 is busy and GPU 0 idle, in the picked card and the Usage sort', async () => {
  const fx = own(spike(0, 10, 35), flat(100), flat(100));
  let p = await picked(fx, ['gpu1'], {tileSort: {gpu: 'usage'}});
  try {
    assert.deepEqual(await p.eval(ORDER), ['gpu1', 'gpu0'], 'Usage sort: the busy GPU first');
    assert.deepEqual(await p.eval(PICKED), [{title: 'GPU 1 · NVIDIA RTX A2000', sub: '12 GB VRAM · now 100% · peak 100%', legend: [], rank: [], note: [BUSY]}]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
  p = await picked(fx, ['gpu0']);
  try {
    assert.deepEqual((await p.eval(PICKED)).map(c => c.sub), ['16 GB VRAM · now 0% · peak 35%']);
    assert.deepEqual(await p.eval(ORDER), ['gpu0', 'gpu1'], 'Index sort is unchanged');
  } finally { await p.close(); }
});

test('both GPUs busy outside containers: each picked GPU reads its own 100%, not 200% and 0%', async () => {
  const p = await picked(own(flat(100), flat(100), flat(200)), ['gpu0', 'gpu1']);
  try {
    assert.deepEqual((await p.eval(PICKED)).map(c => [c.title, c.sub]), [
      ['GPU 0 · NVIDIA RTX A4000', '16 GB VRAM · now 100% · peak 100%'], ['GPU 1 · NVIDIA RTX A2000', '12 GB VRAM · now 100% · peak 100%']]);
  } finally { await p.close(); }
});

test('a container on GPU 1: listed with what is left as everything else; nothing else is listed', async () => {
  const fx = own(flat(0), flat(100), flat(0));
  const lx = fx.fleet.machines.find(m => m.id === 'lx');
  lx.containers[0] = Object.assign({}, lx.containers[0], {g: ['gpu1'], gh: {gpu1: flat(60)}, h: {gpu: flat(60)}});
  const p = await picked(fx, ['gpu1']);
  try {
    assert.deepEqual(await p.eval(PICKED), [{title: 'GPU 1 · NVIDIA RTX A2000', sub: '12 GB VRAM · now 100% · peak 100%', legend: ['web', 'everything else'], rank: ['web 60%'], note: []}]);
  } finally { await p.close(); }
});

test('an idle GPU with nothing on it still says nothing is using it', async () => {
  const p = await picked(own(flat(0), flat(0), flat(0)), ['gpu1']);
  try {
    assert.deepEqual(await p.eval(PICKED), [{title: 'GPU 1 · NVIDIA RTX A2000', sub: '12 GB VRAM · now 0% · peak 0%', legend: [], rank: [], note: ['Nothing is using this GPU.']}]);
  } finally { await p.close(); }
});

test('a GPU that reports no utilisation of its own falls back to what the tree counts on it', async () => {
  const fx = fixture(), win = fx.fleet.machines.find(m => m.id === 'win');
  win.base.h = {gpu: flat(30)}; win.base.gh = {gpu0: flat(30)};
  const p = await browser.page(fx, {ui: ui({sel: 'win', metric: 'gpu', gpuView: 'each', gpuSel: {mid: 'win', keys: ['gpu0']}})});
  try {
    await p.waitFor(`${PICKED}.length === 1`);
    assert.deepEqual(await p.eval(PICKED), [{title: 'GPU 0 · NVIDIA GeForce RTX 3090', sub: '24 GB VRAM · now 30% · peak 30%', legend: [], rank: ['Base system 30%'], note: []}]);
  } finally { await p.close(); }
});
