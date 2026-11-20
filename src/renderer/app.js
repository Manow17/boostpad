/* Boostpad renderer. No framework: a small element helper and one render function per tab. */
const api = (method, ...args) => window.boostpad.call(method, ...args);

let S = null;          // latest snapshot from the main process
let catalog = null;    // item catalog, loaded on first use
const ui = { tab: location.hash.slice(1) || 'garage', cat: 'cars', q: '', slot: 'src', src: null, dst: null, check: null, packType: 'all' };
const player = new Audio();
let track = -1;

const NAV = [
  ['Customize', [['garage', 'Garage', 'cars'], ['packs', 'Mod Packs', 'packs'], ['maps', 'Workshop Maps', 'maps']]],
  ['Setups', [['presets', 'Presets', 'presets'], ['active', 'Active', 'active']]],
  ['Play', [['tracker', 'MMR Tracker', 'tracker'], ['overlay', 'Overlay', 'overlay'], ['music', 'Music', 'anthems']]],
  ['You', [['profile', 'Profile', 'profile'], ['settings', 'Settings', 'settings']]],
];
const PACK_TYPES = [['all', 'All'], ['ball', 'Ball'], ['decal', 'Decals'], ['boostmeter', 'Boost meter'], ['wheels', 'Wheels'], ['menu', 'Lobby'], ['loading', 'Loading screen'], ['music', 'Menu music'], ['sound', 'Sounds'], ['other', 'Other']];
const PLAYLISTS = ['Duel 1v1', 'Doubles 2v2', 'Standard 3v3', 'Hoops', 'Rumble', 'Dropshot', 'Snow Day', 'Tournament'];
const RANKS = ['', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Champion', 'Grand Champion', 'Supersonic Legend'];
const COLORS = ['#ff7a1a', '#ffd166', '#3ddc97', '#35c2ff', '#6c8cff', '#b17aff', '#ff5fa2', '#ff5d6c', '#e9edf5'];

// Line icons on a 24px grid (drawn for this project).
const IC = {
  cars: 'M3 13l2-5a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 5v4h-2a2 2 0 0 1-4 0H9a2 2 0 0 1-4 0H3z M5 13h14',
  wheels: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z M12 3v6 M12 15v6 M3 12h6 M15 12h6',
  boosts: 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4c0 2 1 3 2 3c0-3-1-5 1-9z',
  decals: 'M4 20l6-2l10-10a2.1 2.1 0 0 0-3-3L7 15z M14 7l3 3',
  toppers: 'M7 16v-4a5 5 0 0 1 10 0v4 M3 16c0 1.7 4 3 9 3s9-1.300 9-3s-4-1-9-1s-9-.7-9 1z',
  antennas: 'M6 21V4 M6 5h11l-2 3.500L17 12H6',
  engines: 'M4 10v4h3l5 4V6L7 10z M16 9a4 4 0 0 1 0 6 M18.500 6.500a8 8 0 0 1 0 11',
  trails: 'M3 8h10 M3 12h14 M3 16h8 M17 8l4 4l-4 4',
  explosions: 'M12 3l2 5l5-2l-2 5l5 2l-5 2l2 5l-5-2l-2 5l-2-5l-5 2l2-5l-5-2l5-2l-2-5l5 2z',
  finishes: 'M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z',
  banners: 'M3 7h18v10H3z M7 11h7 M7 14h4',
  borders: 'M4 4h16v16H4z M8 8h8v8H8z',
  anthems: 'M9 18V6l10-2v12 M9 18a3 3 0 1 1-6 0a3 3 0 0 1 6 0z M19 16a3 3 0 1 1-6 0a3 3 0 0 1 6 0z',
  packs: 'M3 8l9-5l9 5v8l-9 5l-9-5z M3 8l9 5l9-5 M12 13v8',
  maps: 'M9 4L3 6v14l6-2l6 2l6-2V4l-6 2z M9 4v14 M15 6v14',
  presets: 'M12 3l9 5l-9 5l-9-5z M3 12.500l9 5l9-5 M3 17l9 5l9-5',
  active: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M8 12l3 3l5-6',
  tracker: 'M4 19V5 M4 19h16 M7 15l4-4l3 3l5-6',
  overlay: 'M7 8h10a5 5 0 0 1 5 5v2a3 3 0 0 1-5.500 1.500L15 15H9l-1.500 1.500A3 3 0 0 1 2 15v-2a5 5 0 0 1 5-5z M7 11v3 M5.500 12.500h3 M16 12h.01 M18 14h.01',
  profile: 'M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8z M4 20a8 8 0 0 1 16 0',
  settings: 'M4 7h10 M18 7h2 M14 5v4 M4 17h4 M12 17h8 M8 15v4',
  ball: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M12 8l4 3l-1.500 4.500h-5L8 11z M12 3v5 M20.500 10L16 11 M17 19l-2.500-3.500 M7 19l2.500-3.500 M3.500 10L8 11',
  gauge: 'M4 16a8 8 0 1 1 16 0 M12 16l4-5 M12 16h.01',
  image: 'M4 5h16v14H4z M4 15l4-4l4 4l3-3l5 5 M15 9h.01',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14z M20 20l-4-4',
  down: 'M12 5v14 M6 13l6 6l6-6',
  warn: 'M12 4l9 16H3z M12 10v4 M12 17h.01',
  info: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M12 11v5 M12 8h.01',
  plus: 'M12 5v14 M5 12h14',
  bolt: 'M13 3L5 14h6l-1 7l8-11h-6z',
  play: 'M8 5l11 7l-11 7z',
};
// which icon stands for a pack type / operation category
const GLYPH = { decal: 'decals', boostmeter: 'gauge', menu: 'maps', loading: 'image', music: 'anthems', sound: 'engines', other: 'packs', map: 'maps' };
const glyphFor = (key) => (IC[key] ? key : GLYPH[key] || 'packs');

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'disabled', 'selected'].includes(k)) el[k] = v;
    else if (v != null && v !== false) el.setAttribute(k, v);
  }
  for (const kid of kids.flat(3)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}

