// SPDX-License-Identifier: GPL-3.0-or-later
// Durable inline terminals (#337): the server keeps them (their shells in tmux); the page shows the kept ones when it
// loads, attaches the one you're on (and the others when you go to them), and attaches them again when Fleet restarts.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const posts = (fx, path) => (fx.posts || []).filter(x => x.path === path).map(x => JSON.parse(x.body));
const TABS = `[...document.querySelectorAll('#tdrawer [role=tab]')].map(t => t.textContent.trim() + (t.getAttribute('aria-selected') === 'true' ? ' *' : ''))`;
const SRC = `[...document.querySelectorAll('#tdrawer iframe')].map(f => f.getAttribute('src'))`;

function fx1(terms){
  const fx = fixture();
  fx.config = {path: '/dev/null', interval: 3, machines: [], status: {}, terminal: 'auto', terminal_auto: 'Ghostty', terminals: [['ghostty', 'Ghostty']]};
  fx.terms = terms;
  fx.fleet.boot = 'b1';
  fx.fleet.prefs = Object.assign({}, fx.fleet.prefs, {termActive: 'r2', termClosed: ['lx2', 'win', 'mac']});   // just the kept ones here (#338 adds the others)
  let n = 0;
  fx.gone = new Set();
  fx.onPost = (path, body) => {
    if (path === '/api/inline-terminal/attach'){ const id = JSON.parse(body).id; return fx.gone.has(id) ? {ok: false, gone: true, error: 'That terminal was closed.'} : {ok: true, id, url: `/fake-${id}-${++n}.html`, title: id === 'r1' ? 'lab-linux' : 'lab-mac'}; }
    if (path === '/api/inline-terminal/close') return {ok: true};
    return null;
  };
  return fx;
}
const KEPT = {terminals: [{id: 'r1', node: 'lx', title: 'lab-linux', live: false}, {id: 'r2', node: 'mac', title: 'lab-mac', live: false}], tmux: true, ttyd: true};

test('the kept terminals are back after a reload; the one you were on attaches, the rest when you go to them', async () => {
  const fx = fx1(KEPT);
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelectorAll('#tdrawer [role=tab]').length === 2`);
    assert.deepEqual(await p.eval(TABS), ['lab-linux', 'lab-mac *']);
    await p.waitFor(`document.querySelector('#tdrawer iframe')`);
    assert.deepEqual(posts(fx, '/api/inline-terminal/attach').map(x => x.id), ['r2'], 'only the one you were on');
    assert.ok(posts(fx, '/api/inline-terminal/attach')[0].theme, 'themed');
    assert.deepEqual(await p.eval(SRC), ['/fake-r2-1.html']);
    await p.eval(`(document.querySelector('#tdrawer [data-tdtab]').click(), true)`);
    await p.waitFor(`document.querySelectorAll('#tdrawer iframe').length === 2`);
    assert.deepEqual(posts(fx, '/api/inline-terminal/attach').map(x => x.id), ['r2', 'r1']);
    await p.waitFor(`PREFS.termActive === 'r1'`);
    assert.equal(posts(fx, '/api/prefs').pop().termActive, 'r1', 'the one you are on is kept');
    assert.equal(posts(fx, '/api/inline-terminal').length, 0, 'no new terminal was made');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('when Fleet restarts, the terminals attach again (their shells kept running); one closed meanwhile goes', async () => {
  const fx = fx1(KEPT);
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelector('#tdrawer iframe')`);
    await p.eval(`(document.querySelector('#tdrawer [data-tdtab]').click(), true)`);
    await p.waitFor(`document.querySelectorAll('#tdrawer iframe').length === 2`);
    await p.eval(`(document.querySelector('#tdrawer iframe').__mark = 1, true)`);
    fx.fleet.boot = 'b2';
    fx.terms = {terminals: [KEPT.terminals[0]], tmux: true, ttyd: true};
    fx.gone.add('r2');
    await p.eval(`(refreshNow(), true)`);
    await p.waitFor(`document.querySelectorAll('#tdrawer [role=tab]').length === 1`);
    await p.waitFor(`(${SRC}).includes('/fake-r1-3.html')`);
    assert.deepEqual(await p.eval(TABS), ['lab-linux *']);
    assert.equal(await p.eval(`document.querySelector('#tdrawer iframe').__mark`), 1, 'the same frame, pointed at the new ttyd');
    assert.equal(posts(fx, '/api/inline-terminal').length, 0);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('without tmux the terminals say a reload starts a new shell, and how to keep them', async () => {
  const fx = fx1({terminals: [KEPT.terminals[0]], tmux: false, ttyd: true});
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelector('#tdrawer iframe')`);
    assert.match(await p.eval(`document.getElementById('tdrawer').textContent`), /install tmux/i);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
