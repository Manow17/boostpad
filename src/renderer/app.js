/* Boostpad renderer. No framework: a small element helper, a few custom controls,
   and one function per page that returns a bento grid of tiles. */
const api = (method, ...args) => window.boostpad.call(method, ...args);

let S = null;          // latest snapshot from the main process
let catalog = null;    // item catalog, loaded on first use
const ui = { tab: location.hash.slice(1) || 'garage', cat: 'cars', q: '', slot: 'src', src: null, dst: null, check: null, only: true, packType: 'all' };
const player = new Audio();
let track = -1;

const PAGES = {
  garage: ['Garage', 'Give an item you own the look of another. Only you see it.'],
  packs: ['Mod Packs', 'Balls, decals, boost meters, wheels, lobby, loading screens, music and sounds.'],
  maps: ['Workshop Maps', 'Training and challenge maps, on Steam or Epic.'],
  presets: ['Presets', 'Save your whole setup and switch in one click.'],
  active: ['Active', 'Everything Boostpad has changed in your game.'],
  tracker: ['MMR Tracker', 'Follow your rating through a session.'],
  overlay: ['Overlay', 'An always-on-top window over the game.'],
  music: ['Music', 'Your own playlist, built in.'],
  profile: ['Profile', 'Your Boostpad card.'],
  settings: ['Settings', ''],
};
const NAV = [
  [['garage', 'cars'], ['packs', 'packs'], ['maps', 'maps']],
  [['presets', 'presets'], ['active', 'active']],
  [['tracker', 'tracker'], ['overlay', 'overlay'], ['music', 'anthems']],
  [['profile', 'profile'], ['settings', 'settings']],
];
const PACK_TYPES = [['all', 'All'], ['ball', 'Ball'], ['decal', 'Decals'], ['boostmeter', 'Boost meter'], ['wheels', 'Wheels'], ['menu', 'Lobby'], ['loading', 'Loading screen'], ['music', 'Menu music'], ['sound', 'Sounds'], ['other', 'Other']];
const PLAYLISTS = ['Duel 1v1', 'Doubles 2v2', 'Standard 3v3', 'Hoops', 'Rumble', 'Dropshot', 'Snow Day', 'Tournament'];
const RANKS = ['', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Champion', 'Grand Champion', 'Supersonic Legend'];
const COLORS = ['#2dd4bf', '#38bdf8', '#818cf8', '#c084fc', '#f472b6', '#fb7185', '#fb923c', '#facc15', '#a3e635'];

// Line icons on a 24px grid (drawn for this project).
const IC = {
  cars: 'M3 13l2-5a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 5v4h-2a2 2 0 0 1-4 0H9a2 2 0 0 1-4 0H3z M5 13h14',
  wheels: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z M12 3v6 M12 15v6 M3 12h6 M15 12h6',
  boosts: 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4c0 2 1 3 2 3c0-3-1-5 1-9z',
  decals: 'M4 20l6-2l10-10a2.1 2.1 0 0 0-3-3L7 15z M14 7l3 3',
  toppers: 'M7 16v-4a5 5 0 0 1 10 0v4 M3 16c0 1.7 4 3 9 3s9-1.3 9-3s-4-1-9-1s-9-.7-9 1z',
  antennas: 'M6 21V4 M6 5h11l-2 3.5L17 12H6',
  engines: 'M4 10v4h3l5 4V6L7 10z M16 9a4 4 0 0 1 0 6 M18.5 6.5a8 8 0 0 1 0 11',
  trails: 'M3 8h10 M3 12h14 M3 16h8 M17 8l4 4l-4 4',
  explosions: 'M12 3l2 5l5-2l-2 5l5 2l-5 2l2 5l-5-2l-2 5l-2-5l-5 2l2-5l-5-2l5-2l-2-5l5 2z',
  finishes: 'M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z',
  banners: 'M3 7h18v10H3z M7 11h7 M7 14h4',
  borders: 'M4 4h16v16H4z M8 8h8v8H8z',
  anthems: 'M9 18V6l10-2v12 M9 18a3 3 0 1 1-6 0a3 3 0 0 1 6 0z M19 16a3 3 0 1 1-6 0a3 3 0 0 1 6 0z',
  packs: 'M3 8l9-5l9 5v8l-9 5l-9-5z M3 8l9 5l9-5 M12 13v8',
  maps: 'M9 4L3 6v14l6-2l6 2l6-2V4l-6 2z M9 4v14 M15 6v14',
  presets: 'M12 3l9 5l-9 5l-9-5z M3 12.5l9 5l9-5 M3 17l9 5l9-5',
  active: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M8 12l3 3l5-6',
  tracker: 'M4 19V5 M4 19h16 M7 15l4-4l3 3l5-6',
  overlay: 'M7 8h10a5 5 0 0 1 5 5v2a3 3 0 0 1-5.5 1.5L15 15H9l-1.5 1.5A3 3 0 0 1 2 15v-2a5 5 0 0 1 5-5z M7 11v3 M5.5 12.5h3 M16 12h.01 M18 14h.01',
  profile: 'M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8z M4 20a8 8 0 0 1 16 0',
  settings: 'M4 7h10 M18 7h2 M14 5v4 M4 17h4 M12 17h8 M8 15v4',
  ball: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M12 8l4 3l-1.5 4.5h-5L8 11z M12 3v5 M20.5 10L16 11 M17 19l-2.5-3.5 M7 19l2.5-3.5 M3.5 10L8 11',
  gauge: 'M4 16a8 8 0 1 1 16 0 M12 16l4-5 M12 16h.01',
  image: 'M4 5h16v14H4z M4 15l4-4l4 4l3-3l5 5 M15 9h.01',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14z M20 20l-4-4',
  down: 'M12 5v14 M6 13l6 6l6-6',
  chevron: 'M6 9l6 6l6-6',
  check: 'M5 12l5 5l9-10',
  warn: 'M12 4l9 16H3z M12 10v4 M12 17h.01',
  info: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M12 11v5 M12 8h.01',
  plus: 'M12 5v14 M5 12h14',
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.500 10.500z',
  play: 'M8 5l11 7l-11 7z',
};
const FILLED = new Set(['play']);
// which icon stands for a pack type / operation category
const GLYPH = { decal: 'decals', boostmeter: 'gauge', menu: 'maps', loading: 'image', music: 'anthems', sound: 'engines', other: 'packs', map: 'maps' };
const glyphFor = (key) => (IC[key] ? key : GLYPH[key] || 'packs');

/* ---------- element helpers ---------- */

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'disabled'].includes(k)) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(3)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function icon(name, size = 18) {
  const svg = svgEl('svg', { viewBox: '0 0 24 24', width: size, height: size, class: 'ic' });
  const path = svgEl('path', { d: IC[name] || IC.packs });
  if (FILLED.has(name)) { path.setAttribute('fill', 'currentColor'); path.setAttribute('stroke', 'none'); }
  svg.append(path);
  return svg;
}

