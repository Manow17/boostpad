/* Boostpad renderer. No framework: a small element helper, a few custom controls,
   and one function per page that returns a bento grid of tiles. */
const api = (method, ...args) => window.boostpad.call(method, ...args);

let S = null;          // latest snapshot from the main process
let catalog = null;    // item catalog, loaded on first use
const ui = { tab: location.hash.slice(1) || 'garage', cat: 'cars', q: '', slot: 'src', src: null, dst: null, check: null, only: true, packType: 'all' };

const PAGES = {
  garage: ['Garage', 'Give an item you own the look of another. Only you see it.'],
  maps: ['Workshop Maps', 'Training and challenge maps, on Steam or Epic.'],
  lab: ['Map Merge', 'Mix the game’s own arenas, and add snow.'],
  presets: ['Presets', 'Save your whole setup and switch in one click.'],
  overlay: ['Overlay', 'Your music and your controller, over the game.'],
  profile: ['Profile', 'Your Boostpad card.'],
  settings: ['Settings', ''],
};
const NAV = [
  [['garage', 'cars'], ['maps', 'maps'], ['lab', 'merge'], ['presets', 'presets']],
  [['overlay', 'overlay']],
  [['profile', 'profile'], ['settings', 'settings']],
];
const RANKS = ['', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Champion', 'Grand Champion', 'Supersonic Legend'];
const COLORS = ['#00d8c8', '#38bdf8', '#818cf8', '#c084fc', '#f472b6', '#fb7185', '#fb923c', '#facc15', '#a3e635'];

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
  lock: 'M7 11V8a5 5 0 0 1 10 0v3 M5 11h14v9H5z M12 15v2',
  merge: 'M6 4v5a7 7 0 0 0 7 7h5 M6 20v-9 M15 12l4 4l-4 4',
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

// The app mark: the same picture as the window icon.
const mark = (size) => h('img', { class: 'mark', src: '../../assets/icon.png', width: size, height: size, alt: '', draggable: 'false' });

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
        list.append(h('button', { 'data-tab': id, onclick: go(id) }, icon(glyph), h('span', { class: 'grow' }, PAGES[id][0]), id === 'garage' && h('span', { class: 'count', hidden: '' })));
      }
    });
    nav.append(h('div', { class: 'brand' }, mark(32), 'BOOSTPAD'), list,
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
    tile('s12 hero ink', mark(72), h('h1', {}, 'Where do you play?'), h('p', { class: 'muted' }, 'Pick your launcher and Boostpad finds Rocket League for you.')),
    choose('steam', 'Steam'), choose('epic', 'Epic Games'),
    noteTile('info', 's12', 'Boostpad only changes files on your own PC and backs up every file it touches. It is a fan project, not affiliated with Psyonix or Epic Games.')));
}

/* ---------- garage: item swaps ---------- */

async function ensureCatalog() {
  if (catalog) return;
  catalog = await api('getCatalog');
  catalog.counts = {};
  catalog.byId = new Map();
  for (const i of catalog.items) {
    catalog.counts[i.category] = (catalog.counts[i.category] || 0) + 1;
    catalog.byId.set(i.id, i);
    i.search = `${i.label} ${i.sub} ${i.name} ${i.file}`.toLowerCase(); // shop name, car, internal name
  }
  catalog.catLabel = Object.fromEntries(catalog.categories.map((c) => [c.id, c.label]));
  if (ui.tab === 'garage') render(true);
}

