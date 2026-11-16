// SPDX-License-Identifier: GPL-3.0-or-later
// Open terminal / Open shell: only where Fleet can open one (a machine over ssh or this computer, a
// container, a Compose service), and what it asks the server for (#124).
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

function fleet(){
  const fx = fixture(), lx = fx.fleet.machines.find(m => m.id === 'lx'), mac = fx.fleet.machines.find(m => m.id === 'mac');
  Object.assign(mac, {agent: 'local', ssh: ''});
  lx.compose = [{id: 'lx/compose/lab-app', name: 'lab-app', file: '/srv/lab-app/compose.yml', services: [{id: 'lx/compose/lab-app/api', name: 'api', image: 'lab/api:1', status: 'Up 2 hours', g: []}]}];
  lx.vms = [{id: 'lx/vm/db', name: 'db', tile: 'vm', status: 'hostonly', error: 'not reachable · showing what its host sees', os: 'Linux', agent: '', ssh: '', last_ok: 0,
    gpus: [], cap: [4, 8, 0, 100, 100], ncpu: 4, groups: [], base: {id: 'lx/vm/db/base', g: []}, baseCron: [], compose: [], containers: [], vms: []}];
  return fx;
}
// every terminal button on the page: [node, label, tooltip]; each case: what, selection, the view's title, buttons, changes to the machine
const BTNS = `[...document.querySelectorAll('[data-terminal]')].map(b => [b.dataset.terminal, b.textContent, b.title])`;
const CASES = [
  ['a machine read over ssh', 'lx', 'lab-linux', [['lx', 'Open terminal', 'ssh lx']]],
  ['this computer', 'mac', 'lab-mac', [['mac', 'Open terminal', 'A new shell on this computer']]],
  ['a machine that is offline, on its card', 'win', 'lab-windows', [['win', 'Open terminal', 'ssh win']], {status: 'offline', has_data: false, error: 'ssh: connect to host win port 22: Connection refused'}],
  ['a container', 'lx/containers/web', 'web', [['lx/containers/web', 'Open shell', 'A shell inside this container']]],
  ['a Compose service', 'lx/compose/lab-app/api', 'api', [['lx/compose/lab-app/api', 'Open shell', 'A shell inside this container']]],
  ['nothing else: a Base system', 'lx/base', 'Base system', []],
  ['nothing else: a VM Fleet only sees from its host (no ssh)', 'lx/vm/db', 'db', []],
  ['nothing else: a Compose project', 'lx/compose/lab-app', 'lab-app', []],
  ['nothing else: all machines', 'fleet', 'All machines', []]
];
for (const [what, sel, h1, want, over] of CASES) test(`terminal buttons on ${what} (#124)`, async () => {
  const fx = fleet();
  if (over) Object.assign(fx.fleet.machines.find(m => m.id === sel), over);
  const p = await browser.page(fx, {ui: ui({sel}), width: 1400, height: 900});
  try {
    // the view meant (its title), then exactly its terminal buttons
    assert.equal(await p.waitFor(`(h => h && h.firstChild.textContent.trim())(document.querySelector('main h1'))`), h1);
    assert.deepEqual(await p.eval(BTNS), want);
    if (want.length){
      await p.click('[data-terminal]');
      await p.waitFor(`document.getElementById('toast') && document.getElementById('toast').textContent`);
      assert.deepEqual(fx.posts.filter(x => x.path === '/api/terminal'), [{path: '/api/terminal', body: JSON.stringify({node: sel})}]);
    }
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
