// SPDX-License-Identifier: GPL-3.0-or-later
// #2: Details groups (any Group by) are collapsible, collapsed by default, remembered per mode.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui, PIDS} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const HEADS = `[...document.querySelectorAll('.ptbl tr.gh')].map(r => { const b = r.querySelector('button[data-gtoggle]'); return b ? b.dataset.gtoggle + (b.getAttribute('aria-expanded') === 'true' ? ' (open)' : '') : 'NOT A BUTTON: ' + r.textContent; })`;
const NOTE = `(document.querySelector('.pscroll .more') || {}).textContent || ''`;
const SAVED = `JSON.parse(localStorage.getItem('fleet-live-ui')).groupOpen`;
const view = p => p.eval(`({heads: ${HEADS}, pids: ${PIDS}, note: ${NOTE}})`);

async function open(over = {}, fx = fixture()){
  const p = await browser.page(fx, {ui: ui(Object.assign({view: 'details'}, over))});
  await p.waitFor(`document.querySelectorAll('.ptbl tbody tr').length > 0`);
  return p;
}
const choose = (p, group) => p.eval(`(() => { const s = document.getElementById('pgroup'); s.value = ${JSON.stringify(group)}; s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
const header = name => `.ptbl tr.gh button[data-gtoggle=${JSON.stringify(name)}]`;

test('every Group by mode starts with every group collapsed and no process rows', async () => {
  const p = await open({group: 'user'});
  try {
    const want = {
      cpugroup: {heads: ['CCD 1', 'CCD 0'], note: 'Showing 0 of 12 processes. 12 are in 2 collapsed groups; open a group to see them.'},
      owner: {heads: ['Base system', 'web'], note: 'Showing 0 of 12 processes. 12 are in 2 collapsed groups; open a group to see them.'},
      user: {heads: ['marc', 'postgres', 'root', 'www-data', 'redis'], note: 'Showing 0 of 12 processes. 12 are in 5 collapsed groups; open a group to see them.'},
      state: {heads: ['running', 'sleeping', 'idle'], note: 'Showing 0 of 12 processes. 12 are in 3 collapsed groups; open a group to see them.'}
    };
    for (const [mode, w] of Object.entries(want)){
      await choose(p, mode);
      assert.deepEqual(await view(p), Object.assign({pids: []}, w), mode);
    }
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a group header is a button with a chevron; clicking it opens exactly that group', async () => {
  const p = await open({group: 'user'});
  try {
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('.ptbl tr.gh button[data-gtoggle]')].map(b => b.tagName + ':' + b.type + ':' + !!b.querySelector('svg'))`), Array(5).fill('BUTTON:button:true'));
    await p.click(header('root'));
    assert.deepEqual(await view(p), {heads: ['marc', 'postgres', 'root (open)', 'www-data', 'redis'], pids: [101, 109, 108, 107, 110, 112],
      note: 'Showing 6 of 12 processes. 6 are in 4 collapsed groups; open a group to see them.'});
    assert.deepEqual(await p.eval(SAVED), {user: ['root']});
    await p.click(header('root'));
    assert.deepEqual((await view(p)).pids, [], 'a second click closes it again');
    assert.deepEqual(await p.eval(SAVED), {user: []});
  } finally { await p.close(); }
});

test('Enter on a focused header toggles it and keeps the focus there', async () => {
  const p = await open({group: 'user'});
  try {
    await p.eval(`document.querySelector(${JSON.stringify(header('marc'))}).focus()`);
    await p.key('Enter');
    assert.deepEqual((await view(p)).pids, [104, 105, 106]);
    assert.equal(await p.eval(`document.activeElement.dataset.gtoggle`), 'marc');
  } finally { await p.close(); }
});

