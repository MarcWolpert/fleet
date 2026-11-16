// SPDX-License-Identifier: GPL-3.0-or-later
// Browser test harness for Fleet Live's web UI (live/web/index.html + app.js).
//
// No dependencies: Node 22+ (node:test, the built-in WebSocket) and any Chromium. Each test page gets
// its own fixture server on a fresh port, so its origin (and localStorage) starts empty. The fixture
// server answers /api/* from plain objects the test owns, so no machine is ever read.
//
//   node --test live/tests/web/*.test.mjs     (or live/tests/run.sh, which runs every Fleet Live test)
//   FLEET_TEST_CHROME=/path/to/chrome    to pick the browser; FLEET_TEST_SHOTS=dir saves screenshots;
//   FLEET_TEST_WEB=dir                   tests another copy of web/ (e.g. the last commit's, for a red run)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WEB = path.resolve(process.env.FLEET_TEST_WEB || path.join(HERE, '..', '..', 'web'));  // FLEET_TEST_WEB: test another copy (e.g. a red run)

/* ---------- fixture server ---------- */
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml'};
const WRITES = ['/api/config', '/api/test', '/api/terminal', '/api/prefs', '/api/tilepins', '/api/connect', '/api/retry', '/api/pins'];
// A write, judged the way fleet_live.py's do_POST judges it: [status] or [200, its answer]. 403 unless it comes
// from this page (Host, Origin, X-Fleet: 1), 404 for a route the server doesn't have, 400 for a body it won't keep
// (the server drops the connection on a body that isn't JSON; the page sees a failed write either way).
function judgeWrite(req, port, path, raw){
  const hosts = ['127.0.0.1:' + port, 'localhost:' + port], h = req.headers;
  if (!hosts.includes(h.host || '') || (h.origin && !hosts.some(x => h.origin === 'http://' + x)) || h['x-fleet'] !== '1') return [403];
  if (!WRITES.includes(path)) return [404];
  if (!['/api/prefs', '/api/tilepins', '/api/pins'].includes(path)) return [200, {ok: true}];
  let d; try { d = JSON.parse(raw.subarray(0, path === '/api/pins' ? 65536 : 1 << 20).toString() || (path === '/api/pins' ? '[]' : 'null')); } catch (e) { return [400]; }
  const dict = d !== null && typeof d === 'object' && !Array.isArray(d);
  if (path === '/api/prefs') return dict && JSON.stringify(d).length <= 65536 ? [200, {prefs: d}] : [400];
  if (path === '/api/tilepins'){
    const vs = dict ? Object.values(d) : [];
    if (!dict || vs.length > 500 || !vs.every(v => Array.isArray(v) && v.length <= 200)) return [400];
    return [200, {tilepins: Object.fromEntries(Object.entries(d).filter(([, v]) => v.length).map(([k, v]) => [k.slice(0, 200), v.map(x => String(x).slice(0, 200))]))}];
  }
  return Array.isArray(d) && d.every(p => typeof p === 'string' && p.length < 300) ? [200, {pins: d.slice(0, 40)}] : [400];
}
export function startServer(fx){
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = o => { const b = Buffer.from(JSON.stringify(o)); res.writeHead(200, {'Content-Type': 'application/json', 'Content-Length': b.length}); res.end(b); };
    if (u.pathname.startsWith('/api/')){
      const mid = u.searchParams.get('machine') || '';
      // fx.posts: the writes the server took, {path, body, headers}; fx.refused: the ones it turned away, with the status
      if (req.method === 'POST'){ const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => {
        const raw = Buffer.concat(parts), body = raw.toString(), w = {path: u.pathname, body, headers: req.headers};
        const [status, answer] = judgeWrite(req, srv.address().port, u.pathname, raw);
        if (status !== 200){ fx.refused = (fx.refused || []).concat([Object.assign(w, {status})]); res.writeHead(status); return res.end(); }
        fx.posts = (fx.posts || []).concat([w]);
        const own = typeof fx.onPost === 'function' ? fx.onPost(u.pathname, body) : null;
        if (own) return json(own);  // a test plays the server's part
        // kept and sent back with every /api/fleet, like the server's ui.json, pins.json and tilepins.json
        const kept = {'/api/prefs': 'prefs', '/api/pins': 'pins', '/api/tilepins': 'tilepins'}[u.pathname];
        if (kept && fx.fleet) fx.fleet[kept] = answer[kept];
        json(answer); }); return; }
      if (u.pathname === '/api/fleet'){  // fx.holdFleet: the answer is made now (as the server reads ui.json) but sent when the test calls it (see heldPoll)
        if (!fx.holdFleet) return json(fx.fleet);
        const now = JSON.parse(JSON.stringify(fx.fleet)); fx.held = (fx.held || []).concat([() => json(now)]); return;
      }
      if (u.pathname === '/api/procs') return json((fx.procs || {})[mid] || {procs: []});
      if (u.pathname === '/api/cpus') return json((fx.cpus || {})[mid] || {});
      if (u.pathname === '/api/disks') return json((fx.disks || {})[mid] || {disks: [], per_process: true});
      if (u.pathname === '/api/ifs') return json((fx.ifs || {})[mid] || {ifs: [], per_process: true});
      if (u.pathname === '/api/net') return json(fx.net || {tailnet: 'tailnet', machines: []});
      if (u.pathname === '/api/proc'){  // the Details drop-down: fx.proc(machine, pid, call number) answers
        const pid = +u.searchParams.get('pid'); fx.procCalls = (fx.procCalls || []).concat([mid + ':' + pid]);
        return json((typeof fx.proc === 'function' ? fx.proc(mid, pid, fx.procCalls.length) : null) || {pid, error: 'no fixture'});
      }
      if (u.pathname === '/api/config') return json(fx.config || {path: '/dev/null', interval: 3, machines: [], status: {}, terminals: []});
      res.writeHead(404); return res.end();
    }
    const f = path.join(WEB, u.pathname === '/' ? 'index.html' : path.normalize(u.pathname).replace(/^\/+/, ''));
    if (!f.startsWith(WEB) || !fs.existsSync(f)){ res.writeHead(404); return res.end(); }
    const st = fs.statSync(f);
    res.writeHead(200, {'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Content-Length': st.size, 'Last-Modified': st.mtime.toUTCString()});
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok({url: `http://127.0.0.1:${srv.address().port}/`, close: () => new Promise(r => { srv.closeAllConnections(); srv.close(r); })})));
}

