// SPDX-License-Identifier: GPL-3.0-or-later
// The super button (#331): Fleet's logo at the top right of the title bar, like herdr's, opens Go to anything (⌘K)
// for anyone who doesn't know the key; its name and tooltip say the key in the platform's own notation.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

for (const [platform, key] of [['MacIntel', '⌘K'], ['Win32', 'Ctrl+K']])
  test(`${platform}: the logo at the top right opens Go to anything`, async () => {
    const p = await browser.page(fixture(), {ui: ui({sel: 'lx'}), platform});
    try {
      await p.waitFor(`document.querySelector('.spacebar [data-super]')`);
      const b = await p.eval(`(() => { const s = document.querySelector('.spacebar [data-super]'), r = s.getBoundingClientRect(), bar = document.querySelector('.spacebar').getBoundingClientRect();
        const others = [...document.querySelectorAll('.spacebar button')].filter(x => x !== s && !x.hidden && x.getBoundingClientRect().width).map(x => x.getBoundingClientRect().right);
        return {tag: s.tagName, logo: !!s.querySelector('img[src="icon.svg"]'), label: s.getAttribute('aria-label'), title: s.title, rightmost: others.every(x => x <= r.left + 1), edge: bar.right - r.right, w: r.width, h: r.height}; })()`);
      assert.equal(b.tag, 'BUTTON');
      assert.ok(b.logo, 'Fleet’s logo');
      assert.equal(b.label, `Go to anything (${key})`);
      assert.match(b.title, new RegExp(key.replace('+', '\\+')));
      assert.ok(b.rightmost, 'right of every other button');
      assert.ok(b.edge >= 0 && b.edge < 24, 'at the right edge: ' + b.edge);
      assert.ok(b.w >= 24 && b.h >= 24, 'big enough to hit');
      await p.eval(`(document.querySelector('.spacebar [data-super]').click(), true)`);
      await p.waitFor(`document.getElementById('goto')`);
      assert.equal(await p.eval(`GOTO.mode`), '');
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  });