// The app mark. Same shapes as assets/icon.svg, coloured by the theme.
function mark(size) {
  const svg = svgEl('svg', { viewBox: '0 0 256 256', width: size, height: size, class: 'mark' });
  svg.append(svgEl('rect', { x: 14, y: 14, width: 228, height: 228, rx: 64 }), svgEl('path', { d: 'M138.500 44L72 142h46l-9 70l75-106h-48z' }));
  return svg;
}

const bento = (...kids) => h('div', { class: 'bento' }, kids);
const tile = (cls, ...kids) => h('section', { class: `tile ${cls}` }, kids);
const head = (label, ...actions) => h('div', { class: 'head' }, h('h3', {}, label), actions);
const noteTile = (kind, cls, ...content) => h('section', { class: `tile note ${kind === 'warn' ? 'warn' : ''} ${cls}` }, icon(kind === 'warn' ? 'warn' : 'info', 20), h('div', { class: 'grow' }, content));
const empty = (glyph, heading, text, ...actions) => h('div', { class: 'empty' }, h('span', { class: 'art lg' }, icon(glyph, 30)), h('b', {}, heading), h('p', {}, text), actions);
const btnIcon = (cls, name, label, onclick, extra = {}) => h('button', { class: `btn ${cls}`, onclick, ...extra }, icon(name, 16), label);
const field = (props) => h('input', { type: 'text', spellcheck: 'false', ...props, class: `field ${props.class || ''}` });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const go = (tab) => () => { ui.tab = tab; location.hash = tab; render(); };

// A soft-tinted icon square. The hue comes from the name, so items stay recognisable.
function art(name, glyph, cls = '') {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return h('span', { class: `art ${cls}`, style: `--h:${hash % 360}` }, icon(glyphFor(glyph), cls.includes('lg') ? 30 : 20));
}

/* ---------- custom controls ---------- */

const toggle = (checked, onchange) => h('input', { type: 'checkbox', role: 'switch', class: 'switch', checked, onchange: (e) => onchange(e.target.checked) });

function slider(min, max, value, onchange, oninput) {
  const el = h('input', { type: 'range', class: 'slider grow', min, max, value });
  const paint = () => el.style.setProperty('--p', `${((el.value - min) / (max - min)) * 100}%`);
  paint();
  el.addEventListener('input', () => { paint(); if (oninput) oninput(Number(el.value)); });
  el.addEventListener('change', () => onchange(Number(el.value)));
  return el;
}

const seg = (options, value, onchange) => h('div', { class: 'seg', role: 'radiogroup' }, options.map(([v, label]) =>
  h('button', { class: v === value ? 'on' : '', role: 'radio', 'aria-checked': String(v === value), onclick: () => v !== value && onchange(v) }, label)));

// Dropdown that replaces <select>. options: [[value, label], ...]
let menuOpen = null;
function closeMenu() {
  if (!menuOpen) return;
  menuOpen.menu.remove();
  menuOpen.btn.classList.remove('open');
  menuOpen.btn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', menuOpen.outside, true);
  menuOpen = null;
}
function select(options, value, onchange, width) {
  const current = options.find(([v]) => v === value) || options[0];
  const btn = h('button', { class: 'select', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', style: width && `width:${width}px` },
    h('span', { class: 'grow clip' }, current[1]), icon('chevron', 16));
  const open = () => {
    closeMenu();
    let active = Math.max(0, options.findIndex(([v]) => v === value));
    const choose = (v) => { closeMenu(); btn.focus(); if (v !== value) onchange(v); };
    const menu = h('div', { class: 'menu', role: 'listbox', tabindex: '-1' }, options.map(([v, label], i) =>
      h('button', { class: `opt${v === value ? ' on' : ''}`, role: 'option', tabindex: '-1', onclick: () => choose(v), onpointermove: () => setActive(i, false) },
        h('span', { class: 'grow' }, label), v === value && icon('check', 15))));
    function setActive(i, scroll = true) {
      active = (i + options.length) % options.length;
      [...menu.children].forEach((c, j) => c.classList.toggle('active', j === active));
      if (scroll) menu.children[active].scrollIntoView({ block: 'nearest' });
    }
    menu.addEventListener('keydown', (e) => {
      const keys = { ArrowDown: () => setActive(active + 1), ArrowUp: () => setActive(active - 1), Home: () => setActive(0), End: () => setActive(options.length - 1),
        Enter: () => choose(options[active][0]), ' ': () => choose(options[active][0]), Escape: () => { closeMenu(); btn.focus(); }, Tab: () => closeMenu() };
      if (keys[e.key]) { if (e.key !== 'Tab') e.preventDefault(); keys[e.key](); }
    });
    document.body.append(menu);
    const r = btn.getBoundingClientRect();
    const below = window.innerHeight - r.bottom > Math.min(menu.scrollHeight, 280) + 14;
    menu.style.cssText = `left:${r.left}px;min-width:${r.width}px;transform-origin:${below ? 'top' : 'bottom'} left;${below ? `top:${r.bottom + 6}px` : `bottom:${window.innerHeight - r.top + 6}px`}`;
    const outside = (e) => { if (!menu.contains(e.target) && !btn.contains(e.target)) closeMenu(); };
    document.addEventListener('pointerdown', outside, true);
    menuOpen = { menu, btn, outside };
    btn.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    menu.focus();
    setActive(active);
  };
  btn.addEventListener('click', () => (menuOpen && menuOpen.btn === btn ? closeMenu() : open()));
  btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); } });
  return btn;
}
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

