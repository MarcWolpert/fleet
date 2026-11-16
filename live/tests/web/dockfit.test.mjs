// SPDX-License-Identifier: GPL-3.0-or-later
// With Details docked, the main column lays out for its own width: cards stack and tile grids wrap,
// and nothing runs under the panel.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

// every card, tile and card row in the main column that passes its right edge (the panel's left edge)
const SPILL = `(() => {
  const w = document.querySelector('main > .split > .wrap'), edge = w.getBoundingClientRect().right + 0.5;
  const out = [...w.querySelectorAll('.card, .card-h, .lgrid > *, .ggrid > *, .kgrid > *, .tiles > *, .res, .rank, .mrow, .hero')]
    .filter(e => e.getBoundingClientRect().right > edge)
    .map(e => (e.className.baseVal ?? e.className).split(' ')[0] + ' +' + Math.round(e.getBoundingClientRect().right - edge) + 'px');
  return {over: [...new Set(out)], scroll: w.scrollWidth - w.clientWidth};
})()`;

const VIEWS = [['All machines', {sel: 'fleet', metric: 'cpu'}], ['CPU', {sel: 'lx', metric: 'cpu', cpuView: 'logical'}], ['Memory', {sel: 'lx', metric: 'mem'}],
  ['GPU', {sel: 'lx', metric: 'gpu', gpuView: 'each'}], ['Disk I/O', {sel: 'lx', metric: 'disk'}], ['Network', {sel: 'lx', metric: 'net'}]];

for (const [name, over] of VIEWS){
  test(`docked Details in a 1400 px window: ${name} stays inside its column`, async () => {
    const p = await browser.page(fixture(), {ui: ui(Object.assign({detailsDocked: true, dockW: 640}, over)), width: 1400, height: 900});
    try {
      await p.waitFor(`document.querySelector('main > .split > .wrap .card') && document.querySelector('.dpanel')`);
      assert.deepEqual(await p.eval(SPILL), {over: [], scroll: 0});
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  });
}

test('the column still uses its width: two cards side by side when there is room', async () => {
  const p = await browser.page(fixture(), {ui: ui({sel: 'lx', metric: 'cpu'}), width: 1700, height: 900});
  try {
    await p.waitFor(`document.querySelector('.grid2 > .card + .card')`);
    assert.equal(await p.eval(`(() => { const [a, b] = document.querySelectorAll('.grid2 > .card'); return a.getBoundingClientRect().top === b.getBoundingClientRect().top; })()`), true);
  } finally { await p.close(); }
});
