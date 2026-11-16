// SPDX-License-Identifier: GPL-3.0-or-later
// ⌘K knows every command Fleet has (#340): every row of the shortcut list says which ⌘K command it is (with the same
// keys), or that it only makes sense in place (null); and the newer commands are there too, and run.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

for (const platform of ['MacIntel', 'Linux x86_64'])
  test(`${platform}: every shortcut is a ⌘K command with the same keys, or says it only makes sense in place`, async () => {
    const p = await browser.page(fixture(), {ui: ui({sel: 'lx'}), platform});
    try {
      await p.waitFor(`document.querySelector('#tree .row')`);
      const bad = await p.eval(`(() => {
        const cmds = gotoCommands(), by = Object.fromEntries(cmds.map(c => [c.label, c])), out = [];
        for (const [what, keys, to] of SHORTCUTS){
          if (to === undefined){ out.push('no command named: ' + what); continue; }
          if (to === null) continue;
          const labels = Array.isArray(to) ? to : to.see;
          for (const l of labels) if (!by[l]) out.push('no ⌘K command "' + l + '" for: ' + what);
          if (Array.isArray(to) && to.length === keys.length) to.forEach((l, i) => { if (by[l] && by[l].hint !== keys[i]) out.push('"' + l + '" says ' + by[l].hint + ', the list ' + keys[i]); });
        }
        return out; })()`);
      assert.deepEqual(bad, []);
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  });

test('the newer commands are in ⌘K, and run', async () => {
  const fx = fixture(); fx.fleet.pins = ['mac'];
  const p = await browser.page(fx, {ui: ui({sel: 'lx', open: {lx: true}})});
  try {
    await p.waitFor(`document.querySelector('#tree .row')`);
    const labels = await p.eval(`gotoCommands().map(c => c.label)`);
    for (const want of ['Tutorial', 'Add a machine…', 'Choose machines to connect…', 'Connect automatically…', 'Higher contrast: on', 'Colour vision: Deuteranopia (green-weak)',
      'Collapse the whole tree (~)', 'Force expand the whole tree (F~)', 'New terminal…', 'Terminal templates…', 'Reset the terminals…', 'Go to All machines', 'Go to space: lab-mac', 'Refresh now'])
      assert.ok(labels.includes(want), want);
    const run = l => p.eval(`(gotoCommands().find(c => c.label === ${JSON.stringify(l)}).run(), true)`);
    await run('Higher contrast: on');
    await p.waitFor(`PREFS.contrast === true`);
    assert.ok((await p.eval(`gotoCommands().map(c => c.label)`)).includes('Higher contrast: off'), 'it says what it does next');
    await run('Collapse the whole tree (~)');
    await p.waitFor(`(S.foldStack.machines || []).length === 1`);
    await run('Go to space: lab-mac');
    await p.waitFor(`S.space === 'mac'`);
    await run('Tutorial');
    await p.waitFor(`document.getElementById('tutorial')`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
