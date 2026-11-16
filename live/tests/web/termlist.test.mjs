// SPDX-License-Identifier: GPL-3.0-or-later
// VS Code's terminal list (#405): with more than one terminal, a list on the right, split ones joined by tree lines;
// click, double-click to rename, right-click, hover to split or kill. On the bar, + ∨ (new terminals on any machine,
// split) and … (clear, rename, kill, text size, templates, reset).
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch, sleep} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const posts = (fx, path) => (fx.posts || []).filter(x => x.path === path).map(x => JSON.parse(x.body));
const sent = async (fx, path, n) => { for (let i = 0; i < 150 && posts(fx, path).length < n; i++) await sleep(20); return posts(fx, path); };
const ROWS = `[...document.querySelectorAll('#tdrawer .tdl-row')].map(r => (r.querySelector('.tdl-conn').textContent + ' ' + r.querySelector('.tdl-name').textContent).trim() + (r.getAttribute('aria-selected') === 'true' ? ' *' : ''))`;
const LABELS = `[...document.querySelectorAll('#ctxmenu [role=menuitem], #ctxmenu .cx-sep')].map(e => e.classList.contains('cx-sep') ? '—' : (e.querySelector('.cx-l') || e).textContent.trim())`;
const pick = (p, label) => p.eval(`(() => { [...document.querySelectorAll('#ctxmenu [role=menuitem]')].find(e => (e.querySelector('.cx-l') || e).textContent.trim() === ${JSON.stringify(label)}).click(); return true; })()`);

function fx1(){
  const fx = fixture();
  fx.config = {path: '/dev/null', interval: 3, machines: [], status: {}, terminal: 'auto', terminal_auto: 'Ghostty', terminals: [['ghostty', 'Ghostty']]};
  let n = 0;
  fx.onPost = (path, body) => {
    const b = JSON.parse(body);
    if (path === '/api/inline-terminal'){ n++; const m = fx.fleet.machines.find(x => x.id === b.node); return {ok: true, id: 's' + n, url: '/fake-' + n + '.html', title: m ? m.name : b.node, group: b.group || 's' + n}; }
    if (path.startsWith('/api/inline-terminal/')) return {ok: true};
    return null;
  };
  return fx;
}