function toast(message, isError) {
  const el = h('div', { class: `toast${isError ? ' err' : ''}`, role: 'status' }, icon(isError ? 'warn' : 'check', 16), h('span', {}, message));
  document.getElementById('toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, isError ? 7000 : 3200);
}

// Run an action, show failures as a toast, re-render afterwards.
async function run(fn, done) {
  try {
    const res = await fn();
    if (res && res.state) S = res.state; else if (res && res.settings) S = res;
    if (done) toast(typeof done === 'function' ? done(res) : done);
    render();
    return res;
  } catch (e) {
    toast(String(e.message || e).replace(/^Error invoking remote method 'api': (Error: )?/, ''), true);
  }
}

const set = (key, value) => run(() => api('setSetting', key, value));
const queuedMsg = (res) => (res.queued ? 'Queued. It goes in when Rocket League closes.' : 'Applied.');
const themeMode = () => (S.settings.theme.mode === 'light' ? 'light' : 'dark');

// Switch theme. Colours cross-fade through CSS transitions (see :root.theming), so the
// page is not rebuilt until the fade is over: freshly created elements would not fade.
let themeTimer = null;
function setTheme(mode) {
  if (themeMode() === mode) return;
  const root = document.documentElement;
  S.settings.theme = { mode };
  root.classList.add('theming');
  root.dataset.theme = mode;
  const btn = document.querySelector('#top .iconbtn');
  if (btn) btn.replaceChildren(icon(mode === 'dark' ? 'sun' : 'moon', 18));
  clearTimeout(themeTimer);
  themeTimer = setTimeout(() => { root.classList.remove('theming'); render(); }, 420);
  api('setSetting', 'theme', { mode }).catch((e) => toast(String(e.message || e), true));
}

/* ---------- shell ---------- */

let shown = null; // which page the view currently holds, to animate only on page changes
function render(animate) {
  closeMenu();
  document.documentElement.dataset.theme = themeMode();
  const nav = document.getElementById('nav'), top = document.getElementById('top'), view = document.getElementById('view');
  const ready = S.install.valid;
  if (!PAGES[ui.tab]) ui.tab = 'garage';
  const page = ready ? ui.tab : 'setup';
  document.body.classList.toggle('setup', !ready);
  view.classList.toggle('enter', !!animate || shown !== page);
  if (shown !== page) view.scrollTop = 0;
  shown = page;

  const [name, sub] = ready ? PAGES[ui.tab] : ['Boostpad', ''];
  const dark = themeMode() === 'dark';
  top.replaceChildren(...[
    h('div', { class: 'pagetitle grow' }, h('h1', {}, name), sub && h('span', { class: 'muted clip' }, sub)),
    ready && S.running && h('span', { class: 'pill' }, h('span', { class: 'dot live' }), 'Game running · changes are queued'),
    h('button', { class: 'iconbtn', 'aria-label': dark ? 'Switch to light mode' : 'Switch to dark mode', onclick: () => setTheme(themeMode() === 'dark' ? 'light' : 'dark') }, icon(dark ? 'sun' : 'moon', 18)),
    ready && btnIcon('primary', 'play', 'Play', () => run(() => api('launchGame'), 'Starting Rocket League…'), { disabled: S.running }),
  ].filter(Boolean));
  if (!ready) { view.replaceChildren(setup()); return; }
  updateNav(nav);
  view.replaceChildren(views[ui.tab]());
}

// The sidebar is built once so the highlight can slide between items.
function updateNav(nav) {
  if (!nav.firstChild) {
    const list = h('div', { class: 'navlist' }, h('div', { class: 'ind' }));
    NAV.forEach((group, g) => {
      if (g) list.append(h('div', { class: 'gap' }));
      for (const [id, glyph] of group) {
        list.append(h('button', { 'data-tab': id, onclick: go(id) }, icon(glyph), h('span', { class: 'grow' }, PAGES[id][0]), id === 'active' && h('span', { class: 'count', hidden: '' })));
      }
    });
    nav.append(h('div', { class: 'brand' }, mark(28), 'BOOSTPAD'), list,
      h('div', { class: 'gamestate' }, h('div', { class: 'row', style: 'gap:8px' }, h('span', { class: 'dot' }), h('b', {}, 'Rocket League')), h('span', { class: 'muted small' }), h('span', { class: 'muted small' }, `v${S.version} · open source`)));
  }
  const ind = nav.querySelector('.ind');
  for (const btn of nav.querySelectorAll('[data-tab]')) {
    const on = btn.dataset.tab === ui.tab;
    btn.classList.toggle('on', on);
    if (on) {
      if (!ind.dataset.placed) { ind.style.transition = 'none'; requestAnimationFrame(() => { ind.style.transition = ''; }); ind.dataset.placed = '1'; }
      ind.style.transform = `translateY(${btn.offsetTop}px)`;
    }
  }
  const pending = S.engine.active.length + S.engine.queue.length;
  const count = nav.querySelector('.count');
  count.hidden = !pending;
  count.textContent = pending;
  const state = nav.querySelector('.gamestate');
  state.querySelector('.dot').classList.toggle('live', S.running);
  state.children[1].textContent = `${S.install.platform === 'steam' ? 'Steam' : 'Epic Games'} · ${S.running ? 'running' : 'not running'}`;
}

function setup() {
  const choose = (platform, label) => h('button', { class: 'tile s6 press', onclick: async () => {
    const found = await api('detectGame');
    if (found[platform]) run(() => api('setInstall', platform, found[platform]), 'Found Rocket League.');
    else { toast(`No ${label} install found. Select the "rocketleague" folder.`, true); run(() => api('browseInstall', platform)); }
  } }, h('h3', {}, 'Launcher'), h('h2', {}, label), h('span', { class: 'muted small' }, 'Detect automatically'));
  return h('div', { class: 'setupwrap' }, bento(
    tile('s12 hero', mark(64), h('h1', {}, 'Where do you play?'), h('p', { class: 'muted' }, 'Pick your launcher and Boostpad finds Rocket League for you.')),
    choose('steam', 'Steam'), choose('epic', 'Epic Games'),
    noteTile('info', 's12', 'Boostpad only changes files on your own PC and backs up every file it touches. It is a fan project, not affiliated with Psyonix or Epic Games.')));
}

/* ---------- garage: item swaps ---------- */

async function ensureCatalog() {
  if (catalog) return;
  catalog = await api('getCatalog');
  catalog.counts = {};
  catalog.byId = new Map();
  for (const i of catalog.items) { catalog.counts[i.category] = (catalog.counts[i.category] || 0) + 1; catalog.byId.set(i.id, i); }
  if (ui.tab === 'garage' || ui.tab === 'active') render(ui.tab === 'garage');
}

// The item's real picture, read from the game's own files (thumb://, see main.js).
// Items whose package cannot be read fall back to their category icon.
function picture(item, glyph, cls = '') {
  const box = h('span', { class: `pic ${cls}` });
  const fallback = () => { box.classList.add('none'); box.replaceChildren(icon(glyphFor(glyph), cls.includes('sm') ? 18 : 26)); };
  if (!item || !item.thumb) { fallback(); return box; }
  const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', draggable: 'false', src: `thumb://item/${encodeURIComponent(item.thumb)}` });
  img.addEventListener('load', () => img.classList.add('in'));
  img.addEventListener('error', fallback);
  box.append(img);
  if (img.complete && img.naturalWidth) img.classList.add('in');
  return box;
}

// Can the item you own take this look? Mirrors canSwap() in core/catalog.js.
const canSwap = (source, target) => source.id !== target.id && target.ok && source.len <= target.len;
const whyNot = (source, target) => {
  if (!target.ok) return 'This look uses a newer package key that Boostpad cannot read.';
  if (source.len > target.len) return 'Not supported yet: this look has a shorter internal name than your item.';
  return 'Pick two different items.';
};

const views = {};
let popGrid = false; // animate the item grid on the next render (category change)
let garage = null;   // handles of the mounted Garage page, so a pick does not rebuild it

views.garage = () => {
  const root = bento();
  if (!S.settings.experimentalSwaps) {
    root.append(noteTile('warn', 's12', 'Item swaps rewrite game packages and are not confirmed in game yet. Turn them on to use the Swap button.',
      h('button', { class: 'btn sm', style: 'margin-left:12px', onclick: go('settings') }, 'Open Settings')));
  }
  if (!catalog) { ensureCatalog(); root.append(tile('s12', empty('cars', 'Reading your game files', 'Building the item list from your own install.'))); return root; }

  const pool = () => catalog.items.filter((i) => i.category === ui.cat);
  const op = () => ({ kind: 'swap', sourceFile: ui.src.file, targetFile: ui.dst.file, category: ui.cat, label: `${ui.src.name} → ${ui.dst.name}` });
  const bar = h('section', { class: 'swapbar' });
  const grid = h('div', { class: `grid${popGrid ? ' pop' : ''}` });
  const count = h('span', { class: 'muted small' });
  const only = h('label', { class: 'row small muted' });
  popGrid = false;

  function paintBar() {
    const pick = (which, label, item, hint) => h('button', { class: `pick${ui.slot === which ? ' on' : ''}`, onclick: () => { ui.slot = which; paintBar(); fill(); } },
      item ? picture(item, ui.cat, 'lg') : h('span', { class: 'pic lg blank' }, which === 'src' ? '1' : '2'),
      h('span', { class: 'col grow', style: 'gap:4px' }, h('h3', {}, label),
        item ? h('span', { class: 'name clip' }, item.name) : h('span', { class: 'muted' }, hint),
        item && h('span', { class: 'muted small clip' }, item.file)));
    const ready = ui.check && ui.check.ok;
    const queued = ui.src && S.engine.queue.some((q) => q.key === ui.src.id);
    const applied = ui.src && S.engine.active.some((r) => r.key === ui.src.id);
    let status;
    if (!ui.src) status = h('span', { class: 'muted' }, 'Start with an item you own');
    else if (queued) status = h('span', { class: 'tag on' }, 'Queued: close Rocket League to apply');
    else if (!ui.dst) status = h('span', { class: 'muted' }, applied ? 'This item is swapped. Pick a look to change it.' : 'Now pick its new look');
    else if (!ui.check) status = h('span', { class: 'muted' }, 'Checking…');
    else if (!ready) status = h('span', { style: 'color:var(--bad)' }, ['NAME_TOO_LONG', 'NO_KEY'].includes(ui.check.code) ? whyNot(ui.src, ui.dst) : ui.check.message);
    else if (S.running) status = h('span', { class: 'muted' }, 'Rocket League is open. The swap waits until you close it.');
    else status = h('span', { class: 'tag on' }, 'Ready');
    bar.replaceChildren(
      pick('src', 'Your item', ui.src, 'Pick an item you own'),
      h('div', { class: 'tile mid' },
        h('button', { class: 'btn primary lg', disabled: !ready || !S.settings.experimentalSwaps, onclick: () => run(() => api('apply', op()), queuedMsg) }, S.running ? 'Queue swap' : 'Swap'),
        h('div', { class: 'status' }, status),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm grow', disabled: !ui.src, onclick: () => { const p = pool().filter((i) => canSwap(ui.src, i)); pickItem(p[Math.floor(Math.random() * p.length)], 'dst'); } }, 'Random'),
          h('button', { class: 'btn sm grow', onclick: () => { ui.src = ui.dst = ui.check = null; ui.slot = 'src'; paintBar(); fill(); } }, 'Clear'))),
      pick('dst', 'New look', ui.dst, 'Then pick its new look'));
    requestAnimationFrame(() => root.style.setProperty('--bar', `${bar.offsetHeight}px`));
  }

  function cell(i, n, blocked) {
    return h('button', { class: `cell${blocked ? ' no' : ''}`, 'data-id': i.id, style: n < 24 && `--i:${n}`, 'aria-label': i.name, onclick: () => pickItem(i, ui.slot) },
      picture(i, ui.cat), h('span', { class: 'name' }, i.name));
  }
  function mark() { // show which cells are picked, without rebuilding them
    for (const el of grid.children) {
      const isSrc = !!ui.src && ui.src.id === el.dataset.id, isDst = !!ui.dst && ui.dst.id === el.dataset.id;
      el.classList.toggle('src', isSrc);
      el.classList.toggle('dst', isDst);
      const badge = el.querySelector('.badge');
      if (badge) badge.remove();
      if (isSrc || isDst) el.append(h('span', { class: 'badge' }, isSrc ? 'YOURS' : 'NEW'));
    }
  }
  // The list is added to the page a batch at a time as you scroll.
  const BATCH = 96;
  const sentinel = h('div', { style: 'height:1px' });
  let list = [], shown = 0;
  const picking = () => ui.slot === 'dst' && ui.src; // choosing a look for a known item
  function more() {
    if (shown >= list.length) return;
    const blocked = (i) => !!picking() && i !== ui.src && !canSwap(ui.src, i);
    grid.append(...list.slice(shown, shown + BATCH).map((i, n) => cell(i, shown + n, blocked(i))));
    shown = Math.min(shown + BATCH, list.length);
    mark();
    io.unobserve(sentinel); // re-arm: fires again if the end of the list is still in view
    if (shown < list.length) io.observe(sentinel);
  }
  if (garage) garage.io.disconnect();
  const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) more(); }, { root: document.getElementById('view'), rootMargin: '500px' });
  function fill() {
    const q = ui.q.trim().toLowerCase();
    list = pool().filter((i) => !q || i.name.toLowerCase().includes(q));
    const total = list.length;
    const works = picking() ? list.filter((i) => canSwap(ui.src, i)).length : total;
    if (picking() && ui.only) list = list.filter((i) => canSwap(ui.src, i) || i === ui.src);
    list.sort((a, b) => (b.ok - a.ok) || a.name.localeCompare(b.name)); // items with a readable picture first
    grid.replaceChildren();
    shown = 0;
    more();
    count.textContent = picking() ? `${works} of ${total} looks work with ${ui.src.name}` : plural(total, 'item');
    only.replaceChildren(...(picking() ? [toggle(ui.only, (v) => { ui.only = v; fill(); }), 'Only looks that work'] : []));
  }
  garage = { paintBar, fill, mark, io };
  paintBar();
  fill();

  root.append(bar,
    tile('s3 rail', catalog.categories.map((c) => h('button', { class: ui.cat === c.id ? 'on' : '',
      onclick: () => { ui.cat = c.id; ui.q = ''; ui.src = ui.dst = ui.check = null; ui.slot = 'src'; popGrid = true; render(); } },
    icon(c.id, 17), h('span', { class: 'grow' }, c.label), h('small', {}, catalog.counts[c.id] || 0)))),
    tile('s9',
      h('div', { class: 'row wrap' }, h('label', { class: 'search' }, icon('search', 16),
        field({ placeholder: `Search ${catalog.categories.find((c) => c.id === ui.cat).label.toLowerCase()}`, value: ui.q, oninput: (e) => { ui.q = e.target.value; fill(); } })),
      only, h('span', { class: 'grow' }), count),
      grid, sentinel));
  return root;
};