/* ---------- browser ---------- */
function findChrome(){
  if (process.env.FLEET_TEST_CHROME) return process.env.FLEET_TEST_CHROME;
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  const cands = [];
  try {
    for (const d of fs.readdirSync(cache).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse())
      for (const sub of ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-headless-shell-linux64'])
        cands.push(path.join(cache, d, sub, 'chrome-headless-shell'));
  } catch (e) {}
  cands.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
             '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome');
  const c = cands.find(p => fs.existsSync(p));
  if (!c) throw new Error('no Chromium found: set FLEET_TEST_CHROME');
  return c;
}

class CDP {
  constructor(ws){
    this.ws = ws; this.id = 0; this.wait = new Map(); this.subs = [];
    ws.onmessage = m => this.recv(JSON.parse(m.data));
    ws.onclose = () => { this.wait.forEach(({no}) => no(new Error('the browser went away'))); this.wait.clear(); };
  }
  recv(msg){
    if (msg.id && this.wait.has(msg.id)){ const {ok, no} = this.wait.get(msg.id); this.wait.delete(msg.id); msg.error ? no(new Error(msg.error.message)) : ok(msg.result); return; }
    this.subs.forEach(s => { if (s.method === msg.method && s.session === msg.sessionId) s.fn(msg.params); });
  }
  send(method, params = {}, sessionId){
    if (this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('the browser went away'));
    const id = ++this.id; this.ws.send(JSON.stringify({id, method, params, sessionId}));
    return new Promise((ok, no) => {
      const t = setTimeout(() => { this.wait.delete(id); no(new Error(method + ' got no answer in 20 s')); }, 20000);
      this.wait.set(id, {ok: v => { clearTimeout(t); ok(v); }, no: e => { clearTimeout(t); no(e); }});
    });
  }
  on(method, session, fn){ const s = {method, session, fn}; this.subs.push(s); return () => { this.subs = this.subs.filter(x => x !== s); }; }
}

