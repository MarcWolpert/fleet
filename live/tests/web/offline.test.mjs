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

test('a live VM under a host without a reading is in the tree, its share taken of its own capacity (#147)', async () => {
  const fx = fixture(), H = 60, flat = v => new Array(H).fill(v);
  const h = cpu => ({cpu: flat(cpu), mem: flat(8), gpu: flat(0), disk: flat(0), net: flat(0)});
  const vm = {id: 'win-vm', name: 'win-vm', tile: 'vm', status: 'ok', error: '', os: 'Windows', agent: 'ssh win-vm', cronLabel: 'Scheduled tasks',
    gpus: [], cap: [8, 32, 0, 300, 125], ncpu: 8, has_data: true, base: {id: 'win-vm/base', h: h(2), g: []}, baseCron: [], compose: [], containers: [], vms: []};
  // what the server sends for a host it has no reading of: no data, the placeholder capacity, its VMs
  Object.assign(fx.fleet.machines.find(m => m.id === 'win'), {status: 'offline', has_data: false, error: 'connection closed (exit 255)',
    cap: [1, 1, 0, 1, 1], gpus: [], containers: [], base: {id: 'win/base', g: []}, vms: [vm]});
  const p = await browser.page(fx, {ui: ui({sel: 'win-vm', open: {win: true, 'win/vms': true}})});
  try {
    await p.waitFor(`document.querySelector('[data-val="win-vm"]')`);
    // the host can't be read, so nothing under it has a share of it but the VM, of its own 8 CPUs; other hosts as before
    assert.deepEqual(await p.eval(`Object.fromEntries([...document.querySelectorAll('[data-val^="win"], [data-val^="lx/"]')].map(e => [e.dataset.val, e.textContent]))`),
      {win: 'offline', 'win/base': '—', 'win/vms': '—', 'win-vm': '25%', 'lx/base': '0%', 'lx/containers': '0%'});
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
    assert.deepEqual(fx.posts.filter(x => x.path === '/api/retry').map(x => ({path: x.path, body: x.body})), [{path: '/api/retry', body: JSON.stringify({machine: sel})}, {path: '/api/retry', body: JSON.stringify({machine: sel})}]);
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

// Every kind of failure, as ssh and the server word it: the card's pill, kind, title, text, steps,
// actions, and its Technical details (the raw error and when the last reading was) (#124).
const FULL = `(() => { const s = document.querySelector('.state'), pill = document.querySelector('.hero h1 .spill'), raw = s.querySelector('.state-raw');
  return {pill: [[...pill.classList].filter(c => c !== 'spill'), pill.textContent], kind: [...s.querySelector('.state-ic').classList].filter(c => c !== 'state-ic'),
    title: s.querySelector('h2').textContent, text: s.querySelector('.state-body > p').textContent, steps: [...s.querySelectorAll('.steps li')].map(li => li.textContent),
    actions: [...s.querySelectorAll('.state-actions button')].map(b => b.textContent), raw: raw ? [raw.querySelector('code').textContent, raw.querySelector('div').textContent] : null}; })()`;
const RETRY = 'Press Retry now.', ACT = ['Retry now', 'Open Settings'], NOREAD = 'No reading yet · retrying on its own';
const DNS = {title: 'Fleet can’t find admin@nas', text: 'That name doesn’t resolve to an address from this computer.',
  steps: ['Check the spelling in Settings.', 'If it’s a Tailscale name, check that MagicDNS is on and the machine is on your tailnet.', RETRY]};
const DOWN = {title: 'lab-linux isn’t answering', text: 'Nothing came back from admin@nas. It may be asleep or off, off your tailnet, or SSH may be on another port.',
  steps: ['Check that it’s on and connected to Tailscale.', 'If SSH uses another port, set it in ~/.ssh/config.', RETRY]};
const AUTH = {title: 'lab-linux didn’t accept the login', text: 'The machine answered, but turned down the user or key Fleet used for admin@nas.',
  steps: ['Check the user in Settings (it looks like user@host).', 'Authorize your SSH key there: ssh-copy-id admin@nas for Linux; on Windows add it to the user’s .ssh\\authorized_keys, or administrators_authorized_keys for admin accounts.', RETRY]};
const CASES = [
  ['turned off (a VM its host reports as not running): no Retry', {status: 'off', error: ''}, {pill: [['off'], 'stopped'], kind: ['off'], title: 'lab-linux is stopped',
    text: 'Its host reports this VM as not running. Start it there and Fleet picks it up within a few seconds.', steps: [], actions: ['Open Settings'], raw: null}],
  ['connecting, before the first reading', {status: 'connecting', error: ''}, {pill: [['wait'], 'connecting'], kind: ['wait'], title: 'Connecting to lab-linux…',
    text: 'Waiting for its first reading.', steps: [], actions: ACT, raw: null}],
  ['a name macOS can’t resolve', {error: 'ssh: Could not resolve hostname nas: nodename nor servname provided, or not known'}, {kind: ['dns'], ...DNS}],
  ['a name Linux can’t resolve', {error: 'ssh: Could not resolve hostname nas: Name or service not known'}, {kind: ['dns'], ...DNS}],
  ['a refused connection', {error: 'ssh: connect to host nas port 22: Connection refused'}, {kind: ['down'], title: 'lab-linux is up, but SSH isn’t answering',
    text: 'Something answered at admin@nas, but nothing is listening for SSH on that port.',
    steps: ['Start the SSH server there (OpenSSH Server on Windows, sshd on Linux).', 'If it uses another port, set Port for this host in ~/.ssh/config.', RETRY]}],
  ['a timeout', {error: 'ssh: connect to host nas port 22: Operation timed out'}, {kind: ['down'], ...DOWN}],
  ['no route to the host', {error: 'ssh: connect to host nas port 22: No route to host'}, {kind: ['down'], ...DOWN}],
  ['the server’s own message when ssh said nothing', {error: 'connection closed (exit 255)'}, {kind: ['down'], ...DOWN}],
  ['a broken pipe', {error: 'client_loop: send disconnect: Broken pipe'}, {kind: ['down'], ...DOWN}],
  ['too many keys offered', {error: 'Received disconnect from nas port 22:2: Too many authentication failures'}, {kind: ['auth'], ...AUTH}],
  ['no python3 there', {error: 'bash: line 1: python3: command not found'}, {kind: ['py'], title: 'lab-linux needs Python 3',
    text: 'Fleet reads Linux machines and Macs with a small read-only Python script and installs nothing, but it needs python3 there.',
    steps: ['Install Python 3 on that machine, e.g. sudo apt install python3.', RETRY]}],
  ['anything else', {error: 'bad reading: Incorrect padding'}, {kind: ['other'], title: 'Fleet can’t reach lab-linux', text: 'The connection ended before the first reading.',
    steps: ['Check the details below, or the machine’s entry in Settings.', RETRY]}]
];
for (const [what, over, want] of CASES) test(`the offline card for ${what} (#124)`, async () => {
  const fx = fixture();
  Object.assign(fx.fleet.machines.find(m => m.id === 'lx'), {status: 'offline', has_data: false, last_ok: 0, ssh: 'admin@nas'}, over);
  const p = await browser.page(fx, {ui: ui({sel: 'lx'}), width: 1400, height: 900});
  try {
    await p.waitFor(`document.querySelector('.state')`);
    assert.deepEqual(await p.eval(FULL), Object.assign({pill: [want.kind, 'offline'], actions: ACT, raw: [over.error, NOREAD]}, want));
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

// Names, the SSH destination, a VM's host and ssh's own words are text, never markup (#124).
const NASTY = 'lab <b>linux</b> & "co"';
test('the offline card shows the machine’s name, destination and error as text (#124)', async () => {
  const fx = fixture(), err = 'admin@nas<i>: Permission denied (publickey) <script>window.PWNED = 1</script>';
  Object.assign(fx.fleet.machines.find(m => m.id === 'lx'), {name: NASTY, status: 'offline', has_data: false, last_ok: 0, ssh: 'admin@nas<i>', error: err});
  const p = await browser.page(fx, {ui: ui({sel: 'lx'}), width: 1400, height: 900});
  try {
    await p.waitFor(`document.querySelector('.state')`);
    assert.deepEqual(await p.eval(`[document.querySelector('.hero h1').firstChild.nodeValue, [...document.querySelectorAll('.hero .facts span')].map(s => s.textContent)]`),
      [NASTY + ' ', ['Linux · x86_64', 'ssh admin@nas<i>']]);
    assert.deepEqual(await p.eval(FULL), {pill: [['auth'], 'offline'], kind: ['auth'], title: NASTY + ' didn’t accept the login',
      text: 'The machine answered, but turned down the user or key Fleet used for admin@nas<i>.',
      steps: ['Check the user in Settings (it looks like user@host).', 'Authorize your SSH key there: ssh-copy-id admin@nas<i> for Linux; on Windows add it to the user’s .ssh\\authorized_keys, or administrators_authorized_keys for admin accounts.', RETRY],
      actions: ACT, raw: [err, NOREAD]});
    assert.deepEqual(await p.eval(`[document.querySelectorAll('.hero h1 b, .hero h1 i, main script, .state h2 *, .state-body > p i, .state-raw code *').length, window.PWNED === undefined]`), [0, true]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a VM’s offline card names its host as text, and a live machine’s hero its name (#124)', async () => {
  const fx = fixture(), lx = fx.fleet.machines.find(m => m.id === 'lx');
  lx.name = NASTY;
  lx.vms = [{id: 'lx/vm/db', name: 'db <u>vm</u>', tile: 'vm', status: 'off', error: '', os: 'Linux', agent: '', ssh: '', has_data: false, last_ok: 0,
    gpus: [], cap: [4, 8, 0, 100, 100], ncpu: 4, groups: [], base: {id: 'lx/vm/db/base', g: []}, baseCron: [], compose: [], containers: [], vms: []}];
  const p = await browser.page(fx, {ui: ui({sel: 'lx/vm/db'}), width: 1400, height: 900});
  try {
    await p.waitFor(`document.querySelector('.state')`);
    assert.deepEqual(await p.eval(`[document.querySelector('.hero h1').firstChild.nodeValue, [...document.querySelectorAll('.hero .facts span')].map(s => s.textContent), document.querySelector('.state h2').textContent]`),
      ['db <u>vm</u> ', ['Linux', 'VM on ' + NASTY], 'db <u>vm</u> is stopped']);
    await p.eval(`(select('lx'), true)`);
    await p.waitFor(`!document.querySelector('.state') && document.querySelector('.hero h1')`);
    assert.deepEqual(await p.eval(`[document.querySelector('.hero h1').firstChild.nodeValue, document.querySelectorAll('.hero h1 b, .hero h1 u').length]`), [NASTY + ' ', 0]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
