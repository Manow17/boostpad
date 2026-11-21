/* OpenW renderer. No framework: a small element helper, a few custom controls,
   and one function per page that returns a bento grid of tiles. */
const api = (method, ...args) => window.openw.call(method, ...args);

let S = null;          // latest snapshot from the main process
let catalog = null;    // item catalog, loaded on first use
const ui = { tab: location.hash.slice(1) || 'garage', cat: 'cars', q: '', slot: 'src', src: null, dst: null, check: null, only: true, packType: 'all' };

const PAGES = {
  garage: ['Garage', 'Give an item you own the look of another. Only you see it.'],
  maps: ['Workshop Maps', 'Training and challenge maps, on Steam or Epic.'],
  lab: ['Map Merge', 'Mix the game’s own arenas, and add snow.'],
  controller: ['Controller', 'OpenW Input: Steam-style stick, trigger and button settings for any controller.'],
  presets: ['Presets', 'Save your whole setup and switch in one click.'],
  overlay: ['Overlay', 'Your music and your controller, over the game.'],
  profile: ['Profile', 'Your OpenW card.'],
  settings: ['Settings', ''],
};
const NAV = [
  [['garage', 'cars'], ['maps', 'maps'], ['lab', 'merge'], ['presets', 'presets']],
  [['controller', 'stick'], ['overlay', 'overlay']],
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
  stick: 'M12 3a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7z M12 10v5 M5 15h14l-1.5 6h-11z',
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

function slider(min, max, value, onchange, oninput, step = 1) {
  const el = h('input', { type: 'range', class: 'slider grow', min, max, step, value });
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
  const current = options.find(([v]) => v === value) || options[0] || [null, 'Loading…'];
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

  const [name, sub] = ready ? PAGES[ui.tab] : ['OpenW', ''];
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
    nav.append(h('div', { class: 'brand' }, mark(32), 'OPENW'), list,
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
  // the badge sits on the Garage, so it counts item swaps only
  const pending = S.engine.active.filter((r) => r.op.kind === 'swap').length + S.engine.queue.filter((q) => !q.op || q.op.kind === 'swap').length;
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
    tile('s12 hero ink', mark(72), h('h1', {}, 'Where do you play?'), h('p', { class: 'muted' }, 'Pick your launcher and OpenW finds Rocket League for you.')),
    choose('steam', 'Steam'), choose('epic', 'Epic Games'),
    noteTile('info', 's12', 'OpenW only changes files on your own PC and backs up every file it touches. It is a fan project, not affiliated with Psyonix or Epic Games.')));
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
  // a lock means the package needs a key OpenW does not have (see Settings)
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
  if (!target.ok) return 'This look uses a newer package key that OpenW cannot read.';
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
    // under the name: the car a decal is made for
    return h('button', { class: `cell${blocked ? ' no' : ''}`, 'data-id': i.id, style: n < 24 && `--i:${n}`, 'aria-label': i.label, onclick: () => pickItem(i, ui.slot) },
      picture(i, i.category), h('span', { class: 'name' }, i.label), i.sub && h('span', { class: 'sub' }, i.sub));
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
  // A section only ever lists its own items. When a search also matches items in
  // other sections, they are offered here as links instead of being mixed in.
  const elsewhere = h('div', { class: 'elsewhere' });
  const jump = (id) => () => { ui.cat = id; ui.src = ui.dst = ui.check = null; ui.slot = 'src'; popGrid = true; render(); }; // keeps the search text
  function paintElsewhere(q, here) {
    const found = {};
    if (q && !picking()) for (const i of catalog.items) if (i.category !== ui.cat && i.search.includes(q)) found[i.category] = (found[i.category] || 0) + 1;
    const others = catalog.categories.filter((c) => found[c.id]);
    elsewhere.hidden = !others.length && !(q && !here);
    elsewhere.replaceChildren(
      h('span', { class: 'muted small' }, !others.length ? `Nothing called “${ui.q.trim()}” in any section.` : here ? 'Also found in' : `Nothing in ${catalog.catLabel[ui.cat]} called “${ui.q.trim()}”. Found in`),
      ...others.map((c) => h('button', { class: 'chip', onclick: jump(c.id) }, icon(c.id, 15), c.label, h('small', {}, found[c.id]))));
  }
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
    list = pool().filter((i) => !q || i.search.includes(q));
    const total = list.length;
    paintElsewhere(q, total);
    const works = picking() ? list.filter((i) => canSwap(ui.src, i)).length : total;
    if (picking() && ui.only) list = list.filter((i) => canSwap(ui.src, i) || i === ui.src);
    // best matches first when searching (name starts with the text), then items with a readable picture
    const rank = (i) => (q && i.label.toLowerCase().startsWith(q) ? 0 : 1);
    list.sort((a, b) => (rank(a) - rank(b)) || (b.ok - a.ok) || a.label.localeCompare(b.label));
    grid.replaceChildren();
    shown = 0;
    more();
    count.textContent = picking() ? `${works} of ${total} looks work with ${ui.src.label}` : plural(total, 'item');
    only.replaceChildren(...(picking() ? [toggle(ui.only, (v) => { ui.only = v; fill(); }), 'Only looks that work'] : []));
  }
  garage = { paintBar, fill, mark, io };
  paintBar();
  fill();

  // Everything OpenW has put in the game, or will when it closes, with a way back.
  const changes = [...S.engine.queue.filter((q) => !q.op || q.op.kind === 'swap').map((q) => ({ q, op: q.op })), ...S.engine.active.filter((r) => r.op.kind === 'swap').map((r) => ({ r, op: r.op }))];
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
        field({ placeholder: `Search ${catalog.catLabel[ui.cat].toLowerCase()}`, value: ui.q, oninput: (e) => { ui.q = e.target.value; fill(); } })),
      only, h('span', { class: 'grow' }), count),
      elsewhere, grid, sentinel));
  return root;
};