// The item's real picture, read from the game's own files (thumb://, see main.js).
// Items whose package cannot be read fall back to their category icon.
function picture(item, glyph, cls = '') {
  const box = h('span', { class: `pic ${cls}` });
  // a lock means the package needs a key Boostpad does not have (see Settings)
  const fallback = () => { box.classList.add('none'); box.replaceChildren(icon(item && item.ok === false ? 'lock' : glyphFor(glyph), cls.includes('sm') ? 18 : 26)); };
  if (!item || !item.thumb) { fallback(); return box; }
  const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', draggable: 'false', src: `thumb://item/${encodeURIComponent(item.thumb)}?k=${S.keys}` });
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
  if (!catalog) { ensureCatalog(); root.append(tile('s12', empty('cars', 'Reading your game files', 'Building the item list from your own install.'))); return root; }

  const pool = () => catalog.items.filter((i) => i.category === ui.cat);
  const op = () => ({ kind: 'swap', sourceFile: ui.src.file, targetFile: ui.dst.file, category: ui.src.category, label: `${ui.src.label} → ${ui.dst.label}` });
  const bar = h('section', { class: 'swapbar' });
  const grid = h('div', { class: `grid${popGrid ? ' pop' : ''}` });
  const count = h('span', { class: 'muted small' });
  const only = h('label', { class: 'row small muted' });
  popGrid = false;

  function paintBar() {
    const pick = (which, label, item, hint) => h('button', { class: `pick${ui.slot === which ? ' on' : ''}`, onclick: () => { ui.slot = which; paintBar(); fill(); } },
      item ? picture(item, item.category, 'lg') : h('span', { class: 'pic lg blank' }, which === 'src' ? '1' : '2'),
      h('span', { class: 'col grow', style: 'gap:4px' }, h('h3', {}, label),
        item ? h('span', { class: 'name clip' }, item.label) : h('span', { class: 'muted' }, hint),
        item && h('span', { class: 'muted small clip' }, [item.sub, item.file].filter(Boolean).join(' · '))));
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
    else if (ui.cat === 'cars' || ui.cat === 'explosions') status = h('span', { class: 'muted' }, 'Ready. Other tools report that car and goal explosion swaps can crash the game.');
    else status = h('span', { class: 'tag on' }, 'Ready');
    bar.replaceChildren(
      pick('src', 'Your item', ui.src, 'Pick an item you own'),
      h('div', { class: 'tile mid ink' },
        h('button', { class: 'btn primary lg', disabled: !ready, onclick: () => run(() => api('apply', op()), queuedMsg) }, S.running ? 'Queue swap' : 'Swap'),
        h('div', { class: 'status' }, status),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm grow', disabled: !ui.src, onclick: () => { const p = pool().filter((i) => canSwap(ui.src, i)); pickItem(p[Math.floor(Math.random() * p.length)], 'dst'); } }, 'Random'),
          h('button', { class: 'btn sm grow', onclick: () => { ui.src = ui.dst = ui.check = null; ui.slot = 'src'; paintBar(); fill(); } }, 'Clear'))),
      pick('dst', 'New look', ui.dst, 'Then pick its new look'));
    requestAnimationFrame(() => root.style.setProperty('--bar', `${bar.offsetHeight}px`));
  }

  function cell(i, n, blocked) {
    // under the name: the car a decal is for, or (when searching everywhere) the category
    const sub = everywhere() ? [catalog.catLabel[i.category], i.sub].filter(Boolean).join(' · ') : i.sub;
    return h('button', { class: `cell${blocked ? ' no' : ''}`, 'data-id': i.id, style: n < 24 && `--i:${n}`, 'aria-label': i.label, onclick: () => pickItem(i, ui.slot) },
      picture(i, i.category), h('span', { class: 'name' }, i.label), sub && h('span', { class: 'sub' }, sub));
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
  // A search looks in every category, until you are choosing a look (that has to match your item's category).
  const everywhere = () => !!ui.q.trim() && !picking();
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
    list = (everywhere() ? catalog.items : pool()).filter((i) => !q || i.search.includes(q));
    const total = list.length;
    const works = picking() ? list.filter((i) => canSwap(ui.src, i)).length : total;
    if (picking() && ui.only) list = list.filter((i) => canSwap(ui.src, i) || i === ui.src);
    // best matches first when searching (name starts with the text), then items with a readable picture
    const rank = (i) => (q && i.label.toLowerCase().startsWith(q) ? 0 : 1);
    list.sort((a, b) => (rank(a) - rank(b)) || (b.ok - a.ok) || a.label.localeCompare(b.label));
    grid.replaceChildren();
    shown = 0;
    more();
    count.textContent = picking() ? `${works} of ${total} looks work with ${ui.src.label}` : everywhere() ? `${plural(total, 'item')} in all categories` : plural(total, 'item');
    only.replaceChildren(...(picking() ? [toggle(ui.only, (v) => { ui.only = v; fill(); }), 'Only looks that work'] : []));
  }
  garage = { paintBar, fill, mark, io };
  paintBar();
  fill();

  // Everything Boostpad has put in the game, or will when it closes, with a way back.
  const changes = [...S.engine.queue.map((q) => ({ q, op: q.op })), ...S.engine.active.map((r) => ({ r, op: r.op }))];
  const applied = changes.length ? tile('s12 applied', h('h3', {}, 'In your game'),
    changes.map(({ q, r, op }) => {
      const label = op ? (op.label || op.gameFile) : q.key;
      return h('div', { class: 'change' },
        op && op.kind === 'swap' ? picture(catalog.byId.get(op.targetFile.toLowerCase()), op.category, 'sm') : art(label, op ? op.category : 'packs'),
        h('span', { class: 'clip' }, label), q && h('span', { class: 'tag' }, q.type === 'apply' ? 'Queued' : 'Revert queued'),
        q ? h('button', { class: 'btn sm', onclick: () => run(() => api('unqueue', q.key)) }, 'Cancel')
          : h('button', { class: 'btn sm', onclick: () => run(() => api('revert', r.key), S.running ? 'Revert queued until the game closes.' : 'Original file restored.') }, 'Revert'));
    }),
    S.engine.active.length > 1 && h('button', { class: 'btn sm danger', onclick: () => run(() => api('revertAll'), 'Everything reverted.') }, 'Revert all')) : null;

  root.append(bar, applied || '',
    tile('s3 rail', catalog.categories.map((c) => h('button', { class: ui.cat === c.id ? 'on' : '',
      onclick: () => { ui.cat = c.id; ui.q = ''; ui.src = ui.dst = ui.check = null; ui.slot = 'src'; popGrid = true; render(); } },
    icon(c.id, 17), h('span', { class: 'grow' }, c.label), h('small', {}, catalog.counts[c.id] || 0)))),
    tile('s9',
      h('div', { class: 'row wrap' }, h('label', { class: 'search' }, icon('search', 16),
        field({ placeholder: 'Search all items by name', value: ui.q, oninput: (e) => { ui.q = e.target.value; fill(); } })),
      only, h('span', { class: 'grow' }), count),
      grid, sentinel));
  return root;
};

