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
  gfleet:'<path d="M2.5 17.5h8l-1.6 2.5H4.1z"/><path d="M13.5 17.5h8l-1.6 2.5h-4.8z"/><path d="M8 10.5h8l-1.6 2.5H9.6z"/><path d="M6.5 17.5v-3M17.5 17.5v-3M12 10.5V4.5l3.5 2-3.5 1.6"/>',
  gflotilla:'<path d="M3.5 13h7.5l-1.5 2.6H5z"/><path d="M13 13h7.5L19 15.6h-4.5z"/><path d="M7.2 13V9M16.8 13V9"/><path d="M3 19.5c1.5-1.1 3-1.1 4.5 0s3 1.1 4.5 0 3-1.1 4.5 0 3 1.1 4.5 0"/>',
  gdivision:'<rect x="3" y="12.5" width="7.5" height="7.5" rx="1.3"/><rect x="13.5" y="12.5" width="7.5" height="7.5" rx="1.3"/><rect x="8.25" y="3.5" width="7.5" height="7.5" rx="1.3"/>',
  gsection:'<circle cx="12" cy="12" r="5.6"/><path d="M12 9.2V12l2 1.3"/><path d="M5.5 4.5H3.5v15h2M18.5 4.5h2v15h-2"/>',
  gsquadron:'<path d="M12 3.5l3.4 6H8.6z"/><path d="M6 12.5l3.4 6H2.6z"/><path d="M18 12.5l3.4 6h-6.8z"/>',
  gtaskforce:'<path d="M12 3.5l2.5 5.1 5.6.8-4.1 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.8z"/>',
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
const icon = (k, sw) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw||1.8}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-icon="${IC[k] ? k : 'cube'}">${IC[k] || IC.cube}</svg>`;

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
function save(){ try { const {hover, mx, my, ...keep} = S; localStorage.setItem('fleet-live-ui', JSON.stringify(keep)); } catch (e) {} navRecord(); }

/* ---------- model ---------- */
let TPINS = {}, PREFS = {}, prefsBusy = false, prefsGen = 0;
// where you've been, for Back and Forward (see "Panels, find, back and forward")
const NAV = {stack:[], i:-1, applying:false};
const TF = {q:'', open:false}, FIND = {q:'', i:0, n:0};
let PANEL = null;
// where you've scrolled (#221): pending positions from before a reload of the page, restored once their panes are long enough
const KEEP = {pending:null, t:0};
try { const k = JSON.parse(sessionStorage.getItem('fleet-scroll') || 'null'); if (k && k.pos) Object.assign(KEEP, {pending:k, t:Date.now()}); } catch (e) {}   // the panel you're in: 'tree', 'main' or 'details'
// the process open in the Details drop-down (see "One process, up close")
const INSP = {mid:null, pid:0, name:'', order:null, gorder:null, data:null, good:null, acc:{}, samples:0, secs:0, looks:0, busy:false, cacheLooks:[]};
let DATA = null, PINS = [], WINDOW = 180, INTERVAL = 3, CPUS = {}, PROCS = {machine:null, list:[]}, NET = null, DISKS = {}, IFS = {};
const nodes = {}, roots = [];
const zero = () => new Array(H).fill(0);
function mk(id, p){ const n = Object.assign({id, children:[], parent:null}, p); nodes[id] = n; return n; }
function attach(parent, child){ child.parent = parent; parent.children.push(child); return child; }
function histOf(h){ const o = {}; METRICS.forEach(m => { o[m.id] = (h && h[m.id] && h[m.id].length === H) ? h[m.id] : zero(); }); return o; }
function leaf(id, name, type, kind, h, meta){ const n = mk(id, {name, type, kind, meta: meta || {}}); n.hist = histOf(h); n.u = METRICS.map(m => n.hist[m.id][H-1]); return n; }

function machineFrom(s, isVm){
  const gpus = (s.gpus || []).map((g, i) => Object.assign({key:'gpu' + i}, g));
  const cap = (s.cap || [1,1,0,1,1]).slice(); cap[MI.gpu] = 100 * gpus.length;
  const m = mk(s.id, {name:s.name, kind:'machine', type:isVm ? 'vm' : 'machine', cap, gpus,
    os:s.os || '', tile:s.tile || 'vm', agent:s.agent || '', uptime:s.uptime || '', note:s.note, status:s.status || 'ok', error:s.error || '',
    cronLabel:s.cronLabel || 'Cron jobs', cpu_model:s.cpu_model || '', ncpu:s.ncpu || cap[0], groups:s.groups || [],
    hostHist:s.hostside && !Array.isArray(s.hostside) ? histOf(s.hostside) : null,
    hostG:Object.fromEntries(Object.entries(s.hostside_gh || {}).filter(([, a]) => a && a.length === H)),
    ssh:s.ssh || '', hasData:s.has_data !== false || s.status === 'hostonly', lastOk:s.last_ok || 0, on:s.on !== false});
  // what a node measurably uses of each of this machine's GPUs (the server's gh: one history per GPU); without gh, the
  // GPU keys it names (g), over which its GPU use is split
  const ghOf = gh => gh ? Object.fromEntries(gpus.filter(g => gh[g.key] && gh[g.key].length === H).map(g => [g.key, gh[g.key]])) : null;
  const gks = g => (g || []).filter(k => gpus.some(x => x.key === k));
  const b = attach(m, leaf(s.base.id, 'Base system', 'base', 'base', s.base.h));
  b.gk = gks(s.base.g); b.gh = ghOf(s.base.gh);
  addCron(b, s.baseCron, m.cronLabel, ghOf);
  if (s.compose && s.compose.length){
    const g = attach(m, mk(s.id + '/compose', {name:'Docker Compose', kind:'group', type:'compose'}));
    s.compose.forEach(p => {
      const pj = attach(g, mk(p.id, {name:p.name, kind:'project', type:'compose', meta:{file:p.file}}));
      p.services.forEach(v => { const n = attach(pj, leaf(v.id, v.name, 'compose', 'service', v.h, {image:v.image, status:v.status, project:p.name})); n.gk = gks(v.g); n.gh = ghOf(v.gh); });
    });
  }
  if (s.containers && s.containers.length){
    const g = attach(m, mk(s.id + '/containers', {name:'Containers', kind:'group', type:'container'}));
    s.containers.forEach(c => { const n = attach(g, leaf(c.id, c.name, 'container', 'container', c.h, {image:c.image, status:c.status})); n.gk = gks(c.g); n.gh = ghOf(c.gh); });
  }
  if (s.vms && s.vms.length){
    const g = attach(m, mk(s.id + '/vms', {name:'VMs', kind:'group', type:'vm'}));
    s.vms.forEach(v => attach(g, machineFrom(v, true)));
  }
  return m;
}
function addCron(owner, list, label, ghOf){
  if (!list || !list.length) return;
  const f = attach(owner, mk(owner.id + '/cron', {name:label || 'Cron jobs', kind:'cronfolder', type:owner.type}));
  list.forEach(j => { const n = attach(f, leaf(j.id, j.name, owner.type, 'cron', j.h, {})); n.kind = 'cron'; n.job = j; n.running = !!j.running; n.gk = j.g && j.g.length ? j.g : owner.gk; n.gh = ghOf(j.gh); });
}
function sumSeries(list){ const o = {}; METRICS.forEach(m => { const a = zero(); list.forEach(c => { const s = c.series[m.id]; for (let i = 0; i < H; i++) a[i] += s[i]; }); o[m.id] = a; }); return o; }
function splitG(series, keys){ const o = {}; (keys || []).forEach(k => { o[k] = series.map(v => v / keys.length); }); return o; }
function perG(gh){ const o = {}; for (const k in gh) o[k] = gh[k] && gh[k].length === H ? gh[k].slice() : zero(); return o; }
function addG(t, src, map){ for (const k in src){ const kk = map ? map[k] : k; if (kk == null) continue; const a = t[kk] || (t[kk] = zero()), s = src[k]; for (let i = 0; i < H; i++) a[i] += s[i]; } return t; }
function compute(n){
  n.children.forEach(compute);
  if (n.kind === 'cron'){ n.series = n.hist; n.gseries = n.gh ? perG(n.gh) : splitG(n.hist.gpu, n.gk); return; }
  if (n.kind === 'cronfolder'){ n.series = sumSeries(n.children); n.gseries = n.children.reduce((t, c) => addG(t, c.gseries), {}); return; }
  if (n.hist){
    const f = n.children.find(c => c.kind === 'cronfolder');
    n.series = {}; METRICS.forEach(m => { n.series[m.id] = n.hist[m.id].map((v, i) => v + (f ? f.series[m.id][i] : 0)); });
    n.gseries = n.gh ? perG(n.gh) : splitG(n.hist.gpu, n.gk); if (f) addG(n.gseries, f.gseries);
    return;
  }
  n.series = sumSeries(n.children);
  n.gseries = n.children.reduce((t, c) => addG(t, c.gseries), {});
  // A VM Fleet reads over SSH: as a part of its host it costs what the host gives it (its QEMU process: CPU, memory,
  // disk and network as the host sees them; GPU as the guest sees it, since a passed-through GPU is invisible to the
  // host), and on each of the host's GPUs what the host measures it use there (hostG). What the guest itself reports
  // (its own page's figures, its own GPUs) stays in n.own and n.inside.
  if (n.kind === 'machine' && n.parent){
    n.inside = {series:n.series, gseries:n.gseries};
    if (n.hostHist){
      n.own = n.series;
      n.series = {}; METRICS.forEach(m => { n.series[m.id] = m.id === 'gpu' ? n.own.gpu : n.hostHist[m.id]; });
    }
    n.gseries = n.hostG;
  }
}
function build(d){
  for (const k in nodes) delete nodes[k];
  roots.length = 0;
  d.machines.forEach(s => roots.push(machineFrom(s, false)));
  roots.forEach(compute);
  buildDivisions();
}

const cur = (n, m) => n.series[m][H-1];
const ownCur = (n, m) => (n.own || n.series)[m][H-1];   // a VM's figures as the guest reports them
const capOf = (m, metric) => m.cap[MI[metric]];
const sumv = o => Object.values(o).reduce((a, b) => a + b, 0);
function hostOf(n){ let p = n.kind === 'machine' ? n.parent : n; while (p && p.kind !== 'machine') p = p.parent; return p || n; }
function machineOf(n){ let p = n; while (p && p.kind !== 'machine') p = p.parent; return p; }
function rootOf(n){ while (n.parent) n = n.parent; return n; }
function ownerOf(n){ return n.kind === 'cron' ? n.parent.parent : n.kind === 'cronfolder' ? n.parent : null; }
function within(n, id){ for (let p = n; p; p = p.parent) if (p.id === id) return true; const d = nodes[id]; return !!(d && d.kind === 'division' && d.children.some(m => within(n, m.id))); }   // a division holds its members
function byType(m, metric, i){ const o = {base:0, compose:0, container:0, vm:0}; m.children.forEach(c => { o[c.type] += i == null ? cur(c, metric) : c.series[metric][i]; }); return o; }
function ctxOf(key){
  if (key === 'fleet') return {name:'All machines',
    bt:(metric, i) => { const o = {base:0, compose:0, container:0, vm:0}; roots.forEach(r => { const b = byType(r, metric, i); for (const k in o) o[k] += b[k]; }); return o; },
    cap:metric => roots.filter(r => hasData(r)).reduce((s, r) => s + capOf(r, metric), 0)};
  const m = nodes[key];
  if (m && m.kind === 'division' && !m.parent) return {name:m.name,
    bt:(metric, i) => { const o = {base:0, compose:0, container:0, vm:0}; m.children.forEach(r => { const b = byType(r, metric, i); for (const k in o) o[k] += b[k]; }); return o; },
    cap:metric => m.children.filter(r => hasData(r)).reduce((s, r) => s + capOf(r, metric), 0)};
  return {name:m.name, bt:(metric, i) => byType(m, metric, i), cap:metric => capOf(m.kind === 'machine' ? m : hostOf(m), metric)};
}
function cronCount(n){ let c = 0; (function v(x){ if (x.kind === 'cron') c++; x.children.forEach(v); })(n); return c; }
function shareOfHost(n, metric){   // under a host without a reading there's no host to take a share of: a VM's is of its own capacity
  const h = hostOf(n); if (h === n || hasData(h)) return cur(n, metric) / capOf(h, metric) * 100;
  return n.kind === 'machine' ? cur(n, metric) / capOf(n, metric) * 100 : NaN;
}

/* which GPU */
function gpuBt(m, key, i){ const o = {base:0, compose:0, container:0, vm:0}; m.children.forEach(c => { const s = c.gseries[key]; if (s) o[c.type] += i == null ? s[H-1] : s[i]; }); return o; }
function keysUsed(n){
  return Object.keys(n.gseries).filter(k => Math.max(...n.gseries[k]) > 0);
}
function gpuIdxs(n){ const host = hostOf(n); return keysUsed(n).map(k => host.gpus.findIndex(g => g.key === k)).filter(i => i >= 0).sort((a, b) => a - b); }
function whichGpu(n){ const ix = gpuIdxs(n); return ix.length ? 'GPU' + ix.join('+') : ''; }
function whichGpuLong(n){ const host = hostOf(n), ix = gpuIdxs(n); return ix.map(i => `GPU ${i} (${host.gpus[i].name})`).join(' + '); }
function gpuConsumers(m, key){
  const out = [];
  (function v(n){ n.children.forEach(c => {
    if (c.kind === 'machine' || c.hist){ const s = c.gseries[key]; if (s && Math.max(...s) > 0) out.push({n:c, v:s[H-1]}); return; }
    v(c);
  }); })(m);
  return out.sort((a, b) => b.v - a.v);
}
function gpuSub(n){ const host = hostOf(n); if (!host.gpus.length) return 'host has no GPU'; const w = whichGpuLong(n); return w ? 'on ' + esc(w) : 'not using a GPU'; }
function gpuCell(n){ const w = whichGpu(n); return fmt(cur(n, 'gpu'), 'gpu') + (w ? ` <span class="gtag">${w}</span>` : ''); }

/* ---------- small renderers ---------- */
const $ = id => document.getElementById(id);
function colOf(n){ return n.kind === 'division' ? n.color : TCOL[n.type] || 'var(--ink-2)'; }
function iconOf(n){
  if (n.kind === 'division') return 'g' + (n.gkind || 'taskforce');
  if (n.kind === 'machine') return n.tile || 'vm';
  if (n.kind === 'cronfolder' || n.kind === 'cron') return 'clock';
  if (n.kind === 'base') return 'chip';
  if (n.type === 'compose' && n.kind !== 'service') return 'layers';
  if (n.type === 'vm') return 'vm';
  return 'cube';
}
function sparkPts(data, w, h){ const max = Math.max(...data) * 1.15 || 1; return data.map((v, i) => `${(i/(H-1)*w).toFixed(2)},${(h - v/max*h).toFixed(2)}`).join(' '); }
function sparkSVG(data, color, w, h){ return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${sparkPts(data, w, h)}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`; }
function legendHTML(withFree){ return `<div class="legend">${TYPES.map(t => `<span><i class="sw" style="background:${TCOL[t.id]}"></i>${t.label}</span>`).join('')}${withFree ? '<span><i class="sw free"></i>Free</span>' : ''}</div>`; }
function modeSeg(){ return `<div class="seg" role="group" aria-label="Show percentages of"><button type="button" data-mode="cap" aria-pressed="${S.mode==='cap'}">of capacity</button><button type="button" data-mode="used" aria-pressed="${S.mode==='used'}">of what’s in use</button></div>`; }
function noteHTML(html, cls){ return `<div class="${cls || 'note'}">${icon('info')}<div>${html}</div></div>`; }
function heroStats(list){ return `<div class="hero-stats">${list.map(s => `<div class="hs"><div class="k">${s.k}</div><div class="v">${s.v}</div><div class="s">${s.s}</div></div>`).join('')}</div>`; }
// A machine with data keeps showing it while it reconnects ("stale"); only a machine that never
// reported gets the offline card. Status changes never swap the layout.
function isLive(n){ return n.status === 'ok'; }
// a machine Fleet reaches over SSH has a connection you can turn off and on (this computer needs none)
function switchable(n){ return n.kind === 'machine' && /^ssh /.test(n.agent || ''); }
function hasData(n){ return n.kind !== 'machine' || n.hasData || n.status === 'ok' || n.status === 'hostonly'; }
function isStale(n){ return n.kind === 'machine' && n.status !== 'ok' && n.status !== 'hostonly' && n.status !== 'off' && n.hasData; }   // a VM that is off isn't reconnecting
function staleFor(n){ return n.lastOk ? Math.max(0, Date.now() / 1000 - n.lastOk) : 0; }
function statusClass(n){ return isLive(n) ? 'ok' : n.status === 'hostonly' ? 'hostonly' : isStale(n) ? 'stale' : n.status === 'off' ? 'off' : n.status === 'connecting' ? 'connecting' : 'offline'; }
const STATUSES = ['ok', 'hostonly', 'stale', 'off', 'connecting', 'offline'];   // every class statusClass gives
// 'off' means only that a machine's connection is turned off; a VM its host reports as not running is 'stopped'
function statusText(n){ return n.status === 'ok' ? 'live' : n.status === 'disabled' ? 'off' : n.status === 'off' ? 'stopped' : n.status === 'hostonly' ? 'seen from host' : isStale(n) ? 'reconnecting' : n.status === 'connecting' ? 'connecting' : 'offline'; }
function stalePill(n){ return isStale(n) ? `<span class="spill" title="Showing the last reading until ${esc(n.name)} answers again">reconnecting · ${ago(staleFor(n)).replace(' ago', '')}</span>` : ''; }
function pinBtn(id){ const on = PINS.includes(id); return `<button type="button" class="pinbtn${on ? ' on' : ''}" data-pin="${esc(id)}" aria-pressed="${on}" aria-label="${on ? 'Unpin' : 'Pin'} ${esc(nodes[id] ? nodes[id].name : id)} as a space" title="${on ? 'Unpin from the space bar' : 'Pin to the space bar'}">${icon('pin')}</button>`; }

/* ---------- spaces (All machines + pins) ---------- */
function pillPct(key){
  if (key === 'fleet'){ const c = ctxOf('fleet'); return pct(sumv(c.bt(S.metric)) / c.cap(S.metric) * 100); }
  const n = nodes[key]; if (!n) return '';
  if (n.kind === 'division' && !n.parent){ const c = ctxOf(key), cap = c.cap(S.metric); return cap ? pct(sumv(c.bt(S.metric)) / cap * 100) : '—'; }
  if (n.kind === 'machine' && !hasData(n)) return statusText(n);
  return pct(n.kind === 'machine' && !n.parent ? cur(n, S.metric) / capOf(n, S.metric) * 100 : shareOfHost(n, S.metric));
}
function miniBar(key){
  const n = key === 'fleet' ? null : nodes[key];
  if (n && n.kind !== 'machine' && !(n.kind === 'division' && !n.parent)) return `<i style="width:${Math.min(100, shareOfHost(n, S.metric)).toFixed(1)}%;background:${colOf(n)}"></i>`;
  const c = ctxOf(key), bt = c.bt(S.metric), cap = c.cap(S.metric);
  if (!cap) return '';
  return TYPES.map(t => `<i style="width:${(bt[t.id]/cap*100).toFixed(2)}%;background:${TCOL[t.id]}"></i>`).join('');
}
function renderSpaces(){
  const pills = [{key:'fleet', name:'All machines', tile:'fleet'}].concat(PINS.map(id => {
    const n = nodes[id];
    return n ? {key:id, name:n.name, tile:n.kind === 'machine' ? n.tile : iconOf(n), os:machineOS(n), tcol:n.kind === 'machine' ? '' : colOf(n), pinned:true, sub:n.kind === 'machine' || (n.kind === 'division' && !n.parent) ? '' : rootOf(n).name}
             : {key:id, name:id.split('/').pop(), tile:'cube', pinned:true, gone:true};
  }));
  $('spaces').innerHTML = pills.map(p => `<div class="space${S.space===p.key?' active':''}${p.pinned?' pinned':''}${p.gone?' gone':''}" title="${esc(p.name)}${p.sub ? ' · on ' + esc(p.sub) : ''}${p.gone ? ' · not seen right now' : ''}">`
    + `<button type="button" data-space="${esc(p.key)}" aria-pressed="${S.space===p.key}" style="display:flex;align-items:center;gap:10px;min-width:0;height:100%">`
    + (p.os ? tileHTML(p.tile, p.os, false) : `<span class="tile ${p.tcol ? '' : p.tile}" ${p.tcol ? `style="background:color-mix(in srgb, ${p.tcol} 22%, transparent);color:${p.tcol}"` : ''}>${icon(p.tile)}</span>`) + `<span class="nm">${esc(p.name)}</span>`
    + `<span class="mini" data-mini="${esc(p.key)}" aria-hidden="true">${p.gone ? '' : miniBar(p.key)}</span><span class="pc" data-pc="${esc(p.key)}">${p.gone ? 'gone' : pillPct(p.key)}</span></button>`
    + (p.pinned ? `<button type="button" class="unpin" data-unpin="${esc(p.key)}" aria-label="Unpin ${esc(p.name)}" title="Unpin">${icon('x', 2.4)}</button>` : '') + `</div>`).join('')
    + `<button type="button" class="addpin" data-addpin="1" aria-haspopup="dialog" aria-expanded="${PICK.open}" aria-label="Pin a grouping to the space bar" title="Pin a grouping">${icon('plus', 2)}</button>`;
  watchDragRegions();
}

