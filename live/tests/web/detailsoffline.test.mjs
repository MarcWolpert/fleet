// SPDX-License-Identifier: GPL-3.0-or-later
// #132: Details for a machine that isn't answering says so, and how old its list is; one with no list
// says it's offline or connecting, not "0 processes". The rows stay: status changes don't swap the layout.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui, PIDS, byCpuDesc} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const FULL = `({facts: [...document.querySelectorAll('#main .hero .facts span')].map(s => s.textContent),
  notes: [...document.querySelectorAll('#main .note')].map(n => n.textContent), pids: ${PIDS}})`;
const DOCKED = `({title: document.querySelector('.dpanel .dtitle span').textContent,
  notes: [...document.querySelectorAll('.dpanel .note')].map(n => n.textContent), pids: ${PIDS}})`;

function offline(fx, mid, over){ Object.assign(fx.fleet.machines.find(m => m.id === mid), over); return fx; }
const ago10 = () => Date.now() / 1000 - 600;      // "10 min ago"

async function open(fx, over){
  const p = await browser.page(fx, {ui: ui(over)});
  await p.waitFor(`document.querySelector('.ptbl') && !document.body.textContent.includes('loading…')`);
  return p;
}

test('an offline machine with a list: the rows stay, and a note says it is reconnecting and how old they are', async () => {
  const fx = offline(fixture(), 'win', {status: 'offline', error: 'ssh: connect to host lab-windows: Operation timed out', has_data: true, last_ok: ago10()});
  const p = await open(fx, {sel: 'win', view: 'details'});
  try {
    assert.deepEqual(await p.eval(FULL), {
      facts: ['12 processes', 'on lab-windows', 'CPU groups: CCD 0, CCD 1'],
      notes: ['lab-windows is reconnecting. These are its processes at the last reading, 10 min ago; the list updates when it answers again.'],
      pids: byCpuDesc(fx.procs.win.procs)});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a machine that never sent a reading is offline, not "0 processes"', async () => {
  const fx = offline(fixture(), 'win', {status: 'offline', error: 'ssh: Could not resolve hostname lab-windows', has_data: false, last_ok: 0});
  fx.procs.win = {procs: []};                       // what /api/procs answers for it
  const p = await open(fx, {sel: 'win', view: 'details'});
  try {
    assert.deepEqual(await p.eval(FULL), {
      facts: ['offline', 'on lab-windows', 'CPU groups: CCD 0, CCD 1'],
      notes: ['lab-windows is offline, so there are no processes to show. They appear here when it answers.'],
      pids: []});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a machine still connecting for its first reading says connecting', async () => {
  const fx = offline(fixture(), 'win', {status: 'connecting', has_data: false, last_ok: 0});
  fx.procs.win = {procs: []};
  const p = await open(fx, {sel: 'win', view: 'details'});
  try {
    assert.deepEqual(await p.eval(FULL), {
      facts: ['connecting', 'on lab-windows', 'CPU groups: CCD 0, CCD 1'],
      notes: ['lab-windows is connecting, so there are no processes to show. They appear here when it answers.'],
      pids: []});
  } finally { await p.close(); }
});

test('the docked Details says the same, beside the machine', async () => {
  const fx = offline(fixture(), 'win', {status: 'offline', error: 'ssh: connect to host lab-windows: Operation timed out', has_data: true, last_ok: ago10()});
  const p = await open(fx, {sel: 'win', detailsDocked: true});
  try {
    await p.waitFor(`document.querySelector('.dpanel .ptbl')`);
    assert.deepEqual(await p.eval(DOCKED), {
      title: '12 processes on lab-windows',
      notes: ['lab-windows is reconnecting. These are its processes at the last reading, 10 min ago; the list updates when it answers again.'],
      pids: byCpuDesc(fx.procs.win.procs)});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('nothing else: a live machine beside the offline one has no note, and the note goes when the machine is back', async () => {
  const fx = offline(fixture(), 'win', {status: 'offline', has_data: true, last_ok: ago10()});
  const p = await open(fx, {sel: 'lx', view: 'details'});
  try {
    assert.deepEqual(await p.eval(FULL), {facts: ['12 processes', 'on lab-linux', 'CPU groups: CCD 0, CCD 1'], notes: [], pids: byCpuDesc(fx.procs.lx.procs)});
    await p.eval(`(S.sel = 'win', renderAll(), refreshNow(), true)`);
    await p.waitFor(`document.querySelectorAll('#main .note').length === 1`);
    offline(fx, 'win', {status: 'ok', last_ok: Date.now() / 1000});      // it answers again
    await p.eval(`(refreshNow(), true)`);
    await p.waitFor(`document.querySelectorAll('#main .note').length === 0`);
    assert.deepEqual(await p.eval(FULL), {facts: ['12 processes', 'on lab-windows', 'CPU groups: CCD 0, CCD 1'], notes: [], pids: byCpuDesc(fx.procs.win.procs)});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