export async function launch(){
  const bin = findChrome();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-webtest-'));
  const args = ['--remote-debugging-port=0', '--user-data-dir=' + dir, '--no-first-run', '--no-default-browser-check', '--disable-gpu',
                '--disable-extensions', '--disable-background-networking', '--mute-audio', 'about:blank'];
  if (!/headless-shell/.test(bin)) args.unshift('--headless=new');
  const proc = spawn(bin, args, {stdio: ['ignore', 'ignore', 'pipe']});
  const wsUrl = await new Promise((ok, no) => {
    let err = '';
    const t = setTimeout(() => no(new Error('browser did not start: ' + err.slice(-400))), 20000);
    proc.stderr.on('data', d => { err += d; const m = err.match(/DevTools listening on (ws:\/\/\S+)/); if (m){ clearTimeout(t); ok(m[1]); } });
    proc.on('exit', c => no(new Error('browser exited ' + c + ': ' + err.slice(-400))));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  const cdp = new CDP(ws);
  return {
    cdp,
    async page(fx, opts = {}){ return openPage(cdp, fx, opts); },
    async close(){ try { await cdp.send('Browser.close'); } catch (e) {} ws.close(); await new Promise(r => { if (proc.exitCode != null) return r(); proc.on('exit', r); setTimeout(() => { proc.kill('SIGKILL'); r(); }, 3000); }); fs.rmSync(dir, {recursive: true, force: true}); }
  };
}

/* ---------- pages ---------- */
// url: drive a running Fleet Live (e.g. an isolated instance) instead of a fixture server.
async function openPage(cdp, fx, {ui = null, width = 1500, height = 950, fonts = false, url = null} = {}){
  const server = url ? {url, close: async () => {}} : await startServer(fx);
  const {targetId} = await cdp.send('Target.createTarget', {url: 'about:blank'});
  const {sessionId: s} = await cdp.send('Target.attachToTarget', {targetId, flatten: true});
  const send = (m, p) => cdp.send(m, p, s);
  const errors = [];
  cdp.on('Runtime.exceptionThrown', s, p => errors.push(p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text));
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  if (!fonts) await send('Network.setBlockedURLs', {urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*']});
  await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
  // Seed the saved UI state once per tab; a reload keeps whatever the page saved since.
  if (ui) await send('Page.addScriptToEvaluateOnNewDocument', {source: `if (!sessionStorage.getItem('seeded')){ localStorage.setItem('fleet-live-ui', ${JSON.stringify(JSON.stringify(ui))}); sessionStorage.setItem('seeded', '1'); }`});
  const page = {
    errors, send, url: server.url, on: (method, fn) => cdp.on(method, s, fn),
    async goto(){ const loaded = new Promise(r => { const off = cdp.on('Page.loadEventFired', s, () => { off(); r(); }); }); await send('Page.navigate', {url: server.url}); await loaded; },
    async reload(){ const loaded = new Promise(r => { const off = cdp.on('Page.loadEventFired', s, () => { off(); r(); }); }); await send('Page.reload', {ignoreCache: true}); await loaded; },
    async eval(expr){
      const r = await send('Runtime.evaluate', {expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true});
      if (r.exceptionDetails) throw new Error('page eval failed: ' + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text) + '\n  in: ' + expr);
      return r.result.value;
    },
    async waitFor(expr, timeout = 6000){
      const end = Date.now() + timeout; let last;
      while (Date.now() < end){ last = await page.eval(expr).catch(e => { last = e; return undefined; }); if (last) return last; await sleep(40); }
      throw new Error('timed out waiting for: ' + expr + (last instanceof Error ? ' (' + last.message + ')' : ''));
    },
    // A real mouse click at the element's centre (hit-tested like a person's click).
    async click(selector, {modifiers = 0} = {}){
      const r = await page.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({block: 'center', inline: 'center'}); const b = e.getBoundingClientRect(); return {x: b.left + b.width / 2, y: b.top + b.height / 2}; })()`);
      if (!r) throw new Error('no element for ' + selector);
      await send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: r.x, y: r.y, modifiers});
      await send('Input.dispatchMouseEvent', {type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1, modifiers});
      await send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 1, modifiers});
    },
    async key(key, code = key){
      const vk = {Escape: 27, Enter: 13, ' ': 32}[key] || 0, text = {Enter: '\r', ' ': ' '}[key];
      await send('Input.dispatchKeyEvent', Object.assign({type: 'keyDown', key, code, windowsVirtualKeyCode: vk}, text ? {text} : {}));
      await send('Input.dispatchKeyEvent', {type: 'keyUp', key, code, windowsVirtualKeyCode: vk});
    },
    async shot(name){
      const dir = process.env.FLEET_TEST_SHOTS; if (!dir) return null;
      fs.mkdirSync(dir, {recursive: true});
      const {data} = await send('Page.captureScreenshot', {format: 'png'});
      const f = path.join(dir, name + '.png'); fs.writeFileSync(f, Buffer.from(data, 'base64')); return f;
    },
    async close(){ try { await cdp.send('Target.closeTarget', {targetId}); } catch (e) {} await server.close(); }
  };
  await page.goto();
  return page;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// With fx.holdFleet set: asks the page to poll until the fixture server holds an /api/fleet answer back, and
// returns the function that sends it. The page polls one at a time, so a new one held means the last is done.
export async function heldPoll(p, fx){
  for (const end = Date.now() + 6000; !(fx.held || []).length; await sleep(40)){
    if (Date.now() > end) throw new Error('no /api/fleet poll was held');
    await p.eval(`(() => { refreshNow(); return true; })()`);
  }
  return fx.held.shift();
}
