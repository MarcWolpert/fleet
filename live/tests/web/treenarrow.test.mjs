// SPDX-License-Identifier: GPL-3.0-or-later
// #332: a tree row too narrow for its name and its details (kind, host, count, GPU tag) takes two lines: the name
// with its icon, sparkline and value on the first, the details smaller and muted under the name on the second.
// The name gets the room first; a row that fits keeps today's one line, and a wide tree keeps them all on one.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';
import {fixture, modelFleet, ui} from './fixtures.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const ROW = id => `document.querySelector('#tree .row[data-select="${id}"]')`;
const TGH = id => `document.querySelector('#tree .tgroup[data-tgroup="${id}"] > .tg-h')`;
// A row's layout, read from where things are drawn: the name (whole or cut), and which of its parts sit on the
// name's line and which on a line under it. A detail on the second line must start under the name.
const LAYOUT = row => `(() => {
  const r = ${row}; if (!r) return null;
  const n = r.querySelector('.nm, .tg-n'), nb = n.getBoundingClientRect(), rb = r.getBoundingClientRect();
  const parts = [...r.querySelectorAll('.tgk, .tgw, .count, .gtag, .tg-k, .spark, .val')];
  const line = e => { const b = e.getBoundingClientRect(), c = (b.top + b.bottom) / 2; return c >= nb.top && c <= nb.bottom ? 1 : c > nb.bottom ? 2 : 0; };
  const label = e => e.classList.contains('spark') ? 'spark' : e.classList.contains('val') ? 'value' : e.textContent;
  const two = parts.filter(e => line(e) === 2), first = two[0] && two[0].getBoundingClientRect();
  return {name: n.textContent, whole: n.scrollWidth <= n.clientWidth, line1: parts.filter(e => line(e) === 1).map(label), line2: two.map(label),
    height: Math.round(rb.height), underName: first ? Math.abs(first.left - nb.left) <= 1.5 : null,
    inRow: parts.every(e => { const b = e.getBoundingClientRect(); return b.top >= rb.top - 0.5 && b.bottom <= rb.bottom + 0.5; })};
})()`;
// the second line is smaller than the name and muted (the theme's third ink)
const SUBLINE = row => `(() => {
  const r = ${row}, n = r.querySelector('.nm, .tg-n'), nb = n.getBoundingClientRect();
  const probe = document.createElement('span'); probe.style.color = 'var(--ink-3)'; r.appendChild(probe); const ink3 = getComputedStyle(probe).color; probe.remove();
  return [...r.querySelectorAll('.tgk, .tgw, .count, .gtag, .tg-k')].filter(e => { const b = e.getBoundingClientRect(); return (b.top + b.bottom) / 2 > nb.bottom; })
    .map(e => ({t: e.textContent, smaller: parseFloat(getComputedStyle(e).fontSize) < parseFloat(getComputedStyle(n).fontSize), muted: getComputedStyle(e).color === ink3}));
})()`;

// lab-host with two Compose projects (each a count and, under GPU, a GPU tag) and vm1 with two containers; the
// division "Distributed services" groups vm1's containers, the fleet Home holds lab-nogpu.
function fx({division = 'Distributed services', vmName = 'vm1', db = 'postgres-replica-east', projects = ['customer-portal', 'analytics-api']} = {}){
  const fleet = modelFleet(), host = fleet.machines[0], vm1 = host.vms[0], ml = host.compose[0];
  vm1.name = vmName;
  vm1.containers.push(Object.assign({}, vm1.containers[0], {id: 'vm1/containers/db', name: db}));
  host.compose = projects.map((name, i) => Object.assign({}, ml, {id: 'host/compose/p' + i, name, services: ml.services.map(s => Object.assign({}, s, {id: `host/compose/p${i}/${s.name}`}))}));
  fleet.prefs = {tgroups: {
    'machines|root': [{id: 'gH', name: 'Home', c: 2, ids: ['nog']}],
    'machines|vm1/containers': [{id: 'gC', name: division, c: 1, ids: ['vm1/containers/app', 'vm1/containers/db']}]
  }};
  return {fleet};
}
const OPEN = {host: true, 'host/compose': true, 'host/vms': true, vm1: true, 'vm1/containers': true, 'host/containers': false, nog: false};
async function open(over = {}, f = fx(), width = 1500, height = 950){
  const p = await browser.page(f, {ui: ui(Object.assign({sel: 'fleet', open: OPEN}, over)), width, height});
  await p.waitFor(`document.querySelectorAll('#tree .row').length > 0`);
  return p;
}
const resize = (p, width) => p.send('Emulation.setDeviceMetricsOverride', {width, height: 950, deviceScaleFactor: 1, mobile: false});