function icon(name, size = 18) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('class', 'ic');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', IC[name] || IC.packs);
  if (name === 'play' || name === 'bolt') { path.setAttribute('fill', 'currentColor'); path.setAttribute('stroke', 'none'); }
  svg.append(path);
  return svg;
}

function toast(message, isError) {
  const el = h('div', { class: `toast${isError ? ' err' : ''}` }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), isError ? 7000 : 3500);
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
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Generated artwork: a colour from the name plus the category's icon. No game assets.
function art(name, glyph, cls = '') {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return h('div', { class: `art ${cls}`, style: `background:linear-gradient(145deg,hsl(${hue} 46% 30%),hsl(${(hue + 40) % 360} 52% 11%));color:hsl(${hue} 90% 86%)` }, icon(glyphFor(glyph), 40));
}

const toggle = (checked, onchange) => h('input', { type: 'checkbox', class: 'switch', checked, onchange: (e) => onchange(e.target.checked) });
const title = (text, sub, ...actions) => h('div', { class: 'pagehead' }, h('div', { class: 'grow' }, h('h1', {}, text), sub && h('p', {}, sub)), actions);
const note = (kind, ...content) => h('div', { class: `note${kind === 'warn' ? ' warn' : ''}` }, icon(kind === 'warn' ? 'warn' : 'info', 20), h('div', { class: 'grow' }, content));
const empty = (glyph, heading, text, ...actions) => h('div', { class: 'empty' }, icon(glyph, 44), h('b', {}, heading), h('div', { style: 'max-width:440px' }, text), actions);
const btnIcon = (cls, name, label, onclick, extra = {}) => h('button', { class: `btn ${cls}`, onclick, ...extra }, icon(name, 16), label);

/* ---------- shell ---------- */

function render() {
  document.documentElement.style.setProperty('--accent', S.settings.theme.accent);
  document.body.dataset.bg = S.settings.theme.background;
  const nav = document.getElementById('nav'), top = document.getElementById('top'), view = document.getElementById('view');
  nav.replaceChildren(h('div', { class: 'brand' }, h('i', {}, icon('bolt', 18)), 'BOOSTPAD'));
  top.replaceChildren();
  if (!S.install.valid) { view.replaceChildren(setup()); return; }

  const pending = S.engine.active.length + S.engine.queue.length;
  for (const [group, items] of NAV) {
    nav.append(h('h3', { class: 'navgroup' }, group));
    for (const [id, label, glyph] of items) {
      nav.append(h('button', { class: ui.tab === id ? 'on' : '', onclick: () => { ui.tab = id; location.hash = id; render(); } },
        icon(glyph), label, id === 'active' && pending ? h('span', { class: 'count' }, pending) : null));
    }
  }
  nav.append(h('div', { class: 'navfoot' }, h('div', { class: 'gamecard' },
    h('div', { class: 'row', style: 'gap:8px' }, h('span', { class: `dot${S.running ? ' live' : ''}` }), h('b', {}, 'Rocket League')),
    h('span', { class: 'muted small' }, `${S.install.platform === 'steam' ? 'Steam' : 'Epic Games'} · ${S.running ? 'running' : 'not running'}`),
    h('span', { class: 'muted small' }, `Boostpad v${S.version} · free & open source`))));

  top.append(
    h('div', { class: 'status grow' }, S.running ? [h('span', { class: 'dot live' }), 'Rocket League is running. Changes are queued until it closes.'] : null),
    btnIcon('primary', 'play', 'Play', () => run(() => api('launchGame'), 'Starting Rocket League…'), { disabled: S.running }),
  );
  view.replaceChildren((views[ui.tab] || views.garage)());
}