async function pickItem(item, which) {
  if (!item) return;
  ui[which] = item;
  ui.check = null;
  if (which === 'src') { ui.slot = 'dst'; if (ui.dst && !canSwap(item, ui.dst)) ui.dst = null; }
  garage.paintBar();
  if (which === 'src') garage.fill(); else garage.mark();
  if (ui.src && ui.dst) {
    const { src, dst } = ui;
    const check = await api('checkSwap', { kind: 'swap', sourceFile: src.file, targetFile: dst.file });
    if (ui.src === src && ui.dst === dst) { ui.check = check; garage.paintBar(); }
  }
}

/* ---------- mod packs & maps ---------- */

let packs = null, maps = null;
const load = async (what) => { if (what === 'packs') packs = await api('packsList'); else maps = await api('mapsList'); render(true); };

views.packs = () => {
  const add = async () => { packs = await api('packsImport'); render(); };
  const root = bento(tile('s12', head('Library', btnIcon('primary sm', 'plus', 'Add pack folder', add)),
    h('div', { class: 'chips' }, PACK_TYPES.map(([id, label]) => h('button', { class: `chip${ui.packType === id ? ' on' : ''}`, onclick: () => { ui.packType = id; render(); } },
      id !== 'all' && icon(glyphFor(id), 15), label)))));
  if (!packs) { load('packs'); return root; }
  const shown = packs.filter((p) => ui.packType === 'all' || p.type === ui.packType);
  if (!shown.length) {
    root.append(tile('s12', empty(ui.packType === 'all' ? 'packs' : glyphFor(ui.packType), 'No packs here yet',
      'A pack is a folder with replacement game files and a pack.json that says which file each one replaces. The README has the format.')));
    return root;
  }
  const activeIds = new Set(S.engine.active.map((r) => r.op.packId));
  const queuedIds = new Set(S.engine.queue.filter((q) => q.op).map((q) => q.op.packId));
  root.append(shown.map((p) => tile('card',
    h('div', { class: 'row' }, art(p.name, p.type), h('div', { class: 'grow' }, h('b', { class: 'clip' }, p.name),
      h('div', { class: 'muted small' }, p.error || `${plural(p.files.length, 'file')}${p.author ? ` · by ${p.author}` : ''}`)),
    activeIds.has(p.id) ? h('span', { class: 'tag on' }, 'In game') : h('span', { class: 'tag cap' }, p.type)),
    h('div', { class: 'row push' },
      activeIds.has(p.id)
        ? h('button', { class: 'btn grow', onclick: () => run(() => api('packsRevert', p.id), 'Original files restored.') }, 'Remove from game')
        : h('button', { class: 'btn primary grow', disabled: !!p.error || queuedIds.has(p.id), onclick: () => run(() => api('packsApply', p.id), queuedMsg) }, queuedIds.has(p.id) ? 'Queued' : 'Apply'),
      h('button', { class: 'btn danger', disabled: activeIds.has(p.id), onclick: async () => { packs = await api('packsRemove', p.id); render(); } }, 'Delete')))));
  return root;
};

