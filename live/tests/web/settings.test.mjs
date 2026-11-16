// SPDX-License-Identifier: GPL-3.0-or-later
// The Settings sheet: what closes it, and what it keeps.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const centre = sel => `(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return {x: b.left + b.width / 2, y: b.top + b.height / 2}; })()`;
// A press at one point and a release at another, the mouse held down in between (a drag-select).
async function drag(p, from, to){
  const m = (type, {x, y}, buttons) => p.send('Input.dispatchMouseEvent', {type, x, y, button: 'left', buttons, clickCount: 1});
  await m('mouseMoved', from, 0); await m('mousePressed', from, 1);
  await m('mouseMoved', {x: (from.x + to.x) / 2, y: (from.y + to.y) / 2}, 1); await m('mouseMoved', to, 1);
  await m('mouseReleased', to, 0);
}
// Settings open with one new machine whose name is typed in.
async function settingsWithDraft(fx = fixture()){
  const p = await browser.page(fx, {ui: ui({sel: 'lx'}), width: 1400, height: 900});
  await p.click('[data-settings]');
  await p.waitFor(`document.querySelector('[data-addmachine]')`);
  await p.click('[data-addmachine]');
  await p.waitFor(`document.activeElement && document.activeElement.dataset.field === '0:name'`);
  await p.send('Input.insertText', {text: 'lab-box'});
  return p;
}
const STATE = `[!document.getElementById('sheet').hidden, SET.open, SET.draft && SET.draft.machines.map(m => m.name), (document.querySelector('[data-field="0:name"]') || {}).value]`;
// a point on the backdrop, right of the dialog and level with the given point
const besideDialog = async (p, pt) => ({x: await p.eval(`document.querySelector('#sheet .sheet').getBoundingClientRect().right + 40`), y: pt.y});