function setup() {
  const choose = (platform, label) => h('button', { class: 'choice', onclick: async () => {
    const found = await api('detectGame');
    if (found[platform]) run(() => api('setInstall', platform, found[platform]), 'Found Rocket League.');
    else { toast(`No ${label} install found. Select the "rocketleague" folder.`, true); run(() => api('browseInstall', platform)); }
  } }, h('b', {}, label), h('span', { class: 'muted' }, 'Detect automatically'));
  return h('div', { class: 'setup stack' },
    h('div', { class: 'mark' }, icon('bolt', 34)),
    h('h1', {}, 'Where do you play?'),
    h('p', { class: 'muted' }, 'Pick your launcher and Boostpad finds Rocket League for you.'),
    h('div', { class: 'choices' }, choose('steam', 'Steam'), choose('epic', 'Epic Games')),
    note('info', 'Boostpad only changes files on your own PC, and keeps a backup of every file it touches. It is a fan project, not affiliated with Psyonix or Epic Games.'));
}

/* ---------- garage: item swaps ---------- */

async function ensureCatalog() {
  if (catalog) return;
  catalog = await api('getCatalog');
  catalog.counts = {};
  for (const i of catalog.items) catalog.counts[i.category] = (catalog.counts[i.category] || 0) + 1;
  render();
}

const views = {};

views.garage = () => {
  const root = h('div', { class: 'stack' }, title('Garage', 'Give an item you own the look of any other item. Only you see it.', h('span', { class: 'tag exp' }, 'Experimental')));
  if (!S.settings.experimentalSwaps) {
    root.append(note('warn', 'Item swaps rewrite game packages and have not been confirmed in game yet. Turn them on to use the Swap button. ',
      h('button', { class: 'btn sm', style: 'margin-left:8px', onclick: () => { ui.tab = 'settings'; render(); } }, 'Open Settings')));
  }
  if (!catalog) { ensureCatalog(); root.append(empty('cars', 'Reading your game files…', 'Building the item list from your own install.')); return root; }

  const slot = (which, label, item, hint) => h('div', { class: `slot${ui.slot === which ? ' on' : ''}`, onclick: () => { ui.slot = which; render(); } },
    item ? art(item.name, ui.cat, 'sm') : h('div', { class: 'art sm blank' }, which === 'src' ? '1' : '2'),
    h('div', { class: 'grow' }, h('div', { class: 'label' }, label), h('div', { class: `name${item ? '' : ' hint'}` }, item ? item.name : hint)));

  const op = () => ({ kind: 'swap', sourceFile: ui.src.file, targetFile: ui.dst.file, category: ui.cat, label: `${ui.src.name} → ${ui.dst.name}` });
  const reasons = {
    NAME_TOO_LONG: 'Not supported yet: your item has a longer internal name than the new look. Try another pair.',
    NO_KEY: 'This item uses a newer package key that Boostpad cannot read.',
    SAME_ITEM: 'Pick two different items.',
  };
  const status = !ui.src || !ui.dst ? h('span', { class: 'muted small' }, 'Pick both items to continue')
    : !ui.check ? h('span', { class: 'muted small' }, 'Checking…')
      : ui.check.ok ? h('span', { class: 'tag good' }, 'Ready to swap')
        : h('span', { class: 'small', style: 'color:var(--bad)' }, reasons[ui.check.code] || ui.check.message);
  const pool = () => catalog.items.filter((i) => i.category === ui.cat);

  const panel = h('aside', { class: 'card swap' },
    h('h3', {}, 'Your swap'),
    slot('src', 'Your item', ui.src, 'Pick an item you own'),
    h('div', { class: 'arrow' }, icon('down', 20)),
    slot('dst', 'New look', ui.dst, 'Then pick its new look'),
    h('div', { class: 'swapstatus' }, status),
    h('button', { class: 'btn primary lg', disabled: !(ui.check && ui.check.ok) || !S.settings.experimentalSwaps,
      onclick: () => run(() => api('apply', op()), queuedMsg) }, 'Swap'),
    h('div', { class: 'row' },
      h('button', { class: 'btn sm grow', disabled: !ui.src, onclick: () => { const p = pool(); pickItem(p[Math.floor(Math.random() * p.length)], 'dst'); } }, 'Random look'),
      h('button', { class: 'btn sm grow', onclick: () => { ui.src = ui.dst = ui.check = null; ui.slot = 'src'; render(); } }, 'Clear')),
    h('p', { class: 'muted small' }, 'The original file is backed up first. Revert any time from Active.'));

  const grid = h('div', { class: 'grid' }), more = h('p', { class: 'muted small' });
  function fill() {
    const q = ui.q.trim().toLowerCase();
    const list = pool().filter((i) => !q || i.name.toLowerCase().includes(q));
    grid.replaceChildren(...list.slice(0, 240).map((i) => h('button', {
      class: `tile${ui.src === i ? ' src' : ''}${ui.dst === i ? ' dst' : ''}`, title: i.file, onclick: () => pickItem(i, ui.slot),
    }, art(i.name, ui.cat), h('div', { class: 'name' }, i.name),
    ui.src === i ? h('span', { class: 'badge' }, 'YOURS') : ui.dst === i ? h('span', { class: 'badge' }, 'NEW LOOK') : null)));
    more.textContent = list.length > 240 ? `Showing 240 of ${list.length}. Search to narrow it down.` : plural(list.length, 'item');
  }
  fill();

  root.append(h('div', { class: 'garage' },
    h('div', { class: 'stack' },
      h('div', { class: 'chips' }, catalog.categories.map((c) => h('button', { class: `chip${ui.cat === c.id ? ' on' : ''}`,
        onclick: () => { ui.cat = c.id; ui.q = ''; ui.src = ui.dst = ui.check = null; ui.slot = 'src'; render(); } }, icon(c.id, 15), c.label, h('small', {}, catalog.counts[c.id] || 0)))),
      h('div', { class: 'row' }, h('div', { class: 'search' }, icon('search', 16),
        h('input', { type: 'text', placeholder: 'Search items', value: ui.q, oninput: (e) => { ui.q = e.target.value; fill(); } })), h('span', { class: 'grow' }), more),
      grid),
    panel));
  return root;
};