views.maps = () => {
  const add = async () => { maps = await api('mapsAdd'); render(); };
  const root = bento(
    tile('s8', head('Your maps', btnIcon('primary sm', 'plus', 'Add map files', add)),
      h('p', { class: 'muted' }, 'Add the .upk or .udk map files you have downloaded, then load one.')),
    tile('s4 accent', h('h3', {}, 'How to play'), h('p', {}, 'A loaded map takes the place of the Underpass arena. Open Training → Free Play and choose Underpass.')));
  if (!maps) { load('maps'); return root; }
  const slot = S.mapSlot.toLowerCase();
  const loaded = S.engine.active.find((r) => r.key === slot);
  const queued = S.engine.queue.find((q) => q.key === slot && q.op);
  if (!maps.length) { root.append(tile('s12', empty('maps', 'No maps yet', 'Your workshop maps show up here.'))); return root; }
  root.append(maps.map((m) => {
    const isLoaded = loaded && loaded.op.from.endsWith(m.id), isQueued = queued && queued.op.from.endsWith(m.id);
    return tile('card',
      h('div', { class: 'row' }, art(m.name, 'maps'), h('div', { class: 'grow' }, h('b', { class: 'clip' }, m.name), h('div', { class: 'muted small' }, `${(m.size / 1048576).toFixed(1)} MB`)),
        isLoaded && h('span', { class: 'tag on' }, 'Loaded'), isQueued && h('span', { class: 'tag' }, 'Queued')),
      h('div', { class: 'row push' },
        isLoaded
          ? h('button', { class: 'btn grow', onclick: () => run(() => api('revert', slot), 'Underpass restored.') }, 'Unload')
          : h('button', { class: 'btn primary grow', onclick: () => run(() => api('mapsLoad', m.id), queuedMsg) }, 'Load'),
        h('button', { class: 'btn danger', disabled: !!isLoaded, onclick: async () => { maps = await api('mapsRemove', m.id); render(); } }, 'Delete')));
  }));
  return root;
};

/* ---------- presets & active ---------- */