test('in the 390 px tree, a group whose name would be cut takes two lines: name, sparkline and value, then kind, host and count', async () => {
  const p = await open({groupsOnly: true});
  try {
    assert.deepEqual(await p.eval(LAYOUT(ROW('div:gC'))),
      {name: 'Distributed services', whole: true, line1: ['spark', 'value'], line2: ['Division', 'on vm1', '2'], height: await p.eval(`Math.round(${ROW('div:gC')}.getBoundingClientRect().height)`), underName: true, inRow: true});
    const h = await p.eval(`${ROW('div:gC')}.getBoundingClientRect().height`);
    assert.ok(h >= 40 && h <= 50, 'two lines, not three: ' + h);
    assert.deepEqual(await p.eval(SUBLINE(ROW('div:gC'))), [{t: 'Division', smaller: true, muted: true}, {t: 'on vm1', smaller: true, muted: true}, {t: '2', smaller: true, muted: true}]);
    // the control: Home fits beside its kind and count, so it keeps today's one line
    assert.deepEqual(await p.eval(LAYOUT(ROW('div:gH'))), {name: 'Home', whole: true, line1: ['Fleet', '1', 'spark', 'value'], line2: [], height: 32, underName: null, inRow: true});
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a wide tree keeps every row on one line, details beside the name as before', async () => {
  const p = await open({groupsOnly: true, gfold: {gC: false}}, fx(), 800);   // under 900 px the tree takes the window's width
  try {
    assert.ok(await p.eval(`document.getElementById('tree').clientWidth`) > 700);
    assert.deepEqual(await p.eval(LAYOUT(ROW('div:gC'))), {name: 'Distributed services', whole: true, line1: ['Division', 'on vm1', '2', 'spark', 'value'], line2: [], height: 32, underName: null, inRow: true});
    assert.deepEqual(await p.eval(LAYOUT(ROW('vm1/containers/db'))), {name: 'postgres-replica-east', whole: true, line1: ['container', 'spark', 'value'], line2: [], height: 32, underName: null, inRow: true});
    assert.deepEqual(await p.eval(`[...document.querySelectorAll('#tree .row')].map(r => Math.round(r.getBoundingClientRect().height))`), [32, 32, 32, 32]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the tree\'s width decides, live: wider puts the details back beside the name, narrower takes them under it again', async () => {
  const p = await open({groupsOnly: true}, fx(), 800);
  try {
    assert.deepEqual((await p.eval(LAYOUT(ROW('div:gC')))).line2, []);
    await resize(p, 1500);
    await p.waitFor(`${LAYOUT(ROW('div:gC'))}.line2.length === 3`);
    assert.deepEqual(await p.eval(`${LAYOUT(ROW('div:gC'))}.line1`), ['spark', 'value']);
    await resize(p, 800);
    await p.waitFor(`${LAYOUT(ROW('div:gC'))}.line2.length === 0`);
    assert.equal(await p.eval(`Math.round(${ROW('div:gC')}.getBoundingClientRect().height)`), 32);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a VM\'s containers and a group\'s box header do the same: kind (and count) under a whole name', async () => {
  const p = await open({groupsOnly: true, gfold: {gC: false}});
  try {
    assert.deepEqual(await p.eval(LAYOUT(ROW('vm1/containers/db'))), {name: 'postgres-replica-east', whole: true, line1: ['spark', 'value'], line2: ['container'],
      height: await p.eval(`Math.round(${ROW('vm1/containers/db')}.getBoundingClientRect().height)`), underName: true, inRow: true});
    assert.deepEqual(await p.eval(SUBLINE(ROW('vm1/containers/db'))), [{t: 'container', smaller: true, muted: true}]);
    assert.deepEqual(await p.eval(LAYOUT(ROW('vm1/containers/app'))), {name: 'app', whole: true, line1: ['container', 'spark', 'value'], line2: [], height: 32, underName: null, inRow: true});
  } finally { await p.close(); }
  // the box around vm1's containers, folded so its header shows the count, in the normal tree
  const q = await open({gfold: {gC: true}}, fx({division: 'Distributed web services, tier 2'}));
  try {
    const l = await q.eval(LAYOUT(TGH('gC')));
    assert.deepEqual(l, {name: 'Distributed web services, tier 2', whole: true, line1: [], line2: ['division', '2'], height: l.height, underName: true, inRow: true});
    assert.ok(l.height > 29, 'taller than a one-line header');
    assert.equal(await q.eval(`(() => { const h = ${TGH('gC')}, n = h.querySelector('.tg-n').getBoundingClientRect(), pin = h.querySelector('.tg-pin').getBoundingClientRect(); return Math.abs((pin.top + pin.bottom) / 2 - (n.top + n.bottom) / 2) < 3 && pin.right <= h.getBoundingClientRect().right; })()`), true, 'the pin stays on the name\'s line, at the right');
    assert.deepEqual(q.errors, []);
  } finally { await q.close(); }
});

test('Compose projects under GPU: their count and GPU tag go under the name', async () => {
  const p = await open({metric: 'gpu'});
  try {
    for (const [id, name] of [['host/compose/p0', 'customer-portal'], ['host/compose/p1', 'analytics-api']]){
      const l = await p.eval(LAYOUT(ROW(id)));
      assert.deepEqual(l, {name, whole: true, line1: ['spark', 'value'], line2: ['2', 'GPU0+1'], height: l.height, underName: true, inRow: true}, id);
    }
    assert.equal(await p.eval(`(() => { const r = ${ROW('host/compose/p0')}; const b = r.getBoundingClientRect(), d = r.querySelector('.tdrag').getBoundingClientRect(); return d.left >= b.left && d.top >= b.top && d.bottom <= b.bottom; })()`), true, 'its drag handle is inside it');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the name gets the room first: a long host on the second line is the one cut, the kind and count stay whole', async () => {
  const p = await open({groupsOnly: true}, fx({vmName: 'gpu-build-runner-07.basement-rack.lab.example.internal'}));
  try {
    const l = await p.eval(LAYOUT(ROW('div:gC')));
    assert.deepEqual([l.name, l.whole, l.line1, l.line2], ['Distributed services', true, ['spark', 'value'], ['Division', 'on gpu-build-runner-07.basement-rack.lab.example.internal', '2']]);
    assert.deepEqual(await p.eval(`[...${ROW('div:gC')}.querySelectorAll('.tgk, .tgw, .count')].map(e => [e.textContent.slice(0, 8), e.scrollWidth > e.clientWidth])`),
      [['Division', false], ['on gpu-b', true], ['2', false]]);
    assert.ok(await p.eval(`${ROW('div:gC')}.querySelector('.count').getBoundingClientRect().right <= ${ROW('div:gC')}.getBoundingClientRect().right`), 'the count stays inside the row');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('two-line rows still select by a click on either line, and the highlight covers both', async () => {
  const p = await open({groupsOnly: true});
  try {
    const at = await p.eval(`(() => { const b = ${ROW('div:gC')}.querySelector('.tgw').getBoundingClientRect(); return {x: b.left + 4, y: (b.top + b.bottom) / 2}; })()`);
    await p.clickAt(at.x, at.y);
    await p.waitFor(`S.sel === 'div:gC'`);
    assert.equal(await p.eval(`${ROW('div:gC')}.classList.contains('sel')`), true);
    assert.equal(await p.eval(`(() => { const r = ${ROW('div:gC')}, b = r.getBoundingClientRect(), d = r.querySelector('.tgw').getBoundingClientRect(); return b.top <= d.top && b.bottom >= d.bottom && getComputedStyle(r).backgroundColor !== 'rgba(0, 0, 0, 0)'; })()`), true);
    assert.deepEqual((await p.eval(LAYOUT(ROW('div:gC')))).line2, ['Division', 'on vm1', '2'], 'still two lines once selected (the tree was drawn anew)');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the arrow keys walk through two-line rows, and the one they reach is scrolled into sight whole', async () => {
  const f = fx(), host = f.fleet.machines[0], ml = host.compose[0];
  host.compose = Array.from({length: 12}, (_, i) => Object.assign({}, ml, {id: 'host/compose/q' + i, name: 'web-portal-' + String(i).padStart(2, '0'), services: ml.services.map(s => Object.assign({}, s, {id: `host/compose/q${i}/${s.name}`}))}));
  const p = await open({metric: 'gpu', sel: 'host/compose', open: {host: true, 'host/compose': true, 'host/vms': false, 'host/containers': false, nog: false}}, f, 1500, 560);
  try {
    assert.ok(await p.eval(`(() => { const t = document.getElementById('tree'); return t.scrollHeight > t.clientHeight + 200; })()`), 'the tree scrolls');
    await p.eval(`(() => { ${ROW('host/compose')}.querySelector('.nm').focus(); return true; })()`);
    for (let i = 0; i < 12; i++){
      await p.eval(`(() => { (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true, cancelable: true})); return true; })()`);
      await p.waitFor(`S.sel === 'host/compose/q${i}'`);
      const v = await p.eval(`(() => { const t = document.getElementById('tree').getBoundingClientRect(), b = document.querySelector('#tree .row.sel').getBoundingClientRect(); return {two: ${LAYOUT(`document.querySelector('#tree .row.sel')`)}.line2.length, seen: b.top >= t.top - 0.5 && b.bottom <= t.bottom + 0.5}; })()`);
      assert.deepEqual(v, {two: 2, seen: true}, 'row ' + i);
    }
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a box drawn over two two-line rows groups them, and a drag handle on another moves it in', async () => {
  const f = fx({projects: ['customer-portal', 'analytics-api', 'billing-service']});
  const p = await open({metric: 'gpu'}, f);
  try {
    for (const id of ['host/compose/p0', 'host/compose/p1', 'host/compose/p2']) assert.equal((await p.eval(LAYOUT(ROW(id)))).line2.length, 2, id + ' takes two lines');
    // tree order: analytics-api (p1), billing-service (p2), customer-portal (p0). Press on p1's second line, let go on p2's.
    await p.eval(`(() => { const a = ${ROW('host/compose/p1')}.querySelector('.gtag').getBoundingClientRect(), b = ${ROW('host/compose/p2')}.getBoundingClientRect(); const x0 = a.right + 30, y0 = (a.top + a.bottom) / 2, x1 = b.left + 70, y1 = b.bottom - 4; const t = document.elementFromPoint(x0, y0); const o = (x, y) => ({bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1}); t.dispatchEvent(new PointerEvent('pointerdown', o(x0, y0))); for (let i = 1; i <= 6; i++) document.dispatchEvent(new PointerEvent('pointermove', o(x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6))); document.dispatchEvent(new PointerEvent('pointerup', o(x1, y1))); t.dispatchEvent(new MouseEvent('click', o(x1, y1))); return true; })()`);
    await p.waitFor(`document.querySelector('#tree .tgroup[data-tgkey="machines|host/compose"]')`);
    const members = `[...document.querySelectorAll('#tree .tgroup[data-tgkey="machines|host/compose"] .row')].map(r => r.dataset.select)`;
    assert.deepEqual(await p.eval(members), ['host/compose/p1', 'host/compose/p2']);
    assert.equal(await p.eval(`S.sel`), 'fleet', 'the drag selected nothing');
    // customer-portal's handle, dropped on a grouped two-line row's second line: into that group
    await p.eval(`(() => { const h = ${ROW('host/compose/p0')}.querySelector('.tdrag'), t = ${ROW('host/compose/p2')}.querySelector('.count'); const dt = new DataTransfer(); const r = t.getBoundingClientRect(); const o = {bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 2, clientY: r.top + 2}; h.dispatchEvent(new DragEvent('dragstart', o)); t.dispatchEvent(new DragEvent('dragenter', o)); t.dispatchEvent(new DragEvent('dragover', o)); t.dispatchEvent(new DragEvent('drop', o)); h.dispatchEvent(new DragEvent('dragend', o)); return true; })()`);
    await p.waitFor(`${members}.length === 3`);
    assert.deepEqual(await p.eval(members), ['host/compose/p1', 'host/compose/p2', 'host/compose/p0']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the network tree too: a bridge\'s long Docker network goes under its name; a short one stays beside it', async () => {
  const f = fixture(), ifc = (name, kind) => ({name, kind, rx: 0.1, tx: 0.1, addrs: [], state: 'up', speed: '', master: ''});
  f.net = {tailnet: 'tailnet', machines: [{id: 'lx', name: 'lab-linux', status: 'ok', tailscale: {ip: '100.64.0.2', online: true, direct: true},
    ifs: [ifc('eth0', 'physical'), ifc('docker0', 'bridge'), ifc('br-5e1f0c2a9b7d', 'bridge')], containers: [], vms: [],
    dockernets: [{name: 'bridge', id: 'abc', driver: 'bridge'}, {name: 'analytics-pipeline-backend-network', id: '5e1f0c2a9b7d', driver: 'bridge'}]}]};
  const p = await browser.page(f, {ui: ui({tree: 'network', netSel: 'net:tailnet', open: {'net:m:lx': true}})});
  const NR = id => `document.querySelector('#tree .row[data-netsel="${id}"]')`;
  try {
    await p.waitFor(`${NR('net:if:lx:br-5e1f0c2a9b7d')}`);
    const l = await p.eval(LAYOUT(NR('net:if:lx:br-5e1f0c2a9b7d')));
    assert.deepEqual(l, {name: 'br-5e1f0c2a9b7d', whole: true, line1: [], line2: ['analytics-pipeline-backend-network'], height: l.height, underName: true, inRow: true});
    assert.deepEqual(await p.eval(LAYOUT(NR('net:if:lx:docker0'))), {name: 'docker0', whole: true, line1: ['bridge'], line2: [], height: 32, underName: null, inRow: true});
    assert.equal(await p.eval(`(() => { const r = ${NR('net:if:lx:br-5e1f0c2a9b7d')}, n = r.querySelector('.nm').getBoundingClientRect(), v = r.querySelector('.nrate').getBoundingClientRect(); return v.top < n.bottom && v.bottom > n.top; })()`), true, 'its rates stay on the name\'s line');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
