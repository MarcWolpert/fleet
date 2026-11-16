// SPDX-License-Identifier: GPL-3.0-or-later
// The Tutorial pill (#283): getting started, what Fleet's terms mean, and every keyboard shortcut, in a modal.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const TEXT = sel => `(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`;

test('the Tutorial pill beside Settings opens a modal: getting started, Fleet terms, keyboard', async () => {
  const p = await browser.page(fixture(), {ui: ui({sel: 'fleet'})});
  try {
    await p.waitFor(`document.querySelector('[data-tutorial]')`);
    assert.equal(await p.eval(`(() => { const t = document.querySelector('[data-tutorial]').getBoundingClientRect(), s = document.querySelector('.setbtn').getBoundingClientRect(); return t.right <= s.left + 1 && Math.abs((t.top + t.bottom) / 2 - (s.top + s.bottom) / 2) < 6; })()`), true, 'beside Settings');
    await p.eval(`(document.querySelector('[data-tutorial]').click(), true)`);
    await p.waitFor(`document.querySelector('#tutorial[role=dialog]')`);
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#tutorial [role=tab]')].map(t => t.textContent.trim())`), ['Getting started', 'Fleet terms', 'Keyboard']);
    assert.match(await p.eval(TEXT('#tutorial [role=tabpanel]:not([hidden])')), /Add a machine/);
    await p.eval(`(document.querySelectorAll('#tutorial [role=tab]')[1].click(), true)`);
    const terms = await p.eval(TEXT('#tutorial [role=tabpanel]:not([hidden])'));
    for (const t of ['Space', 'Pins only', 'Base system', 'Docker Compose', 'Containers', 'VMs', 'Cron jobs', 'Fleet', 'Flotilla', 'Division', 'Section', 'Squadron', 'Task force', 'Details', 'Each GPU', 'CCD', 'Network tree', 'Auto', 'Colour vision'])
      assert.ok(terms.includes(t), t);
    await p.eval(`(document.querySelectorAll('#tutorial [role=tab]')[2].click(), true)`);
    assert.equal(await p.eval(`document.querySelectorAll('#tutorial [role=tabpanel]:not([hidden]) tr').length`), await p.eval(`SHORTCUTS.length`), 'every shortcut, from the same list as ?');
    await p.eval(`(document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})), true)`);
    await p.waitFor(`!document.getElementById('tutorial')`);
    assert.equal(await p.eval(`document.activeElement && document.activeElement.matches('[data-tutorial]')`), true, 'focus back on the pill');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

