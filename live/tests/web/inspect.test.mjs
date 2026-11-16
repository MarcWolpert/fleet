// SPDX-License-Identifier: GPL-3.0-or-later
// The Details drop-down: click a process to open a close look at it (/api/proc), what it waits on
// accumulated for as long as it's open, and a list that holds still meanwhile.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui, PIDS} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

// postgres (pid 103 on lx), as inspect_linux.py reports it
function look(over = {}){
  return Object.assign({pid: 103, name: 'postgres', state: 'S', ppid: 1, nice: 0, priority: 20, threads_n: 3, started: Date.now() / 1000 - 7200, last_cpu: 5,
    user: 'postgres', cmdline: '/usr/bin/postgres -D /data', exe: '/usr/bin/postgres', cwd: '/data', affinity: '0-15',
    cpu: {user: 0.2, system: 0.1, ctx_vol: 120, ctx_invol: 3, run_s: 0.3, runq_s: 0},
    mem: {rss: 150e6, anon: 100e6, file: 50e6, shmem: 0, swap: 0, peak: 200e6, virt: 900e6, minflt: 10, majflt: 0},
    io: {read: 2e6, write: 5e5, rchar: 3e6, blkio_delay: 0.05, delayacct: true},
    waits: {disk: 6, events: 12, cpu: 2}, samples: 16, dt: 1.5,
    threads: [{tid: 103, name: 'postgres', cpu: 0.2, doing: 'disk'}, {tid: 140, name: 'walwriter', cpu: 0.05, doing: 'events'}],
    fds: 40, fd_limit: 1024, files: ['/data/base/1/1234'],
    conns: [{proto: 'tcp', local: '0.0.0.0:5432', remote: '', state: 'listening'}, {proto: 'tcp', local: '10.0.0.2:5432', remote: '10.0.0.9:51234', state: 'established'}], conns_n: 2,
    cgroup: {path: '/system.slice/postgresql.service', cpu_limit: null, mem_limit: 4e9, mem_current: 1e9, throttled: 0, oom_kills: 0,
      pressure: {cpu: {some: {avg10: 1, avg60: 1, avg300: 1}}, memory: {some: {avg10: 0, avg60: 0, avg300: 0}}, io: {some: {avg10: 12, avg60: 8, avg300: 5}}}},
    cache: {refs: 1e6, misses: 3e5, miss_pct: 0.3, ipc: 0.8, threads: 3}, cache_error: '', machine: 'lx', t: Date.now() / 1000}, over);
}
const PANEL = `document.querySelector('tr.pinsp')`;
const WAITS = `Object.fromEntries([...document.querySelectorAll('tr.pinsp [data-wait]')].map(e => [e.dataset.wait, e.querySelector('.wv').textContent.trim()]))`;
const VERDICT = `(document.querySelector('tr.pinsp [data-verdict]') || {}).dataset?.verdict`;
const click = (p, sel) => p.eval(`(() => { document.querySelector(${JSON.stringify(sel)}).click(); return true; })()`);
async function open(fx){
  const p = await browser.page(fx, {ui: ui({view: 'details', sel: 'lx'})});
  await p.waitFor(`document.querySelectorAll('.ptbl tbody tr[data-pid]').length === 12`);
  return p;
}
const settle = ms => new Promise(r => setTimeout(r, ms));
async function polls(p, n = 3){ for (let i = 0; i < n; i++){ await p.eval(`(refreshNow(), true)`); await settle(150); } await settle(300); }