let community = null;
views.presets = () => {
  const name = field({ class: 'grow', placeholder: 'Name this setup', maxlength: 40 });
  const paste = field({ class: 'grow', placeholder: 'Paste a shared preset code' });
  const list = S.settings.presets, n = S.engine.active.length;
  const url = S.settings.syncUrl.replace(/\/+$/, '');
  const publish = async (p) => {
    const body = { ...JSON.parse(await api('presetExport', p.id)), author: S.settings.profile.name };
    const res = await fetch(`${url}/presets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json()).error || `Server said ${res.status}`);
  };
  const browse = async () => {
    const res = await fetch(`${url}/presets`);
    if (!res.ok) throw new Error(`Server said ${res.status}`);
    community = await res.json();
  };
  const root = bento(
    tile('s7', head('Save current setup'), h('p', { class: 'muted' }, n ? `${plural(n, 'change')} active right now.` : 'Nothing is active yet. Apply a swap, pack or map first.'),
      h('div', { class: 'row push' }, name, h('button', { class: 'btn primary', disabled: !n, onclick: () => run(() => api('presetSave', name.value), 'Preset saved.') }, 'Save'))),
    tile('s5', head('Import'), h('p', { class: 'muted' }, 'Got a code from a friend? Paste it here.'),
      h('div', { class: 'row push' }, paste, h('button', { class: 'btn', onclick: () => run(() => api('presetImport', paste.value), 'Preset imported.') }, 'Import'))));
  root.append(list.length ? list.map((p) => tile('card',
    h('div', { class: 'row' }, art(p.name, 'presets'), h('div', { class: 'grow' }, h('b', { class: 'clip' }, p.name), h('div', { class: 'muted small' }, `${plural(p.ops.length, 'change')} · ${new Date(p.savedAt).toLocaleDateString()}`))),
    h('p', { class: 'muted small' }, p.ops.slice(0, 4).map((o) => o.label).join(' · ') || 'Empty'),
    h('div', { class: 'row wrap push' },
      h('button', { class: 'btn primary grow', onclick: () => run(() => api('presetLoad', p.id), (r) => (r.errors.length ? `Loaded with ${plural(r.errors.length, 'problem')}: ${r.errors[0]}` : 'Preset loaded.')) }, 'Load'),
      h('button', { class: 'btn', onclick: async () => { await navigator.clipboard.writeText(await api('presetExport', p.id)); toast('Share code copied.'); } }, 'Copy'),
      url && h('button', { class: 'btn', onclick: () => run(() => publish(p), 'Published to the sync server.') }, 'Publish'),
      h('button', { class: 'btn danger', onclick: () => run(() => api('presetDelete', p.id)) }, 'Delete'))))
    : tile('s12', empty('presets', 'No presets yet', 'Set your car up the way you like, then save it here.')));
  root.append(tile('s12', head('Community', url ? h('button', { class: 'btn sm', onclick: () => run(browse) }, 'Browse shared presets') : h('span', { class: 'muted small' }, 'Set a sync server in Profile to share presets.')),
    community && (community.length ? h('div', { class: 'list' }, community.map((c) => h('div', { class: 'item' }, art(c.name, 'presets'),
      h('div', { class: 'grow' }, h('b', {}, c.name), h('div', { class: 'muted small' }, `${plural(c.ops.length, 'swap')}${c.author ? ` · by ${c.author}` : ''}`)),
      h('button', { class: 'btn sm', onclick: () => run(() => api('presetImport', JSON.stringify({ boostpadPreset: 1, name: c.name, ops: c.ops })), 'Saved to your presets.') }, 'Save'))))
      : h('p', { class: 'muted small' }, 'Nothing shared on this server yet.'))));
  return root;
};

views.active = () => {
  const { active, queue } = S.engine;
  if (!catalog && active.some((r) => r.op.kind === 'swap')) ensureCatalog(); // for the pictures
  return bento(
    tile('s4', head('In your game'), h('div', { class: 'big hero' }, active.length), h('p', { class: 'muted' }, active.length ? `${plural(active.length, 'file')} changed. Originals are backed up.` : 'Your game files are original.'),
      h('button', { class: 'btn danger push', disabled: !active.length, onclick: () => run(() => api('revertAll'), 'Everything reverted.') }, 'Revert all')),
    tile('s8', head('Waiting for Rocket League to close', h('span', { class: 'tag' }, queue.length)),
      queue.length ? h('div', { class: 'list' }, queue.map((q) => h('div', { class: 'item' },
        h('span', { class: 'tag on' }, q.type === 'apply' ? 'Apply' : 'Revert'), h('div', { class: 'grow clip' }, q.op ? q.op.label : q.key),
        h('button', { class: 'btn sm', onclick: () => run(() => api('unqueue', q.key)) }, 'Cancel'))))
        : h('p', { class: 'muted' }, 'Nothing is queued. Changes made while the game runs wait here and go in when it closes.')),
    tile('s12', head('Changes'),
      active.length ? h('div', { class: 'list' }, active.map((r) => h('div', { class: 'item' },
        r.op.kind === 'swap' && catalog ? picture(catalog.byId.get(r.op.targetFile.toLowerCase()), r.op.category, 'sm') : art(r.op.label || r.file, r.op.category),
        h('div', { class: 'grow' }, h('b', {}, r.op.label || r.file), h('div', { class: 'muted small' }, `${r.file} · ${new Date(r.appliedAt).toLocaleString()}`)),
        h('span', { class: 'tag cap' }, r.op.category || r.op.kind),
        h('button', { class: 'btn sm', onclick: () => run(() => api('revert', r.key), 'Reverted.') }, 'Revert'))))
        : empty('active', 'Nothing is changed', 'Swaps, packs and maps you apply show up here.')));
};

/* ---------- tracker, overlay, music ---------- */

views.tracker = () => {
  const t = S.settings.tracker;
  const mine = t.entries.filter((e) => e.playlist === t.playlist);
  const last = mine.at(-1), today = new Date().toDateString();
  const firstToday = mine.find((e) => new Date(e.at).toDateString() === today);
  const delta = last && firstToday ? last.mmr - firstToday.mmr : 0;
  const input = field({ class: 'grow', inputmode: 'numeric', placeholder: 'MMR after your match', oninput: (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5); } });
  const log = () => { const mmr = Number(input.value); if (mmr > 0) set('tracker', { ...t, entries: [...t.entries, { playlist: t.playlist, mmr, at: Date.now() }].slice(-500) }); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') log(); });
  const stat = (cls, label, value, color) => tile(cls, h('h3', {}, label), h('div', { class: 'big push', style: color && `color:${color}` }, value));
  const chart = tile('s12', head('Trend'));
  if (mine.length > 1) {
    const pts = mine.slice(-40), lo = Math.min(...pts.map((p) => p.mmr)), hi = Math.max(...pts.map((p) => p.mmr));
    const xy = pts.map((p, i) => `${(i / (pts.length - 1)) * 600},${104 - ((p.mmr - lo) / (hi - lo || 1)) * 88}`);
    const svg = h('div');
    svg.innerHTML = `<svg viewBox="0 0 600 120" width="100%" height="150" preserveAspectRatio="none"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".3"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs><polygon fill="url(#g)" points="0,120 ${xy.join(' ')} 600,120"/><polyline fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" points="${xy.join(' ')}"/></svg>`;
    chart.append(svg);
  } else chart.append(h('p', { class: 'muted' }, 'Log at least two ratings to see your trend.'));
  return bento(
    tile('s5 r2 accent', head('Current', select(PLAYLISTS.map((p) => [p, p]), t.playlist, (p) => set('tracker', { ...t, playlist: p }), 170)),
      h('div', { class: 'big hero push' }, last ? last.mmr : '—'), h('p', { class: 'muted' }, last ? `Last logged ${new Date(last.at).toLocaleString()}` : 'Nothing logged for this playlist yet.')),
    stat('s3', 'Today', last ? `${delta >= 0 ? '+' : ''}${delta}` : '—', last && (delta < 0 ? 'var(--bad)' : 'var(--accent)')),
    stat('s2', 'Peak', last ? Math.max(...mine.map((e) => e.mmr)) : '—'),
    stat('s2', 'Logged', mine.length),
    tile('s7', head('Log a match', h('button', { class: 'btn sm danger', disabled: !last, onclick: () => set('tracker', { ...t, entries: t.entries.filter((e) => e !== last) }) }, 'Undo last')),
      h('div', { class: 'row' }, input, h('button', { class: 'btn primary', onclick: log }, 'Log')),
      h('p', { class: 'muted small' }, 'Entered by hand: Rocket League has no public stats API, and the stats sites block automated readers.')),
    chart);
};

views.overlay = () => {
  const o = S.settings.overlay, upd = (patch) => set('overlay', { ...o, ...patch });
  const feature = (glyph, name, text, on, key) => tile(`s6${on ? ' accent' : ''}`,
    h('div', { class: 'row' }, h('span', { class: 'art lg', style: 'background:var(--tile-2);color:var(--accent)' }, icon(glyph, 30)), h('span', { class: 'grow' }), toggle(on, (v) => upd({ [key]: v }))),
    h('div', { class: 'push' }, h('h2', {}, name), h('p', { class: 'muted' }, text)));
  return bento(
    feature('overlay', 'Controller', 'Every button, stick and trigger you press, live.', o.controller, 'controller'),
    feature('tracker', 'MMR counter', 'Your latest logged rating for the selected playlist.', o.mmr, 'mmr'),
    tile('s7', head('Look'),
      h('div', { class: 'opt-row' }, h('div', { class: 'grow' }, h('b', {}, 'Controller colour'), h('div', { class: 'muted small' }, 'Match your own pad.')),
        select([['light', 'White'], ['dark', 'Black']], o.style, (v) => upd({ style: v }))),
      h('div', { class: 'opt-row' }, h('div', { style: 'width:150px' }, h('b', {}, 'Size'), h('div', { class: 'muted small', id: 'ovsize' }, `${o.size}%`)),
        slider(50, 160, o.size, (v) => upd({ size: v }), (v) => { document.getElementById('ovsize').textContent = `${v}%`; }))),
    noteTile('info', 's5', 'The overlay is a separate window drawn on top of the game. Run Rocket League in borderless mode to see it. It does not read or change the game.'));
};

function play(i) {
  const files = S.settings.music.files;
  if (!files.length) return;
  track = (i + files.length) % files.length;
  player.src = `file:///${files[track].replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace('%3A', ':')}`;
  player.volume = S.settings.music.volume;
  player.play().catch((e) => toast(`Could not play this file: ${e.message}`, true));
  render();
}
player.addEventListener('ended', () => play(track + 1));

views.music = () => {
  const m = S.settings.music, name = (f) => f.split(/[\\/]/).pop().replace(/\.\w+$/, '');
  const add = () => run(() => api('musicAdd'));
  const playing = track >= 0 && !player.paused;
  const current = track >= 0 && m.files[track] ? name(m.files[track]) : null;
  return bento(
    tile(`s5${playing ? ' accent' : ''}`, head(playing ? 'Now playing' : 'Player'),
      h('div', { class: 'row' }, art(current || 'music', 'anthems', 'lg'), h('h2', { class: 'grow clip' }, current || 'Nothing playing')),
      h('div', { class: 'row push' },
        h('button', { class: 'btn grow', onclick: () => play(track - 1) }, 'Prev'),
        h('button', { class: 'btn primary grow', onclick: () => { if (track < 0) play(0); else if (player.paused) { player.play(); render(); } else { player.pause(); render(); } } }, playing ? 'Pause' : 'Play'),
        h('button', { class: 'btn grow', onclick: () => play(track + 1) }, 'Next')),
      h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'Volume'),
        slider(0, 100, Math.round(m.volume * 100), (v) => set('music', { ...m, volume: v / 100 }), (v) => { player.volume = v / 100; }))),
    tile('s7', head('Playlist', btnIcon('primary sm', 'plus', 'Add music', add)),
      m.files.length ? h('div', { class: 'list' }, m.files.map((f, i) => h('div', { class: 'item' },
        h('button', { class: `btn sm${i === track && playing ? ' primary' : ''}`, onclick: () => play(i) }, i === track && playing ? 'Playing' : 'Play'), h('div', { class: 'grow clip' }, name(f)),
        h('button', { class: 'btn sm danger', onclick: () => set('music', { ...m, files: m.files.filter((x) => x !== f) }) }, 'Remove'))))
        : empty('anthems', 'Your playlist is empty', 'Add MP3, OGG, WAV, FLAC or M4A files from your PC.')));
};