/* ---------- + picker: pin any grouping ---------- */
const PICK = {open:false, q:''};
function kindLabel(n){
  if (n.kind === 'division') return GKIND[n.gkind || 'taskforce'][1];
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
  const divs = Object.values(nodes).filter(n => n.kind === 'division' && n.id.startsWith('div:')).map(n => ({n, d:0, path:n.parent ? [hostOf(n).name] : [], div:true}));
  let list = divs.concat(pickCandidates());
  if (q) list = list.filter(x => [x.n.name, kindLabel(x.n), x.n.os || '', (x.n.meta && x.n.meta.image) || '', x.path.join(' ')].join(' ').toLowerCase().includes(q));
  const shown = list.slice(0, 400);
  box.innerHTML = shown.length ? shown.map(({n, d, path, div}, i) => {
    const sec = divs.length && !q ? (i === 0 ? '<div class="pick-sec">Groups</div>' : !div && shown[i - 1].div ? '<div class="pick-sec">Machines and what runs on them</div>' : '') : '';
    const on = PINS.includes(n.id);
    const where = q && path.length ? `<span class="pw">${esc(path.join(' › '))}</span>` : '';
    return sec + `<button type="button" class="prow${on ? ' on' : ''}" data-pin="${esc(n.id)}" aria-pressed="${on}" style="padding-left:${10 + (q ? 0 : d * 16)}px">`
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
// Fleet.app's title bar: the band (what's visible of the bar; none once a narrow window has scrolled it away)
// and where its pills and buttons are. Sent again whenever they move: a render, a resize, a poll's new numbers,
// the pills scrolled sideways, the page scrolled (#188); only what changed goes out.
// In CSS px: at a text size other than 100% (⌘+ ⌘−, WKWebView's page zoom) the app takes the click into CSS px
// before it compares (titleBarDrags, #203). The app says its zoom (NZ) so the traffic lights' room in the bar
// stays 84 points (#189).
let dragSent = '', NZ = 1;
window.fleetNativeZoom = z => { NZ = z > 0 ? +z : 1; document.documentElement.style.setProperty('--nz', NZ); reportDragRegions(); };
function reportDragRegions(){
  const h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.fleet;
  if (!h) return;
  const bar = document.querySelector('.spacebar'); if (!bar) return;
  const regions = [...bar.querySelectorAll('button, .space, input, a')].map(e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
  const band = Math.max(0, bar.getBoundingClientRect().bottom), msg = JSON.stringify([band, regions]);
  if (msg === dragSent) return;
  dragSent = msg;
  h.postMessage({band, regions});
}
addEventListener('resize', () => setTimeout(reportDragRegions, 50));
// Pills change size on their own (a percentage that grows each poll, a font that loads), and every pill after
// one that grew moves, + included; the Mac app hears where they are each time, not just when the bar is drawn.
function watchDragRegions(){
  if (typeof ResizeObserver !== 'function'){ setTimeout(reportDragRegions, 0); return; }
  const ro = watchDragRegions.ro || (watchDragRegions.ro = new ResizeObserver(() => reportDragRegions()));
  ro.disconnect();
  document.querySelectorAll('.spacebar .space, .spacebar button').forEach(e => ro.observe(e));
  const sp = $('spaces');
  if (sp && !sp.dataset.dragwatch){ sp.dataset.dragwatch = '1'; sp.addEventListener('scroll', reportDragRegions, {passive:true}); }
}
addEventListener('scroll', e => { if (e.target === document || (e.target.closest && e.target.closest('.spacebar'))) reportDragRegions(); }, {capture:true, passive:true});
function updateSpaces(){
  document.querySelectorAll('[data-mini]').forEach(e => { if (e.dataset.mini === 'fleet' || nodes[e.dataset.mini]) e.innerHTML = miniBar(e.dataset.mini); });
  document.querySelectorAll('[data-pc]').forEach(e => { if (e.dataset.pc === 'fleet' || nodes[e.dataset.pc]) e.textContent = pillPct(e.dataset.pc); });
  reportDragRegions();
}

/* ---------- toolbar ---------- */
function renderToolbar(){
  let crumbs;
  if (S.tree === 'network') crumbs = `<button type="button" data-space="fleet">All machines</button><span class="sep" aria-hidden="true">/</span><span class="cur">Network</span>`;
  else if (S.sel === 'fleet' || !nodes[S.sel]) crumbs = `<span class="cur">${S.pinsOnly && S.space === 'fleet' ? 'Pins only' : 'All machines'}</span>`;
  else {
    const path = []; for (let n = nodes[S.sel]; n; n = n.parent) path.unshift(n);
    crumbs = `<button type="button" data-space="fleet">All machines</button>` + path.map((n, i) => `<span class="sep" aria-hidden="true">/</span>` + (i === path.length - 1 ? `<span class="cur">${esc(n.name)}</span>` : `<button type="button" data-select="${esc(n.id)}">${esc(n.name)}</button>`)).join('');
  }
  $('crumbs').innerHTML = crumbs;
  $('metrics').innerHTML = METRICS.map(m => `<button type="button" data-metric="${m.id}" aria-pressed="${S.view === 'overview' && S.metric===m.id}">${m.label}</button>`).join('')
    + `<span class="sep-pill" aria-hidden="true"></span><button type="button" class="dpill" data-details="1" draggable="true" aria-pressed="${S.view === 'details' || !!S.detailsDocked}" title="Open Details, or drag it onto the right half to dock it as a panel"><span class="grip">${icon('grip')}</span>Details</button>`
    + `<button type="button" class="dockbtn${S.detailsDocked ? ' on' : ''}" ${S.detailsDocked ? 'data-closedock' : 'data-dock'}="1" aria-pressed="${!!S.detailsDocked}" aria-label="${S.detailsDocked ? 'Undock Details' : 'Dock Details beside the overview'}" title="${S.detailsDocked ? 'Close the docked Details panel' : 'Dock Details as a panel on the right'}">${icon('panelright')}</button>`;
  document.querySelectorAll('[data-tree]').forEach(b => b.setAttribute('aria-pressed', String(S.tree === b.dataset.tree)));
  renderFilterBar();
}

/* ---------- machine tree ---------- */
function isOpen(n){
  if (S.open[n.id] !== undefined) return S.open[n.id];
  if (n.kind === 'division') return true;
  if (n.kind === 'machine') return S.space !== 'fleet' || !n.parent;
  return n.kind === 'group' && n.type === 'vm';
}
function rowVal(n){
  if (n.kind === 'division' && !n.parent) return pillPct(n.id);
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
  if (S.groupsOnly) return renderGroupsTree();
  const rows = [];
  // ⌘F in the tree: only what matches, and the path down to it
  const keep = TF.q ? treeMatches(treeRoots(), TF.q) : null;
  const shown = n => !keep || keep.has(n.id), opened = n => keep ? n.children.some(c => keep.has(c.id)) : isOpen(n);
  const entries = groupedWalk(treeRoots(), orderedKids, opened, shown, S.pinsOnly ? 'pins' : 'machines');
  entries.forEach(e => { if (e.n) rows.push(e); });
  if (keep && !rows.length){ $('tree').innerHTML = `<div class="tempty">Nothing in the tree matches “${esc(TF.q)}”.</div>`; return; }
  $('tree').innerHTML = entries.map(e => e.open ? tgroupOpen(e) : e.close ? '</div>' : treeRow(e)).join('');
  function treeRow({n, d, pk}){
    const kids = n.children.length > 0, open = kids && opened(n);
    const count = (n.kind === 'group' || n.kind === 'cronfolder' || n.kind === 'project' || n.kind === 'division') ? `<span class="count">${n.children.length}</span>` : '';
    const dot = n.kind === 'cron' ? `<i class="dot${n.running?' on':''}" data-dot="${esc(n.id)}" title="running now"></i>` : n.kind === 'machine' ? (switchable(n) ? connDot(n) : `<i class="sdot ${statusClass(n)}" data-sdot="${esc(n.id)}" title="${statusText(n)}"></i>`) : '';
    const gw = S.metric === 'gpu' && n.parent && hostOf(n).gpus.length > 1 ? whichGpu(n) : '';
    const gtag = gw ? `<span class="gtag" title="${esc(whichGpuLong(n))}">${gw}</span>` : '';
    const st = n.kind === 'machine' ? ' ' + statusClass(n) : '';
    const pin = (n.kind === 'machine' || n.kind === 'project' || n.kind === 'service' || n.kind === 'container' || n.kind === 'group' || n.kind === 'division') ? pinBtn(n.id) : '<span style="width:22px;flex:none"></span>';
    return `<div class="row ${n.kind}${st}${S.sel===n.id?' sel':''}" style="--d:${d}" role="treeitem" aria-level="${d+1}" ${kids?`aria-expanded="${open}"`:''} aria-selected="${S.sel===n.id}" data-select="${esc(n.id)}" data-pk="${esc(pk)}">`
      + `<span class="tdrag" draggable="true" title="Drag into a group" aria-hidden="true">${icon('grip')}</span>`
      + `<button type="button" class="chev${open?' open':''}${kids?'':' leaf'}" ${kids?`data-toggle="${esc(n.id)}" aria-label="${open?'Collapse':'Expand'} ${esc(n.name)}"`:'tabindex="-1" aria-hidden="true"'}>${icon('chev', 2.4)}</button>`
      + `${machineOS(n) ? treeMachineIcon(n) : `<span class="ico" style="color:${n.kind==='cronfolder'||n.kind==='cron'?'var(--ink-3)':colOf(n)}">${icon(iconOf(n))}</span>`}`
      + `<button type="button" class="nm" data-select="${esc(n.id)}">${esc(n.name)}</button>${count}${gtag}${dot}${pin}`
      + `<svg class="spark" data-spark="${esc(n.id)}" viewBox="0 0 60 16" preserveAspectRatio="none" aria-hidden="true"><polyline points="${sparkPts(n.series[S.metric], 60, 16)}" fill="none" stroke="${n.kind==='machine'&&!n.parent?'var(--accent)':colOf(n)}" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`
      + `<span class="val${n.kind === 'machine' && !isLive(n) ? ' dim' : ''}" data-val="${esc(n.id)}" title="share of host ${mlabel(S.metric)}">${rowVal(n)}</span></div>`;
  }
  if (S.pinsOnly && !rows.length) $('tree').innerHTML = `<div class="empty-pins">${icon('pin')}<b>Nothing pinned yet</b><span>Pin a machine, VM, project or container with the pin on its row, or with <b>+</b> in the top bar.</span></div>`;
  treeHeader();
}
function treeHeader(){
  const scope = S.space === 'fleet' ? 'All machines' : (nodes[S.space] ? nodes[S.space].name : 'All machines');
  $('tree-title').innerHTML = `<span class="scopeseg" role="group" aria-label="Show"><button type="button" data-pinsonly="0" aria-pressed="${!S.pinsOnly}">${esc(scope)}</button><button type="button" data-pinsonly="1" aria-pressed="${!!S.pinsOnly}">Pins only</button></span>`
    + `<button type="button" class="gonly" data-groupsonly="1" aria-pressed="${!!S.groupsOnly}" aria-label="Groups only" title="Groups only: show just your groups and subgroups (fleets, flotillas, divisions, …), without the machines in them">${icon('gfleet', 2)}</button>`;
  $('tree-col').textContent = '% of host · ' + mlabel(S.metric);
  $('side-note').innerHTML = '';
}
// The Fleet button (#59): the tree shows only your groups and their subgroups, as an overview of the group
// hierarchy (fleets, flotillas, divisions, …); the machines and everything in them are hidden. A group's parent is
// the nearest group of its own tree (All machines or Pins only) that holds one of its members' ancestors. Pins
// only adds the groups you pinned, with their subgroups. Folding (S.gfold) is the same fold as in the normal tree.
function groupsHierarchy(){
  const all = [];
  for (const [key, list] of Object.entries(PREFS.tgroups || {})){
    const at = key.indexOf('|'), sc = key.slice(0, at);
    if (sc === 'network') continue;
    list.forEach(g => { const n = nodes['div:' + g.id]; if (n) all.push({g, sc, pk:key.slice(at + 1), n}); });
  }
  all.forEach(x => {
    x.up = null;
    for (let p = x.pk === 'root' ? null : nodes[x.pk]; p && !x.up; p = p.parent) x.up = all.find(y => y !== x && y.sc === x.sc && y.g.ids.includes(p.id)) || null;
  });
  const scope = S.pinsOnly ? 'pins' : 'machines', above = x => { for (let u = x.up; u; u = u.up) if (PINS.includes(u.n.id)) return true; return false; };
  const tops = all.filter(x => x.sc === scope && !x.up).concat(S.pinsOnly ? all.filter(x => x.sc === 'machines' && PINS.includes(x.n.id) && !above(x)) : []);
  const order = list => list.slice().sort((a, b) => { const pa = !S.pinsOnly && PINS.includes(a.n.id), pb = !S.pinsOnly && PINS.includes(b.n.id); return pa !== pb ? (pa ? -1 : 1) : COLL.compare(a.g.name, b.g.name); });
  return {tops:order(tops), kids:x => order(all.filter(y => y.up === x))};
}
function renderGroupsTree(){
  const {tops, kids} = groupsHierarchy(), q = TF.q.trim().toLowerCase(), rows = [];
  const hit = x => !q || x.g.name.toLowerCase().includes(q) || GKIND[x.n.gkind][1].includes(q) || kids(x).some(hit);
  // a group with subgroups unfolds to them (open by default); one without unfolds to what's in it (folded by default)
  (function walk(list, d){ list.filter(hit).forEach(x => {
    const ks = kids(x).filter(hit), f = S.gfold && S.gfold[x.g.id];
    const folded = ks.length ? !q && !!f : f !== false;
    rows.push({x, d, ks, folded});
    if (folded) return;
    if (ks.length) walk(ks, d + 1);
    else x.n.children.slice().sort((a, b) => COLL.compare(a.name, b.name)).forEach(m => rows.push({m, d:d + 1}));
  }); })(tops, 0);
  const memberRow = (m, d) => `<div class="row ${m.kind} gonlymember${S.sel === m.id ? ' sel' : ''}" style="--d:${d}" role="treeitem" aria-level="${d + 1}" aria-selected="${S.sel === m.id}" data-select="${esc(m.id)}">`
    + `<button type="button" class="chev leaf" tabindex="-1" aria-hidden="true">${icon('chev', 2.4)}</button><span class="ico" style="color:${colOf(m)}">${icon(m.kind === 'machine' ? m.tile || 'vm' : iconOf(m))}</span>`
    + `<button type="button" class="nm" data-select="${esc(m.id)}">${esc(m.name)}</button><span class="tgk">${esc(kindLabel(m))}</span>`
    + `<svg class="spark" data-spark="${esc(m.id)}" viewBox="0 0 60 16" preserveAspectRatio="none" aria-hidden="true"><polyline points="${sparkPts(m.series[S.metric], 60, 16)}" fill="none" stroke="${colOf(m)}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`
    + `<span class="val" data-val="${esc(m.id)}">${rowVal(m)}</span></div>`;
  $('tree').innerHTML = rows.length ? rows.map(({x, m, d, ks, folded}) => {
    if (m) return memberRow(m, d);
    const n = x.n, sel = S.sel === n.id;
    const chev = `<button type="button" class="chev${folded ? '' : ' open'}" data-tgfold="${esc(x.g.id)}" aria-expanded="${!folded}" aria-label="${folded ? 'Unfold' : 'Fold'} ${esc(x.g.name)}">${icon('chev', 2.4)}</button>`;
    const where = d === 0 && n.parent ? `<span class="tgw">on ${esc(hostOf(n).name)}</span>` : '';
    return `<div class="row division gonlyrow${sel ? ' sel' : ''}" style="--d:${d}" role="treeitem" aria-level="${d + 1}" ${ks.length ? `aria-expanded="${!folded}"` : ''} aria-selected="${sel}" data-select="${esc(n.id)}">`
      + chev + `<span class="ico" style="color:${n.color}">${icon(iconOf(n))}</span>`
      + `<button type="button" class="nm" data-select="${esc(n.id)}">${esc(x.g.name)}</button><span class="tgk">${GKIND[n.gkind][0]}</span>${where}<span class="count">${n.children.length}</span>${pinBtn(n.id)}`
      + `<svg class="spark" data-spark="${esc(n.id)}" viewBox="0 0 60 16" preserveAspectRatio="none" aria-hidden="true"><polyline points="${sparkPts(n.series[S.metric], 60, 16)}" fill="none" stroke="${n.color}" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`
      + `<span class="val" data-val="${esc(n.id)}" title="share of ${n.parent ? 'host' : 'all machines'} ${mlabel(S.metric)}">${rowVal(n)}</span></div>`;
  }).join('') : q ? `<div class="tempty">Nothing in the tree matches “${esc(TF.q)}”.</div>`
    : `<div class="tempty">No groups ${S.pinsOnly ? 'in Pins only ' : ''}yet. Draw a box over two or more items at the same level (or drag one onto another) to group them; turn off <b>Groups only</b> to see the items.</div>`;
  treeHeader();
}
function updateTree(){
  if (S.tree === 'network') return updateNetTree();
  document.querySelectorAll('[data-val]').forEach(e => { const n = nodes[e.dataset.val]; if (n) e.textContent = rowVal(n); });
  document.querySelectorAll('[data-spark]').forEach(e => { const n = nodes[e.dataset.spark]; if (n) e.firstElementChild.setAttribute('points', sparkPts(n.series[S.metric], 60, 16)); });
  document.querySelectorAll('[data-dot]').forEach(e => { const n = nodes[e.dataset.dot]; if (n) e.classList.toggle('on', !!n.running); });
  // the row's status class greys its name or value (index.html): it changes with the dot (#129)
  document.querySelectorAll('[data-sdot]').forEach(e => { const n = nodes[e.dataset.sdot]; if (n){ const c = statusClass(n), r = e.closest('.row.machine'); e.className = 'sdot ' + c; e.title = e.dataset.conn ? connTitle(n) : statusText(n); if (e.dataset.conn){ e.setAttribute('aria-pressed', String(n.on)); e.setAttribute('aria-label', (n.on ? 'Disconnect ' : 'Connect ') + n.name); } if (r) STATUSES.forEach(k => r.classList.toggle(k, k === c)); } });
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
        n.children.push(mkn('net:c:' + m.id + ':' + c.name, {name:c.name, kind:'ncontainer', rx:c.rx, tx:c.tx, dnet:n.dnet}));   // received, sent (#177)
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
// The rows are drawn without their rates. A poll that brings the same rows only fills in the rates, so focus and a
// click in progress survive it (#157); any other change, and every renderTree, draws the rows anew.
let netDrawn = null;
function netTreeHTML(){
  const rootsN = buildNet();
  const rows = [];
  const keep = TF.q ? treeMatches(rootsN, TF.q) : null;
  const entries = groupedWalk(rootsN, n => n.children, n => keep ? n.children.some(c => keep.has(c.id)) : netOpen(n), n => !keep || keep.has(n.id), 'network');
  entries.forEach(e => { if (e.n) rows.push(e); });
  return rows.length ? entries.map(e => e.open ? tgroupOpen(e) : e.close ? '</div>' : netRow(e)).join('') : '<div class="side-note">Loading the network…</div>';
  function netRow({n, d, pk}){
    const kids = n.children.length > 0, open = kids && netOpen(n);
    const ic = n.kind === 'tailnet' ? 'net' : n.kind === 'nmachine' ? 'desktop' : n.kind === 'ncontainer' ? 'cube' : n.ifkind === 'bridge' ? 'bridge' : n.vm ? 'vm' : 'nic';
    const sub = n.kind === 'nmachine' ? `<i class="sdot ${n.status}" title="${esc(n.status)}"></i>` : n.vm ? `<span class="count">${esc(n.vm)}</span>` : n.dnet && n.kind === 'if' ? `<span class="count">${esc(n.dnet)}</span>` : '';
    return `<div class="row${S.netSel===n.id?' sel':''}" style="--d:${d}" role="treeitem" aria-level="${d+1}" ${kids?`aria-expanded="${open}"`:''} data-netsel="${esc(n.id)}" data-pk="${esc(pk)}">`
      + `<span class="tdrag" draggable="true" title="Drag into a group" aria-hidden="true">${icon('grip')}</span>`
      + `<button type="button" class="chev${open?' open':''}${kids?'':' leaf'}" ${kids?`data-toggle="${esc(n.id)}" aria-label="${open?'Collapse':'Expand'} ${esc(n.name)}"`:'tabindex="-1" aria-hidden="true"'}>${icon('chev', 2.4)}</button>`
      + `<span class="ico" style="color:var(--ink-2)">${icon(ic)}</span><button type="button" class="nm" data-netsel="${esc(n.id)}">${esc(n.name)}</button>${sub}<span class="nrate" data-nrate="${esc(n.id)}"></span></div>`;
  }
}
function renderNetTree(html = netTreeHTML()){
  $('tree').innerHTML = html; netDrawn = {html, first:$('tree').firstElementChild};
  netRates();
  $('tree-title').innerHTML = 'Network';
  $('tree-col').textContent = '↓ in · ↑ out';
  $('side-note').innerHTML = '';
}
function updateNetTree(){
  const html = netTreeHTML();
  if (!netDrawn || html !== netDrawn.html || $('tree').firstElementChild !== netDrawn.first) return renderNetTree(html);
  netRates();
}
function netRates(){ document.querySelectorAll('#tree [data-nrate]').forEach(e => { const n = netNodes[e.dataset.nrate]; if (n) e.innerHTML = `<span>↓ ${rateText(n.rx)}</span><span>↑ ${rateText(n.tx)}</span>`; }); }

/* ---------- cards ---------- */
function whereRows(key){
  const c = ctxOf(key), rows = [];
  METRICS.forEach(m => {
    if (m.id === 'gpu' && key !== 'fleet' && !(nodes[key] && nodes[key].kind === 'division')){   // a division adds up its members' GPUs, like the fleet
      const mm = nodes[key];
      if (!mm.gpus.length){ rows.push({label:'GPU', empty:true}); return; }
      mm.gpus.forEach((g, gi) => rows.push({label:'GPU ' + gi, sub:g.name, metric:'gpu', bt:gpuBt(mm, g.key), cap:100, tip:`gseg|${key}|${g.key}`}));
      return;
    }
    const cap = c.cap(m.id);
    if (!cap){ rows.push({label:m.label, empty:true}); return; }
    rows.push({label:m.label, sub:m.id === 'gpu' ? `all ${cap/100} GPUs` : '', metric:m.id, bt:c.bt(m.id), cap, tip:`seg|${key}|${m.id}`});
  });
  return rows;
}
function whereCard(key, title){
  const rows = whereRows(key).map(r => {
    const lab = `<div class="lab">${esc(r.label)}${r.sub ? `<small title="${esc(r.sub)}">${esc(r.sub)}</small>` : ''}</div>`;
    if (r.empty) return `<div class="res">${lab}<div class="sbar empty">no ${esc(r.label)} here</div><div class="tot">—</div></div>`;
    const bt = r.bt, used = sumv(bt), cap = r.cap, m = r.metric;
    const den = S.mode === 'cap' ? cap : (used || 1);
    const live = TYPES.filter(t => bt[t.id] > 0);
    const segs = live.map(t => `<span class="s" style="width:${Math.min(100, bt[t.id]/den*100).toFixed(3)}%;background:${TCOL[t.id]}" data-tip="${esc(r.tip)}|${t.id}"></span>`).join('');
    const kv = live.map(t => `<span><i class="sw" style="background:${TCOL[t.id]}"></i>${t.short} <b>${pct(bt[t.id]/den*100)}</b></span>`).join('')
      + (S.mode === 'cap' ? `<span><i class="sw free"></i>Free <b>${pct(Math.max(0, cap - used)/cap*100)}</b></span>` : '');
    const capNote = m === 'disk' ? ' (peak seen)' : m === 'net' ? ' (link speed)' : '';
    return `<div class="res">${lab}<div class="sbar" role="img" aria-label="${esc(r.label)}: ${live.map(t => t.label + ' ' + pct(bt[t.id]/den*100)).join(', ') || 'idle'}">${segs}</div><div class="tot">${pct(used/cap*100)} used<small>${fmt(used, m)} of ${capText(cap, m)}${capNote}</small></div><div class="kvs">${kv}</div></div>`;
  }).join('');
  return `<section class="card"><div class="card-h"><h2>${title}</h2><span class="grow"></span>${modeSeg()}</div>${legendHTML(S.mode === 'cap')}${rows}</section>`;
}

let lastGraph = null;
function graphCard(title, sub, series, yMax, metric, extraHead){
  lastGraph = {series, metric};
  const W = 600, GH = 190, x = i => i/(H-1)*W, y = v => GH - Math.min(v, yMax)/yMax*GH;
  let cum = zero(), paths = '';
  series.forEach(s => {
    const lo = cum, hi = cum.map((c, i) => c + s.data[i]);
    const top = hi.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`), bot = lo.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).reverse();
    paths += `<path d="M${top.join('L')}L${bot.join('L')}Z" fill="${s.color}" fill-opacity=".92"/><path d="M${top.join('L')}" fill="none" stroke="${series.length > 1 ? 'var(--card)' : s.color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    cum = hi;
  });
  const grid = [1, .75, .5, .25].map(f => `<div class="gl" style="top:${(1-f)*100}%"><span>${metric === 'gpu' ? num(yMax*f) + '%' : num(yMax*f) + (f === 1 ? ' ' + UNIT[metric] : '')}</span></div>`).join('') + `<div class="gl" style="top:100%"><span>0</span></div>`;
  const cx = S.hover && S.hover.k === 'graph' ? S.hover.idx : null;
  const legend = series.length > 1 ? `<div class="legend">${series.map(s => `<span><i class="sw" style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>` : '';
  return `<section class="card"><div class="card-h"><h2>${title}</h2><span class="sub">${sub}</span><span class="grow"></span>${extraHead || ''}</div>${legend}<div class="graph" data-graph="1" role="img" aria-label="${esc(title)}">${grid}<svg viewBox="0 0 ${W} ${GH}" preserveAspectRatio="none" aria-hidden="true">${paths}</svg><div class="cross" style="${cx != null ? `display:block;left:${cx/(H-1)*100}%` : ''}"></div></div><div class="gx"><span>${ago(WINDOW)}</span><span>now</span></div></section>`;
}
function graphMax(capVal, series, metric){
  if (capVal && (metric === 'cpu' || metric === 'mem' || metric === 'gpu')) return capVal;
  let mx = 0; for (let i = 0; i < H; i++){ let s = 0; series.forEach(x => s += x.data[i]); mx = Math.max(mx, s); }
  return niceMax(mx * 1.3);
}
function tableCard(title, sub, list){
  const rows = list.map(({n, d}) => {
    const share = shareOfHost(n, S.metric), w = isFinite(share) ? Math.min(100, share) : 0;
    const off = n.kind === 'machine' && n.status !== 'ok' && n.status !== 'hostonly';
    return `<tr><td style="padding-left:${10 + d*20}px"><button type="button" class="namebtn" data-select="${esc(n.id)}"><span class="ico" style="color:${n.kind==='cron'||n.kind==='cronfolder'?'var(--ink-3)':colOf(n)}">${icon(iconOf(n))}</span>${esc(n.name)}${off ? ` <span class="gtag">${statusText(n)}</span>` : ''}</button></td>`
      + METRICS.map(m => `<td>${m.id === 'gpu' ? gpuCell(n) : fmt(cur(n, m.id), m.id)}</td>`).join('')
      + `<td><span class="share" data-tip="child|${esc(n.id)}|${S.metric}"><span class="b"><i style="width:${w}%;background:${TCOL[n.type] || 'var(--accent-bg)'}"></i></span>${pct(share)}</span></td></tr>`;
  }).join('');
  return `<section class="card"><div class="card-h"><h2>${title}</h2><span class="sub">${sub}</span></div><div class="scroll-x"><table class="tbl"><thead><tr><th>Name</th>${METRICS.map(m => `<th>${m.label}</th>`).join('')}<th>Share of host · ${mlabel(S.metric)}</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}
function cronTableCard(folder, title){
  const rows = orderedKids(folder).map(n => `<tr><td><button type="button" class="namebtn" data-select="${esc(n.id)}"><span class="ico" style="color:var(--ink-3)">${icon('clock')}</span>${esc(n.name)}</button></td><td class="l"><code>${esc(n.job.sched)}</code>${n.job.human && n.job.human !== n.job.sched ? ' · ' + esc(n.job.human) : ''}</td><td class="l"><span class="pill${n.running?' on':''}"><i></i>${n.running ? 'running' : esc(n.job.state || 'idle')}</span></td>`
    + METRICS.map(m => `<td>${!n.running ? '—' : m.id === 'gpu' ? gpuCell(n) : fmt(cur(n, m.id), m.id)}</td>`).join('') + `<td class="l">${esc(n.job.last || '')}</td></tr>`).join('');
  return `<section class="card"><div class="card-h"><h2>${title}</h2><span class="sub">usage shows while a job runs</span></div><div class="scroll-x"><table class="tbl"><thead><tr><th>Job</th><th style="text-align:left">Schedule</th><th style="text-align:left">Status</th>${METRICS.map(m => `<th>${m.label}</th>`).join('')}<th style="text-align:left">Last / next</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}
function gpuCard(m){
  if (!m.gpus.length) return '';
  const blocks = m.gpus.map((g, gi) => {
    const total = sumv(gpuBt(m, g.key)), cons = gpuConsumers(m, g.key);
    const rows = cons.length ? cons.slice(0, 12).map(c => `<button type="button" class="namebtn" data-select="${esc(c.n.id)}"><span class="ico" style="color:${colOf(c.n)}">${icon(iconOf(c.n))}</span>${esc(c.n.name)}</button><div class="track"><div class="bar" style="width:${Math.min(100, c.v).toFixed(2)}%;background:${colOf(c.n)}" data-tip="gpu|${esc(m.id)}|${g.key}|${esc(c.n.id)}"></div></div><div class="tot">${pct(c.v)}</div>`).join('') : `<div class="sub">nothing is using it</div>`;
    return `<div class="gpu"><div class="gpu-h"><div><div class="k">GPU ${gi}</div><div class="gn">${esc(g.name)}</div><div class="s">${esc(g.mem || '')}${g.host ? ' · on host ' + esc(g.host.replace('gpu', 'GPU ')) : ''}</div></div><div class="v">${pct(total)}</div></div><div class="rank gpu-rank">${rows}</div></div>`;
  }).join('');
  return `<section class="card"><div class="card-h"><h2>${m.gpus.length > 1 ? 'GPUs: what runs on which' : 'GPU: what runs on it'}</h2><span class="sub">% of each GPU</span></div><div class="gpus">${blocks}</div></section>`;
}

/* ---------- logical processors ---------- */
function cpuSel(m){ return S.cpuSel && S.cpuSel.mid === m.id ? S.cpuSel.cpus : []; }
function cpuRanges(ns){
  const a = ns.slice().sort((x, y) => x - y), out = [];
  for (let i = 0; i < a.length; i++){ let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; out.push(j > i ? a[i] + '–' + a[j] : String(a[i])); i = j; }
  return out.join(', ');
}
function cpuSelCard(m){
  const d = CPUS[m.id], sel = cpuSel(m);
  if (!d || !d.cpus) return '';
  if (!sel.length) return `<p class="lhint">Click a processor or a group name to see it on its own; ⌘/Ctrl- or Shift-click to add more.</p>`;
  const cs = d.cpus.filter(c => sel.includes(c.n));
  if (!cs.length) return '';
  const group = (d.groups || []).find(g => g.cpus.length === sel.length && g.cpus.every(n => sel.includes(n)));
  const title = (group ? group.name + ' · ' : '') + (cs.length === 1 ? 'CPU ' : 'CPUs ') + cpuRanges(sel);
  const avg = Array.from({length:H}, (_, i) => cs.reduce((s, c) => s + c.h[i], 0) / cs.length);
  const now = avg[H-1], peak = Math.max(...cs.map(c => Math.max(...c.h))), withMhz = cs.filter(c => c.mhz);
  const mhz = withMhz.length ? withMhz.reduce((s, c) => s + c.mhz, 0) / withMhz.length : 0;
  const W = 600, GH = 200, x = i => (i / (H-1) * W).toFixed(1), y = v => (GH - Math.min(v, 100) / 100 * GH).toFixed(1);
  const lines = cs.length <= 32 ? cs.map(c => `<polyline points="${c.h.map((v, i) => x(i) + ',' + y(v)).join(' ')}" fill="none" stroke="var(--accent)" stroke-opacity=".35" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join('') : '';
  const area = `<path d="M0,${GH}L${avg.map((v, i) => x(i) + ',' + y(v)).join('L')}L${W},${GH}Z" fill="var(--accent-bg)" fill-opacity=".35"/><polyline points="${avg.map((v, i) => x(i) + ',' + y(v)).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2.4" vector-effect="non-scaling-stroke"/>`;
  const grid = [100, 75, 50, 25].map(f => `<div class="gl" style="top:${100 - f}%"><span>${f}%</span></div>`).join('') + `<div class="gl" style="top:100%"><span>0</span></div>`;
  // Processes that last ran on these CPUs (Linux reports it per process; macOS and Windows don't).
  const machineProcs = PROCS.machine === m.id ? PROCS.list : null;
  const reports = machineProcs && machineProcs.some(p => p[12] >= 0);
  let procs = '';
  if (!machineProcs) procs = `<div class="sub">Loading processes…</div>`;
  else if (!reports) procs = noteHTML(`${esc(m.os.split(' ')[0] || 'This OS')} doesn’t report which processor a process last ran on, so Fleet can’t list processes per CPU here. <b>Details</b> lists every process.`);
  else {
    const on = machineProcs.filter(p => sel.includes(p[12])).sort((a, b) => b[4] - a[4]);
    const ncpu = m.ncpu || capOf(m, 'cpu');
    procs = on.length ? `<div class="scroll-x"><table class="tbl"><thead><tr><th>Process</th><th>PID</th><th style="text-align:left">Runs in</th><th>CPU (machine)</th><th>Memory</th><th>Last ran on</th></tr></thead><tbody>${on.slice(0, 15).map(p => `<tr><td>${esc(p[1])}</td><td>${p[0]}</td><td class="l"><button type="button" class="namebtn" data-select="${esc(p[10])}" style="font-weight:400">${esc(nodes[p[10]] ? nodes[p[10]].name : '')}</button></td><td>${pct(p[4] / ncpu * 100)}</td><td>${memText(p[5])}</td><td>CPU ${p[12]}</td></tr>`).join('')}</tbody></table></div>${on.length > 15 ? `<div class="more">${on.length - 15} more on these processors.</div>` : ''}` : `<div class="sub">Nothing ran on these processors in the last reading.</div>`;
  }
  return `<section class="card"><div class="card-h"><h2>${esc(title)}</h2><span class="sub">${cs.length} of ${d.cpus.length} processors</span><span class="grow"></span><button type="button" class="btn" data-cpuclear="1">${icon('x', 2.2)}Clear selection</button></div>`
    + `<div class="cpustats">${heroStats([{k:'Now', v:pct(now), s:'average'}, {k:'Peak', v:pct(peak), s:'any one, last ' + ago(WINDOW).replace(' ago', '')}].concat(mhz ? [{k:'Clock', v:(mhz / 1000).toFixed(2) + ' GHz', s:'average'}] : []))}</div>`
    + `<div class="graph" role="img" aria-label="Utilization of ${esc(title)}">${grid}<svg viewBox="0 0 ${W} ${GH}" preserveAspectRatio="none" aria-hidden="true">${lines}${area}</svg></div><div class="gx"><span>${ago(WINDOW)}</span><span>now</span></div>`
    + `<h3 class="cpuproc">On these processors</h3>${procs}</section>`;
}
function ifToggle(){ return `<div class="seg" role="group" aria-label="Network graph"><button type="button" data-ifview="type" aria-pressed="${S.ifView!=='each'}">By type</button><button type="button" data-ifview="each" aria-pressed="${S.ifView==='each'}">Each interface</button></div>`; }
function ifSel(m){ const D = IFS[m.id]; return S.ifSel && S.ifSel.mid === m.id ? S.ifSel.names.filter(k => !D || !D.ifs || D.ifs.some(x => x.name === k)) : []; }
function ifKind(x){ return x.vm ? 'VM tap · ' + x.vm : x.dnet ? 'Docker network · ' + x.dnet : x.kind === 'bridge' ? 'bridge' + (x.members ? ' · ' + x.members + ' member' + (x.members > 1 ? 's' : '') : '') + (x.containers ? ' · ' + x.containers + ' container' + (x.containers > 1 ? 's' : '') : '') : x.kind === 'physical' ? 'physical' : x.desc || x.kind; }
function speedText(sp){
  if (/^\d+$/.test(String(sp))) return +sp > 0 ? (+sp >= 1000 ? (+sp / 1000) + ' Gb/s' : sp + ' Mb/s') : '';
  const m = /^([\d.]+)\s*([GMK])bps$/i.exec(String(sp || ''));  // Windows: "10 Gbps"
  return m ? (+m[1] > 0 ? m[1] + ' ' + m[2].toUpperCase() + 'b/s' : '') : (sp && sp !== '-1' ? String(sp) : '');
}
function ifEachCard(m){
  const D = IFS[m.id], sel = ifSel(m);
  const head = `<div class="card-h"><h2>Each interface</h2><span class="sub">${D ? D.ifs.length + ' interfaces · click one to see what uses it' : 'loading…'}</span><span class="grow"></span>${sortMenu('net')}${ifToggle()}</div>`;
  if (!D) return `<section class="card">${head}</section>`;
  const order = {physical:0, bridge:1, virtual:2};
  const tiles = D.ifs.slice().sort((a, b) => pinFirst('net', m.id, x => x.name)(a, b) || bySort('net')(a, b)).map(x => {
    const on = sel.includes(x.name), tot = x.hrx.map((v, i) => v + x.htx[i]), max = Math.max(0.001, ...tot) * 1.15;
    const pts = a => a.map((v, i) => `${(i/(H-1)*100).toFixed(1)},${(64 - v/max*58).toFixed(1)}`).join(' ');
    const down = x.state && /down|disconnected/i.test(x.state);
    return `<div class="kcell${on ? ' sel' : ''}${down ? ' down' : ''}${tpinned('net', m.id, x.name) ? ' pinned' : ''}"><button type="button" class="tsel" data-isel="${esc(x.name)}" aria-pressed="${on}" aria-label="${esc(x.name)}, ${esc(ifKind(x))}"></button>`
      + `<span class="trow"><span class="kn">${esc(x.name)}${tpinBtn('net', m.id, x.name)}</span><span class="kb">${down ? 'down' : esc(speedText(x.speed))}</span></span>`
      + `<span class="km">${esc(ifKind(x))}</span><span class="ks">${esc((x.addrs || []).slice(0, 2).join(' · ') || (x.master ? 'in ' + x.master : ''))}</span>`
      + `<span class="kr"><i class="rd">↓ ${rateText(x.rx)}</i><i class="wr">↑ ${rateText(x.tx)}</i></span><svg viewBox="0 0 100 64" preserveAspectRatio="none" aria-hidden="true"><path d="M0,64L${pts(tot).split(' ').join('L')}L100,64Z" fill="var(--t-container)" fill-opacity=".25"/><polyline points="${pts(x.hrx)}" fill="none" stroke="var(--t-compose)" stroke-width="1.5" vector-effect="non-scaling-stroke"/><polyline points="${pts(x.htx)}" fill="none" stroke="var(--t-vm)" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg></div>`;
  }).join('');
  return `<section class="card">${head}<div class="kgrid">${tiles}</div></section>`;
}
function ifSelCard(m){
  const D = IFS[m.id], sel = ifSel(m);
  if (!D) return '';
  if (!sel.length) return `<p class="lhint">Click an interface to see its traffic and what uses it; ⌘/Ctrl- or Shift-click to pick several.</p>`;
  const xs = D.ifs.filter(x => sel.includes(x.name));
  if (!xs.length) return '';
  const rx = Array.from({length:H}, (_, i) => xs.reduce((a, x) => a + x.hrx[i], 0)), tx = Array.from({length:H}, (_, i) => xs.reduce((a, x) => a + x.htx[i], 0));
  const title = xs.length === 1 ? `${xs[0].name} · ${ifKind(xs[0])}` : `${xs.length} interfaces: ${xs.map(x => x.name).join(', ')}`;
  const card = graphCard(esc(title), '↓ in and ↑ out, stacked', [{label:'in', color:'var(--t-compose)', data:rx}, {label:'out', color:'var(--t-vm)', data:tx}], graphMax(0, [{data:rx}, {data:tx}], 'net'), 'net', `<button type="button" class="btn" data-ifclear="1">${icon('x', 2.2)}Clear</button>`);
  const P = PROCS.machine === m.id ? PROCS.list : null;
  let list;
  if (!P) list = `<div class="sub">Loading processes…</div>`;
  else {
    const on = P.filter(p => (p[15] || []).some(x => sel.includes(x))).sort((a, b) => (b[16] || 0) - (a[16] || 0) || b[4] - a[4]);
    list = on.length ? `<div class="scroll-x"><table class="tbl"><thead><tr><th>Process</th><th>PID</th><th style="text-align:left">Runs in</th><th>Network (TCP)</th><th style="text-align:left">Via</th></tr></thead><tbody>${on.slice(0, 15).map(p => `<tr><td>${esc(p[1])}</td><td>${p[0]}</td><td class="l"><button type="button" class="namebtn" data-select="${esc(p[10])}" style="font-weight:400">${esc(nodes[p[10]] ? nodes[p[10]].name : '')}</button></td><td>${p[16] >= 0 ? rateText(p[16]) : '—'}</td><td class="l">${esc((p[15] || []).filter(x => sel.includes(x)).join(', '))}</td></tr>`).join('')}</tbody></table></div>${on.length > 15 ? `<div class="more">${on.length - 15} more.</div>` : ''}` : `<div class="sub">Nothing is talking through ${xs.length === 1 ? 'this interface' : 'these interfaces'} right now.</div>`;
  }
  return card.replace(/<\/section>$/, `<h3 class="cpuproc">Using ${xs.length === 1 ? 'this interface' : 'these interfaces'}</h3>${list}</section>`);
}
// Pinned tiles (CPUs, CPU groups, GPUs, disks, interfaces) go first; stored by the server so they survive restarts.
let tpinBusy = false;
function tpinned(kind, mid, key){ return (TPINS[kind + '|' + mid] || []).includes(String(key)); }
function tpinBtn(kind, mid, key, label){ const on = tpinned(kind, mid, key); return `<button type="button" class="tpin${on ? ' on' : ''}" data-tpin="${esc(kind + '|' + mid + '|' + key)}" aria-pressed="${on}" aria-label="${on ? 'Unpin' : 'Pin'} ${esc(label || key)} to the top" title="${on ? 'Unpin' : 'Pin to the top'}">${icon('pin')}</button>`; }
const TILE_SORTS = {
  net:[['kind', 'Kind'], ['name', 'Name'], ['traffic', 'Total traffic'], ['down', 'Download'], ['up', 'Upload'], ['speed', 'Speed']],
  disk:[['name', 'Name'], ['busy', 'Busy'], ['read', 'Read'], ['write', 'Write'], ['total', 'Total'], ['size', 'Size']],
  gpu:[['index', 'Index'], ['usage', 'Usage']],
  cpu:[['number', 'Number'], ['usage', 'Usage'], ['clock', 'Clock']]
};
function tileSort(kind){ const v = (S.tileSort || {})[kind]; return TILE_SORTS[kind].some(o => o[0] === v) ? v : TILE_SORTS[kind][0][0]; }
function sortMenu(kind){ const v = tileSort(kind); return `<label class="sortsel">Sort <select data-tilesort="${kind}" aria-label="Sort tiles by">${TILE_SORTS[kind].map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`; }
function bySort(kind){
  const by = tileSort(kind), num = x => +x || 0, name = (a, b) => COLL.compare(String(a.name), String(b.name));
  const order = {physical:0, bridge:1, virtual:2};
  const f = {
    net:{kind:(a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3) || name(a, b), name, traffic:(a, b) => (b.rx + b.tx) - (a.rx + a.tx) || name(a, b),
         down:(a, b) => b.rx - a.rx || name(a, b), up:(a, b) => b.tx - a.tx || name(a, b), speed:(a, b) => num(b.speed) - num(a.speed) || name(a, b)},
    disk:{name, busy:(a, b) => b.busy - a.busy || name(a, b), read:(a, b) => b.read - a.read || name(a, b), write:(a, b) => b.write - a.write || name(a, b),
          total:(a, b) => (b.read + b.write) - (a.read + a.write) || name(a, b), size:(a, b) => b.size - a.size || name(a, b)},
    gpu:{index:(a, b) => a[1] - b[1], usage:(a, b) => b[2] - a[2] || a[1] - b[1]},
    cpu:{number:(a, b) => a.n - b.n, usage:(a, b) => b.pct - a.pct || a.n - b.n, clock:(a, b) => (b.mhz || 0) - (a.mhz || 0) || a.n - b.n}
  };
  return f[kind][by];
}
function pinFirst(kind, mid, keyOf){ return (a, b) => (tpinned(kind, mid, keyOf(b)) ? 1 : 0) - (tpinned(kind, mid, keyOf(a)) ? 1 : 0); }
async function toggleTilePin(spec){
  const [kind, mid, ...rest] = spec.split('|'), key = rest.join('|'), k = kind + '|' + mid;
  const list = (TPINS[k] || []).slice(), i = list.indexOf(key);
  if (i >= 0) list.splice(i, 1); else list.push(key);
  TPINS = Object.assign({}, TPINS, {[k]:list}); tpinBusy = true; lastMainHTML = ''; renderMain();
  try { const d = await api('/api/tilepins', TPINS); TPINS = d.tilepins || TPINS; } catch (e) { toast('Couldn’t save that pin'); }
  tpinBusy = false;
}
function diskToggle(){ return `<div class="seg" role="group" aria-label="Disk graph"><button type="button" data-diskview="type" aria-pressed="${S.diskView!=='each'}">By type</button><button type="button" data-diskview="each" aria-pressed="${S.diskView==='each'}">Each disk</button></div>`; }
// A saved pick of a disk or interface that's gone (unplugged, renamed) counts as not picked, like a GPU's.
function diskSel(m){ const D = DISKS[m.id]; return S.diskSel && S.diskSel.mid === m.id ? S.diskSel.names.filter(k => !D || !D.disks || D.disks.some(d => d.name === k)) : []; }
function bytesText(b){ return b >= 1e12 ? (b / 1e12).toFixed(b >= 1e13 ? 0 : 1) + ' TB' : b >= 1e9 ? Math.round(b / 1e9) + ' GB' : b ? Math.round(b / 1e6) + ' MB' : ''; }
function diskLabel(d){ return [d.role, d.model].filter(Boolean).join(' · ') || d.name; }
function diskEachCard(m){
  const D = DISKS[m.id], sel = diskSel(m);
  const head = `<div class="card-h"><h2>Each disk</h2><span class="sub">${D ? D.disks.length + ' disks · click one to see what uses it' : 'loading…'}</span><span class="grow"></span>${sortMenu('disk')}${diskToggle()}</div>`;
  if (!D) return `<section class="card">${head}</section>`;
  const tiles = D.disks.slice().sort((a, b) => pinFirst('disk', m.id, x => x.name)(a, b) || bySort('disk')(a, b)).map(d => {
    const on = sel.includes(d.name), tot = d.hr.map((v, i) => v + d.hw[i]), max = Math.max(1, ...tot) * 1.15;
    const pts = a => a.map((v, i) => `${(i/(H-1)*100).toFixed(1)},${(64 - v/max*58).toFixed(1)}`).join(' ');
    return `<div class="kcell${on ? ' sel' : ''}${tpinned('disk', m.id, d.name) ? ' pinned' : ''}"><button type="button" class="tsel" data-dsel="${esc(d.name)}" aria-pressed="${on}" aria-label="${esc(d.name)}, ${esc(diskLabel(d))}"></button>`
      + `<span class="trow"><span class="kn">${esc(d.name)}${tpinBtn('disk', m.id, d.name)}</span><span class="kb">${d.busy >= 0 ? pct(d.busy) + ' busy' : ''}</span></span>`
      + `<span class="km">${esc(diskLabel(d))}</span><span class="ks">${[bytesText(d.size), d.rot ? 'HDD' : 'SSD'].concat(d.mounts.slice(0, 2)).filter(Boolean).map(esc).join(' · ')}</span>`
      + `<span class="kr"><i class="rd">↓ ${rateText(d.read)}</i><i class="wr">↑ ${rateText(d.write)}</i></span><svg viewBox="0 0 100 64" preserveAspectRatio="none" aria-hidden="true"><path d="M0,64L${pts(tot).split(' ').join('L')}L100,64Z" fill="var(--t-compose)" fill-opacity=".28"/><polyline points="${pts(d.hr)}" fill="none" stroke="var(--t-compose)" stroke-width="1.5" vector-effect="non-scaling-stroke"/><polyline points="${pts(d.hw)}" fill="none" stroke="var(--t-vm)" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg></div>`;
  }).join('');
  return `<section class="card">${head}<div class="kgrid">${tiles}</div></section>`;
}
function diskSelCard(m){
  const D = DISKS[m.id], sel = diskSel(m);
  if (!D) return '';
  if (!sel.length) return `<p class="lhint">Click a disk to see its traffic and what uses it; ⌘/Ctrl- or Shift-click to pick several.</p>`;
  const ds = D.disks.filter(d => sel.includes(d.name));
  if (!ds.length) return '';
  const r = Array.from({length:H}, (_, i) => ds.reduce((s, d) => s + d.hr[i], 0)), w = Array.from({length:H}, (_, i) => ds.reduce((s, d) => s + d.hw[i], 0));
  const title = ds.length === 1 ? `${ds[0].name} · ${diskLabel(ds[0])}` : `${ds.length} disks: ${ds.map(d => d.name).join(', ')}`;
  const card = graphCard(esc(title), '↓ read and ↑ write, stacked', [{label:'read', color:'var(--t-compose)', data:r}, {label:'write', color:'var(--t-vm)', data:w}], graphMax(0, [{data:r}, {data:w}], 'disk'), 'disk', `<button type="button" class="btn" data-diskclear="1">${icon('x', 2.2)}Clear</button>`);
  const P = PROCS.machine === m.id ? PROCS.list : null;
  let list;
  if (!D.per_process) list = noteHTML(`${esc((m.os || 'This OS').split(' ')[0])} doesn’t report which disk each process uses, so Fleet can’t list processes per disk here.`);
  else if (!P) list = `<div class="sub">Loading processes…</div>`;
  else {
    const on = P.filter(p => (p[14] || []).some(x => sel.includes(x))).sort((a, b) => b[6] - a[6]);
    list = on.length ? `<div class="scroll-x"><table class="tbl"><thead><tr><th>Process</th><th>PID</th><th style="text-align:left">Runs in</th><th>Disk I/O (all disks)</th><th style="text-align:left">On</th></tr></thead><tbody>${on.slice(0, 15).map(p => `<tr><td>${esc(p[1])}</td><td>${p[0]}</td><td class="l"><button type="button" class="namebtn" data-select="${esc(p[10])}" style="font-weight:400">${esc(nodes[p[10]] ? nodes[p[10]].name : '')}</button></td><td>${rateText(p[6])}</td><td class="l">${esc((p[14] || []).filter(x => sel.includes(x)).join(', '))}</td></tr>`).join('')}</tbody></table></div>` : `<div class="sub">No process did I/O on ${ds.length === 1 ? 'this disk' : 'these disks'} in the last reading.</div>`;
  }
  return card.replace(/<\/section>$/, `<h3 class="cpuproc">Doing I/O on ${ds.length === 1 ? 'this disk' : 'these disks'}</h3>${list}</section>`);
}
function gpuToggle(){ return `<div class="seg" role="group" aria-label="GPU graph"><button type="button" data-gpuview="type" aria-pressed="${S.gpuView!=='each'}">By type</button><button type="button" data-gpuview="each" aria-pressed="${S.gpuView==='each'}">Each GPU</button></div>`; }
function gpuSel(m){ return S.gpuSel && S.gpuSel.mid === m.id ? S.gpuSel.keys.filter(k => m.gpus.some(g => g.key === k)) : []; }
function gpuHist(m, key){ const g = (m.inside || m).gseries; return (g && g[key]) || zero(); }   // a VM's own GPUs: its inside view
// A GPU's own utilisation, as its tiles show it; what the tree counts on it only for a GPU that doesn't report one.
function gpuUtil(m, key){ const g = m.gpus.find(x => x.key === key), u = g && (g.m || []).find(x => x[0] === 'util'); return u && u[2] && u[2].length === H ? u[2] : gpuHist(m, key); }
// Each GPU (issue #6): like the CCD viewer, a group per GPU with a live tile per metric it reports.
const GPU_M = {util:['Utilisation', '%'], '3d':['3D', '%'], compute:['Compute', '%'], copy:['Copy', '%'], video:['Video', '%'], encode:['Video encode', '%'],
  decode:['Video decode', '%'], vpp:['Video proc.', '%', 'Video processing'], jpeg:['JPEG', '%'], tiler:['Tiler', '%'], memctl:['Mem. controller', '%', 'Memory controller'],
  vram:['VRAM', 'B', 'Dedicated GPU memory'], shared:['Shared', 'B', 'Shared GPU memory (system RAM)'], sysmem:['Memory', 'B', 'Memory in use by the GPU'],
  temp:['Temperature', 'C'], power:['Power', 'W'], clock:['Clock', 'MHz', 'Core clock'], memclock:['Mem. clock', 'MHz', 'Memory clock'], fan:['Fan', '%'], fanrpm:['Fan', 'rpm']};
function gpuValText(unit, v){
  if (unit === '%') return pct(v);
  if (unit === 'B') return memText(v / 1073741824);
  if (unit === 'C') return Math.round(v) + ' °C';
  if (unit === 'W') return (v >= 10 ? Math.round(v) : v.toFixed(1)) + ' W';
  if (unit === 'MHz') return v >= 1000 ? (v / 1000).toFixed(2) + ' GHz' : Math.round(v) + ' MHz';
  if (unit === 'rpm') return Math.round(v).toLocaleString() + ' rpm';
  return num(v);
}
function gpuEachCard(m){
  const sel = gpuSel(m), mac = /mac/i.test(m.os || '');
  const groups = m.gpus.map((g, gi) => [g, gi, gpuUtil(m, g.key)[H-1]]).sort((a, b) => pinFirst('gpu', m.id, x => x[0].key)(a, b) || bySort('gpu')(a, b)).map(([g, gi]) => {
    const on = sel.includes(g.key);
    const metrics = g.m && g.m.length ? g.m : [['util', null, gpuHist(m, g.key)]];
    const util = gpuUtil(m, g.key);
    const tiles = metrics.map((x, i) => [x, i]).sort((a, b) => pinFirst('gpum', m.id, y => g.key + ':' + y[0][0])(a, b) || a[1] - b[1]).map(([[k, lim, h]]) => {
      const [label0, unit, long] = GPU_M[k] || [k, ''], label = k === '3d' && mac ? 'Renderer' : label0, full = long || label;
      const now = h[H-1], peak = Math.max(...h);
      const max = unit === '%' ? 100 : lim || (unit === 'C' ? Math.max(100, peak) : peak * 1.15 || 1);
      const pts = h.map((v, i) => `${(i/(H-1)*100).toFixed(1)},${(56 - Math.min(v, max)/max*52).toFixed(1)}`);
      const val = gpuValText(unit, now), sub = lim ? 'of ' + gpuValText(unit, lim) : '';
      return `<div class="lcell gmc${tpinned('gpum', m.id, g.key + ':' + k) ? ' pinned' : ''}" data-gm="${esc(k)}" title="${esc(full)}"><button type="button" class="tsel" data-gsel="${esc(g.key)}" aria-pressed="${on}" aria-label="GPU ${gi} ${esc(full)} ${esc(val)}${sub ? ' ' + esc(sub) : ''}"></button>`
        + `<span class="trow"><span class="lt">${esc(label)}${tpinBtn('gpum', m.id, g.key + ':' + k, label)}</span><span class="lv">${esc(val)}</span></span><span class="lm">${sub ? esc(sub) : '&nbsp;'}</span>`
        + `<svg viewBox="0 0 100 56" preserveAspectRatio="none" aria-hidden="true"><path d="M0,56L${pts.join('L')}L100,56Z" fill="var(--accent-bg)" fill-opacity=".35"/><polyline points="${pts.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg></div>`;
    }).join('');
    const pt = /passed through/.test(g.mem || '') ? `<p class="lhint">Its use shows inside that VM, not on this host.</p>` : '';
    return `<div class="ggroup${on ? ' sel' : ''}" data-gpu="${esc(g.key)}"><div class="lgh"><button type="button" class="lgbtn${on ? ' sel' : ''}" data-gsel="${esc(g.key)}" aria-pressed="${on}" title="See what runs on this GPU">GPU ${gi} · ${esc(g.name)}</button>${tpinBtn('gpu', m.id, g.key, 'GPU ' + gi)}<span>${esc(g.mem || '')}${g.host ? ' · on host ' + esc(g.host.replace('gpu', 'GPU ')) : ''}</span><span>now ${pct(util[H-1])}</span></div>${pt}<div class="lgrid">${tiles}</div></div>`;
  }).join('');
  return `<section class="card"><div class="card-h"><h2>Each GPU</h2><span class="sub">${m.gpus.length} GPU${m.gpus.length > 1 ? 's' : ''} · click one to see what runs on it</span><span class="grow"></span>${m.gpus.length > 1 ? sortMenu('gpu') : ''}${gpuToggle()}</div><div class="lgroups ggroups">${groups}</div></section>`;
}
function gpuSelCard(m){
  if (!m.gpus.length) return '';
  const sel = gpuSel(m);
  if (!sel.length) return `<p class="lhint">Click a GPU to see its use over time by what runs on it; ⌘/Ctrl- or Shift-click to compare several.</p>`;
  return sel.map(key => {
    const gi = m.gpus.findIndex(g => g.key === key), g = m.gpus[gi], h = gpuUtil(m, key);
    const cons = gpuConsumers(m, key);
    const top = cons.slice(0, 6);
    const hist = n => n.gseries[key] || zero();
    const series = top.map(c => ({label:c.n.name, color:colOf(c.n), data:hist(c.n)}));
    const rest = h.map((v, i) => Math.max(0, v - series.reduce((s, x) => s + x.data[i], 0)));
    if (rest.some(v => v > 0.05)) series.push({label:'everything else', color:'var(--t-base)', data:rest});
    const peak = Math.max(...h);
    const card = graphCard(`GPU ${gi} · ${esc(g.name)}`, `${esc(g.mem || '')}${g.mem ? ' · ' : ''}now ${pct(h[H-1])} · peak ${pct(peak)}`, series.length ? series : [{label:g.name, color:'var(--accent)', data:h}], 100, 'gpu', `<button type="button" class="btn" data-gpuclear="1">${icon('x', 2.2)}Clear</button>`);
    const list = cons.length ? `<div class="rank gpu-rank" style="margin-top:12px">${cons.slice(0, 12).map(c => `<button type="button" class="namebtn" data-select="${esc(c.n.id)}"><span class="ico" style="color:${colOf(c.n)}">${icon(iconOf(c.n))}</span>${esc(c.n.name)}</button><div class="track"><div class="bar" style="width:${Math.min(100, c.v).toFixed(2)}%;background:${colOf(c.n)}"></div></div><div class="tot">${pct(c.v)}</div>`).join('')}</div>` : `<div class="sub" style="margin-top:10px">${h[H-1] > 0.05 ? 'Nothing in the tree is counted on this GPU, though it’s busy. <b>Details</b> lists the processes using it.' : 'Nothing is using this GPU.'}</div>`;
    return card.replace(/<\/section>$/, list + '</section>');
  }).join('');
}
function cpuToggle(){ return `<div class="seg" role="group" aria-label="CPU graph"><button type="button" data-cpuview="type" aria-pressed="${S.cpuView==='type'}">By type</button><button type="button" data-cpuview="logical" aria-pressed="${S.cpuView==='logical'}">Logical processors</button></div>`; }
function logicalCard(m){
  const d = CPUS[m.id];
  const head = `<div class="card-h"><h2>Logical processors</h2><span class="sub">${esc(m.cpu_model || '')}${d && d.cpus ? ' · ' + d.cpus.length + ' processors' : ''}</span><span class="grow"></span>${sortMenu('cpu')}${cpuToggle()}</div>`;
  // The server answers {} for a machine it doesn't read itself (a VM seen only from its host).
  if (!d || !d.cpus) return `<section class="card">${head}<div class="sub">${d ? `No per-processor readings for ${esc(m.name)}.` : 'Loading…'}</div></section>`;
  const byN = {}; d.cpus.forEach(c => { byN[c.n] = c; });
  const sel = cpuSel(m);
  const groups = (d.groups && d.groups.length ? d.groups : [{name:'All processors', cpus:d.cpus.map(c => c.n)}]).map((g, i) => [g, i]).sort((a, b) => pinFirst('cpugroup', m.id, x => x[0].name)(a, b) || a[1] - b[1]).map(x => x[0]);
  const html = groups.map(g => {
    const cs = g.cpus.map(n => byN[n]).filter(Boolean);
    const avg = cs.reduce((s, c) => s + c.pct, 0) / (cs.length || 1);
    const cells = cs.slice().sort((a, b) => pinFirst('cpu', m.id, c => c.n)(a, b) || bySort('cpu')(a, b)).map(c => {
      const max = 100, pts = c.h.map((v, i) => `${(i/(H-1)*100).toFixed(1)},${(56 - Math.min(v, max)/max*52).toFixed(1)}`);
      const on = sel.includes(c.n);
      return `<div class="lcell${on ? ' sel' : ''}${tpinned('cpu', m.id, c.n) ? ' pinned' : ''}"><button type="button" class="tsel" data-lcpu="${c.n}" aria-pressed="${on}" aria-label="CPU ${c.n}, ${Math.round(c.pct)}%" data-tip="lcpu|${esc(m.id)}|${c.n}"></button><span class="trow"><span class="lt">CPU ${c.n}${tpinBtn('cpu', m.id, c.n, 'CPU ' + c.n)}</span><span class="lv">${Math.round(c.pct)}%</span></span><span class="lm">${c.mhz ? (c.mhz/1000).toFixed(2) + ' GHz' : '&nbsp;'}</span><svg viewBox="0 0 100 56" preserveAspectRatio="none" aria-hidden="true"><path d="M0,56L${pts.join('L')}L100,56Z" fill="var(--accent-bg)" fill-opacity=".35"/><polyline points="${pts.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg></div>`;
    }).join('');
    const gsel = cs.length && cs.every(c => sel.includes(c.n));
    return `<div><div class="lgh"><button type="button" class="lgbtn${gsel ? ' sel' : ''}" data-lgroup="${esc(g.cpus.join(','))}" aria-pressed="${gsel}" title="Show this group on its own">${esc(g.name)}</button>${tpinBtn('cpugroup', m.id, g.name)}<span>${cs.length} processors</span><span>average ${pct(avg)}</span></div><div class="lgrid">${cells}</div></div>`;
  }).join('');
  return `<section class="card">${head}<div class="lgroups">${html}</div></section>`;
}

/* ---------- views ---------- */
function typeSeries(getBt){ return TYPES.map(t => ({label:t.label, color:TCOL[t.id], data:Array.from({length:H}, (_, i) => getBt(i)[t.id])})).filter(s => s.data.some(v => v > 0)); }
function heroMachineTile(m){ return tileHTML(m.tile, machineOS(m), true); }

function fleetView(dv){
  const list = dv ? dv.children : roots, key = dv ? dv.id : 'fleet';
  const c = ctxOf(key), nVm = Object.values(nodes).filter(n => n.kind === 'machine' && n.parent && list.some(r => within(n, r.id))).length;
  const live = list.filter(r => isLive(r)).length;
  const stat = m => ({k:mlabel(m), v:pct(sumv(c.bt(m)) / c.cap(m) * 100), s:`${fmt(sumv(c.bt(m)), m)} of ${capText(c.cap(m), m)}`});
  const series = typeSeries(i => c.bt(S.metric, i));
  const fleetUsed = sumv(c.bt(S.metric));
  const mrows = (dv ? list.slice().sort(cmpNodes) : sortedRoots()).map(r => {
    const bt = byType(r, S.metric), used = sumv(bt), cap = capOf(r, S.metric);
    const den = S.mode === 'cap' ? cap : (used || 1);
    const off = !hasData(r);
    const bar = off ? `<div class="sbar empty">${esc(diagnose(r).title)}</div>` : cap ? `<div class="sbar">${TYPES.filter(t => bt[t.id] > 0).map(t => `<span class="s" style="width:${Math.min(100, bt[t.id]/den*100).toFixed(3)}%;background:${TCOL[t.id]}" data-tip="seg|${esc(r.id)}|${S.metric}|${t.id}"></span>`).join('')}</div>` : `<div class="sbar empty">no ${mlabel(S.metric)}</div>`;
    return `<div class="mrow"><button type="button" class="mbtn" data-select="${esc(r.id)}">${tileHTML(r.tile, machineOS(r), false)}<span>${esc(r.name)}</span><i class="sdot ${statusClass(r)}" title="${statusText(r)}"></i></button>${bar}<div class="tot">${!off && cap ? pct(used/cap*100) + ' used' : '—'}<small>${off ? '' : pct(used/(fleetUsed||1)*100) + ' of fleet ' + mlabel(S.metric)}</small></div></div>`;
  }).join('');
  const tile = dv ? `<span class="tile" style="background:color-mix(in srgb, ${dv.color} 22%, transparent);color:${dv.color}">${icon(dv.id === 'pins' ? 'pin' : iconOf(dv))}</span>` : `<span class="tile fleet">${icon('fleet')}</span>`;
  return `<div class="hero">${tile}<div><h1>${dv ? esc(dv.name) : 'All machines'}</h1><div class="facts">${dv ? `<span>${dv.id === 'pins' ? 'your pins' : esc(kindLabel(dv))}</span>` : ''}<span>${live} of ${list.length} machines live</span><span>${nVm} VMs</span><span>${cronCount({children:list})} scheduled jobs</span><span>${c.cap('cpu')} cores</span><span>${Math.round(c.cap('mem'))} GB RAM</span></div></div>${heroStats([stat('cpu'), stat('mem'), stat('gpu')])}</div>`
    + `<div class="grid2">${whereCard(key, dv ? `Where ${esc(dv.name)}’s usage goes` : 'Where your fleet’s usage goes')}${graphCard(`${dv ? esc(dv.name) : 'Fleet'} ${mlabel(S.metric)}`, 'live machines, by type', series, graphMax(c.cap(S.metric), series, S.metric), S.metric)}</div>`
    + `<section class="card"><div class="card-h"><h2>By machine · ${mlabel(S.metric)}</h2><span class="sub">each bar is that machine’s own ${S.mode === 'cap' ? 'capacity' : 'usage'}</span><span class="grow"></span>${modeSeg()}</div>${legendHTML(S.mode === 'cap')}${mrows}</section>`;
}

function machineView(m){
  const host = m.parent ? hostOf(m) : null;
  if (!hasData(m)) return offlineView(m);
  const ok = true;
  const stat = k => ({k:mlabel(k), v:capOf(m, k) ? pct(ownCur(m, k)/capOf(m, k)*100) : '—', s:capOf(m, k) ? `${fmt(ownCur(m, k), k)} of ${capText(capOf(m, k), k)}` : `no ${mlabel(k)}`});
  const stats = ok ? [stat('cpu'), stat('mem'), stat('gpu')] : [];
  if (ok && m.gpus.length > 1) stats[2] = {k:'GPU', v:pct(ownCur(m, 'gpu') / m.gpus.length), s:m.gpus.map((g, i) => `GPU${i} ${pct(sumv(gpuBt(m, g.key)))}`).join(' · ')};
  if (host && ok) stats.push({k:'of host ' + mlabel(S.metric), v:pct(shareOfHost(m, S.metric)), s:esc(host.name)});
  const series = typeSeries(i => byType(m, S.metric, i));
  const list = [];
  m.children.forEach(c => { list.push({n:c, d:0}); if (c.kind === 'group') orderedKids(c).forEach(cc => list.push({n:cc, d:1})); });
  const facts = [m.os, m.cpu_model, m.ncpu ? `${m.ncpu} logical CPUs` : '', capOf(m, 'mem') > 1 ? `${Math.round(capOf(m, 'mem'))} GB RAM` : ''].concat(m.gpus.map((g, i) => `GPU ${i}: ${g.name}`), [m.agent, m.uptime ? `up ${m.uptime}` : '', host ? `VM on ${host.name}` : '']).filter(Boolean);
  const pinned = PINS.includes(m.id);
  const head = `<div class="hero">${heroMachineTile(m)}<div><h1>${esc(m.name)} <i class="sdot ${statusClass(m)}" style="display:inline-block;vertical-align:middle"></i>${stalePill(m)}${termBtn(m)}</h1><div class="facts">${facts.map(f => `<span>${esc(f)}</span>`).join('')}</div></div>${heroStats(stats)}<button type="button" class="btn${pinned ? ' on' : ''}" data-pin="${esc(m.id)}" aria-pressed="${pinned}">${icon('pin')}${pinned ? 'Pinned' : 'Pin as space'}</button></div>`;
  let out = head;
  if (m.status === 'hostonly') out += noteHTML(`<b>Seen from its host.</b> ${esc(m.name)} can’t be reached directly, so this is what ${esc(host ? host.name : 'its host')} sees of it. <button type="button" class="linkbtn" data-retry="${esc(m.id)}">Retry</button>`);
  if (m.note) out += noteHTML(`<b>${esc(m.note.label)}</b> ${esc(m.note.text)}`);
  const cpuHead = S.metric === 'cpu' ? cpuToggle() : S.metric === 'gpu' && m.gpus.length ? gpuToggle() : S.metric === 'disk' ? diskToggle() : S.metric === 'net' ? ifToggle() : '';
  const graph = (S.metric === 'cpu' && S.cpuView === 'logical') || (S.metric === 'gpu' && S.gpuView === 'each' && m.gpus.length) || (S.metric === 'disk' && S.diskView === 'each') || (S.metric === 'net' && S.ifView === 'each') ? '' : graphCard(mlabel(S.metric), S.metric === 'gpu' && m.gpus.length > 1 ? `all ${m.gpus.length} GPUs, by type` : 'by type, stacked', series, graphMax(capOf(m, S.metric), series, S.metric), S.metric, cpuHead);
  const alt = S.metric === 'gpu' ? gpuEachCard(m) : S.metric === 'disk' ? diskEachCard(m) : S.metric === 'net' ? ifEachCard(m) : logicalCard(m);
  out += `<div class="grid2">${whereCard(m.id, m.parent ? 'Where this VM’s usage goes' : 'Where this machine’s usage goes')}${graph || alt}</div>`;
  if (!graph) out += S.metric === 'gpu' ? gpuSelCard(m) : S.metric === 'disk' ? diskSelCard(m) : S.metric === 'net' ? ifSelCard(m) : cpuSelCard(m);
  if (graph === '' ) {} // logical shown inline
  return out + gpuCard(m) + tableCard('Inside ' + esc(m.name), 'live', list);
}

function diagnose(m){
  const e = (m.error || '').toLowerCase(), host = esc(m.ssh || m.name), name = esc(m.name);
  const retry = 'Press <b>Retry now</b>.';
  if (m.status === 'disabled') return {kind:'off', ic:'power', title:'Not connected', text:`Fleet isn’t connecting to ${name}: its connection was turned off, or it isn’t in the machines <b>Connect automatically</b> connects to when Fleet starts. Connect to read it now.`, steps:[]};
  if (m.status === 'off') return {kind:'off', ic:'power', title:`${name} is stopped`, text:'Its host reports this VM as not running. Start it there and Fleet picks it up within a few seconds.', steps:[]};
  if (m.status === 'connecting' && !e) return {kind:'wait', ic:'refresh', title:`Connecting to ${name}…`, text:'Waiting for its first reading.', steps:[]};
  // a changed key ends in "host key verification failed" too; its banner is cut off (the server keeps ssh's last lines), its "host key for X has changed" line isn't
  const changed = /host key for (\S+) has changed|remote host identification has changed/.exec(e);
  if (changed) return {kind:'key', ic:'key', title:`${name}’s SSH host key has changed`,
    text:`SSH remembers another key for <code>${host}</code> than the one it was just sent, so it refused to connect. A rebuilt or reinstalled machine does that, but so does an impostor: check the new key before you trust it.`,
    steps:[`If you didn’t rebuild or reinstall ${name}, don’t connect: find out first why its key changed.`,
      'Otherwise read its new fingerprint on the machine itself, e.g. <code>ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code> on Linux, or the same file under <code>C:\\ProgramData\\ssh</code> on Windows.',
      `Remove the old key with <code>ssh-keygen -R ${esc(changed[1] || (m.ssh || m.name).replace(/^.*@/, ''))}</code>, then run <code>ssh ${host}</code>, check that the fingerprint matches, type <b>yes</b>, and log out.`, retry]};
  if (/host key verification failed/.test(e)) return {kind:'key', ic:'key', title:`Fleet can’t confirm this is really ${name}`,
    text:`SSH has no trusted host key for <code>${host}</code> yet, so it refused to connect. That’s SSH protecting you from an impostor; trusting the key once fixes it.`,
    steps:[`Open Terminal and run <code>ssh ${host}</code>.`, 'Check the fingerprint, type <b>yes</b> to trust it, then log out.', retry]};
  if (/permission denied|authentication failed|too many authentication failures/.test(e)) return {kind:'auth', ic:'lock', title:`${name} didn’t accept the login`,
    text:`The machine answered, but turned down the user or key Fleet used for <code>${host}</code>.`,
    steps:['Check the user in <b>Settings</b> (it looks like <code>user@host</code>).', `Authorize your SSH key there: <code>ssh-copy-id ${host}</code> for Linux; on Windows add it to the user’s <code>.ssh\\authorized_keys</code>, or <code>administrators_authorized_keys</code> for admin accounts.`, retry]};
  if (/could not resolve|name or service not known|nodename nor servname/.test(e)) return {kind:'dns', ic:'search2', title:`Fleet can’t find ${host}`,
    text:'That name doesn’t resolve to an address from this computer.', steps:['Check the spelling in <b>Settings</b>.', 'If it’s a Tailscale name, check that MagicDNS is on and the machine is on your tailnet.', retry]};
  if (/connection refused/.test(e)) return {kind:'down', ic:'wifi', title:`${name} is up, but SSH isn’t answering`,
    text:`Something answered at <code>${host}</code>, but nothing is listening for SSH on that port.`, steps:['Start the SSH server there (OpenSSH Server on Windows, <code>sshd</code> on Linux).', 'If it uses another port, set <code>Port</code> for this host in <code>~/.ssh/config</code>.', retry]};
  if (/timed out|no route|unreachable|connection closed|broken pipe|connection reset/.test(e)) return {kind:'down', ic:'wifi', title:`${name} isn’t answering`,
    text:`Nothing came back from <code>${host}</code>. It may be asleep or off, off your tailnet, or SSH may be on another port.`, steps:['Check that it’s on and connected to Tailscale.', 'If SSH uses another port, set it in <code>~/.ssh/config</code>.', retry]};
  if (/python3/.test(e)) return {kind:'py', ic:'terminal', title:`${name} needs Python 3`,
    text:'Fleet reads Linux machines and Macs with a small read-only Python script and installs nothing, but it needs <code>python3</code> there.',
    steps:[/mac/i.test(m.os || '') ? 'On that Mac, run <code>xcode-select --install</code> once (the Command Line Tools bring <code>python3</code>).' : 'Install Python 3 on that machine, e.g. <code>sudo apt install python3</code>.', retry]};
  return {kind:'other', ic:'info', title:`Fleet can’t reach ${name}`, text:'The connection ended before the first reading.', steps:['Check the details below, or the machine’s entry in <b>Settings</b>.', retry]};
}
function termBtn(n){
  const ok = n.kind === 'machine' ? (n.agent === 'local' || !!n.ssh) : (n.kind === 'service' || n.kind === 'container');
  if (!ok) return '';
  const label = n.kind === 'machine' ? 'Open terminal' : 'Open shell';
  return `<span class="termsplit"><button type="button" class="termbtn" data-terminal="${esc(n.id)}" title="${n.kind === 'machine' ? (n.agent === 'local' ? 'A new shell on this computer' : 'ssh ' + esc(n.ssh)) : 'A shell inside this container'}">${icon('terminal')}${label}</button><button type="button" class="termchev" data-termchoose="${esc(n.id)}" aria-haspopup="menu" aria-label="Open in a specific terminal" title="Open in a specific terminal">${icon('chev', 2.4)}</button></span>`;
}
function offlineView(m){
  const d = diagnose(m), host = m.parent ? hostOf(m) : null;
  const facts = [m.os, m.ssh ? 'ssh ' + m.ssh : '', host ? `VM on ${host.name}` : ''].filter(Boolean);
  const pinned = PINS.includes(m.id);
  return `<div class="hero">${heroMachineTile(m)}<div><h1>${esc(m.name)} <span class="spill ${d.kind}">${esc(statusText(m))}</span>${termBtn(m)}</h1><div class="facts">${facts.map(f => `<span>${esc(f)}</span>`).join('')}</div></div><button type="button" class="btn${pinned ? ' on' : ''}" data-pin="${esc(m.id)}" aria-pressed="${pinned}" style="margin-left:auto">${icon('pin')}${pinned ? 'Pinned' : 'Pin as space'}</button></div>`
    + `<section class="state"><div class="state-ic ${d.kind}">${icon(d.ic)}</div><div class="state-body"><h2>${d.title}</h2><p>${d.text}</p>`
    + (d.steps.length ? `<ol class="steps">${d.steps.map(x => `<li><span>${x}</span></li>`).join('')}</ol>` : '')
    + `<div class="state-actions">${m.status === 'disabled' ? `<button type="button" class="btn primary" data-conn="${esc(m.id)}" aria-pressed="false">${icon('power')}Connect</button>` : m.status === 'off' ? '' : `<button type="button" class="btn primary" data-retry="${esc(m.id)}">${icon('refresh')}Retry now</button>`}<button type="button" class="btn" data-settings="1">${icon('gear')}Open Settings</button></div>`
    + (m.error ? `<details class="state-raw"${S.rawOpen ? ' open' : ''}><summary>Technical details</summary><code>${esc(m.error)}</code><div>${m.lastOk ? 'Last reading ' + ago(staleFor(m)) : 'No reading yet'} · retrying on its own</div></details>` : '')
    + `</div></section>`;
}

function groupView(n){
  const host = hostOf(n), kids = n.children.slice().sort((a, b) => cur(b, S.metric) - cur(a, S.metric));
  const max = Math.max(...kids.map(k => cur(k, S.metric)), 1e-9), total = cur(n, S.metric);
  const kindLabel = n.kind === 'project' ? `Compose project · ${n.children.length} services` : `${n.name} · ${n.children.length}`;
  const ranks = kids.slice(0, 40).map(k => { const v = cur(k, S.metric); return `<button type="button" class="namebtn" data-select="${esc(k.id)}"><span class="ico" style="color:${colOf(k)}">${icon(iconOf(k))}</span>${esc(k.name)}</button><div class="track"><div class="bar" style="width:${(v/max*100).toFixed(2)}%;background:${TCOL[n.type]}" data-tip="child|${esc(k.id)}|${S.metric}"></div></div><div class="tot">${pct(v/capOf(host, S.metric)*100)}<small>${fmt(v, S.metric)} · ${pct(v/(total||1)*100)} of ${esc(n.name)}</small></div>`; }).join('');
  const list = [];
  orderedKids(n).forEach(c => { list.push({n:c, d:0}); if (c.kind === 'project') orderedKids(c).forEach(cc => list.push({n:cc, d:1})); });
  const series = [{label:n.name, color:TCOL[n.type], data:n.series[S.metric]}];
  const facts = [kindLabel, `on ${host.name}`].concat(n.meta && n.meta.file ? [n.meta.file] : []).concat([`${cronCount(n)} scheduled jobs`]);
  const pinned = PINS.includes(n.id);
  return `<div class="hero"><span class="tile" style="background:color-mix(in srgb, ${TCOL[n.type]} 22%, transparent);color:${TCOL[n.type]}">${icon(iconOf(n))}</span><div><h1>${esc(n.name)}</h1><div class="facts">${facts.map(f => `<span>${esc(f)}</span>`).join('')}</div></div>${heroStats(['cpu','mem','gpu'].map(k => ({k:mlabel(k) + ' of host', v:pct(shareOfHost(n, k)), s:fmt(cur(n, k), k)})))}<button type="button" class="btn${pinned ? ' on' : ''}" data-pin="${esc(n.id)}" aria-pressed="${pinned}">${icon('pin')}${pinned ? 'Pinned' : 'Pin as space'}</button></div>`
    + `<div class="grid2"><section class="card"><div class="card-h"><h2>Where ${esc(n.name)}’s ${mlabel(S.metric)} goes</h2><span class="sub">% of host${kids.length > 40 ? ' · top 40' : ''}</span></div><div class="rank">${ranks}</div></section>${graphCard(mlabel(S.metric), esc(n.name), series, graphMax(0, series, S.metric), S.metric)}</div>`
    + tableCard('Inside ' + esc(n.name), 'live', list);
}

function leafView(n){
  const host = hostOf(n), cronF = n.children.find(c => c.kind === 'cronfolder');
  const ref = n.parent, refName = ref.kind === 'machine' ? 'the machine’s use' : esc(ref.name);
  const tiles = METRICS.map(m => { const v = cur(n, m.id); return `<div class="st" data-tip="child|${esc(n.id)}|${m.id}"><div class="k">${m.label}</div><div class="v">${fmt(v, m.id)}</div><div class="s">${m.id === 'gpu' ? gpuSub(n) : `${pct(v/capOf(host, m.id)*100)} of host · ${pct(v/(cur(ref, m.id)||1)*100)} of ${refName}`}</div>${sparkSVG(n.series[m.id], colOf(n), 120, 34)}</div>`; }).join('');
  const detail = n.kind === 'base'
    ? noteHTML('<b>Base system</b> is everything on the host that isn’t a Compose service, a container, a VM or a scheduled job: the OS, daemons and your apps. Open <b>Details</b> to see its processes.')
    : `<section class="card"><div class="card-h"><h2>Details</h2></div><dl class="dl"><dt>Image</dt><dd><code>${esc(n.meta.image)}</code></dd>${n.meta.project ? `<dt>Compose project</dt><dd>${esc(n.meta.project)}</dd>` : ''}${n.meta.status ? `<dt>Status</dt><dd>${esc(n.meta.status)}</dd>` : ''}<dt>Host</dt><dd>${esc(host.name)}</dd><dt>GPU</dt><dd>${host.gpus.length ? (esc(whichGpuLong(n)) || 'none in use') : 'host has no GPU'}</dd></dl></section>`;
  const series = [{label:n.name, color:colOf(n), data:n.series[S.metric]}];
  const pinned = PINS.includes(n.id);
  return `<div class="hero"><span class="tile" style="background:color-mix(in srgb, ${colOf(n)} 22%, transparent);color:${colOf(n)}">${icon(iconOf(n))}</span><div><h1>${esc(n.name)}${n.kind !== 'base' ? termBtn(n) : ''}</h1><div class="facts"><span>${n.kind === 'base' ? 'Base system' : n.kind === 'service' ? 'Compose service' : 'Container'}</span><span>on ${esc(host.name)}</span>${cronF ? `<span>${cronF.children.length} ${esc(cronF.name.toLowerCase())}</span>` : ''}</div></div>${n.kind !== 'base' ? `<button type="button" class="btn${pinned ? ' on' : ''}" data-pin="${esc(n.id)}" aria-pressed="${pinned}" style="margin-left:auto">${icon('pin')}${pinned ? 'Pinned' : 'Pin as space'}</button>` : ''}</div>`
    + `<div class="tiles">${tiles}</div>`
    + (cronF ? cronTableCard(cronF, esc(cronF.name) + ' in ' + esc(n.name)) : '')
    + `<div class="grid2">${graphCard(mlabel(S.metric), cronF ? 'includes its scheduled jobs' : esc(n.name), series, graphMax(0, series, S.metric), S.metric)}${detail}</div>`;
}
function cronFolderView(f){
  const owner = f.parent, host = hostOf(f);
  const series = [{label:f.name, color:colOf(owner), data:f.series[S.metric]}];
  return `<div class="hero"><span class="tile" style="background:var(--track);color:var(--ink-2)">${icon('clock')}</span><div><h1>${esc(f.name)} in ${esc(owner.name)}</h1><div class="facts"><span>${f.children.length} jobs</span><span>on ${esc(host.name)}</span></div></div>${heroStats([{k:'running now', v:String(f.children.filter(c => c.running).length), s:`of ${f.children.length}`}])}</div>`
    + noteHTML(`${esc(f.name)} run inside <b>${esc(owner.name)}</b>, so their usage is already part of its numbers.`)
    + cronTableCard(f, 'Jobs')
    + graphCard(`${mlabel(S.metric)} from ${esc(f.name.toLowerCase())}`, 'all jobs here', series, graphMax(0, series, S.metric), S.metric);
}
function cronView(n){
  const j = n.job, owner = ownerOf(n), host = hostOf(n);
  const tiles = METRICS.map(m => { const v = cur(n, m.id); return `<div class="st" data-tip="child|${esc(n.id)}|${m.id}"><div class="k">${m.label}</div><div class="v">${n.running ? fmt(v, m.id) : '—'}</div><div class="s">${m.id === 'gpu' ? gpuSub(n) : n.running ? `${pct(v/capOf(host, m.id)*100)} of host · ${pct(v/(cur(owner, m.id)||1)*100)} of ${esc(owner.name)}` : 'idle'}</div>${sparkSVG(n.series[m.id], colOf(owner), 120, 34)}</div>`; }).join('');
  const series = [{label:n.name, color:colOf(owner), data:n.series[S.metric]}];
  return `<div class="hero"><span class="tile" style="background:var(--track);color:var(--ink-2)">${icon('clock')}</span><div><h1>${esc(n.name)}</h1><div class="facts"><span>${n.parent.name === 'Scheduled tasks' ? 'scheduled task' : 'scheduled job'}</span><span>in ${esc(owner.name)}</span><span>on ${esc(host.name)}</span></div></div><div class="hero-stats"><span class="pill${n.running?' on':''}"><i></i>${n.running ? 'running now' : esc(j.state || 'idle')}</span></div></div>`
    + `<div class="tiles">${tiles}</div>`
    + `<div class="grid2"><section class="card"><div class="card-h"><h2>Schedule</h2></div><dl class="dl"><dt>Schedule</dt><dd><code>${esc(j.sched)}</code>${j.human && j.human !== j.sched ? ' · ' + esc(j.human) : ''}</dd><dt>Command</dt><dd><code>${esc(j.cmd)}</code></dd><dt>Source</dt><dd><code>${esc(j.src || '')}</code></dd><dt>Runs inside</dt><dd>${esc(owner.name)} on ${esc(host.name)}</dd><dt>Last / next</dt><dd>${esc(j.last || '—')}</dd></dl></section>`
    + graphCard(mlabel(S.metric), 'spikes are runs', series, graphMax(0, series, S.metric), S.metric) + `</div>`;
}

/* ---------- Details: sortable process list ---------- */
function procMachineFor(n){
  const m = n.kind === 'machine' ? n : machineOf(n);
  if (!m) return null;
  if (m.status === 'ok') return m.id;
  return m.parent ? hostOf(m).id : m.id;
}
function cpuGroupNames(mid){
  const m = nodes[mid], map = {};
  (m && m.groups || []).forEach(g => g.cpus.forEach(c => { map[c] = g.name; }));
  return map;
}
const STATE = {R:'running', S:'sleeping', D:'disk wait', Z:'zombie', T:'stopped', t:'traced', I:'idle', U:'waiting', X:'dead'};
function stateLabel(s){ return s ? (STATE[s[0]] || s) : ''; }
// Details follows what is selected on its machine: processors (CPU → Logical processors), GPUs (GPU →
// Each GPU), disks (Disk I/O → Each disk) and interfaces (Network → Each interface), all at once,
// combined with AND, whichever pill is active.
// Each part names itself; a host that can't attribute one says why and isn't filtered by it.
function cpuSelLabel(m, cpus){
  const whole = (m.groups || []).filter(g => g.cpus.length && g.cpus.every(c => cpus.includes(c)));
  const inWhole = new Set(whole.flatMap(g => g.cpus));
  if (whole.length && cpus.every(c => inWhole.has(c))) return whole.map(g => g.name).join(' + ');
  return (cpus.length === 1 ? 'CPU ' : 'CPUs ') + cpuRanges(cpus);
}
function selectionFilters(m, all, gpuProcs){
  if (!m) return [];
  const os = (m.os || 'This OS').replace(/^Microsoft /, '').split(' ')[0], out = [];
  const cpus = cpuSel(m);
  if (cpus.length){
    const short = cpuSelLabel(m, cpus), label = /^CPUs? /.test(short) ? short : `${short} (${cpus.length === 1 ? 'CPU ' : 'CPUs '}${cpuRanges(cpus)})`;
    out.push({kind:'cpu', short, label, chip:'Last ran on ' + short,
      tip:`Details lists only the processes that last ran on ${label} at the latest reading. Processes move between processors, so this is where each one ran last, not where it always runs.`,
      apply:!all || all.some(p => p[12] >= 0) ? (p => cpus.includes(p[12])) : null,
      why:`${os} doesn’t report which processor a process last ran on, so Details isn’t filtered by ${short}.`});
  }
  const keys = gpuSel(m);
  if (keys.length){
    const idx = keys.map(k => +k.replace('gpu', ''));
    const short = idx.map(i => 'GPU ' + i).join(' + '), label = idx.map(i => `GPU ${i}${m.gpus[i] ? ' (' + m.gpus[i].name + ')' : ''}`).join(', ');
    out.push({kind:'gpu', short, label, chip:'On ' + short, tip:`Details lists only the processes using ${label} at the latest reading.`,
      apply:gpuProcs === false ? null : (p => (p[13] || []).some(i => idx.includes(i))),
      why:`${os} doesn’t report which GPU a process uses, so Details isn’t filtered by ${short}.`});
  }
  const names = diskSel(m);
  if (names.length){
    const D = DISKS[m.id], ds = D ? D.disks.filter(d => names.includes(d.name)) : [];
    const short = names.length === 1 ? names[0] : names.length + ' disks', label = names.length === 1 && ds[0] ? `${names[0]} (${diskLabel(ds[0])})` : names.join(', ');
    const per = D ? D.per_process : !/^(macOS|Windows)/.test(os);
    out.push({kind:'disk', short, label, chip:'I/O on ' + short, tip:`Details lists only the processes that read or wrote ${label} since the last reading.`,
      apply:per ? (p => (p[14] || []).some(x => names.includes(x))) : null,
      why:`${os} doesn’t report which disk a process uses, so Details isn’t filtered by ${short}.`});
  }
  const ifn = ifSel(m);
  if (ifn.length){
    const D = IFS[m.id], xs = D ? D.ifs.filter(x => ifn.includes(x.name)) : [];
    const short = ifn.length === 1 ? ifn[0] : ifn.length + ' interfaces', label = ifn.length === 1 && xs[0] ? `${ifn[0]} (${ifKind(xs[0])})` : ifn.join(', ');
    out.push({kind:'net', short, label, chip:'Traffic via ' + short, tip:`Details lists only the processes whose network traffic goes through ${label} (their connections, their container’s network or their VM’s interface).`,
      apply:p => (p[15] || []).some(x => ifn.includes(x)), why:''});
  }
  return out;
}
// The node whose processes a Details view shows right now (full or docked), or null.
function shownDetails(){
  const n = S.sel === 'fleet' ? null : nodes[S.sel];
  if (S.view === 'details') return n || roots[0] || null;
  return S.detailsDocked && S.tree !== 'network' ? n : null;
}
// Left of the view pills: what Details is filtered to, each part with its own ×, plus Clear all; and a
// dot on the CPU, GPU and Disk I/O pills while their selection filters Details.
let lastBarHTML = null;
function renderFilterBar(){
  const bar = $('dfbar'); if (!bar) return;
  const n = shownDetails(), mid = n && procMachineFor(n), m = mid && nodes[mid];
  const fs = m ? selectionFilters(m, PROCS.machine === mid ? PROCS.list : null, PROCS.machine === mid ? PROCS.gpuProcs : undefined) : [];
  const html = fs.length ? `<span class="dflabel">Filter</span>` + fs.map(f => `<span class="fchip${f.apply ? '' : ' na'}" data-barchip="${f.kind}" title="${esc(f.apply ? m.name + ': ' + f.tip : f.why)}"><span>${esc(f.short)}</span><button type="button" data-dfclear="${f.kind}" aria-label="Clear the ${esc(f.short)} filter">${icon('x', 2.4)}</button></span>`).join('')
    + (fs.length > 1 ? `<button type="button" class="dfall" data-dfclear="all">Clear all</button>` : '') : '';
  if (html !== lastBarHTML){ bar.innerHTML = html; lastBarHTML = html; }
  bar.hidden = !fs.length;
  ['cpu', 'gpu', 'disk', 'net'].forEach(k => {
    const b = document.querySelector(`#metrics [data-metric="${k}"]`), f = fs.find(x => x.kind === k); if (!b) return;
    b.classList.toggle('filtered', !!f);
    if (f) b.title = 'Details is filtered: ' + f.chip; else b.removeAttribute('title');
  });
}
function filterChips(fs){
  if (!fs.length) return '';
  const chips = fs.map(f => `<span class="fchip${f.apply ? '' : ' na'}" data-fchip="${f.kind}" title="${esc(f.apply ? f.tip : f.why)}"><span>${esc(f.chip)}</span><button type="button" data-dfclear="${f.kind}" aria-label="Clear the filter: ${esc(f.chip)}">${icon('x', 2.4)}</button></span>`).join('');
  return `<div class="dfchips" role="group" aria-label="Details is filtered">${chips}</div>` + fs.filter(f => !f.apply).map(f => noteHTML(esc(f.why))).join('');
}
// Details groups are collapsed unless opened; open ones are kept per Group-by mode.
function groupOpen(mode, g){ return !!(S.groupOpen && S.groupOpen[mode] && S.groupOpen[mode].includes(String(g))); }
function setGroupsOpen(mode, names){ S.groupOpen = Object.assign({}, S.groupOpen, {[mode]:names}); save(); renderMain(); }
function detailsView(n, docked){
  const mid = procMachineFor(n);
  const m = nodes[mid];
  const ncpu = m ? (m.ncpu || capOf(m, 'cpu')) : 1;
  const gnames = cpuGroupNames(mid);
  const all = PROCS.machine === mid ? PROCS.list : null;
  const scopeAll = n.id === mid;
  let list = all ? (scopeAll ? all : all.filter(p => nodes[p[10]] && within(nodes[p[10]], n.id))) : [];
  const FS = selectionFilters(m, all, PROCS.machine === mid ? PROCS.gpuProcs : undefined);
  FS.forEach(f => { if (f.apply) list = list.filter(f.apply); });
  const q = S.filter.trim().toLowerCase();
  if (q) list = list.filter(p => String(p[0]) === q || (p[1] || '').toLowerCase().includes(q) || (p[9] || '').toLowerCase().includes(q) || (p[2] || '').toLowerCase().includes(q));
  const ownerName = id => nodes[id] ? nodes[id].name : '';
  const groupOf = p => p[12] >= 0 ? (gnames[p[12]] || 'CPU ' + p[12]) : 'not reported by this OS';
  const COLS = [
    {k:'name', label:'Name', l:true, get:p => (p[1] || '').toLowerCase(), show:p => esc(p[1])},
    {k:'pid', label:'PID', get:p => pidNum(p[0]), show:p => isVmKey(p[0]) ? `${esc(pidNum(p[0]))} <span class="vmtag" title="Runs in Docker Desktop’s Linux VM: this is its PID there">VM</span>` : esc(p[0])},
    {k:'owner', label:'Runs in', l:true, get:p => ownerName(p[10]).toLowerCase(), show:p => `<button type="button" class="namebtn" data-select="${esc(p[10])}" style="font-weight:400">${esc(ownerName(p[10]))}</button>`},
    {k:'user', label:'User', l:true, get:p => p[2] || '', show:p => esc(p[2] || '—')},
    {k:'state', label:'Status', l:true, get:p => stateLabel(p[3]), show:p => esc(stateLabel(p[3]) || '—')},
    {k:'cpu', label:'CPU', get:p => p[4], show:p => pct(p[4] / ncpu * 100)},
    {k:'mem', label:'Memory', get:p => p[5], show:p => memText(p[5])},
    {k:'disk', label:'Disk', get:p => p[6], show:p => rateText(p[6])},
    {k:'gpu', label:'GPU', get:p => p[7], show:p => p[7] ? pct(p[7]) : '—'},
    {k:'net', label:'Network', get:p => p[16] || 0, show:p => p[16] > 0 ? rateText(p[16]) : p[16] === 0 ? '0' : '—'},
    {k:'threads', label:'Threads', get:p => p[8], show:p => esc(p[8] || '—')},
    {k:'cpugroup', label:'CPU group', l:true, get:p => groupOf(p), show:p => esc(p[12] >= 0 ? groupOf(p) + ' · cpu' + p[12] : '—')},
    {k:'cmd', label:'Command line', l:true, cls:'cmd', get:p => p[9] || '', show:p => `<span title="${esc(p[9])}">${esc(p[9])}</span>`},
    {k:'ppid', label:'Parent PID', get:p => p[11] || 0, show:p => esc(p[11] || '—')},
    {k:'lastcpu', label:'Last CPU', get:p => p[12], show:p => p[12] >= 0 ? esc('cpu' + p[12]) : '—'},
    {k:'gpus', label:'Which GPU', l:true, get:p => (p[13] || []).join(','), show:p => (p[13] || []).length ? 'GPU' + p[13].join('+') : '—'},
    {k:'disks', label:'Disks used', l:true, get:p => (p[14] || []).join(','), show:p => esc((p[14] || []).join(', ') || '—')},
    {k:'ifaces', label:'Interfaces', l:true, get:p => (p[15] || []).join(','), show:p => esc((p[15] || []).join(', ') || '—')}
  ];
  const ALLCOLS = COLS.splice(0), SORT = detailSort();
  colLayout().forEach(k => { const c = ALLCOLS.find(x => x.k === k); if (c) COLS.push(c); });
  if (!COLS.length) COLS.push(ALLCOLS[0]);
  const col = ALLCOLS.find(c => c.k === SORT.k) || COLS[0];
  const dir = SORT.dir;
  list = list.slice().sort((a, b) => { const x = col.get(a), y = col.get(b); return (x < y ? -1 : x > y ? 1 : 0) * dir || b[4] - a[4]; });
  // A process is open: rows keep the places they had when it opened (new ones go last), so nothing moves under you.
  const holding = INSP.pid && INSP.mid === mid && INSP.order;
  if (holding){ const pos = new Map(INSP.order.map((pid, i) => [pid, i])); list = list.filter(p => pos.has(p[0])).sort((a, b) => pos.get(a[0]) - pos.get(b[0])).concat(list.filter(p => !pos.has(p[0]))); }
  const groupBy = {none:null, cpugroup:groupOf, owner:p => nodes[p[10]] ? p[10] : '—', user:p => p[2] || '—', state:p => stateLabel(p[3]) || '—'}[S.group];
  const LIMIT = 400;
  let body = '', shown = 0, more = '';
  const isInsp = p => INSP.pid === p[0] && INSP.mid === mid;
  let inspShown = false;
  const rowHTML = p => `<tr data-pid="${esc(p[0])}" aria-expanded="${isInsp(p)}" class="drow${isInsp(p) ? ' open' : ''}">${COLS.map(c => `<td class="${c.l ? 'l' : ''} ${c.cls || ''}">${c.show(p)}</td>`).join('')}</tr>`  // data-pid: columns can move or hide
    + (isInsp(p) ? (inspShown = true, `<tr class="pinsp"><td colspan="${COLS.length}">${inspectPanel(p)}</td></tr>`) : '');
  if (groupBy){
    // Groups start collapsed, each header a summary; open ones are remembered per Group-by mode (S.groupOpen)
    // and share the row limit.
    const groups = new Map();
    list.forEach(p => { const g = groupBy(p); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(p); });
    // Where it runs is keyed by tree node; a name two of them share (db in two Compose projects) says what each is in
    const names = S.group === 'owner' ? [...groups.keys()].map(ownerName) : [];
    const label = g => { const o = S.group === 'owner' && nodes[g]; if (!o) return g; const par = o.kind === 'cron' ? ownerOf(o) : o.parent; return names.filter(x => x === o.name).length > 1 && par ? o.name + ' · ' + par.name : o.name; };
    let ordered = [...groups.entries()].sort((a, b) => b[1].reduce((s, p) => s + p[4], 0) - a[1].reduce((s, p) => s + p[4], 0));
    if (holding && INSP.gorder){ const gp = new Map(INSP.gorder.map((g, i) => [g, i])); ordered = ordered.filter(x => gp.has(x[0])).sort((a, b) => gp.get(a[0]) - gp.get(b[0])).concat(ordered.filter(x => !gp.has(x[0]))); }
    const isOpen = g => groupOpen(S.group, g);
    const nOpen = ordered.filter(([g]) => isOpen(g)).length;
    const per = nOpen ? Math.max(10, Math.floor(LIMIT / nOpen)) : 0;
    let closedN = 0, closedG = 0, cut = 0;
    ordered.forEach(([g, ps]) => {
      const c = ps.reduce((s, p) => s + p[4], 0), mem = ps.reduce((s, p) => s + p[5], 0), open = isOpen(g);
      const dk = ps.reduce((s, p) => s + (p[6] || 0), 0), nt = ps.reduce((s, p) => s + Math.max(0, p[16] || 0), 0);
      body += `<tr class="gh"><td colspan="${COLS.length}"><button type="button" class="ghbtn" data-gtoggle="${esc(g)}" aria-expanded="${open}" aria-label="${open ? 'Collapse' : 'Expand'} ${esc(label(g))}">${icon('chev', 2.4)}${esc(label(g))}<span>${ps.length} process${ps.length === 1 ? '' : 'es'} · CPU ${pct(c / ncpu * 100)} · ${memText(mem)}${dk > 0 ? ' · disk ' + rateText(dk) : ''}${nt > 0 ? ' · net ' + rateText(nt) : ''}</span></button></td></tr>`;
      if (!open){ closedN += ps.length; closedG++; return; }
      ps.slice(0, per).forEach(p => { body += rowHTML(p); shown++; });
      cut += Math.max(0, ps.length - per);
    });
    if (shown < list.length)
      more = `Showing ${shown} of ${list.length} processes.`
        + (closedG ? ` ${closedN} ${closedN === 1 ? 'is' : 'are'} in ${closedG} collapsed group${closedG === 1 ? '; open it' : 's; open a group'} to see ${closedN === 1 ? 'it' : 'them'}.` : '')
        + (cut ? ` Open groups show their first ${per}; sort or filter to see others.` : '');
  } else {
    list.slice(0, LIMIT).forEach(p => { body += rowHTML(p); shown++; });
    if (list.length > shown) more = `Showing ${shown} of ${list.length}. Sort or filter to see others.`;
  }
  const hasGroups = (m && m.groups || []).length > 1;
  // the machine isn't answering: its list is from the last reading, or there is none (never "0 processes")
  const off = m && !isLive(m);
  const count = !all ? 'loading…' : off && !all.length ? statusText(m) : list.length + ' processes';
  const offNote = off && all ? noteHTML(all.length ? `<b>${esc(m.name)} is ${statusText(m)}.</b> These are its processes at the last reading${m.lastOk ? ', ' + ago(staleFor(m)) : ''}; the list updates when it answers again.` : `<b>${esc(m.name)} is ${statusText(m)}</b>, so there are no processes to show. They appear here when it answers.`) : '';
  const groupNote = Object.keys(gnames).length && all && !all.some(p => p[12] >= 0) && S.group === 'cpugroup' && !FS.some(f => f.kind === 'cpu') ? noteHTML('This OS doesn’t report which processor a process last ran on, so CPU groups can’t be assigned per process here. The <b>Logical processors</b> view under CPU still shows each group.') : '';
  const head = docked
    ? `<div class="dhead"><div class="dtitle"><b>Details · ${esc(n.name)}${FS.length ? ' · ' + esc(FS.map(f => f.label).join(' · ')) : ''}</b><span>${count} on ${esc(m ? m.name : '')}</span></div><button type="button" class="iconbtn" data-undock="1" title="Pop out to the full Details view" aria-label="Pop out Details">${icon('layers')}</button><button type="button" class="iconbtn" data-closedock="1" title="Close the Details panel" aria-label="Close the Details panel">${icon('x', 2.2)}</button></div>`
    : `<div class="hero"><span class="tile" style="background:var(--track);color:var(--ink-2)">${icon('chip')}</span><div><h1>Details · ${esc(n.name)}${FS.length ? ' · ' + esc(FS.map(f => f.label).join(' · ')) : ''}</h1><div class="facts"><span>${count}</span><span>on ${esc(m ? m.name : '')}</span>${hasGroups ? `<span>CPU groups: ${esc(m.groups.map(g => g.name).join(', '))}</span>` : ''}</div></div><button type="button" class="btn" data-dock="1" style="margin-left:auto" title="Or drag the Details pill onto the right side">${icon('layers')}Dock to the right</button></div>`;
  const tools = `<div class="dtools"><input type="search" id="pfilter" placeholder="Filter by name, PID, user or command" value="${esc(S.filter)}" aria-label="Filter processes"><label>Group by <select id="pgroup"><option value="none"${S.group==='none'?' selected':''}>Nothing</option><option value="cpugroup"${S.group==='cpugroup'?' selected':''}>CPU group (CCD, P-/E-cores)</option><option value="owner"${S.group==='owner'?' selected':''}>Where it runs (tree node)</option><option value="user"${S.group==='user'?' selected':''}>User</option><option value="state"${S.group==='state'?' selected':''}>Status</option></select></label>${groupBy ? `<span class="gall"><button type="button" class="btn" data-gall="open">Expand all</button><button type="button" class="btn" data-gall="close">Collapse all</button></span>` : ''}</div>`;
  const thead = `<tr>${COLS.map(c => `<th class="${c.l ? 'l' : ''}" data-colk="${c.k}" ${c.k === SORT.k ? `aria-sort="${dir < 0 ? 'descending' : 'ascending'}"` : ''}><button type="button" data-sort="${c.k}" title="Sort; right-click to choose and arrange columns">${c.label}${c.k === SORT.k ? (dir < 0 ? ' ↓' : ' ↑') : ''}</button></th>`).join('')}</tr>`;
  const applied = FS.filter(f => f.apply);
  // the open process isn't in the list any more (it exited, or the filter hides it): its drop-down goes first
  if (INSP.pid && INSP.mid === mid && !inspShown && all) body = `<tr class="pinsp"><td colspan="${COLS.length}">${inspectPanel(null)}</td></tr>` + body;
  if (applied.length && all && !list.length && !INSP.pid) body = `<tr class="empty"><td colspan="${COLS.length}" class="l" style="padding:18px 10px;color:var(--ink-3)">No process matches ${esc(applied.map(f => f.short).concat(q ? ['“' + S.filter.trim() + '”'] : []).join(' + '))} right now.</td></tr>`;
  const hold = holding ? `<div class="holdbar">${icon('pin')}<span>Rows hold their places while <b>${esc(INSP.name || 'PID ' + INSP.pid)}</b> is open</span><button type="button" class="btn" data-inspclose="1">Resume live order</button></div>` : '';
  return head + groupNote + offNote + `<section class="card">${tools}${filterChips(FS)}${hold}<div class="pscroll"><table class="ptbl" data-mid="${esc(mid)}"><thead>${thead}</thead><tbody>${body}</tbody></table>${more ? `<div class="more">${more}</div>` : ''}</div></section>`;
}

/* ---------- network detail ---------- */
function netView(){
  buildNet();
  const n = netNodes[S.netSel] || netNodes['net:tailnet'];
  if (!n) return `<div class="hero"><div><h1>Network</h1><div class="facts"><span>Loading…</span></div></div></div>`;
  const facts = [];
  if (n.kind === 'nmachine'){ if (n.ts){ facts.push('tailnet ' + (n.ts.ip || '')); facts.push(n.ts.online === false ? 'offline on tailnet' : n.ts.direct ? 'direct connection' : n.ts.relay ? 'relayed via ' + n.ts.relay : ''); } facts.push(statusText({status:n.status})); if (n.vm_on) facts.push('VM'); }
  if (n.kind === 'if'){ facts.push(n.ifkind); if (n.state) facts.push(n.state); if (n.speed && n.speed !== '-1') facts.push(/^\d+$/.test(n.speed) ? n.speed + ' Mb/s' : n.speed); facts.push(...n.addrs); if (n.desc) facts.push(n.desc); if (n.vm) facts.push('VM: ' + n.vm); if (n.dnet) facts.push('Docker network: ' + n.dnet); }
  let graph = '';
  if (n.hrx && n.htx) graph = graphCard('Traffic', '↓ received and ↑ sent, stacked', [{label:'received', color:'var(--t-compose)', data:n.hrx}, {label:'sent', color:'var(--t-vm)', data:n.htx}], graphMax(0, [{data:n.hrx}, {data:n.htx}], 'net'), 'net');
  const rows = n.children.map(c => `<tr><td><button type="button" class="namebtn" data-netsel="${esc(c.id)}">${esc(c.name)}</button></td><td class="l">${esc(c.kind === 'if' ? c.ifkind : c.kind === 'nmachine' ? statusText({status:c.status}) : c.kind === 'ncontainer' ? 'container' : '')}</td><td class="l">${esc((c.addrs || []).join(', ') || (c.ts && c.ts.ip) || '')}</td><td>${rateText(c.rx)}</td><td>${rateText(c.tx)}</td></tr>`).join('');
  return `<div class="hero"><span class="tile fleet">${icon(n.kind === 'tailnet' ? 'net' : n.kind === 'if' ? (n.ifkind === 'bridge' ? 'bridge' : 'nic') : 'desktop')}</span><div><h1>${esc(n.name)}</h1><div class="facts">${facts.filter(Boolean).map(f => `<span>${esc(f)}</span>`).join('')}</div></div>${heroStats([{k:'In', v:rateText(n.rx), s:'received'}, {k:'Out', v:rateText(n.tx), s:'sent'}])}</div>`
    + (n.error ? noteHTML(`<b>${esc(statusText({status:n.status}))}.</b> ${esc(n.error)}`, 'warn') : '')
    + graph
    + (rows ? `<section class="card"><div class="card-h"><h2>${n.kind === 'tailnet' ? 'Machines' : n.kind === 'nmachine' ? 'Interfaces' : 'Attached'}</h2></div><div class="scroll-x"><table class="tbl"><thead><tr><th>Name</th><th style="text-align:left">Kind</th><th style="text-align:left">Address</th><th>In</th><th>Out</th></tr></thead><tbody>${rows}</tbody></table></div></section>` : '');
}

/* ---------- main ---------- */
let lastMainHTML = '';
// A text selection in the pane (a command line to copy) survives its rebuild: each end is kept as its process
// row (rows re-sort) or the pane, the child path down to the text, and the offset there.
function selEnd(root, node, off){
  const row = (node.nodeType === 1 ? node : node.parentNode).closest('tr[data-pid]'), top = row && root.contains(row) ? row : root, path = [];
  for (let n = node; n !== top; n = n.parentNode) path.unshift([...n.parentNode.childNodes].indexOf(n));
  return {pid:top === row ? row.dataset.pid : null, path, off};
}
function selAt(root, e){
  let n = e.pid ? root.querySelector(`tr[data-pid="${CSS.escape(e.pid)}"]`) : root;
  for (const i of e.path){ if (!n) break; n = n.childNodes[i]; }
  return n ? [n, Math.min(e.off, n.nodeType === 3 ? n.length : n.childNodes.length)] : null;   // its process exited: gone
}
let resizing = false;  // the docked panel's edge is being dragged: hold the page still till it's let go
function renderMain(){
  if (resizing) return;  // a rebuild would replace the handle, which drops its pointer capture and strands the drag
  renderFilterBar();
  const main = $('main');
  const a = document.activeElement;
  let refocus = null, refocusAt = 0, selStart = null, selStop = null, selDir;   // selStop: not selEnd, the selection helper above
  if (a && main.contains(a)){
    if (a.id) { refocus = '#' + a.id; selStart = a.selectionStart; selStop = a.selectionEnd; selDir = a.selectionDirection; }
    else if (a.dataset) for (const k of ['select', 'mode', 'sort', 'pin', 'cpuview', 'netsel', 'gtoggle', 'gall', 'tilesort', 'lcpu', 'lgroup', 'tpin']) if (a.dataset[k] != null){ refocus = `[data-${k}="${CSS.escape(a.dataset[k])}"]`; break; }
    if (refocus) refocusAt = Math.max(0, [...main.querySelectorAll(refocus)].indexOf(a));   // a view can draw the same button twice (a card and a table)
  }
  let html;
  let panel = '';
  if (S.tree === 'network' && S.view !== 'details') html = netView();
  else {
    const n = S.sel === 'fleet' ? null : nodes[S.sel];
    if (S.view === 'details') html = detailsView(n || (roots[0] || {id:'', name:'—'}));
    else html = !n ? (S.pinsOnly && S.space === 'fleet' ? pinsView() : fleetView()) : n.kind === 'division' && !n.parent ? fleetView(n) : n.kind === 'machine' ? machineView(n) : n.kind === 'cronfolder' ? cronFolderView(n) : n.kind === 'cron' ? cronView(n) : n.hist ? leafView(n) : groupView(n);
    if (S.detailsDocked && S.view !== 'details')
      panel = n ? detailsView(n, true) : `<div class="dhead"><div class="dtitle"><b>Details</b><span>Select a machine or anything in it to see its processes.</span></div><button type="button" class="iconbtn" data-closedock="1" aria-label="Close the Details panel">${icon('x', 2.2)}</button></div>`;
  }
  const full = panel
    ? `<div class="split"><div class="wrap">${html}</div><aside class="dpanel" style="width:${Math.round(S.dockW || 560)}px" aria-label="Details panel"><div class="dresize" data-resize="1" role="separator" aria-orientation="vertical" aria-label="Resize the Details panel" title="Drag to resize"></div>${panel}</aside></div>`
    : `<div class="wrap">${html}</div>`;
  if (full === lastMainHTML) return;
  lastMainHTML = full;
  // the panels inside are rebuilt: keep where each was scrolled (the docked Details, the page beside it, wide tables)
  const pos = scrollSnapshot(main);
  const sel = getSelection(), ends = sel.rangeCount && !sel.isCollapsed && main.contains(sel.anchorNode) && main.contains(sel.focusNode) && selStart == null
    ? [selEnd(main, sel.anchorNode, sel.anchorOffset), selEnd(main, sel.focusNode, sel.focusOffset)] : null;
  main.innerHTML = full;
  scrollRestore(main, pos);
  if (KEEP.pending){   // after a reload: back where you were, as soon as each pane is long enough
    if (KEEP.pending.ctx !== scrollCtx() || Date.now() - KEEP.t > 15000) KEEP.pending = null;
    else { const left = scrollRestore(main, KEEP.pending.pos); KEEP.pending = Object.keys(left).length ? {ctx:KEEP.pending.ctx, pos:left} : null; }
  }
  markPanel(); if (FIND.q) applyFind(false);
  if (ends){ const x = selAt(main, ends[0]), y = selAt(main, ends[1]); if (x && y) try { sel.setBaseAndExtent(x[0], x[1], y[0], y[1]); } catch (e) {} }
  if (refocus){ const all = main.querySelectorAll(refocus), e = all[refocusAt] || all[0]; if (e){ e.focus({preventScroll:true}); if (selStart != null && e.setSelectionRange) try { e.setSelectionRange(selStart, selStop, selDir); } catch (x) {} } }
}
function renderAll(){ renderSpaces(); renderToolbar(); renderTree(); renderMain(); refreshTip(); }
// Scrolled panes, each known by what it is (not where it sits in a list, which changes when a table comes or goes)
const SCROLLERS = '.split > .wrap, .dpanel, .pscroll, .scroll-x';
function scrollKey(e){
  if (e.matches('main')) return 'main';
  if (e.matches('.dpanel')) return 'dpanel';
  if (e.matches('.split > .wrap')) return 'wrap';
  const sec = e.closest('section'), h = sec && sec.querySelector('h2, h3');
  return (e.matches('.pscroll') ? 'p:' : 'x:') + (e.closest('.dpanel') ? 'd:' : '') + (h ? h.textContent.trim() : '');
}
function scrollCtx(){ return [S.sel, S.view, S.metric, S.detailsDocked ? 'dock' : ''].join('|'); }
function scrollSnapshot(root){ const o = {}; [root, ...root.querySelectorAll(SCROLLERS)].forEach(e => { if (e.scrollTop || e.scrollLeft) o[scrollKey(e)] = [e.scrollTop, e.scrollLeft]; }); return o; }
// put each pane back; returns the ones not yet long enough to get there
function scrollRestore(root, pos){
  const left = {};
  [root, ...root.querySelectorAll(SCROLLERS)].forEach(e => { const k = scrollKey(e), v = pos[k]; if (!v) return; e.scrollTop = v[0]; e.scrollLeft = v[1]; if (Math.abs(e.scrollTop - v[0]) > 1) left[k] = v; });
  return left;
}
let keepTimer = 0;
document.addEventListener('scroll', () => {
  clearTimeout(keepTimer);
  keepTimer = setTimeout(() => { try { sessionStorage.setItem('fleet-scroll', JSON.stringify({ctx:scrollCtx(), pos:scrollSnapshot($('main'))})); } catch (e) {} }, 150);
}, true);
['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(t => addEventListener(t, () => { KEEP.pending = null; }, {capture:true, passive:true}));

/* ---------- tooltips ---------- */
const tip = $('tip');
function tipHTML(h){
  const p = h.k.split('|');
  if (h.k === 'graph' && lastGraph){
    const i = h.idx, g = lastGraph; let tot = 0;
    const rows = g.series.slice().reverse().map(s => { tot += s.data[i]; return `<div class="r"><span><i class="sw" style="background:${s.color}"></i>${esc(s.label)}</span><b>${fmt(s.data[i], g.metric)}</b></div>`; }).join('');
    return `<div class="t">${i === H-1 ? 'now' : ago((H-1-i) * INTERVAL)}</div><div class="u">${mlabel(g.metric)}</div>${rows}${g.series.length > 1 ? `<div class="r"><span>Total</span><b>${fmt(tot, g.metric)}</b></div>` : ''}`;
  }
  if (p[0] === 'seg'){
    const c = ctxOf(p[1]), bt = c.bt(p[2]), v = bt[p[3]], used = sumv(bt), cap = c.cap(p[2]);
    const t = TYPES.find(x => x.id === p[3]);
    return `<div class="t"><i class="sw" style="background:${TCOL[t.id]}"></i> ${t.label}</div><div class="u">${esc(c.name)} · ${mlabel(p[2])}</div><div class="r"><span>Using</span><b>${fmt(v, p[2])}</b></div><div class="r"><span>of capacity</span><b>${pct(v/cap*100)}</b></div><div class="r"><span>of what’s in use</span><b>${pct(v/(used||1)*100)}</b></div>`;
  }
  if (p[0] === 'gseg'){
    const m = nodes[p[1]]; if (!m) return null;
    const gi = m.gpus.findIndex(g => g.key === p[2]), bt = gpuBt(m, p[2]), v = bt[p[3]], used = sumv(bt);
    const t = TYPES.find(x => x.id === p[3]);
    return `<div class="t"><i class="sw" style="background:${TCOL[t.id]}"></i> ${t.label}</div><div class="u">${esc(m.name)} · GPU ${gi} · ${esc(m.gpus[gi].name)}</div><div class="r"><span>of this GPU</span><b>${pct(v)}</b></div><div class="r"><span>of what’s in use</span><b>${pct(v/(used||1)*100)}</b></div>`;
  }
  if (p[0] === 'gpu'){
    const m = nodes[p[1]], n = nodes[p[3]]; if (!m || !n) return null;
    const gi = m.gpus.findIndex(g => g.key === p[2]), c = gpuConsumers(m, p[2]).find(x => x.n === n);
    return `<div class="t">${esc(n.name)}</div><div class="u">GPU ${gi} · ${esc(m.gpus[gi].name)}</div><div class="r"><span>of this GPU</span><b>${pct(c ? c.v : 0)}</b></div>`;
  }
  if (p[0] === 'lcpu'){
    const d = CPUS[p[1]]; if (!d) return null;
    const c = d.cpus.find(x => String(x.n) === p[2]); if (!c) return null;
    const g = (d.groups || []).find(g => g.cpus.includes(c.n));
    return `<div class="t">CPU ${c.n}</div><div class="u">${esc(g ? g.name : '')}${c.core !== '' && c.core != null ? ' · core ' + esc(c.core) : ''}</div><div class="r"><span>Utilization</span><b>${pct(c.pct)}</b></div>${c.mhz ? `<div class="r"><span>Frequency</span><b>${(c.mhz/1000).toFixed(2)} GHz</b></div>` : ''}`;
  }
  if (p[0] === 'child'){
    const n = nodes[p[1]]; if (!n) return null;
    const host = hostOf(n), v = cur(n, p[2]), par = n.kind === 'cron' ? ownerOf(n) : n.parent;
    return `<div class="t">${esc(n.name)}</div><div class="u">${mlabel(p[2])}${n.kind === 'cron' ? (n.running ? ' · running' : ' · idle') : ''}</div><div class="r"><span>Using</span><b>${fmt(v, p[2])}</b></div><div class="r"><span>of ${esc(host.name)}</span><b>${pct(v/capOf(host, p[2])*100)}</b></div>${par ? `<div class="r"><span>of ${esc(par.name)}</span><b>${pct(v/(cur(par, p[2])||1)*100)}</b></div>` : ''}`;
  }
  return null;
}
function placeTip(){
  const r = tip.getBoundingClientRect();
  let x = S.mx + 16, y = S.my + 16;
  if (x + r.width > innerWidth - 8) x = S.mx - r.width - 16;
  if (y + r.height > innerHeight - 8) y = S.my - r.height - 16;
  tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
}
function refreshTip(){
  if (!S.hover){ tip.hidden = true; return; }
  let h = null; try { h = tipHTML(S.hover); } catch (e) { h = null; }
  if (!h){ tip.hidden = true; return; }
  tip.innerHTML = h; tip.hidden = false; placeTip();
}
document.addEventListener('mousemove', e => {
  S.mx = e.clientX; S.my = e.clientY;
  const g = e.target.closest('[data-graph]');
  if (g){
    const r = g.getBoundingClientRect();
    const idx = Math.max(0, Math.min(H-1, Math.round((e.clientX - r.left) / r.width * (H-1))));
    S.hover = {k:'graph', idx};
    const c = g.querySelector('.cross'); c.style.display = 'block'; c.style.left = (idx/(H-1)*100) + '%';
    refreshTip(); return;
  }
  const t = e.target.closest('[data-tip]');
  if (t){ S.hover = {k:t.dataset.tip}; refreshTip(); return; }
  if (S.hover){ if (S.hover.k === 'graph') document.querySelectorAll('.cross').forEach(c => c.style.display = 'none'); S.hover = null; refreshTip(); }
});
document.addEventListener('mouseleave', () => { S.hover = null; refreshTip(); });

/* ---------- actions ---------- */
async function api(path, body){
  const r = await fetch(path, {method:'POST', headers:{'Content-Type':'application/json', 'X-Fleet':'1'}, body:JSON.stringify(body)});
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
// Pins (~/.config/fleet/pins.json) are saved whole. An answer older than the latest save, from a poll that overlapped
// a save or from an earlier save, never replaces PINS: the next pin would build on it and drop this one (#95).
let pinsSeq = 0, pinsSaves = 0;
async function setPins(pins){
  const seq = ++pinsSeq; pinsSaves++;
  PINS = pins;
  renderSpaces(); renderTree(); renderMain(); renderPickerList(); lastSig = sigOf();   // drawn with these pins: a poll that brings others redraws
  try { const d = await api('/api/pins', pins); if (seq === pinsSeq) PINS = d.pins || pins; } catch (e) {}
  pinsSaves--;
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
  if (e.target === $('tree')){ selectNone(); return; }
  // a machine's dot (or Connect on its page) turns its connection off or on; it doesn't select the row
  const cn = e.target.closest('[data-conn]'); if (cn){ e.stopPropagation(); setConnected(cn.dataset.conn, cn.getAttribute('aria-pressed') !== 'true'); return; }
  if (e.target.closest('[data-autoconn]')){ openAutoConn(e.target.closest('[data-autoconn]')); return; }
  // a group's chevron folds it to its header, or unfolds it as it was
  const tf = e.target.closest('[data-tgfold]'); if (tf){ S.gfold = Object.assign({}, S.gfold, {[tf.dataset.tgfold]:tf.getAttribute('aria-expanded') === 'true'}); save(); renderTree(); const b = document.querySelector(`[data-tgfold="${CSS.escape(tf.dataset.tgfold)}"]`); if (b) b.focus(); return; }
  // a group's header selects the group: its own all-up view (a fleet's is All machines for its members)
  const tgh = e.target.closest('#tree .tg-h');
  if (tgh && !e.target.closest('input, [data-pin], [data-unpin]') && S.tree !== 'network'){ const id = 'div:' + tgh.closest('.tgroup').dataset.tgroup; buildDivisions(); if (nodes[id]) select(id); return; }   // empty space in a tree: nothing selected, everything shown
  const nv = e.target.closest('[data-nav]'); if (nv){ navGo(nv.dataset.nav === 'back' ? -1 : 1); return; }
  const fs = e.target.closest('[data-mfstep]'); if (fs){ stepFind(+fs.dataset.mfstep); return; }
  if (e.target.closest('[data-mfclose]')){ closeFind(); return; }
  if (e.target.closest('[data-inspclose]')){ closeInspect(); return; }
  const lb = e.target.closest('[data-lookback]'); if (lb){ PREFS = Object.assign({}, PREFS, {cacheLookback:+lb.dataset.lookback}); lastMainHTML = ''; renderMain(); savePrefs('the cache lookback'); return; }
  const look = e.target.closest('[data-vmlook]');
  if (look && typeof INSP.pid === 'string'){ INSP.via = look.dataset.vmlook; INSP.data = null; INSP.good = null; INSP.acc = {}; INSP.samples = 0; INSP.secs = 0; INSP.looks = 0; INSP.cacheLooks = []; lastMainHTML = ''; renderMain(); inspectTick(); return; }
  const prow = e.target.closest('.ptbl tbody tr[data-pid]');
  if (prow && !e.target.closest('button, a, input, select, label')){
    const k = prow.dataset.pid;   // a process in Docker Desktop's VM is keyed d:<container>:<pid>
    toggleInspect(prow.closest('.ptbl').dataset.mid, isVmKey(k) ? k : +k, prow); return;
  }
  const tp = e.target.closest('[data-tpin]'); if (tp){ e.stopPropagation(); toggleTilePin(tp.dataset.tpin); return; }
  const ap = e.target.closest('[data-addpin]'); if (ap){ PICK.open ? closePicker(false) : openPicker(); return; }
  const st = e.target.closest('[data-settings]'); if (st){ openSettings(); return; }
  if (e.target.closest('[data-addmachinedlg]')){ openAddMachine(); return; }
  const tc = e.target.closest('[data-termchoose]'); if (tc){ loadTerms().then(() => { const r = tc.getBoundingClientRect(); openCtx(termMenu(tc.dataset.termchoose), r.left, r.bottom + 4, tc); }); return; }
  const tm = e.target.closest('[data-terminal]'); if (tm){ const n = nodes[tm.dataset.terminal]; api('/api/terminal', {node:tm.dataset.terminal}).then(r => toast(r.ok ? `Opened ${r.title} in ${r.terminal}` : (r.error || 'Couldn’t open a terminal'))).catch(() => toast('Couldn’t reach Fleet')); return; }
  const rt = e.target.closest('[data-retry]'); if (rt){ rt.disabled = true; rt.innerHTML = icon('refresh') + 'Retrying…'; api('/api/retry', {machine:rt.dataset.retry}).catch(() => null); setTimeout(() => { lastMainHTML = ''; refreshNow(); }, 2500); return; }   // a fast failure reads the same as before: redraw anyway, so Retry comes back
  if (PICK.open && !$('picker').contains(e.target)) closePicker(false);
  const up = e.target.closest('[data-unpin]'); if (up){ e.stopPropagation(); togglePin(up.dataset.unpin); if (S.space === up.dataset.unpin) goSpace('fleet'); return; }
  const pn = e.target.closest('[data-pin]'); if (pn){ e.stopPropagation(); togglePin(pn.dataset.pin); return; }
  const tg = e.target.closest('[data-toggle]');
  if (tg){ const id = tg.dataset.toggle; const n = nodes[id] || netNodes[id]; S.open[id] = !(nodes[id] ? isOpen(n) : netOpen(n)); save(); renderTree(); return; }
  const go = e.target.closest('[data-groupsonly]'); if (go){ S.groupsOnly = !S.groupsOnly; save(); renderTree(); const b = document.querySelector('[data-groupsonly]'); if (b) b.focus(); return; }
  const po = e.target.closest('[data-pinsonly]'); if (po){ S.pinsOnly = po.dataset.pinsonly === '1'; save(); renderTree(); return; }
  const tr = e.target.closest('[data-tree]'); if (tr){ S.tree = tr.dataset.tree; if (S.tree === 'network') S.view = 'overview'; lastMainHTML = ''; save(); renderAll(); refreshNow(); return; }
  const ns = e.target.closest('[data-netsel]'); if (ns){ S.netSel = ns.dataset.netsel; S.tree = 'network'; save(); renderTree(); renderToolbar(); renderMain(); return; }
  const sp = e.target.closest('[data-space]'); if (sp){ goSpace(sp.dataset.space); return; }
  const se = e.target.closest('[data-select]'); if (se){ select(se.dataset.select); return; }
  const me = e.target.closest('[data-metric]'); if (me){ S.metric = me.dataset.metric; S.view = 'overview'; save(); renderAll(); refreshNow(); return; }
  const de = e.target.closest('[data-details]'); if (de){ if (!S.dockTipShown){ S.dockTipShown = true; setTimeout(() => toast('Tip: drag Details onto the right half, or press the panel button beside it, to dock it next to the overview.'), 400); } S.view = 'details'; S.detailsDocked = false; if (S.tree === 'network') S.tree = 'machines'; save(); renderAll(); refreshNow(); return; }
  if (e.target.closest('[data-dock]')){ dockDetails(); return; }
  if (e.target.closest('[data-undock]')){ S.detailsDocked = false; S.view = 'details'; save(); renderAll(); return; }
  if (e.target.closest('[data-closedock]')){ S.detailsDocked = false; save(); renderAll(); return; }
  const dc = e.target.closest('[data-dfclear]'); if (dc){ const k = dc.dataset.dfclear; if (k === 'cpu' || k === 'all') S.cpuSel = null; if (k === 'gpu' || k === 'all') S.gpuSel = null; if (k === 'disk' || k === 'all') S.diskSel = null; if (k === 'net' || k === 'all') S.ifSel = null; save(); renderMain(); return; }
  const gt = e.target.closest('[data-gtoggle]');
  if (gt){ const g = gt.dataset.gtoggle, cur = (S.groupOpen && S.groupOpen[S.group]) || []; setGroupsOpen(S.group, cur.includes(g) ? cur.filter(x => x !== g) : cur.concat([g])); return; }
  const ga = e.target.closest('[data-gall]');
  if (ga){ setGroupsOpen(S.group, ga.dataset.gall === 'open' ? [...document.querySelectorAll('[data-gtoggle]')].map(b => b.dataset.gtoggle) : []); return; }
  const so = e.target.closest('[data-sort]'); if (so){ const k = so.dataset.sort, cur0 = detailSort(); S.sorts = Object.assign({}, S.sorts, {[S.metric]:{k, dir:cur0.k === k ? -cur0.dir : (['name','owner','user','state','cpugroup','cmd','gpus','disks','ifaces'].includes(k) ? 1 : -1)}}); save(); lastMainHTML = ''; renderMain(); return; }
  const lc = e.target.closest('[data-lcpu]'), lg = e.target.closest('[data-lgroup]');
  if (lc || lg){
    const m = nodes[S.sel]; if (!m) return;
    const pick = lc ? [+lc.dataset.lcpu] : lg.dataset.lgroup.split(',').map(Number);
    const curSel = cpuSel(m), add = e.metaKey || e.ctrlKey || e.shiftKey;
    let next;
    if (add){ const all = pick.every(n => curSel.includes(n)); next = all ? curSel.filter(n => !pick.includes(n)) : [...new Set(curSel.concat(pick))]; }
    else next = (curSel.length === pick.length && pick.every(n => curSel.includes(n))) ? [] : pick;
    S.cpuSel = {mid:m.id, cpus:next}; save(); renderMain(); refreshNow(); return;
  }
  if (e.target.closest('[data-cpuclear]')){ S.cpuSel = null; save(); renderMain(); return; }
  const iv = e.target.closest('[data-ifview]'); if (iv){ S.ifView = iv.dataset.ifview; save(); renderMain(); refreshNow(); return; }
  if (e.target.closest('[data-ifclear]')){ S.ifSel = null; save(); renderMain(); return; }
  const is = e.target.closest('[data-isel]');
  if (is){ const m = nodes[S.sel]; if (!m) return; const k = is.dataset.isel, c0 = ifSel(m), add = e.metaKey || e.ctrlKey || e.shiftKey;
    const next = add ? (c0.includes(k) ? c0.filter(x => x !== k) : c0.concat([k])) : (c0.length === 1 && c0[0] === k ? [] : [k]);
    S.ifSel = {mid:m.id, names:next}; save(); renderMain(); refreshNow(); return; }
  const dv = e.target.closest('[data-diskview]'); if (dv){ S.diskView = dv.dataset.diskview; save(); renderMain(); refreshNow(); return; }
  if (e.target.closest('[data-diskclear]')){ S.diskSel = null; save(); renderMain(); return; }
  const ds = e.target.closest('[data-dsel]');
  if (ds){ const m = nodes[S.sel]; if (!m) return; const k = ds.dataset.dsel, cur0 = diskSel(m), add = e.metaKey || e.ctrlKey || e.shiftKey;
    const next = add ? (cur0.includes(k) ? cur0.filter(x => x !== k) : cur0.concat([k])) : (cur0.length === 1 && cur0[0] === k ? [] : [k]);
    S.diskSel = {mid:m.id, names:next}; save(); renderMain(); refreshNow(); return; }
  const gv = e.target.closest('[data-gpuview]'); if (gv){ S.gpuView = gv.dataset.gpuview; save(); renderMain(); return; }
  if (e.target.closest('[data-gpuclear]')){ S.gpuSel = null; save(); renderMain(); return; }
  const gs = e.target.closest('[data-gsel]');
  if (gs){ const m = nodes[S.sel]; if (!m) return; const k = gs.dataset.gsel, curSel = gpuSel(m), add = e.metaKey || e.ctrlKey || e.shiftKey;
    const next = add ? (curSel.includes(k) ? curSel.filter(x => x !== k) : curSel.concat([k])) : (curSel.length === 1 && curSel[0] === k ? [] : [k]);
    S.gpuSel = {mid:m.id, keys:next}; save(); renderMain(); return; }
  const cv = e.target.closest('[data-cpuview]'); if (cv){ S.cpuView = cv.dataset.cpuview; save(); renderMain(); refreshNow(); return; }
  const mo = e.target.closest('[data-mode]'); if (mo){ S.mode = mo.dataset.mode; save(); renderMain(); return; }
});
document.addEventListener('input', e => {
  if (e.target.id === 'pfilter'){ S.filter = e.target.value; save(); renderMain(); }
  if (e.target.id === 'pickq'){ PICK.q = e.target.value; renderPickerList(); }
});
$('picker').addEventListener('keydown', e => {
  if (e.key === 'Escape'){ e.preventDefault(); closePicker(true); }
  if (e.key === 'Enter' && e.target.id === 'pickq'){ const first = $('picklist').querySelector('[data-pin]'); if (first){ e.preventDefault(); togglePin(first.dataset.pin); } }
});
document.addEventListener('change', e => {
  if (e.target.id === 'pgroup'){ S.group = e.target.value; save(); renderMain(); }
  if (e.target.dataset && e.target.dataset.tilesort){ S.tileSort = Object.assign({}, S.tileSort, {[e.target.dataset.tilesort]:e.target.value}); save(); lastMainHTML = ''; renderMain(); }
});
document.addEventListener('toggle', e => { if (e.target.classList && e.target.classList.contains('state-raw')){ S.rawOpen = e.target.open; } }, true);

/* ---------- polling ---------- */
let lastSig = '', busy = false, fails = 0;
// A process list the server hasn't read yet (Fleet just restarted, the machine is reconnecting) is not an empty
// one: keep the list on screen until a fresh one comes, so Details never flashes empty.
// a process in Docker Desktop's VM is keyed d:<container>:<pid> (its PID is the VM's, not this Mac's); any other
// PID is what the host sent, shown as it is (#166)
function isVmKey(k){ return typeof k === 'string' && /^d:[0-9a-f]+:\d+$/.test(k); }
function pidNum(k){ return isVmKey(k) ? +k.split(':').pop() : k; }
function takeProcs(mid, d){
  if (d && d.ready === false && PROCS.machine === mid) return;
  PROCS = {machine:mid, list:(d && d.procs) || [], gpuProcs:!!(d && d.gpu_procs)};
}
function sigOf(){ return Object.keys(nodes).join('|') + '#' + PINS.join('|'); }
// The Network tree's data comes on its own: the server runs tailscale status for /api/net, which can take seconds,
// and the fleet's numbers never wait for it. One is on its way at a time (#144).
let netBusy = false;
function refreshNet(){
  if (netBusy || S.tree !== 'network') return; netBusy = true;
  fetch('/api/net', {cache:'no-store'}).then(r => r.json()).then(d => { NET = d; if (S.tree === 'network'){ updateTree(); renderMain(); } })
    .catch(() => null).finally(() => { netBusy = false; });
}
async function refreshNow(){
  inspectTick();
  refreshNet();
  if (busy) return; busy = true;
  try {
    const pinsAt = pinsSaves ? -1 : pinsSeq;   // a pin save on its way now or made before the answer: keep PINS (#95)
    const pg = prefsGen;                         // a prefs save started or ended since the poll was asked for: keep PREFS (#175)
    const r = await fetch('/api/fleet', {cache:'no-store'});
    DATA = await r.json();
    INTERVAL = DATA.interval || 3; WINDOW = DATA.window_s || INTERVAL * H; if (pinsAt === pinsSeq) PINS = DATA.pins || []; if (!prefsBusy && pg === prefsGen){ PREFS = DATA.prefs || {}; applyTheme(currentTheme()); } if (!tpinBusy) TPINS = DATA.tilepins || {};
    build(DATA);
    renderAutoConn();
    if (S.sel !== 'fleet' && !nodes[S.sel]) { /* keep selection; it may come back */ }
    const n = S.sel === 'fleet' ? null : nodes[S.sel];
    const jobs = [];
    if ((S.view === 'details' || (S.detailsDocked && n && S.tree !== 'network')) && (n || roots[0])){ const mid = procMachineFor(n || roots[0]); if (mid) jobs.push(fetch('/api/procs?machine=' + encodeURIComponent(mid), {cache:'no-store'}).then(r => r.json()).then(d => takeProcs(mid, d))); }
    if (S.view !== 'details' && !S.detailsDocked && n && n.kind === 'machine' && S.metric === 'cpu' && S.cpuView === 'logical' && cpuSel(n).length && n.status === 'ok') jobs.push(fetch('/api/procs?machine=' + encodeURIComponent(n.id), {cache:'no-store'}).then(r => r.json()).then(d => takeProcs(n.id, d)));
    if (S.view !== 'details' && n && n.kind === 'machine' && S.metric === 'cpu' && S.cpuView === 'logical') jobs.push(fetch('/api/cpus?machine=' + encodeURIComponent(n.id), {cache:'no-store'}).then(r => r.json()).then(d => { CPUS[n.id] = d; }));
    const nm = n && n.kind === 'machine' ? n : null;
    // Each interface / Each disk shows nm's; Details filtered by a disk or interface pick needs its machine's to tell whether that's still there.
    const dn = shownDetails(), dmid = dn && procMachineFor(dn), lists = (shown, pick) => [...new Set([shown && nm ? nm.id : null, pick && pick.mid === dmid && pick.names.length ? dmid : null].filter(Boolean))];
    lists(S.metric === 'net' && S.view !== 'details', S.ifSel).forEach(id => jobs.push(fetch('/api/ifs?machine=' + encodeURIComponent(id), {cache:'no-store'}).then(r => r.json()).then(d => { IFS[id] = d; })));
    lists(S.metric === 'disk' && S.view !== 'details', S.diskSel).forEach(id => jobs.push(fetch('/api/disks?machine=' + encodeURIComponent(id), {cache:'no-store'}).then(r => r.json()).then(d => { DISKS[id] = d; })));
    if (nm && S.view !== 'details' && !S.detailsDocked && ((S.metric === 'disk' && S.diskView === 'each' && diskSel(nm).length) || (S.metric === 'net' && S.ifView === 'each' && ifSel(nm).length)) && nm.status === 'ok') jobs.push(fetch('/api/procs?machine=' + encodeURIComponent(nm.id), {cache:'no-store'}).then(r => r.json()).then(d => takeProcs(nm.id, d)));
    await Promise.all(jobs.map(p => p.catch(() => null)));
    fails = 0; $('conn').hidden = true; $('live').hidden = false;
    const sig = sigOf();
    if (sig !== lastSig){ lastSig = sig; renderAll(); }
    else { updateSpaces(); updateTree(); renderMain(); refreshTip(); }
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
      if (sig !== null && s !== sig && !PICK.open && !SET.open && !(document.activeElement && document.activeElement.id === 'pfilter')){ save(); location.reload(); return; }
      sig = s;
    } catch (e) {}
  }
  setInterval(check, 1500); check();
})();


/* ---------- Settings ---------- */
const SET = {open:false, draft:null, path:'', status:{}, errors:[], saving:false, tests:{}, expanded:new Set(), terminals:[], termAuto:''};
const TILE_NAMES = {laptop:'Laptop', desktop:'Desktop', terminal:'Terminal', server:'Server', globe:'Globe', vm:'VM'};
async function openSettings(){
  if (PICK.open) closePicker(false);
  SET.open = true; SET.errors = []; SET.tests = {}; SET.saving = false;
  $('sheet').hidden = false;
  $('sheet').innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="set-title"><div class="sheet-h"><h2 id="set-title">Settings</h2></div><div class="sheet-b"><p class="sub">Loading…</p></div></div>`;
  try {
    const d = await (await fetch('/api/config', {cache:'no-store'})).json();
    SET.draft = {interval:d.interval, terminal:d.terminal || 'auto', machines:d.machines.map(m => Object.assign({}, m))};
    SET.path = d.path; SET.status = d.status || {}; SET.terminals = d.terminals || []; SET.termAuto = d.terminal_auto || ''; SET.expanded = new Set();
    renderSettings();
  } catch (e) { $('sheet').querySelector('.sheet-b').innerHTML = '<p class="sub">Couldn’t load settings.</p>'; }
}
function closeSettings(){ SET.open = false; $('sheet').hidden = true; $('sheet').innerHTML = ''; const b = document.querySelector('[data-settings]'); if (b) b.focus(); }
function machineCard(m, i){
  const local = m.kind === 'local';
  const open = SET.expanded.has(i);
  const others = SET.draft.machines.filter((x, j) => j !== i && x.id);
  const st = SET.status[m.id];
  const stn = st ? {status:st.status, error:st.error, name:m.name, ssh:m.ssh, kind:'machine', hasData:st.status === 'ok'} : null;
  const t = SET.tests[i];
  const tile = m.tile || (local ? 'laptop' : 'terminal');
  const summary = local ? 'This computer' : [m.ssh || 'no SSH destination yet', m.os === 'windows' ? 'Windows' : m.os === 'macos' ? 'macOS' : 'Linux'].join(' · ') + (m.vm_on ? ' · VM' : '');
  const pill = stn ? `<span class="spill ${stn.status === 'ok' ? 'okp' : ''}">${esc(stn.status === 'ok' ? 'live' : stn.status)}</span>` : '<span class="spill">new</span>';
  const sel = (field, opts, val) => `<select data-field="${i}:${field}">${opts.map(([v, l]) => `<option value="${esc(v)}"${(val || '') === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const head = `<button type="button" class="mcard-h" data-togglecard="${i}" aria-expanded="${open}"><span class="chev${open ? ' open' : ''}">${icon('chev', 2.4)}</span>${tileHTML(tile, cardOS(m), false)}<span class="mtitle"><span class="mlabel" data-label="${i}">${esc(m.name || 'New machine')}</span><span class="msum">${esc(summary)}</span></span>${pill}</button>`;
  if (!open) return `<div class="mcard" data-card="${i}">${head}</div>`;
  return `<div class="mcard open" data-card="${i}">${head}<div class="mbody">
    <div class="mgrid">
      <label class="wide">Name<input data-field="${i}:name" value="${esc(m.name || '')}" placeholder="What Fleet calls it"></label>
      ${local ? `<label class="wide">Connection<span class="static">This computer, read directly</span></label>` : `
      <label class="wide">SSH destination<input data-field="${i}:ssh" value="${esc(m.ssh || '')}" placeholder="user@host, a ~/.ssh/config alias, or a Tailscale name" spellcheck="false" autocapitalize="off"></label>
      <label>System${sel('os', [['linux', 'Linux'], ['windows', 'Windows'], ['macos', 'macOS']], m.os || 'linux')}</label>`}
      <label>Icon${sel('tile', Object.entries(TILE_NAMES), tile)}</label>
      <label>Runs on${sel('vm_on', [['', 'its own hardware']].concat(others.map(x => [x.id, 'a VM on ' + (x.name || x.id)])), m.vm_on || '')}</label>
    </div>
    <details class="adv"><summary>Advanced</summary><div class="mgrid">
      <label>Id<input data-field="${i}:id" value="${esc(m.id || '')}" spellcheck="false"></label>
      <label>VM name on its host<input data-field="${i}:domain" value="${esc(m.domain || '')}" placeholder="same as the name" spellcheck="false"></label>
      <label>Tailscale name<input data-field="${i}:tailscale" value="${esc(m.tailscale || '')}" placeholder="for the network tree" spellcheck="false"></label>
    </div></details>
    <div class="mtest">${local ? '' : `<button type="button" class="btn" data-testmachine="${i}"${t && t.busy ? ' disabled' : ''}>${icon('refresh')}${t && t.busy ? 'Testing…' : 'Test connection'}</button><span class="tres ${t ? (t.busy ? '' : t.ok ? 'good' : 'bad') : ''}">${t && !t.busy ? (t.ok ? icon('check') + 'Connected' : 'Failed') + (t.output ? ` · <code>${esc(t.output.split('\n').slice(0, 3).join(' · '))}</code>` : '') : stn && stn.status !== 'ok' && st.error ? esc(diagnose(stn).title.replace(/<[^>]+>/g, '')) : ''}</span>`}
      <button type="button" class="btn danger" data-rmmachine="${i}">${icon('trash')}Remove</button></div>
  </div></div>`;
}
function renderSettings(){
  const d = SET.draft;
  $('sheet').innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="set-title">
    <div class="sheet-h"><h2 id="set-title">Settings</h2><button type="button" class="iconbtn" data-closesettings="1" aria-label="Close settings">${icon('x', 2.2)}</button></div>
    <div class="sheet-b">
      <section><h3>Machines</h3><p class="sub">Fleet reaches each machine over SSH, read-only; nothing is installed on them. Destinations use your <code>~/.ssh/config</code>, keys and Tailscale as they are.</p>
        <div class="mcards">${d.machines.map(machineCard).join('')}</div>
        <button type="button" class="btn" data-addmachine="1">${icon('plus', 2)}Add a machine</button></section>
      ${appearanceSection()}
      <section><h3>Terminal</h3><p class="sub">Used by <b>Open terminal</b> on a machine or container.</p><label class="inline">Open in <select data-field="-1:terminal" aria-label="Terminal app"><option value="auto"${d.terminal === 'auto' ? ' selected' : ''}>Automatic${SET.termAuto ? ' (' + esc(SET.termAuto) + ')' : ''}</option>${SET.terminals.map(([k, l]) => `<option value="${esc(k)}"${d.terminal === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label></section>
      <section><h3>Keyboard</h3><p class="sub">Press <kbd>?</kbd> anywhere for the list: find, spaces, metrics, the tree, text size and more.</p><button type="button" class="btn" data-showkeys="1">Show keyboard shortcuts</button></section>
      <section><h3>Refresh</h3><label class="inline">Read every machine every <input type="number" min="1" max="60" step="1" data-field="-1:interval" value="${esc(d.interval)}" aria-label="Seconds between readings"> seconds</label></section>
      <p class="sub">Saved to <code>${esc(SET.path)}</code>; the previous version is kept beside it as <code>machines.toml.bak</code>.</p>
    </div>
    ${SET.errors.length ? `<div class="sheet-err" role="alert">${SET.errors.map(x => `<div>${esc(x)}</div>`).join('')}</div>` : ''}
    <div class="sheet-f"><button type="button" class="btn" data-closesettings="1">Cancel</button><button type="button" class="btn primary" data-savesettings="1"${SET.saving ? ' disabled' : ''}>${SET.saving ? 'Saving…' : 'Save'}</button></div>
  </div>`;
}
function slugId(name, taken){ let b = (name || 'machine').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'machine', id = b, n = 2; while (taken.has(id)) id = b + '-' + n++; return id; }
async function saveSettings(){
  const d = SET.draft, taken = new Set(d.machines.map(m => m.id).filter(Boolean));
  d.machines.forEach(m => { if (!m.id){ m.id = slugId(m.name, taken); taken.add(m.id); } });
  SET.saving = true; SET.errors = []; renderSettings();
  try {
    const r = await api('/api/config', {interval:Number(d.interval), terminal:d.terminal || 'auto', machines:d.machines});
    if (!r.ok){ SET.saving = false; SET.errors = r.errors || ['Couldn’t save.']; renderSettings(); return; }
    closeSettings(); toast('Saved. Reconnecting to your machines…');
    setTimeout(refreshNow, 2500);
  } catch (e) { SET.saving = false; SET.errors = ['Couldn’t reach Fleet to save.']; renderSettings(); }
}
function toast(msg){
  let t = document.getElementById('toast');
  if (!t){ t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 3200);
}
// the backdrop closes Settings only when the press and the release are both on it: a drag-select out of an input also clicks it
let sheetPress = null;
$('sheet').addEventListener('mousedown', e => { sheetPress = e.target; });
$('sheet').addEventListener('mouseup', e => { if (e.target !== $('sheet')) sheetPress = null; });
$('sheet').addEventListener('click', async e => {
  if ((e.target === $('sheet') && sheetPress === $('sheet')) || e.target.closest('[data-closesettings]')){ closeSettings(); return; }
  if (e.target.closest('[data-savesettings]')){ saveSettings(); return; }
  const tc = e.target.closest('[data-togglecard]'); if (tc){ const i = +tc.dataset.togglecard; SET.expanded.has(i) ? SET.expanded.delete(i) : SET.expanded.add(i); renderSettings(); const h = $('sheet').querySelector(`[data-togglecard="${i}"]`); if (h) h.focus(); return; }
  if (e.target.closest('[data-addmachine]')){ SET.draft.machines.push({id:'', name:'', ssh:'', os:'linux', tile:'terminal'}); SET.expanded.add(SET.draft.machines.length - 1); renderSettings(); const c = $('sheet').querySelector(`[data-field="${SET.draft.machines.length - 1}:name"]`); if (c) c.focus(); return; }
  const th = e.target.closest('[data-themeid]'); if (th){ pickTheme(th.dataset.themeid); return; }
  const rt = e.target.closest('[data-rmtheme]'); if (rt){ removeTheme(rt.dataset.rmtheme); return; }
  if (e.target.closest('[data-showkeys]')){ openKeys(); return; }
  if (e.target.closest('[data-importtheme]')){ const f = $('themefile'); if (f) f.click(); return; }
  const rm = e.target.closest('[data-rmmachine]'); if (rm){ const i = +rm.dataset.rmmachine; SET.draft.machines.splice(i, 1); SET.tests = {}; SET.expanded = new Set([...SET.expanded].filter(j => j !== i).map(j => j > i ? j - 1 : j)); renderSettings(); return; }
  const tb = e.target.closest('[data-testmachine]');
  if (tb){
    const i = +tb.dataset.testmachine, m = SET.draft.machines[i];
    SET.tests[i] = {busy:true}; renderSettings();
    try { const r = await api('/api/test', {ssh:m.ssh, os:m.os || 'linux'}); SET.tests[i] = {ok:r.ok, output:r.output}; }
    catch (x) { SET.tests[i] = {ok:false, output:'Fleet didn’t answer.'}; }
    if (SET.open) renderSettings();
  }
});
function setField(t){
  const f = t.dataset.field; if (!f || !SET.draft) return;
  const [i, k] = f.split(':'); const v = t.value;
  if (i === '-1') SET.draft[k] = v; else SET.draft.machines[+i][k] = v;
  const card = t.closest('.mcard');
  if (card && (k === 'tile' || k === 'os')){ const m = SET.draft.machines[+i]; card.querySelector('.mcard-h .tile').outerHTML = tileHTML(m.tile || (m.kind === 'local' ? 'laptop' : 'terminal'), cardOS(m), false); }
  if (card && k === 'name'){ const l = card.querySelector('.mlabel'); if (l) l.textContent = v || 'New machine'; }
}
$('sheet').addEventListener('input', e => setField(e.target));
$('sheet').addEventListener('change', e => { if (e.target.id === 'themefile'){ importTheme(e.target.files && e.target.files[0]); return; } setField(e.target); });
$('sheet').addEventListener('keydown', e => { if (e.key === 'Escape'){ e.preventDefault(); closeSettings(); } });


/* ---------- Details panel: drag the Details pill to the right to dock it ---------- */
function dockDetails(){ S.detailsDocked = true; if (S.view === 'details') S.view = 'overview'; if (S.tree === 'network') S.tree = 'machines'; save(); lastMainHTML = ''; renderAll(); refreshNow(); }
// The drop zone lives exactly as long as the drag. Docking re-renders the bar and detaches the dragged
// pill, so its dragend never reaches the document (and a poll can do the same mid-drag): every way a
// drag can end calls endDrag(), and no mouse events fire during a drag, so the first one after it does too.
let dragging = false;
const DRAG_TYPE = 'application/x-fleet-details';
function showDockZone(){
  dragging = true;
  if ($('dockzone')) return;
  const z = document.createElement('div'); z.id = 'dockzone'; z.className = 'dockzone'; z.innerHTML = `<div>${icon('layers')}<b>Drop to dock Details here</b><span>It stays beside whatever you select</span></div>`;
  document.body.appendChild(z);
}
function endDrag(){ dragging = false; const z = $('dockzone'); if (z) z.remove(); }
const ourDrag = e => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes(DRAG_TYPE));
document.addEventListener('dragstart', e => {
  const pill = e.target.closest && e.target.closest('[data-details]'); if (!pill) return;
  e.dataTransfer.setData('text/plain', 'fleet-details');
  e.dataTransfer.setData(DRAG_TYPE, '1');
  e.dataTransfer.effectAllowed = 'move';
  pill.addEventListener('dragend', endDrag, {once:true});  // still heard if the pill is detached meanwhile
  showDockZone();
});
document.addEventListener('dragover', e => {
  if (!dragging){ if (!ourDrag(e)) return; showDockZone(); }  // the same drag came back into the window
  const z = $('dockzone'); if (!z) return;
  const over = e.clientX > innerWidth * 0.55;
  z.classList.toggle('hot', over);
  if (over){ e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
});
document.addEventListener('drop', e => {
  if (!dragging) return;
  e.preventDefault();
  const dock = e.clientX > innerWidth * 0.55;
  endDrag();
  if (dock) dockDetails();
});
document.addEventListener('dragend', endDrag);
document.addEventListener('dragleave', e => {
  if (dragging && !e.relatedTarget && (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= innerWidth || e.clientY >= innerHeight)) endDrag();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && (dragging || $('dockzone'))) endDrag(); });
window.addEventListener('blur', () => { if (dragging || $('dockzone')) endDrag(); });
['mousemove', 'pointermove', 'pointerdown'].forEach(t => document.addEventListener(t, e => { if ((t === 'pointerdown' || e.buttons === 0) && (dragging || $('dockzone'))) endDrag(); }, true));
// Resize the docked panel by its left edge. Polls don't rebuild the page while the drag lasts (see renderMain);
// letting go, or the browser cancelling the drag, ends it, saves the width and shows what came in meanwhile.
const RESIZE_ENDS = ['pointerup', 'pointercancel', 'lostpointercapture'];
document.addEventListener('pointerdown', e => {
  const h = e.target.closest && e.target.closest('[data-resize]'); if (!h) return;
  e.preventDefault();
  const panel = h.parentElement; h.setPointerCapture(e.pointerId); resizing = true;
  const move = ev => { const w = Math.max(360, Math.min(innerWidth - 520, innerWidth - ev.clientX - 8)); panel.style.width = w + 'px'; S.dockW = w; };
  const up = () => { h.removeEventListener('pointermove', move); RESIZE_ENDS.forEach(t => h.removeEventListener(t, up)); resizing = false; save(); lastMainHTML = ''; renderMain(); };
  h.addEventListener('pointermove', move); RESIZE_ENDS.forEach(t => h.addEventListener(t, up));
});


/* ---------- Details columns: a layout per detail type, arranged from a right-click menu ---------- */
const COL_LABELS = {name:'Name', pid:'PID', owner:'Runs in', user:'User', state:'Status', cpu:'CPU', mem:'Memory', disk:'Disk', gpu:'GPU', net:'Network',
  threads:'Threads', cpugroup:'CPU group', cmd:'Command line', ppid:'Parent PID', lastcpu:'Last CPU', gpus:'Which GPU', disks:'Disks used', ifaces:'Interfaces'};
const COL_DEFAULTS = {
  cpu:['name', 'pid', 'owner', 'user', 'state', 'cpu', 'mem', 'threads', 'cpugroup', 'cmd'],
  mem:['name', 'pid', 'owner', 'user', 'mem', 'cpu', 'threads', 'cmd'],
  gpu:['name', 'pid', 'owner', 'gpu', 'gpus', 'cpu', 'mem', 'cmd'],
  disk:['name', 'pid', 'owner', 'disk', 'disks', 'cpu', 'mem', 'cmd'],
  net:['name', 'pid', 'owner', 'net', 'ifaces', 'cpu', 'mem', 'cmd']
};
function colType(){ return COL_DEFAULTS[S.metric] ? S.metric : 'cpu'; }
function colLayout(){ const l = ((PREFS.columns || {})[colType()] || []).filter(k => COL_LABELS[k]); return l.length ? l : COL_DEFAULTS[colType()]; }
// A header click sorts that detail type; until then every type keeps the usual default (CPU, highest first).
function detailSort(){ const s0 = (S.sorts || {})[colType()]; return s0 && COL_LABELS[s0.k] ? s0 : (S.sort && COL_LABELS[S.sort.k] ? S.sort : {k:'cpu', dir:-1}); }
async function setColLayout(list){
  PREFS = Object.assign({}, PREFS, {columns:Object.assign({}, PREFS.columns, {[colType()]:list})});
  lastMainHTML = ''; renderMain(); if (COLMENU.open) renderColMenu();
  await savePrefs('the column layout');
}
// PREFS (~/.config/fleet/ui.json) is saved whole; while a save is on its way, polls don't overwrite it, nor
// does a poll asked for before or during a save (the server may have read the old file for it): prefsGen moves on.
let prefsSaves = 0;
async function savePrefs(what){
  prefsSaves++; prefsBusy = true; prefsGen++;
  try { const d = await api('/api/prefs', PREFS); if (prefsSaves === 1 && d.prefs) PREFS = d.prefs; }
  catch (e) { toast('Couldn’t save ' + what); }
  if (--prefsSaves === 0) prefsBusy = false;
  prefsGen++;
}
const COLMENU = {open:false, x:0, y:0, focus:''};
function renderColMenu(){
  let el = $('colmenu');
  if (!el){ el = document.createElement('div'); el.id = 'colmenu'; el.className = 'colmenu'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Columns'); document.body.appendChild(el); }
  const vis = colLayout(), hidden = Object.keys(COL_LABELS).filter(k => !vis.includes(k));
  const f = COLMENU.focus && vis.includes(COLMENU.focus) ? COLMENU.focus : '';
  const quick = f ? `<div class="cm-quick"><b>${esc(COL_LABELS[f])}</b><button type="button" data-colact="hide|${f}">Hide</button><button type="button" data-colact="left|${f}"${vis.indexOf(f) === 0 ? ' disabled' : ''}>Move left</button><button type="button" data-colact="right|${f}"${vis.indexOf(f) === vis.length - 1 ? ' disabled' : ''}>Move right</button></div>` : '';
  const row = (k, on) => `<li class="cm-row${on ? '' : ' off'}" draggable="${on}" data-colrow="${k}"><span class="cm-grip" aria-hidden="true">${on ? icon('grip') : ''}</span><label><input type="checkbox" data-colvis="${k}"${on ? ' checked' : ''}${on && vis.length === 1 ? ' disabled' : ''}> ${esc(COL_LABELS[k])}</label>${on ? `<button type="button" class="iconbtn" data-colact="left|${k}" aria-label="Move ${esc(COL_LABELS[k])} earlier"${vis.indexOf(k) === 0 ? ' disabled' : ''}>↑</button><button type="button" class="iconbtn" data-colact="right|${k}" aria-label="Move ${esc(COL_LABELS[k])} later"${vis.indexOf(k) === vis.length - 1 ? ' disabled' : ''}>↓</button>` : ''}</li>`;
  el.innerHTML = `<div class="cm-h">Columns · ${esc(mlabel(colType()))} details<span>each detail type keeps its own</span></div>${quick}<ul class="cm-list">${vis.map(k => row(k, true)).join('')}${hidden.map(k => row(k, false)).join('')}</ul><div class="cm-f"><button type="button" class="btn" data-colact="reset|">Reset to default</button><button type="button" class="btn primary" data-colact="close|">Done</button></div>`;
  el.hidden = false;
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(COLMENU.x, innerWidth - r.width - 8)) + 'px';
  el.style.top = Math.max(8, Math.min(COLMENU.y, innerHeight - r.height - 8)) + 'px';
}
function closeColMenu(){ COLMENU.open = false; const el = $('colmenu'); if (el) el.hidden = true; }
document.addEventListener('contextmenu', e => {
  const th = e.target.closest && e.target.closest('.ptbl thead th');
  if (!th) return;
  e.preventDefault();
  Object.assign(COLMENU, {open:true, x:e.clientX, y:e.clientY, focus:th.dataset.colk || ''});
  renderColMenu();
});
document.addEventListener('click', e => {
  const el = $('colmenu'); if (!COLMENU.open || !el) return;
  if (!el.contains(e.target)){ closeColMenu(); return; }
  const a = e.target.closest('[data-colact]'); if (!a) return;
  const [act, k] = a.dataset.colact.split('|'), vis = colLayout().slice(), i = vis.indexOf(k);
  if (act === 'close') return closeColMenu();
  if (act === 'reset') return setColLayout(COL_DEFAULTS[colType()].slice());
  if (act === 'hide' && vis.length > 1){ vis.splice(i, 1); COLMENU.focus = ''; }
  if (act === 'left' && i > 0) [vis[i - 1], vis[i]] = [vis[i], vis[i - 1]];
  if (act === 'right' && i >= 0 && i < vis.length - 1) [vis[i + 1], vis[i]] = [vis[i], vis[i + 1]];
  setColLayout(vis);
}, true);
document.addEventListener('change', e => {
  const c = e.target.dataset && e.target.dataset.colvis; if (!c) return;
  const vis = colLayout().slice();
  if (e.target.checked && !vis.includes(c)) vis.push(c);
  if (!e.target.checked && vis.length > 1) vis.splice(vis.indexOf(c), 1);
  setColLayout(vis);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && COLMENU.open) closeColMenu(); });
// Drag a row in the menu to reorder.
let colDrag = '';
document.addEventListener('dragstart', e => { const r = e.target.closest && e.target.closest('[data-colrow]'); if (r && COLMENU.open){ colDrag = r.dataset.colrow; e.dataTransfer.setData('text/plain', colDrag); } });
document.addEventListener('dragover', e => { if (colDrag && e.target.closest && e.target.closest('[data-colrow]')) e.preventDefault(); });
document.addEventListener('drop', e => {
  const r = colDrag && e.target.closest && e.target.closest('[data-colrow]'); if (!r) return;
  e.preventDefault();
  const vis = colLayout().slice(), from = vis.indexOf(colDrag), to = vis.indexOf(r.dataset.colrow);
  colDrag = '';
  if (from < 0 || to < 0 || from === to) return;
  vis.splice(to, 0, vis.splice(from, 1)[0]);
  setColLayout(vis);
});


/* ---------- Themes (themes.js has the list and the colour maths) ---------- */
// The theme is a UI pref (prefs.theme), so it follows you across restarts and into every Fleet window;
// imported themes live in prefs.themes. The page applies the last one before its first paint (index.html).
function customThemes(){ return (PREFS.themes || []).filter(t => t && typeof t.id === 'string' && t.c && typeof t.c === 'object'); }
function allThemes(){ return FLEET_THEMES.concat(customThemes()); }
function currentTheme(){ const id = PREFS.theme || 'fleet'; return allThemes().find(t => t.id === id) || FLEET_THEMES[0]; }
let appliedTheme = '';
function applyTheme(th){
  // the theme, with the reader's colour vision (#219) and contrast (#220) on top
  const cvd = CVD_KINDS.includes(PREFS.cvd) ? PREFS.cvd : '', hc = !!PREFS.contrast;
  const tk = themeAccess(themeTokens(th), {cvd, contrast:hc}), key = th.id + cvd + hc + JSON.stringify(tk);
  if (key === appliedTheme) return;
  appliedTheme = key;
  const root = document.documentElement, st = root.style;
  for (const [k, v] of Object.entries(tk.vars)) st.setProperty('--' + k, v);
  st.colorScheme = tk.dark ? 'dark' : 'light';
  root.dataset.fleetTheme = th.id;
  if (cvd) root.dataset.cvd = cvd; else delete root.dataset.cvd;
  root.classList.toggle('hc', hc);
  try { localStorage.setItem('fleet-theme', JSON.stringify({id:th.id, dark:tk.dark, vars:tk.vars, cvd, hc})); } catch (e) {}
  // Fleet.app paints its window (behind the page, and while it loads) in the same colour
  try { window.webkit.messageHandlers.fleet.postMessage({bg:tk.vars.chrome, dark:tk.dark}); } catch (e) {}
}
const THEME_MSG = {text:'', bad:false};
function themeSwatch(th, on){
  const v = themeTokens(th).vars, custom = !FLEET_THEMES.some(t => t.id === th.id);
  return `<div class="thsw${on ? ' on' : ''}"><button type="button" class="thsw-b" data-themeid="${esc(th.id)}" aria-pressed="${on}" title="${esc(th.name)}${custom ? ' (imported)' : ''}">`
    + `<span class="thsw-p" style="background:${v.chrome}"><span class="thsw-a" style="background:${v['accent-bg']}"></span><span class="thsw-w" style="background:${v.win}">`
    + `<span class="thsw-c" style="background:${v.card}"><i style="background:${v.ink}"></i><i style="background:${v['ink-3']}"></i></span>`
    + `<span class="thsw-s">${SERIES_KEYS.map(k => `<i style="background:${v[k]}"></i>`).join('')}</span></span></span>`
    + `<span class="thsw-n">${on ? icon('check', 2.4) : ''}${esc(th.name)}</span></button>`
    + (custom ? `<button type="button" class="thsw-x" data-rmtheme="${esc(th.id)}" aria-label="Remove ${esc(th.name)}" title="Remove">${icon('x', 2.4)}</button>` : '') + `</div>`;
}
function appearanceSection(){
  const cur = currentTheme().id;
  return `<section><h3>Appearance</h3><p class="sub">Pick a theme; it applies right away and is kept for next time.</p>
    <div class="thgrid" role="group" aria-label="Themes">${allThemes().map(t => themeSwatch(t, t.id === cur)).join('')}</div>
    <div class="throw"><button type="button" class="btn" data-importtheme="1">${icon('upload')}Import theme</button><input type="file" id="themefile" accept=".json,.jsonc,application/json" hidden>
    <span class="thmsg${THEME_MSG.bad ? ' bad' : ''}" role="status">${esc(THEME_MSG.text || 'A VS Code colour theme (.json), or a Fleet theme.')}</span></div>
    <div class="access"><label>Colour vision<select data-cvd aria-describedby="cvd-help">${[['', 'Typical'], ['protan', 'Protanopia (red-weak)'], ['deutan', 'Deuteranopia (green-weak)'], ['tritan', 'Tritanopia (blue-weak)'], ['mono', 'Monochromacy (no colour)']]
      .map(([v, l]) => `<option value="${v}"${(PREFS.cvd || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" data-hc${PREFS.contrast ? ' checked' : ''}>Higher contrast</label>
      <p class="sub" id="cvd-help">Colour vision swaps the colours of workload types, groups and statuses for ones that stay apart for that kind of vision (on any theme); statuses also change shape. Higher contrast makes text and lines stronger.</p></div></section>`;
}
function rerenderAppearance(focusSel){
  if (!SET.open || !SET.draft) return;
  const sec = $('sheet').querySelector('.thgrid'); if (!sec) return;
  sec.closest('section').outerHTML = appearanceSection();
  const f = focusSel && $('sheet').querySelector(focusSel); if (f) f.focus();
}
async function setAccess(change, what){
  PREFS = Object.assign({}, PREFS, change);
  applyTheme(currentTheme()); lastMainHTML = ''; renderAll();
  await savePrefs(what);
}
document.addEventListener('change', e => {
  const c = e.target.closest('#sheet [data-cvd]'); if (c){ setAccess({cvd:c.value}, 'colour vision'); return; }
  const h = e.target.closest('#sheet [data-hc]'); if (h) setAccess({contrast:h.checked}, 'higher contrast');
});
async function pickTheme(id){
  if (!allThemes().some(t => t.id === id)) return;
  PREFS = Object.assign({}, PREFS, {theme:id});
  THEME_MSG.text = ''; THEME_MSG.bad = false;
  applyTheme(currentTheme()); rerenderAppearance(`[data-themeid="${CSS.escape(id)}"]`);
  await savePrefs('the theme');
}
async function removeTheme(id){
  const list = customThemes().filter(t => t.id !== id);
  PREFS = Object.assign({}, PREFS, {themes:list}, PREFS.theme === id ? {theme:'fleet'} : {});
  applyTheme(currentTheme()); rerenderAppearance('[data-importtheme]');
  await savePrefs('the theme list');
}
async function importTheme(file){
  if (!file) return;
  try {
    if (file.size > 2e6) throw new Error('it’s too big to be a theme');
    const th = readThemeFile(await file.text(), file.name);
    if (FLEET_THEMES.some(t => t.id === th.id)) th.id += '-imported';
    const list = customThemes().filter(t => t.id !== th.id).concat([th]).slice(-24);
    PREFS = Object.assign({}, PREFS, {themes:list, theme:th.id});
    THEME_MSG.text = `Imported ${th.name}.`; THEME_MSG.bad = false;
    applyTheme(currentTheme()); rerenderAppearance(`[data-themeid="${CSS.escape(th.id)}"]`);
    await savePrefs('the imported theme');
  } catch (e) {
    THEME_MSG.text = `Couldn’t import ${file.name}: ${e.message}.`; THEME_MSG.bad = true;
    rerenderAppearance('[data-importtheme]');
  }
}

/* ---------- Keyboard shortcuts ---------- */
// One keymap for every window: ⌘ on a Mac, Ctrl elsewhere. Fleet.app's menus call fleetCommand() for the
// same commands, and zoom there is native (the page asks for it when the menu didn't take the key).
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MODK = IS_MAC ? '⌘' : 'Ctrl+', ALTK = IS_MAC ? '⌥' : 'Alt+', SHIFTK = IS_MAC ? '⇧' : 'Shift+', CTRLK = IS_MAC ? '⌃' : 'Ctrl+', TABK = IS_MAC ? '⇥' : 'Tab';
const METRIC_KEYS = ['cpu', 'mem', 'gpu', 'disk', 'net'];
const SHORTCUTS = [
  ['Go to anything: machines, containers, jobs, commands', [MODK + 'K']],
  ['Find in the panel you’re in: the tree, the page or Details', [MODK + 'F', '/']],
  ['Back, forward', [MODK + '[', MODK + ']']],
  ['Details on and off', [MODK + 'D']],
  ['Dock Details beside the overview', [MODK + SHIFTK + 'D']],
  ['CPU, Memory, GPU, Disk I/O, Network', [ALTK + '1 … ' + ALTK + '5']],
  ['Go to a space (1 is All machines)', [MODK + '1 … ' + MODK + '9']],
  ['Previous or next space', [MODK + SHIFTK + '[', MODK + SHIFTK + ']']],
  ['Cycle through the spaces, or the other way', [CTRLK + TABK, CTRLK + SHIFTK + TABK]],
  ['Move through the tree', ['↑', '↓']],
  ['Collapse or expand; go to the parent', ['←', '→']],
  ['New space: pick a grouping to pin', [MODK + 'N']],
  ['Pin or unpin the selection as a space', ['P']],
  ['Open a terminal on the selection', [MODK + 'T']],
  ['Bigger, smaller, actual size', [MODK + '+', MODK + '−', MODK + '0']],
  ['Settings', [MODK + ',']],
  ['Refresh now', [MODK + 'R']],
  ['Close a menu, sheet or panel; clear the filter', ['Esc']],
  ['These shortcuts', ['?', MODK + '/']]
];
function spaceKeys(){ return ['fleet'].concat(PINS.filter(k => nodes[k])); }
function typingIn(t){ return !!(t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')); }
function overlayOpen(){ return SET.open || PICK.open || COLMENU.open || !!$('keys') || !!$('goto'); }
function fleetCommand(name, arg){
  switch (name){
    case 'find': {
      const panel = PANEL || 'main';
      if (panel === 'tree') return openTreeFind();
      const f = panel === 'details' ? document.querySelector('.dpanel #pfilter') : S.view === 'details' ? $('pfilter') : null;
      if (f){ f.focus(); f.select(); return true; }
      return openFind();
    }
    case 'back': return navGo(-1) || true;
    case 'fwd': return navGo(1) || true;
    case 'findproc': {
      // the docked panel's filter when it lists processes, else the full Details view's (as ⌘D opens it)
      const net = S.tree === 'network';
      if (net) S.tree = 'machines';
      if (net || !shownDetails()){
        if (!shownDetails()){ S.view = 'details'; S.detailsDocked = false; }
        save(); lastMainHTML = ''; renderAll(); refreshNow();
      }
      const f = $('pfilter'); if (f){ f.focus(); f.select(); }
      return true;
    }
    case 'details': if (S.tree === 'network') S.tree = 'machines'; S.view = S.view === 'details' ? 'overview' : 'details'; if (S.view === 'details') S.detailsDocked = false; save(); lastMainHTML = ''; renderAll(); refreshNow(); return true;
    case 'dock': S.detailsDocked ? (S.detailsDocked = false, save(), renderAll()) : dockDetails(); return true;
    case 'metric': if (!METRIC_KEYS.includes(arg)) return false; S.metric = arg; if (S.view !== 'details') S.view = 'overview'; save(); lastMainHTML = ''; renderAll(); refreshNow(); return true;
    case 'space': { const ks = spaceKeys(); if (arg >= 0 && arg < ks.length){ goSpace(ks[arg]); return true; } return false; }
    case 'space-step': { const ks = spaceKeys(), i = Math.max(0, ks.indexOf(S.space)); goSpace(ks[(i + arg + ks.length) % ks.length]); return true; }
    case 'pin': { const n = nodes[S.sel]; if (!n || S.sel === 'fleet') return false; const was = PINS.includes(S.sel); togglePin(S.sel); toast(was ? `Unpinned ${n.name}` : `Pinned ${n.name} as a space`); return true; }
    case 'newspace': if (overlayOpen() && !PICK.open) return false; if (!PICK.open) openPicker(); return true;
    case 'terminal': { const b = document.querySelector('[data-terminal]'); if (!b){ toast('Select a machine or container to open a terminal on it'); return true; } b.click(); return true; }
    case 'settings': if (!SET.open) openSettings(); return true;
    case 'refresh': refreshNow(); return true;
    case 'keys': $('keys') ? closeKeys() : openKeys(); return true;
    case 'goto': $('goto') ? closeGoto() : openGoto(); return true;
  }
  return false;
}
window.fleetCommand = fleetCommand;
// What a sheet or typing refuses: while Settings, this list or Go to is open only these get through, and ⌘T
// never fires while typing. The keys ask here, and so do Fleet.app's menus: a key the page leaves alone goes
// on to the menu item, which must refuse it too (#187).
function commandAllowed(name, typing){
  if ((SET.open || $('keys') || $('goto')) && !['keys', 'refresh', 'goto'].includes(name)) return false;
  return !(name === 'terminal' && typing);
}
window.fleetMenu = (name, arg) => commandAllowed(name, typingIn(document.activeElement)) && fleetCommand(name, arg);
function openKeys(){
  const el = document.createElement('div'); el.id = 'keys'; el.className = 'sheet-bg';
  el.innerHTML = `<div class="sheet keys" role="dialog" aria-modal="true" aria-labelledby="keys-title"><div class="sheet-h"><h2 id="keys-title">Keyboard shortcuts</h2><button type="button" class="iconbtn" data-closekeys="1" aria-label="Close">${icon('x', 2.2)}</button></div>`
    + `<div class="sheet-b"><table class="keytbl">${SHORTCUTS.map(([what, ks]) => `<tr><td>${esc(what)}</td><td>${ks.map(k => `<kbd>${esc(k)}</kbd>`).join(' ')}</td></tr>`).join('')}</table></div></div>`;
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-closekeys]')) closeKeys(); });
  document.body.appendChild(el);
  el.querySelector('[data-closekeys]').focus();
}
function closeKeys(){ const el = $('keys'); if (el) el.remove(); }
// ↑/↓ moves the selection through whichever tree is showing; ←/→ collapses, expands or goes to the parent.
function treeStep(key){
  const rows = [...document.querySelectorAll('#tree .row')];
  if (!rows.length) return false;
  const net = S.tree === 'network', idOf = r => net ? r.dataset.netsel : r.dataset.select;
  let i = rows.findIndex(r => r.classList.contains('sel'));
  const pick = r => { if (!r) return; const id = idOf(r); if (!id) return; if (net){ S.netSel = id; save(); renderTree(); renderToolbar(); renderMain(); } else select(id); const now = document.querySelector('#tree .row.sel'); if (now) now.scrollIntoView({block: 'nearest'}); };
  if (key === 'ArrowDown'){ pick(rows[i < 0 ? 0 : Math.min(rows.length - 1, i + 1)]); return true; }
  if (key === 'ArrowUp'){ pick(rows[i < 0 ? 0 : Math.max(0, i - 1)]); return true; }
  if (i < 0) return false;
  const r = rows[i], exp = r.getAttribute('aria-expanded'), lvl = +r.getAttribute('aria-level');
  if (key === 'ArrowRight'){ if (exp === 'false'){ const t = r.querySelector('[data-toggle]'); if (t) t.click(); } else if (exp === 'true') pick(rows[i + 1]); return true; }
  if (key === 'ArrowLeft'){
    if (exp === 'true'){ const t = r.querySelector('[data-toggle]'); if (t) t.click(); return true; }
    for (let j = i - 1; j >= 0; j--) if (+rows[j].getAttribute('aria-level') < lvl){ pick(rows[j]); break; }
    return true;
  }
  return false;
}
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.isComposing) return;
  const mod = IS_MAC ? e.metaKey : e.ctrlKey, typing = typingIn(e.target);
  const run = (name, arg) => { if (!commandAllowed(name, typing)) return; if (fleetCommand(name, arg)) e.preventDefault(); };
  if (e.key === 'Escape'){
    if ($('keys')){ e.preventDefault(); closeKeys(); return; }
    if (e.target.id === 'tfq'){ e.preventDefault(); closeTreeFind(); return; }
    if (e.target.id === 'mfq'){ e.preventDefault(); closeFind(); return; }
    if (PANEL === 'tree' && !typing && !overlayOpen() && !TF.q){ e.preventDefault(); selectNone(); return; }
    if (INSP.pid && !typing && !overlayOpen()){ e.preventDefault(); closeInspect(); return; }
    if (e.target.id === 'pfilter'){ e.preventDefault(); if (e.target.value){ e.target.value = ''; S.filter = ''; save(); renderMain(); } else e.target.blur(); return; }
    return;
  }
  // Ctrl+Tab and Ctrl+Shift+Tab cycle through the spaces, like tabs, on every OS (where Ctrl is the main modifier too)
  if (e.key === 'Tab' && e.ctrlKey && !e.metaKey && !e.altKey) return run('space-step', e.shiftKey ? -1 : 1);
  if (mod && !e.altKey){
    const k = e.key.toLowerCase();
    // text size: Fleet.app zooms natively; a browser does it itself
    if (['=', '+', '-', '_', '0'].includes(e.key) && document.documentElement.classList.contains('native')){
      try { window.webkit.messageHandlers.fleet.postMessage({zoom: e.key === '0' ? 'reset' : (e.key === '-' || e.key === '_') ? 'out' : 'in'}); e.preventDefault(); } catch (x) {}
      return;
    }
    if (k === 'k' && !e.shiftKey) return run('goto');
    if (k === 'f' && !e.shiftKey) return run('find');
    if (k === 'd') return run(e.shiftKey ? 'dock' : 'details');
    if (k === ',') return run('settings');
    if (k === '/') return run('keys');
    if (k === 'r' && !e.shiftKey) return run('refresh');
    if (k === 't' && !e.shiftKey) return run('terminal');
    if (k === 'n' && !e.shiftKey) return run('newspace');
    if (e.code === 'BracketLeft' || e.code === 'BracketRight' || e.key === '[' || e.key === ']'){
      const fwd = e.code === 'BracketRight' || e.key === ']';
      return e.shiftKey ? run('space-step', fwd ? 1 : -1) : run(fwd ? 'fwd' : 'back');
    }
    if (/^Digit[1-9]$/.test(e.code) && !e.shiftKey) return run('space', +e.code.slice(5) - 1);
    return;
  }
  if (e.altKey && !mod && /^Digit[1-5]$/.test(e.code)) return run('metric', METRIC_KEYS[+e.code.slice(5) - 1]);
  if (e.altKey && !mod && !IS_MAC && !typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return run(e.key === 'ArrowLeft' ? 'back' : 'fwd');
  if (typing || e.metaKey || e.ctrlKey || e.altKey || overlayOpen()) return;
  if (e.key === '/') return run('find');
  if (e.key === '?') return run('keys');
  if (e.key === 'p' || e.key === 'P') return run('pin');
  if (e.key.startsWith('Arrow')){
    const a = document.activeElement;
    if (a && a !== document.body && !a.closest('#tree, .side, .spacebar')) return;
    // focus on the body: the tree's only if you're in the tree (or no panel yet); after a click in the page or Details they scroll it
    if ((!a || a === document.body) && PANEL && PANEL !== 'tree') return;
    if (treeStep(e.key)) e.preventDefault();
  }
});

/* ---------- Go to (⌘K): any machine, VM, project, service, container or job, and every command ---------- */
const GOTO = {q:'', i:0, items:[]};
const METRIC_NAMES = {cpu:'CPU', mem:'Memory', gpu:'GPU', disk:'Disk I/O', net:'Network'};
function gotoCommands(){
  const tree = t => () => { S.tree = t; if (t === 'network') S.view = 'overview'; lastMainHTML = ''; save(); renderAll(); refreshNow(); };
  return [
    {label:'Settings', hint:MODK + ',', ic:'gear', run:() => fleetCommand('settings')},
    {label:'Details: the process list', hint:MODK + 'D', ic:'chip', run:() => fleetCommand('details')},
    {label:'Find a process (Details filter)', ic:'search', run:() => fleetCommand('findproc')},
    {label:'Back', hint:MODK + '[', ic:'chev', run:() => fleetCommand('back')},
    {label:'Forward', hint:MODK + ']', ic:'chev', run:() => fleetCommand('fwd')},
    {label:'Dock Details beside the overview', hint:MODK + SHIFTK + 'D', ic:'panelright', run:() => fleetCommand('dock')}
  ].concat(METRIC_KEYS.map((k, i) => ({label:'Show ' + METRIC_NAMES[k], hint:ALTK + (i + 1), ic:'chip', run:() => fleetCommand('metric', k)})), [
    {label:'Machine tree', ic:'server', run:tree('machines')},
    {label:'Network tree', ic:'net', run:tree('network')},
    {label:S.pinsOnly ? 'Show all machines in the tree' : 'Show only pins in the tree', ic:'pin', run:() => { S.pinsOnly = !S.pinsOnly; save(); renderTree(); }},
    {label:'Pin or unpin the selection as a space', hint:'P', ic:'pin', run:() => fleetCommand('pin')},
    {label:'Open a terminal on the selection', hint:MODK + 'T', ic:'terminal', run:() => fleetCommand('terminal')},
    {label:'Pin a grouping…', ic:'plus', run:() => openPicker()},
    {label:'Import a theme…', ic:'upload', run:() => { (SET.open ? Promise.resolve() : openSettings()).then(() => { const f = $('themefile'); if (f) f.click(); }); }},   // an open Settings keeps its unsaved edits
    {label:'Keyboard shortcuts', hint:'?', ic:'info', run:() => openKeys()}
  ], allThemes().map(t => ({label:'Theme: ' + t.name, ic:'palette', run:() => pickTheme(t.id)})));
}
function gotoNodes(){
  buildDivisions();
  const out = Object.values(nodes).filter(n => n.kind === 'division' && n.id.startsWith('div:')).map(n => ({n, path:n.parent ? [hostOf(n).name] : []}));
  (function w(list, path){ list.forEach(n => { out.push({n, path}); w(orderedKids(n), path.concat(n.name)); }); })(sortedRoots(), []);
  return out;
}
// every word must appear; names that start with the query come first, then names that contain it
function gotoRank(q, name, rest){
  const hay = (name + ' ' + rest).toLowerCase(), nm = name.toLowerCase(), words = q.split(/\s+/).filter(Boolean);
  if (!words.every(w => hay.includes(w))) return -1;
  return nm.startsWith(q) ? 3 : nm.includes(q) ? 2 : words.every(w => nm.includes(w)) ? 1 : 0;
}
function gotoItems(){
  const q = GOTO.q.trim().toLowerCase();
  const nodesList = gotoNodes().map(({n, path}) => ({n, path, label:n.name, kind:kindLabel(n), run:() => select(n.id)}));
  const cmds = gotoCommands().map(c => Object.assign({kind:'Command'}, c));
  if (!q) return nodesList.filter(x => x.n.kind === 'machine').concat(cmds.slice(0, 8));
  const scored = [];
  for (const x of nodesList){ const r = gotoRank(q, x.label, [x.kind, x.path.join(' '), x.n.os || '', (x.n.meta && x.n.meta.image) || ''].join(' ')); if (r >= 0) scored.push([r + 0.5, x]); }
  for (const x of cmds){ const r = gotoRank(q, x.label, 'command'); if (r >= 0) scored.push([r, x]); }
  return scored.sort((a, b) => b[0] - a[0]).map(x => x[1]).slice(0, 60);
}
function renderGoto(){
  const box = $('gotolist'); if (!box) return;
  GOTO.items = gotoItems();
  GOTO.i = Math.max(0, Math.min(GOTO.i, GOTO.items.length - 1));
  box.innerHTML = GOTO.items.length ? GOTO.items.map((x, i) => {
    const ic = x.n ? icon(iconOf(x.n)) : icon(x.ic || 'chev'), col = x.n ? (x.n.kind === 'machine' ? 'var(--ink-2)' : colOf(x.n)) : 'var(--ink-3)';
    const where = x.n && x.path.length ? `<span class="pw">${esc(x.path.join(' › '))}</span>` : '';
    return `<div class="gorow${i === GOTO.i ? ' on' : ''}" role="option" id="go-${i}" aria-selected="${i === GOTO.i}" data-goi="${i}"><span class="ico" style="color:${col}">${ic}</span>`
      + `<span class="pn"><span>${esc(x.label)}</span>${where}</span>${x.hint ? `<kbd>${esc(x.hint)}</kbd>` : `<span class="pk">${esc(x.kind)}</span>`}`
      + (x.n && x.n.kind !== 'cron' && x.n.kind !== 'cronfolder' ? `<button type="button" class="gopin${PINS.includes(x.n.id) ? ' on' : ''}" data-gopin="${esc(x.n.id)}" aria-pressed="${PINS.includes(x.n.id)}" aria-label="${PINS.includes(x.n.id) ? 'Unpin' : 'Pin'} ${esc(x.label)}" title="Pin as a space (⇧Enter)">${icon('pin')}</button>` : '') + `</div>`;
  }).join('') : `<div class="more">Nothing matches “${esc(GOTO.q)}”.</div>`;
  $('gotoq').setAttribute('aria-activedescendant', GOTO.items.length ? 'go-' + GOTO.i : '');
  const on = box.querySelector('.gorow.on'); if (on) on.scrollIntoView({block:'nearest'});
}
function openGoto(){
  if ($('goto')) return;
  if (PICK.open) closePicker(false);
  GOTO.q = ''; GOTO.i = 0;
  const el = document.createElement('div'); el.id = 'goto'; el.className = 'sheet-bg goto-bg';
  el.innerHTML = `<div class="goto" role="dialog" aria-modal="true" aria-label="Go to"><div class="pick-h">${icon('search')}<input type="search" id="gotoq" role="combobox" aria-expanded="true" aria-controls="gotolist" aria-autocomplete="list" placeholder="Go to a machine, VM, project, container or job, or type a command" autocomplete="off" spellcheck="false"></div><div class="picklist" id="gotolist" role="listbox"></div><div class="pick-f"><kbd>↑</kbd> <kbd>↓</kbd> to choose · <kbd>Enter</kbd> to go · <kbd>Esc</kbd> to close</div></div>`;
  el.addEventListener('click', e => {
    if (e.target === el){ closeGoto(); return; }
    const gp = e.target.closest('[data-gopin]'); if (gp){ e.stopPropagation(); gotoPin(gp.dataset.gopin); return; }
    const r = e.target.closest('[data-goi]'); if (r) runGoto(+r.dataset.goi);
  });
  el.addEventListener('mousemove', e => { const r = e.target.closest('[data-goi]'); if (r && +r.dataset.goi !== GOTO.i){ GOTO.i = +r.dataset.goi; el.querySelectorAll('.gorow').forEach((g, i) => { g.classList.toggle('on', i === GOTO.i); g.setAttribute('aria-selected', i === GOTO.i); }); } });
  el.addEventListener('input', e => { if (e.target.id === 'gotoq'){ GOTO.q = e.target.value; GOTO.i = 0; renderGoto(); } });
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); closeGoto(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){ e.preventDefault(); const n = GOTO.items.length; if (n){ GOTO.i = (GOTO.i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; renderGoto(); } }
    else if (e.key === 'Enter' && e.shiftKey){ e.preventDefault(); const x = GOTO.items[GOTO.i]; if (x && x.n) gotoPin(x.n.id); }
    else if (e.key === 'Enter'){ e.preventDefault(); runGoto(GOTO.i); }
  });
  document.body.appendChild(el);
  renderGoto();
  $('gotoq').focus();
}
function closeGoto(){ const el = $('goto'); if (el) el.remove(); }
function gotoPin(id){ const was = PINS.includes(id); togglePin(id); renderGoto(); const q = $('gotoq'); if (q) q.focus(); toast(was ? 'Unpinned' : 'Pinned as a space'); }
function runGoto(i){ const x = GOTO.items[i]; if (!x) return; closeGoto(); x.run(); }


/* ---------- One process, up close (the Details drop-down) ---------- */
// Click a process: /api/proc takes a ~1.5 s look at it (inspect_linux.py / inspect_windows.ps1 / ps+lsof on a
// Mac), again on every poll while it stays open. What its threads were doing adds up over every look, so the
// answer to "what does it wait on" is over the whole time you watched, not one snapshot.
const WAIT_LABEL = {cpu:'Running on a CPU', cpuwait:'Waiting for a CPU', disk:'Disk I/O', netfs:'Network storage (NFS, SMB, FUSE)', memory:'Memory: paging',
  gpu:'The GPU', lock:'Locks: its other threads', network:'Network', io:'Async I/O', pipe:'Pipes and other processes', events:'Waiting for events or requests',
  timer:'Sleeping on a timer', child:'Its child processes', signal:'Waiting for a signal', sleep:'Sleeping', idle:'Idle', stopped:'Stopped', other:'Other kernel waits'};
const WAIT_IDLE = new Set(['events', 'timer', 'sleep', 'idle', 'signal', 'child', 'stopped']);
const VERDICT = {cpu:'CPU: it is running most of the time it isn’t idle', cpuwait:'A CPU: it is ready to run but waits for a free core', membw:'Memory: it runs, but stalls on cache misses',
  throttled:'Its CPU limit: the cgroup throttles it', disk:'The disk', netfs:'Network storage', memory:'Memory: it waits on paging', gpu:'The GPU', lock:'Locks: its own other threads',
  network:'The network', io:'Async I/O', pipe:'Other processes, through pipes', other:'The kernel (other waits)', idle:'Nothing: it is idle, waiting for work'};
function toggleInspect(mid, pid, row){
  if (INSP.pid === pid && INSP.mid === mid){ closeInspect(); return; }
  const tbl = row && row.closest('.ptbl');
  Object.assign(INSP, {via:null, mid, pid, name:'', data:null, good:null, acc:{}, samples:0, secs:0, looks:0, busy:false, cacheLooks:[],
    order:tbl ? [...tbl.querySelectorAll('tbody tr[data-pid]')].map(r => +r.dataset.pid) : null,
    gorder:tbl ? [...tbl.querySelectorAll('[data-gtoggle]')].map(b => b.dataset.gtoggle) : null});
  const pr = PROCS.list.find(p => p[0] === pid); INSP.name = pr ? pr[1] : '';
  lastMainHTML = ''; renderMain(); inspectTick();
}
function closeInspect(){ if (!INSP.pid) return; Object.assign(INSP, {via:null, mid:null, pid:0, order:null, gorder:null, data:null, good:null, acc:{}, looks:0}); lastMainHTML = ''; renderMain(); }
async function inspectTick(){
  // a process in Docker's VM is looked at only the way you picked (#218): a helper container, or its own container
  if (!INSP.pid || INSP.busy || (typeof INSP.pid === 'string' && !INSP.via)) return;
  const mid = INSP.mid, pid = INSP.pid;
  INSP.busy = true;
  let d;
  const q = typeof pid === 'string' ? `key=${encodeURIComponent(pid)}&via=${INSP.via}` : `pid=${pid}`;
  try { d = await (await fetch(`/api/proc?machine=${encodeURIComponent(mid)}&${q}`, {cache:'no-store'})).json(); }
  catch (e) { d = {pid, error:'Fleet didn’t answer'}; }
  INSP.busy = false;
  if (INSP.pid !== pid || INSP.mid !== mid) return;
  INSP.data = d; INSP.looks++;
  if (!d.error && !d.gone){
    INSP.good = d; if (d.name) INSP.name = d.name;
    const w = Object.assign({}, d.waits || {});
    // a running thread is either on a core or queued for one: the scheduler's own times say which
    const run = d.cpu && d.cpu.run_s || 0, q = d.cpu && d.cpu.runq_s || 0;
    if (w.cpu && q > 0){ const r = q / (run + q); w.cpuwait = (w.cpuwait || 0) + w.cpu * r; w.cpu *= 1 - r; }
    for (const [k, v] of Object.entries(w)) INSP.acc[k] = (INSP.acc[k] || 0) + v;
    INSP.samples += d.samples || 0; INSP.secs += d.dt || 0;
    if (d.cache && d.cache.refs != null){ const dt = d.dt || 1.5, c = d.cache; INSP.cacheLooks.push({t:d.t || Date.now() / 1000, dt, refs:c.refs * dt, misses:c.misses * dt, ins:(c.instructions || 0) * dt, cyc:(c.cycles || 0) * dt, ipc:c.ipc}); }
  }
  lastMainHTML = ''; renderMain();
}
function inspVerdict(acc, d){
  const tot = Object.values(acc).reduce((a, b) => a + b, 0);
  if (!tot) return null;
  const active = Object.entries(acc).filter(([k]) => !WAIT_IDLE.has(k)).sort((a, b) => b[1] - a[1]);
  const share = active.reduce((a, [, v]) => a + v, 0) / tot, cores = d && d.cpu ? (d.cpu.user || 0) + (d.cpu.system || 0) : 0;
  if (!active.length || (share < 0.1 && cores < 0.05)) return 'idle';
  let k = active[0][0];
  if (k === 'cpu' && d && d.cgroup && d.cgroup.cpu_limit && d.cgroup.throttled > 0.05) k = 'throttled';
  else if (k === 'cpu' && d && d.cache && d.cache.miss_pct > 0.25 && d.cache.ipc != null && d.cache.ipc < 0.8) k = 'membw';
  return k;
}
const shareText = v => v >= 0.995 ? '100%' : v >= 0.01 ? Math.round(v * 100) + '%' : v > 0 ? '<1%' : '0%';
const ibytes = b => b == null ? '—' : memText(b / 1073741824);
const ibps = b => b == null ? '—' : rateText(b / 1e6);
const perSec = v => v == null ? '—' : (v >= 100 ? Math.round(v).toLocaleString() : v >= 1 ? v.toFixed(1) : v > 0 ? '<1' : '0') + '/s';
const kvRow = (k, v, title) => `<div class="kv"${title ? ` title="${esc(title)}"` : ''}><span>${esc(k)}</span><b>${v}</b></div>`;
// "0-15,32" stays as it is; a Windows bitmask (16777215) becomes "CPUs 0–23"
function affinityText(a){
  if (!/^\d+$/.test(a)) return a;
  let m = BigInt(a), i = 0, runs = [], start = -1;
  for (; m > 0n || start >= 0; i++, m >>= 1n){ const on = (m & 1n) === 1n; if (on && start < 0) start = i; if (!on && start >= 0){ runs.push(start === i - 1 ? String(start) : `${start}–${i - 1}`); start = -1; } }
  return runs.length ? 'CPUs ' + runs.join(', ') : a;
}
// Cache misses over a lookback (#20): the misses of every look in the window over their references, not an
// average of rates; the window is counted back from the latest look. Kept as a UI pref.
const LOOKBACKS = [[10, '10 s'], [60, '1 min'], [300, '5 min'], [0, 'All']];
function cacheRows(cache){
  const lb = PREFS.cacheLookback != null ? PREFS.cacheLookback : 60, all = INSP.cacheLooks;
  const last = all.length ? all[all.length - 1].t : 0, ls = all.filter(x => lb === 0 || x.t >= last - lb);
  const sum = k => ls.reduce((a, x) => a + x[k], 0), refs = sum('refs'), misses = sum('misses'), secs = sum('dt'), cyc = sum('cyc');
  const ipc = cyc > 0 ? sum('ins') / cyc : cache.ipc;
  const seg = `<div class="seg lbseg" role="group" aria-label="Count cache misses over">${LOOKBACKS.map(([v, l]) => `<button type="button" data-lookback="${v}" aria-pressed="${lb === v}">${l}</button>`).join('')}</div>`;
  return [seg, kvRow('Cache misses', `<span data-cachemiss>${refs > 0 ? shareText(misses / refs) : '—'}</span>`, 'last-level cache misses, of its references, over the lookback'),
    kvRow('Misses', perSec(secs ? misses / secs : cache.misses)),
    ipc != null ? kvRow('Instructions per cycle', ipc.toFixed(2), 'under ~0.8 while busy usually means it waits on memory') : '',
    kvRow('Threads counted', String(cache.threads)),
    `<p class="insp-sub">over ${ls.length} look${ls.length === 1 ? '' : 's'} · ${Math.round(secs)} s of counting</p>`];
}
function sinceText(t){ const s = Date.now() / 1000 - t; return s < 90 ? Math.round(s) + ' s ago' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 172800 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; }
function inspectPanel(p){
  if (typeof INSP.pid === 'string' && !INSP.via) return vmInspectPanel(p);
  const d = INSP.data, g = INSP.good, name = (g && g.name) || INSP.name || (p && p[1]) || '';
  const close = `<button type="button" class="iconbtn" data-inspclose="1" aria-label="Close" title="Close (Esc)">${icon('x', 2.2)}</button>`;
  const head = `<div class="insp-h"><div><b>${esc(name)}</b> <span class="mono">PID ${typeof INSP.pid === 'string' ? pidNum(INSP.pid) + ' in Docker’s VM · ' + (INSP.via === 'helper' ? 'through a helper container' : 'inside its container') : INSP.pid}</span>${g && g.cmdline ? `<div class="insp-cmd mono">${esc(g.cmdline)}</div>` : ''}</div>${close}</div>`;
  if (!d) return `<div class="insp">${head}<div class="insp-wait">Looking at it… (about 2 seconds)</div></div>`;
  let note = '';
  if (d.gone) note = noteHTML(`<b>${esc(name || 'This process')} has exited.</b> What Fleet saw before is below.`, 'warn');
  else if (d.error) note = noteHTML(`<b>Couldn’t look at it just now.</b> ${esc(d.error)}`, 'warn');
  if (!g) return `<div class="insp">${head}${note}</div>`;
  const acc = INSP.acc, tot = Object.values(acc).reduce((a, b) => a + b, 0);
  const vk = inspVerdict(acc, g);
  const waits = Object.entries(acc).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    `<div class="wrow${WAIT_IDLE.has(k) ? ' idle' : ''}" data-wait="${esc(k)}"><span>${esc(WAIT_LABEL[k] || k)}</span><span class="wbar"><i style="width:${(v / tot * 100).toFixed(1)}%"></i></span><span class="wv">${shareText(v / tot)}</span></div>`).join('');
  const wait = `<div class="insp-wait"><div class="verdict" data-verdict="${esc(vk || '')}"><span>Mostly waits on</span><b>${esc(vk ? VERDICT[vk] || vk : '…')}</b></div>`
    + `<div class="waits">${waits}</div><div class="insp-sub" data-watched="1">Every thread, sampled every 0.1 s · ${INSP.looks} look${INSP.looks === 1 ? '' : 's'} (${Math.round(INSP.secs)} s of samples) since you opened it</div></div>`;
  const c = g.cpu || {}, m = g.mem || {}, io = g.io, cg = g.cgroup, cache = g.cache;
  const cards = [];
  cards.push(['CPU', [kvRow('User', pct((c.user || 0) * 100), 'of one core'), c.system != null ? kvRow('System', pct(c.system * 100), 'of one core') : '',
    c.ctx_vol != null ? kvRow('Switches: waits', perSec(c.ctx_vol), 'voluntary context switches: it blocked on something') : '',
    c.ctx_invol != null ? kvRow('Switches: preempted', perSec(c.ctx_invol), 'involuntary: the scheduler took the core away') : '',
    c.runq_s != null ? kvRow('Queued for a core', Math.round(c.runq_s * 1000) + ' ms/s') : '',
    cg && cg.cpu_limit ? kvRow('CPU limit', num(cg.cpu_limit) + ' cores') : '', cg && cg.cpu_limit ? kvRow('Throttled', pct((cg.throttled || 0) * 100)) : '',
    g.affinity ? kvRow('May run on', esc(affinityText(g.affinity))) : '', g.last_cpu >= 0 ? kvRow('Last ran on', 'cpu' + g.last_cpu) : '',
    kvRow('Priority', `nice ${g.nice || 0}` + (g.priority_class ? ' · ' + esc(g.priority_class) : ''))]]);
  cards.push(['Memory', [kvRow('Resident', ibytes(m.rss)), m.anon != null ? kvRow('Its own (anon)', ibytes(m.anon)) : '', m.file != null ? kvRow('Files mapped', ibytes(m.file)) : '',
    m.shmem ? kvRow('Shared', ibytes(m.shmem)) : '', m.private != null ? kvRow('Private', ibytes(m.private)) : '', m.swap != null ? kvRow('Swapped out', ibytes(m.swap)) : '',
    m.peak != null ? kvRow('Peak', ibytes(m.peak)) : '', m.majflt != null ? kvRow('Page faults from disk', perSec(m.majflt)) : '', m.faults != null ? kvRow('Page faults', perSec(m.faults)) : '',
    cg && cg.mem_limit ? kvRow('Its cgroup', `${ibytes(cg.mem_current)} of ${ibytes(cg.mem_limit)}`) : '', cg && cg.oom_kills ? kvRow('Out-of-memory kills', String(cg.oom_kills)) : '']]);
  cards.push(['CPU cache', cache ? cacheRows(cache) : [`<p class="insp-sub">${esc(g.cache_error || 'Not available here')}</p>`]]);
  if (io) cards.push(['Disk', [kvRow('Reads', ibps(io.read)), kvRow('Writes', ibps(io.write)), io.other != null ? kvRow('Other I/O', ibps(io.other)) : '',
    io.delayacct && io.blkio_delay != null ? kvRow('Blocked on I/O', pct(io.blkio_delay * 100), 'of the time, from the kernel’s delay accounting') : '']]);
  const pr = cg && cg.pressure;
  if (pr) cards.push([cg.path === '/' ? 'Whole machine stalled' : 'Its cgroup stalled', [['cpu', 'On CPU'], ['memory', 'On memory'], ['io', 'On I/O']].map(([k, l]) => pr[k] && pr[k].some
    ? kvRow(l, `${pct(pr[k].some.avg10)} · ${pct(pr[k].some.avg60)} · ${pct(pr[k].some.avg300)}`, 'share of time some task waited: last 10 s · 1 min · 5 min') : '').concat([`<p class="insp-sub mono">${esc(cg.path)}</p>`])]);
  const conns = g.conns || [], listen = conns.filter(x => x.state === 'listening'), est = conns.filter(x => x.remote);
  cards.push(['Network', [kvRow('Sockets', String(g.conns_n || 0)), listen.length ? kvRow('Listens on', esc([...new Set(listen.map(x => x.proto + ' :' + x.local.split(':').pop()))].slice(0, 6).join(', '))) : '']
    .concat(est.slice(0, 6).map(x => `<div class="kv mono"><span>${esc(x.remote)}</span><b>${esc(x.state)}</b></div>`))]);
  if (g.handles != null) cards.push(['Handles', [kvRow('Open handles', g.handles.toLocaleString(), 'files, registry keys, events, threads and more')]]);
  else cards.push(['Files', [kvRow('Open', g.fd_limit > 0 ? `${(g.fds || 0).toLocaleString()} of ${g.fd_limit.toLocaleString()}` : (g.fds || 0).toLocaleString())]
    .concat((g.files || []).slice(0, 6).map(f => `<div class="kv mono"><span title="${esc(f)}">${esc(f)}</span></div>`))]);
  cards.push(['Process', [kvRow('User', esc(g.user || '—')), kvRow('Parent', g.ppid ? `PID ${g.ppid}` : '—'), g.started ? kvRow('Started', sinceText(g.started)) : '',
    kvRow('Threads', String(g.threads_n || '—')), g.exe ? `<div class="kv mono"><span title="${esc(g.exe)}">${esc(g.exe)}</span></div>` : '', g.cwd ? kvRow('Working dir', `<span class="mono">${esc(g.cwd)}</span>`) : '']]);
  const th = (g.threads || []).filter(t => t.name || t.tid).slice(0, 8);
  const threads = th.length ? `<div class="icard wide"><h4>Busiest threads</h4><table class="ithr"><tbody>${th.map(t => `<tr><td class="l">${esc(t.name || '—')}</td><td>${t.tid}</td><td>${t.total != null ? num(t.total) + ' s in all' : pct((t.cpu || 0) * 100)}</td><td class="l">${esc(WAIT_LABEL[t.doing] || t.doing || '')}</td></tr>`).join('')}</tbody></table></div>` : '';
  return `<div class="insp">${head}${note}${wait}<div class="insp-grid">${cards.map(([h, rows]) => `<div class="icard"><h4>${h}</h4>${rows.filter(Boolean).join('')}</div>`).join('')}${threads}</div></div>`;
}


/* ---------- Panels, find, back and forward ---------- */
// The panel you're in (tree, page, docked Details) has a soft outline; ⌘F searches that panel.
function panelOf(t){ if (!t || !t.closest) return null; if (t.closest('.dpanel')) return 'details'; if (t.closest('aside.side')) return 'tree'; if (t.closest('#main')) return 'main'; return null; }
function markPanel(){
  const side = document.querySelector('aside.side'), main = $('main'); if (!side || !main) return;
  const wrap = main.querySelector(':scope > .split > .wrap'), dp = main.querySelector('.dpanel');
  side.classList.toggle('pactive', PANEL === 'tree');
  main.classList.toggle('pactive', PANEL === 'main' && !wrap);
  if (wrap) wrap.classList.toggle('pactive', PANEL === 'main');
  if (dp) dp.classList.toggle('pactive', PANEL === 'details');
}
function notePanel(e){ const p = panelOf(e.target); if (p && p !== PANEL){ PANEL = p; markPanel(); } }
document.addEventListener('pointerdown', notePanel, true);
document.addEventListener('focusin', notePanel);

// The tree: matching nodes and their ancestors
function treeMatches(rootList, q){
  const want = q.trim().toLowerCase(), keep = new Set(), byGroup = new Set();
  for (const [key, list] of Object.entries(PREFS.tgroups || {})){
    if (!key.startsWith(treeScope() + '|')) continue;
    list.forEach(g => {
      const ms = g.ids.map(id => nodes[id] || netNodes[id]).filter(Boolean);
      if (g.name.toLowerCase().includes(want) || GKIND[groupKind(ms)][1].includes(want)) g.ids.forEach(id => byGroup.add(id));
    });
  }
  (function w(list, path){ list.forEach(n => {
    const kids = n.children || [];
    if ((n.name || '').toLowerCase().includes(want) || byGroup.has(n.id)){ keep.add(n.id); path.forEach(a => keep.add(a.id)); }
    w(kids, path.concat([n]));
  }); })(rootList, []);
  return keep;
}
function openTreeFind(){
  const box = $('tfind'), q = $('tfq'); if (!box || !q) return false;
  TF.open = true; box.hidden = false; q.focus(); q.select(); PANEL = 'tree'; markPanel(); return true;
}
function closeTreeFind(){ TF.open = false; TF.q = ''; const q = $('tfq'); if (q) q.value = ''; $('tfind').hidden = true; renderTree(); const r = document.querySelector('#tree .row.sel') || document.querySelector('#tree .row'); if (r) r.focus && r.focus(); }

// The page: rows and cards that contain the text, highlighted; Enter steps through them
function findScope(){ const m = $('main'); return m.querySelector(':scope > .split > .wrap') || m; }
function findTargets(){ return [...findScope().querySelectorAll('tbody tr, [data-select], [data-lcpu], [data-gsel], [data-dsel], [data-isel], .mcard-h')].filter(e => !e.closest('.dpanel') && !(e.matches('[data-select]') && e.closest('tbody tr'))); }
function applyFind(scroll){
  findScope().querySelectorAll('.fmatch, .fcur').forEach(e => e.classList.remove('fmatch', 'fcur'));
  const q = FIND.q.trim().toLowerCase(), cnt = $('mfcount');
  if (!q){ FIND.n = 0; if (cnt) cnt.textContent = ''; return; }
  const ms = findTargets().filter(e => e.textContent.toLowerCase().includes(q));
  FIND.n = ms.length; FIND.i = ms.length ? Math.min(FIND.i, ms.length - 1) : 0;
  ms.forEach((e, i) => e.classList.add('fmatch', ...(i === FIND.i ? ['fcur'] : [])));
  if (cnt) cnt.textContent = ms.length ? `${FIND.i + 1} of ${ms.length}` : 'none';
  if (scroll && ms[FIND.i]) ms[FIND.i].scrollIntoView({block:'center', inline:'nearest'});
}
function placeFind(){ const box = $('mfind'), r = findScope().getBoundingClientRect(); if (!box) return; box.style.top = (r.top + 10) + 'px'; box.style.right = Math.max(12, innerWidth - r.right + 18) + 'px'; }
function openFind(){
  const box = $('mfind'), q = $('mfq'); if (!box || !q) return false;
  box.hidden = false; placeFind(); q.focus(); q.select(); PANEL = 'main'; markPanel(); if (FIND.q) applyFind(true); return true;
}
function closeFind(){ FIND.q = ''; FIND.i = 0; const q = $('mfq'); if (q) q.value = ''; $('mfind').hidden = true; applyFind(false); }
function stepFind(d){ if (!FIND.n) return; FIND.i = (FIND.i + d + FIND.n) % FIND.n; applyFind(true); }
addEventListener('resize', () => { if (!$('mfind').hidden) placeFind(); });
document.addEventListener('input', e => {
  if (e.target.id === 'tfq'){ TF.q = e.target.value; renderTree(); }
  if (e.target.id === 'mfq'){ FIND.q = e.target.value; FIND.i = 0; applyFind(true); }
});
document.addEventListener('keydown', e => {
  if (e.target.id === 'mfq' && e.key === 'Enter'){ e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
  if (e.target.id === 'mfq' && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g'){ e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
});

// Back and Forward: every change of where you are (space, selection, tree, view, metric) is a step
const NAV_KEYS = ['space', 'sel', 'tree', 'netSel', 'view', 'metric'];
function navState(){ const o = {}; NAV_KEYS.forEach(k => { o[k] = S[k]; }); return o; }
function navRecord(){
  if (NAV.applying) return;
  const cur = navState(), top = NAV.stack[NAV.i];
  if (top && NAV_KEYS.every(k => top[k] === cur[k])) return;
  NAV.stack = NAV.stack.slice(0, NAV.i + 1).concat([cur]).slice(-200);
  NAV.i = NAV.stack.length - 1;
  renderNav();
}
function navGo(d){
  const j = NAV.i + d; if (j < 0 || j >= NAV.stack.length) return false;
  NAV.i = j; NAV.applying = true;
  Object.assign(S, NAV.stack[j]);
  for (let p = nodes[S.sel] && nodes[S.sel].parent; p; p = p.parent) S.open[p.id] = true;
  save(); NAV.applying = false;
  lastMainHTML = ''; renderAll(); renderNav(); refreshNow();
  return true;
}
function renderNav(){ const b = document.querySelector('[data-nav="back"]'), f = document.querySelector('[data-nav="fwd"]'); if (b) b.disabled = NAV.i <= 0; if (f) f.disabled = NAV.i >= NAV.stack.length - 1; }
document.addEventListener('mouseup', e => { if (e.button === 3 || e.button === 4){ e.preventDefault(); navGo(e.button === 3 ? -1 : 1); } });
navRecord();

/* ---------- Right-click menus (issue #7) ---------- */
// One menu system: ctxFor() turns whatever was clicked into a title and its actions. Tiles (CPUs, CCDs, GPUs,
// disks, interfaces) reuse their own select and pin buttons, so a new kind of tile gets a menu for free.
const CTX = {items:[], origin:null};
function copyText(text, what){
  window.__fleetCopied = text;
  const done = () => toast('Copied ' + what);
  const legacy = () => { const a = document.createElement('textarea'); a.value = text; a.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); } catch (e) {} a.remove(); };
  try { if (navigator.clipboard && window.isSecureContext){ navigator.clipboard.writeText(text).then(done, () => { legacy(); done(); }); return; } } catch (e) {}
  legacy(); done();
}
const termOk = n => n.kind === 'machine' ? (n.agent === 'local' || !!n.ssh) : (n.kind === 'service' || n.kind === 'container');
function openTerminal(id, terminal){ api('/api/terminal', terminal ? {node:id, terminal} : {node:id}).then(r => toast(r.ok ? `Opened ${r.title} in ${r.terminal}` : (r.error || 'Couldn’t open a terminal'))).catch(() => toast('Couldn’t reach Fleet')); }
function goNode(id, view){ S.view = view; select(id); if (view === 'details'){ S.detailsDocked = false; save(); lastMainHTML = ''; renderAll(); } }
// a tile's own pin button, as a menu item
function pinItem(scope, label){ const b = scope && scope.querySelector('[data-tpin]'); if (!b) return null; const on = b.getAttribute('aria-pressed') === 'true'; return {label:(on ? 'Unpin ' : 'Pin ') + label, run:() => b.click()}; }
// a tile's own select button: pick just it, or add it to (take it out of) the selection
function selItems(btn, what){
  if (!btn) return [];
  const on = btn.getAttribute('aria-pressed') === 'true';
  return [{label:`See what runs on ${what}`, run:() => { if (!on || document.querySelectorAll(`[aria-pressed="true"][${[...btn.attributes].find(a => /^data-(lcpu|lgroup|gsel|dsel|isel)$/.test(a.name)).name}]`).length > 1) btn.click(); }},
    ...(btn.matches('[data-lgroup], .lgbtn') ? [] : [{label:on ? `Take ${what} out of the selection` : `Add ${what} to the selection`, run:() => btn.dispatchEvent(new MouseEvent('click', {bubbles:true, metaKey:true, ctrlKey:true}))}])];
}
function ctxFor(t){
  if (!t || !t.closest || t.closest('.ptbl thead th, #ctxmenu, #colmenu, input, textarea, select')) return null;
  const tmb = t.closest('[data-terminal], [data-termchoose]'); if (tmb) return termMenu(tmb.dataset.terminal || tmb.dataset.termchoose);
  const tgh = t.closest('#tree .tg-h');
  if (tgh){
    const box = tgh.closest('.tgroup'), key = box.dataset.tgkey, id = box.dataset.tgroup, g = ((PREFS.tgroups || {})[key] || []).find(x => x.id === id);
    if (!g) return null;
    const kind = box.dataset.kind || 'taskforce', pinnable = !key.startsWith('network|'), pinned = PINS.includes('div:' + id);
    return {title:g.name, items:[{label:'Rename', run:() => renameGroup(key, id)},
      pinnable && {label:pinned ? 'Unpin' : 'Pin as a space', run:() => { buildDivisions(); togglePin('div:' + id); }},
      {label:'Disband ' + GKIND[kind][1], run:() => updGroup(key, id, null)}]};
  }
  const pr = t.closest('.ptbl tbody tr[data-pid]');
  if (pr){
    const mid = pr.closest('.ptbl').dataset.mid, pid = +pr.dataset.pid, p = PROCS.list.find(x => x[0] === pid); if (!p) return null;
    const owner = nodes[p[10]];
    return {title:`${p[1]} · PID ${pid}`, items:[
      {label:INSP.pid === pid ? 'Hide details' : 'Show details', run:() => toggleInspect(mid, pid, document.querySelector(`.ptbl tbody tr[data-pid="${pid}"]`))},
      owner && {label:`Show ${owner.name} in the tree`, run:() => goNode(owner.id, 'overview')},
      owner && {label:`Show only ${owner.name}`, run:() => goNode(owner.id, 'details')},
      '—', {label:'Copy PID', run:() => copyText(String(pid), 'PID ' + pid)}, {label:'Copy name', run:() => copyText(p[1], p[1])},
      p[9] && {label:'Copy command line', run:() => copyText(p[9], 'the command line')}]};
  }
  const tr = t.closest('#tree .row[data-select]');
  if (tr){
    const n = nodes[tr.dataset.select]; if (!n) return null;
    const pinnable = n.kind !== 'cron' && n.kind !== 'cronfolder', pinned = PINS.includes(n.id);
    return {title:n.name, items:[
      {label:'Open', run:() => goNode(n.id, 'overview')}, {label:'Show its processes', run:() => goNode(n.id, 'details')},
      pinnable && {label:pinned ? 'Unpin' : 'Pin as a space', run:() => togglePin(n.id)},
      termOk(n) && {label:'Open a terminal', run:() => openTerminal(n.id)},
      switchable(n) && {label:n.on ? 'Disconnect' : 'Connect', run:() => setConnected(n.id, !n.on)},
      ...groupMoveItems(n.id, tr.dataset.pk),
      ...(n.kind === 'division' ? groupEditItems(n) : []),
      '—', {label:'Copy name', run:() => copyText(n.name, n.name)},
      n.kind === 'machine' && n.ssh && {label:'Copy SSH destination', run:() => copyText(n.ssh, 'the SSH destination')}]};
  }
  const nr = t.closest('#tree .row[data-netsel]');
  if (nr){ const n = netNodes[nr.dataset.netsel]; if (!n) return null; return {title:n.name, items:[{label:'Open', run:() => { S.netSel = n.id; S.tree = 'network'; save(); renderAll(); }}, '—', {label:'Copy name', run:() => copyText(n.name, n.name)}]}; }
  const sp = t.closest('#spaces [data-space], #spaces .space');
  if (sp){
    const key = (sp.matches('[data-space]') ? sp : sp.querySelector('[data-space]')).dataset.space, name = key === 'fleet' ? 'All machines' : (nodes[key] || {name:key}).name;
    return {title:name, items:[{label:'Open', run:() => goSpace(key)}, key !== 'fleet' && {label:'Unpin', run:() => { togglePin(key); if (S.space === key) goSpace('fleet'); }}]};
  }
  const gm = t.closest('.ggroup [data-gm]');
  if (gm){
    const g = gm.closest('.ggroup'), m = nodes[S.sel], gi = m ? m.gpus.findIndex(x => x.key === g.dataset.gpu) : -1, k = gm.dataset.gm;
    const label = (GPU_M[k] || [k])[0];
    return {title:`GPU ${gi} · ${label}`, items:[...selItems(gm.querySelector('[data-gsel]'), 'GPU ' + gi).slice(0, 1), pinItem(gm, label)]};
  }
  const gh = t.closest('.ggroup .lgh');
  if (gh){ const g = gh.closest('.ggroup'), m = nodes[S.sel], gi = m ? m.gpus.findIndex(x => x.key === g.dataset.gpu) : -1; return {title:`GPU ${gi}`, items:[...selItems(gh.querySelector('[data-gsel]'), 'GPU ' + gi), pinItem(gh, 'GPU ' + gi)]}; }
  const lg = t.closest('.lgh');
  if (lg && lg.querySelector('[data-lgroup]')){ const name = lg.querySelector('[data-lgroup]').textContent.trim(); return {title:name, items:[...selItems(lg.querySelector('[data-lgroup]'), name), pinItem(lg, name)]}; }
  for (const [attr, what] of [['lcpu', v => 'CPU ' + v], ['gsel', v => 'GPU ' + v.replace('gpu', '')], ['dsel', v => v], ['isel', v => v]]){
    const btn = t.closest(`[data-${attr}]`) || (t.closest('.lcell, .gcell, .kcell') || {querySelector:() => null}).querySelector(`[data-${attr}]`);
    if (btn){ const name = what(btn.dataset[attr]), tile = btn.closest('.lcell, .gcell, .kcell') || btn.parentElement; return {title:name, items:[...selItems(btn, name), pinItem(tile, name)]}; }
  }
  return null;
}
function closeCtx(refocus){ const el = $('ctxmenu'); if (!el || el.hidden) return; el.hidden = true; el.innerHTML = ''; if (refocus && CTX.origin && CTX.origin.isConnected) CTX.origin.focus(); CTX.origin = null; }
function openCtx(spec, x, y, origin){
  let el = $('ctxmenu');
  if (!el){ el = document.createElement('div'); el.id = 'ctxmenu'; el.className = 'cxmenu'; el.setAttribute('role', 'menu'); document.body.appendChild(el); }
  CTX.items = spec.items.filter(Boolean); CTX.origin = origin;
  el.setAttribute('aria-label', spec.title);
  el.innerHTML = `<div class="cx-h">${esc(spec.title)}</div>` + CTX.items.map((it, i) => it === '—' ? '<div class="cx-sep" role="separator"></div>' : `<button type="button" role="menuitem" class="cx-i" data-cxi="${i}">${esc(it.label)}</button>`).join('');
  el.hidden = false;
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  el.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  const first = el.querySelector('[role=menuitem]'); if (first) first.focus();
}
document.addEventListener('contextmenu', e => {
  const spec = ctxFor(e.target);
  if (!spec || !spec.items.filter(x => x && x !== '—').length){ closeCtx(false); return; }
  e.preventDefault();
  openCtx(spec, e.clientX, e.clientY, e.target.closest('button, [tabindex]') || e.target);
});
document.addEventListener('click', e => {
  const el = $('ctxmenu'); if (!el || el.hidden) return;
  const it = e.target.closest('#ctxmenu [data-cxi]');
  if (it){ const f = CTX.items[+it.dataset.cxi]; closeCtx(false); if (f && f.run) f.run(); e.stopPropagation(); return; }
  if (!e.target.closest('#ctxmenu')) closeCtx(false);
}, true);
addEventListener('keydown', e => {
  const el = $('ctxmenu'), open = el && !el.hidden;
  if (!open && ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu')){
    const a = document.activeElement, spec = a && a !== document.body ? ctxFor(a) : null;
    if (spec){ e.preventDefault(); e.stopPropagation(); const r = a.getBoundingClientRect(); openCtx(spec, r.left + 8, r.bottom + 2, a); }
    return;
  }
  if (!open) return;
  const items = [...el.querySelectorAll('[role=menuitem]')], i = items.indexOf(document.activeElement);
  if (e.key === 'Escape' || e.key === 'Tab'){ e.preventDefault(); e.stopPropagation(); closeCtx(true); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){ e.preventDefault(); e.stopPropagation(); const n = items.length; items[((i < 0 ? -1 : i) + (e.key === 'ArrowDown' ? 1 : -1) + n) % n].focus(); return; }
  if (e.key === 'Home' || e.key === 'End'){ e.preventDefault(); e.stopPropagation(); items[e.key === 'Home' ? 0 : items.length - 1].focus(); return; }
  if ((e.key === 'Enter' || e.key === ' ') && i >= 0){ e.preventDefault(); e.stopPropagation(); const f = CTX.items[+items[i].dataset.cxi]; closeCtx(false); if (f && f.run) f.run(); }
}, true);
addEventListener('resize', () => closeCtx(false));

// Selecting nothing shows everything, strictly from the top: All machines (whatever space you were in), or
// the whole tailnet in the network tree.
function selectNone(){
  if (S.tree === 'network'){ S.netSel = 'net:tailnet'; save(); renderTree(); renderToolbar(); lastMainHTML = ''; renderMain(); return; }
  goSpace('fleet');
}


/* ---------- Divisions: custom groups in the trees (issues #8, #23) ---------- */
// Drag a box over items at the same level to group them. Groups live in ui.json (prefs.tgroups), keyed by
// tree (machines, pins, network) and parent, so Pins only and the network tree keep their own.
const TG_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
// the rows to draw, with group start/end markers; a group's members sit together where the first one would be
function groupedWalk(roots, kidsOf, openFn, shownFn, scope){
  const out = [];
  (function w(list, d, pk){
    const vis = list.filter(shownFn), key = scope + '|' + pk;
    const gs = ((PREFS.tgroups || {})[key] || []).map(g => ({g, members:vis.filter(n => g.ids.includes(n.id))})).filter(x => x.members.length);
    const placed = new Set(), items = [];
    const one = n => { out.push({n, d, pk}); if (n.children.length && openFn(n)) w(kidsOf(n), d + 1, n.id); };
    vis.forEach(n => {
      if (placed.has(n.id)) return;
      const gx = gs.find(x => x.members.includes(n));
      if (!gx) return items.push({n});
      gx.members.forEach(m => placed.add(m.id));
      items.push({gx});
    });
    // pinned groups go first at their level, as pinned rows go first in their list
    const pinnedFirst = items.filter(it => it.gx && PINS.includes('div:' + it.gx.g.id)).concat(items.filter(it => !(it.gx && PINS.includes('div:' + it.gx.g.id))));
    pinnedFirst.forEach(({n, gx}) => {
      if (n) return one(n);
      // a folded group is just its header; its members keep their own open state for when it unfolds
      const folded = !!(S.gfold && S.gfold[gx.g.id]);
      out.push({open:gx.g, key, d, kind:groupKind(gx.members), folded, count:gx.members.length}); if (!folded) gx.members.forEach(one); out.push({close:true});
    });
  })(roots, 0, 'root');
  return out;
}
function tgroupOpen({open:g, key, d, kind, folded, count}){
  const label = GKIND[kind][1], dup = g.name.toLowerCase().startsWith(label);
  const fold = `<button type="button" class="tg-fold${folded ? '' : ' open'}" data-tgfold="${esc(g.id)}" aria-expanded="${!folded}" aria-label="${folded ? 'Unfold' : 'Fold'} ${esc(g.name)}">${icon('chev', 2.4)}</button>`;
  return `<div class="tgroup${S.tree !== 'network' && S.sel === 'div:' + g.id ? ' sel' : ''}" data-tgroup="${esc(g.id)}" data-tgkey="${esc(key)}" data-kind="${kind}" role="group" aria-label="${esc(g.name)}, ${label}" style="--gc:var(--g-${kind});--d:${d}">`
    + `<div class="tg-h" title="Click to see this group; double-click to rename; right-click for more">${fold}<span class="tg-ic">${icon('g' + kind, 2)}</span><span class="tg-n">${esc(g.name)}</span>${dup ? '' : `<span class="tg-k">${label}</span>`}${folded ? `<span class="count">${count}</span>` : ''}${key.startsWith('network|') ? '' : `<span class="tg-pin">${pinBtn('div:' + g.id)}</span>`}</div>`;
}
function updGroup(key, id, f){
  const all = Object.assign({}, PREFS.tgroups || {});
  all[key] = (all[key] || []).map(g => g.id === id ? (f ? f(g) : null) : g).filter(Boolean);
  PREFS = Object.assign({}, PREFS, {tgroups:all}); divisionsChanged(); savePrefs('the groups');
}
// a group's key in prefs.tgroups ('<scope>|<parent>'), from its id
function groupKeyOf(id){ return Object.keys(PREFS.tgroups || {}).find(k => (PREFS.tgroups[k] || []).some(g => g.id === id)); }
function groupEditItems(n){
  const id = n.id.slice(4), key = groupKeyOf(id); if (!key) return [];
  return ['—', {label:'Rename', run:() => renameGroup(key, id)}, {label:'Disband ' + GKIND[n.gkind || 'taskforce'][1], run:() => updGroup(key, id, null)}];
}
function renameGroup(key, id){
  // the group's header in the tree, or its row in Groups only
  const n = document.querySelector(`#tree .tgroup[data-tgroup="${CSS.escape(id)}"] .tg-n`) || document.querySelector(`#tree .row[data-select="div:${CSS.escape(id)}"] .nm`); if (!n) return;
  const inp = document.createElement('input'); inp.className = 'tg-name'; inp.value = n.textContent; inp.setAttribute('aria-label', 'Group name');
  n.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const commit = ok => { if (done) return; done = true; const v = inp.value.trim().slice(0, 60); if (ok && v) updGroup(key, id, g => Object.assign({}, g, {name:v})); else renderTree(); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); commit(true); } if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); commit(false); } });
  inp.addEventListener('blur', () => commit(true));
}
$('tree').addEventListener('dblclick', e => { const h = e.target.closest('.tg-h'); if (h){ const b = h.closest('.tgroup'); renameGroup(b.dataset.tgkey, b.dataset.tgroup); } });
// the box: a press that moves more than a few pixels draws it instead of clicking
const MQ = {st:null, until:0};
$('tree').addEventListener('pointerdown', e => {
  if (S.groupsOnly && S.tree !== 'network') return;
  if (e.button !== 0 || e.target.closest('[data-toggle], [data-pin], [data-unpin], .tpin, .pin, input, .tg-h, .tdrag')) return;
  MQ.st = {x0:e.clientX, y0:e.clientY, on:false};
});
document.addEventListener('pointermove', e => {
  const m = MQ.st; if (!m) return;
  if (!m.on){ if (Math.hypot(e.clientX - m.x0, e.clientY - m.y0) < 6) return; m.on = true; m.box = document.createElement('div'); m.box.className = 'mqbox'; document.body.appendChild(m.box); }
  const x = Math.min(m.x0, e.clientX), y = Math.min(m.y0, e.clientY), w = Math.abs(e.clientX - m.x0), h = Math.abs(e.clientY - m.y0);
  Object.assign(m.box.style, {left:x + 'px', top:y + 'px', width:w + 'px', height:h + 'px'});
  document.querySelectorAll('#tree .row').forEach(r => { const b = r.getBoundingClientRect(); r.classList.toggle('mqhit', b.bottom > y && b.top < y + h && b.right > x && b.left < x + w); });
});
document.addEventListener('pointerup', () => {
  const m = MQ.st; MQ.st = null; if (!m || !m.on) return;
  MQ.until = Date.now() + 500;   // the click that ends a drag isn't a click
  m.box.remove();
  const hits = [...document.querySelectorAll('#tree .row.mqhit')]; hits.forEach(r => r.classList.remove('mqhit'));
  finishMarquee(hits);
});
addEventListener('click', e => { if (Date.now() < MQ.until && e.target.closest && e.target.closest('#tree')){ e.preventDefault(); e.stopImmediatePropagation(); MQ.until = 0; } }, true);   // only in the tree: a re-render may have removed the row the drag began on
function finishMarquee(hits){
  if (!hits.length) return;
  const ids = hits.map(r => r.dataset.select || r.dataset.netsel), pks = new Set(hits.map(r => r.dataset.pk));
  if (pks.size > 1){ toast('Only items at the same level can form a group: draw the box over siblings'); return; }
  if (hits.length < 2){ toast('Draw the box over two or more items at the same level to group them'); return; }
  const scope = S.tree === 'network' ? 'network' : S.pinsOnly ? 'pins' : 'machines', key = scope + '|' + [...pks][0];
  const all = Object.assign({}, PREFS.tgroups || {});
  const list = (all[key] || []).map(g => Object.assign({}, g, {ids:g.ids.filter(id => !ids.includes(id))})).filter(g => g.ids.length);
  list.push({id:'g' + Date.now().toString(36), name:newGroupName(list, ids), ids});
  all[key] = list;
  PREFS = Object.assign({}, PREFS, {tgroups:all}); divisionsChanged(); savePrefs('the groups');
}

