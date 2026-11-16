// SPDX-License-Identifier: GPL-3.0-or-later
// Inline terminals (#329): Open inline splits the main pane: the page stays above, scrolling on its own, and the
// machine's or container's terminal (ttyd, framed) sits below; it keeps its session through refreshes, the split
// moves from its edge, and closing a tab ends the session. Settings pick what it starts.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const MENU = `[...document.querySelectorAll('#ctxmenu [role=menuitem], #ctxmenu .cx-sep')].map(e => e.classList.contains('cx-sep') ? '—' : e.textContent.trim())`;
const pick = (p, label) => p.eval(`(() => { [...document.querySelectorAll('#ctxmenu [role=menuitem]')].find(e => e.textContent.trim() === ${JSON.stringify(label)}).click(); return true; })()`);
const posts = (fx, path) => (fx.posts || []).filter(x => x.path === path).map(x => JSON.parse(x.body));
// a split, not an overlay: the page above (its own scroll), the terminal below, together exactly the pane's column
const ALIGNED = `(() => { const c = document.getElementById('mcol').getBoundingClientRect(), m = document.querySelector('main').getBoundingClientRect(), d = document.getElementById('tdrawer').getBoundingClientRect(), n = (a, b) => Math.abs(a - b) < 1.5;
  return n(m.left, d.left) && n(m.width, d.width) && n(m.bottom, d.top) && n(d.bottom, c.bottom) && n(m.top, c.top) && d.height > 100 && m.height > 100; })()`;

function fx1(answer){
  const fx = fixture();
  fx.config = {path: '/dev/null', interval: 3, machines: [], status: {}, terminal: 'auto', terminal_auto: 'Ghostty', terminals: [['ghostty', 'Ghostty'], ['terminal', 'Terminal']]};
  let n = 0;
  fx.onPost = path => path === '/api/inline-terminal' ? (answer || {ok: true, id: 's' + (++n), url: '/inline-fake-' + n + '.html', title: 'lab-linux'})
    : path === '/api/inline-terminal/close' ? {ok: true} : null;
  return fx;
}

test('Open inline: splits the pane, the page above and the terminal below, kept through refreshes, resizable; closing ends it', async () => {
  const fx = fx1();
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelector('.hero [data-termchoose="lx"]')`);
    await p.eval(`(document.querySelector('.hero [data-termchoose="lx"]').click(), true)`);
    await p.waitFor(`document.querySelector('#ctxmenu [role=menuitem]')`);
    assert.deepEqual(await p.eval(MENU), ['✓ Ghostty', 'Terminal', '—', 'Open inline, below the page', 'Change the default…']);
    await pick(p, 'Open inline, below the page');
    await p.waitFor(`document.querySelector('#tdrawer iframe')`);
    const sent = posts(fx, '/api/inline-terminal')[0];
    assert.equal(sent.node, 'lx');
    assert.equal(sent.then, '');
    assert.match(sent.theme.background, /^#[0-9a-f]{6}/i);
    assert.equal(await p.eval(`document.getElementById('tdrawer').hidden`), false);
    assert.match(await p.eval(`document.querySelector('#tdrawer iframe').src`), /\/inline-fake-1\.html$/);
    assert.match(await p.eval(`document.querySelector('#tdrawer [role=tab]').textContent`), /lab-linux/);
    assert.equal(await p.eval(ALIGNED), true, 'the pane split: the page above, the terminal below');
    // the frame survives refreshes (no reconnect), and the drawer follows the pane when Details docks
    await p.eval(`(document.querySelector('#tdrawer iframe').__mark = 1, true)`);
    await p.eval(`(S.detailsDocked = true, save(), renderAll(), refreshNow(), true)`);
    await p.waitFor(`document.querySelector('.dpanel')`);
    await p.waitFor(ALIGNED);
    assert.equal(await p.eval(`document.querySelector('#tdrawer iframe').__mark`), 1, 'the same frame');
    // drag its top edge up: taller, and remembered
    const h0 = await p.eval(`document.getElementById('tdrawer').getBoundingClientRect().height`);
    await p.eval(`(() => { const g = document.querySelector('#tdrawer .td-grip'), r = g.getBoundingClientRect(), y = r.top + 2, o = (yy) => ({bubbles: true, clientX: r.left + 40, clientY: yy, pointerId: 1, button: 0});
      g.dispatchEvent(new PointerEvent('pointerdown', o(y))); document.dispatchEvent(new PointerEvent('pointermove', o(y - 80))); document.dispatchEvent(new PointerEvent('pointerup', o(y - 80))); return true; })()`);
    const h1 = await p.eval(`document.getElementById('tdrawer').getBoundingClientRect().height`);
    assert.ok(Math.abs(h1 - h0 - 80) < 3, `${h0} -> ${h1}`);
    assert.equal(await p.eval(`S.termH`), Math.round(h1));
    assert.equal(await p.eval(ALIGNED), true, 'still a split after the move');
    // a second session is a second tab; closing the first ends it
    await p.eval(`(openInline('lx'), true)`);
    await p.waitFor(`document.querySelectorAll('#tdrawer [role=tab]').length === 2`);
    await p.eval(`(document.querySelector('#tdrawer [data-tdclose="s1"]').click(), true)`);
    await p.waitFor(`document.querySelectorAll('#tdrawer [role=tab]').length === 1`);
    assert.deepEqual(posts(fx, '/api/inline-terminal/close'), [{id: 's1'}]);
    await p.eval(`(document.querySelector('#tdrawer [data-tdclose="s2"]').click(), true)`);
    await p.waitFor(`document.getElementById('tdrawer').hidden`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('without ttyd the drawer says how to get it', async () => {
  const fx = fx1({ok: false, error: "Inline terminals use ttyd, which isn't installed here: brew install ttyd (macOS), sudo apt install ttyd (Debian, Ubuntu)."});
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelector('.hero [data-termchoose="lx"]')`);
    await p.eval(`(openInline('lx'), true)`);
    await p.waitFor(`/brew install ttyd/.test((document.getElementById('tdrawer') || {}).textContent || '')`);
    assert.equal(await p.eval(`document.getElementById('tdrawer').hidden`), false);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Settings pick what the inline terminal starts', async () => {
  const fx = fx1();
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelector('#tree .row')`);
    await p.eval(`(openSettings(), true)`);
    await p.waitFor(`document.querySelector('#sheet [data-inlinecmd]')`);
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#sheet [data-inlinecmd] option')].map(o => o.value)`), ['', 'tmux new -A -s fleet', 'custom']);
    await p.eval(`(() => { const s = document.querySelector('#sheet [data-inlinecmd]'); s.value = 'tmux new -A -s fleet'; s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
    await p.waitFor(`PREFS.inlineCmd === 'tmux new -A -s fleet'`);
    await p.eval(`(openInline('lx'), true)`);
    await p.waitFor(`document.querySelector('#tdrawer iframe')`);
    assert.equal(posts(fx, '/api/inline-terminal').pop().then, 'tmux new -A -s fleet');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
