// SPDX-License-Identifier: GPL-3.0-or-later
// The fixture server itself: it must answer the way the real server (live/fleet_live.py) does, or a UI change
// the real server would refuse passes every browser test.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {launch, startServer} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

// One write, sent as given (Node sets Host from the URL unless headers say otherwise): [status, answer or null]
function post(base, path, body, headers = {}){
  return new Promise((ok, no) => {
    const req = http.request(new URL(path, base), {method: 'POST', headers, agent: false}, res => {
      let b = ''; res.on('data', c => { b += c; });
      res.on('end', () => ok([res.statusCode, /json/.test(res.headers['content-type'] || '') ? JSON.parse(b) : null]));
    });
    req.setTimeout(3000, () => { req.destroy(); ok(['no answer', null]); });
    req.on('error', e => { if (!req.destroyed) no(e); }); req.end(body);
  });
}

test('the fixture server refuses the writes the real server refuses, with its status (#85)', async () => {
  const fx = fixture(), s = await startServer(fx);
  const port = new URL(s.url).port, origin = 'http://127.0.0.1:' + port, ok = {'Content-Type': 'application/json', 'X-Fleet': '1', Origin: origin};
  const big = JSON.stringify({x: 'a'.repeat(70000)}), many = JSON.stringify(Object.fromEntries(Array.from({length: 501}, (_, i) => ['cpu|m' + i, ['0']])));
  try {
    const got = [];
    for (const [path, body, headers] of [
      ['/api/pins', '["lx"]', ok],
      ['/api/pins', '["lx"]', {'Content-Type': 'application/json'}],                         // no X-Fleet
      ['/api/pins', '["lx"]', Object.assign({}, ok, {'X-Fleet': '0'})],
      ['/api/pins', '["lx"]', Object.assign({}, ok, {Origin: 'http://elsewhere.example'})],  // another site's page
      ['/api/pins', '["lx"]', Object.assign({}, ok, {Host: 'elsewhere.example:' + port})],   // DNS rebinding
      ['/api/pins', '["mac"]', Object.assign({}, ok, {Host: 'localhost:' + port, Origin: 'http://localhost:' + port})],
      ['/api/pins', '["lx"]', {'X-Fleet': '1'}],                                              // no Origin: allowed
      ['/api/pin', '["lx"]', ok],                                                             // no such route
      ['/api/pins', '{"lx": 1}', ok], ['/api/pins', '[1]', ok], ['/api/pins', JSON.stringify(['x'.repeat(300)]), ok], ['/api/pins', '[', ok],
      ['/api/pins', JSON.stringify(Array.from({length: 41}, (_, i) => 'n' + i)), ok],
      ['/api/prefs', '[]', ok], ['/api/prefs', '', ok], ['/api/prefs', '{"theme":', ok], ['/api/prefs', big, ok],
      ['/api/prefs', '{"theme":"dark"}', ok],
      ['/api/tilepins', '[]', ok], ['/api/tilepins', '{"cpu|lx": "0"}', ok], ['/api/tilepins', many, ok],
      ['/api/tilepins', JSON.stringify({'cpu|lx': Array.from({length: 201}, (_, i) => String(i))}), ok],
      ['/api/tilepins', '{"gpu|lx": ["gpu0:temp"], "cpu|lx": []}', ok],
      ['/api/retry', '{"machine":"lx"}', ok]
    ]) got.push(await post(s.url, path, body, headers));
    assert.deepEqual(got, [
      [200, {pins: ['lx']}],
      [403, null], [403, null], [403, null], [403, null],
      [200, {pins: ['mac']}],
      [200, {pins: ['lx']}],
      [404, null],
      [400, null], [400, null], [400, null], [400, null],
      [200, {pins: Array.from({length: 40}, (_, i) => 'n' + i)}],
      [400, null], [400, null], [400, null], [400, null],
      [200, {prefs: {theme: 'dark'}}],
      [400, null], [400, null], [400, null], [400, null],
      [200, {tilepins: {'gpu|lx': ['gpu0:temp']}}],
      [200, {ok: true}]
    ]);
    // fx.posts holds what the server took, with its headers; fx.refused what it turned away, with the status
    assert.deepEqual(fx.posts.map(x => [x.path, x.headers['x-fleet']]), [
      ['/api/pins', '1'], ['/api/pins', '1'], ['/api/pins', '1'], ['/api/pins', '1'], ['/api/prefs', '1'], ['/api/tilepins', '1'], ['/api/retry', '1']]);
    assert.deepEqual(fx.refused.map(x => [x.path, x.status]), [
      ['/api/pins', 403], ['/api/pins', 403], ['/api/pins', 403], ['/api/pins', 403], ['/api/pin', 404],
      ['/api/pins', 400], ['/api/pins', 400], ['/api/pins', 400], ['/api/pins', 400],
      ['/api/prefs', 400], ['/api/prefs', 400], ['/api/prefs', 400], ['/api/prefs', 400],
      ['/api/tilepins', 400], ['/api/tilepins', 400], ['/api/tilepins', 400], ['/api/tilepins', 400]]);
  } finally { await s.close(); }
});