async function pickItem(item, which) {
  if (!item) return;
  ui[which] = item;
  if (which === 'src') ui.slot = 'dst';
  ui.check = null;
  render();
  if (ui.src && ui.dst) {
    const { src, dst } = ui;
    const check = await api('checkSwap', { kind: 'swap', sourceFile: src.file, targetFile: dst.file });
    if (ui.src === src && ui.dst === dst) { ui.check = check; render(); }
  }
}

/* ---------- mod packs & maps ---------- */

let packs = null, maps = null;
const load = async (what) => { if (what === 'packs') packs = await api('packsList'); else maps = await api('mapsList'); render(); };

views.packs = () => {
  const add = async () => { packs = await api('packsImport'); render(); };
  const root = h('div', { class: 'stack' }, title('Mod Packs', 'Custom balls, decals, boost meters, wheels, lobby backgrounds, loading screens, menu music and sounds.',
    btnIcon('primary', 'plus', 'Add pack folder', add)));
  if (!packs) { load('packs'); return root; }
  root.append(h('div', { class: 'chips' }, PACK_TYPES.map(([id, label]) => h('button', { class: `chip${ui.packType === id ? ' on' : ''}`, onclick: () => { ui.packType = id; render(); } },
    id !== 'all' && icon(glyphFor(id), 15), label))));
  const shown = packs.filter((p) => ui.packType === 'all' || p.type === ui.packType);
  if (!shown.length) {
    root.append(empty(ui.packType === 'all' ? 'packs' : glyphFor(ui.packType), 'No packs here yet',
      'A pack is a folder with replacement game files and a pack.json that says which file each one replaces. The README has the format.',
      btnIcon('', 'plus', 'Add pack folder', add)));
    return root;
  }
  const activeIds = new Set(S.engine.active.map((r) => r.op.packId));
  const queuedIds = new Set(S.engine.queue.filter((q) => q.op).map((q) => q.op.packId));
  root.append(h('div', { class: 'cards' }, shown.map((p) => h('div', { class: 'card stack' },
    h('div', { class: 'row' }, art(p.name, p.type, 'sm'), h('div', { class: 'grow' }, h('b', {}, p.name),
      h('div', { class: 'muted small' }, p.error || `${plural(p.files.length, 'file')}${p.author ? ` · by ${p.author}` : ''}`)),
    activeIds.has(p.id) ? h('span', { class: 'tag good' }, 'In game') : h('span', { class: 'tag' }, p.type)),
    h('div', { class: 'row' },
      activeIds.has(p.id)
        ? h('button', { class: 'btn grow', onclick: () => run(() => api('packsRevert', p.id), 'Original files restored.') }, 'Remove from game')
        : h('button', { class: 'btn primary grow', disabled: !!p.error || queuedIds.has(p.id), onclick: () => run(() => api('packsApply', p.id), queuedMsg) }, queuedIds.has(p.id) ? 'Queued' : 'Apply'),
      h('button', { class: 'btn danger', disabled: activeIds.has(p.id), onclick: async () => { packs = await api('packsRemove', p.id); render(); } }, 'Delete'))))));
  return root;
};