// Moving items between groups: by the drag handle on every row, or from the row's menu (issue #22).
function treeScope(){ return S.tree === 'network' ? 'network' : S.pinsOnly ? 'pins' : 'machines'; }
function groupOf(key, id){ return ((PREFS.tgroups || {})[key] || []).find(g => g.ids.includes(id)); }
// id leaves every group at its level; then joins gid, or makes a new group with `withId`
function moveToGroup(key, id, gid, withId){
  const all = Object.assign({}, PREFS.tgroups || {});
  let list = (all[key] || []).map(g => Object.assign({}, g, {ids:g.ids.filter(x => x !== id && x !== withId)}));
  if (gid) list = list.map(g => g.id === gid ? Object.assign({}, g, {ids:g.ids.concat([id])}) : g);
  list = list.filter(g => g.ids.length);
  if (withId){
    list.push({id:'g' + Date.now().toString(36), name:newGroupName(list, [withId, id]), ids:[withId, id]});
  }
  all[key] = list;
  PREFS = Object.assign({}, PREFS, {tgroups:all}); divisionsChanged(); savePrefs('the groups');
}
function groupMoveItems(id, pk){
  const key = treeScope() + '|' + pk, gs = (PREFS.tgroups || {})[key] || [], mine = gs.find(g => g.ids.includes(id));
  const items = gs.filter(g => g !== mine).map(g => ({label:'Move to ' + g.name, run:() => moveToGroup(key, id, g.id)}));
  if (mine) items.push({label:'Remove from ' + mine.name, run:() => moveToGroup(key, id, null)});
  return items.length ? ['—'].concat(items) : [];
}
const TDRAG = {id:null, pk:null};
$('tree').addEventListener('dragstart', e => {
  const h = e.target.closest && e.target.closest('.tdrag'); if (!h) return;
  const row = h.closest('.row'); TDRAG.id = row.dataset.select || row.dataset.netsel; TDRAG.pk = row.dataset.pk;
  try { e.dataTransfer.setData('application/x-fleet-node', TDRAG.id); e.dataTransfer.effectAllowed = 'move'; } catch (x) {}
  row.classList.add('dragging');
});
$('tree').addEventListener('dragover', e => {
  if (!TDRAG.id) return;
  e.preventDefault();
  document.querySelectorAll('#tree .droptarget').forEach(x => x.classList.remove('droptarget'));
  const t = e.target.closest && (e.target.closest('.tgroup') || e.target.closest('.row')); if (t) t.classList.add('droptarget');
});
$('tree').addEventListener('drop', e => {
  if (!TDRAG.id) return;
  e.preventDefault();
  const {id, pk} = TDRAG, key = treeScope() + '|' + pk;
  TDRAG.id = null;
  const row = e.target.closest && e.target.closest('.row'), box = e.target.closest && e.target.closest('.tgroup');
  const other = () => toast('Only items at the same level can share a group: drag it among its siblings');
  if (row && (row.dataset.select || row.dataset.netsel) !== id){
    if (row.dataset.pk !== pk) return other();
    const g = groupOf(key, row.dataset.select || row.dataset.netsel);
    return g ? moveToGroup(key, id, g.id) : moveToGroup(key, id, null, row.dataset.select || row.dataset.netsel);
  }
  if (box && !row){ if (box.dataset.tgkey !== key) return other(); return moveToGroup(key, id, box.dataset.tgroup); }
  if (!row && groupOf(key, id)) moveToGroup(key, id, null);   // empty space: out of its group
});
$('tree').addEventListener('dragend', () => { TDRAG.id = null; document.querySelectorAll('#tree .dragging, #tree .droptarget').forEach(x => x.classList.remove('dragging', 'droptarget')); });

