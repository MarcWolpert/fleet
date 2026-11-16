// SPDX-License-Identifier: GPL-3.0-or-later
// Fleet Live UI: pinned spaces, machine and network trees, usage by type,
// per-GPU attribution, logical processors, and a sortable Details process list.
'use strict';

/* ---------- constants ---------- */
const H = 60;
const METRICS = [{id:'cpu', label:'CPU'}, {id:'mem', label:'Memory'}, {id:'gpu', label:'GPU'}, {id:'disk', label:'Disk I/O'}, {id:'net', label:'Network'}];
const MI = {cpu:0, mem:1, gpu:2, disk:3, net:4};
const UNIT = {cpu:'cores', mem:'GB', gpu:'%', disk:'MB/s', net:'MB/s'};
const TYPES = [{id:'base', label:'Base system', short:'Base'}, {id:'compose', label:'Docker Compose', short:'Compose'}, {id:'container', label:'Containers', short:'Containers'}, {id:'vm', label:'VMs', short:'VMs'}];
const TCOL = {base:'var(--t-base)', compose:'var(--t-compose)', container:'var(--t-container)', vm:'var(--t-vm)'};

const IC = {
  chev:'<path d="M9 6l6 6-6 6"/>',
  laptop:'<path d="M4.5 6.5A1.5 1.5 0 0 1 6 5h12a1.5 1.5 0 0 1 1.5 1.5V15h-15z"/><path d="M2.5 18.5h19"/>',
  terminal:'<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5"/>',
  server:'<rect x="3.5" y="4" width="17" height="7" rx="1.8"/><rect x="3.5" y="13" width="17" height="7" rx="1.8"/><path d="M7.5 7.5h.01M7.5 16.5h.01"/>',
  globe:'<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.6 5.2 3.6 8.5s-1 6.1-3.6 8.5c-2.6-2.4-3.6-5.2-3.6-8.5s1-6.1 3.6-8.5z"/>',
  desktop:'<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16v4"/>',
  chip:'<rect x="7" y="7" width="10" height="10" rx="1.6"/><path d="M10 3.5V7M14 3.5V7M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5"/>',
  layers:'<path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M3.5 12.5l8.5 4.5 8.5-4.5"/><path d="M3.5 16.5l8.5 4.5 8.5-4.5"/>',
  cube:'<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  vm:'<rect x="3" y="4" width="18" height="13" rx="2"/><rect x="7" y="8" width="10" height="5" rx="1"/><path d="M8.5 20.5h7"/>',
  fleet:'<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  info:'<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  pin:'<path d="M9 3.5h6l-1 5 3 3v1.5H7V11.5l3-3z"/><path d="M12 13v7.5"/>',
  x:'<path d="M6 6l12 12M18 6L6 18"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  key:'<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L19 4M15.5 7.5l2.5 2.5M18 5l2 2"/>',
  lock:'<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  wifi:'<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 16a4.8 4.8 0 0 1 6.4 0"/><path d="M12 19.5h.01"/>',
  power:'<path d="M12 3.5v8"/><path d="M6.3 7a8 8 0 1 0 11.4 0"/>',
  search2:'<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5M8.5 11h5"/>',
  refresh:'<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4.5V11h-6.5"/>',
  check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  upload:'<path d="M12 15V4.5M7.5 9L12 4.5 16.5 9"/><path d="M5 14.5v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>',
  palette:'<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8h2.1a3.8 3.8 0 0 0 3.8-3.8C20.5 6.9 16.7 3.5 12 3.5z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/>',
  trash:'<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12.5a2 2 0 0 0 2 1.8h5a2 2 0 0 0 2-1.8l1-12.5M9.5 7V4.5h5V7"/>',
  search:'<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  grip:'<circle cx="9" cy="6.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="6.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="17.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="17.5" r="1.3" fill="currentColor" stroke="none"/>',
  panelright:'<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M14.5 4.5v15"/><path d="M16.8 9h1.7M16.8 12h1.7"/>',
  net:'<circle cx="12" cy="5.5" r="2.5"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/><path d="M12 8v4M12 12l-5 4.5M12 12l5 4.5"/>',
  nic:'<rect x="3" y="7" width="18" height="10" rx="1.5"/><path d="M7 17v2.5M11 17v2.5M15 17v2.5M7 10.5h4"/>',
  bridge:'<path d="M3 15c4-6 14-6 18 0"/><path d="M3 15v4M21 15v4M8 11.5V19M16 11.5V19M12 10.5V19"/>'
};
const icon = (k, sw) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw||1.8}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k] || IC.cube}</svg>`;

/* ---------- formatting ---------- */
function num(v){ if (!isFinite(v)) return '—'; if (v >= 100) return Math.round(v).toString(); if (v >= 10) return v.toFixed(0); if (v >= 1) return v.toFixed(1); if (v === 0) return '0'; return v.toFixed(2); }
function fmt(v, m){ return m === 'gpu' ? num(v) + '%' : num(v) + ' ' + UNIT[m]; }
function capText(c, m){ return m === 'gpu' ? (c / 100) + (c > 100 ? ' GPUs' : ' GPU') : fmt(c, m); }
function pct(p){ if (!isFinite(p)) return '—'; if (p >= 10) return Math.round(p) + '%'; if (p >= .1) return p.toFixed(1) + '%'; if (p > 0) return '<0.1%'; return '0%'; }
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mlabel = id => (METRICS.find(m => m.id === id) || {label:id}).label;
function niceMax(v){ if (!(v > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
function memText(gb){ return gb >= 1 ? gb.toFixed(gb >= 10 ? 0 : 1) + ' GB' : Math.round(gb * 1024) + ' MB'; }
function rateText(mbs){ return mbs >= 1 ? num(mbs) + ' MB/s' : mbs * 1000 >= 1 ? Math.round(mbs * 1000) + ' KB/s' : mbs > 0 ? '<1 KB/s' : '0'; }
function ago(s){ return s >= 120 ? Math.round(s / 60) + ' min ago' : Math.round(s) + ' s ago'; }

/* ---------- state ---------- */
const S = {space:'fleet', sel:'fleet', metric:'cpu', view:'overview', mode:'cap', open:{}, tree:'machines', netSel:'net:tailnet',
           cpuView:'type', sort:{k:'cpu', dir:-1}, group:'none', filter:'', hover:null, mx:0, my:0};
try { Object.assign(S, JSON.parse(localStorage.getItem('fleet-live-ui') || '{}'), {hover:null}); } catch (e) {}
if (S.tree === 'pins'){ S.tree = 'machines'; S.pinsOnly = true; }  // pins-only used to be a tab
function save(){ try { const {hover, mx, my, ...keep} = S; localStorage.setItem('fleet-live-ui', JSON.stringify(keep)); } catch (e) {} }

/* ---------- model ---------- */
let DATA = null, PINS = [], WINDOW = 180, INTERVAL = 3, NET = null;
const nodes = {}, roots = [];
const zero = () => new Array(H).fill(0);
function mk(id, p){ const n = Object.assign({id, children:[], parent:null}, p); nodes[id] = n; return n; }
function attach(parent, child){ child.parent = parent; parent.children.push(child); return child; }
function histOf(h){ const o = {}; METRICS.forEach(m => { o[m.id] = (h && h[m.id] && h[m.id].length === H) ? h[m.id] : zero(); }); return o; }
function leaf(id, name, type, kind, h, meta){ const n = mk(id, {name, type, kind, meta: meta || {}}); n.hist = histOf(h); n.u = METRICS.map(m => n.hist[m.id][H-1]); return n; }

function machineFrom(s, isVm){
  const gpus = (s.gpus || []).map((g, i) => Object.assign({key:'gpu' + i}, g));
  const cap = (s.cap || [1,1,0,1,1]).slice(); cap[MI.gpu] = 100 * gpus.length;
  const m = mk(s.id, {name:s.name, kind:'machine', type:isVm ? 'vm' : 'machine', cap, gpus, gmap:Object.fromEntries(gpus.map(g => [g.key, g.host || null])),
    os:s.os || '', tile:s.tile || 'vm', agent:s.agent || '', uptime:s.uptime || '', note:s.note, status:s.status || 'ok', error:s.error || '',
    cronLabel:s.cronLabel || 'Cron jobs', cpu_model:s.cpu_model || '', ncpu:s.ncpu || cap[0], groups:s.groups || [], hostside:s.hostside,
    ssh:s.ssh || '', hasData:s.has_data !== false || s.status === 'hostonly', lastOk:s.last_ok || 0});
  const gks = g => (g || []).filter(k => gpus.some(x => x.key === k));
  const b = attach(m, leaf(s.base.id, 'Base system', 'base', 'base', s.base.h));
  b.gk = gks(s.base.g);
  addCron(b, s.baseCron, m.cronLabel);
  if (s.compose && s.compose.length){
    const g = attach(m, mk(s.id + '/compose', {name:'Docker Compose', kind:'group', type:'compose'}));
    s.compose.forEach(p => {
      const pj = attach(g, mk(p.id, {name:p.name, kind:'project', type:'compose', meta:{file:p.file}}));
      p.services.forEach(v => { const n = attach(pj, leaf(v.id, v.name, 'compose', 'service', v.h, {image:v.image, status:v.status, project:p.name})); n.gk = gks(v.g); });
    });
  }
  if (s.containers && s.containers.length){
    const g = attach(m, mk(s.id + '/containers', {name:'Containers', kind:'group', type:'container'}));
    s.containers.forEach(c => { const n = attach(g, leaf(c.id, c.name, 'container', 'container', c.h, {image:c.image, status:c.status})); n.gk = gks(c.g); });
  }
  if (s.vms && s.vms.length){
    const g = attach(m, mk(s.id + '/vms', {name:'VMs', kind:'group', type:'vm'}));
    s.vms.forEach(v => attach(g, machineFrom(v, true)));
  }
  return m;
}
function addCron(owner, list, label){
  if (!list || !list.length) return;
  const f = attach(owner, mk(owner.id + '/cron', {name:label || 'Cron jobs', kind:'cronfolder', type:owner.type}));
  list.forEach(j => { const n = attach(f, leaf(j.id, j.name, owner.type, 'cron', j.h, {})); n.kind = 'cron'; n.job = j; n.running = !!j.running; n.gk = j.g && j.g.length ? j.g : owner.gk; });
}
function sumSeries(list){ const o = {}; METRICS.forEach(m => { const a = zero(); list.forEach(c => { const s = c.series[m.id]; for (let i = 0; i < H; i++) a[i] += s[i]; }); o[m.id] = a; }); return o; }
function splitG(series, keys){ const o = {}; (keys || []).forEach(k => { o[k] = series.map(v => v / keys.length); }); return o; }
function addG(t, src, map){ for (const k in src){ const kk = map ? map[k] : k; if (kk == null) continue; const a = t[kk] || (t[kk] = zero()), s = src[k]; for (let i = 0; i < H; i++) a[i] += s[i]; } return t; }
function compute(n){
  n.children.forEach(compute);
  if (n.kind === 'cron'){ n.series = n.hist; n.gseries = splitG(n.hist.gpu, n.gk); return; }
  if (n.kind === 'cronfolder'){ n.series = sumSeries(n.children); n.gseries = n.children.reduce((t, c) => addG(t, c.gseries), {}); return; }
  if (n.hist){
    const f = n.children.find(c => c.kind === 'cronfolder');
    n.series = {}; METRICS.forEach(m => { n.series[m.id] = n.hist[m.id].map((v, i) => v + (f ? f.series[m.id][i] : 0)); });
    n.gseries = splitG(n.hist.gpu, n.gk); if (f) addG(n.gseries, f.gseries);
    return;
  }
  n.series = sumSeries(n.children);
  n.gseries = n.children.reduce((t, c) => addG(t, c.gseries, c.kind === 'machine' && c.parent ? c.gmap : null), {});
}
function build(d){
  for (const k in nodes) delete nodes[k];
  roots.length = 0;
  d.machines.forEach(s => roots.push(machineFrom(s, false)));
  roots.forEach(compute);
}

const cur = (n, m) => n.series[m][H-1];
const capOf = (m, metric) => m.cap[MI[metric]];
const sumv = o => Object.values(o).reduce((a, b) => a + b, 0);
function hostOf(n){ let p = n.kind === 'machine' ? n.parent : n; while (p && p.kind !== 'machine') p = p.parent; return p || n; }
function machineOf(n){ let p = n; while (p && p.kind !== 'machine') p = p.parent; return p; }
function rootOf(n){ while (n.parent) n = n.parent; return n; }
function ownerOf(n){ return n.kind === 'cron' ? n.parent.parent : n.kind === 'cronfolder' ? n.parent : null; }
function within(n, id){ for (let p = n; p; p = p.parent) if (p.id === id) return true; return false; }
function byType(m, metric, i){ const o = {base:0, compose:0, container:0, vm:0}; m.children.forEach(c => { o[c.type] += i == null ? cur(c, metric) : c.series[metric][i]; }); return o; }
function ctxOf(key){
  if (key === 'fleet') return {name:'All machines',
    bt:(metric, i) => { const o = {base:0, compose:0, container:0, vm:0}; roots.forEach(r => { const b = byType(r, metric, i); for (const k in o) o[k] += b[k]; }); return o; },
    cap:metric => roots.filter(r => hasData(r)).reduce((s, r) => s + capOf(r, metric), 0)};
  const m = nodes[key];
  return {name:m.name, bt:(metric, i) => byType(m, metric, i), cap:metric => capOf(m, metric)};
}
function cronCount(n){ let c = 0; (function v(x){ if (x.kind === 'cron') c++; x.children.forEach(v); })(n); return c; }
function shareOfHost(n, metric){ return cur(n, metric) / capOf(hostOf(n), metric) * 100; }

/* which GPU */
function gpuBt(m, key, i){ const o = {base:0, compose:0, container:0, vm:0}; m.children.forEach(c => { const s = c.gseries[key]; if (s) o[c.type] += i == null ? s[H-1] : s[i]; }); return o; }
function keysUsed(n){
  if (n.kind === 'cron') return (n.u[MI.gpu] > 0 || Math.max(...n.hist.gpu) > 0) ? (n.gk || []) : [];
  const map = n.kind === 'machine' && n.parent ? n.gmap : null, out = [];
  for (const k in n.gseries){ if (Math.max(...n.gseries[k]) <= 0) continue; const kk = map ? map[k] : k; if (kk != null && !out.includes(kk)) out.push(kk); }
  return out;
}
function gpuIdxs(n){ const host = hostOf(n); return keysUsed(n).map(k => host.gpus.findIndex(g => g.key === k)).filter(i => i >= 0).sort((a, b) => a - b); }
function whichGpu(n){ const ix = gpuIdxs(n); return ix.length ? 'GPU' + ix.join('+') : ''; }
function whichGpuLong(n){ const host = hostOf(n), ix = gpuIdxs(n); return ix.map(i => `GPU ${i} (${host.gpus[i].name})`).join(' + '); }
function gpuConsumers(m, key){
  const out = [];
  (function v(n){ n.children.forEach(c => {
    if (c.kind === 'machine'){ const ks = Object.keys(c.gseries).filter(k => c.gmap[k] === key); if (ks.length) out.push({n:c, v:ks.reduce((s, k) => s + c.gseries[k][H-1], 0)}); return; }
    if (c.hist){ const s = c.gseries[key]; if (s && Math.max(...s) > 0) out.push({n:c, v:s[H-1]}); return; }
    v(c);
  }); })(m);
  return out.sort((a, b) => b.v - a.v);
}
function gpuSub(n){ const host = hostOf(n); if (!host.gpus.length) return 'host has no GPU'; const w = whichGpuLong(n); return w ? 'on ' + esc(w) : 'not using a GPU'; }
function gpuCell(n){ const w = whichGpu(n); return fmt(cur(n, 'gpu'), 'gpu') + (w ? ` <span class="gtag">${w}</span>` : ''); }

/* ---------- small renderers ---------- */
const $ = id => document.getElementById(id);
function colOf(n){ return TCOL[n.type] || 'var(--ink-2)'; }
function iconOf(n){
  if (n.kind === 'machine') return n.tile || 'vm';
  if (n.kind === 'cronfolder' || n.kind === 'cron') return 'clock';
  if (n.kind === 'base') return 'chip';
  if (n.type === 'compose' && n.kind !== 'service') return 'layers';
  if (n.type === 'vm') return 'vm';
  return 'cube';
}
function sparkPts(data, w, h){ const max = Math.max(...data) * 1.15 || 1; return data.map((v, i) => `${(i/(H-1)*w).toFixed(2)},${(h - v/max*h).toFixed(2)}`).join(' '); }
// A machine with data keeps showing it while it reconnects ("stale"); only a machine that never
// reported gets the offline card. Status changes never swap the layout.
function isLive(n){ return n.status === 'ok'; }
function hasData(n){ return n.kind !== 'machine' || n.hasData || n.status === 'ok' || n.status === 'hostonly'; }
function isStale(n){ return n.kind === 'machine' && n.status !== 'ok' && n.status !== 'hostonly' && n.hasData; }
function staleFor(n){ return n.lastOk ? Math.max(0, Date.now() / 1000 - n.lastOk) : 0; }
function statusClass(n){ return isLive(n) ? 'ok' : n.status === 'hostonly' ? 'hostonly' : isStale(n) ? 'stale' : n.status === 'off' ? 'off' : n.status === 'connecting' ? 'connecting' : 'offline'; }
function statusText(n){ return n.status === 'ok' ? 'live' : n.status === 'off' ? 'off' : n.status === 'hostonly' ? 'seen from host' : isStale(n) ? 'reconnecting' : n.status === 'connecting' ? 'connecting' : 'offline'; }
function pinBtn(id){ const on = PINS.includes(id); return `<button type="button" class="pinbtn${on ? ' on' : ''}" data-pin="${esc(id)}" aria-pressed="${on}" aria-label="${on ? 'Unpin' : 'Pin'} ${esc(nodes[id] ? nodes[id].name : id)} as a space" title="${on ? 'Unpin from the space bar' : 'Pin to the space bar'}">${icon('pin')}</button>`; }

/* ---------- spaces (All machines + pins) ---------- */
function pillPct(key){
  if (key === 'fleet'){ const c = ctxOf('fleet'); return pct(sumv(c.bt(S.metric)) / c.cap(S.metric) * 100); }
  const n = nodes[key]; if (!n) return '';
  if (n.kind === 'machine' && !hasData(n)) return statusText(n);
  return pct(n.kind === 'machine' && !n.parent ? cur(n, S.metric) / capOf(n, S.metric) * 100 : shareOfHost(n, S.metric));
}
function miniBar(key){
  const n = key === 'fleet' ? null : nodes[key];
  if (n && n.kind !== 'machine') return `<i style="width:${Math.min(100, shareOfHost(n, S.metric)).toFixed(1)}%;background:${colOf(n)}"></i>`;
  const c = ctxOf(key), bt = c.bt(S.metric), cap = c.cap(S.metric);
  if (!cap) return '';
  return TYPES.map(t => `<i style="width:${(bt[t.id]/cap*100).toFixed(2)}%;background:${TCOL[t.id]}"></i>`).join('');
}
function renderSpaces(){
  const pills = [{key:'fleet', name:'All machines', tile:'fleet'}].concat(PINS.map(id => {
    const n = nodes[id];
    return n ? {key:id, name:n.name, tile:n.kind === 'machine' ? n.tile : iconOf(n), tcol:n.kind === 'machine' ? '' : colOf(n), pinned:true, sub:n.kind === 'machine' ? '' : rootOf(n).name}
             : {key:id, name:id.split('/').pop(), tile:'cube', pinned:true, gone:true};
  }));
  $('spaces').innerHTML = pills.map(p => `<div class="space${S.space===p.key?' active':''}${p.pinned?' pinned':''}${p.gone?' gone':''}" title="${esc(p.name)}${p.sub ? ' · on ' + esc(p.sub) : ''}${p.gone ? ' · not seen right now' : ''}">`
    + `<button type="button" data-space="${esc(p.key)}" aria-pressed="${S.space===p.key}" style="display:flex;align-items:center;gap:10px;min-width:0;height:100%">`
    + `<span class="tile ${p.tcol ? '' : p.tile}" ${p.tcol ? `style="background:color-mix(in srgb, ${p.tcol} 22%, transparent);color:${p.tcol}"` : ''}>${icon(p.tile)}</span><span class="nm">${esc(p.name)}</span>`
    + `<span class="mini" data-mini="${esc(p.key)}" aria-hidden="true">${p.gone ? '' : miniBar(p.key)}</span><span class="pc" data-pc="${esc(p.key)}">${p.gone ? 'gone' : pillPct(p.key)}</span></button>`
    + (p.pinned ? `<button type="button" class="unpin" data-unpin="${esc(p.key)}" aria-label="Unpin ${esc(p.name)}" title="Unpin">${icon('x', 2.4)}</button>` : '') + `</div>`).join('')
    + `<button type="button" class="addpin" data-addpin="1" aria-haspopup="dialog" aria-expanded="${PICK.open}" aria-label="Pin a grouping to the space bar" title="Pin a grouping">${icon('plus', 2)}</button>`;
}

/* ---------- + picker: pin any grouping ---------- */
const PICK = {open:false, q:''};
function kindLabel(n){
  if (n.kind === 'machine') return n.parent ? 'VM' : 'machine';
  if (n.kind === 'group') return 'group';
  if (n.kind === 'project') return 'Compose project';
  if (n.kind === 'service') return 'service';
  if (n.kind === 'base') return 'Base system';
  return n.kind;
}
function pickCandidates(){
  const out = [];
  (function w(list, d, path){ list.forEach(n => {
    if (n.kind === 'cron' || n.kind === 'cronfolder') return;
    out.push({n, d, path});
    w(orderedKids(n), d + 1, path.concat(n.name));
  }); })(sortedRoots(), 0, []);
  return out;
}
function renderPickerList(){
  const box = $('picklist'); if (!box) return;
  const a = document.activeElement, refocus = a && box.contains(a) && a.dataset ? a.dataset.pin : null;
  const q = PICK.q.trim().toLowerCase();
  let list = pickCandidates();
  if (q) list = list.filter(x => [x.n.name, kindLabel(x.n), x.n.os || '', (x.n.meta && x.n.meta.image) || '', x.path.join(' ')].join(' ').toLowerCase().includes(q));
  const shown = list.slice(0, 400);
  box.innerHTML = shown.length ? shown.map(({n, d, path}) => {
    const on = PINS.includes(n.id);
    const where = q && path.length ? `<span class="pw">${esc(path.join(' › '))}</span>` : '';
    return `<button type="button" class="prow${on ? ' on' : ''}" data-pin="${esc(n.id)}" aria-pressed="${on}" style="padding-left:${10 + (q ? 0 : d * 16)}px">`
      + `<span class="ico" style="color:${n.kind === 'machine' ? 'var(--ink-2)' : colOf(n)}">${icon(iconOf(n))}</span>`
      + `<span class="pn"><span>${esc(n.name)}</span>${where}</span><span class="pk">${esc(kindLabel(n))}${n.children.length && n.kind !== 'base' ? ' · ' + n.children.length : ''}</span>`
      + `<span class="pp">${icon('pin')}${on ? 'Pinned' : 'Pin'}</span></button>`;
  }).join('') + (list.length > shown.length ? `<div class="more">${list.length - shown.length} more; type to narrow it down.</div>` : '')
    : `<div class="more">Nothing matches “${esc(PICK.q)}”.</div>`;
  if (refocus){ const e = box.querySelector(`[data-pin="${CSS.escape(refocus)}"]`); if (e) e.focus({preventScroll:true}); }
}
function openPicker(){
  PICK.open = true;
  const p = $('picker'), btn = document.querySelector('[data-addpin]');
  p.innerHTML = `<div class="pick-h">${icon('search')}<input type="search" id="pickq" placeholder="Search machines, VMs, projects, containers…" value="${esc(PICK.q)}" aria-label="Search groupings" autocomplete="off"></div><div class="picklist" id="picklist" role="list"></div><div class="pick-f">Pinned groupings appear in the space bar. <b>All machines</b> is always there.</div>`;
  p.hidden = false;
  const r = btn ? btn.getBoundingClientRect() : {left:16, bottom:56};
  const w = Math.min(420, innerWidth - 24);
  p.style.width = w + 'px';
  p.style.left = Math.max(12, Math.min(r.left, innerWidth - w - 12)) + 'px';
  p.style.top = (r.bottom + 8) + 'px';
  renderPickerList();
  if (btn) btn.setAttribute('aria-expanded', 'true');
  $('pickq').focus();
}
function closePicker(refocus){
  if (!PICK.open) return;
  PICK.open = false;
  $('picker').hidden = true;
  const btn = document.querySelector('[data-addpin]');
  if (btn){ btn.setAttribute('aria-expanded', 'false'); if (refocus) btn.focus(); }
}
function updateSpaces(){
  document.querySelectorAll('[data-mini]').forEach(e => { if (e.dataset.mini === 'fleet' || nodes[e.dataset.mini]) e.innerHTML = miniBar(e.dataset.mini); });
  document.querySelectorAll('[data-pc]').forEach(e => { if (e.dataset.pc === 'fleet' || nodes[e.dataset.pc]) e.textContent = pillPct(e.dataset.pc); });
}

/* ---------- toolbar ---------- */
function renderToolbar(){
  let crumbs;
  if (S.tree === 'network') crumbs = `<button type="button" data-space="fleet">All machines</button><span class="sep" aria-hidden="true">/</span><span class="cur">Network</span>`;
  else if (S.sel === 'fleet' || !nodes[S.sel]) crumbs = `<span class="cur">All machines</span>`;
  else {
    const path = []; for (let n = nodes[S.sel]; n; n = n.parent) path.unshift(n);
    crumbs = `<button type="button" data-space="fleet">All machines</button>` + path.map((n, i) => `<span class="sep" aria-hidden="true">/</span>` + (i === path.length - 1 ? `<span class="cur">${esc(n.name)}</span>` : `<button type="button" data-select="${esc(n.id)}">${esc(n.name)}</button>`)).join('');
  }
  $('crumbs').innerHTML = crumbs;
  $('metrics').innerHTML = METRICS.map(m => `<button type="button" data-metric="${m.id}" aria-pressed="${S.view === 'overview' && S.metric===m.id}">${m.label}</button>`).join('');
  document.querySelectorAll('[data-tree]').forEach(b => b.setAttribute('aria-pressed', String(S.tree === b.dataset.tree)));
}

/* ---------- machine tree ---------- */
function isOpen(n){
  if (S.open[n.id] !== undefined) return S.open[n.id];
  if (n.kind === 'machine') return S.space !== 'fleet' || !n.parent;
  return n.kind === 'group' && n.type === 'vm';
}
function rowVal(n){
  if (n.kind === 'machine' && !hasData(n)) return statusText(n);
  return pct(n.kind === 'machine' && !n.parent ? cur(n, S.metric) / capOf(n, S.metric) * 100 : shareOfHost(n, S.metric));
}
// Tree order: alphabetical (case-insensitive, natural numbers), pinned items first.
// A machine's own groups (Base system, Compose, Containers, VMs) keep their fixed order.
const COLL = new Intl.Collator(undefined, {numeric:true, sensitivity:'base'});
function cmpNodes(a, b){ const pa = PINS.includes(a.id), pb = PINS.includes(b.id); if (pa !== pb) return pa ? -1 : 1; return COLL.compare(a.name, b.name); }
function orderedKids(n){ return n.kind === 'machine' ? n.children : n.children.slice().sort(cmpNodes); }
function sortedRoots(){ return roots.slice().sort(cmpNodes); }
function treeRoots(){
  if (S.pinsOnly) return PINS.map(id => nodes[id]).filter(Boolean).sort((a, b) => COLL.compare(a.name, b.name));
  return S.space === 'fleet' ? sortedRoots() : (nodes[S.space] ? [nodes[S.space]] : sortedRoots());
}
function renderTree(){
  if (S.tree === 'network') return renderNetTree();
  const rows = [];
  (function walkRows(list, d){ list.forEach(n => { rows.push({n, d}); if (n.children.length && isOpen(n)) walkRows(orderedKids(n), d + 1); }); })(treeRoots(), 0);
  $('tree').innerHTML = rows.map(({n, d}) => {
    const kids = n.children.length > 0, open = kids && isOpen(n);
    const count = (n.kind === 'group' || n.kind === 'cronfolder' || n.kind === 'project') ? `<span class="count">${n.children.length}</span>` : '';
    const dot = n.kind === 'cron' ? `<i class="dot${n.running?' on':''}" data-dot="${esc(n.id)}" title="running now"></i>` : n.kind === 'machine' ? `<i class="sdot ${statusClass(n)}" data-sdot="${esc(n.id)}" title="${statusText(n)}"></i>` : '';
    const gw = S.metric === 'gpu' && n.parent && hostOf(n).gpus.length > 1 ? whichGpu(n) : '';
    const gtag = gw ? `<span class="gtag" title="${esc(whichGpuLong(n))}">${gw}</span>` : '';
    const st = n.kind === 'machine' ? ' ' + statusClass(n) : '';
    const pin = (n.kind === 'machine' || n.kind === 'project' || n.kind === 'service' || n.kind === 'container' || n.kind === 'group') ? pinBtn(n.id) : '<span style="width:22px;flex:none"></span>';
    return `<div class="row ${n.kind}${st}${S.sel===n.id?' sel':''}" style="--d:${d}" role="treeitem" aria-level="${d+1}" ${kids?`aria-expanded="${open}"`:''} aria-selected="${S.sel===n.id}" data-select="${esc(n.id)}">`
      + `<button type="button" class="chev${open?' open':''}${kids?'':' leaf'}" ${kids?`data-toggle="${esc(n.id)}" aria-label="${open?'Collapse':'Expand'} ${esc(n.name)}"`:'tabindex="-1" aria-hidden="true"'}>${icon('chev', 2.4)}</button>`
      + `<span class="ico" style="color:${n.kind==='cronfolder'||n.kind==='cron'?'var(--ink-3)':colOf(n)}">${icon(iconOf(n))}</span>`
      + `<button type="button" class="nm" data-select="${esc(n.id)}">${esc(n.name)}</button>${count}${gtag}${dot}${pin}`
      + `<svg class="spark" data-spark="${esc(n.id)}" viewBox="0 0 60 16" preserveAspectRatio="none" aria-hidden="true"><polyline points="${sparkPts(n.series[S.metric], 60, 16)}" fill="none" stroke="${n.kind==='machine'&&!n.parent?'var(--accent)':colOf(n)}" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`
      + `<span class="val${n.kind === 'machine' && !isLive(n) ? ' dim' : ''}" data-val="${esc(n.id)}" title="share of host ${mlabel(S.metric)}">${rowVal(n)}</span></div>`;
  }).join('');
  if (S.pinsOnly && !rows.length) $('tree').innerHTML = `<div class="empty-pins">${icon('pin')}<b>Nothing pinned yet</b><span>Pin a machine, VM, project or container with the pin on its row, or with <b>+</b> in the top bar.</span></div>`;
  const scope = S.space === 'fleet' ? 'All machines' : (nodes[S.space] ? nodes[S.space].name : 'All machines');
  $('tree-title').innerHTML = `<span class="scopeseg" role="group" aria-label="Show"><button type="button" data-pinsonly="0" aria-pressed="${!S.pinsOnly}">${esc(scope)}</button><button type="button" data-pinsonly="1" aria-pressed="${!!S.pinsOnly}">Pins only</button></span>`;
  $('tree-col').textContent = '% of host · ' + mlabel(S.metric);
  $('side-note').innerHTML = '';
}
function updateTree(){
  if (S.tree === 'network') return renderNetTree();
  document.querySelectorAll('[data-val]').forEach(e => { const n = nodes[e.dataset.val]; if (n) e.textContent = rowVal(n); });
  document.querySelectorAll('[data-spark]').forEach(e => { const n = nodes[e.dataset.spark]; if (n) e.firstElementChild.setAttribute('points', sparkPts(n.series[S.metric], 60, 16)); });
  document.querySelectorAll('[data-dot]').forEach(e => { const n = nodes[e.dataset.dot]; if (n) e.classList.toggle('on', !!n.running); });
  document.querySelectorAll('[data-sdot]').forEach(e => { const n = nodes[e.dataset.sdot]; if (n){ e.className = 'sdot ' + statusClass(n); e.title = statusText(n); } });
  document.querySelectorAll('[data-val]').forEach(e => { const n = nodes[e.dataset.val]; if (n && n.kind === 'machine') e.classList.toggle('dim', !isLive(n)); });
}

/* ---------- network tree ---------- */
let netNodes = {};
function buildNet(){
  netNodes = {};
  if (!NET) return [];
  const mkn = (id, p) => (netNodes[id] = Object.assign({id, children:[]}, p));
  const root = mkn('net:tailnet', {name:NET.tailnet, kind:'tailnet', rx:0, tx:0});
  NET.machines.forEach(m => {
    const ts = m.tailscale || {};
    const mn = mkn('net:m:' + m.id, {name:m.name, kind:'nmachine', status:m.status, error:m.error, ts, vm_on:m.vm_on, rx:0, tx:0, mid:m.id});
    root.children.push(mn);
    const ifs = (m.ifs || []).filter(x => x.kind !== 'loopback' && !/^veth/.test(x.name));
    const vmByIf = {}; (m.vms || []).forEach(v => (v.ifs || []).forEach(i => { vmByIf[i.if] = v.name; }));
    const nets = {}; (m.dockernets || []).forEach(n => { nets[n.name === 'bridge' ? 'docker0' : 'br-' + n.id] = n.name; });
    const ifn = {};
    ifs.forEach(x => { ifn[x.name] = mkn('net:if:' + m.id + ':' + x.name, {name:x.name, kind:'if', ifkind:x.kind, rx:x.rx, tx:x.tx, hrx:x.hrx, htx:x.htx, addrs:x.addrs || [], state:x.state, speed:x.speed, desc:x.desc || '', master:x.master, vm:vmByIf[x.name] || '', dnet:nets[x.name] || ''}); });
    ifs.forEach(x => {
      const n = ifn[x.name];
      if (x.master && ifn[x.master]) ifn[x.master].children.push(n); else mn.children.push(n);
      if (n.ifkind === 'physical'){ mn.rx += n.rx; mn.tx += n.tx; }
    });
    Object.values(ifn).forEach(n => {
      if (!n.dnet) return;
      (m.containers || []).filter(c => (c.networks || '').split(',').includes(n.dnet)).forEach(c => {
        n.children.push(mkn('net:c:' + m.id + ':' + c.name, {name:c.name, kind:'ncontainer', rx:c.net, tx:0, dnet:n.dnet}));
      });
    });
    mn.children.sort((a, b) => COLL.compare(a.name, b.name));
    Object.values(ifn).forEach(x => x.children.sort((a, b) => COLL.compare(a.name, b.name)));
    root.rx += mn.rx; root.tx += mn.tx;
  });
  root.children.sort((a, b) => COLL.compare(a.name, b.name));
  return [root];
}
function netOpen(n){ return S.open[n.id] !== undefined ? S.open[n.id] : (n.kind === 'tailnet' || (n.kind === 'nmachine' && n.status === 'ok' && n.children.length < 12)); }
function renderNetTree(){
  const rootsN = buildNet();
  const rows = [];
  (function w(list, d){ list.forEach(n => { rows.push({n, d}); if (n.children.length && netOpen(n)) w(n.children, d + 1); }); })(rootsN, 0);
  $('tree').innerHTML = rows.length ? rows.map(({n, d}) => {
    const kids = n.children.length > 0, open = kids && netOpen(n);
    const ic = n.kind === 'tailnet' ? 'net' : n.kind === 'nmachine' ? 'desktop' : n.kind === 'ncontainer' ? 'cube' : n.ifkind === 'bridge' ? 'bridge' : n.vm ? 'vm' : 'nic';
    const sub = n.kind === 'nmachine' ? `<i class="sdot ${n.status}" title="${esc(n.status)}"></i>` : n.vm ? `<span class="count">${esc(n.vm)}</span>` : n.dnet && n.kind === 'if' ? `<span class="count">${esc(n.dnet)}</span>` : '';
    const rate = `<span>↓ ${rateText(n.rx)}</span><span>↑ ${n.kind === 'ncontainer' ? '—' : rateText(n.tx)}</span>`;
    return `<div class="row${S.netSel===n.id?' sel':''}" style="--d:${d}" role="treeitem" aria-level="${d+1}" ${kids?`aria-expanded="${open}"`:''} data-netsel="${esc(n.id)}">`
      + `<button type="button" class="chev${open?' open':''}${kids?'':' leaf'}" ${kids?`data-toggle="${esc(n.id)}" aria-label="${open?'Collapse':'Expand'} ${esc(n.name)}"`:'tabindex="-1" aria-hidden="true"'}>${icon('chev', 2.4)}</button>`
      + `<span class="ico" style="color:var(--ink-2)">${icon(ic)}</span><button type="button" class="nm" data-netsel="${esc(n.id)}">${esc(n.name)}</button>${sub}<span class="nrate">${rate}</span></div>`;
  }).join('') : '<div class="side-note">Loading the network…</div>';
  $('tree-title').innerHTML = 'Network';
  $('tree-col').textContent = '↓ in · ↑ out';
  $('side-note').innerHTML = '';
}

function renderAll(){ renderSpaces(); renderToolbar(); renderTree(); }

/* ---------- actions ---------- */
async function api(path, body){
  const r = await fetch(path, {method:'POST', headers:{'Content-Type':'application/json', 'X-Fleet':'1'}, body:JSON.stringify(body)});
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function setPins(pins){
  PINS = pins;
  renderSpaces(); renderTree(); renderPickerList();
  try { const d = await api('/api/pins', pins); PINS = d.pins || pins; } catch (e) {}
  renderSpaces(); renderPickerList();
}
function togglePin(id){ setPins(PINS.includes(id) ? PINS.filter(x => x !== id) : PINS.concat([id])); }
function goSpace(id){ S.space = id; S.sel = id; if (S.tree === 'network') S.tree = 'machines'; save(); renderAll(); $('main').scrollTop = 0; refreshNow(); }
function select(id){
  if (id === 'fleet') return goSpace('fleet');
  const n = nodes[id]; if (!n) return;
  if (S.space !== 'fleet' && !(nodes[S.space] && within(n, S.space))) S.space = 'fleet';
  S.sel = id;
  if (S.tree === 'network') S.tree = 'machines';
  for (let p = n.parent; p; p = p.parent) S.open[p.id] = true;
  save(); renderAll(); refreshNow();
}
document.addEventListener('click', e => {
  const ap = e.target.closest('[data-addpin]'); if (ap){ PICK.open ? closePicker(false) : openPicker(); return; }
  if (PICK.open && !$('picker').contains(e.target)) closePicker(false);
  const up = e.target.closest('[data-unpin]'); if (up){ e.stopPropagation(); togglePin(up.dataset.unpin); if (S.space === up.dataset.unpin) goSpace('fleet'); return; }
  const pn = e.target.closest('[data-pin]'); if (pn){ e.stopPropagation(); togglePin(pn.dataset.pin); return; }
  const tg = e.target.closest('[data-toggle]');
  if (tg){ const id = tg.dataset.toggle; const n = nodes[id] || netNodes[id]; S.open[id] = !(nodes[id] ? isOpen(n) : netOpen(n)); save(); renderTree(); return; }
  const po = e.target.closest('[data-pinsonly]'); if (po){ S.pinsOnly = po.dataset.pinsonly === '1'; save(); renderTree(); return; }
  const tr = e.target.closest('[data-tree]'); if (tr){ S.tree = tr.dataset.tree; if (S.tree === 'network') S.view = 'overview'; save(); renderAll(); refreshNow(); return; }
  const ns = e.target.closest('[data-netsel]'); if (ns){ S.netSel = ns.dataset.netsel; S.tree = 'network'; save(); renderTree(); renderToolbar(); return; }
  const sp = e.target.closest('[data-space]'); if (sp){ goSpace(sp.dataset.space); return; }
  const se = e.target.closest('[data-select]'); if (se){ select(se.dataset.select); return; }
  const me = e.target.closest('[data-metric]'); if (me){ S.metric = me.dataset.metric; S.view = 'overview'; save(); renderAll(); refreshNow(); return; }
});
document.addEventListener('input', e => {
  if (e.target.id === 'pickq'){ PICK.q = e.target.value; renderPickerList(); }
});
$('picker').addEventListener('keydown', e => {
  if (e.key === 'Escape'){ e.preventDefault(); closePicker(true); }
  if (e.key === 'Enter' && e.target.id === 'pickq'){ const first = $('picklist').querySelector('[data-pin]'); if (first){ e.preventDefault(); togglePin(first.dataset.pin); } }
});

/* ---------- polling ---------- */
let lastSig = '', busy = false, fails = 0;
function sigOf(){ return Object.keys(nodes).join('|') + '#' + PINS.join('|'); }
async function refreshNow(){
  if (busy) return; busy = true;
  try {
    const r = await fetch('/api/fleet', {cache:'no-store'});
    DATA = await r.json();
    INTERVAL = DATA.interval || 3; WINDOW = DATA.window_s || INTERVAL * H; PINS = DATA.pins || [];
    build(DATA);
    if (S.sel !== 'fleet' && !nodes[S.sel]) { /* keep selection; it may come back */ }
    const jobs = [];
    if (S.tree === 'network') jobs.push(fetch('/api/net', {cache:'no-store'}).then(r => r.json()).then(d => { NET = d; }));
    await Promise.all(jobs.map(p => p.catch(() => null)));
    fails = 0; $('conn').hidden = true; $('live').hidden = false;
    const sig = sigOf();
    if (sig !== lastSig){ lastSig = sig; renderAll(); }
    else { updateSpaces(); updateTree(); }
  } catch (e) {
    fails++;
    if (fails >= 3){ $('conn').hidden = false; $('live').hidden = true; }  // a restart takes a second or two: don't flash
  } finally { busy = false; }
}
renderToolbar();
refreshNow();
setInterval(refreshNow, 2000);

/* ---------- reload the window when the app's own files change ---------- */
(function(){
  let sig = null;
  async function check(){
    try {
      const hs = await Promise.all(['/', '/app.js'].map(u => fetch(u, {method:'HEAD', cache:'no-store'}).then(r => (r.headers.get('last-modified') || '') + (r.headers.get('content-length') || ''))));
      const s = hs.join('|');
      if (sig !== null && s !== sig && !PICK.open){ save(); location.reload(); return; }
      sig = s;
    } catch (e) {}
  }
  setInterval(check, 1500); check();
})();
