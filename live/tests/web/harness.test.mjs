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
