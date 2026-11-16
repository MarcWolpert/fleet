// SPDX-License-Identifier: GPL-3.0-or-later
// Many spaces (#383): the pills in the top bar keep their size and the bar scrolls sideways (the wheel scrolls it), the
// space you go to scrolls into view, and nothing in it overlaps.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const OVERLAPS = `(() => { const out = [], ps = [...document.querySelectorAll('#spaces .space')].map(e => e.getBoundingClientRect());
  for (let i = 1; i < ps.length; i++) if (ps[i].left < ps[i - 1].right - 0.5) out.push('pill ' + i);
  document.querySelectorAll('#spaces .space').forEach((s, i) => { const k = [...s.children].filter(c => c.getBoundingClientRect().width).map(c => c.getBoundingClientRect());
    const box = s.getBoundingClientRect();
    for (let j = 1; j < k.length; j++) if (k[j].left < k[j - 1].right - 0.5) out.push('inside pill ' + i);
    if (k.some(c => c.right > box.right + 0.5)) out.push('out of pill ' + i); });
  return out; })()`;

test('many spaces: the pills keep their size, the bar scrolls (the wheel too), and the one you go to comes into view', async () => {
  const fx = fixture();
  const ids = ['lx', 'lx2', 'win', 'mac', 'lx/containers', 'lx2/containers', 'win/containers', 'mac/containers', 'lx/containers/web', 'lx2/containers/web', 'mac/containers/web'];
  fx.fleet.pins = ids;
  const p = await browser.page(fx, {ui: ui({sel: 'fleet'}), width: 1100});
  try {
    await p.waitFor(`document.querySelectorAll('#spaces .space').length >= 10`);
    assert.deepEqual(await p.eval(OVERLAPS), []);
    assert.deepEqual(await p.eval(`[...new Set([...document.querySelectorAll('#spaces .space')].map(e => getComputedStyle(e).flexShrink))]`), ['0'], 'a pill never squeezes its name under its close button');
    const bar = await p.eval(`(() => { const b = document.getElementById('spaces'); return {sw: b.scrollWidth, cw: b.clientWidth}; })()`);
    assert.ok(bar.sw > bar.cw + 50, 'it overflows, so it scrolls: ' + JSON.stringify(bar));
    await p.eval(`(document.getElementById('spaces').dispatchEvent(new WheelEvent('wheel', {deltaY: 300, bubbles: true, cancelable: true})), true)`);
    await p.waitFor(`document.getElementById('spaces').scrollLeft > 100`);
    await p.eval(`(document.getElementById('spaces').scrollLeft = 0, true)`);
    await p.eval(`(goSpace('mac/containers/web'), true)`);
    await p.waitFor(`(() => { const b = document.getElementById('spaces').getBoundingClientRect(), a = document.querySelector('#spaces .space.active').getBoundingClientRect(); return a.left >= b.left - 1 && a.right <= b.right + 1; })()`);
    assert.deepEqual(await p.eval(OVERLAPS), []);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
