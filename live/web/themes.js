// SPDX-License-Identifier: GPL-3.0-or-later
// Fleet's themes: the built-in list, the CSS tokens a theme sets, and reading an imported theme file
// (a VS Code colour theme, or a Fleet theme). A theme names a few colours; every other token is
// derived from them the same way for every theme (themeTokens), so a theme can be as short as
// {chrome, ink, accent}. Loaded before app.js; also loaded by the tests with node:vm.
'use strict';

// Chart colours (t-*) of every theme but Fleet's own were checked with the dataviz palette validator
// (lightness band, chroma floor, colour-blind and normal-vision separation of the stacked series).
// Every token a theme sets (each is a CSS custom property, --<name>, on <html>).
const THEME_KEYS = ['chrome', 'chrome-2', 'chrome-hover', 'chrome-act', 'win', 'side', 'card', 'card-2', 'pop', 'panel', 'press', 'edge',
  'hover', 'sel', 'line', 'line-2', 'track', 'ink', 'ink-2', 'ink-3', 'accent', 'accent-bg', 'on-accent', 'run', 'warn', 'stale',
  't-base', 't-compose', 't-container', 't-vm', 'rd', 'wr', 'g-fleet', 'g-flotilla', 'g-division', 'g-section', 'g-squadron', 'g-taskforce'];
// The six kinds of tree group (fleet, flotilla, division, section, squadron, task force), one colour each.
const GROUP_KEYS = ['g-fleet', 'g-flotilla', 'g-division', 'g-section', 'g-squadron', 'g-taskforce'];
// The four kinds of workload, in the order they stack in every bar.
const SERIES_KEYS = ['t-base', 't-compose', 't-container', 't-vm'];

