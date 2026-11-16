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

test('on the first launch the tutorial opens as a welcome, once; people already using Fleet never see it (#284)', async () => {
  const fx = fixture(); delete fx.fleet.prefs;   // nothing saved yet, on the server or in this browser: a first launch
  let p = await browser.page(fx, {});
  try {
    await p.waitFor(`document.querySelector('#tutorial[role=dialog]')`);
    assert.equal(await p.eval(TEXT('#tutorial h2')), 'Welcome to Fleet');
    assert.equal(await p.eval(`document.querySelector('#tutorial [role=tab][aria-selected=true]').textContent.trim()`), 'Getting started');
    await p.eval(`([...document.querySelectorAll('#tutorial [data-tutclose]')].find(b => /Get started/.test(b.textContent)).click(), true)`);
    await p.waitFor(`!document.getElementById('tutorial')`);
    await p.waitFor(`(window.__n = (window.__n || 0) + 1) > 2`);
    const posted = (fx.posts || []).filter(x => x.path === '/api/prefs').map(x => JSON.parse(x.body));
    assert.equal(posted.pop().seenTutorial, true, 'remembered in ui.json');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
  for (const prefs of [{seenTutorial: true}, {theme: 'fleet'}, undefined]){   // seen it; already using Fleet; or this browser has used it
    const fx2 = fixture(); if (prefs) fx2.fleet.prefs = prefs;
    p = await browser.page(fx2, prefs ? {} : {ui: ui({sel: 'fleet'})});
    try {
      await p.waitFor(`document.querySelector('#tree .row')`);
      await new Promise(ok => setTimeout(ok, 600));
      assert.equal(await p.eval(`!!document.getElementById('tutorial')`), false, JSON.stringify(prefs));
    } finally { await p.close(); }
  }
});
