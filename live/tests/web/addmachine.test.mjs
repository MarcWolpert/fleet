// SPDX-License-Identifier: GPL-3.0-or-later
// + Add a machine at the bottom of the tree (#165): instructions for adding an SSH machine, then a short form
// that tests the connection and adds it to machines.toml (through /api/config, like Settings).
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });
const posts = (fx, path) => (fx.posts || []).filter(x => x.path === path).map(x => JSON.parse(x.body));
const set = (p, sel, v) => p.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', {bubbles: true})); e.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);

test('the + sits at the bottom of the tree panel, in both trees, and opens the instructions', async () => {
  const fx = fixture();
  for (const tree of ['machines', 'network']){
    const p = await browser.page(fx, {ui: ui({tree}), height: 800});
    try {
      await p.waitFor(`document.querySelector('aside.side [data-addmachinedlg]')`);
      const b = await p.eval(`(() => { const a = document.querySelector('aside.side').getBoundingClientRect(), r = document.querySelector('[data-addmachinedlg]').getBoundingClientRect(); return {bottom: a.bottom - r.bottom, left: r.left - a.left}; })()`);
      assert.ok(b.bottom >= 0 && b.bottom < 40 && b.left < 40, JSON.stringify(b));
      assert.match(await p.eval(`document.querySelector('[data-addmachinedlg]').textContent`), /Add a machine/);
      await p.eval(`(() => { document.querySelector('[data-addmachinedlg]').click(); return true; })()`);
      await p.waitFor(`document.querySelector('#addm[role=dialog]')`);
      const text = await p.eval(`document.getElementById('addm').textContent`);
      for (const s of ['ssh user@host', 'ssh-copy-id', 'python3', 'OpenSSH', 'administrators_authorized_keys', 'Tailscale']) assert.ok(text.includes(s), s);
      await p.eval(`(() => { document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); return true; })()`);
      await p.waitFor(`!document.getElementById('addm')`);
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  }
});

test('the form tests the connection and adds the machine to the saved config', async () => {
  const fx = fixture();
  const p = await browser.page(fx, {ui: ui()});
  try {
    await p.waitFor(`document.querySelector('[data-addmachinedlg]')`);
    await p.eval(`(() => { document.querySelector('[data-addmachinedlg]').click(); return true; })()`);
    await p.waitFor(`document.querySelector('#addm [name=ssh]')`);
    await set(p, '#addm [name=name]', 'build box');
    await set(p, '#addm [name=ssh]', 'me@build.example.ts.net');
    await set(p, '#addm [name=os]', 'windows');
    await p.eval(`(() => { document.querySelector('#addm [data-addmtest]').click(); return true; })()`);
    await p.waitFor(`document.querySelector('#addm .tres.good')`);
    assert.deepEqual(posts(fx, '/api/test').pop(), {ssh: 'me@build.example.ts.net', os: 'windows'});
    await p.eval(`(() => { document.querySelector('#addm [data-addmsave]').click(); return true; })()`);
    await p.waitFor(`!document.getElementById('addm')`);
    const cfg = posts(fx, '/api/config').pop();
    assert.equal(cfg.machines.length, 1);
    assert.deepEqual(cfg.machines[0], {id: 'build-box', name: 'build box', ssh: 'me@build.example.ts.net', os: 'windows', tile: 'desktop'});
    assert.equal(cfg.interval, 3);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('an empty SSH destination is not added', async () => {
  const fx = fixture();
  const p = await browser.page(fx, {ui: ui()});
  try {
    await p.waitFor(`document.querySelector('[data-addmachinedlg]')`);
    await p.eval(`(() => { document.querySelector('[data-addmachinedlg]').click(); return true; })()`);
    await p.waitFor(`document.querySelector('#addm [data-addmsave]')`);
    await p.eval(`(() => { document.querySelector('#addm [data-addmsave]').click(); return true; })()`);
    await p.waitFor(`document.querySelector('#addm .addm-err')`);
    assert.deepEqual(posts(fx, '/api/config'), []);
  } finally { await p.close(); }
});