// A division is a node too (div:<id>), rebuilt with the model: its members are its children (their own parents
// don't change). A division of machines stands alone, like All machines; a deeper one hangs off its members'
// parent, so its share of their host works as for any group. (Network divisions stay in the network tree.)
function buildDivisions(){
  for (const k of Object.keys(nodes)) if (k.startsWith('div:')) delete nodes[k];
  for (const [key, list] of Object.entries(PREFS.tgroups || {})){
    const at = key.indexOf('|'), scope = key.slice(0, at), pk = key.slice(at + 1);
    if (scope === 'network') continue;
    list.forEach(g => {
      const members = g.ids.map(id => nodes[id]).filter(Boolean); if (!members.length) return;
      const types = new Set(members.map(m => m.type));
      const d = {id:'div:' + g.id, name:g.name, kind:'division', type:types.size === 1 ? [...types][0] : 'base', children:members,
        parent:pk === 'root' ? null : (nodes[pk] || null), gkind:groupKind(members)};
      d.color = `var(--g-${d.gkind})`;
      d.series = sumSeries(members); d.gseries = members.reduce((t, c) => addG(t, c.gseries), {});
      nodes[d.id] = d;
    });
  }
}
function divisionsChanged(){ buildDivisions(); renderSpaces(); renderTree(); if (PICK.open) renderPickerList(); }

