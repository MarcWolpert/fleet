// SPDX-License-Identifier: GPL-3.0-or-later
// Pins and polls (#95): an answer older than a pin save, from a poll or from an earlier save, never puts the old
// pins back, so the next pin builds on every pin made so far. The page's fetch is wrapped so a test can hold a
// poll's answer, a save's request, or a save's answer.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

// HOLD.polls: each /api/fleet answer waits in HOLD.polled (HOLD.arrived counts the ones the server has answered).
// HOLD.pinReq: the next /api/pins request waits for HOLD.sendPin(). HOLD.pinAns: each /api/pins answer waits in
// HOLD.answers. HOLD.pinsDone counts the saves the page has taken in.
const WRAP = `(() => {
  const of = window.fetch, H = window.HOLD = {polls: false, polled: [], arrived: 0, pinReq: false, pinAns: false, answers: [], pinsDone: 0};
  window.fetch = function(u, o){
    const url = String(u), args = arguments;
    if (url === '/api/pins'){
      const track = p => p.then(r => { const j = r.json.bind(r); r.json = () => j().then(v => { setTimeout(() => { H.pinsDone++; }, 0); return v; }); return r; });
      if (H.pinReq){ H.pinReq = false; return new Promise(ok => { H.sendPin = () => ok(track(of.apply(window, args))); }); }
      const p = track(of.apply(window, args));
      return H.pinAns ? new Promise(ok => H.answers.push(() => ok(p))) : p;
    }
    const p = of.apply(window, args);
    if (H.polls && url.startsWith('/api/fleet')){ p.then(() => { H.arrived++; }); return new Promise(ok => H.polled.push(() => ok(p))); }
    return p;
  };
  return true;
})()`;
const SPACES = `[...document.querySelectorAll('#spaces [data-space]')].map(b => b.dataset.space)`;
const pinPosts = fx => (fx.posts || []).filter(x => x.path === '/api/pins').map(x => JSON.parse(x.body));
const pick = (p, id) => p.eval(`(() => { document.querySelector('#picklist [data-pin="${id}"]').click(); return true; })()`);
async function open(fx){
  const p = await browser.page(fx, {ui: ui({sel: 'fleet'})});
  await p.waitFor(`document.querySelectorAll('#tree .row.machine').length === 4`);
  await p.eval(WRAP);
  await p.eval(`(() => { document.querySelector('[data-addpin]').click(); return true; })()`);
  await p.waitFor(`document.querySelector('#picklist [data-pin="lx"]')`);
  return p;
}
// the page has taken in the next poll's answer (DATA is replaced the moment it arrives)
async function polled(p, release){
  await p.eval(`(() => { window.D0 = DATA; ${release ? 'HOLD.polled.shift()();' : ''} return true; })()`);
  await p.waitFor(`DATA !== window.D0`);
}

test('a poll sent before a pin and answered after its save leaves the pin for the next one', async () => {
  const fx = fixture();
  const p = await open(fx);
  try {
    await p.eval(`(() => { HOLD.polls = true; return true; })()`);
    await p.waitFor(`HOLD.polled.length === 1 && HOLD.arrived === 1`);   // its answer carries the pins from before the click: none
    await pick(p, 'lx');
    await p.waitFor(`HOLD.pinsDone === 1`);
    fx.fleet.pins = ['lx'];                                              // the server keeps the save, like pins.json
    await polled(p, true);                                               // the old answer arrives after the save
    assert.deepEqual(await p.eval(`PINS`), ['lx']);
    await pick(p, 'mac');
    await p.waitFor(`HOLD.pinsDone === 2`);
    fx.fleet.pins = ['lx', 'mac'];
    assert.deepEqual(pinPosts(fx), [['lx'], ['lx', 'mac']]);
    assert.deepEqual(await p.eval(SPACES), ['fleet', 'lx', 'mac']);
    // nothing else: with no save on its way, a poll's pins count (here another window unpinned lab-mac)
    fx.fleet.pins = ['lx'];
    await p.eval(`(() => { HOLD.polls = false; HOLD.polled.splice(0).forEach(f => f()); return true; })()`);
    await p.waitFor(`JSON.stringify(${SPACES}) === '["fleet","lx"]'`);
    assert.deepEqual(await p.eval(`PINS`), ['lx']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a poll answered while a pin save is on its way leaves the pin for the next one', async () => {
  const fx = fixture();
  const p = await open(fx);
  try {
    await p.eval(`(() => { HOLD.pinReq = true; return true; })()`);
    await pick(p, 'lx');                                                 // its save hasn't reached the server yet
    await polled(p, false);                                              // a poll answers with the server's pins: none
    assert.deepEqual(await p.eval(`PINS`), ['lx']);
    await pick(p, 'mac');
    await p.waitFor(`HOLD.pinsDone === 1`);
    assert.deepEqual(pinPosts(fx), [['lx', 'mac']]);
    assert.deepEqual(await p.eval(SPACES), ['fleet', 'lx', 'mac']);
    await p.eval(`(() => { HOLD.sendPin(); return true; })()`);
    await p.waitFor(`HOLD.pinsDone === 2`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('of two saves on their way, the first one\'s answer doesn\'t undo the second pin', async () => {
  const fx = fixture();
  const p = await open(fx);
  try {
    await p.eval(`(() => { HOLD.pinAns = true; return true; })()`);
    await pick(p, 'lx');
    await pick(p, 'mac');
    await p.waitFor(`HOLD.answers.length === 2`);
    await p.eval(`(() => { HOLD.answers.shift()(); return true; })()`);   // the first answer: ["lx"]
    await p.waitFor(`HOLD.pinsDone === 1`);
    assert.deepEqual(await p.eval(`PINS`), ['lx', 'mac']);
    await pick(p, 'win');
    fx.fleet.pins = ['lx', 'mac', 'win'];
    await p.eval(`(() => { HOLD.pinAns = false; HOLD.answers.splice(0).forEach(f => f()); return true; })()`);
    await p.waitFor(`HOLD.pinsDone === 3`);
    assert.deepEqual(pinPosts(fx), [['lx'], ['lx', 'mac'], ['lx', 'mac', 'win']]);
    assert.deepEqual(await p.eval(SPACES), ['fleet', 'lx', 'mac', 'win']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
