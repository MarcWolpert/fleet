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
    assert.deepEqual(await p.eval(MENU), ['✓ Ghostty', 'iTerm', 'Terminal', '—', 'Open inline, below the page', 'Change the default…']);
    await pick(p, 'iTerm');
    await p.waitFor(`${JSON.stringify(true)} && document.getElementById('ctxmenu').hidden`);
    await p.waitFor(`true`);
    assert.deepEqual(terms(fx).pop(), {node: 'lx', terminal: 'iterm'});
    // a right-click on the button itself: the same menu
    const took = await p.eval(`(() => { const b = document.querySelector('.hero [data-terminal="lx"]'), r = b.getBoundingClientRect(); const ev = new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5}); b.dispatchEvent(ev); return ev.defaultPrevented; })()`);
    assert.equal(took, true);
    assert.deepEqual(await p.eval(MENU), ['✓ Ghostty', 'iTerm', 'Terminal', '—', 'Open inline, below the page', 'Change the default…']);
    await pick(p, 'Terminal');
    assert.deepEqual(terms(fx).pop(), {node: 'lx', terminal: 'terminal'});
    // the button itself still opens the default
    await p.eval(`(document.querySelector('.hero [data-terminal="lx"]').click(), true)`);
    await p.waitFor(`true`);
    assert.deepEqual(terms(fx).pop(), {node: 'lx'});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