test('the list: on the right with more than one terminal, splits joined by tree lines; click, rename, menu, hover buttons', async () => {
  const fx = fx1();
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelector('.hero [data-terminal="lx"]')`);
    await p.eval(`(openInline('lx'), true)`);
    await p.waitFor(`document.querySelectorAll('#tdrawer iframe').length === 1`);
    assert.equal(await p.eval(`!document.querySelector('#tdrawer .td-list') || document.querySelector('#tdrawer .td-list').hidden`), true, 'one terminal: no list');
    await p.eval(`(openInline('mac'), true)`);
    await p.waitFor(`document.querySelectorAll('#tdrawer iframe').length === 2`);
    await p.waitFor(`document.querySelector('#tdrawer .td-list') && !document.querySelector('#tdrawer .td-list').hidden`);
    const box = await p.eval(`(() => { const l = document.querySelector('#tdrawer .td-list').getBoundingClientRect(), f = document.querySelector('#tdrawer .td-frames').getBoundingClientRect(), d = document.getElementById('tdrawer').getBoundingClientRect(); return {right: Math.abs(l.right - d.right) < 2, beside: l.left >= f.right - 1}; })()`);
    assert.deepEqual(box, {right: true, beside: true}, 'on the right, beside the terminals');
    assert.deepEqual(await p.eval(ROWS), ['lab-linux', 'lab-mac *']);
    await p.eval(`(splitInline(), true)`);
    await p.waitFor(`document.querySelectorAll('#tdrawer iframe').length === 3`);
    assert.deepEqual(await p.eval(ROWS), ['lab-linux', '┌ lab-mac', '└ lab-mac *']);
    // click a row: that terminal
    await p.eval(`(document.querySelector('#tdrawer .tdl-row').click(), true)`);
    await p.waitFor(`(${ROWS})[0].endsWith('*')`);
    // double-click: rename it there
    await p.eval(`(document.querySelector('#tdrawer .tdl-row').dispatchEvent(new MouseEvent('dblclick', {bubbles: true})), true)`);
    await p.waitFor(`document.activeElement && document.activeElement.matches('#tdrawer .tdl-row input.td-name')`);
    await p.eval(`(document.activeElement.value = 'logs', true)`);
    await p.key('Enter');
    await p.waitFor(`(${ROWS})[0] === 'logs *'`);
    assert.deepEqual(await sent(fx, '/api/inline-terminal/update', 1), [{id: 's1', title: 'logs'}]);
    // right-click a row: that terminal's menu
    await p.eval(`(() => { const r = document.querySelectorAll('#tdrawer .tdl-row')[2], b = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: b.left + 10, clientY: b.top + 5})); return true; })()`);
    await p.waitFor(`document.querySelector('#ctxmenu [role=menuitem]')`);
    assert.ok((await p.eval(LABELS)).includes('Kill terminal'));
    await p.key('Escape');
    // hover buttons: kill the third
    await p.eval(`(document.querySelectorAll('#tdrawer .tdl-row')[2].querySelector('[data-tdlkill]').click(), true)`);
    await p.waitFor(`document.querySelectorAll('#tdrawer .tdl-row').length === 2`);
    assert.deepEqual(await sent(fx, '/api/inline-terminal/close', 1), [{id: 's3'}]);
    // and split from a row
    await p.eval(`(document.querySelectorAll('#tdrawer .tdl-row')[1].querySelector('[data-tdlsplit]').click(), true)`);
    await p.waitFor(`document.querySelectorAll('#tdrawer .tdl-row').length === 3`);
    assert.equal(posts(fx, '/api/inline-terminal').pop().node, 'mac');
    // drag a row onto another: it joins that one's split; ⌘Z puts it back
    await p.waitFor(`document.querySelectorAll('#tdrawer iframe').length === 3`);
    assert.deepEqual(await p.eval(ROWS).then(r => r.map(x => x.replace(' *', ''))), ['logs', '┌ lab-mac', '└ lab-mac']);
    await p.eval(`(() => { const rows = document.querySelectorAll('#tdrawer .tdl-row'), a = rows[0].getBoundingClientRect(), b = rows[2].getBoundingClientRect();
      const o = (x, y) => ({bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1});
      rows[0].dispatchEvent(new PointerEvent('pointerdown', o(a.left + 30, a.top + 10)));
      for (let i = 1; i <= 5; i++) document.dispatchEvent(new PointerEvent('pointermove', o(a.left + 30, a.top + 10 + (b.top - a.top) * i / 5)));
      document.dispatchEvent(new PointerEvent('pointerup', o(b.left + 30, b.top + 10))); return true; })()`);
    await p.waitFor(`(${ROWS}).length === 3 && (${ROWS}).map(x => x.replace(' *', '')).join('|') === '┌ lab-mac|├ lab-mac|└ logs'`);
    assert.deepEqual((await sent(fx, '/api/inline-terminal/update', 2)).pop(), {id: 's1', group: 's2'});
    await p.eval(`(document.querySelector('#tdrawer .tdl-row').focus(), true)`);
    await p.send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 4, windowsVirtualKeyCode: 90});
    await p.send('Input.dispatchKeyEvent', {type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 4, windowsVirtualKeyCode: 90});
    await p.waitFor(`(${ROWS}).map(x => x.replace(' *', '')).join('|') === 'logs|┌ lab-mac|└ lab-mac'`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('+ ∨ opens new terminals on any connected computer, or splits; … has the rest', async () => {
  const fx = fx1();
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelector('.hero [data-terminal="lx"]')`);
    await p.eval(`(openInline('lx'), true)`);
    await p.waitFor(`document.querySelector('#tdrawer iframe')`);
    await p.eval(`(document.querySelector('#tdrawer [data-tdaddmenu]').click(), true)`);
    await p.waitFor(`document.querySelector('#ctxmenu [role=menuitem]')`);
    assert.deepEqual(await p.eval(LABELS), ['New terminal on lab-linux', 'New terminal on lab-linux-2', 'New terminal on lab-windows', 'New terminal on lab-mac', '—', 'Split terminal', 'Another machine or container…']);
    await pick(p, 'New terminal on lab-mac');
    await p.waitFor(`document.querySelectorAll('#tdrawer iframe').length === 2`);
    assert.equal(posts(fx, '/api/inline-terminal').pop().node, 'mac');
    await p.eval(`(document.querySelector('#tdrawer [data-tdmore]').click(), true)`);
    await p.waitFor(`document.querySelector('#ctxmenu [role=menuitem]')`);
    const more = await p.eval(LABELS);
    for (const w of ['Clear terminal', 'Rename…', 'Kill terminal', 'Larger text', 'Smaller text', 'Templates…', 'Reset the terminals…']) assert.ok(more.includes(w), w);
    // Clear terminal asks the terminal (Fleet's script in ttyd's page) to clear itself
    await p.eval(`(() => { window.__sent = []; const f = document.querySelector('#tdrawer .td-pane:not([hidden]) iframe'); f.contentWindow.postMessage = m => window.__sent.push(m); return true; })()`);
    await pick(p, 'Clear terminal');
    await p.waitFor(`window.__sent.some(m => m && m.fleet === 'termClear')`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
