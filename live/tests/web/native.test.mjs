// SPDX-License-Identifier: GPL-3.0-or-later
// Fleet.app's title bar is the page's space bar: the page tells the app how tall the bar is (the band) and
// where its pills and buttons are (the regions); a click in the band that misses every region drags the
// window. So what the app was last told must be where the bar is now.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch, sleep} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

// where the bar is (what's visible of it: none once the page has scrolled it away), and what the app was told last
const BAR = `(() => { const bar = document.querySelector('.spacebar');
  return {band: Math.max(0, bar.getBoundingClientRect().bottom), regions: [...bar.querySelectorAll('button, .space, input, a')].map(e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })}; })()`;
const TOLD = `(() => { const m = nativePosts.filter(m => m.regions).pop(); return m ? {band: m.band, regions: m.regions} : null; })()`;
async function told(p){
  for (let i = 0; i < 40; i++){ if (JSON.stringify(await p.eval(TOLD)) === JSON.stringify(await p.eval(BAR))) break; await sleep(25); }
  return p.eval(TOLD);
}

const PINS = ['lx', 'lx2', 'win', 'mac', 'lx/containers/web', 'lx2/containers/web', 'win/containers/web', 'mac/containers/web'];
async function open(width = 1000){
  const fx = fixture(); fx.fleet.pins = PINS;
  const p = await browser.page(fx, {ui: ui(), native: true, width});
  await p.waitFor(`document.querySelectorAll('#spaces .space').length === 9`);
  assert.deepEqual(await told(p), await p.eval(BAR));
  return {p, fx};
}

// (#188)
test('the bar Fleet.app is told about follows a poll that only changes the numbers', async () => {
  const {p, fx} = await open();
  try {
    // "0%" becomes "<0.1%", and the pills after the first one move
    const second = `document.querySelectorAll('#spaces .space')[1].getBoundingClientRect().left`;
    const was = await p.eval(second);
    fx.fleet.machines.forEach(m => { m.base.h = {cpu: new Array(60).fill(0.01)}; });
    await p.eval(`refreshNow()`);
    await p.waitFor(`document.querySelector('[data-pc="lx"]').textContent === '<0.1%'`);
    assert.ok(await p.eval(second) > was + 10, 'the second pill moved');
    assert.deepEqual(await told(p), await p.eval(BAR));
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the bar Fleet.app is told about follows the pills scrolled sideways', async () => {
  const {p} = await open();
  try {
    // to the end of the strip: every pill moves left by as much as the strip overflows
    assert.ok(await p.eval(`(() => { const s = document.getElementById('spaces'); s.scrollLeft = s.scrollWidth; return s.scrollLeft > 30; })()`), 'the pills overflow and scroll');
    assert.deepEqual(await told(p), await p.eval(BAR));
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a narrow window scrolls the bar away with the page: no band is left to drag the window by', async () => {
  const {p} = await open(820);
  try {
    await p.eval(`(scrollTo(0, 300), true)`);
    assert.equal(await p.eval(`document.scrollingElement.scrollTop`), 300);
    assert.equal((await told(p)).band, 0);
    assert.deepEqual(await told(p), await p.eval(BAR));
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