test('drag-selecting a name past the dialog edge keeps Settings open and the draft (#113)', async () => {
  const p = await settingsWithDraft();
  try {
    assert.deepEqual(await p.eval(STATE), [true, true, ['lab-box'], 'lab-box']);
    const from = await p.eval(centre('[data-field="0:name"]'));
    await drag(p, from, await besideDialog(p, from));
    await new Promise(r => setTimeout(r, 200));
    assert.deepEqual(await p.eval(STATE), [true, true, ['lab-box'], 'lab-box']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a press on the backdrop released inside the dialog keeps Settings open too (#113)', async () => {
  const p = await settingsWithDraft();
  try {
    const to = await p.eval(centre('[data-field="0:name"]'));
    await drag(p, await besideDialog(p, to), to);
    await new Promise(r => setTimeout(r, 200));
    assert.deepEqual(await p.eval(STATE), [true, true, ['lab-box'], 'lab-box']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('control: a click on the backdrop still closes Settings, and nothing is saved (#113)', async () => {
  const fx = fixture(), p = await settingsWithDraft(fx);
  try {
    const at = await besideDialog(p, await p.eval(centre('[data-field="0:name"]')));
    await drag(p, at, at);
    await p.waitFor(`document.getElementById('sheet').hidden`);
    assert.deepEqual(await p.eval(`[document.getElementById('sheet').hidden, SET.open, document.getElementById('sheet').innerHTML]`), [true, false, '']);
    assert.deepEqual((fx.posts || []).filter(x => x.path === '/api/config'), []);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

// What Save sends: every machine as edited, the removed one gone, new ones with ids made from their
// names (unique among the others), and the refresh and terminal choices (#124).
const CONFIG = () => ({path: '/srv/fleet/machines.toml', interval: 3, terminal: 'auto', terminals: [['terminal', 'Terminal'], ['iterm', 'iTerm']], terminal_auto: 'Terminal',
  machines: [{id: 'nas', name: 'nas <b>main</b>', ssh: 'admin@nas', os: 'linux', tile: 'server'}, {id: 'mac', name: 'This Mac', kind: 'local', tile: 'laptop'},
    {id: 'old', name: 'old box', ssh: 'admin@old-box', os: 'linux', tile: 'desktop'}],
  status: {nas: {status: 'ok', error: ''}, mac: {status: 'ok', error: ''}, old: {status: 'ok', error: ''}}});
const pick = (p, field, value, ev = 'change') => p.eval(`(e => { e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event(${JSON.stringify(ev)}, {bubbles: true})); return true; })(document.querySelector('[data-field="${field}"]'))`);

test('Save posts every machine as edited, with ids made for new ones (#124)', async () => {
  const fx = fixture(); fx.config = CONFIG();
  const p = await browser.page(fx, {ui: ui({sel: 'lx'}), width: 1400, height: 900});
  try {
    await p.click('[data-settings]');
    await p.waitFor(`document.querySelectorAll('[data-togglecard]').length === 3`);
    // names show as text, the path as given
    assert.deepEqual(await p.eval(`[[...document.querySelectorAll('.mlabel')].map(l => l.textContent), document.querySelectorAll('.mlabel *').length, [...document.querySelectorAll('.sheet-b > .sub code')].map(c => c.textContent)]`),
      [['nas <b>main</b>', 'This Mac', 'old box'], 0, ['/srv/fleet/machines.toml', 'machines.toml.bak']]);
    await p.click('[data-togglecard="2"]'); await p.waitFor(`document.querySelector('[data-rmmachine="2"]')`);
    await p.click('[data-rmmachine="2"]'); await p.waitFor(`document.querySelectorAll('[data-togglecard]').length === 2`);
    await p.click('[data-addmachine]'); await p.waitFor(`document.activeElement && document.activeElement.dataset.field === '2:name'`);
    await p.send('Input.insertText', {text: 'NAS'});
    await p.click('[data-field="2:ssh"]'); await p.send('Input.insertText', {text: 'admin@nas-backup'});
    await pick(p, '2:os', 'windows'); await pick(p, '2:vm_on', 'nas');
    await p.click('[data-addmachine]'); await p.waitFor(`document.activeElement && document.activeElement.dataset.field === '3:name'`);
    await p.send('Input.insertText', {text: 'Lab Box!'});
    await p.click('[data-addmachine]'); await p.waitFor(`document.activeElement && document.activeElement.dataset.field === '4:name'`);
    await pick(p, '-1:interval', '5', 'input'); await pick(p, '-1:terminal', 'iterm');
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('.mlabel')].map(l => l.textContent)`), ['nas <b>main</b>', 'This Mac', 'NAS', 'Lab Box!', 'New machine']);
    await p.click('[data-savesettings]');
    await p.waitFor(`document.getElementById('sheet').hidden`);
    const posts = fx.posts.filter(x => x.path === '/api/config');
    assert.equal(posts.length, 1);
    assert.deepEqual(JSON.parse(posts[0].body), {interval: 5, terminal: 'iterm', machines: [
      {id: 'nas', name: 'nas <b>main</b>', ssh: 'admin@nas', os: 'linux', tile: 'server'},
      {id: 'mac', name: 'This Mac', kind: 'local', tile: 'laptop'},
      {id: 'nas-2', name: 'NAS', ssh: 'admin@nas-backup', os: 'windows', tile: 'terminal', vm_on: 'nas'},
      {id: 'lab-box', name: 'Lab Box!', ssh: '', os: 'linux', tile: 'terminal'},
      {id: 'machine', name: '', ssh: '', os: 'linux', tile: 'terminal'}]});
    assert.equal(await p.waitFor(`(t => t && t.classList.contains('show') && t.textContent)(document.getElementById('toast'))`), 'Saved. Reconnecting to your machines…');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('control: Cancel posts nothing, and the next Settings starts from the server’s config again (#124)', async () => {
  const fx = fixture(); fx.config = CONFIG();
  const p = await browser.page(fx, {ui: ui({sel: 'lx'}), width: 1400, height: 900});
  try {
    await p.click('[data-settings]');
    await p.waitFor(`document.querySelectorAll('[data-togglecard]').length === 3`);
    await p.click('[data-addmachine]'); await p.waitFor(`document.activeElement && document.activeElement.dataset.field === '3:name'`);
    await p.send('Input.insertText', {text: 'scratch'});
    await p.click('.sheet-f [data-closesettings]');
    await p.waitFor(`document.getElementById('sheet').hidden`);
    await p.click('[data-settings]');
    await p.waitFor(`document.querySelectorAll('[data-togglecard]').length === 3`);
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('.mlabel')].map(l => l.textContent)`), ['nas <b>main</b>', 'This Mac', 'old box']);
    assert.deepEqual((fx.posts || []).filter(x => x.path === '/api/config'), []);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
