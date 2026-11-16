// SPDX-License-Identifier: GPL-3.0-or-later
// Open terminal in a specific terminal (#223): a chevron beside the button, or a right-click on it, lists the terminals
// installed here, the default ticked; picking one opens it there.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const MENU = `[...document.querySelectorAll('#ctxmenu [role=menuitem], #ctxmenu .cx-sep')].map(e => e.classList.contains('cx-sep') ? '—' : e.textContent.trim())`;
const pick = (p, label) => p.eval(`(() => { [...document.querySelectorAll('#ctxmenu [role=menuitem]')].find(e => e.textContent.trim() === ${JSON.stringify(label)}).click(); return true; })()`);
const terms = fx => (fx.posts || []).filter(x => x.path === '/api/terminal').map(x => JSON.parse(x.body));

test('the chevron and a right-click list the terminals; picking one opens it there', async () => {
  const fx = fixture();
  fx.config = {path: '/dev/null', interval: 3, machines: [], status: {}, terminal: 'auto', terminal_auto: 'Ghostty',
    terminals: [['ghostty', 'Ghostty'], ['iterm', 'iTerm'], ['terminal', 'Terminal']]};
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelector('.hero [data-termchoose="lx"]')`);
    await p.eval(`(document.querySelector('.hero [data-termchoose="lx"]').click(), true)`);
    await p.waitFor(`document.querySelector('#ctxmenu [role=menuitem]')`);
    assert.deepEqual(await p.eval(MENU), ['✓ Ghostty', 'iTerm', 'Terminal', '—', 'Change the default…']);
    await pick(p, 'iTerm');
    await p.waitFor(`${JSON.stringify(true)} && document.getElementById('ctxmenu').hidden`);
    await p.waitFor(`true`);
    assert.deepEqual(terms(fx).pop(), {node: 'lx', terminal: 'iterm'});
    // a right-click on the button itself: the same menu
    const took = await p.eval(`(() => { const b = document.querySelector('.hero [data-terminal="lx"]'), r = b.getBoundingClientRect(); const ev = new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5}); b.dispatchEvent(ev); return ev.defaultPrevented; })()`);
    assert.equal(took, true);
    assert.deepEqual(await p.eval(MENU), ['✓ Ghostty', 'iTerm', 'Terminal', '—', 'Change the default…']);
    await pick(p, 'Terminal');
    assert.deepEqual(terms(fx).pop(), {node: 'lx', terminal: 'terminal'});
    // the button itself still opens the default
    await p.eval(`(document.querySelector('.hero [data-terminal="lx"]').click(), true)`);
    await p.waitFor(`true`);
    assert.deepEqual(terms(fx).pop(), {node: 'lx'});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

// A fresh page hasn't fetched the terminals yet: the first right-click (or Shift+F10) on the button waits for them,
// so it lists them the same as the chevron does, and isn't a menu with only "Open terminal" in it.
test('the first right-click or Shift+F10 on Open terminal, before the chevron was used, lists the terminals', async () => {
  const LIST = ['✓ Ghostty', 'iTerm', 'Terminal', '—', 'Change the default…'];
  for (const how of ['right-click', 'Shift+F10']){
    const fx = fixture();
    fx.config = {path: '/dev/null', interval: 3, machines: [], status: {}, terminal: 'auto', terminal_auto: 'Ghostty',
      terminals: [['ghostty', 'Ghostty'], ['iterm', 'iTerm'], ['terminal', 'Terminal']]};
    const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
    try {
      await p.waitFor(`document.querySelector('.hero [data-terminal="lx"]')`);
      const took = how === 'right-click'
        ? await p.eval(`(() => { const b = document.querySelector('.hero [data-terminal="lx"]'), r = b.getBoundingClientRect(); const ev = new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5}); b.dispatchEvent(ev); return ev.defaultPrevented; })()`)
        : await p.eval(`(() => { const b = document.querySelector('.hero [data-terminal="lx"]'); b.focus(); const ev = new KeyboardEvent('keydown', {key: 'F10', shiftKey: true, bubbles: true, cancelable: true}); b.dispatchEvent(ev); return ev.defaultPrevented; })()`);
      assert.equal(took, true, `${how}: the browser's own menu doesn't open`);
      await p.waitFor(`document.querySelector('#ctxmenu') && !document.querySelector('#ctxmenu').hidden`);
      assert.deepEqual(await p.eval(MENU), LIST, how);
      await pick(p, 'iTerm');
      assert.deepEqual(terms(fx).pop(), {node: 'lx', terminal: 'iterm'}, how);
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  }
});