async function pickItem(item, which) {
  if (!item) return;
  ui[which] = item;
  ui.check = null;
  if (which === 'src') {
    ui.slot = 'dst';
    if (ui.dst && (ui.dst.category !== item.category || !canSwap(item, ui.dst))) ui.dst = null;
    // picked from a search: clear it, so the looks to choose from are not filtered by it
    if (ui.q) { ui.q = ''; render(); return; }
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
  root.append(...maps.map((m) => {
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
const lab = { donor: null, base: null, snow: null, every: null };
const gb = (bytes) => `${(bytes / 1e9).toFixed(1)} GB`;
// The arenas that show a changed file: the arena itself, or every arena that loads that part.
const shownIn = (gameFile) => arenas.filter((a) => a.file.toLowerCase() === gameFile.toLowerCase() || a.parts.some((p) => p.file.toLowerCase() === gameFile.toLowerCase()));
const playHint = (list) => (list.length ? `Play ${list.map((a) => a.name).join(' or ')} to see it.` : '');

views.lab = () => {
  const root = bento(noteTile('warn', 's12', 'Experimental. Merges sort every piece of both arenas into stadium or outside by name and position, so an odd piece can land on the wrong side; tell us which. Only you see the result, and every change can be reverted below. To pick an arena yourself, use Free Play, Exhibition or a Private Match.'));
  if (!arenas) {
    api('arenas').then((list) => { arenas = list; if (ui.tab === 'lab') render(true); });
    root.append(tile('s12', empty('maps', 'Reading the arenas', 'Finding the parts each arena is built from.')));
    return root;
  }
  const byId = (id) => arenas.find((a) => a.id === id);
  // the lists for "every match" and "snow" include your merged arenas; asked again whenever something changes
  const stamp = [...S.engine.active.map((r) => `${r.key}:${r.op.label}`), ...S.engine.queue.map((q) => `${q.key}:${q.type}`)].join('|');
  if (lab.choicesFor !== stamp) {
    lab.choicesFor = stamp;
    api('arenaChoices').then((c) => { if (lab.choicesFor === stamp) { lab.choices = c; if (ui.tab === 'lab') render(true); } }).catch(() => {});
  }
  const choices = lab.choices || { every: [], snow: [], noSnow: [] };
  const mergedTag = (c) => (c.merged ? `${c.label} · your merge` : c.label);
  // every standard soccar arena: they all have the same pitch, so any two can be merged
  const split = arenas.filter((a) => a.standard), standard = arenas.filter((a) => a.standard);
  lab.donor ??= (split.find((a) => a.field) || split[0] || {}).id;
  lab.base ??= (split.filter((a) => a.field)[1] || split[1] || {}).id;
  // how the chosen pair would be merged, asked of the main process once per pair
  const pairKey = `${lab.donor}>${lab.base}`;
  if (lab.planFor !== pairKey) {
    lab.planFor = pairKey;
    lab.plan = null;
    api('mergePlan', lab.donor, lab.base).then((p) => { if (lab.planFor === pairKey) { lab.plan = p; if (ui.tab === 'lab') render(true); } }).catch(() => {});
  }
  const plan = lab.plan;
  if (!choices.snow.some((c) => c.id === lab.snow)) lab.snow = (choices.snow[0] || {}).id;
  if (!choices.every.some((c) => c.id === lab.every)) lab.every = ((choices.every.find((c) => c.id === 'stadium_p') || choices.every[0]) || {}).id;
  const donor = byId(lab.donor), base = byId(lab.base);
  const snow = choices.snow.find((c) => c.id === lab.snow), every = choices.every.find((c) => c.id === lab.every);
  const options = (list) => list.map((a) => [a.id, a.name]);
  const choose = (key) => (id) => { lab[key] = id; render(); };

  // "same arena every match": what is on now, and what it would cost on disk
  const everyOn = S.engine.active.filter((r) => r.op.group === 'everymatch');
  const everyQueued = S.engine.queue.filter((q) => q.op && q.op.group === 'everymatch');
  const current = (everyOn[0] || everyQueued[0] || {}).op;
  const currentId = current && (current.chosen || (arenas.find((a) => a.file === current.sourceGameFile) || {}).id);
  const currentName = current && (current.label.replace(/ in place of .*$/, ''));
  const targets = every ? standard.filter((a) => a.id !== every.id) : [];

  root.append(
    tile('s12 ink', head('Same arena every match', current && h('span', { class: 'tag on' }, everyQueued.length ? 'Queued' : 'On')),
      h('p', { class: 'muted' }, 'Whatever arena a match is played in, you see the one you pick here: online, offline and in Free Play. Everyone else still sees the real arena. All standard arenas have the same pitch, so the ball, walls and goals line up.'),
      h('div', { class: 'row wrap' },
        select(choices.every.map((c) => [c.id, mergedTag(c)]), lab.every, choose('every'), 360),
        h('button', { class: 'btn primary', disabled: !every || (currentId === lab.every && !everyQueued.length) || !!lab.busy,
          onclick: () => busy('every', () => run(() => api('everyMatch', lab.every), (r) => (r.queued ? `Queued: ${every.label} goes in when Rocket League closes.` : `Every match now shows ${every.label}.`))) },
        lab.busy === 'every' ? 'Writing arenas…' : current ? 'Switch to this arena' : 'Use in every match'),
        current && h('button', { class: 'btn', onclick: () => run(() => api('everyMatchOff'), S.running ? 'Turning it off when the game closes.' : 'Your arenas are back to normal.') }, 'Turn off')),
      every && every.merged && h('p', { class: 'small' }, `Your merge comes along: every match shows ${every.label}. If you revert that merge later, pick it here again.`),
      h('p', { class: 'muted small' }, current
        ? `Now: ${currentName} in every match (${everyOn.length} arenas replaced${everyQueued.length ? `, ${everyQueued.length} waiting for the game to close` : ''}).`
        : every ? `Replaces up to ${targets.length} arena files. The originals are backed up first, which takes about ${gb(targets.reduce((s, a) => s + a.size, 0))} of disk space until you turn it off.` : ''),
      h('p', { class: 'muted small' }, 'Arenas you merged or snowed yourself keep your change. Rocket Labs, Hoops, Dropshot, Snow Day, Knockout and the odd-shaped arenas (Badlands, Tokyo Underpass, ARCtagon) are left as they are.')),
    tile('s7', head('Merge two arenas', h('span', { class: 'tag' }, `${split.length} arenas`)),
      h('p', { class: 'muted' }, 'Puts the stadium of one arena (pitch, walls, goals and stands) in the surroundings of another. Any two soccar arenas can be picked; Hoops, Dropshot, Snow Day and odd-shaped arenas have a different pitch and are left out.'),
      h('div', { class: 'fields' },
        h('b', {}, 'Stadium from'), select(options(split), lab.donor, choose('donor'), 300),
        h('b', {}, 'Placed in'), select(options(split), lab.base, choose('base'), 300)),
      donor && base && mergeHow(plan, donor, base),
      h('button', { class: 'btn primary lg push', disabled: !plan || plan.how === 'none' || !!lab.busy,
        onclick: () => busy('merge', () => run(() => api('mergeArenas', lab.donor, lab.base), (r) => `${r.queued ? 'Queued.' : 'Merged.'} ${playHint(r.play.map((name) => ({ name })))}`)) },
      lab.busy === 'merge' ? 'Taking both arenas apart… (a few seconds)' : S.running ? 'Queue merge' : 'Merge')),
    tile('s5', head('Add snow', h('span', { class: 'tag' }, `${choices.snow.length} arenas`)),
      h('p', { class: 'muted' }, 'Falling snow is only in the game’s four snowy arenas, so an arena built on DFH Stadium, Mannfield, Beckwith Park or Utopia Coliseum can become its snowy version. Merged arenas cannot: the snowy version would replace the merge.'),
      select(choices.snow.map((c) => [c.id, mergedTag(c)]), lab.snow, choose('snow')),
      snow && h('p', { class: 'muted small' }, `Plays ${snow.snowy} in its place${snow.merged ? ', and keeps your merge' : ''}.`),
      snow && h('p', { class: 'small' }, h('b', {}, playHint(snow.play.map((name) => ({ name }))))),
      choices.noSnow && choices.noSnow.length > 0 && h('p', { class: 'muted small' }, `${choices.noSnow.join(', ')}: no snow, because the snowy version would replace the files your merge changed. For snowy surroundings, merge a stadium into Forbidden Temple (Fire & Ice).`),
      h('button', { class: 'btn primary lg push', disabled: !snow, onclick: () => run(() => api('snowArena', lab.snow), (r) => `${r.queued ? 'Queued.' : 'Snow added.'} ${playHint(snow.play.map((name) => ({ name })))}`) }, S.running ? 'Queue snow' : 'Add snow')));

  // merges and snow, one row each (a merge of several files is one row); "every match" is the tile above
  const rows = new Map();
  const add = (op, key, queued) => {
    const id = op.group || key;
    const row = rows.get(id) || { id, op, keys: [], queued: false };
    if (!row.keys.includes(key)) row.keys.push(key);
    // a merge is shown by its arena's own file, not by the files it adds
    if (row.op.create && !op.create) row.op = op;
    row.queued ||= queued;
    rows.set(id, row);
  };
  const arenaChange = (op) => op && op.category === 'map' && (op.kind === 'copy' || op.kind === 'build') && op.group !== 'everymatch';
  for (const q of S.engine.queue) if (arenaChange(q.op)) add(q.op, q.key, true);
  for (const r of S.engine.active) if (arenaChange(r.op)) add(r.op, r.key, false);
  const mine = [...rows.values()];
  const undo = (row) => (row.op.group ? api('revertGroup', row.op.group)
    : row.queued ? api('unqueue', row.keys[0]) : api('revert', row.keys[0]));
  root.append(tile('s12', head('Changed arenas', h('span', { class: 'tag' }, mine.length)),
    mine.length ? h('div', { class: 'list' }, mine.map((row) => h('div', { class: 'item' }, art(row.op.label, 'maps'),
      h('div', { class: 'grow' }, h('b', {}, row.op.label), h('div', { class: 'small' }, playHint(shownIn(row.op.gameFile)) || row.op.gameFile)),
      row.queued && h('span', { class: 'tag' }, 'Queued'),
      h('button', { class: 'btn sm', onclick: () => run(() => undo(row), S.running ? 'Undone when the game closes.' : 'Original arena restored.') }, row.queued ? 'Cancel' : 'Revert'))))
      : h('p', { class: 'muted' }, 'Nothing merged or snowed. Your arenas are original.')));
  return root;
};

// A slow Map Merge action: its button says it is working, and the others wait.
async function busy(what, fn) {
  lab.busy = what;
  render();
  try { return await fn(); } finally { lab.busy = null; render(); }
}

// What a merge of the chosen pair will do, in words.
function mergeHow(plan, donor, base) {
  if (donor.id === base.id) return h('p', { class: 'small' }, 'Pick two different arenas.');
  if (!plan) return h('p', { class: 'muted small' }, 'Working out how…');
  if (plan.how === 'none') return h('p', { class: 'small' }, plan.reason);
  const files = plan.files > 1 ? ` (${plan.files} files)` : '';
  const how = {
    stadium: `Both arenas keep their stadium in a separate file, so ${donor.name}’s stadium is put straight into ${base.name}.`,
    surroundings: `${donor.name} keeps its stadium and gets ${base.name}’s surroundings around it${files}. Anything built into ${donor.name}’s own file, like a skyline, stays as well.`,
    build: `OpenW takes both maps apart piece by piece: only ${donor.name}’s stadium (pitch, walls, stands, crowd) is kept, and only ${base.name}’s outside, sky and fog around it${files}. Each arena’s stadium is measured from where its stands are.`,
    whole: `${[donor, base].find((a) => !a.field) === donor ? donor.name : base.name} has its stadium built into its main file, so these two cannot be taken apart and put back together. Instead, all of ${donor.name} is played whenever you pick ${base.name}.`,
  }[plan.how];
  return h('div', {},
    h('p', { class: 'muted small' }, how),
    h('p', { class: 'small' }, h('b', {}, playHint(plan.play.map((name) => ({ name }))))),
    plan.note && h('p', { class: 'muted small' }, plan.note));
}

/* ---------- controller ---------- */

/* ---------- controller: OpenW Input ---------- */

// The real controller is read by OpenW's helper, run through these settings, and played on a
// virtual Xbox controller (main/input.js, native/openw-input.cpp). The maths for the previews
// is the helper's own, in shared/transform.js.
const TX = window.OpenWTransform;
const PAD_NAMES = { xinput: 'Xbox controller', ds4: 'DualShock 4', dualsense: 'DualSense', edge: 'DualSense Edge' };
const CURVE_OPTS = [['linear', 'Linear'], ['aggressive', 'Aggressive'], ['relaxed', 'Relaxed'], ['wide', 'Wide'], ['extrawide', 'Extra Wide'], ['custom', 'Custom']];
const SIDES = [['left', 'Left'], ['right', 'Right'], ['none', 'None']];
const SHAPE_TEXT = {
  circle: 'Round dead zone; the stick keeps its round range.',
  cross: 'Each axis has its own dead zone, so straight lines stay straight.',
  square: 'Diagonals reach full on both axes, like a square gate.',
};
// [Xbox name, PlayStation name]
const SRC_LABEL = {
  A: ['A', 'Cross'], B: ['B', 'Circle'], X: ['X', 'Square'], Y: ['Y', 'Triangle'], LB: ['LB', 'L1'], RB: ['RB', 'R1'],
  LS: ['Left stick click', 'L3'], RS: ['Right stick click', 'R3'], Back: ['View', 'Share / Create'], Start: ['Menu', 'Options'], Guide: ['Xbox button', 'PS button'],
  Up: ['D-pad up'], Down: ['D-pad down'], Left: ['D-pad left'], Right: ['D-pad right'],
  Touchpad: ['Touchpad click'], Mute: ['Mute button'], FnL: ['Left Fn'], FnR: ['Right Fn'], PaddleL: ['Left back paddle'], PaddleR: ['Right back paddle'],
};
const OUT_LABEL = { A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LS: 'Left stick click', RS: 'Right stick click', Back: 'View (Back)', Start: 'Menu (Start)', Guide: 'Xbox button',
  Up: 'D-pad up', Down: 'D-pad down', Left: 'D-pad left', Right: 'D-pad right', LT: 'Left trigger, full', RT: 'Right trigger, full' };
const OUT_OPTS = [['', 'Nothing'], ...Object.entries(OUT_LABEL)];
const HOLD_TIMES = [200, 300, 400, 500, 700, 1000].map((ms) => [ms, `${ms} ms`]);
const TURBO_RATES = [5, 8, 10, 15, 20, 30].map((hz) => [hz, `${hz} a second`]);
const LIGHTS = ['#00d8c8', '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#facc15', '#16a34a', '#ffffff'];

const ctl = { section: 'left', info: null, hid: null, live: null, watching: false, ui: null, fake: {} };
const ctlLive = () => ui.tab === 'controller' && ctl.ui && ctl.ui.root.isConnected;
const curProfile = () => { const i = S.settings.input; return i.profiles.find((p) => p.id === i.profile) || i.profiles[0]; };
const padKind = () => (ctl.info && ctl.info.status.pad ? ctl.info.status.pad.kind : null);
const srcName = (src) => { const [xb, ps] = SRC_LABEL[src]; const k = padKind(); return !ps ? xb : k === 'xinput' ? xb : k ? ps : `${xb} / ${ps}`; };
function shownSources() {
  const k = padKind(), all = TX.SOURCES;
  if (k === 'xinput') return all.slice(0, 15);
  if (k === 'ds4') return all.slice(0, 16);
  return k === 'edge' ? all : all.slice(0, 17);
}
async function refreshInput() { ctl.info = await api('inputInfo'); if (ui.tab === 'controller') render(); }
// Installs drivers that came with OpenW. Windows asks for permission; failures throw (run() shows them).
async function installDrivers(list) {
  const names = { vigem: 'ViGEmBus', hidhide: 'HidHide' };
  toast(`Installing ${list.map((w) => names[w]).join(' and ')}. Windows asks for permission.`);
  const { results, info } = await api('inputInstallDrivers', list);
  ctl.info = info; ctl.hid = null;
  const failed = Object.entries(results).filter(([, r]) => r.startsWith('failed'));
  if (failed.length) throw new Error(`${failed.map(([w, r]) => `${names[w]} ${r}`).join(', ')}. Nothing else changed.`);
  if (Object.values(results).includes('restart')) toast('Installed. Restart Windows to finish it.');
  else toast('Installed.');
  if (ui.tab === 'controller') render();
}
window.openw.on('input-status', (st) => { if (ctl.info) { ctl.info.status = st; if (ui.tab === 'controller') render(); } });
window.openw.on('input-state', (st) => { ctl.live = st; if (ctlLive()) ctl.ui.draw(); });
// stop the live feed when the page is left
setInterval(() => { if (ctl.watching && !ctlLive()) { ctl.watching = false; api('inputWatch', false); } }, 1000);

// A canvas drawn at the screen's pixel density; ctx() clears it and works in CSS pixels.
function canvasEl(w, ht) {
  const dpr = window.devicePixelRatio || 1;
  const el = h('canvas', { width: Math.round(w * dpr), height: Math.round(ht * dpr), style: `width:${w}px;height:${ht}px` });
  el.ctx = () => { const c = el.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, ht); return c; };
  el.w = w; el.h = ht;
  return el;
}
const cssVar = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();

// The stick's square: dead zone, where the output can reach, your stick and what the game gets.
function drawStick(el, c, raw) {
  const g = el.ctx(), W = el.w, R = W / 2 - 14, cx = W / 2, cy = W / 2;
  const line = cssVar(el, '--line-2'), muted = cssVar(el, '--muted'), accent = cssVar(el, '--accent'), soft = cssVar(el, '--accent-soft');
  g.lineWidth = 1;
  g.strokeStyle = line; g.strokeRect(cx - R, cy - R, 2 * R, 2 * R);
  g.setLineDash([3, 4]); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke(); g.setLineDash([]);
  // where the output can reach: the round range run through the settings
  g.strokeStyle = accent; g.fillStyle = soft; g.lineWidth = 1.5; g.beginPath();
  for (let i = 0; i <= 144; i++) {
    const a = (i / 144) * Math.PI * 2, [x, y] = TX.stick(Math.cos(a), Math.sin(a), c);
    if (i) g.lineTo(cx + x * R, cy - y * R); else g.moveTo(cx + x * R, cy - y * R);
  }
  g.fill(); g.stroke();
  // dead zone
  g.fillStyle = 'rgba(251,113,133,.22)';
  if (c.shape === 1) { const d = c.inner * R; g.fillRect(cx - d, cy - R, 2 * d, 2 * R); g.fillRect(cx - R, cy - d, 2 * R, 2 * d); }
  else { g.beginPath(); g.arc(cx, cy, c.inner * R, 0, Math.PI * 2); g.fill(); }
  if (!raw) return;
  const [ox, oy] = TX.stick(raw[0], raw[1], c);
  g.strokeStyle = muted; g.lineWidth = 1; g.beginPath(); g.moveTo(cx + raw[0] * R, cy - raw[1] * R); g.lineTo(cx + ox * R, cy - oy * R); g.stroke();
  g.fillStyle = muted; g.beginPath(); g.arc(cx + raw[0] * R, cy - raw[1] * R, 6, 0, Math.PI * 2); g.fill();
  g.fillStyle = accent; g.beginPath(); g.arc(cx + ox * R, cy - oy * R, 7, 0, Math.PI * 2); g.fill();
}

// Input travel -> output, with the current travel marked.
function drawCurve(el, fn, at) {
  const g = el.ctx(), pad = 14, W = el.w - pad * 2, H = el.h - pad * 2;
  const line = cssVar(el, '--line-2'), accent = cssVar(el, '--accent'), muted = cssVar(el, '--muted');
  g.strokeStyle = line; g.lineWidth = 1; g.strokeRect(pad, pad, W, H);
  g.setLineDash([3, 4]); g.beginPath(); g.moveTo(pad, pad + H); g.lineTo(pad + W, pad); g.stroke(); g.setLineDash([]);
  g.strokeStyle = accent; g.lineWidth = 2; g.beginPath();
  for (let i = 0; i <= 120; i++) { const x = i / 120, y = fn(x); if (i) g.lineTo(pad + x * W, pad + H - y * H); else g.moveTo(pad + x * W, pad + H - y * H); }
  g.stroke();
  g.fillStyle = muted; g.font = '11px "DM Sans", sans-serif';
  g.fillText('in', pad + W - 14, pad + H - 5); g.fillText('out', pad + 5, pad + 13);
  if (at == null) return;
  const x = Math.min(1, at), y = fn(x);
  g.strokeStyle = muted; g.lineWidth = 1; g.beginPath(); g.moveTo(pad + x * W, pad); g.lineTo(pad + x * W, pad + H); g.stroke();
  g.fillStyle = accent; g.beginPath(); g.arc(pad + x * W, pad + H - y * H, 5, 0, Math.PI * 2); g.fill();
}

views.controller = () => {
  const root = bento();
  if (!ctl.info) {
    refreshInput().catch((e) => toast(String(e.message || e), true));
    root.append(tile('s12', empty('stick', 'Looking for your controller', 'Checking the drivers OpenW Input uses.')));
    return root;
  }
  const { status: st, drivers: dr } = ctl.info;
  const inp = S.settings.input, p = curProfile();
  if (st.running && !ctl.watching) { ctl.watching = true; api('inputWatch', true); }
  const drawers = [];
  ctl.ui = { root, draw: () => drawers.forEach((d) => d(ctl.live)) };

  // edits are saved and sent on; while a slider moves they are only sent
  const save = () => api('inputSave', p).catch((e) => toast(String(e.message || e), true));
  const preview = () => { api('inputPreview', p); ctl.ui.draw(); };
  const redo = () => { save(); render(); };
  const lbl = (title, sub, grow) => h('div', { class: `lbl${grow ? ' grow' : ''}` }, h('b', {}, title), sub && h('div', { class: 'muted small' }, sub));
  const valRow = (title, sub, obj, key, min, max, fmt = (v) => `${v}%`, step = 1) => {
    const val = h('span', { class: 'val' }, fmt(obj[key]));
    return h('div', { class: 'opt-row' }, lbl(title, sub),
      slider(min, max, obj[key], (v) => { obj[key] = v; save(); }, (v) => { obj[key] = v; val.textContent = fmt(v); preview(); }, step), val);
  };
  const choiceRow = (title, sub, control) => h('div', { class: 'opt-row' }, lbl(title, sub, true), control);
  const flip = (obj, key) => toggle(obj[key], (v) => { obj[key] = v; save(); preview(); });

  // --- on / off ---
  const own = inp.own !== false, ps = st.pad && st.pad.kind !== 'xinput';
  const padText = st.pad ? `${PAD_NAMES[st.pad.kind] || 'Controller'} over ${st.pad.conn === 'bt' ? 'Bluetooth' : 'USB'}${st.pad.access === 'own' ? ', hidden from games' : ''}.` : 'No controller found yet. Plug one in or connect it over Bluetooth.';
  const vText = st.vigem === false ? 'No virtual controller: ViGEmBus is not installed.' : st.vigem ? 'Virtual Xbox controller is on.' : 'Starting…';
  root.append(tile(`s12 bar${st.running ? ' ink' : ''}`, art('OpenW Input', 'stick'),
    h('div', { class: 'grow' }, h('b', {}, 'OpenW Input'), h('div', { class: 'muted small' }, st.running ? `${padText} ${vText}` : st.error || 'Off. Turn it on to play with these settings.')),
    toggle(st.running, (v) => run(async () => {
      if (v && !dr.vigem && dr.bundled && dr.bundled.vigem) await installDrivers(['vigem']); // first time: put the driver in
      const r = await api(v ? 'inputStart' : 'inputStop');
      ctl.info = await api('inputInfo');
      return r;
    }, v ? 'OpenW Input is on.' : 'OpenW Input is off.'))));

  if (!dr.vigem || !dr.helper) {
    const has = dr.bundled || {};
    const drv = (ok, title, text, which, optional) => h('div', { class: 'opt-row' }, h('span', { class: `tag${ok ? ' on' : optional ? '' : ' bad'}` }, ok ? 'Installed' : optional ? 'Optional' : 'Not installed'),
      lbl(title, text, true), !ok && has[which] && h('button', { class: `btn sm${optional ? '' : ' primary'}`, onclick: () => run(() => installDrivers([which])) }, 'Install'));
    root.append(tile('s12 ctl', head('Drivers', h('button', { class: 'btn sm', onclick: () => run(async () => { ctl.hid = null; await refreshInput(); }) }, 'Check again')),
      h('p', { class: 'muted' }, 'OpenW comes with the drivers it needs: nothing to download. Installing takes a few seconds, and Windows asks for permission once (no app can skip that for a driver). They are the free, signed drivers by Nefarius Software Solutions that DS4Windows uses; remove them any time under Windows Settings, Apps.'),
      drv(dr.vigem, 'ViGEmBus', 'Makes the virtual Xbox controller the game plays with. Needed; also installed when you first turn OpenW Input on.', 'vigem'),
      drv(dr.hidhide, 'HidHide', 'Only for Xbox controllers, or when another app keeps your controller open. PlayStation controllers can be hidden without it (Hide real controller).', 'hidhide', true),
      !dr.helper && h('p', { class: 'small' }, 'The input helper (bin/openw-input.exe) is missing from this copy of OpenW. Build it with npm run build-input.')));
  }
  if (inp.hidden.length && !st.running) {
    root.append(noteTile('warn', 's12', h('b', {}, 'Your controller is hidden from games'), h('p', {}, 'Only OpenW Input can see it, and OpenW Input is off. Turn it on to play, or show the controller again.'),
      h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => run(async () => { const r = await api('hidShow'); ctl.hid = null; return r; }, 'Your controller is visible again.') }, 'Show it again'))));
  } else if (st.running && st.pad && st.pad.access !== 'own' && !inp.hidden.length) {
    root.append(noteTile(st.vigem ? 'warn' : 'info', 's12', h('b', {}, 'Games can also see your real controller'),
      h('p', {}, ps && own ? 'Another app had it open before OpenW Input, so it could not be hidden. Close Steam (and anything else that reads controllers), then press Try again.'
        : ps ? 'Turn on Hide without a driver under Hide real controller, or games get every press twice.' : 'Xbox controllers can only be hidden with HidHide (Hide real controller), or games get every press twice.'),
      ps && own && h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => { api('inputReopen'); toast('Trying to take the controller again.'); } }, 'Try again'))));
  }

  // --- profiles ---
  // a pasted profile code is added on Enter
  const code = field({ placeholder: 'Paste a profile code', style: 'width:170px', onkeydown: (e) => { if (e.key === 'Enter' && code.value.trim()) run(() => api('inputImport', code.value), 'Profile added.'); } });
  root.append(tile('s12 bar', h('b', {}, 'Profile'),
    select(inp.profiles.map((x) => [x.id, x.name]), inp.profile, (v) => run(() => api('inputSelect', v)), 190),
    field({ value: p.name, maxlength: 40, style: 'width:150px', 'aria-label': 'Profile name', onchange: (e) => run(() => api('inputRename', p.id, e.target.value), 'Renamed.') }),
    select([['', 'New profile…'], ['standard', 'Standard'], ['square', 'Square dead zone'], ['precise', 'Precise']], '', (v) => v && run(() => api('inputNew', v), 'Profile added.'), 150),
    h('button', { class: 'btn sm', onclick: () => run(() => api('inputNew', '', p.id), 'Copy made.') }, 'Duplicate'),
    h('button', { class: 'btn sm', onclick: async () => { await navigator.clipboard.writeText(await api('inputExport', p.id)); toast('Profile code copied.'); } }, 'Copy code'),
    h('span', { class: 'grow' }), code,
    h('button', { class: 'btn sm danger', disabled: inp.profiles.length < 2, onclick: () => { if (window.confirm(`Delete the profile “${p.name}”?`)) run(() => api('inputDelete', p.id), 'Profile deleted.'); } }, 'Delete')));

  root.append(h('div', { class: 's12 secbar' }, seg([['left', 'Left stick'], ['right', 'Right stick'], ['triggers', 'Triggers'], ['buttons', 'Buttons'], ['feedback', 'Rumble and light'], ['hide', 'Hide real controller']],
    ctl.section, (v) => { ctl.section = v; render(); })));

  const tag = (off = 'Turn on to see it live') => h('span', { class: `tag${st.running ? ' on' : ''}` }, st.running ? 'Live' : off);
  const sec = ctl.section;
  if (sec === 'left' || sec === 'right') {
    const s = p.sticks[sec], i = sec === 'left' ? 0 : 1;
    const map = canvasEl(260, 260), curve = canvasEl(260, 140), read = h('div', { class: 'muted small mono' });
    map.classList.add('stickmap');
    const rawOf = (live) => (st.running && live ? [live.raw[i * 2], live.raw[i * 2 + 1]] : ctl.fake[sec] || null);
    drawers.push((live) => {
      const c = TX.stickCfg(s), raw = rawOf(live);
      drawStick(map, c, raw);
      const m = raw ? (c.shape === 1 ? Math.max(Math.abs(raw[0]), Math.abs(raw[1])) : Math.hypot(raw[0], raw[1])) : null;
      drawCurve(curve, (x) => TX.shapeMag(x, c), m);
      if (raw) { const [ox, oy] = TX.stick(raw[0], raw[1], c); read.textContent = `stick ${raw[0].toFixed(2)}, ${raw[1].toFixed(2)}  →  game ${ox.toFixed(2)}, ${oy.toFixed(2)}`; } else read.textContent = ' ';
    });
    // with OpenW Input off, drag in the square to see what the settings do
    const drag = (e) => {
      if (st.running || !(e.buttons & 1)) return;
      const r = map.getBoundingClientRect(), R = r.width / 2 - 14;
      let x = (e.clientX - r.left - r.width / 2) / R, y = -(e.clientY - r.top - r.height / 2) / R;
      const len = Math.hypot(x, y); if (len > 1) { x /= len; y /= len; }
      ctl.fake[sec] = [x, y]; ctl.ui.draw();
    };
    map.addEventListener('pointerdown', (e) => { map.setPointerCapture(e.pointerId); drag(e); });
    map.addEventListener('pointermove', drag);
    map.addEventListener('pointerup', () => { ctl.fake[sec] = null; ctl.ui.draw(); });
    root.append(
      tile('s5 ctl', head(`${sec === 'left' ? 'Left' : 'Right'} stick`, tag('Drag to try')), map,
        h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'dot muted' }), 'Your stick'), h('span', {}, h('i', { class: 'dot accent' }), 'What the game gets'), h('span', {}, h('i', { class: 'dot dead' }), 'Dead zone')),
        curve, read,
        h('p', { class: 'muted small' }, 'In Rocket League, turn the game’s own Controller Deadzone down (Settings, Controls), since OpenW Input handles the dead zone now.')),
      tile('s7 ctl', head('Settings', h('button', { class: 'btn sm', onclick: () => { p.sticks[sec] = TX.blank('').sticks[sec]; redo(); } }, 'Reset')),
        choiceRow('Dead zone shape', SHAPE_TEXT[s.shape], seg([['circle', 'Circle'], ['cross', 'Cross'], ['square', 'Square']], s.shape, (v) => { s.shape = v; redo(); })),
        valRow('Inner dead zone', 'Travel from the centre that does nothing.', s, 'inner', 0, 50),
        valRow('Outer dead zone', 'Travel at the edge that already counts as full.', s, 'outer', 0, 30),
        choiceRow('Response curve', 'How output grows with travel.', select(CURVE_OPTS, s.curve, (v) => { s.curve = v; redo(); }, 160)),
        s.curve === 'custom' && valRow('Curve exponent', 'Under 1 is quicker off the centre, over 1 is finer near it.', s, 'exponent', 0.2, 5, (v) => Number(v).toFixed(2), 0.05),
        valRow('Output anti-deadzone', 'Where the output starts, to step over the game’s own dead zone.', s, 'anti', 0, 50),
        valRow('Anti-deadzone buffer', 'Eases into the anti-deadzone, so tiny moves stay tiny.', s, 'buffer', 0, 50),
        valRow('Horizontal sensitivity', '', s, 'scaleX', 50, 200),
        valRow('Vertical sensitivity', '', s, 'scaleY', 50, 200),
        choiceRow('Invert horizontal', '', flip(s, 'invertX')),
        choiceRow('Invert vertical', '', flip(s, 'invertY')),
        choiceRow('Output joystick', 'Which stick of the virtual controller it moves.', seg(SIDES, s.output, (v) => { s.output = v; redo(); })),
        choiceRow('Output axis', '', seg([['both', 'Both'], ['x', 'Horizontal'], ['y', 'Vertical']], s.axes, (v) => { s.axes = v; redo(); })),
        choiceRow('Outer ring button', 'Held while the stick is pushed past the ring.', select(OUT_OPTS, s.ring.to, (v) => { s.ring.to = v; redo(); }, 160)),
        s.ring.to && valRow('Outer ring', '', s.ring, 'at', 50, 100),
        s.ring.to && choiceRow('Invert outer ring', 'Held inside the ring instead.', flip(s.ring, 'invert')),
        valRow('Smoothing', 'Steadies a shaky stick but adds a little delay; off is fastest.', s, 'smoothing', 0, 100, (v) => (v ? `${v}%` : 'Off'))));
  } else if (sec === 'triggers') {
    for (const [side, name, i] of [['left', 'Left', 4], ['right', 'Right', 5]]) {
      const t = p.triggers[side], curve = canvasEl(260, 130), rawBar = h('i'), outBar = h('i');
      drawers.push((live) => {
        const c = TX.trigCfg(t), raw = st.running && live ? live.raw[i] : null;
        drawCurve(curve, (x) => TX.trigger(x, c), raw);
        rawBar.style.width = `${(raw || 0) * 100}%`;
        outBar.style.width = `${(st.running && live ? live.out[i] : 0) * 100}%`;
      });
      root.append(tile('s6 ctl', head(`${name} trigger`, tag()), curve,
        h('div', { class: 'opt-row' }, lbl('Your trigger'), h('div', { class: 'meter raw grow' }, rawBar)),
        h('div', { class: 'opt-row' }, lbl('Game gets'), h('div', { class: 'meter grow' }, outBar)),
        valRow('Range start', 'Pull before anything happens.', t, 'start', 0, 90),
        valRow('Range end', 'Pull that already counts as full.', t, 'end', 10, 100),
        choiceRow('Response curve', '', select(CURVE_OPTS, t.curve, (v) => { t.curve = v; redo(); }, 150)),
        t.curve === 'custom' && valRow('Curve exponent', '', t, 'exponent', 0.2, 5, (v) => Number(v).toFixed(2), 0.05),
        choiceRow('Hair trigger', 'Full the moment it moves down, off the moment it moves back up.', flip(t, 'hair')),
        choiceRow('Output trigger', '', seg(SIDES, t.output, (v) => { t.output = v; redo(); }))));
    }
  } else if (sec === 'buttons') {
    const lights = [];
    drawers.push((live) => {
      const bits = st.running && live ? live.rawButtons : 0;
      for (const [el, bit] of lights) el.classList.toggle('on', !!(bits & (1 << bit)));
    });
    const rows = shownSources().map((src) => {
      const b = p.buttons[src], lit = h('i', { class: 'lit' });
      lights.push([lit, TX.SOURCES.indexOf(src)]);
      return [
        h('div', { class: 'bname' }, lit, srcName(src)),
        select(OUT_OPTS, b.to, (v) => { b.to = v; redo(); }, 160),
        select([['', 'No long press'], ...OUT_OPTS.slice(1)], b.hold, (v) => { b.hold = v; redo(); }, 160),
        b.hold ? select(HOLD_TIMES, b.holdMs, (v) => { b.holdMs = v; redo(); }, 100) : h('span', { class: 'muted small' }, ' '),
        h('div', { class: 'row' }, toggle(b.turbo, (v) => { b.turbo = v; redo(); }), b.turbo && select(TURBO_RATES, b.rate, (v) => { b.rate = v; redo(); }, 130)),
        toggle(b.toggle, (v) => { b.toggle = v; save(); }),
      ];
    });
    root.append(tile('s12 ctl', head('Buttons', h('button', { class: 'btn sm', onclick: () => { p.buttons = TX.blank('').buttons; redo(); } }, 'Reset')),
      h('p', { class: 'muted' }, 'What each button of your controller presses on the virtual Xbox controller. A long press sends a second button once it is held long enough (a short press then sends the first on release). Turbo repeats while held; toggle keeps it held until the next press.'),
      h('div', { class: 'btable' }, ['Button', 'Sends', 'Long press', 'Hold for', 'Turbo', 'Toggle'].map((x) => h('div', { class: 'th' }, x)), rows)));
  } else if (sec === 'feedback') {
    const ps = padKind() && padKind() !== 'xinput';
    root.append(
      tile('s6 ctl', head('Rumble'), h('p', { class: 'muted' }, 'Rumble the game sends to the virtual controller is played on yours.'),
        valRow('Strength', '0% turns rumble off.', p, 'rumble', 0, 200)),
      tile('s6 ctl', head('Lightbar', !ps && h('span', { class: 'tag' }, 'PlayStation controllers')),
        h('p', { class: 'muted' }, 'The colour of a DualShock 4 or DualSense light while OpenW Input runs.'),
        h('div', { class: 'swatches' },
          h('button', { class: `btn sm${p.light ? '' : ' primary'}`, onclick: () => { p.light = ''; redo(); } }, 'Leave as it is'),
          LIGHTS.map((c) => h('button', { class: `swatch${p.light === c ? ' on' : ''}`, style: `background:${c}`, 'aria-label': c, onclick: () => { p.light = c; redo(); } })))));
  } else {
    root.append(ownTile(st, inp), hideSection(dr, inp));
  }
  requestAnimationFrame(() => ctl.ui.draw());
  return root;
};