async function pickItem(item, which) {
  if (!item) return;
  ui[which] = item;
  ui.check = null;
  if (which === 'src') {
    ui.slot = 'dst';
    if (ui.dst && (ui.dst.category !== item.category || !canSwap(item, ui.dst))) ui.dst = null;
    // found through a search in another category: go there to choose its new look
    if (item.category !== ui.cat || ui.q) { ui.cat = item.category; ui.q = ''; render(); return; }
  }
  garage.paintBar();
  if (which === 'src') garage.fill(); else garage.mark();
  if (ui.src && ui.dst) {
    const { src, dst } = ui;
    const check = await api('checkSwap', { kind: 'swap', sourceFile: src.file, targetFile: dst.file });
    if (ui.src === src && ui.dst === dst) { ui.check = check; garage.paintBar(); }
  }
}

/* ---------- workshop maps & map merge ---------- */

let maps = null;
views.maps = () => {
  const add = async () => { maps = await api('mapsAdd'); render(); };
  const root = bento(
    tile('s8', head('Your maps', btnIcon('primary sm', 'plus', 'Add map files', add)),
      h('p', { class: 'muted' }, 'Add the .upk or .udk map files you have downloaded, then load one.')),
    tile('s4 ink', h('h3', {}, 'How to play'), h('p', {}, 'A loaded map takes the place of the Underpass arena. Open Training → Free Play and choose Underpass.')));
  if (!maps) { api('mapsList').then((list) => { maps = list; if (ui.tab === 'maps') render(true); }); return root; }
  const slot = S.mapSlot.toLowerCase();
  const loaded = S.engine.active.find((r) => r.key === slot);
  const queued = S.engine.queue.find((q) => q.key === slot && q.op);
  if (!maps.length) { root.append(tile('s12', empty('maps', 'No maps yet', 'Your workshop maps show up here.'))); return root; }
  root.append(maps.map((m) => {
    const isLoaded = loaded && loaded.op.from && loaded.op.from.endsWith(m.id), isQueued = queued && queued.op.from && queued.op.from.endsWith(m.id);
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

// Map Merge works on the arenas that ship with the game (see main/core/arenas.js).
let arenas = null;
const lab = { donor: null, base: null, snow: null };
views.lab = () => {
  const root = bento(noteTile('warn', 's12', 'Experimental. This is built from how the game stores its arenas and has not been confirmed in game. Only you see the result, and every change can be reverted below.'));
  if (!arenas) {
    api('arenas').then((list) => { arenas = list; if (ui.tab === 'lab') render(true); });
    root.append(tile('s12', empty('maps', 'Reading the arenas', 'Finding the parts each arena is built from.')));
    return root;
  }
  const byId = (id) => arenas.find((a) => a.id === id);
  const split = arenas.filter((a) => a.field), snowy = arenas.filter((a) => a.snow);
  lab.donor ??= (split[0] || {}).id;
  lab.base ??= (split[1] || {}).id;
  lab.snow ??= (snowy[0] || {}).id;
  const donor = byId(lab.donor), base = byId(lab.base), snow = byId(lab.snow);
  const options = (list) => list.map((a) => [a.id, a.name]);
  const choose = (key) => (id) => { lab[key] = id; render(); };

  root.append(
    tile('s7', head('Merge two arenas', h('span', { class: 'tag' }, `${split.length} arenas`)),
      h('p', { class: 'muted' }, 'Takes the stadium from one arena (pitch, walls, goals and stands) and puts it in the surroundings of another.'),
      h('div', { class: 'fields' },
        h('b', {}, 'Stadium from'), select(options(split), lab.donor, choose('donor'), 300),
        h('b', {}, 'Placed in'), select(options(split), lab.base, choose('base'), 300)),
      donor && base && h('p', { class: 'muted small' }, donor.id === base.id ? 'Pick two different arenas.'
        : `${base.field} is replaced by a copy of ${donor.field}. Play ${base.name} to see it.`),
      h('button', { class: 'btn primary lg push', disabled: !donor || !base || donor.id === base.id,
        onclick: () => run(() => api('mergeArenas', lab.donor, lab.base), queuedMsg) }, S.running ? 'Queue merge' : 'Merge'),
      h('p', { class: 'muted small' }, `The other ${arenas.length - split.length} arenas are stored as a single file, with the stadium and its surroundings baked together, so they cannot be taken apart.`)),
    tile('s5', head('Add snow', h('span', { class: 'tag' }, `${snowy.length} arenas`)),
      h('p', { class: 'muted' }, 'Turns an arena snowy, where the game has something to do it with.'),
      select(options(snowy), lab.snow, choose('snow')),
      snow && h('p', { class: 'muted small' }, snow.snow.how === 'version'
        ? `This arena has a snowy version in the game: ${snow.snow.gameFile} is replaced by ${snow.snow.sourceGameFile}.`
        : `Uses the falling-snow effects from Forbidden Temple (Fire & Ice) in place of this arena’s own effects: ${snow.snow.gameFile} is replaced by ${snow.snow.sourceGameFile}.`),
      h('button', { class: 'btn primary lg push', disabled: !snow, onclick: () => run(() => api('snowArena', lab.snow), queuedMsg) }, S.running ? 'Queue snow' : 'Add snow'),
      h('p', { class: 'muted small' }, 'Arenas that are not in this list have no snowy version and no separate effects part, so there is nowhere to put snow.')));

  const mine = [...S.engine.queue.filter((q) => q.op && q.op.kind === 'copy').map((q) => ({ q, op: q.op })), ...S.engine.active.filter((r) => r.op.kind === 'copy').map((r) => ({ r, op: r.op }))];
  root.append(tile('s12', head('Changed arenas', h('span', { class: 'tag' }, mine.length)),
    mine.length ? h('div', { class: 'list' }, mine.map(({ q, r, op }) => h('div', { class: 'item' }, art(op.label, 'maps'),
      h('div', { class: 'grow' }, h('b', {}, op.label), h('div', { class: 'muted small' }, `${op.gameFile} ← ${op.sourceGameFile}`)),
      q && h('span', { class: 'tag' }, 'Queued'),
      q ? h('button', { class: 'btn sm', onclick: () => run(() => api('unqueue', q.key)) }, 'Cancel')
        : h('button', { class: 'btn sm', onclick: () => run(() => api('revert', r.key), S.running ? 'Revert queued until the game closes.' : 'Original arena restored.') }, 'Revert'))))
      : h('p', { class: 'muted' }, 'Nothing changed. Your arenas are original.')));
  return root;
};

/* ---------- presets ---------- */

views.presets = () => {
  const name = field({ class: 'grow', placeholder: 'Name this setup', maxlength: 40 });
  const paste = field({ class: 'grow', placeholder: 'Paste a preset code' });
  const list = S.settings.presets, n = S.engine.active.length;
  const root = bento(
    tile('s7', head('Save current setup'), h('p', { class: 'muted' }, n ? `${plural(n, 'change')} active right now.` : 'Nothing is active yet. Apply a swap or a map first.'),
      h('div', { class: 'row push' }, name, h('button', { class: 'btn primary', disabled: !n, onclick: () => run(() => api('presetSave', name.value), 'Preset saved.') }, 'Save'))),
    tile('s5', head('Import'), h('p', { class: 'muted' }, 'Paste a preset code to add that setup.'),
      h('div', { class: 'row push' }, paste, h('button', { class: 'btn', onclick: () => run(() => api('presetImport', paste.value), 'Preset imported.') }, 'Import'))));
  root.append(list.length ? list.map((p) => tile('card',
    h('div', { class: 'row' }, art(p.name, 'presets'), h('div', { class: 'grow' }, h('b', { class: 'clip' }, p.name), h('div', { class: 'muted small' }, `${plural(p.ops.length, 'change')} · ${new Date(p.savedAt).toLocaleDateString()}`))),
    h('p', { class: 'muted small' }, p.ops.slice(0, 4).map((o) => o.label).join(' · ') || 'Empty'),
    h('div', { class: 'row wrap push' },
      h('button', { class: 'btn primary grow', onclick: () => run(() => api('presetLoad', p.id), (r) => (r.errors.length ? `Loaded with ${plural(r.errors.length, 'problem')}: ${r.errors[0]}` : 'Preset loaded.')) }, 'Load'),
      h('button', { class: 'btn', onclick: async () => { await navigator.clipboard.writeText(await api('presetExport', p.id)); toast('Preset code copied.'); } }, 'Copy code'),
      h('button', { class: 'btn danger', onclick: () => run(() => api('presetDelete', p.id)) }, 'Delete'))))
    : tile('s12', empty('presets', 'No presets yet', 'Set your car up the way you like, then save it here.')));
  return root;
};

/* ---------- overlay: music and controller over the game ---------- */

let media = { found: false }; // what Windows says is playing (see main/media.js)
let sources = null;           // music apps that can be followed
let overlayUI = null;         // handles of the mounted Overlay page
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const mediaNow = () => Math.max(0, Math.min(media.duration || 0, media.position + (media.playing ? (Date.now() - media.updated) / 1000 : 0)));
const ANCHORS = [['tl', 'Top left'], ['tc', 'Top centre'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['bc', 'Bottom centre'], ['br', 'Bottom right']];
const PAD_LOOKS = [
  ['White', '#f2f3f5', '#1b1c21'], ['Black', '#1d1f24', '#3a3d46'], ['Grey', '#8d929d', '#1b1c21'], ['Red', '#c8102e', '#1b1c21'],
  ['Blue', '#1f6feb', '#101826'], ['Purple', '#7c4dff', '#17122b'], ['Pink', '#f472b6', '#2a1420'], ['Gold', '#d4a72c', '#1b1c21'],
];
const GLOWS = ['#00d8c8', '#38bdf8', '#818cf8', '#f472b6', '#fb7185', '#fb923c', '#facc15', '#a3e635', '#ffffff'];

views.overlay = () => {
  const o = S.settings.overlay, moving = S.overlayMove;
  const upd = (kind, patch) => set('overlay', { ...o, [kind]: { ...o[kind], ...patch } });
  if (!sources) api('mediaSources').then((list) => { sources = list; if (ui.tab === 'overlay') render(); });
  const place = (kind) => h('div', { class: 'opt-row' }, h('div', { class: 'grow' }, h('b', {}, 'Position'), h('div', { class: 'muted small' }, o[kind].x == null ? 'Default place. Pick a corner, or use Move overlays to drag it.' : `Custom: ${o[kind].x}, ${o[kind].y}`)),
    select([['', o[kind].x == null ? 'Default' : 'Custom'], ...ANCHORS, ...(o[kind].x == null ? [] : [['reset', 'Back to default']])], '', (anchor) => anchor && run(() => api('overlayAnchor', kind, anchor)), 170));
  const sizeRow = (kind, min, max) => { const label = h('div', { class: 'muted small' }, `${o[kind].size}%`); return h('div', { class: 'opt-row' }, h('div', { style: 'width:120px' }, h('b', {}, 'Size'), label), slider(min, max, o[kind].size, (v) => upd(kind, { size: v }), (v) => { label.textContent = `${v}%`; })); };

  // --- music ---
  const cover = h('div', { class: 'cover sm' }), name = h('b', { class: 'clip' }), artist = h('div', { class: 'muted small clip' }), fill = h('i'), time = h('span', { class: 'muted small' });
  const press = (action) => () => {
    if (action === 'toggle' && media.found) { media = { ...media, position: mediaNow(), updated: Date.now(), playing: !media.playing }; paint(); } // show it at once
    api('mediaControl', action);
  };
  const playBtn = h('button', { class: 'btn sm primary grow', onclick: press('toggle') });
  const tick = () => { fill.style.width = media.found && media.duration ? `${(mediaNow() / media.duration) * 100}%` : '0'; time.textContent = media.found && media.duration ? `${clock(mediaNow())} / ${clock(media.duration)}` : ''; };
  function paint() {
    cover.replaceChildren(media.found && media.art ? h('img', { src: media.art, alt: '' }) : icon('anthems', 26));
    name.textContent = media.found ? media.title : 'Nothing is playing';
    artist.textContent = media.found ? [media.artist, media.source].filter(Boolean).join(' · ') : 'Start a song in any music app on this PC.';
    playBtn.textContent = media.found && media.playing ? 'Pause' : 'Play';
    tick();
  }
  const musicTile = tile(`s6${o.music.on ? ' ink' : ''}`, head('Now playing', toggle(o.music.on, (v) => upd('music', { on: v }))),
    h('p', { class: 'muted' }, 'A small pill over the game with the track, artist and progress.'),
    h('div', { class: 'nowcard' }, cover, h('div', { class: 'col grow', style: 'gap:3px' }, name, artist, h('div', { class: 'progress' }, fill), time)),
    h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: press('prev') }, 'Previous'), playBtn, h('button', { class: 'btn sm', onclick: press('next') }, 'Next')),
    h('div', { class: 'opt-row' }, h('div', { class: 'grow' }, h('b', {}, 'Music app'), h('div', { class: 'muted small' }, 'Follow one app, or whichever is playing.')),
      select((sources || [{ id: 'auto', name: 'Any app (whatever is playing)' }]).map((s) => [s.id, s.name]), o.music.source, (v) => upd('music', { source: v }), 250)),
    sizeRow('music', 70, 160), place('music'));

  // --- controller ---
  const preview = Pad.mount(h('div', { class: 'padpreview' }));
  Pad.style(preview, o.pad);
  const look = PAD_LOOKS.find(([, body, keys]) => body === o.pad.body && keys === o.pad.keys);
  const opacityLabel = h('div', { class: 'muted small' }, `${o.pad.opacity}%`);
  const padTile = tile(`s6${o.pad.on ? ' ink' : ''}`, head('Controller', toggle(o.pad.on, (v) => upd('pad', { on: v }))),
    h('p', { class: 'muted' }, 'Shows every button, trigger and stick you press. Press something on your controller to try it here.'),
    preview,
    h('div', { class: 'opt-row' }, h('div', { class: 'grow' }, h('b', {}, 'Colour'), h('div', { class: 'muted small' }, 'The shell and its buttons.')),
      select(PAD_LOOKS.map(([label]) => [label, label]).concat(look ? [] : [['', 'Custom']]), look ? look[0] : '', (v) => { const pick = PAD_LOOKS.find(([label]) => label === v); if (pick) upd('pad', { body: pick[1], keys: pick[2] }); }, 170)),
    h('div', { class: 'opt-row' }, h('div', { class: 'grow' }, h('b', {}, 'Pressed colour'), h('div', { class: 'muted small' }, 'What a button lights up in.')),
      h('div', { class: 'swatches' }, GLOWS.map((c) => h('button', { class: `swatch${o.pad.glow === c ? ' on' : ''}`, style: `background:${c}`, 'aria-label': c, onclick: () => upd('pad', { glow: c }) })))),
    h('div', { class: 'opt-row' }, h('div', { style: 'width:120px' }, h('b', {}, 'Opacity'), opacityLabel),
      slider(20, 100, o.pad.opacity, (v) => upd('pad', { opacity: v }), (v) => { opacityLabel.textContent = `${v}%`; Pad.style(preview, { ...o.pad, opacity: v }); })),
    sizeRow('pad', 50, 200), place('pad'));

  overlayUI = { paint, tick, preview, root: padTile };
  paint();
  return bento(
    tile('s12 bar', h('div', { class: 'grow' }, h('b', {}, 'Only while playing Rocket League'), h('div', { class: 'muted small' }, 'Overlays appear when Rocket League is the window in front, and hide when you tab out.')),
      toggle(o.onlyInGame, (v) => set('overlay', { ...o, onlyInGame: v })),
      h('button', { class: 'btn', onclick: () => { api('overlayPreview'); toast('Showing overlays for 8 seconds.'); } }, 'Show for 8 seconds'),
      h('button', { class: `btn${moving ? ' primary' : ''}`, onclick: () => run(() => api('overlayMove', !moving), moving ? 'Positions saved.' : 'Drag the overlays where you want them, then press Done.') }, moving ? 'Done moving' : 'Move overlays')),
    musicTile, padTile,
    noteTile('info', 's12', 'Overlays are separate click-through windows drawn on top of the game, so Rocket League must run in borderless or windowed mode. They do not read or change the game. Music comes from Windows’ own media controls, so anything that appears in the Windows volume flyout works: Spotify, Apple Music, TIDAL, Deezer, Amazon Music, YouTube Music and SoundCloud in a browser, VLC, foobar2000 and more.'));
};

const overlayLive = () => ui.tab === 'overlay' && overlayUI && overlayUI.root.isConnected;
window.boostpad.on('media', (state) => { media = state; if (overlayLive()) overlayUI.paint(); });
api('mediaState').then((state) => { media = state; if (overlayLive()) overlayUI.paint(); });
setInterval(() => { if (overlayLive()) overlayUI.tick(); }, 500);
(function padLoop() { if (overlayLive()) Pad.update(overlayUI.preview, Pad.first()); requestAnimationFrame(padLoop); }());

/* ---------- profile ---------- */

function profileCard(p) {
  const glow = p.glow ? `text-shadow:0 0 14px ${p.titleColor}` : '';
  return h('div', { class: 'pcard' },
    p.avatar ? h('img', { src: p.avatar, alt: '' }) : h('div', { class: 'ph' }, (p.name || '?')[0].toUpperCase()),
    h('div', { class: 'col', style: 'gap:4px' }, h('div', { class: 'pname clip' }, p.name || 'Your name'),
      h('div', { class: 'ptitle', style: `color:${p.titleColor};${glow}` }, p.title || 'Your title'),
      p.rank && h('span', { class: 'tag', style: 'align-self:flex-start' }, p.rank)));
}

views.profile = () => {
  const p = S.settings.profile, upd = (patch) => set('profile', { ...p, ...patch });
  return bento(
    tile('s5', head('Your card'), profileCard(p),
      h('p', { class: 'muted small push' }, 'This card lives in Boostpad. It does not change your name, title or rank inside Rocket League: that would need code injected into the running game, which Boostpad does not do.')),
    tile('s7', head('Edit'), h('div', { class: 'fields' },
      h('b', {}, 'Name'), field({ maxlength: 24, value: p.name, onchange: (e) => upd({ name: e.target.value }) }),
      h('b', {}, 'Title'), field({ maxlength: 32, value: p.title, onchange: (e) => upd({ title: e.target.value }) }),
      h('b', {}, 'Title colour'), h('div', { class: 'swatches' }, COLORS.map((c) => h('button', { class: `swatch${p.titleColor === c ? ' on' : ''}`, style: `background:${c}`, 'aria-label': c, onclick: () => upd({ titleColor: c }) }))),
      h('b', {}, 'Glow'), h('div', {}, toggle(p.glow, (v) => upd({ glow: v }))),
      h('b', {}, 'Rank badge'), h('div', {}, select(RANKS.map((r) => [r, r || 'None']), p.rank, (v) => upd({ rank: v }), 220)),
      h('b', {}, 'Picture'), h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => run(async () => { const a = await api('pickAvatar'); return a ? api('setSetting', 'profile', { ...p, avatar: a }) : null; }) }, 'Choose picture'),
        p.avatar && h('button', { class: 'btn danger', onclick: () => upd({ avatar: '' }) }, 'Remove')))));
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
    tile('s7', head('Item pictures and keys', h('span', { class: `tag${S.keys ? ' on' : ''}` }, S.keys ? `${S.keys.toLocaleString()} extra keys loaded` : 'Built-in key only')),
      h('p', { class: 'muted' }, 'Rocket League encrypts item packages with many different keys. Boostpad includes one, which opens about two thirds of items. Items it cannot open show a lock and cannot be used as a new look. Add a key list (a keys.txt, one key per line) to open the rest.'),
      h('div', { class: 'row wrap push' },
        h('button', { class: 'btn primary', onclick: () => run(async () => { const res = await api('importKeys'); catalog = null; arenas = null; return res; }, (r) => (r.keys ? `${r.keys.toLocaleString()} keys loaded. Pictures are being re-read.` : 'No change.')) }, S.keys ? 'Replace key list' : 'Add key list'),
        S.keys ? h('button', { class: 'btn danger', onclick: () => run(async () => { const res = await api('removeKeys'); catalog = null; arenas = null; return res; }, 'Key list removed.') }, 'Remove') : null)),
    tile('s5', head('Data'), h('p', { class: 'muted' }, 'Backups, maps and settings live in the data folder.'),
      h('div', { class: 'row wrap push' },
        h('button', { class: 'btn', onclick: () => api('openDataFolder') }, 'Open data folder'),
        h('button', { class: 'btn danger', disabled: !S.engine.active.length, onclick: () => run(() => api('revertAll'), 'Everything reverted.') }, 'Revert every change'))),
    noteTile('warn', 's12', `Boostpad v${S.version} changes files in your Rocket League folder and backs up each one first. Rocket League runs with Easy Anti-Cheat; Boostpad does not touch or work around it and cannot promise that changed files are accepted online. Changing game files may break the game’s terms of service and could put your account at risk, so use it at your own risk. Your launcher’s “Verify files” always restores a clean install. Free and open source; not affiliated with Psyonix or Epic Games.`));
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