test('clicking a process opens its drop-down right under it, asks for that process, and closes again', async () => {
  const fx = fixture(); fx.proc = () => look();
  const p = await open(fx);
  try {
    await click(p, 'tr[data-pid="103"] td:nth-child(4)');
    await p.waitFor(`${PANEL} && ${PANEL}.previousElementSibling.dataset.pid === '103'`);
    assert.equal(await p.eval(`${PANEL}.querySelector('td').colSpan`), await p.eval(`document.querySelectorAll('.ptbl thead th').length`));
    assert.equal(await p.eval(`document.querySelector('tr[data-pid="103"]').getAttribute('aria-expanded')`), 'true');
    await p.waitFor(`document.querySelector('tr.pinsp [data-wait]')`);
    assert.deepEqual(fx.procCalls.slice(0, 1), ['lx:103']);
    assert.deepEqual(await p.eval(WAITS), {events: '60%', disk: '30%', cpu: '10%'});
    assert.equal(await p.eval(VERDICT), 'disk');
    // the facts that matter, each in its place
    const text = await p.eval(`${PANEL}.textContent`);
    for (const s of ['/usr/bin/postgres -D /data', 'postgres', '30%', '0.80', '40 of 1,024', '10.0.0.9:51234', ':5432', 'walwriter', '/system.slice/postgresql.service'])
      assert.ok(text.includes(s), `drop-down shows ${s}`);
    // a second click closes it; a button inside a row does its own thing and leaves the drop-down alone
    await click(p, 'tr[data-pid="103"] td:nth-child(4)');
    assert.equal(await p.eval(`!!${PANEL}`), false);
    await click(p, 'tr[data-pid="101"] [data-select]');
    assert.equal(await p.eval(`!!${PANEL}`), false);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a look is asked for with Fleet\'s own header, which a page on another site can\'t send (#287)', async () => {
  const fx = fixture(); fx.proc = () => look();
  const p = await open(fx);
  try {
    await click(p, 'tr[data-pid="103"] td:nth-child(4)');
    await p.waitFor(`document.querySelector('tr.pinsp [data-wait]')`);
    assert.deepEqual(fx.procCalls.slice(0, 1), ['lx:103']);
    assert.deepEqual((fx.refused || []).map(r => r.path), [], 'no look turned away');
    assert.equal(await p.eval(`${PANEL}.textContent.includes('didn’t answer')`), false);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

const WATCHED = `(document.querySelector('tr.pinsp [data-watched]') || {}).textContent || ''`;

test('a look the server answers twice (its answer is shared for a second) counts once (#288)', async () => {
  const T1 = Date.now() / 1000 - 5, A = look({t: T1}), B = look({t: T1 + 2, waits: {disk: 20}});
  const fx = fixture(); fx.proc = (mid, pid, n) => n <= 2 ? A : B;
  const p = await open(fx);
  try {
    await click(p, 'tr[data-pid="103"] td:nth-child(4)');
    await p.waitFor(`document.querySelector('tr.pinsp [data-wait]')`);
    await p.eval(`(refreshNow(), true)`);                     // the server's cached answer: the same look, t and all
    for (let i = 0; i < 50 && fx.procCalls.length < 2; i++) await settle(20);
    await settle(200);
    assert.equal(fx.procCalls.length, 2);
    assert.match(await p.eval(WATCHED), /· 1 look \(2 s of samples\)/);
    assert.deepEqual(await p.eval(WAITS), {events: '60%', disk: '30%', cpu: '10%'});
    await p.eval(`(refreshNow(), true)`);                     // a new look
    await p.waitFor(`/· 2 looks/.test(${WATCHED})`);
    assert.match(await p.eval(WATCHED), /· 2 looks \(3 s of samples\)/);
    assert.deepEqual(await p.eval(WAITS), {disk: '65%', events: '30%', cpu: '5%'});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the answer for a process you just left doesn\'t let a second look start for the new one (#288)', async () => {
  const held = [], fx = fixture();
  fx.proc = (mid, pid) => new Promise(r => held.push({pid, send: () => r(look({pid, name: pid === 101 ? 'nginx' : 'postgres', t: 5000 + pid}))}));
  const release = pid => held.filter(h => h.pid === pid).forEach(h => h.send());
  const p = await open(fx);
  try {
    await click(p, 'tr[data-pid="101"] td:nth-child(4)');
    for (let i = 0; i < 50 && held.length < 1; i++) await settle(20);
    await click(p, 'tr[data-pid="103"] td:nth-child(4)');    // 101's look is still on its way
    for (let i = 0; i < 50 && held.length < 2; i++) await settle(20);
    assert.deepEqual(fx.procCalls, ['lx:101', 'lx:103']);
    release(101);                                             // the stale answer comes back while 103's is on its way
    await settle(200);
    await polls(p);
    assert.deepEqual(fx.procCalls, ['lx:101', 'lx:103'], 'one look at a time for 103');
    release(103);
    await p.waitFor(`/· 1 look\\b/.test(${WATCHED})`);
    await settle(200);
    assert.match(await p.eval(WATCHED), /· 1 look \(2 s of samples\)/);
    assert.match(await p.eval(`${PANEL}.textContent`), /postgres/);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('what it waits on adds up over every look while it is open', async () => {
  const fx = fixture(); fx.proc = (mid, pid, n) => n === 1 ? look() : look({waits: {disk: 20}});
  const p = await open(fx);
  try {
    await click(p, 'tr[data-pid="103"] td:nth-child(4)');
    await p.waitFor(`document.querySelector('tr.pinsp [data-wait]')`);
    await p.eval(`(refreshNow(), true)`);
    await p.waitFor(`${WAITS}.disk === '65%'`);
    assert.deepEqual(await p.eval(WAITS), {disk: '65%', events: '30%', cpu: '5%'});
    assert.match(await p.eval(`${PANEL}.querySelector('[data-watched]').textContent`), /2 looks/);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('an idle process reads as idle, not as waiting on events', async () => {
  const fx = fixture(); fx.proc = () => look({waits: {events: 19, timer: 1}, cpu: {user: 0, system: 0, ctx_vol: 2, ctx_invol: 0, run_s: 0, runq_s: 0}});
  const p = await open(fx);
  try {
    await click(p, 'tr[data-pid="103"] td:nth-child(4)');
    await p.waitFor(`document.querySelector('tr.pinsp [data-verdict]')`);
    assert.equal(await p.eval(VERDICT), 'idle');
  } finally { await p.close(); }
});

test('while a process is open the rows hold their places; Resume live order sorts again', async () => {
  const fx = fixture(); fx.proc = () => look();
  const p = await open(fx);
  try {
    const before = await p.eval(PIDS);
    await click(p, 'tr[data-pid="103"] td:nth-child(4)');
    await p.waitFor(PANEL);
    fx.procs.lx.procs.find(r => r[0] === 112)[4] = 9;   // cron jumps to the top of a CPU sort
    await p.eval(`(refreshNow(), true)`);
    await p.waitFor(`document.querySelector('tr[data-pid="112"]').textContent.includes('56%')`);
    assert.deepEqual(await p.eval(PIDS), before);
    await click(p, '[data-inspclose]');
    await p.waitFor(`!${PANEL}`);
    assert.equal((await p.eval(PIDS))[0], 112);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a drop-down off screen asks nothing: another machine, another view; back on its machine it looks again (#288)', async () => {
  const fx = fixture(); fx.proc = () => look();
  const p = await open(fx);
  try {
    await click(p, 'tr[data-pid="103"] td:nth-child(4)');
    await p.waitFor(`document.querySelector('tr.pinsp [data-wait]')`);
    const n0 = fx.procCalls.length;
    await click(p, '#tree .row[data-select="lx2"] .nm');                    // another machine in the tree
    await p.waitFor(`document.querySelector('.ptbl').dataset.mid === 'lx2' && !${PANEL}`);
    await polls(p);
    assert.equal(fx.procCalls.length, n0, 'no look while Details shows lx2');
    await click(p, '#tree .row[data-select="lx"] .nm');                     // back: the drop-down is still open, and looks again
    await p.waitFor(`document.querySelector('.ptbl').dataset.mid === 'lx' && ${PANEL}`);
    await p.eval(`(refreshNow(), true)`);
    await p.waitFor(`document.querySelector('[data-watched]') && /\\b2 looks\\b/.test(document.querySelector('[data-watched]').textContent)`);
    assert.deepEqual(fx.procCalls.slice(n0), ['lx:103']);
    const n1 = fx.procCalls.length;
    await click(p, '#metrics [data-metric="cpu"]');                          // the overview
    await p.waitFor(`!document.querySelector('.ptbl')`);
    await polls(p);
    assert.equal(fx.procCalls.length, n1, 'no look from the overview');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('closing the docked Details panel stops the open drop-down\'s looks (#288)', async () => {
  const fx = fixture(); fx.proc = () => look();
  const p = await browser.page(fx, {ui: ui({sel: 'lx', detailsDocked: true}), width: 1400, height: 800});
  try {
    await p.waitFor(`document.querySelectorAll('.dpanel .ptbl tbody tr[data-pid]').length === 12`);
    await click(p, '.dpanel tr[data-pid="103"] td:nth-child(4)');
    await p.waitFor(`document.querySelector('.dpanel tr.pinsp [data-wait]')`);
    const n0 = fx.procCalls.length;
    await click(p, '.dpanel [data-closedock]');
    await p.waitFor(`!document.querySelector('.dpanel')`);
    await polls(p);
    assert.equal(fx.procCalls.length, n0);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a process that has exited is not asked about again; its drop-down still says so (#288)', async () => {
  const fx = fixture(); fx.proc = () => look({pid: 103, gone: true});
  const p = await open(fx);
  try {
    await click(p, 'tr[data-pid="103"] td:nth-child(4)');
    await p.waitFor(`${PANEL} && ${PANEL}.textContent.includes('exited')`);
    await polls(p);
    assert.deepEqual(fx.procCalls, ['lx:103']);
    assert.ok(await p.eval(`${PANEL}.textContent.includes('exited')`));
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Esc closes it; a process that exits or a machine that fails says so', async () => {
  // the machine fails first: an exited process is not asked about again (#288), so its look comes last
  const fx = fixture(); let ans = {pid: 103, error: 'lab-linux took too long to answer'};
  fx.proc = () => ans;
  const p = await open(fx);
  try {
    await click(p, 'tr[data-pid="103"] td:nth-child(4)');
    await p.waitFor(`${PANEL} && ${PANEL}.textContent.includes('lab-linux took too long to answer')`);
    ans = look({pid: 103, gone: true});
    await p.eval(`(refreshNow(), true)`);
    await p.waitFor(`${PANEL}.textContent.includes('exited')`);
    await p.eval(`(() => { document.body.focus(); document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); return true; })()`);
    await p.waitFor(`!${PANEL}`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Details rows stay table rows, lined up under their headers (regression: a class shared with the pin picker made them flex boxes)', async () => {
  const fx = fixture(); fx.proc = () => look();
  const p = await open(fx);
  try {
    assert.deepEqual(await p.eval(`[...new Set([...document.querySelectorAll('.ptbl tbody tr')].map(r => getComputedStyle(r).display))]`), ['table-row']);
    // every cell sits under its own column header
    assert.equal(await p.eval(`(() => { const th = [...document.querySelectorAll('.ptbl thead th')].map(e => Math.round(e.getBoundingClientRect().left)); return [...document.querySelectorAll('.ptbl tbody tr[data-pid]')].every(r => [...r.children].every((td, i) => Math.round(td.getBoundingClientRect().left) === th[i])); })()`), true);
  } finally { await p.close(); }
});

test('a refresh keeps where you scrolled the docked Details panel and the page beside it (regression)', async () => {
  const fx = fixture(); fx.proc = () => look();
  const p = await browser.page(fx, {ui: ui({sel: 'lx', detailsDocked: true}), width: 1400, height: 800});
  try {
    await p.waitFor(`document.querySelectorAll('.dpanel .ptbl tbody tr[data-pid]').length === 12`);
    await p.eval(`(() => { document.querySelector('.dpanel tr[data-pid="103"] td:nth-child(4)').click(); return true; })()`);
    await p.waitFor(`document.querySelector('.dpanel tr.pinsp [data-wait]')`);
    const top = await p.eval(`(() => { const d = document.querySelector('.dpanel'); d.scrollTop = 260; return d.scrollTop; })()`);
    assert.ok(top > 100, `the panel scrolls (${top})`);
    const wtop = await p.eval(`(() => { const w = document.querySelector('.split > .wrap'); w.scrollTop = 150; return w.scrollTop; })()`);
    fx.procs.lx.procs[0][4] = 0.42;                        // a new reading changes the page
    await p.eval(`(refreshNow(), true)`);
    await p.waitFor(`document.querySelector('.dpanel tr[data-pid="101"]').textContent.includes('2.6%')`);
    assert.equal(await p.eval(`document.querySelector('.dpanel').scrollTop`), top);
    assert.equal(await p.eval(`document.querySelector('.split > .wrap').scrollTop`), wtop);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a Windows process: affinity reads as CPUs and handles are called handles (regression)', async () => {
  const fx = fixture();
  fx.proc = () => look({affinity: '16777215', fds: 620, fd_limit: -1, handles: 620, files: [], priority_class: 'Normal', cgroup: null, cache: null,
    cache_error: 'Windows doesn\'t expose per-process CPU cache counters without a kernel driver'});
  const p = await open(fx);
  try {
    await p.eval(`(() => { document.querySelector('tr[data-pid="103"] td:nth-child(4)').click(); return true; })()`);
    await p.waitFor(`document.querySelector('tr.pinsp [data-wait]')`);
    const text = await p.eval(`document.querySelector('tr.pinsp').textContent`);
    assert.ok(text.includes('CPUs 0–23'), 'affinity as CPUs');
    assert.ok(!text.includes('16777215'), 'no raw bitmask');
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('tr.pinsp .icard h4')].map(h => h.textContent)`).then(hs => hs.filter(h => /files|handles/i.test(h))), ['Handles']);
    assert.ok(text.includes('620'));
  } finally { await p.close(); }
});

test('cache misses add up over a lookback you pick: 10 s, 1 min, 5 min or since it opened (#20)', async () => {
  const fx = fixture(); const now = Date.now() / 1000;
  // two looks 30 s apart: 30% then 10% misses, 1.5 s each, a million references a second
  fx.proc = (mid, pid, n) => n === 1 ? look({t: now - 30, dt: 1.5, cache: {refs: 1e6, misses: 3e5, miss_pct: 0.3, ipc: 0.8, threads: 3}})
                                     : look({t: now, dt: 1.5, cache: {refs: 1e6, misses: 1e5, miss_pct: 0.1, ipc: 1.2, threads: 3}});
  const p = await open(fx);
  const card = `[...document.querySelectorAll('tr.pinsp .icard')].find(c => c.querySelector('h4').textContent === 'CPU cache')`;
  const miss = `${card}.querySelector('[data-cachemiss]').textContent.trim()`;
  try {
    await p.eval(`(() => { document.querySelector('tr[data-pid="103"] td:nth-child(4)').click(); return true; })()`);
    await p.waitFor(`document.querySelector('tr.pinsp [data-wait]')`);
    await p.eval(`(refreshNow(), true)`);
    await p.waitFor(`${card} && ${card}.textContent.includes('2 looks')`);
    assert.deepEqual(await p.eval(`[...${card}.querySelectorAll('[data-lookback]')].map(b => b.textContent.trim())`), ['10 s', '1 min', '5 min', 'All']);
    assert.equal(await p.eval(`${card}.querySelector('[data-lookback][aria-pressed="true"]').textContent.trim()`), '1 min');   // the default
    assert.equal(await p.eval(miss), '20%');
    await p.eval(`(() => { ${card}.querySelector('[data-lookback="10"]').click(); return true; })()`);
    await p.waitFor(`${miss} === '10%'`);
    assert.match(await p.eval(`${card}.textContent`), /1 look/);
    await p.waitFor(`true`);
    for (let i = 0; i < 100 && !(fx.posts || []).some(x => x.path === '/api/prefs' && JSON.parse(x.body).cacheLookback === 10); i++) await new Promise(r => setTimeout(r, 30));
    assert.ok((fx.posts || []).some(x => x.path === '/api/prefs' && JSON.parse(x.body).cacheLookback === 10), 'kept as a pref');
    await p.eval(`(() => { ${card}.querySelector('[data-lookback="0"]').click(); return true; })()`);
    await p.waitFor(`${miss} === '20%'`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
