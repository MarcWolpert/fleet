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
function save(){ try { const {hover, mx, my, ...keep} = S; localStorage.setItem('fleet-live-ui', JSON.stringify(keep)); } catch (e) {} }

/* ---------- model ---------- */
let DATA = null, PINS = [], WINDOW = 180, INTERVAL = 3;
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

// A machine with data keeps showing it while it reconnects ("stale"); only a machine that never
// reported gets the offline card. Status changes never swap the layout.
function isLive(n){ return n.status === 'ok'; }
function hasData(n){ return n.kind !== 'machine' || n.hasData || n.status === 'ok' || n.status === 'hostonly'; }