// Hiding without a driver: the helper opens a PlayStation controller for itself alone.
function ownTile(st, inp) {
  const own = inp.own !== false, pad = st.pad, hidden = !!(st.running && pad && pad.access === 'own');
  const state = !st.running ? 'OpenW Input is off.'
    : !pad ? 'No controller found.'
      : pad.kind === 'xinput' ? 'Xbox controllers cannot be hidden this way. Use HidHide below.'
        : hidden ? 'Hidden: only OpenW Input can open your controller.'
          : own ? 'Not hidden: another app had your controller open first (Steam, for example). Close it, then press Try again.'
            : 'Off: games can see your controller.';
  return tile(`s12 ctl${hidden ? ' ink' : ''}`, head('Hide without a driver', toggle(own, (v) => run(() => api('inputOwn', v), v ? 'OpenW Input takes your controller for itself.' : 'Your controller is shared again.'))),
    h('p', { class: 'muted' }, 'For DualShock 4, DualSense and DualSense Edge. OpenW Input opens your controller for itself alone, so Rocket League and other apps cannot open it and only see the virtual controller. Windows allows that only while no other app has the controller open, so turn OpenW Input on before you start Steam or Rocket League. It ends when OpenW Input stops, so nothing stays hidden.'),
    h('div', { class: 'opt-row' }, h('span', { class: `tag${hidden ? ' on' : ''}` }, hidden ? 'Hidden' : 'Not hidden'), h('div', { class: 'grow muted small' }, state),
      st.running && pad && pad.kind !== 'xinput' && own && !hidden && h('button', { class: 'btn sm', onclick: () => { api('inputReopen'); toast('Trying to take the controller again.'); } }, 'Try again')));
}