const TH = (id, name, dark, c) => ({id, name, dark, c});
const FLEET_THEMES = [
  // Fleet's own colours, token for token (nothing is derived for it).
  TH('fleet', 'Fleet', true, {chrome:'#141416', 'chrome-2':'#1e1e21', 'chrome-hover':'#252529', 'chrome-act':'#2b2b30', win:'#1d1d20', side:'#222226',
    card:'#29292e', 'card-2':'#313137', pop:'#18181b', panel:'#1a1a1d', press:'#3a3a41', edge:'#000000', hover:'#ffffff0d', sel:'#3584e430',
    line:'#ffffff14', 'line-2':'#ffffff24', track:'#ffffff10', ink:'#f3f3f5', 'ink-2':'#c6c6cd', 'ink-3':'#9e9ea7', accent:'#78aeed',
    'accent-bg':'#3584e4', 'on-accent':'#ffffff', run:'#33d17a', warn:'#ffa66b', stale:'#f6d32d',
    't-base':'#8a8984', 't-compose':'#3987e5', 't-container':'#199e70', 't-vm':'#d95926', rd:'#8fc1ff', wr:'#ffab7a',
    'g-fleet':'#923c8d', 'g-flotilla':'#d95926', 'g-division':'#199e70', 'g-section':'#e185d9', 'g-squadron':'#3987e5', 'g-taskforce':'#c9a913'}),
  TH('monokai-dimmed', 'Monokai Dimmed', true, {chrome:'#1a1a1a', win:'#1e1e1e', side:'#272727', card:'#2d2d2d', 'card-2':'#353535', press:'#454545',
    ink:'#c5c8c6', 'ink-3':'#9a9b99', accent:'#7ba2cf', 'accent-bg':'#3655b5', run:'#9aa83a', warn:'#d7873f', stale:'#d0b344',
    't-base':'#b96a83', 't-compose':'#6597d3', 't-container':'#82900a', 't-vm':'#9752e2'}),
  TH('dracula', 'Dracula', true, {chrome:'#191a21', win:'#21222c', side:'#282a36', card:'#343746', 'card-2':'#3c3f51', press:'#44475a',
    ink:'#f8f8f2', accent:'#bd93f9', 'accent-bg':'#bd93f9', run:'#50fa7b', warn:'#ffb86c', stale:'#f1fa8c',
    't-base':'#8c711a', 't-compose':'#00a4c5', 't-container':'#21b04f', 't-vm':'#ab5987'}),
  TH('one-dark-pro', 'One Dark Pro', true, {chrome:'#21252b', win:'#282c34', side:'#2c313a', card:'#333842', 'card-2':'#3a3f4b', press:'#4b5263',
    ink:'#abb2bf', accent:'#61afef', 'accent-bg':'#4d78cc', run:'#98c379', warn:'#d19a66', stale:'#e5c07b',
    't-base':'#b8666d', 't-compose':'#3594fe', 't-container':'#6aa834', 't-vm':'#c34bc8'}),
  TH('nord', 'Nord', true, {chrome:'#2a2f3a', win:'#2e3440', card:'#3b4252', 'card-2':'#434c5e', press:'#4c566a',
    ink:'#e5e9f0', 'ink-2':'#d8dee9', accent:'#88c0d0', 'accent-bg':'#5e81ac', run:'#a3be8c', warn:'#d08770', stale:'#ebcb8b',
    't-base':'#b8739f', 't-compose':'#4b8fdc', 't-container':'#3a9e6a', 't-vm':'#c47f12'}),
  TH('solarized-dark', 'Solarized Dark', true, {chrome:'#00212b', win:'#002b36', side:'#00303c', card:'#073642', 'card-2':'#0b3f4c', press:'#16505e',
    ink:'#a3b1b1', 'ink-2':'#93a1a1', 'ink-3':'#839496', accent:'#3a9be0', 'accent-bg':'#268bd2', run:'#859900', warn:'#cb4b16', stale:'#b58900',
    't-base':'#a75f3d', 't-compose':'#278dd4', 't-container':'#879a22', 't-vm':'#e03b8a'}),
  TH('solarized-light', 'Solarized Light', false, {chrome:'#eee8d5', win:'#fdf6e3', side:'#f5efdc', card:'#fffbee', press:'#e4dcc4',
    ink:'#586e75', 'ink-2':'#5f747b', 'ink-3':'#657b83', accent:'#1f77b4', 'accent-bg':'#268bd2', run:'#6c7d00', warn:'#cb4b16', stale:'#9a7500',
    't-base':'#884d10', 't-compose':'#258bd2', 't-container':'#798b01', 't-vm':'#d32d80'}),
  TH('gruvbox-dark', 'Gruvbox Dark', true, {chrome:'#1d2021', win:'#282828', side:'#32302f', card:'#3c3836', 'card-2':'#45403d', press:'#504945',
    ink:'#ebdbb2', 'ink-2':'#d5c4a1', 'ink-3':'#bdae93', accent:'#83a598', 'accent-bg':'#458588', run:'#b8bb26', warn:'#fe8019', stale:'#fabd2f',
    't-base':'#b36b95', 't-compose':'#27a1cd', 't-container':'#3c9d55', 't-vm':'#e4630b'}),
  TH('gruvbox-light', 'Gruvbox Light', false, {chrome:'#ebdbb2', win:'#fbf1c7', side:'#f2e5bc', card:'#f9f5d7', press:'#d5c4a1',
    ink:'#3c3836', 'ink-2':'#504945', 'ink-3':'#665c54', accent:'#076678', 'accent-bg':'#076678', run:'#79740e', warn:'#af3a03', stale:'#b57614',
    't-base':'#ae7f38', 't-compose':'#07749c', 't-container':'#595f00', 't-vm':'#b73c5e'}),
  TH('tokyo-night', 'Tokyo Night', true, {chrome:'#16161e', win:'#1a1b26', side:'#1e2030', card:'#24283b', 'card-2':'#292e42', press:'#3b4261',
    ink:'#c0caf5', 'ink-2':'#a9b1d6', accent:'#7aa2f7', 'accent-bg':'#3d59a1', run:'#9ece6a', warn:'#ff9e64', stale:'#e0af68',
    't-base':'#a45e87', 't-compose':'#5e87df', 't-container':'#61a169', 't-vm':'#e86900'}),
  TH('catppuccin-mocha', 'Catppuccin Mocha', true, {chrome:'#11111b', win:'#181825', side:'#1e1e2e', card:'#262637', 'card-2':'#313244', press:'#45475a',
    ink:'#cdd6f4', 'ink-2':'#bac2de', 'ink-3':'#a6adc8', accent:'#cba6f7', 'accent-bg':'#cba6f7', run:'#a6e3a1', warn:'#fab387', stale:'#f9e2af',
    't-base':'#ad5f8d', 't-compose':'#6794dd', 't-container':'#60a672', 't-vm':'#e96716'}),
  TH('catppuccin-latte', 'Catppuccin Latte', false, {chrome:'#dce0e8', win:'#eff1f5', side:'#e6e9ef', card:'#f7f8fa', press:'#ccd0da',
    ink:'#4c4f69', 'ink-2':'#5c5f77', 'ink-3':'#6c6f85', accent:'#8839ef', 'accent-bg':'#8839ef', run:'#40a02b', warn:'#fe640b', stale:'#df8e1d',
    't-base':'#aa7ebe', 't-compose':'#2567eb', 't-container':'#40a22a', 't-vm':'#a03f0f'}),
  TH('night-owl', 'Night Owl', true, {chrome:'#010e1a', win:'#011627', side:'#01111d', card:'#0b2942', 'card-2':'#13344f', press:'#1d3b53',
    ink:'#d6deeb', 'ink-3':'#93a7bb', accent:'#82aaff', 'accent-bg':'#7e57c2', run:'#addb67', warn:'#f78c6c', stale:'#ffcb8b',
    't-base':'#36a996', 't-compose':'#6791e9', 't-container':'#727603', 't-vm':'#d2785d'}),
  TH('material-palenight', 'Material Palenight', true, {chrome:'#202331', win:'#292d3e', side:'#2b2f42', card:'#34324a', 'card-2':'#3a3f58', press:'#444267',
    ink:'#c3c8e4', 'ink-2':'#a6accd', accent:'#82aaff', 'accent-bg':'#717cb4', run:'#c3e88d', warn:'#f78c6c', stale:'#ffcb6b',
    't-base':'#ab64a5', 't-compose':'#618ff5', 't-container':'#4a8c16', 't-vm':'#fa4b58'}),
  TH('github-dark', 'GitHub Dark', true, {chrome:'#010409', win:'#0d1117', side:'#10151c', card:'#161b22', 'card-2':'#1c2128', press:'#30363d',
    ink:'#e6edf3', 'ink-2':'#c9d1d9', 'ink-3':'#8d96a0', accent:'#4493f8', 'accent-bg':'#1f6feb', run:'#3fb950', warn:'#db6d28', stale:'#d29922',
    't-base':'#2aa18f', 't-compose':'#2e7ff2', 't-container':'#4a6c27', 't-vm':'#b7810e'}),
  TH('github-light', 'GitHub Light', false, {chrome:'#eaeef2', win:'#f6f8fa', side:'#f0f3f6', card:'#ffffff', 'card-2':'#f6f8fa', press:'#d0d7de',
    ink:'#1f2328', 'ink-2':'#424a53', 'ink-3':'#59636e', accent:'#0969da', 'accent-bg':'#0969da', run:'#1a7f37', warn:'#bc4c00', stale:'#9a6700',
    't-base':'#a188ce', 't-compose':'#186ad4', 't-container':'#1e815e', 't-vm':'#bb4b00'}),
  TH('ayu-mirage', 'Ayu Mirage', true, {chrome:'#1c212b', win:'#1f2430', side:'#232834', card:'#2a3040', 'card-2':'#313849', press:'#3d4455',
    ink:'#cccac2', 'ink-3':'#9aa1ab', accent:'#ffcc66', 'accent-bg':'#ffcc66', run:'#87d96c', warn:'#f29e74', stale:'#ffd173',
    't-base':'#a9628b', 't-compose':'#459fc9', 't-container':'#2fa363', 't-vm':'#e9671c'}),
  TH('monokai', 'Monokai', true, {chrome:'#1e1f1c', win:'#272822', side:'#2c2d27', card:'#34352f', 'card-2':'#3e3d32', press:'#49483e',
    ink:'#f8f8f2', accent:'#66d9ef', 'accent-bg':'#75715e', run:'#a6e22e', warn:'#fd971f', stale:'#e6db74',
    't-base':'#0f7c5a', 't-compose':'#4e93c7', 't-container':'#8c9e42', 't-vm':'#ba480b'}),
  TH('rose-pine', 'Rosé Pine', true, {chrome:'#191724', win:'#1f1d2e', side:'#211f31', card:'#26233a', 'card-2':'#2d2a42', press:'#403d52',
    ink:'#e0def4', 'ink-3':'#a29fbd', accent:'#c4a7e7', 'accent-bg':'#c4a7e7', run:'#9ccfd8', warn:'#eb6f92', stale:'#f6c177',
    't-base':'#307e46', 't-compose':'#3397bc', 't-container':'#bd8930', 't-vm':'#e95a87'}),
  TH('everforest-dark', 'Everforest Dark', true, {chrome:'#232a2e', win:'#2d353b', side:'#313b40', card:'#343f44', 'card-2':'#3d484d', press:'#4f585e',
    ink:'#d3c6aa', 'ink-3':'#a7b0a8', accent:'#7fbbb3', 'accent-bg':'#7fbbb3', run:'#a7c080', warn:'#e69875', stale:'#dbbc7f',
    't-base':'#7471b6', 't-compose':'#30a89c', 't-container':'#4b781c', 't-vm':'#ca7d5e'}),
  TH('kanagawa', 'Kanagawa', true, {chrome:'#16161d', win:'#1f1f28', side:'#22222c', card:'#2a2a37', 'card-2':'#363646', press:'#54546d',
    ink:'#dcd7ba', 'ink-2':'#c8c093', 'ink-3':'#a6a69c', accent:'#7e9cd8', 'accent-bg':'#2d4f67', run:'#98bb6c', warn:'#ffa066', stale:'#e6c384',
    't-base':'#934e8e', 't-compose':'#708ed0', 't-container':'#7fa159', 't-vm':'#b35713'}),
  TH('cobalt2', 'Cobalt2', true, {chrome:'#15232d', win:'#193549', side:'#1a3a50', card:'#1f4662', 'card-2':'#234e6d', press:'#2c5d80',
    ink:'#ffffff', 'ink-3':'#aac3d6', accent:'#ffc600', 'accent-bg':'#ffc600', run:'#3ad900', warn:'#ff9d00', stale:'#ffee80',
    't-base':'#b87cb2', 't-compose':'#1e97fc', 't-container':'#26a367', 't-vm':'#ea6526'})
];