views.maps = () => {
  const add = async () => { maps = await api('mapsAdd'); render(); };
  const root = h('div', { class: 'stack' }, title('Workshop Maps', 'Play training and challenge maps on Steam or Epic.', btnIcon('primary', 'plus', 'Add map files', add)));
  root.append(note('info', 'A loaded map takes the place of the Underpass arena. In Rocket League open Training → Free Play and choose Underpass.'));
  if (!maps) { load('maps'); return root; }
  const slot = S.mapSlot.toLowerCase();
  const loaded = S.engine.active.find((r) => r.key === slot);
  const queued = S.engine.queue.find((q) => q.key === slot && q.op);
  if (!maps.length) { root.append(empty('maps', 'No maps yet', 'Add the .upk or .udk map files you have downloaded.', btnIcon('', 'plus', 'Add map files', add))); return root; }
  root.append(h('div', { class: 'cards' }, maps.map((m) => {
    const isLoaded = loaded && loaded.op.from.endsWith(m.id), isQueued = queued && queued.op.from.endsWith(m.id);
    return h('div', { class: 'card stack' },
      h('div', { class: 'row' }, art(m.name, 'maps', 'sm'), h('div', { class: 'grow' }, h('b', {}, m.name), h('div', { class: 'muted small' }, `${(m.size / 1048576).toFixed(1)} MB`)),
        isLoaded && h('span', { class: 'tag good' }, 'Loaded'), isQueued && h('span', { class: 'tag exp' }, 'Queued')),
      h('div', { class: 'row' },
        isLoaded
          ? h('button', { class: 'btn grow', onclick: () => run(() => api('revert', slot), 'Underpass restored.') }, 'Unload')
          : h('button', { class: 'btn primary grow', onclick: () => run(() => api('mapsLoad', m.id), queuedMsg) }, 'Load into Underpass'),
        h('button', { class: 'btn danger', disabled: !!isLoaded, onclick: async () => { maps = await api('mapsRemove', m.id); render(); } }, 'Delete')));
  })));
  return root;
};

/* ---------- presets & active ---------- */

let community = null;
views.presets = () => {
  const name = h('input', { type: 'text', class: 'grow', placeholder: 'Name this setup', maxlength: 40 });
  const paste = h('input', { type: 'text', class: 'grow', placeholder: 'Paste a shared preset code' });
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
  const root = h('div', { class: 'stack' }, title('Presets', 'Save everything that is active right now and switch between setups in one click. No limit.'),
    h('div', { class: 'cols' },
      h('div', { class: 'card stack' }, h('h3', {}, 'Save current setup'), h('div', { class: 'muted small' }, n ? `${plural(n, 'change')} active right now.` : 'Nothing is active yet. Apply a swap, pack or map first.'),
        h('div', { class: 'row' }, name, h('button', { class: 'btn primary', disabled: !n, onclick: () => run(() => api('presetSave', name.value), 'Preset saved.') }, 'Save'))),
      h('div', { class: 'card stack' }, h('h3', {}, 'Import'), h('div', { class: 'muted small' }, 'Got a code from a friend? Paste it to add their setup.'),
        h('div', { class: 'row' }, paste, h('button', { class: 'btn', onclick: () => run(() => api('presetImport', paste.value), 'Preset imported.') }, 'Import')))),
    h('h3', {}, 'My presets'));
  root.append(list.length ? h('div', { class: 'cards' }, list.map((p) => h('div', { class: 'card stack' },
    h('div', { class: 'row' }, art(p.name, 'presets', 'sm'), h('div', { class: 'grow' }, h('b', {}, p.name), h('div', { class: 'muted small' }, `${plural(p.ops.length, 'change')} · ${new Date(p.savedAt).toLocaleDateString()}`))),
    h('div', { class: 'muted small' }, p.ops.slice(0, 4).map((o) => o.label).join(' · ') || 'Empty'),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary grow', onclick: () => run(() => api('presetLoad', p.id), (r) => (r.errors.length ? `Loaded with ${plural(r.errors.length, 'problem')}: ${r.errors[0]}` : 'Preset loaded.')) }, 'Load'),
      h('button', { class: 'btn', onclick: async () => { await navigator.clipboard.writeText(await api('presetExport', p.id)); toast('Share code copied.'); } }, 'Copy code'),
      url && h('button', { class: 'btn', onclick: () => run(() => publish(p), 'Published to the sync server.') }, 'Publish'),
      h('button', { class: 'btn danger', onclick: () => run(() => api('presetDelete', p.id)) }, 'Delete')))))
    : empty('presets', 'No presets yet', 'Set your car up the way you like, then save it here.'));
  root.append(h('div', { class: 'row' }, h('h3', { class: 'grow' }, 'Community'),
    url ? h('button', { class: 'btn sm', onclick: () => run(browse) }, 'Browse shared presets') : h('span', { class: 'muted small' }, 'Set a sync server in Profile to share presets.')));
  if (community) {
    root.append(community.length ? h('div', { class: 'cards' }, community.map((c) => h('div', { class: 'card stack' },
      h('div', {}, h('b', {}, c.name), h('div', { class: 'muted small' }, `${plural(c.ops.length, 'swap')}${c.author ? ` · by ${c.author}` : ''}`)),
      h('button', { class: 'btn', onclick: () => run(() => api('presetImport', JSON.stringify({ boostpadPreset: 1, name: c.name, ops: c.ops })), 'Saved to your presets.') }, 'Save'))))
      : h('div', { class: 'muted small' }, 'Nothing shared on this server yet.'));
  }
  return root;
};