test('a browser test sees the headers a write carried, and a write that skips api() is refused (#85)', async () => {
  const fx = fixture();
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  try {
    await p.waitFor(`document.querySelectorAll('#tree .row').length > 0`);
    await p.eval(`(togglePin('lx'), true)`);
    await p.waitFor(`document.querySelector('[data-space="lx"]')`);
    for (let i = 0; i < 100 && !(fx.posts || []).length; i++) await new Promise(r => setTimeout(r, 30));
    const w = (fx.posts || []).map(x => [x.path, x.body, (x.headers || {})['x-fleet'], (x.headers || {}).origin]);
    assert.deepEqual(w, [['/api/pins', '["lx"]', '1', p.url.replace(/\/$/, '')]]);
    // the same write without Fleet's header, as a change that went around api() would send it
    assert.equal(await p.eval(`fetch('/api/pins', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '["mac"]'}).then(r => r.status)`), 403);
    assert.deepEqual((fx.refused || []).map(x => [x.path, x.body, x.status]), [['/api/pins', '["mac"]', 403]]);
    assert.equal(fx.posts.length, 1, 'not kept');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a space and a tile pinned on the page are still pinned after the next polls and a reload (#114)', async () => {
  const fx = fixture();
  const p = await browser.page(fx, {ui: ui({sel: 'lx'})});
  // the page's polls of /api/fleet, counted from now
  const countPolls = () => p.eval(`(() => { window.polls = 0; const f = window.fetch; window.fetch = (u, o) => { if (String(u).startsWith('/api/fleet')) window.polls++; return f(u, o); }; return true; })()`);
  try {
    await p.waitFor(`document.querySelectorAll('#tree .row').length > 0`);
    await p.eval(`(togglePin('lx'), toggleTilePin('gpu|lx|gpu0:temp'), true)`);
    for (let i = 0; i < 100 && (fx.posts || []).length < 2; i++) await new Promise(r => setTimeout(r, 30));
    await countPolls();
    await p.waitFor(`window.polls >= 2`);   // the first of them has been answered and applied
    assert.deepEqual(await p.eval(`({pins: PINS, tilepins: TPINS, space: !!document.querySelector('[data-space="lx"]')})`),
      {pins: ['lx'], tilepins: {'gpu|lx': ['gpu0:temp']}, space: true});
    assert.deepEqual([fx.fleet.pins, fx.fleet.tilepins], [['lx'], {'gpu|lx': ['gpu0:temp']}]);
    await p.reload();
    await p.waitFor(`document.querySelector('[data-space="lx"]')`);
    assert.deepEqual(await p.eval(`({pins: PINS, tilepins: TPINS})`), {pins: ['lx'], tilepins: {'gpu|lx': ['gpu0:temp']}});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the fixture server answers /api/ifs from fx.ifs, so a machine\'s interfaces show and pick processes (#123)', async () => {
  const fx = fixture(), h = v => new Array(60).fill(v);
  // an interface as /api/ifs sends it
  const nic = (name, kind, over) => Object.assign({name, kind, state: 'up', speed: '', addrs: [], rx: 0, tx: 0, master: '', hrx: h(0), htx: h(0), vm: '', dnet: '', members: 0, containers: 0}, over);
  fx.ifs = {lx: {ifs: [nic('docker0', 'bridge', {containers: 1, addrs: ['172.17.0.1/16']}),
                       nic('eth0', 'physical', {speed: '1000', addrs: ['10.0.0.2/24'], rx: 1.5, tx: 0.25, hrx: h(1.5), htx: h(0.25)})], per_process: true}};
  const p = await browser.page(fx, {ui: ui({sel: 'lx', metric: 'net', ifView: 'each'})});
  const TILES = `[...document.querySelectorAll('.kgrid .kcell')].map(c => [c.querySelector('[data-isel]').dataset.isel, c.querySelector('.kb').textContent, c.querySelector('.km').textContent, c.querySelector('.ks').textContent])`;
  const USING = `(() => { const t = [...document.querySelectorAll('h3.cpuproc')].find(x => x.textContent === 'Using this interface'); return t ? [...t.parentElement.querySelectorAll('h3.cpuproc ~ div tbody tr')].map(r => +r.children[1].textContent) : null; })()`;
  try {
    await p.waitFor(`document.querySelectorAll('.kgrid .kcell').length === 2`);
    assert.deepEqual(await p.eval(TILES), [['eth0', '1 Gb/s', 'physical', '10.0.0.2/24'], ['docker0', '', 'bridge · 1 container', '172.17.0.1/16']]);
    await p.click('[data-isel="eth0"]');
    await p.waitFor(`(${USING} || []).length`);
    assert.deepEqual(await p.eval(USING), [105, 101, 102, 107]);   // lx's processes with traffic via eth0, busiest first
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