/* ---------- colour arithmetic ---------- */
// '#rgb', '#rgba', '#rrggbb' or '#rrggbbaa' → [r, g, b, a] (0–255), anything else → null
function themeHex(c){
  if (typeof c !== 'string') return null;
  const m = c.trim().match(/^#([0-9a-f]{3,8})$/i); if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = h.split('').map(x => x + x).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  return [0, 2, 4, 6].map(i => i < h.length ? parseInt(h.slice(i, i + 2), 16) : 255);
}
function themeToHex(r, g, b, a){
  const v = [r, g, b].concat(a == null || a >= 255 ? [] : [a]);
  return '#' + v.map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
}
function themeMix(a, b, t){ const x = themeHex(a), y = themeHex(b); return themeToHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t); }
function themeAlpha(c, a){ const x = themeHex(c); return themeToHex(x[0], x[1], x[2], a * 255); }
// a colour with transparency, as it looks over a background
function themeFlat(c, over){ const x = themeHex(c), y = themeHex(over), a = x[3] / 255; return themeToHex(y[0] + (x[0] - y[0]) * a, y[1] + (x[1] - y[1]) * a, y[2] + (x[2] - y[2]) * a); }
function themeLum(c){ const x = themeHex(c).slice(0, 3).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2]; }
function themeContrast(a, b){ const x = themeLum(a), y = themeLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
// move c toward `to` in small steps until it reads at `min`:1 against `bg`
// OKLab (x100 distances are the dataviz validator's ΔE) and back, for picking distinct group colours
function themeOklab(c){
  const x = themeHex(c).slice(0, 3).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  const l = Math.cbrt(0.4122214708 * x[0] + 0.5363325363 * x[1] + 0.0514459929 * x[2]), m = Math.cbrt(0.2119034982 * x[0] + 0.6806995451 * x[1] + 0.1073969566 * x[2]),
    s = Math.cbrt(0.0883024619 * x[0] + 0.2817188376 * x[1] + 0.6299787005 * x[2]);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function themeFromOklch(L, C, h){
  for (let c = C; c >= 0; c -= 0.005){
    const a = c * Math.cos(h * Math.PI / 180), b = c * Math.sin(h * Math.PI / 180);
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3), m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3), s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
    const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
    if (rgb.every(v => v >= -0.0005 && v <= 1.0005)) return themeToHex(...rgb.map(v => { v = Math.min(1, Math.max(0, v)); return (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255; }));
  }
  return themeToHex(L * 255, L * 255, L * 255);
}
const themeDE = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100;
function themeEnsure(c, bg, min, to){ let x = c; for (let t = 0.1; themeContrast(x, bg) < min && t <= 1.0001; t += 0.1) x = themeMix(c, to, t); return x; }

/* ---------- a theme → its tokens ---------- */
const THEME_FALLBACK = FLEET_THEMES[0].c;
function themeTokens(th){
  const given = (th && th.c) || {}, c = {};
  // only well-formed colours get through, written back out as plain hex (they go into style attributes)
  for (const k of THEME_KEYS){ const x = themeHex(given[k]); if (x) c[k] = themeToHex(x[0], x[1], x[2], x[3]); }
  let dark = th && typeof th.dark === 'boolean' ? th.dark : null;
  if (!c.chrome) c.chrome = c.win ? (dark === false ? themeMix(c.win, '#000000', .06) : themeMix(c.win, '#000000', .2)) : THEME_FALLBACK.chrome;
  if (dark === null) dark = themeLum(themeFlat(c.chrome, '#000000')) < 0.4;
  // solid surfaces: no transparency on the layers everything else sits on
  for (const k of ['chrome', 'win', 'side', 'card']) if (c[k] && themeHex(c[k])[3] < 255) c[k] = themeFlat(c[k], k === 'chrome' ? (dark ? '#000000' : '#ffffff') : c.chrome);
  const bg = c.chrome;
  if (!c.ink) c.ink = dark ? '#f0f0f2' : '#1f2328';
  if (themeHex(c.ink)[3] < 255) c.ink = themeFlat(c.ink, bg);
  const ink = c.ink;
  const d = (k, v) => { if (!c[k]) c[k] = v; };
  if (dark){ d('win', themeMix(bg, ink, .04)); d('side', themeMix(bg, ink, .063)); d('card', themeMix(bg, ink, .094)); }
  else { d('win', themeMix(bg, '#ffffff', .55)); d('side', themeMix(bg, '#ffffff', .3)); d('card', themeMix(c.win, '#ffffff', .7)); }
  d('chrome-2', themeMix(bg, ink, .045));
  d('chrome-hover', themeMix(bg, ink, .076));
  d('chrome-act', dark ? themeMix(bg, ink, .103) : c.card);
  d('card-2', themeMix(c.card, ink, dark ? .04 : .045));
  d('pop', dark ? themeMix(bg, ink, .018) : c.card);
  d('panel', dark ? themeMix(bg, ink, .027) : c.win);
  d('press', themeMix(c.card, ink, dark ? .085 : .12));
  d('edge', dark ? themeMix(bg, '#000000', .6) : themeMix(bg, ink, .14));
  // text: always readable on the cards
  c.ink = themeEnsure(ink, c.card, 7, dark ? '#ffffff' : '#000000');
  d('ink-2', themeMix(c.ink, bg, .2));
  d('ink-3', themeMix(c.ink, bg, .38));
  c['ink-2'] = themeEnsure(c['ink-2'], c.card, 4.5, c.ink);
  c['ink-3'] = themeEnsure(c['ink-3'], c.card, 4.5, c.ink);
  d('accent', c['accent-bg'] || THEME_FALLBACK.accent);
  d('accent-bg', c.accent);
  c.accent = themeEnsure(c.accent, c.card, 3, c.ink);
  const darkest = themeLum(bg) < themeLum(c.ink) ? bg : c.ink;
  d('on-accent', themeContrast('#ffffff', c['accent-bg']) >= themeContrast(darkest, c['accent-bg']) ? '#ffffff' : darkest);
  d('hover', themeAlpha(c.ink, .05));
  d('sel', themeAlpha(c['accent-bg'], .19));
  d('line', themeAlpha(c.ink, .08));
  d('line-2', themeAlpha(c.ink, .14));
  d('track', themeAlpha(c.ink, .063));
  for (const k of ['run', 'warn', 'stale']) d(k, THEME_FALLBACK[k]);
  for (const k of ['run', 'warn', 'stale']) c[k] = themeEnsure(c[k], c.card, 3, c.ink);
  for (const k of SERIES_KEYS) d(k, THEME_FALLBACK[k]);
  // groups: a flotilla, division or squadron outline matches its members' icons (the VM, container and Compose
  // colours); fleet, section and task force get the three colours, at the theme's lightness and chroma, farthest
  // from the others and from each other, and still visible on the cards
  d('g-flotilla', c['t-vm']); d('g-division', c['t-container']); d('g-squadron', c['t-compose']);
  const picked = ['g-flotilla', 'g-division', 'g-squadron'].map(k => themeOklab(c[k]));
  const L0 = picked.reduce((a, p) => a + p[0], 0) / 3, C0 = Math.max(0.11, picked.reduce((a, p) => a + Math.hypot(p[1], p[2]), 0) / 3);
  for (const k of ['g-fleet', 'g-section', 'g-taskforce']){
    if (!c[k]){
      let best = null, bd = -1;
      for (const dl of [-0.12, -0.06, 0, 0.06, 0.12]) for (let h = 0; h < 360; h += 5){
        const hex = themeFromOklch(Math.min(0.88, Math.max(0.35, L0 + dl)), C0, h);
        if (themeContrast(hex, c.card) < 2.2) continue;
        const lab = themeOklab(hex), dmin = Math.min(...picked.map(q => themeDE(lab, q)));
        if (dmin > bd){ bd = dmin; best = hex; }
      }
      c[k] = best || THEME_FALLBACK[k];
    }
    picked.push(themeOklab(c[k]));
  }
  // the ↓/↑ labels next to the read/write (in/out) lines: their line's hue, lifted toward the text
  d('rd', themeEnsure(themeMix(c['t-compose'], c.ink, .4), c.card, 4.5, c.ink));
  d('wr', themeEnsure(themeMix(c['t-vm'], c.ink, .4), c.card, 4.5, c.ink));
  const vars = {};
  for (const k of THEME_KEYS) vars[k] = c[k];
  return {dark, vars};
}

/* ---------- reading a theme file ---------- */
// JSON with comments and trailing commas (what VS Code writes), as plain JSON
function themeStripJsonc(s){
  let out = '', i = 0;
  const n = s.length;
  while (i < n){
    const ch = s[i];
    if (ch === '"'){
      let j = i + 1;
      while (j < n && s[j] !== '"'){ if (s[j] === '\\') j++; j++; }
      out += s.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === '/' && s[i + 1] === '/'){ while (i < n && s[i] !== '\n') i++; continue; }
    if (ch === '/' && s[i + 1] === '*'){ const e = s.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (ch === ','){
      let j = i + 1;
      for (;;){
        while (j < n && /\s/.test(s[j])) j++;
        if (s[j] === '/' && s[j + 1] === '/'){ while (j < n && s[j] !== '\n') j++; continue; }
        if (s[j] === '/' && s[j + 1] === '*'){ const e = s.indexOf('*/', j + 2); j = e < 0 ? n : e + 2; continue; }
        break;
      }
      if (s[j] === '}' || s[j] === ']'){ i++; continue; }
    }
    out += ch; i++;
  }
  return out;
}
function themeSlug(s){ return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }

// A VS Code colour theme, or a Fleet theme ({"name", "type", "colors": {chrome, ink, accent, …}}),
// → a theme Fleet can use: {id, name, dark, c}. Throws an Error that says, in a few words, why not.
function readThemeFile(text, fileName){
  let j;
  try { j = JSON.parse(themeStripJsonc(String(text).replace(/^﻿/, ''))); }
  catch (e) { throw new Error('it isn’t a JSON file'); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('it isn’t a theme');
  const cols = j.colors && typeof j.colors === 'object' && !Array.isArray(j.colors) ? j.colors : {};
  const fromFile = String(fileName || '').replace(/\.[^.]+$/, '').replace(/[-_ ]?colou?r[-_ ]?theme$/i, '').replace(/[-_]+/g, ' ').trim();
  const name = String(j.name || j.displayName || j.label || fromFile || 'Imported theme').slice(0, 60);
  const type = String(j.type || j.uiTheme || '').toLowerCase();
  const dark = /light|^vs$/.test(type) ? false : /dark|black|^vs-dark$|^hc/.test(type) ? true : null;
  const keys = Object.keys(cols);
  const c = {};
  if (keys.some(k => THEME_KEYS.includes(k)) && !keys.some(k => k.includes('.'))){
    // Fleet's own format: tokens by name
    for (const k of THEME_KEYS) if (themeHex(cols[k])) c[k] = cols[k];
    if (!c.chrome && !c.win) throw new Error('it has no background colour (chrome or win)');
  } else {
    const g = (...ks) => { for (const k of ks) if (themeHex(cols[k])) return cols[k]; return null; };
    const scopes = [];
    for (const t of Array.isArray(j.tokenColors) ? j.tokenColors : []){
      if (!t || !t.settings || !themeHex(t.settings.foreground)) continue;
      const sc = Array.isArray(t.scope) ? t.scope : String(t.scope || '').split(',');
      for (const s of sc) scopes.push([String(s).trim(), t.settings.foreground]);
    }
    const tok = (...want) => { for (const w of want){ const hit = scopes.find(([s]) => s === w || s.startsWith(w + '.')); if (hit) return hit[1]; } return null; };
    const win = g('editor.background');
    if (!win && !g('sideBar.background', 'activityBar.background')) throw new Error('it has no editor colours (it may only point at another theme file)');
    const isDark = dark !== null ? dark : themeLum(themeFlat(win || g('sideBar.background', 'activityBar.background'), '#000000')) < 0.4;
    if (win) c.win = win;
    // the frame: the darkest of the title bar, activity bar, side bar and tab strip (lightest, in a light theme)
    const frames = ['titleBar.activeBackground', 'activityBar.background', 'sideBar.background', 'editorGroupHeader.tabsBackground']
      .map(k => cols[k]).filter(themeHex).map(x => themeFlat(x, win || (isDark ? '#000000' : '#ffffff')));
    if (frames.length){
      const pick = frames.reduce((a, b) => (themeLum(a) <= themeLum(b)) ? a : b);
      if (!win || (isDark ? themeLum(pick) <= themeLum(themeFlat(win, '#000000')) : true)) c.chrome = pick;
    }
    const side = g('sideBar.background'); if (side && win && side !== win) c.side = side;
    const widget = g('editorWidget.background', 'editorHoverWidget.background', 'dropdown.background');
    if (widget && win && (isDark ? themeLum(themeFlat(widget, win)) > themeLum(themeFlat(win, '#000000')) : true)) c.card = themeFlat(widget, win);
    const ink = g('editor.foreground', 'foreground'); if (ink) c.ink = ink;
    const ink3 = g('descriptionForeground'); if (ink3) c['ink-3'] = ink3;
    const accent = g('textLink.foreground', 'focusBorder', 'button.background') || tok('keyword', 'storage'); if (accent) c.accent = accent;
    const abg = g('button.background', 'focusBorder', 'textLink.foreground'); if (abg) c['accent-bg'] = abg;
    const onA = g('button.foreground'); if (onA && abg) c['on-accent'] = onA;
    const green = g('terminal.ansiGreen', 'gitDecoration.addedResourceForeground') || tok('string');
    const yellow = g('terminal.ansiYellow', 'editorWarning.foreground');
    if (green) c.run = green;
    const warn = g('editorWarning.foreground', 'terminal.ansiYellow'); if (warn) c.warn = warn;
    if (yellow) c.stale = yellow;
    const series = [tok('comment') || g('terminal.ansiBrightBlack'), g('terminal.ansiBlue') || tok('entity.name.function', 'support.function'),
      green, tok('constant.numeric', 'constant') || g('terminal.ansiMagenta', 'terminal.ansiRed')];
    const seen = new Set();
    series.forEach((v, i) => { if (v && !seen.has(String(v).toLowerCase())){ seen.add(String(v).toLowerCase()); c[SERIES_KEYS[i]] = v; } });
    // colours with transparency, as they look on the editor
    for (const k of Object.keys(c)) if (themeHex(c[k])[3] < 255 && !['hover', 'sel', 'line', 'line-2', 'track'].includes(k)) c[k] = themeFlat(c[k], win || c.chrome || '#000000');
  }
  const t = {id: 'custom-' + (themeSlug(name) || 'theme'), name, c: {}};
  const tk = themeTokens({dark: dark === null ? undefined : dark, c});
  t.dark = tk.dark;
  for (const k of Object.keys(c)){ const x = themeHex(c[k]); if (x) t.c[k] = themeToHex(x[0], x[1], x[2], x[3]); }
  return t;
}