// What a group is called comes from what's in it (#25): machines make a fleet, VMs a flotilla, containers a
// division, cron jobs a section, Docker Compose projects or services a squadron; anything mixed, a task force.
const GKIND = {fleet:['Fleet', 'fleet'], flotilla:['Flotilla', 'flotilla'], division:['Division', 'division'], section:['Section', 'section'],
  squadron:['Squadron', 'squadron'], taskforce:['Task force', 'task force']};
function groupKind(ms){
  const k = n => n.kind === 'machine' ? (n.parent ? 'flotilla' : 'fleet') : n.kind === 'container' || n.kind === 'ncontainer' ? 'division'
    : n.kind === 'cron' || n.kind === 'cronfolder' ? 'section' : n.kind === 'project' || n.kind === 'service' ? 'squadron' : n.kind === 'nmachine' ? 'fleet' : 'taskforce';
  const ks = new Set((ms || []).map(k));
  return ks.size === 1 ? [...ks][0] : 'taskforce';
}
function newGroupName(list, ids){
  const word = GKIND[groupKind(ids.map(id => nodes[id] || netNodes[id]).filter(Boolean))][0], names = new Set(list.map(g => g.name));
  let k = 1; while (names.has(word + ' ' + k)) k++;
  return word + ' ' + k;
}