/* ---------- profile ---------- */

function profileCard(p) {
  const glow = p.glow ? `text-shadow:0 0 14px ${p.titleColor}` : '';
  return h('div', { class: 'pcard' },
    p.avatar ? h('img', { src: p.avatar, alt: '' }) : h('div', { class: 'ph' }, (p.name || '?')[0].toUpperCase()),
    h('div', { class: 'col', style: 'gap:4px' }, h('div', { class: 'pname clip' }, p.name || 'Your name'),
      h('div', { class: 'ptitle', style: `color:${p.titleColor};${glow}` }, p.title || 'Your title'),
      p.rank && h('span', { class: 'tag', style: 'align-self:flex-start' }, p.rank)));
}

let lookedUp = null;
views.profile = () => {
  const p = S.settings.profile, upd = (patch) => set('profile', { ...p, ...patch });
  const url = S.settings.syncUrl.replace(/\/+$/, '');
  const publish = async () => {
    const me = p.id ? p : { ...p, id: crypto.randomUUID(), secret: crypto.randomUUID() };
    const res = await fetch(`${url}/profiles/${me.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-secret': me.secret },
      body: JSON.stringify({ name: me.name, title: me.title, titleColor: me.titleColor, glow: me.glow, rank: me.rank, avatar: me.avatar }) });
    if (!res.ok) throw new Error(`Server said ${res.status}`);
    return api('setSetting', 'profile', me);
  };
  const friend = field({ class: 'grow', placeholder: 'A friend’s profile ID' });
  const lookup = async () => {
    const res = await fetch(`${url}/profiles/${encodeURIComponent(friend.value.trim())}`);
    if (!res.ok) throw new Error('Profile not found');
    lookedUp = await res.json();
  };
  return bento(
    tile('s7', head('Your card'), profileCard(p)),
    tile('s5 r2', head('Sharing'),
      h('p', { class: 'muted small' }, 'Other Boostpad users see your card through a sync server. Anyone can run the one in the server/ folder; there is no central server and nothing to pay for.'),
      field({ placeholder: 'Sync server URL, e.g. http://localhost:8787', value: S.settings.syncUrl, onchange: (e) => set('syncUrl', e.target.value.trim()) }),
      h('button', { class: 'btn primary', disabled: !url, onclick: () => run(publish, 'Profile published.') }, 'Publish my card'),
      p.id && h('p', { class: 'muted small', style: 'word-break:break-all' }, `Your profile ID: ${p.id}`),
      head('Find a friend'),
      h('div', { class: 'row' }, friend, h('button', { class: 'btn', disabled: !url, onclick: () => run(lookup) }, 'Look up')),
      lookedUp && profileCard(lookedUp)),
    tile('s7', head('Edit'), h('div', { class: 'fields' },
      h('b', {}, 'Name'), field({ maxlength: 24, value: p.name, onchange: (e) => upd({ name: e.target.value }) }),
      h('b', {}, 'Title'), field({ maxlength: 32, value: p.title, onchange: (e) => upd({ title: e.target.value }) }),
      h('b', {}, 'Title colour'), h('div', { class: 'swatches' }, COLORS.map((c) => h('button', { class: `swatch${p.titleColor === c ? ' on' : ''}`, style: `background:${c}`, 'aria-label': c, onclick: () => upd({ titleColor: c }) }))),
      h('b', {}, 'Glow'), h('div', {}, toggle(p.glow, (v) => upd({ glow: v }))),
      h('b', {}, 'Rank badge'), h('div', {}, select(RANKS.map((r) => [r, r || 'None']), p.rank, (v) => upd({ rank: v }), 220)),
      h('b', {}, 'Picture'), h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => run(async () => { const a = await api('pickAvatar'); return a ? api('setSetting', 'profile', { ...p, avatar: a }) : null; }) }, 'Choose picture'),
        p.avatar && h('button', { class: 'btn danger', onclick: () => upd({ avatar: '' }) }, 'Remove')))),
    noteTile('info', 's12', 'This card lives in Boostpad. It does not change your name, title or rank inside Rocket League: that would need code injected into the running game, which Boostpad does not do.'));
};

/* ---------- settings ---------- */

views.settings = () => {
  const mode = themeMode();
  const themeCard = (id, label) => h('button', { class: `themecard${mode === id ? ' on' : ''}`, 'aria-pressed': String(mode === id), onclick: () => setTheme(id) },
    h('span', { class: `mini ${id}` }, h('i'), h('i'), h('i'), h('i')), h('span', { class: 'row' }, h('span', { class: 'grow' }, label), mode === id && icon('check', 16)));
  return bento(
    tile('s5', head('Appearance'), h('div', { class: 'themes' }, themeCard('dark', 'Dark'), themeCard('light', 'Light'))),
    tile('s7', head('Game'),
      h('div', { class: 'opt-row' }, h('div', { class: 'grow' }, h('b', {}, 'Rocket League folder'), h('div', { class: 'muted small', style: 'word-break:break-all' }, S.install.dir)),
        h('button', { class: 'btn sm', onclick: () => run(() => api('browseInstall', S.install.platform)) }, 'Change')),
      h('div', { class: 'opt-row push' }, h('div', { class: 'grow' }, h('b', {}, 'Launcher'), h('div', { class: 'muted small' }, 'Used by the Play button.')),
        select([['epic', 'Epic Games'], ['steam', 'Steam']], S.install.platform, (v) => set('platform', v)))),
    tile('s7', head('Item swaps', h('span', { class: 'tag' }, 'Experimental')),
      h('div', { class: 'opt-row' }, h('div', { class: 'grow' }, h('b', {}, 'Enable item swaps'),
        h('div', { class: 'muted small' }, 'Lets the Garage rewrite item packages. Originals are always backed up and can be restored from Active.')),
      toggle(S.settings.experimentalSwaps, (v) => set('experimentalSwaps', v))),
      h('p', { class: 'muted small' }, 'Rocket League runs with Easy Anti-Cheat. Boostpad does not touch or work around it and cannot promise that modified files are accepted online. Changing game files may break the game’s terms of service and could put your account at risk. Use it at your own risk; the launcher’s “Verify files” always restores a clean install.')),
    tile('s5', head('Data'), h('p', { class: 'muted' }, 'Backups, maps, packs and settings live in the data folder.'),
      h('div', { class: 'row wrap push' },
        h('button', { class: 'btn', onclick: () => api('openDataFolder') }, 'Open data folder'),
        h('button', { class: 'btn danger', disabled: !S.engine.active.length, onclick: () => run(() => api('revertAll'), 'Everything reverted.') }, 'Revert every change'))),
    noteTile('info', 's12', `Boostpad v${S.version} is a free, open-source fan project. Not affiliated with or endorsed by Psyonix or Epic Games. Rocket League is a trademark of Psyonix LLC.`));
};

/* ---------- boot ---------- */

window.boostpad.on('state', ({ state, flushed }) => {
  S = state;
  const ok = flushed.filter((f) => f.ok).length, failed = flushed.filter((f) => !f.ok);
  if (ok) toast(`${plural(ok, 'queued change')} applied.`);
  for (const f of failed) toast(`${f.key}: ${f.message}`, true);
  render();
});
api('getState').then((s) => { S = s; render(); });