views.active = () => {
  const { active, queue } = S.engine;
  const root = h('div', { class: 'stack' }, title('Active', 'Everything Boostpad has changed in your game. Revert any of it to put the original file back.',
    h('button', { class: 'btn danger', disabled: !active.length, onclick: () => run(() => api('revertAll'), 'Everything reverted.') }, 'Revert all')));
  if (queue.length) {
    root.append(h('h3', {}, 'Waiting for Rocket League to close'), h('div', { class: 'list' }, queue.map((q) => h('div', { class: 'item' },
      h('span', { class: 'tag exp' }, q.type === 'apply' ? 'Apply' : 'Revert'), h('div', { class: 'grow' }, q.op ? q.op.label : q.key),
      h('button', { class: 'btn sm', onclick: () => run(() => api('unqueue', q.key)) }, 'Cancel')))));
  }
  if (!active.length) { root.append(empty('active', 'Your game files are original', 'Nothing is changed right now. Swaps, packs and maps you apply show up here.')); return root; }
  root.append(h('h3', {}, 'In your game now'), h('div', { class: 'list' }, active.map((r) => h('div', { class: 'item' },
    art(r.op.label || r.file, r.op.category, 'sm'),
    h('div', { class: 'grow' }, h('b', {}, r.op.label || r.file), h('div', { class: 'muted small' }, `${r.file} · ${new Date(r.appliedAt).toLocaleString()}`)),
    h('span', { class: 'tag' }, r.op.category || r.op.kind),
    h('button', { class: 'btn', onclick: () => run(() => api('revert', r.key), 'Reverted.') }, 'Revert')))));
  return root;
};

/* ---------- tracker, overlay, music ---------- */

views.tracker = () => {
  const t = S.settings.tracker;
  const mine = t.entries.filter((e) => e.playlist === t.playlist);
  const last = mine.at(-1), today = new Date().toDateString();
  const firstToday = mine.find((e) => new Date(e.at).toDateString() === today);
  const delta = last && firstToday ? last.mmr - firstToday.mmr : 0;
  const input = h('input', { type: 'number', class: 'grow', placeholder: 'MMR after your match' });
  const log = () => { const mmr = Number(input.value); if (mmr > 0) set('tracker', { ...t, entries: [...t.entries, { playlist: t.playlist, mmr, at: Date.now() }].slice(-500) }); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') log(); });
  const stat = (label, value, cls = '', color = '') => h('div', { class: `card stat ${cls}` }, h('h3', {}, label), h('b', { style: color && `color:${color}` }, value));
  const chart = h('div', { class: 'card stack' }, h('h3', {}, 'Trend'));
  if (mine.length > 1) {
    const pts = mine.slice(-40), lo = Math.min(...pts.map((p) => p.mmr)), hi = Math.max(...pts.map((p) => p.mmr));
    const xy = pts.map((p, i) => `${(i / (pts.length - 1)) * 600},${104 - ((p.mmr - lo) / (hi - lo || 1)) * 88}`);
    const svg = h('div');
    svg.innerHTML = `<svg viewBox="0 0 600 120" width="100%" height="150" preserveAspectRatio="none"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".45"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs><polygon fill="url(#g)" points="0,120 ${xy.join(' ')} 600,120"/><polyline fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke" points="${xy.join(' ')}"/></svg>`;
    chart.append(svg);
  } else chart.append(h('div', { class: 'muted small' }, 'Log at least two ratings to see your trend.'));
  return h('div', { class: 'stack' }, title('MMR Tracker', 'Log your rating after matches to follow your session. The number can also sit on screen in the overlay.'),
    h('div', { class: 'chips' }, PLAYLISTS.map((p) => h('button', { class: `chip${t.playlist === p ? ' on' : ''}`, onclick: () => set('tracker', { ...t, playlist: p }) }, p))),
    h('div', { class: 'stats' },
      stat(t.playlist, last ? last.mmr : '—', 'hero'),
      stat('Today', last ? `${delta >= 0 ? '+' : ''}${delta}` : '—', '', last && (delta < 0 ? 'var(--bad)' : 'var(--good)')),
      stat('Peak', last ? Math.max(...mine.map((e) => e.mmr)) : '—'),
      stat('Logged', mine.length)),
    h('div', { class: 'cols' }, chart,
      h('div', { class: 'card stack' }, h('h3', {}, 'Log a match'),
        h('div', { class: 'row' }, input, h('button', { class: 'btn primary', onclick: log }, 'Log')),
        h('button', { class: 'btn sm danger', style: 'align-self:flex-start', disabled: !last, onclick: () => set('tracker', { ...t, entries: t.entries.filter((e) => e !== last) }) }, 'Undo last entry'),
        h('div', { class: 'muted small' }, 'Ratings are entered by hand: Rocket League has no public stats API, and the stats sites block automated readers.'))));
};

views.overlay = () => {
  const o = S.settings.overlay, upd = (patch) => set('overlay', { ...o, ...patch });
  const option = (name, text, control) => h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, name), h('div', { class: 'muted small' }, text)), control);
  return h('div', { class: 'stack' }, title('Overlay', 'A small always-on-top window over the game. Run Rocket League in borderless mode to see it.'),
    h('div', { class: 'cols' },
      h('div', { class: 'card stack' }, h('h3', {}, 'Show on screen'),
        option('Controller', 'Every button, stick and trigger you press, live.', toggle(o.controller, (v) => upd({ controller: v }))),
        option('MMR counter', 'Your latest logged rating for the selected playlist.', toggle(o.mmr, (v) => upd({ mmr: v })))),
      h('div', { class: 'card stack' }, h('h3', {}, 'Look'),
        option('Controller colour', 'Match your own pad.', h('div', { class: 'chips' }, ['light', 'dark'].map((s) => h('button', { class: `chip${o.style === s ? ' on' : ''}`, onclick: () => upd({ style: s }) }, s === 'light' ? 'White' : 'Black')))),
        option(`Size ${o.size}%`, 'Scale the whole overlay.', h('input', { type: 'range', min: 50, max: 160, value: o.size, onchange: (e) => upd({ size: Number(e.target.value) }) })))),
    note('info', 'The overlay is a separate window drawn on top of the game. It does not read or change the game.'));
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
  const root = h('div', { class: 'stack' }, title('Music', 'Your own playlist, built in. Keeps playing while you are in game.', btnIcon('primary', 'plus', 'Add music', add)));
  root.append(h('div', { class: 'card row' },
    art(track >= 0 && m.files[track] ? name(m.files[track]) : 'music', 'anthems', 'sm'),
    h('div', { class: 'grow' }, h('h3', {}, playing ? 'Now playing' : 'Player'), h('b', {}, track >= 0 && m.files[track] ? name(m.files[track]) : 'Nothing playing')),
    h('button', { class: 'btn', onclick: () => play(track - 1) }, 'Prev'),
    h('button', { class: 'btn primary', onclick: () => { if (track < 0) play(0); else if (player.paused) { player.play(); render(); } else { player.pause(); render(); } } }, playing ? 'Pause' : 'Play'),
    h('button', { class: 'btn', onclick: () => play(track + 1) }, 'Next'),
    h('span', { class: 'muted small' }, 'Volume'),
    h('input', { type: 'range', min: 0, max: 100, value: Math.round(m.volume * 100), oninput: (e) => { player.volume = e.target.value / 100; }, onchange: (e) => set('music', { ...m, volume: e.target.value / 100 }) })));
  if (!m.files.length) { root.append(empty('anthems', 'Your playlist is empty', 'Add MP3, OGG, WAV, FLAC or M4A files from your PC.', btnIcon('', 'plus', 'Add music', add))); return root; }
  root.append(h('div', { class: 'list' }, m.files.map((f, i) => h('div', { class: 'item' },
    h('button', { class: `btn sm${i === track && playing ? ' primary' : ''}`, onclick: () => play(i) }, i === track && playing ? 'Playing' : 'Play'), h('div', { class: 'grow' }, name(f)),
    h('button', { class: 'btn sm danger', onclick: () => set('music', { ...m, files: m.files.filter((x) => x !== f) }) }, 'Remove')))));
  return root;
};