// Pins only, with nothing selected: an all-up view of the pins (#57). Pinned machines alone get the All machines
// view of just them; a mix gets each pin with its share, to open it.
function pinsView(){
  const items = PINS.map(id => nodes[id]).filter(Boolean);
  if (items.length && items.every(n => n.kind === 'machine' && !n.parent)){
    const pv = nodes.pins = {id:'pins', name:'Pins only', kind:'division', gkind:'fleet', children:items, parent:null, color:'var(--accent)', type:'base'};
    pv.series = sumSeries(items); pv.gseries = items.reduce((t, c) => addG(t, c.gseries), {});
    return fleetView(pv);
  }
  const rows = items.map(n => {
    const v = rowVal(n), w = parseFloat(v) || 0, where = n.kind === 'machine' && !n.parent ? '' : n.kind === 'division' && !n.parent ? kindLabel(n) : (n.kind === 'division' ? kindLabel(n) + ' on ' : '') + hostOf(n).name;
    return `<div class="prow2"><button type="button" class="namebtn" data-select="${esc(n.id)}"><span class="ico" style="color:${colOf(n)}">${icon(iconOf(n))}</span>${esc(n.name)}</button>`
      + `<span class="pw">${esc(where)}</span><div class="track"><i style="width:${Math.min(100, w).toFixed(1)}%;background:${colOf(n)}"></i></div><span class="pv">${esc(v)}</span></div>`;
  }).join('');
  return `<div class="hero"><span class="tile" style="background:color-mix(in srgb, var(--accent) 22%, transparent);color:var(--accent)">${icon('pin')}</span><div><h1>Pins only</h1><div class="facts"><span>${items.length} pinned</span><span>${mlabel(S.metric)}: each pin's share of its host (or of itself, for a machine)</span></div></div></div>`
    + (items.length ? `<section class="card"><div class="card-h"><h2>Your pins · ${mlabel(S.metric)}</h2></div><div class="pinlist">${rows}</div></section>`
      : noteHTML('Nothing pinned yet: pin a machine, container or group with the pin on its row, or with <b>+</b> in the top bar.'));
}


