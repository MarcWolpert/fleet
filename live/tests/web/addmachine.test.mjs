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
      const b = await p.eval(`(() => { const a = document.querySelector('aside.side').getBoundingClientRect(), r = document.querySelector('[data-addmachinedlg]').getBoundingClientRect(); return {bottom: a.bottom - r.bottom, right: a.right - r.right}; })()`);
      assert.ok(b.bottom >= 0 && b.bottom < 40 && b.right < 40, JSON.stringify(b));   // bottom right, Auto on its left (#212)
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

// machines.toml as /api/config reads it back: the machines already there (one a VM on another, with a domain, a
// Tailscale name and a note), an interval and a terminal that aren't the defaults (#298)
const SAVED = () => ({path: '/dev/null', interval: 5, terminal: 'iterm', terminals: [['iterm', 'iTerm']], status: {}, machines: [
  {id: 'nas', name: 'nas', ssh: 'me@nas', os: 'linux', tile: 'server', tailscale: 'nas.example.ts.net'},
  {id: 'dev-vm', name: 'dev-vm', ssh: 'me@dev-vm', os: 'linux', tile: 'vm', vm_on: 'nas', domain: 'dev-vm', note: {label: 'Note', text: 'a test VM'}},
  {id: 'build-box', name: 'old build box', ssh: 'me@old-build', os: 'linux', tile: 'server'}]});

test('the form tests the connection and adds the machine to the saved config', async () => {
  const fx = fixture(); fx.config = SAVED();
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
    // the whole file comes back as it was, the new machine after the others (its id beside the taken build-box)
    assert.deepEqual(posts(fx, '/api/config'), [{interval: 5, terminal: 'iterm', machines: SAVED().machines.concat([
      {id: 'build-box-2', name: 'build box', ssh: 'me@build.example.ts.net', os: 'windows', tile: 'desktop'}])}]);
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

test('a Mac can be added too (#181): macOS in the form, its steps, and a laptop icon', async () => {
  const fx = fixture();
  const p = await browser.page(fx, {ui: ui()});
  try {
    await p.waitFor(`document.querySelector('[data-addmachinedlg]')`);
    await p.eval(`(() => { document.querySelector('[data-addmachinedlg]').click(); return true; })()`);
    await p.waitFor(`document.querySelector('#addm [name=os]')`);
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#addm [name=os] option')].map(o => o.value)`), ['linux', 'windows', 'macos']);
    const text = await p.eval(`document.getElementById('addm').textContent`);
    for (const s of ['Remote Login', 'xcode-select --install']) assert.ok(text.includes(s), s);
    await set(p, '#addm [name=ssh]', 'me@studio.local');
    await set(p, '#addm [name=os]', 'macos');
    await p.eval(`(() => { document.querySelector('#addm [data-addmsave]').click(); return true; })()`);
    await p.waitFor(`!document.getElementById('addm')`);
    assert.deepEqual(posts(fx, '/api/config').pop().machines[0], {id: 'me-studio-local', name: 'me@studio.local', ssh: 'me@studio.local', os: 'macos', tile: 'laptop'});
    // Settings offers macOS for a machine as well
    await p.eval(`(() => { document.querySelector('[data-settings]').click(); return true; })()`);
    await p.waitFor(`document.querySelector('[data-addmachine]')`);
    await p.eval(`(() => { document.querySelector('[data-addmachine]').click(); return true; })()`);
    await p.waitFor(`document.querySelector('[data-field$=":os"]')`);
    assert.deepEqual(await p.eval(`[...document.querySelector('[data-field$=":os"]').options].map(o => o.value)`), ['linux', 'windows', 'macos']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