// HidHide: hide the real controller from everything except OpenW's helper.
function hideSection(dr, inp) {
  if (!dr.hidhide) {
    return tile('s12 ctl', head('Hide with HidHide', h('span', { class: 'tag' }, 'Optional')),
      h('p', { class: 'muted' }, 'Only needed for Xbox controllers, or when another app keeps your PlayStation controller open. HidHide is a free, signed driver that hides a controller from every app except OpenW Input, until you show it again. OpenW comes with it; Windows may want a restart afterwards.'),
      dr.bundled && dr.bundled.hidhide && h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => run(() => installDrivers(['hidhide'])) }, 'Install HidHide')));
  }
  if (!ctl.hid) {
    api('hidState').then((s) => { ctl.hid = s; if (ui.tab === 'controller') render(); }).catch((e) => { ctl.hid = { controllers: [], hidden: [], readable: false }; toast(String(e.message || e), true); });
    return tile('s12', empty('stick', 'Asking HidHide', 'Looking for controllers it can hide.'));
  }
  const hs = ctl.hid;
  const again = (fn, msg) => run(async () => { const r = await fn(); ctl.hid = null; return r; }, msg);
  const rows = hs.controllers.length ? hs.controllers.map((c) => h('div', { class: 'opt-row' },
    h('span', { class: `tag${c.hidden ? ' on' : ''}` }, c.hidden ? 'Hidden' : 'Visible'),
    h('div', { class: 'lbl grow' }, h('b', {}, c.name), h('div', { class: 'muted small' }, [c.vid && `${c.vid}:${c.pid}`, c.virtual && 'may be OpenW’s own virtual controller: leave it visible'].filter(Boolean).join(' · '))),
    c.hidden ? h('button', { class: 'btn sm', onclick: () => again(() => api('hidShow', c.paths), 'Visible again.') }, 'Show')
      : h('button', { class: 'btn sm primary', onclick: () => again(() => api('hidHide', c.paths), 'Hidden from games.') }, 'Hide')))
    : [h('p', { class: 'muted' }, hs.readable === false ? 'HidHide did not answer. Windows may need you to open its configuration once; hiding from here still works.' : 'No controllers found. Plug yours in and press Refresh.')];
  return tile('s12 ctl', head('Hide with HidHide', h('button', { class: 'btn sm', onclick: () => { ctl.hid = null; render(); } }, 'Refresh')),
    h('p', { class: 'muted' }, 'Hidden controllers are only seen by OpenW Input, so Rocket League gets each press once, from the virtual controller. They stay hidden after OpenW closes, until you show them again here. Windows asks for permission each time this changes.'),
    rows,
    inp.hidden.length > 0 && h('div', { class: 'row push' }, h('span', { class: 'muted small grow' }, `${plural(inp.hidden.length, 'device')} hidden by OpenW.`),
      h('button', { class: 'btn sm', onclick: () => again(() => api('hidShow'), 'Everything OpenW hid is visible again.') }, 'Show all again')));
}

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
  root.append(...(list.length ? list : [null]).map((p) => (!p ? tile('s12', empty('presets', 'No presets yet', 'Set your car up the way you like, then save it here.')) : tile('card',
    h('div', { class: 'row' }, art(p.name, 'presets'), h('div', { class: 'grow' }, h('b', { class: 'clip' }, p.name), h('div', { class: 'muted small' }, `${plural(p.ops.length, 'change')} · ${new Date(p.savedAt).toLocaleDateString()}`))),
    h('p', { class: 'muted small' }, p.ops.slice(0, 4).map((o) => o.label).join(' · ') || 'Empty'),
    h('div', { class: 'row wrap push' },
      h('button', { class: 'btn primary grow', onclick: () => run(() => api('presetLoad', p.id), (r) => (r.errors.length ? `Loaded with ${plural(r.errors.length, 'problem')}: ${r.errors[0]}` : 'Preset loaded.')) }, 'Load'),
      h('button', { class: 'btn', onclick: async () => { await navigator.clipboard.writeText(await api('presetExport', p.id)); toast('Preset code copied.'); } }, 'Copy code'),
      h('button', { class: 'btn danger', onclick: () => run(() => api('presetDelete', p.id)) }, 'Delete'))))));
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
  ['Midnight black', '#14161b', '#23262d'], ['White', '#e9ebef', '#c9cdd4'], ['Grey', '#6b7079', '#3c4048'], ['Cosmic red', '#8f1a24', '#2a0d11'],
  ['Starlight blue', '#2c63c9', '#16305e'], ['Galactic purple', '#4b2f86', '#241640'], ['Nova pink', '#d8679a', '#5a2440'], ['Gold', '#a8841f', '#3f300b'],
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
  // 'auto' follows the controller that is plugged in; the preview shows that one too
  const shownModel = () => (o.pad.model && o.pad.model !== 'auto' ? o.pad.model : Pad.guess(Pad.first()) || 'ps5');
  const preview = Pad.mount(h('div', { class: 'padpreview' }), shownModel());
  Pad.style(preview, o.pad);
  const look = PAD_LOOKS.find(([, body, keys]) => body === o.pad.body && keys === o.pad.keys);
  const opacityLabel = h('div', { class: 'muted small' }, `${o.pad.opacity}%`);
  const padTile = tile(`s6${o.pad.on ? ' ink' : ''}`, head('Controller', toggle(o.pad.on, (v) => upd('pad', { on: v }))),
    h('p', { class: 'muted' }, 'Shows every button, trigger and stick you press. Press something on your controller to try it here.'),
    preview,
    h('div', { class: 'opt-row' }, h('div', { class: 'grow' }, h('b', {}, 'Controller'), h('div', { class: 'muted small' }, 'Automatic picks the one that is plugged in.')),
      select([['auto', 'Automatic'], ...Pad.models()], o.pad.model || 'auto', (v) => upd('pad', { model: v }), 200)),
    h('div', { class: 'opt-row' }, h('div', { class: 'grow' }, h('b', {}, 'Colour'), h('div', { class: 'muted small' }, 'The shell and its buttons.')),
      select(PAD_LOOKS.map(([label]) => [label, label]).concat(look ? [] : [['', 'Custom']]), look ? look[0] : '', (v) => { const pick = PAD_LOOKS.find(([label]) => label === v); if (pick) upd('pad', { body: pick[1], keys: pick[2] }); }, 170)),
    h('div', { class: 'opt-row' }, h('div', { class: 'grow' }, h('b', {}, 'Pressed colour'), h('div', { class: 'muted small' }, 'What a button lights up in.')),
      h('div', { class: 'swatches' }, GLOWS.map((c) => h('button', { class: `swatch${o.pad.glow === c ? ' on' : ''}`, style: `background:${c}`, 'aria-label': c, onclick: () => upd('pad', { glow: c }) })))),
    h('div', { class: 'opt-row' }, h('div', { style: 'width:120px' }, h('b', {}, 'Opacity'), opacityLabel),
      slider(20, 100, o.pad.opacity, (v) => upd('pad', { opacity: v }), (v) => { opacityLabel.textContent = `${v}%`; Pad.style(preview, { ...o.pad, opacity: v }); })),
    sizeRow('pad', 50, 200), place('pad'));

  overlayUI = { paint, tick, preview, root: padTile, shownModel };
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
window.openw.on('media', (state) => { media = state; if (overlayLive()) overlayUI.paint(); });
api('mediaState').then((state) => { media = state; if (overlayLive()) overlayUI.paint(); });
setInterval(() => { if (overlayLive()) overlayUI.tick(); }, 500);
(function padLoop() {
  if (overlayLive()) {
    const want = overlayUI.shownModel(); // a controller plugged in while the page is open
    if (overlayUI.preview.dataset.model !== want) { Pad.mount(overlayUI.preview, want); Pad.style(overlayUI.preview, S.settings.overlay.pad); }
    Pad.update(overlayUI.preview, Pad.first());
  }
  requestAnimationFrame(padLoop);
}());

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
      h('p', { class: 'muted small push' }, 'This card lives in OpenW. It does not change your name, title or rank inside Rocket League: that would need code injected into the running game, which OpenW does not do.')),
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
      h('p', { class: 'muted' }, 'Rocket League encrypts item packages with many different keys. OpenW includes one, which opens about two thirds of items. Items it cannot open show a lock and cannot be used as a new look. Add a key list (a keys.txt, one key per line) to open the rest.'),
      h('div', { class: 'row wrap push' },
        h('button', { class: 'btn primary', onclick: () => run(async () => { const res = await api('importKeys'); catalog = null; arenas = null; return res; }, (r) => (r.keys ? `${r.keys.toLocaleString()} keys loaded. Pictures are being re-read.` : 'No change.')) }, S.keys ? 'Replace key list' : 'Add key list'),
        S.keys ? h('button', { class: 'btn danger', onclick: () => run(async () => { const res = await api('removeKeys'); catalog = null; arenas = null; return res; }, 'Key list removed.') }, 'Remove') : null)),
    tile('s5', head('Data'), h('p', { class: 'muted' }, 'Backups, maps and settings live in the data folder.'),
      h('div', { class: 'row wrap push' },
        h('button', { class: 'btn', onclick: () => api('openDataFolder') }, 'Open data folder'),
        h('button', { class: 'btn danger', disabled: !S.engine.active.length, onclick: () => run(() => api('revertAll'), 'Everything reverted.') }, 'Revert every change'))),
    noteTile('warn', 's12', `OpenW v${S.version} changes files in your Rocket League folder and backs up each one first. Rocket League runs with Easy Anti-Cheat; OpenW does not touch or work around it and cannot promise that changed files are accepted online. Changing game files may break the game’s terms of service and could put your account at risk, so use it at your own risk. Your launcher’s “Verify files” always restores a clean install. Free and open source; not affiliated with Psyonix or Epic Games.`));
};

/* ---------- boot ---------- */

window.openw.on('state', ({ state, flushed, notice }) => {
  S = state;
  if (notice) toast(notice);
  const ok = flushed.filter((f) => f.ok).length, failed = flushed.filter((f) => !f.ok);
  if (ok) toast(`${plural(ok, 'queued change')} applied.`);
  for (const f of failed) toast(`${f.key}: ${f.message}`, true);
  render();
});
api('getState').then((s) => { S = s; render(); });