/* ---------- + Add a machine (#165): how to add an SSH machine, then a short form ---------- */
async function openAddMachine(){
  if ($('addm')) return;
  const el = document.createElement('div'); el.id = 'addm-bg'; el.className = 'sheet-bg';
  el.innerHTML = `<div class="sheet addm" id="addm" role="dialog" aria-modal="true" aria-labelledby="addm-t">
    <div class="sheet-h"><h2 id="addm-t">Add a machine</h2><button type="button" class="iconbtn" data-addmclose="1" aria-label="Close">${icon('x', 2.2)}</button></div>
    <div class="sheet-b">
      <section><h3>Before you add it</h3><p class="sub">Fleet reads a machine over SSH from this computer, read-only, and installs nothing there.</p><ol>
        <li>Check you can log in without a password: <code>ssh user@host</code>. If it asks for one, copy your key there with <code>ssh-copy-id user@host</code>.</li>
        <li><b>Linux</b> needs <code>python3</code> (most have it). <b>Windows</b> needs OpenSSH Server (Settings, System, Optional features) and your key in <code>C:\\Users\\you\\.ssh\\authorized_keys</code>, or for an administrator account in <code>C:\\ProgramData\\ssh\\administrators_authorized_keys</code>.</li>
        <li><b>macOS</b> needs Remote Login on (System Settings, General, Sharing, Remote Login) and <code>python3</code> from the Command Line Tools: run <code>xcode-select --install</code> there once.</li>
        <li>The host can be an IP, a name from your <code>~/.ssh/config</code>, or a Tailscale name (MagicDNS on).</li>
        <li>A VM on one of your machines? Add it here, then set <b>Runs on</b> in Settings to nest it under its host.</li></ol></section>
      <section><h3>Then add it</h3><div class="mgrid">
        <label class="wide">SSH destination<input name="ssh" placeholder="user@host, an ~/.ssh/config name, or a Tailscale name" spellcheck="false" autocapitalize="off"></label>
        <label>Name<input name="name" placeholder="what Fleet calls it"></label>
        <label>System<select name="os"><option value="linux">Linux</option><option value="windows">Windows</option><option value="macos">macOS</option></select></label></div>
        <div class="mtest"><button type="button" class="btn" data-addmtest="1">${icon('refresh')}Test connection</button><span class="tres"></span></div>
        <div class="addm-err" role="alert"></div></section>
    </div>
    <div class="sheet-f"><button type="button" class="btn" data-addmclose="1">Cancel</button><button type="button" class="btn primary" data-addmsave="1">Add to Fleet</button></div></div>`;
  document.body.appendChild(el);
  const q = n => el.querySelector(`[name=${n}]`), res = el.querySelector('.tres'), err = el.querySelector('.addm-err');
  const close = () => { el.remove(); const b = document.querySelector('[data-addmachinedlg]'); if (b) b.focus(); };
  el.addEventListener('keydown', e => { if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(); } });
  el.addEventListener('click', async e => {
    if (e.target === el || e.target.closest('[data-addmclose]')){ close(); return; }
    if (e.target.closest('[data-addmtest]')){
      const ssh = q('ssh').value.trim(); if (!ssh){ err.textContent = 'Type the SSH destination first.'; return; }
      res.className = 'tres'; res.textContent = 'Testing…';
      try { const r = await api('/api/test', {ssh, os:q('os').value}); res.className = 'tres ' + (r.ok ? 'good' : 'bad'); res.innerHTML = r.ok ? icon('check') + 'Connected' : 'Failed' + (r.output ? ` · <code>${esc(String(r.output).split('\n').slice(0, 2).join(' · '))}</code>` : ''); }
      catch (x) { res.className = 'tres bad'; res.textContent = 'Fleet didn’t answer'; }
      return;
    }
    if (e.target.closest('[data-addmsave]')){
      const ssh = q('ssh').value.trim(), name = q('name').value.trim() || ssh, os = q('os').value;
      if (!ssh){ err.textContent = 'Type the SSH destination first.'; q('ssh').focus(); return; }
      err.textContent = '';
      try {
        const cfg = await (await fetch('/api/config', {cache:'no-store'})).json(), machines = (cfg.machines || []).map(m => Object.assign({}, m));
        const m = {id:slugId(name, new Set(machines.map(x => x.id))), name, ssh, os, tile:os === 'windows' ? 'desktop' : os === 'macos' ? 'laptop' : 'server'};
        const r = await api('/api/config', {interval:Number(cfg.interval) || 3, terminal:cfg.terminal || 'auto', machines:machines.concat([m])});
        if (r.ok === false){ err.textContent = (r.errors || ['Couldn’t save.']).join(' '); return; }
        close(); toast(`Added ${name}. Connecting…`); setTimeout(refreshNow, 2500);
      } catch (x) { err.textContent = 'Couldn’t reach Fleet to save.'; }
    }
  });
  q('ssh').focus();
}