/* ---------- profile ---------- */

function profileCard(p) {
  const glow = p.glow ? `text-shadow:0 0 14px ${p.titleColor}` : '';
  return h('div', { class: 'pcard' },
    p.avatar ? h('img', { src: p.avatar, alt: '' }) : h('div', { class: 'ph' }, (p.name || '?')[0].toUpperCase()),
    h('div', {}, h('div', { class: 'pname' }, p.name || 'Your name'),
      h('div', { class: 'ptitle', style: `color:${p.titleColor};${glow}` }, p.title || 'Your title'),
      p.rank && h('span', { class: 'tag', style: 'margin-top:6px;display:inline-block' }, p.rank)));
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
  const friend = h('input', { type: 'text', class: 'grow', placeholder: 'A friend’s profile ID' });
  const lookup = async () => {
    const res = await fetch(`${url}/profiles/${encodeURIComponent(friend.value.trim())}`);
    if (!res.ok) throw new Error('Profile not found');
    lookedUp = await res.json();
  };
  return h('div', { class: 'stack' }, title('Profile', 'Your Boostpad card: any name, any title, your colours. Share it with other Boostpad users through a sync server.'),
    h('div', { class: 'cols' },
      h('div', { class: 'card kv' },
        h('b', {}, 'Name'), h('input', { type: 'text', maxlength: 24, value: p.name, onchange: (e) => upd({ name: e.target.value }) }),
        h('b', {}, 'Title'), h('input', { type: 'text', maxlength: 32, value: p.title, onchange: (e) => upd({ title: e.target.value }) }),
        h('b', {}, 'Title colour'), h('div', { class: 'swatches' }, COLORS.map((c) => h('button', { class: `swatch${p.titleColor === c ? ' on' : ''}`, style: `background:${c}`, onclick: () => upd({ titleColor: c }) }))),
        h('b', {}, 'Glow'), toggle(p.glow, (v) => upd({ glow: v })),
        h('b', {}, 'Rank badge'), h('select', { onchange: (e) => upd({ rank: e.target.value }) }, RANKS.map((r) => h('option', { value: r, selected: p.rank === r }, r || 'None'))),
        h('b', {}, 'Picture'), h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => run(async () => { const a = await api('pickAvatar'); return a ? api('setSetting', 'profile', { ...p, avatar: a }) : null; }) }, 'Choose picture'),
          p.avatar && h('button', { class: 'btn sm', onclick: () => upd({ avatar: '' }) }, 'Remove'))),
      h('div', { class: 'stack' },
        profileCard(p),
        h('div', { class: 'card stack' }, h('h3', {}, 'Sharing'),
          h('div', { class: 'row' }, h('input', { type: 'text', class: 'grow', placeholder: 'Sync server URL, e.g. http://localhost:8787', value: S.settings.syncUrl, onchange: (e) => set('syncUrl', e.target.value.trim()) }),
            h('button', { class: 'btn primary', disabled: !url, onclick: () => run(publish, 'Profile published.') }, 'Publish')),
          p.id && h('div', { class: 'muted small' }, `Your profile ID: ${p.id}`),
          h('div', { class: 'row' }, friend, h('button', { class: 'btn', disabled: !url, onclick: () => run(lookup) }, 'Look up')),
          lookedUp && profileCard(lookedUp),
          h('div', { class: 'muted small' }, 'Anyone can run the tiny server in the server/ folder. There is no central server and nothing to pay for.')))),
    note('info', 'This card lives in Boostpad. It does not change your name, title or rank inside Rocket League: that would need code injected into the running game, which Boostpad does not do.'));
};

