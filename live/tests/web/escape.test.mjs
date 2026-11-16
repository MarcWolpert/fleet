// SPDX-License-Identifier: GPL-3.0-or-later
// Escape closes the dialog that's open, wherever focus is (#396).
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const DIALOGS = [
  ['Settings', `openSettings()`, `!document.getElementById('sheet').hidden`],
  ['the shortcut list', `openKeys()`, `!!document.getElementById('keys')`],
  ['Go to anything', `openGoto()`, `!!document.getElementById('goto')`],
  ['Add a machine', `openAddMachine()`, `!!document.getElementById('addm-bg')`],
  ['Choose machines', `openChooseMachines()`, `!!document.getElementById('choosem-bg')`],
  ['the Tutorial', `openTutorial(0)`, `!!document.getElementById('tutorial-bg')`],
  ['Terminal templates', `openTermTemplates()`, `!!document.getElementById('termdlg')`],
  ['the space picker', `openPicker()`, `!!(document.getElementById('picker') && !document.getElementById('picker').hidden)`]];

for (const where of ['inside', 'elsewhere'])
  test(`Escape closes each dialog, with focus ${where}`, async () => {
    const p = await browser.page(fixture(), {ui: ui({sel: 'lx'})});
    try {
      await p.waitFor(`document.querySelector('#tree .row')`);
      const stuck = [];
      for (const [name, open, isOpen] of DIALOGS){
        await p.eval(`(Promise.resolve(${open}), true)`);
        try { await p.waitFor(isOpen, 3000); } catch (e) { stuck.push(name + ' (did not open)'); continue; }
        if (where === 'elsewhere') await p.eval(`(document.activeElement && document.activeElement.blur && document.activeElement.blur(), true)`);
        await p.key('Escape');
        try { await p.waitFor(`!(${isOpen})`, 2000); } catch (e) { stuck.push(name); await p.eval(`(closeSettings && SET.open && closeSettings(), document.querySelectorAll('.sheet-bg:not(#sheet)').forEach(x => x.remove()), typeof closePicker === 'function' && PICK.open && closePicker(false), true)`); }
      }
      assert.deepEqual(stuck, []);
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  });