/* ---------- connections: on and off by hand, and which connect when Fleet starts ---------- */
const AC = {naming:false};
function connDot(n){
  return `<button type="button" class="sdot ${statusClass(n)}" data-sdot="${esc(n.id)}" data-conn="${esc(n.id)}" aria-pressed="${n.on}" aria-label="${n.on ? 'Disconnect' : 'Connect'} ${esc(n.name)}" title="${connTitle(n)}"></button>`;
}
function connTitle(n){
  if (!n.on) return 'off · click to connect';
  return (n.status === 'off' ? 'stopped on its host' : statusText(n)) + ' · click to disconnect';
}
async function setConnected(id, on){
  const n = nodes[id];
  if (n){ n.on = on; n.status = on ? 'connecting' : 'disabled'; updateTree(); }
  try {
    const r = await api('/api/connect', {machine:id, on});
    if (r.connect && DATA) DATA.connect = r.connect;
    if (!r.ok) toast('Couldn’t change that connection');
    else toast(`${on ? 'Connecting to' : 'Disconnected'} ${n ? n.name : id}`);
  } catch (e) { toast('Couldn’t change that connection'); }
  lastMainHTML = ''; refreshNow();
}
function autoLabel(c){ return !c || c.auto === 'none' ? 'None' : c.auto === 'all' ? 'All' : c.auto; }   // nothing chosen: None (#224)
function renderAutoConn(){
  const box = $('autoconn'); if (!box || AC.naming) return;
  const c = DATA && DATA.connect, label = autoLabel(c);
  const html = `<button type="button" class="btn autoc-btn" data-autoconn="1" aria-haspopup="menu" title="Which machines Fleet connects to when it starts">${icon('power')}<span>Auto: ${esc(label)}</span></button>`;
  if (box.innerHTML !== html) box.innerHTML = html;
}
async function connApi(body){
  try {
    const r = await api('/api/connect', body);
    if (r.connect && DATA) DATA.connect = r.connect;
    if (!r.ok) toast(r.error || 'Couldn’t change that');
  } catch (e) { toast('Couldn’t change that'); }
  AC.naming = false; renderAutoConn();
}
function openAutoConn(btn){
  const c = (DATA && DATA.connect) || {auto:'none', presets:{}}, names = Object.keys(c.presets || {});
  const opt = (key, label) => ({label:(c.auto === key ? '✓ ' : '') + label, run:() => connApi({auto:key})});
  const r = btn.getBoundingClientRect();
  openCtx({title:'Connect when Fleet starts', items:[
    opt('all', 'All machines'), ...names.map(k => opt(k, k)), opt('none', 'None'), '—',
    {label:'Choose machines…', run:openChooseMachines},
    {label:'Save what’s connected now as a set…', run:startNaming},
    ...names.map(k => ({label:`Delete “${k}”`, run:() => connApi({delete:k})}))]}, r.left, r.top - 8, btn);
}
function startNaming(){
  const box = $('autoconn'); if (!box) return;
  AC.naming = true;
  box.innerHTML = `<input id="autoname" class="autoc-name" maxlength="60" placeholder="Name this set" aria-label="Name for the machines connected now" autocomplete="off">`;
  const i = $('autoname'); i.focus();
  i.addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); const v = i.value.trim(); if (v) connApi({save:v}); }
    else if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); AC.naming = false; renderAutoConn(); }
  });
  i.addEventListener('blur', () => setTimeout(() => { if (AC.naming && document.activeElement !== i){ AC.naming = false; renderAutoConn(); } }, 150));
}

/* ---------- machine tiles that show the OS (#214: icon set #23, "side tag split") ---------- */
// A strip down the right in the OS colour, with the OS's glyph on it; the kind icon to its left. The glyphs are plain
// shapes (a penguin, four panes, an apple without a bite), not the vendors' logos.
const OSG_PB = 'M12 2.6C9.3 2.6 7.9 4.8 7.9 7.6c0 1.5-.7 2.7-1.6 4C5.1 13.4 4.5 15.4 5 17.6c.4 1.8 1.8 3.2 3.6 3.6h6.8c1.8-.4 3.2-1.8 3.6-3.6.5-2.2-.1-4.2-1.3-6-.9-1.3-1.6-2.5-1.6-4 0-2.8-1.4-5-4.1-5z', OSG_BELLY = '<ellipse cx="12" cy="15.8" rx="3.7" ry="4.7"/>', OSG_APPLE = 'M12 8.2C10.6 7.2 8.8 6.8 7.2 7.5 4.9 8.5 4.2 11.3 4.8 13.9c.6 2.7 2.4 6.1 4.6 6.4 1 .1 1.6-.4 2.6-.4s1.6.5 2.6.4c2.2-.3 4-3.7 4.6-6.4.6-2.6-.1-5.4-2.4-6.4-1.6-.7-3.4-.3-4.8.7z', OSG_LEAF = 'M12.3 6.6c0-2 1.3-3.4 3.3-3.6 0 2-1.3 3.4-3.3 3.6z', OSG_PANES = '<rect x="4" y="4" width="7.3" height="7.3" rx=".9"/><rect x="12.7" y="4" width="7.3" height="7.3" rx=".9"/><rect x="4" y="12.7" width="7.3" height="7.3" rx=".9"/><rect x="12.7" y="12.7" width="7.3" height="7.3" rx=".9"/>';
function osKey(s){
  s = String(s || '');
  if (/windows/i.test(s)) return 'windows';
  if (/mac ?os|darwin|os x/i.test(s)) return 'macos';
  if (/linux|ubuntu|debian|unraid|fedora|cent ?os|rhel|red hat|rocky|alma|alpine|arch|manjaro|nixos|suse|mint|pop!?_os|raspbian|gentoo|truenas|proxmox/i.test(s)) return 'linux';
  return '';
}
function osGlyph(os, lo){
  if (os === 'linux') return `<ellipse cx="9.3" cy="21.1" rx="2.6" ry="1.2" fill="#e07800"/><ellipse cx="14.7" cy="21.1" rx="2.6" ry="1.2" fill="#e07800"/><path d="${OSG_PB}" fill="#18181b"/><g fill="#fafafa">${OSG_BELLY}</g>`
    + (lo ? '' : `<circle cx="10.5" cy="7.1" r="1.15" fill="#fff"/><circle cx="13.5" cy="7.1" r="1.15" fill="#fff"/><circle cx="10.7" cy="7.3" r=".5" fill="#18181b"/><circle cx="13.3" cy="7.3" r=".5" fill="#18181b"/><path d="M10.4 9.1h3.2L12 11z" fill="#f6be2c"/>`);
  if (os === 'windows') return `<g fill="#ffffff">${OSG_PANES}</g>`;
  return `<path d="${OSG_APPLE}" fill="var(--os-macos-ink)"/><path d="${OSG_LEAF}" fill="var(--os-macos-ink)"/>`;
}
// the tree keeps its line icons: the kind icon in its usual colour, then the OS tag beside it
function treeMachineIcon(n){
  const os = machineOS(n), col = colOf(n);
  return `<span class="ico osico" data-os="${os}" title="${{linux:'Linux', windows:'Windows', macos:'macOS'}[os]}" style="color:${col}"><svg viewBox="0 0 31 24" aria-hidden="true">`
    + `<g class="kind-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 1) scale(.92)">${IC[n.tile] || IC.terminal}</g>`
    + `<rect class="os-strip" x="23" y="1.5" width="8" height="21" rx="2.5" fill="var(--os-${os})"/>`
    + `<g class="os-glyph" transform="translate(23.4 8.4) scale(${(7.2 / 24).toFixed(4)})">${osGlyph(os, true)}</g></svg></span>`;
}
// big: the machine page's 46 px tile (set #23 at 40 px); otherwise its small layout (20-28 px tiles)
function tileHTML(kind, os, big){
  if (!os) return `<span class="tile ${esc(kind)}">${icon(kind)}</span>`;
  const w = big ? 11 : 14, s = 21, gs = big ? 9.6 : 11.5, x = big ? 4.5 : 2;   // the icon on the left, the strip right of it
  const at = (m, cx, cy, size) => `<g transform="translate(${(cx - size / 2).toFixed(2)} ${(cy - size / 2).toFixed(2)}) scale(${(size / 24).toFixed(4)})">${m}</g>`;
  return `<span class="tile ${esc(kind)} ostile" data-os="${os}" title="${{linux:'Linux', windows:'Windows', macos:'macOS'}[os]}"><svg viewBox="0 0 40 40" aria-hidden="true">`
    + `<g class="kind-icon" transform="translate(${x} ${20 - s / 2}) scale(${(s / 24).toFixed(4)})" fill="none" stroke="currentColor" stroke-width="${big ? 2 : 2.3}" stroke-linecap="round" stroke-linejoin="round">${IC[kind] || IC.terminal}</g>`
    + `<rect class="os-strip" x="${40 - w}" width="${w}" height="40" fill="var(--os-${os})"/>`
    + `<g class="os-glyph">${at(osGlyph(os, !big), 40 - w / 2, 20.2, gs)}</g></svg></span>`;
}
// a Settings card's machine: its chosen OS, or this computer's own
function cardOS(m){ return m.kind === 'local' ? machineOS(nodes[m.id] || Object.values(nodes).find(n => n.kind === 'machine' && n.agent === 'local')) : osKey(m.os || 'linux'); }
function machineOS(n){ return n && n.kind === 'machine' ? osKey(n.os) : ''; }

// Choose machines…: tick which machines Fleet connects to when it starts, VMs indented under their hosts (#216)
function openChooseMachines(){
  if ($('choosem')) return;
  const c = (DATA && DATA.connect) || {auto:'none', presets:{}}, inSet = c.presets && c.presets[c.auto];
  const ticked = id => c.auto === 'all' ? true : c.auto === 'none' ? false : !!(inSet && inSet.includes(id));
  const rows = [];
  (function walk(list, d){ list.forEach(n => {
    if (n.kind !== 'machine') return;
    if (switchable(n)) rows.push({n, d});
    const vg = n.children.find(x => x.kind === 'group' && x.type === 'vm');
    if (vg) walk(vg.children, switchable(n) ? d + 1 : d);
  }); })(roots, 0);
  const name = c.auto !== 'all' && c.auto !== 'none' ? c.auto : 'My machines';
  const el = document.createElement('div'); el.id = 'choosem-bg'; el.className = 'sheet-bg';
  el.innerHTML = `<div class="sheet choosem" id="choosem" role="dialog" aria-modal="true" aria-labelledby="choosem-t">
    <div class="sheet-h"><h2 id="choosem-t">Connect when Fleet starts</h2><button type="button" class="iconbtn" data-chmclose="1" aria-label="Close">${icon('x', 2.2)}</button></div>
    <div class="sheet-b"><p class="sub">Tick the machines Fleet connects to when it starts. VMs are listed under the machine they run on. This computer is always read: it needs no SSH.</p>
      <div class="chm-tools"><button type="button" class="linkbtn" data-chmall="1">Tick all</button><button type="button" class="linkbtn" data-chmall="0">Untick all</button></div>
      <div class="chm-list">${rows.map(({n, d}) => `<label class="chm" data-depth="${d}" style="--d:${d}"><input type="checkbox" data-chm="${esc(n.id)}"${ticked(n.id) ? ' checked' : ''}>${tileHTML(n.tile, machineOS(n), false)}<span class="chm-n">${esc(n.name)}</span><span class="chm-s">${esc(n.ssh || '')}</span></label>`).join('') || '<p class="sub">No machines over SSH yet.</p>'}</div>
      <label class="chm-name">Save as<input name="setname" maxlength="60" value="${esc(name)}" autocomplete="off"></label></div>
    <div class="sheet-f"><button type="button" class="btn" data-chmclose="1">Cancel</button><button type="button" class="btn primary" data-chmsave="1">Save and use at start</button></div></div>`;
  document.body.appendChild(el);
  const close = () => { el.remove(); const b = document.querySelector('[data-autoconn]'); if (b) b.focus(); };
  el.addEventListener('keydown', e => { if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(); } });
  el.addEventListener('click', async e => {
    if (e.target === el || e.target.closest('[data-chmclose]')){ close(); return; }
    const all = e.target.closest('[data-chmall]'); if (all){ el.querySelectorAll('[data-chm]').forEach(i => { i.checked = all.dataset.chmall === '1'; }); return; }
    if (e.target.closest('[data-chmsave]')){
      const v = el.querySelector('[name=setname]').value.trim();
      if (!v || /^(all|none)$/i.test(v)){ toast('Give the set a name other than All or None'); el.querySelector('[name=setname]').focus(); return; }
      await connApi({save:v, machines:[...el.querySelectorAll('[data-chm]')].filter(i => i.checked).map(i => i.dataset.chm)});
      close();
    }
  });
  const first = el.querySelector('[data-chm]'); if (first) first.focus();
}

// A process in Docker Desktop's Linux VM (#217): what Fleet knows of it from docker top. Looking inside the VM (what it
// waits on, cache misses, files, sockets) would take a helper container or a command run in its container.
function vmInspectPanel(p){
  p = p || PROCS.list.find(x => x[0] === INSP.pid);
  const close = `<button type="button" class="iconbtn" data-inspclose="1" aria-label="Close" title="Close (Esc)">${icon('x', 2.2)}</button>`;
  if (!p) return `<div class="insp"><div class="insp-h"><div><b>${esc(INSP.name || 'This process')}</b></div>${close}</div>${noteHTML('<b>It has exited.</b>', 'warn')}</div>`;
  const node = nodes[p[10]], STATE = {R:'running', S:'sleeping', D:'waiting on I/O', Z:'zombie', T:'stopped', t:'stopped', I:'idle'};
  const head = `<div class="insp-h"><div><b>${esc(p[1])}</b> <span class="mono">PID ${pidNum(p[0])} in Docker’s VM</span><div class="insp-cmd mono">${esc(p[9])}</div></div>${close}</div>`;
  const rows = [['Runs in', node ? esc(node.name) : '—'], ['User', esc(p[2])], ['State', esc(STATE[String(p[3])[0]] || p[3])], ['CPU now', fmt(p[4], 'cpu')],
    ['Memory', fmt(p[5], 'mem')], ['Threads', String(p[8])], ['Parent PID', String(pidNum(p[11]))]];
  return `<div class="insp">${head}<dl class="dl">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`
    + noteHTML('<b>Read with docker top, from outside Docker Desktop’s Linux VM,</b> which macOS can’t see into. What it waits on, its cache misses, files and sockets need a look from inside that VM. Choose how:')
    + `<div class="vmlook"><div><button type="button" class="btn primary" data-vmlook="helper">${icon('search')}Look with a helper container</button>`
    + `<span class="sub">A throwaway <code>docker run --rm</code> that can see the VM’s processes (no network), running Fleet’s inspector. Uses the <code>${'python:3.12-slim'}</code> image, pulled once if it isn’t there.</span></div>`
    + `<div><button type="button" class="btn" data-vmlook="exec">${icon('terminal')}Run it inside ${node ? esc(node.name) : 'its container'}</button>`
    + `<span class="sub"><code>docker exec</code> runs the same inspector in the process’s own container. It needs python3 there.</span></div>`
    + (node && termOk(node) ? `<div>${termBtn(node)}</div>` : '') + `</div></div>`;
}

// Open terminal in a specific terminal (#223): the ones installed here, the default ticked (the list comes from /api/config)
const TERMS = {list:null, def:'', busy:null};
function loadTerms(){
  if (TERMS.list) return Promise.resolve(TERMS);
  return TERMS.busy || (TERMS.busy = fetch('/api/config', {cache:'no-store'}).then(r => r.json()).then(c => {
    TERMS.list = c.terminals || [];
    TERMS.def = c.terminal && c.terminal !== 'auto' ? c.terminal : ((TERMS.list.find(([, l]) => l === c.terminal_auto) || [])[0] || '');
    return TERMS;
  }).catch(() => { TERMS.busy = null; return TERMS; }));
}
function termMenu(id){
  const n = nodes[id], list = TERMS.list || [];
  if (!TERMS.list) loadTerms();
  return {title:'Open in', items:[...list.map(([k, l]) => ({label:(k === TERMS.def ? '✓ ' : '') + l, run:() => openTerminal(id, k)})),
    ...(list.length ? [] : [{label:n && n.kind !== 'machine' ? 'Open shell' : 'Open terminal', run:() => openTerminal(id)}]),
    '—', {label:'Change the default…', run:() => openSettings()}]};
}