/* ---------- settings ---------- */

views.settings = () => {
  const th = S.settings.theme, theme = (patch) => set('theme', { ...th, ...patch });
  return h('div', { class: 'stack' }, title('Settings'),
    h('div', { class: 'cols' },
      h('div', { class: 'stack' },
        h('div', { class: 'card stack' }, h('h3', {}, 'Game'),
          h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, 'Rocket League folder'), h('div', { class: 'muted small', style: 'word-break:break-all' }, S.install.dir)),
            h('button', { class: 'btn sm', onclick: () => run(() => api('browseInstall', S.install.platform)) }, 'Change')),
          h('div', { class: 'row' }, h('b', { class: 'grow' }, 'Launcher'), h('div', { class: 'chips' }, [['epic', 'Epic Games'], ['steam', 'Steam']].map(([id, label]) =>
            h('button', { class: `chip${S.install.platform === id ? ' on' : ''}`, onclick: () => set('platform', id) }, label))))),
        h('div', { class: 'card stack' }, h('h3', {}, 'Item swaps'),
          h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, 'Enable experimental item swaps'),
            h('div', { class: 'muted small' }, 'Lets the Garage rewrite item packages. Originals are always backed up and can be restored from the Active tab.')),
          toggle(S.settings.experimentalSwaps, (v) => set('experimentalSwaps', v))),
          note('warn', 'Rocket League runs with Easy Anti-Cheat. Boostpad does not touch or work around it, and cannot promise that modified files are accepted online. Changing game files may break the game’s terms of service and could put your account at risk. Use it at your own risk; the launcher’s “Verify files” always restores a clean install.'))),
      h('div', { class: 'stack' },
        h('div', { class: 'card stack' }, h('h3', {}, 'Theme'),
          h('div', { class: 'row' }, h('b', { class: 'grow' }, 'Accent'), h('div', { class: 'swatches' }, COLORS.slice(0, 8).map((c) => h('button', { class: `swatch${th.accent === c ? ' on' : ''}`, style: `background:${c}`, onclick: () => theme({ accent: c }) })),
            h('input', { type: 'color', value: th.accent, onchange: (e) => theme({ accent: e.target.value }) }))),
          h('div', { class: 'row' }, h('b', { class: 'grow' }, 'Background'), h('div', { class: 'chips' }, [['ink', 'Ink'], ['slate', 'Slate'], ['midnight', 'Midnight']].map(([id, label]) =>
            h('button', { class: `chip${th.background === id ? ' on' : ''}`, onclick: () => theme({ background: id }) }, label))))),
        h('div', { class: 'card stack' }, h('h3', {}, 'Data'),
          h('div', { class: 'muted small' }, 'Backups, maps, packs and settings live in the data folder.'),
          h('div', { class: 'row wrap' },
            h('button', { class: 'btn', onclick: () => api('openDataFolder') }, 'Open data folder'),
            h('button', { class: 'btn danger', disabled: !S.engine.active.length, onclick: () => run(() => api('revertAll'), 'Everything reverted.') }, 'Revert every change'))))),
    h('p', { class: 'muted small' }, 'Boostpad is a free, open-source fan project. Not affiliated with or endorsed by Psyonix or Epic Games. Rocket League is a trademark of Psyonix LLC.'));
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
