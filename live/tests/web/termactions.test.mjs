// SPDX-License-Identifier: GPL-3.0-or-later
// The terminals' own actions, like VS Code's (#339): split a terminal (⌘\), kill one (⌘⌫ or Delete on its tab),
// rename it, move a split one to its own tab, drag a tab onto a terminal to split it there (⌘Z puts it back), and
// right-click menus that depend on where you click: a tab, or the bar. Inside a terminal, ttyd's own.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch, sleep} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const posts = (fx, path) => (fx.posts || []).filter(x => x.path === path).map(x => JSON.parse(x.body));
// the page acts at once and tells the server just after: wait for the nth such request
const sent = async (fx, path, n) => { for (let i = 0; i < 150 && posts(fx, path).length < n; i++) await sleep(20); return posts(fx, path); };
const LABELS = `[...document.querySelectorAll('#ctxmenu [role=menuitem], #ctxmenu .cx-sep')].map(e => e.classList.contains('cx-sep') ? '—' : (e.querySelector('.cx-l') || e).textContent.trim())`;
const HINTS = `Object.fromEntries([...document.querySelectorAll('#ctxmenu [role=menuitem]')].filter(e => e.querySelector('.cx-k')).map(e => [e.querySelector('.cx-l').textContent.trim(), e.querySelector('.cx-k').textContent.trim()]))`;
const pick = (p, label) => p.eval(`(() => { [...document.querySelectorAll('#ctxmenu [role=menuitem]')].find(e => (e.querySelector('.cx-l') || e).textContent.trim() === ${JSON.stringify(label)}).click(); return true; })()`);
const TABS = `[...document.querySelectorAll('#tdrawer [role=tab]')].map(t => t.textContent.trim())`;
// the visible panes, left to right: [id, left %, width %] of the frames' box
const PANES = `(() => { const b = document.querySelector('#tdrawer .td-frames').getBoundingClientRect(); return [...document.querySelectorAll('#tdrawer .td-pane:not([hidden])')].map(p => { const r = p.getBoundingClientRect(); return [p.dataset.tdid, Math.round((r.left - b.left) / b.width * 100), Math.round(r.width / b.width * 100)]; }).sort((a, c) => a[1] - c[1]); })()`;
const rclick = (p, sel) => p.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}), r = e.getBoundingClientRect(); e.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: r.left + 6, clientY: r.top + r.height / 2})); return true; })()`);
const key = async (p, k, code, modifiers, vk) => { for (const type of ['keyDown', 'keyUp']) await p.send('Input.dispatchKeyEvent', {type, key: k, code, modifiers, windowsVirtualKeyCode: vk}); };

function fx1(){
  const fx = fixture();
  fx.config = {path: '/dev/null', interval: 3, machines: [], status: {}, terminal: 'auto', terminal_auto: 'Ghostty', terminals: [['ghostty', 'Ghostty']]};
  let n = 0;
  fx.onPost = (path, body) => {
    const b = JSON.parse(body);
    if (path === '/api/inline-terminal'){ n++; const m = fx.fleet.machines.find(x => x.id === b.node); return {ok: true, id: 's' + n, url: '/fake-' + n + '.html', title: m ? m.name : b.node, group: b.group || 's' + n}; }
    if (path === '/api/inline-terminal/close' || path === '/api/inline-terminal/update') return {ok: true};
    return null;
  };
  return fx;
}

test('the tab menu: split, kill, move to its own tab; ⌘\\ splits and ⌘⌫ kills from the bar', async () => {
  const fx = fx1();
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelector('.hero [data-terminal="lx"]')`);
    await p.eval(`(openInline('lx'), true)`);
    await p.waitFor(`document.querySelector('#tdrawer iframe')`);
    await rclick(p, '#tdrawer [role=tab]');
    await p.waitFor(`document.querySelector('#ctxmenu [role=menuitem]')`);
    assert.deepEqual(await p.eval(LABELS), ['Split terminal', 'Rename…', 'Kill terminal', '—', 'Close tab']);
    assert.deepEqual(await p.eval(HINTS), {'Split terminal': '⌘\\', 'Kill terminal': '⌘⌫'});
    await pick(p, 'Split terminal');
    await p.waitFor(`(${PANES}).length === 2`);
    assert.deepEqual([posts(fx, '/api/inline-terminal')[1].node, posts(fx, '/api/inline-terminal')[1].group], ['lx', 's1'], 'it joins the tab');
    assert.deepEqual((await p.eval(PANES)).map(x => [x[0], x[2]]), [['s1', 50], ['s2', 50]], 'side by side, half each');
    assert.deepEqual(await p.eval(TABS), ['lab-linux · lab-linux'], 'one tab');
    // ⌘\ from the tab bar: a third
    await p.eval(`(document.querySelector('#tdrawer [role=tab]').focus(), true)`);
    await key(p, '\\', 'Backslash', 4, 220);
    await p.waitFor(`(${PANES}).length === 3`);
    assert.deepEqual((await p.eval(PANES)).map(x => x[2]), [33, 33, 33]);
    // the menu now offers moving one to its own tab
    await rclick(p, '#tdrawer [role=tab]');
    await p.waitFor(`document.querySelector('#ctxmenu [role=menuitem]')`);
    assert.deepEqual(await p.eval(LABELS), ['Split terminal', 'Move to its own tab', 'Rename…', 'Kill terminal', '—', 'Close tab']);
    await pick(p, 'Kill terminal');   // the one you're on: the newest
    await p.waitFor(`(${PANES}).length === 2`);
    assert.deepEqual(await sent(fx, '/api/inline-terminal/close', 1), [{id: 's3'}]);
    assert.deepEqual((await p.eval(PANES)).map(x => x[2]), [50, 50], 'the rest fill the tab');
    // ⌘⌫ on the tab kills the one you're on
    await p.eval(`(document.querySelector('#tdrawer [role=tab]').focus(), true)`);
    await key(p, 'Backspace', 'Backspace', 4, 8);
    await p.waitFor(`(${PANES}).length === 1`);
    assert.equal((await sent(fx, '/api/inline-terminal/close', 2)).length, 2);
    // split again, then move it to its own tab
    await p.eval(`(document.querySelector('#tdrawer [role=tab]').focus(), true)`);
    await key(p, '\\', 'Backslash', 4, 220);
    await p.waitFor(`(${PANES}).length === 2 && document.querySelectorAll('#tdrawer .td-pane:not([hidden]) iframe').length === 2`);
    await rclick(p, '#tdrawer [role=tab]');
    await p.waitFor(`document.querySelector('#ctxmenu [role=menuitem]')`);
    await pick(p, 'Move to its own tab');
    await p.waitFor(`document.querySelectorAll('#tdrawer [role=tab]').length === 2`);
    const moved = (await sent(fx, '/api/inline-terminal/update', 1)).pop();
    assert.equal(moved.group, moved.id, 'its own tab, kept');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('rename a terminal from its tab; Esc keeps the old name', async () => {
  const fx = fx1();
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelector('.hero [data-terminal="lx"]')`);
    await p.eval(`(openInline('lx'), true)`);
    await p.waitFor(`document.querySelector('#tdrawer iframe')`);
    const ren = async (text, finish) => {
      await rclick(p, '#tdrawer [role=tab]');
      await p.waitFor(`document.querySelector('#ctxmenu [role=menuitem]')`);
      await pick(p, 'Rename…');
      await p.waitFor(`document.activeElement && document.activeElement.matches('#tdrawer input.td-name')`);
      await p.eval(`(document.activeElement.value = ${JSON.stringify(text)}, true)`);
      await p.key(finish);
      await p.waitFor(`!document.querySelector('#tdrawer input.td-name')`);
    };
    await ren('logs', 'Escape');
    assert.deepEqual(await p.eval(TABS), ['lab-linux']);
    assert.equal(posts(fx, '/api/inline-terminal/update').length, 0);
    await ren('logs', 'Enter');
    assert.deepEqual(await p.eval(TABS), ['logs']);
    assert.deepEqual(await sent(fx, '/api/inline-terminal/update', 1), [{id: 's1', title: 'logs'}]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('drag a tab onto the terminal you see: it splits there; ⌘Z puts it back', async () => {
  const fx = fx1();
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelector('.hero [data-terminal="lx"]')`);
    await p.eval(`(openInline('lx'), true)`);
    await p.waitFor(`document.querySelectorAll('#tdrawer iframe').length === 1`);
    await p.eval(`(openInline('mac'), true)`);
    await p.waitFor(`document.querySelectorAll('#tdrawer iframe').length === 2`);
    assert.deepEqual(await p.eval(TABS), ['lab-linux', 'lab-mac']);
    // drag the first tab (lab-linux) onto the terminal shown (lab-mac's)
    await p.eval(`(() => { const t = document.querySelector('#tdrawer [data-tdtab]'), a = t.getBoundingClientRect(), f = document.querySelector('#tdrawer .td-frames').getBoundingClientRect();
      const o = (x, y) => ({bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1});
      t.dispatchEvent(new PointerEvent('pointerdown', o(a.left + 10, a.top + 8)));
      for (let i = 1; i <= 6; i++) document.dispatchEvent(new PointerEvent('pointermove', o(a.left + 10 + (f.left + f.width * 0.7 - a.left) * i / 6, a.top + 8 + (f.top + f.height / 2 - a.top) * i / 6)));
      document.dispatchEvent(new PointerEvent('pointerup', o(f.left + f.width * 0.7, f.top + f.height / 2))); return true; })()`);
    await p.waitFor(`document.querySelectorAll('#tdrawer [role=tab]').length === 1`);
    assert.deepEqual((await p.eval(PANES)).map(x => x[0]), ['s2', 's1'], 'it joins lab-mac\'s tab');
    assert.deepEqual(await sent(fx, '/api/inline-terminal/update', 1), [{id: 's1', group: 's2'}]);
    await p.eval(`(document.querySelector('#tdrawer [role=tab]').focus(), true)`);
    await key(p, 'z', 'KeyZ', 4, 90);
    await p.waitFor(`document.querySelectorAll('#tdrawer [role=tab]').length === 2`);
    assert.deepEqual((await sent(fx, '/api/inline-terminal/update', 2)).pop(), {id: 's1', group: 's1'});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('right-click on the bar: the terminals\' own menu; on a tab: that tab\'s', async () => {
  const fx = fx1();
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelector('.hero [data-terminal="lx"]')`);
    await p.eval(`(openInline('lx'), true)`);
    await p.waitFor(`document.querySelector('#tdrawer iframe')`);
    await p.eval(`(() => { const b = document.querySelector('#tdrawer .td-bar'), r = b.getBoundingClientRect(), t = document.querySelector('#tdrawer [role=tab]').getBoundingClientRect();
      b.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: (t.right + r.right) / 2, clientY: r.top + r.height / 2})); return true; })()`);
    await p.waitFor(`document.querySelector('#ctxmenu [role=menuitem]')`);
    const bar = await p.eval(LABELS);
    for (const want of ['New terminal…', 'Minimize', 'Larger text', 'Smaller text', 'Actual size']) assert.ok(bar.includes(want), want + ' in ' + bar);
    assert.ok(!bar.includes('Split terminal'));
    assert.equal(await p.eval(`document.querySelector('#ctxmenu').getAttribute('aria-label')`), 'Terminals');
    await pick(p, 'Smaller text');
    await p.waitFor(`PREFS.termFont === 12`);
    await rclick(p, '#tdrawer [role=tab]');
    await p.waitFor(`document.querySelector('#ctxmenu').getAttribute('aria-label') === 'lab-linux'`);
    assert.ok((await p.eval(LABELS)).includes('Split terminal'));
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
