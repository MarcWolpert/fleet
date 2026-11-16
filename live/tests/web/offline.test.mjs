// SPDX-License-Identifier: GPL-3.0-or-later
// The offline card: why a machine can't be read, and numbered steps to fix it, as readable sentences.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

test('a refused login reads as sentences: each step one flowing line of text, code and bold together', async () => {
  const fx = fixture();
  Object.assign(fx.fleet.machines.find(m => m.id === 'win'), {status: 'offline', has_data: false, error: 'user@lab-windows: Permission denied (publickey,password).'});
  const p = await browser.page(fx, {ui: ui({sel: 'win'}), width: 1400, height: 900});
  try {
    await p.waitFor(`document.querySelectorAll('.steps li').length === 3`);
    assert.match(await p.eval(`document.querySelector('.state h2, .state .st-t, .state b').textContent`), /didn.t accept the login|login/i);
    // each step is the number plus ONE block of text (inline code and bold flow inside it)
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('.steps li')].map(li => [...li.childNodes].filter(n => n.nodeType === 1 || n.textContent.trim()).length)`), [1, 1, 1]);
    // so the long second step wraps as a paragraph, not as a column per word group
    const h = await p.eval(`document.querySelectorAll('.steps li')[1].getBoundingClientRect().height`);
    assert.ok(h < 70, `step 2 is ${h}px tall`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

// Retry disables itself while it works. A retry that fails fast leaves the server's answer exactly as
// it was, so the page alone must bring the button back (#86).
const RETRY_BTN = `(b => b ? [b.disabled, b.textContent] : null)(document.querySelector('[data-retry]'))`;
async function retryComesBack(fx, sel, label){
  const p = await browser.page(fx, {ui: ui({sel}), width: 1400, height: 900});
  try {
    await p.waitFor(`document.querySelector('[data-retry]')`);
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('[data-retry]')].map(b => b.dataset.retry)`), [sel]);
    await p.click('[data-retry]');
    assert.deepEqual(await p.eval(RETRY_BTN), [true, 'Retrying…']);
    await p.waitFor(`document.querySelector('[data-retry]') && !document.querySelector('[data-retry]').disabled`, 6000);
    assert.deepEqual(await p.eval(RETRY_BTN), [false, label]);
    // and it works again
    await p.click('[data-retry]');
    await p.waitFor(`document.querySelector('[data-retry]') && !document.querySelector('[data-retry]').disabled`, 6000);
    assert.deepEqual(fx.posts.filter(x => x.path === '/api/retry'), [{path: '/api/retry', body: JSON.stringify({machine: sel})}, {path: '/api/retry', body: JSON.stringify({machine: sel})}]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
}

test('Retry now comes back after a retry that failed fast, though the card reads the same (#86)', async () => {
  const fx = fixture();
  Object.assign(fx.fleet.machines.find(m => m.id === 'win'), {status: 'offline', has_data: false, last_ok: 0, error: 'user@lab-windows: Permission denied (publickey,password).'});
  await retryComesBack(fx, 'win', 'Retry now');
});

test('the Seen from its host Retry comes back too (#86)', async () => {
  const fx = fixture();
  Object.assign(fx.fleet.machines.find(m => m.id === 'win'), {status: 'hostonly', error: 'not reachable · showing what its host sees'});
  await retryComesBack(fx, 'win', 'Retry');
});