test('open groups survive a reload and are kept per Group by mode', async () => {
  const p = await open({group: 'user'});
  try {
    await p.click(header('root'));
    await p.reload();
    await p.waitFor(`document.querySelectorAll('.ptbl tr.gh').length > 0`);
    assert.deepEqual((await view(p)).heads, ['marc', 'postgres', 'root (open)', 'www-data', 'redis'], 'after a reload');
    await choose(p, 'state');
    assert.deepEqual((await view(p)).heads, ['running', 'sleeping', 'idle'], 'another mode keeps its own (none) open');
    await p.click(header('idle'));
    await choose(p, 'user');
    assert.deepEqual(await view(p), {heads: ['marc', 'postgres', 'root (open)', 'www-data', 'redis'], pids: [101, 109, 108, 107, 110, 112],
      note: 'Showing 6 of 12 processes. 6 are in 4 collapsed groups; open a group to see them.'});
    assert.deepEqual(await p.eval(SAVED), {user: ['root'], state: ['idle']});
  } finally { await p.close(); }
});

test('the row limit is shared only by the open groups, and the note says what is cut', async () => {
  const fx = fixture();
  const row = (pid, user, cpu) => [pid, 'worker', user, 'S', cpu, 0.01, 0, 0, 1, 'worker', 'lx/base', 1, 0, []];
  fx.procs.lx = {gpu_procs: true, procs: Array.from({length: 450}, (_, i) => row(1000 + i, 'alice', 1 - i / 1000)).concat(Array.from({length: 50}, (_, i) => row(5000 + i, 'bob', 0.2 - i / 1000)))};
  const p = await open({group: 'user'}, fx);
  try {
    await p.click(header('alice'));
    let v = await view(p);
    assert.equal(v.pids.length, 400, 'one open group gets the whole limit');
    assert.deepEqual(v.pids, Array.from({length: 400}, (_, i) => 1000 + i));
    assert.equal(v.note, 'Showing 400 of 500 processes. 50 are in 1 collapsed group; open it to see them. Open groups show their first 400; sort or filter to see others.');
    await p.click(header('bob'));
    v = await view(p);
    assert.deepEqual(v.pids, Array.from({length: 200}, (_, i) => 1000 + i).concat(Array.from({length: 50}, (_, i) => 5000 + i)), 'two open groups share it');
    assert.equal(v.note, 'Showing 250 of 500 processes. Open groups show their first 200; sort or filter to see others.');
  } finally { await p.close(); }
});

test('Expand all and Collapse all, only while grouping', async () => {
  const p = await open({group: 'user'});
  try {
    await p.click('[data-gall="open"]');
    assert.deepEqual(await view(p), {heads: ['marc (open)', 'postgres (open)', 'root (open)', 'www-data (open)', 'redis (open)'],
      pids: [104, 105, 106, 103, 101, 109, 108, 107, 110, 112, 102, 111], note: ''});
    assert.deepEqual(await p.eval(SAVED), {user: ['marc', 'postgres', 'root', 'www-data', 'redis']});
    await p.click('[data-gall="close"]');
    assert.deepEqual((await view(p)).pids, []);
    assert.deepEqual(await p.eval(SAVED), {user: []});
    await choose(p, 'none');
    assert.deepEqual(await p.eval(`({buttons: document.querySelectorAll('[data-gall]').length, heads: document.querySelectorAll('.ptbl tr.gh').length, rows: ${PIDS}.length, note: ${NOTE}})`),
      {buttons: 0, heads: 0, rows: 12, note: ''}, 'Group by Nothing is unchanged');
  } finally { await p.close(); }
});

test('the text filter narrows the groups first', async () => {
  const p = await open({group: 'user', filter: 'nginx'});
  try {
    assert.deepEqual(await view(p), {heads: ['root', 'www-data'], pids: [], note: 'Showing 0 of 2 processes. 2 are in 2 collapsed groups; open a group to see them.'});
    await p.click(header('www-data'));
    assert.deepEqual((await view(p)).pids, [102]);
  } finally { await p.close(); }
});

test('the docked Details panel collapses its groups the same way', async () => {
  const p = await browser.page(fixture(), {ui: ui({detailsDocked: true, group: 'state'})});
  try {
    await p.waitFor(`document.querySelectorAll('.dpanel .ptbl tr.gh').length > 0`);
    assert.deepEqual(await view(p), {heads: ['running', 'sleeping', 'idle'], pids: [], note: 'Showing 0 of 12 processes. 12 are in 3 collapsed groups; open a group to see them.'});
    await p.click(header('running'));
    assert.deepEqual((await view(p)).pids, [104, 105, 106]);
  } finally { await p.close(); }
});
