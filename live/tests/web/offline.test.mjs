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

// What the offline card says: its kind (the icon's class), title, text and steps, as plain text.
const CARD = `(() => { const s = document.querySelector('.state'); if (!s) return null; const ic = s.querySelector('.state-ic');
  return {kind: [...ic.classList].filter(c => c !== 'state-ic'), title: s.querySelector('h2').textContent, text: s.querySelector('.state-body > p').textContent,
    steps: [...s.querySelectorAll('.steps li')].map(li => li.textContent)}; })()`;
async function offlineCard(error, sel = 'lx'){
  const fx = fixture();
  Object.assign(fx.fleet.machines.find(m => m.id === sel), {status: 'offline', has_data: false, last_ok: 0, ssh: 'admin@nas', error});
  const p = await browser.page(fx, {ui: ui({sel}), width: 1400, height: 900});
  try {
    await p.waitFor(`document.querySelector('.state')`);
    const c = await p.eval(CARD);
    assert.deepEqual(p.errors, []);
    return c;
  } finally { await p.close(); }
}
// ssh keeps only the last 5 lines of stderr, joined with spaces and cut at 300 characters, as the server does
const tail = lines => lines.slice(-5).join(' ').slice(0, 300);
const CHANGED = {kind: ['key'], title: 'lab-linux’s SSH host key has changed',
  text: 'SSH remembers another key for admin@nas than the one it was just sent, so it refused to connect. A rebuilt or reinstalled machine does that, but so does an impostor: check the new key before you trust it.',
  steps: ['If you didn’t rebuild or reinstall lab-linux, don’t connect: find out first why its key changed.',
    'Otherwise read its new fingerprint on the machine itself, e.g. ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub on Linux, or the same file under C:\\ProgramData\\ssh on Windows.',
    'Remove the old key with ssh-keygen -R nas, then run ssh admin@nas, check that the fingerprint matches, type yes, and log out.',
    'Press Retry now.']};

test('a changed host key says it changed and warns of an impostor, not first contact: macOS OpenSSH (#93)', async () => {
  assert.deepEqual(await offlineCard(tail(['@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @', 'IT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY!',
    'Please contact your system administrator.', 'Add correct host key in /home/user/.ssh/known_hosts to get rid of this message.',
    'Offending ED25519 key in /home/user/.ssh/known_hosts:12', 'Host key for nas has changed and you have requested strict checking.', 'Host key verification failed.'])), CHANGED);
});

test('a changed host key, as Linux OpenSSH 9 words it (#93)', async () => {
  assert.deepEqual(await offlineCard(tail(['Offending ED25519 key in /home/user/.ssh/known_hosts:12', 'remove with:', 'ssh-keygen -f \'/home/user/.ssh/known_hosts\' -R \'nas\'',
    'ED25519 host key for nas has changed and you have requested strict checking.', 'Host key verification failed.'])), CHANGED);
});

test('control: an unknown host key is still first contact: trust it once (#93)', async () => {
  assert.deepEqual(await offlineCard('No ED25519 host key is known for nas and you have requested strict checking. Host key verification failed.'), {kind: ['key'],
    title: 'Fleet can’t confirm this is really lab-linux',
    text: 'SSH has no trusted host key for admin@nas yet, so it refused to connect. That’s SSH protecting you from an impostor; trusting the key once fixes it.',
    steps: ['Open Terminal and run ssh admin@nas.', 'Check the fingerprint, type yes to trust it, then log out.', 'Press Retry now.']});
});

test('control: a key added on first contact, then a refused login, is a refused login (#93)', async () => {
  assert.deepEqual(await offlineCard('Warning: Permanently added \'nas\' (ED25519) to the list of known hosts. admin@nas: Permission denied (publickey).'), {kind: ['auth'],
    title: 'lab-linux didn’t accept the login',
    text: 'The machine answered, but turned down the user or key Fleet used for admin@nas.',
    steps: ['Check the user in Settings (it looks like user@host).', 'Authorize your SSH key there: ssh-copy-id admin@nas for Linux; on Windows add it to the user’s .ssh\\authorized_keys, or administrators_authorized_keys for admin accounts.', 'Press Retry now.']});
});
