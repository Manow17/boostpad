/* Boostpad renderer. No framework: a small element helper and one render function per tab. */
const api = (method, ...args) => window.boostpad.call(method, ...args);

let S = null;          // latest snapshot from the main process
let catalog = null;    // item catalog, loaded on first use
const ui = { tab: location.hash.slice(1) || 'garage', cat: 'cars', q: '', slot: 'src', src: null, dst: null, check: null, packType: 'all' };
const player = new Audio();
let track = -1;

const TABS = [
  ['garage', 'Garage'], ['packs', 'Mod Packs'], ['maps', 'Workshop Maps'], ['presets', 'Presets'], ['active', 'Active'],
  ['tracker', 'MMR Tracker'], ['overlay', 'Overlay'], ['music', 'Music'], ['profile', 'Profile'], ['settings', 'Settings'],
];
const PACK_TYPES = [['all', 'All'], ['ball', 'Ball'], ['decal', 'Decals'], ['boostmeter', 'Boost meter'], ['wheels', 'Wheels'], ['menu', 'Lobby'], ['loading', 'Loading screen'], ['music', 'Menu music'], ['sound', 'Sounds'], ['other', 'Other']];
const PLAYLISTS = ['Duel 1v1', 'Doubles 2v2', 'Standard 3v3', 'Hoops', 'Rumble', 'Dropshot', 'Snow Day', 'Tournament'];
const RANKS = ['', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Champion', 'Grand Champion', 'Supersonic Legend'];
const COLORS = ['#ff7a1a', '#ffd166', '#3ddc97', '#35c2ff', '#6c8cff', '#b17aff', '#ff5fa2', '#ff5d6c', '#e9edf5'];

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

function art(name, cls = '') {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return h('div', { class: `art ${cls}`, style: `background:linear-gradient(135deg,hsl(${hue} 55% 34%),hsl(${(hue + 50) % 360} 60% 16%))` }, initials);
}

const toggle = (checked, onchange) => h('input', { type: 'checkbox', class: 'switch', checked, onchange: (e) => onchange(e.target.checked) });
const title = (text, sub, ...extra) => h('div', { class: 'row wrap' }, h('div', { class: 'grow' }, h('h2', {}, text), sub && h('p', { class: 'muted' }, sub)), extra);

/* ---------- shell ---------- */

function render() {
  document.documentElement.style.setProperty('--accent', S.settings.theme.accent);
  document.body.dataset.bg = S.settings.theme.background;
  const nav = document.getElementById('nav'), top = document.getElementById('top'), view = document.getElementById('view');
  nav.replaceChildren(h('div', { class: 'brand' }, h('i'), 'Boostpad'));
  top.replaceChildren();
  if (!S.install.valid) { view.replaceChildren(setup()); return; }

  const pending = S.engine.active.length + S.engine.queue.length;
  for (const [id, label] of TABS) {
    nav.append(h('button', { class: ui.tab === id ? 'on' : '', onclick: () => { ui.tab = id; location.hash = id; render(); } },
      label, id === 'active' && pending ? h('span', { class: 'count' }, pending) : null));
  }
  nav.append(h('div', { class: 'foot muted small' }, `v${S.version} · free and open source`));

  top.append(
    h('span', { class: `dot${S.running ? ' live' : ''}` }),
    h('span', { class: 'grow' }, S.running ? 'Rocket League is running. Changes are queued until it closes.' : 'Rocket League is not running.'),
    h('span', { class: 'tag' }, S.install.platform === 'steam' ? 'Steam' : 'Epic Games'),
    h('button', { class: 'btn primary', disabled: S.running, onclick: () => run(() => api('launchGame'), 'Starting Rocket League…') }, 'Play'),
  );
  view.replaceChildren((views[ui.tab] || views.garage)());
}

function setup() {
  const box = h('div', { class: 'setup stack' },
    h('h2', {}, 'Where do you play?'),
    h('p', { class: 'muted' }, 'Pick your launcher and Boostpad finds Rocket League for you.'));
  const choices = h('div', { class: 'choices' });
  const choose = (platform, label) => h('button', { class: 'choice', onclick: async () => {
    const found = await api('detectGame');
    if (found[platform]) run(() => api('setInstall', platform, found[platform]), 'Found Rocket League.');
    else { toast(`No ${label} install found. Select the "rocketleague" folder.`, true); run(() => api('browseInstall', platform)); }
  } }, h('b', {}, label), h('span', { class: 'muted' }, 'Detect automatically'));
  choices.append(choose('steam', 'Steam'), choose('epic', 'Epic Games'));
  box.append(choices, h('p', { class: 'note', style: 'text-align:left' },
    'Boostpad only changes files on your own PC, and keeps a backup of every file it touches. It is a fan project, not affiliated with Psyonix or Epic Games.'));
  return box;
}

/* ---------- garage: item swaps ---------- */

async function ensureCatalog() {
  if (!catalog) { catalog = await api('getCatalog'); render(); }
}

const views = {};

views.garage = () => {
  const root = h('div', { class: 'stack' }, title('Garage', 'Give an item you own the look of any other item. Only you see it.', h('span', { class: 'tag exp' }, 'Experimental')));
  if (!S.settings.experimentalSwaps) {
    root.append(h('div', { class: 'note warn' }, 'Item swaps rewrite game packages and have not been confirmed in game yet. ',
      h('button', { class: 'btn sm', onclick: () => { ui.tab = 'settings'; render(); } }, 'Turn on in Settings')));
  }
  if (!catalog) { ensureCatalog(); root.append(h('div', { class: 'empty' }, 'Reading your game files…')); return root; }

  const slot = (which, label, item, hint) => h('div', { class: `slot${ui.slot === which ? ' on' : ''}`, onclick: () => { ui.slot = which; render(); } },
    item ? art(item.name, 'sm') : h('div', { class: 'art sm', style: 'background:var(--panel-2)' }, which === 'src' ? '1' : '2'),
    h('div', {}, h('div', { class: 'label' }, label), h('div', { class: 'name' }, item ? item.name : hint)));

  const op = () => ({ kind: 'swap', sourceFile: ui.src.file, targetFile: ui.dst.file, category: ui.cat, label: `${ui.src.name} → ${ui.dst.name}` });
  const reasons = {
    NAME_TOO_LONG: 'Not supported yet: the new look has a longer internal name than your item. Try another pair.',
    NO_KEY: 'This item uses a newer package key that Boostpad cannot read.',
    SAME_ITEM: 'Pick two different items.',
  };
  const status = !ui.src || !ui.dst ? h('span', { class: 'muted small' }, 'Pick both items')
    : !ui.check ? h('span', { class: 'muted small' }, 'Checking…')
      : ui.check.ok ? h('span', { class: 'tag good' }, 'Ready to swap')
        : h('span', { class: 'small', style: 'color:var(--bad);max-width:200px;text-align:center' }, reasons[ui.check.code] || ui.check.message);
  const pool = () => catalog.items.filter((i) => i.category === ui.cat);
  root.append(h('div', { class: 'slots' },
    slot('src', 'Your item', ui.src, 'Pick an item you own'),
    h('div', { class: 'swapmid' },
      h('button', { class: 'btn primary', disabled: !(ui.check && ui.check.ok) || !S.settings.experimentalSwaps,
        onclick: () => run(() => api('apply', op()), queuedMsg) }, 'Swap'),
      status,
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', title: 'Random new look', disabled: !ui.src, onclick: () => { const p = pool(); pickItem(p[Math.floor(Math.random() * p.length)], 'dst'); } }, 'Random'),
        h('button', { class: 'btn sm', onclick: () => { ui.src = ui.dst = ui.check = null; ui.slot = 'src'; render(); } }, 'Clear'))),
    slot('dst', 'New look', ui.dst, 'Then pick its new look')));

  root.append(h('div', { class: 'row wrap' },
    h('div', { class: 'chips grow' }, catalog.categories.map((c) => h('button', { class: `chip${ui.cat === c.id ? ' on' : ''}`,
      onclick: () => { ui.cat = c.id; ui.src = ui.dst = ui.check = null; ui.slot = 'src'; render(); } }, c.label))),
    h('input', { type: 'text', placeholder: 'Search items…', value: ui.q, oninput: (e) => { ui.q = e.target.value; fill(); } })));

  const grid = h('div', { class: 'grid' }), more = h('p', { class: 'muted small' });
  function fill() {
    const q = ui.q.trim().toLowerCase();
    const list = pool().filter((i) => !q || i.name.toLowerCase().includes(q));
    grid.replaceChildren(...list.slice(0, 240).map((i) => h('button', {
      class: `tile${ui.src === i ? ' src' : ''}${ui.dst === i ? ' dst' : ''}`, title: i.file, onclick: () => pickItem(i, ui.slot),
    }, art(i.name), h('div', { class: 'name' }, i.name))));
    more.textContent = list.length > 240 ? `Showing 240 of ${list.length}. Search to narrow it down.` : `${list.length} item${list.length === 1 ? '' : 's'}`;
  }
  fill();
  root.append(grid, more);
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
  const root = h('div', { class: 'stack' }, title('Mod Packs', 'Custom balls, decals, boost meters, wheels, lobby backgrounds, loading screens, menu music and sounds.',
    h('button', { class: 'btn primary', onclick: async () => { packs = await api('packsImport'); render(); } }, 'Add pack folder')));
  if (!packs) { load('packs'); return root; }
  root.append(h('div', { class: 'chips' }, PACK_TYPES.map(([id, label]) => h('button', { class: `chip${ui.packType === id ? ' on' : ''}`, onclick: () => { ui.packType = id; render(); } }, label))));
  const shown = packs.filter((p) => ui.packType === 'all' || p.type === ui.packType);
  if (!shown.length) {
    root.append(h('div', { class: 'empty' }, 'No packs here yet.', h('br'),
      'A pack is a folder with replacement game files and a pack.json that says which file each one replaces. See the README for the format.'));
    return root;
  }
  const activeIds = new Set(S.engine.active.map((r) => r.op.packId));
  const queuedIds = new Set(S.engine.queue.filter((q) => q.op).map((q) => q.op.packId));
  root.append(h('div', { class: 'cards' }, shown.map((p) => h('div', { class: 'card stack' },
    h('div', { class: 'row' }, art(p.name, 'sm'), h('div', { class: 'grow' }, h('b', {}, p.name), h('div', { class: 'muted small' }, p.error || `${p.files.length} file${p.files.length === 1 ? '' : 's'}${p.author ? ` · by ${p.author}` : ''}`))),
    h('div', { class: 'row' },
      activeIds.has(p.id)
        ? h('button', { class: 'btn', onclick: () => run(() => api('packsRevert', p.id), 'Original files restored.') }, 'Remove from game')
        : h('button', { class: 'btn primary', disabled: !!p.error || queuedIds.has(p.id), onclick: () => run(() => api('packsApply', p.id), queuedMsg) }, queuedIds.has(p.id) ? 'Queued' : 'Apply'),
      h('span', { class: 'tag' }, p.type),
      h('button', { class: 'btn sm danger right', disabled: activeIds.has(p.id), onclick: async () => { packs = await api('packsRemove', p.id); render(); } }, 'Delete'))))));
  return root;
};

views.maps = () => {
  const root = h('div', { class: 'stack' }, title('Workshop Maps', 'Play training and challenge maps on Steam or Epic.',
    h('button', { class: 'btn primary', onclick: async () => { maps = await api('mapsAdd'); render(); } }, 'Add map files')));
  root.append(h('div', { class: 'note' }, 'A loaded map takes the place of the Underpass arena. In Rocket League open Training → Free Play and choose Underpass.'));
  if (!maps) { load('maps'); return root; }
  const slot = S.mapSlot.toLowerCase();
  const loaded = S.engine.active.find((r) => r.key === slot);
  const queued = S.engine.queue.find((q) => q.key === slot && q.op);
  if (!maps.length) { root.append(h('div', { class: 'empty' }, 'No maps yet. Add .upk or .udk map files you have downloaded.')); return root; }
  root.append(h('div', { class: 'list' }, maps.map((m) => {
    const isLoaded = loaded && loaded.op.from.endsWith(m.id), isQueued = queued && queued.op.from.endsWith(m.id);
    return h('div', { class: 'item' }, art(m.name, 'sm'),
      h('div', { class: 'grow' }, h('b', {}, m.name), h('div', { class: 'muted small' }, `${(m.size / 1048576).toFixed(1)} MB`)),
      isLoaded && h('span', { class: 'tag good' }, 'Loaded in Underpass'),
      isQueued && h('span', { class: 'tag exp' }, 'Queued'),
      isLoaded
        ? h('button', { class: 'btn', onclick: () => run(() => api('revert', slot), 'Underpass restored.') }, 'Unload')
        : h('button', { class: 'btn primary', onclick: () => run(() => api('mapsLoad', m.id), queuedMsg) }, 'Load'),
      h('button', { class: 'btn sm danger', disabled: !!isLoaded, onclick: async () => { maps = await api('mapsRemove', m.id); render(); } }, 'Delete'));
  })));
  return root;
};

/* ---------- presets & active ---------- */

views.presets = () => {
  const name = h('input', { type: 'text', placeholder: 'Name this setup', maxlength: 40 });
  const paste = h('input', { type: 'text', class: 'grow', placeholder: 'Paste a shared preset code here' });
  const root = h('div', { class: 'stack' }, title('Presets', 'Save everything that is active right now and switch between setups in one click. No limit.'),
    h('div', { class: 'card row wrap' }, h('b', {}, `${S.engine.active.length} active change${S.engine.active.length === 1 ? '' : 's'}`), name,
      h('button', { class: 'btn primary', onclick: () => run(() => api('presetSave', name.value), 'Preset saved.') }, 'Save as preset')),
    h('div', { class: 'row' }, paste, h('button', { class: 'btn', onclick: () => run(() => api('presetImport', paste.value), 'Preset imported.') }, 'Import')));
  const list = S.settings.presets;
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
  const communityBox = h('div', { class: 'stack' }, h('div', { class: 'row' }, h('h3', { class: 'grow' }, 'Community'),
    url ? h('button', { class: 'btn sm', onclick: () => run(browse) }, 'Browse shared presets') : h('span', { class: 'muted small' }, 'Set a sync server in Profile to share presets.')),
  community && (community.length ? h('div', { class: 'cards' }, community.map((c) => h('div', { class: 'card stack' },
    h('div', {}, h('b', {}, c.name), h('div', { class: 'muted small' }, `${c.ops.length} swap${c.ops.length === 1 ? '' : 's'}${c.author ? ` · by ${c.author}` : ''}`)),
    h('button', { class: 'btn', onclick: () => run(() => api('presetImport', JSON.stringify({ boostpadPreset: 1, name: c.name, ops: c.ops })), 'Saved to your presets.') }, 'Save'))))
    : h('div', { class: 'muted small' }, 'Nothing shared on this server yet.')));
  if (!list.length) { root.append(h('div', { class: 'empty' }, 'No presets yet.'), communityBox); return root; }
  root.append(h('div', { class: 'cards' }, list.map((p) => h('div', { class: 'card stack' },
    h('div', {}, h('b', {}, p.name), h('div', { class: 'muted small' }, `${p.ops.length} change${p.ops.length === 1 ? '' : 's'} · ${new Date(p.savedAt).toLocaleDateString()}`)),
    h('div', { class: 'muted small' }, p.ops.slice(0, 4).map((o) => o.label).join(' · ')),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => run(() => api('presetLoad', p.id), (r) => (r.errors.length ? `Loaded with ${r.errors.length} problem(s): ${r.errors[0]}` : 'Preset loaded.')) }, 'Load'),
      h('button', { class: 'btn sm', onclick: async () => { await navigator.clipboard.writeText(await api('presetExport', p.id)); toast('Share code copied.'); } }, 'Copy code'),
      url && h('button', { class: 'btn sm', onclick: () => run(() => publish(p), 'Published to the sync server.') }, 'Publish'),
      h('button', { class: 'btn sm danger right', onclick: () => run(() => api('presetDelete', p.id)) }, 'Delete'))))), communityBox);
  return root;
};
let community = null;

views.active = () => {
  const { active, queue } = S.engine;
  const root = h('div', { class: 'stack' }, title('Active', 'Everything Boostpad has changed in your game. Revert any of it to put the original file back.',
    h('button', { class: 'btn danger', disabled: !active.length, onclick: () => run(() => api('revertAll'), 'Everything reverted.') }, 'Revert all')));
  if (queue.length) {
    root.append(h('h3', {}, 'Waiting for Rocket League to close'), h('div', { class: 'list' }, queue.map((q) => h('div', { class: 'item' },
      h('span', { class: 'tag exp' }, q.type === 'apply' ? 'Apply' : 'Revert'), h('div', { class: 'grow' }, q.op ? q.op.label : q.key),
      h('button', { class: 'btn sm', onclick: () => run(() => api('unqueue', q.key)) }, 'Cancel')))));
  }
  if (!active.length) { root.append(h('div', { class: 'empty' }, 'Nothing is changed. Your game files are original.')); return root; }
  root.append(h('h3', {}, 'In your game now'), h('div', { class: 'list' }, active.map((r) => h('div', { class: 'item' },
    art(r.op.label || r.file, 'sm'),
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
  const input = h('input', { type: 'number', placeholder: 'MMR after your match', style: 'width:190px' });
  const log = () => { const mmr = Number(input.value); if (mmr > 0) set('tracker', { ...t, entries: [...t.entries, { playlist: t.playlist, mmr, at: Date.now() }].slice(-500) }); };
  let spark = null;
  if (mine.length > 1) {
    const pts = mine.slice(-40), lo = Math.min(...pts.map((p) => p.mmr)), hi = Math.max(...pts.map((p) => p.mmr));
    spark = h('div', { class: 'card' });
    spark.innerHTML = `<svg viewBox="0 0 400 80" width="100%" height="80" preserveAspectRatio="none"><polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${pts.map((p, i) => `${(i / (pts.length - 1)) * 400},${72 - ((p.mmr - lo) / (hi - lo || 1)) * 64}`).join(' ')}"/></svg>`;
  }
  return h('div', { class: 'stack' }, title('MMR Tracker', 'Log your rating after matches to follow your session. The number can also sit on screen in the overlay.'),
    h('div', { class: 'chips' }, PLAYLISTS.map((p) => h('button', { class: `chip${t.playlist === p ? ' on' : ''}`, onclick: () => set('tracker', { ...t, playlist: p }) }, p))),
    h('div', { class: 'card row wrap' },
      h('div', { class: 'grow' }, h('h3', {}, t.playlist), h('div', { class: 'big' }, last ? last.mmr : '—'),
        h('div', { class: 'small', style: `color:var(--${delta < 0 ? 'bad' : 'good'})` }, last ? `${delta >= 0 ? '+' : ''}${delta} today · peak ${Math.max(...mine.map((e) => e.mmr))} · ${mine.length} logged` : 'Nothing logged yet')),
      input, h('button', { class: 'btn primary', onclick: log }, 'Log'),
      h('button', { class: 'btn sm danger', disabled: !last, onclick: () => set('tracker', { ...t, entries: t.entries.filter((e) => e !== last) }) }, 'Undo last')),
    spark,
    h('div', { class: 'note' }, 'Ratings are entered by hand: Rocket League has no public stats API, and the stats sites block automated readers.'));
};

views.overlay = () => {
  const o = S.settings.overlay, upd = (patch) => set('overlay', { ...o, ...patch });
  return h('div', { class: 'stack' }, title('Overlay', 'A small always-on-top window over the game. Run Rocket League in borderless mode to see it.'),
    h('div', { class: 'card kv' },
      h('div', {}, h('b', {}, 'Controller'), h('div', { class: 'muted small' }, 'Shows every button, stick and trigger you press, live.')), toggle(o.controller, (v) => upd({ controller: v })),
      h('div', {}, h('b', {}, 'MMR counter'), h('div', { class: 'muted small' }, 'Your latest logged rating for the selected playlist.')), toggle(o.mmr, (v) => upd({ mmr: v })),
      h('b', {}, 'Controller colour'), h('div', { class: 'chips' }, ['light', 'dark'].map((s) => h('button', { class: `chip${o.style === s ? ' on' : ''}`, onclick: () => upd({ style: s }) }, s === 'light' ? 'White' : 'Black'))),
      h('b', {}, `Size ${o.size}%`), h('input', { type: 'range', min: 50, max: 160, value: o.size, onchange: (e) => upd({ size: Number(e.target.value) }) })),
    h('div', { class: 'note' }, 'The overlay is a separate window drawn on top of the game. It does not read or change the game.'));
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
  const root = h('div', { class: 'stack' }, title('Music', 'Your own playlist, built in. Keeps playing while you are in game.',
    h('button', { class: 'btn primary', onclick: () => run(() => api('musicAdd')) }, 'Add music')));
  root.append(h('div', { class: 'card row' },
    h('button', { class: 'btn', onclick: () => play(track - 1) }, 'Prev'),
    h('button', { class: 'btn primary', onclick: () => { if (track < 0) play(0); else if (player.paused) { player.play(); render(); } else { player.pause(); render(); } } }, track >= 0 && !player.paused ? 'Pause' : 'Play'),
    h('button', { class: 'btn', onclick: () => play(track + 1) }, 'Next'),
    h('div', { class: 'grow' }, track >= 0 && m.files[track] ? name(m.files[track]) : 'Nothing playing'),
    h('span', { class: 'muted small' }, 'Volume'),
    h('input', { type: 'range', min: 0, max: 100, value: Math.round(m.volume * 100), oninput: (e) => { player.volume = e.target.value / 100; }, onchange: (e) => set('music', { ...m, volume: e.target.value / 100 }) })));
  if (!m.files.length) { root.append(h('div', { class: 'empty' }, 'Add some audio files to start.')); return root; }
  root.append(h('div', { class: 'list' }, m.files.map((f, i) => h('div', { class: 'item' },
    h('button', { class: 'btn sm', onclick: () => play(i) }, i === track && !player.paused ? 'Playing' : 'Play'), h('div', { class: 'grow' }, name(f)),
    h('button', { class: 'btn sm danger', onclick: () => set('music', { ...m, files: m.files.filter((x) => x !== f) }) }, 'Remove')))));
  return root;
};

/* ---------- profile ---------- */

function profileCard(p) {
  const glow = p.glow ? `text-shadow:0 0 12px ${p.titleColor}` : '';
  return h('div', { class: 'pcard' },
    p.avatar ? h('img', { src: p.avatar, alt: '' }) : h('div', { class: 'ph' }, (p.name || '?')[0].toUpperCase()),
    h('div', {}, h('div', { class: 'pname' }, p.name || 'Your name'),
      h('div', { class: 'ptitle', style: `color:${p.titleColor};${glow}` }, p.title || 'Your title'),
      p.rank && h('div', { class: 'muted small' }, p.rank)));
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
    profileCard(p),
    h('div', { class: 'card kv' },
      h('b', {}, 'Name'), h('input', { type: 'text', maxlength: 24, value: p.name, onchange: (e) => upd({ name: e.target.value }) }),
      h('b', {}, 'Title'), h('input', { type: 'text', maxlength: 32, value: p.title, onchange: (e) => upd({ title: e.target.value }) }),
      h('b', {}, 'Title colour'), h('div', { class: 'swatches' }, COLORS.map((c) => h('button', { class: `swatch${p.titleColor === c ? ' on' : ''}`, style: `background:${c}`, onclick: () => upd({ titleColor: c }) }))),
      h('b', {}, 'Glow'), toggle(p.glow, (v) => upd({ glow: v })),
      h('b', {}, 'Rank badge'), h('select', { onchange: (e) => upd({ rank: e.target.value }) }, RANKS.map((r) => h('option', { value: r, selected: p.rank === r }, r || 'None'))),
      h('b', {}, 'Picture'), h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => run(async () => { const a = await api('pickAvatar'); return a ? api('setSetting', 'profile', { ...p, avatar: a }) : null; }) }, 'Choose picture'),
        p.avatar && h('button', { class: 'btn sm', onclick: () => upd({ avatar: '' }) }, 'Remove'))),
    h('div', { class: 'note' }, 'This card lives in Boostpad. It does not change your name, title or rank inside Rocket League: that would need code injected into the running game, which Boostpad does not do.'),
    h('h3', {}, 'Sharing'),
    h('div', { class: 'card stack' },
      h('div', { class: 'row' }, h('input', { type: 'text', class: 'grow', placeholder: 'Sync server URL, e.g. http://localhost:8787', value: S.settings.syncUrl, onchange: (e) => set('syncUrl', e.target.value.trim()) }),
        h('button', { class: 'btn primary', disabled: !url, onclick: () => run(publish, 'Profile published.') }, 'Publish')),
      p.id && h('div', { class: 'muted small' }, `Your profile ID: ${p.id}`),
      h('div', { class: 'row' }, friend, h('button', { class: 'btn', disabled: !url, onclick: () => run(lookup) }, 'Look up')),
      lookedUp && profileCard(lookedUp),
      h('div', { class: 'muted small' }, 'Anyone can run the tiny server in the server/ folder. There is no central server and nothing to pay for.')));
};

/* ---------- settings ---------- */

views.settings = () => {
  const th = S.settings.theme, theme = (patch) => set('theme', { ...th, ...patch });
  return h('div', { class: 'stack' }, title('Settings'),
    h('h3', {}, 'Game'),
    h('div', { class: 'card kv' },
      h('b', {}, 'Rocket League folder'), h('div', { class: 'row' }, h('span', { class: 'grow muted small' }, S.install.dir),
        h('button', { class: 'btn sm', onclick: () => run(() => api('browseInstall', S.install.platform)) }, 'Change')),
      h('b', {}, 'Launcher'), h('div', { class: 'chips' }, [['epic', 'Epic Games'], ['steam', 'Steam']].map(([id, label]) =>
        h('button', { class: `chip${S.install.platform === id ? ' on' : ''}`, onclick: () => set('platform', id) }, label)))),
    h('h3', {}, 'Item swaps'),
    h('div', { class: 'card stack' },
      h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, 'Enable experimental item swaps'),
        h('div', { class: 'muted small' }, 'Lets the Garage rewrite item packages. Originals are always backed up and can be restored from the Active tab.')),
      toggle(S.settings.experimentalSwaps, (v) => set('experimentalSwaps', v))),
      h('div', { class: 'note warn' }, 'Rocket League runs with Easy Anti-Cheat. Boostpad does not touch or work around it, and cannot promise that modified files are accepted online. Changing game files may break the game’s terms of service and could put your account at risk. Use it at your own risk; the launcher’s “Verify files” always restores a clean install.')),
    h('h3', {}, 'Theme'),
    h('div', { class: 'card kv' },
      h('b', {}, 'Accent'), h('div', { class: 'row' }, h('div', { class: 'swatches' }, COLORS.slice(0, 8).map((c) => h('button', { class: `swatch${th.accent === c ? ' on' : ''}`, style: `background:${c}`, onclick: () => theme({ accent: c }) }))),
        h('input', { type: 'color', value: th.accent, onchange: (e) => theme({ accent: e.target.value }) })),
      h('b', {}, 'Background'), h('div', { class: 'chips' }, [['ink', 'Ink'], ['slate', 'Slate'], ['midnight', 'Midnight']].map(([id, label]) =>
        h('button', { class: `chip${th.background === id ? ' on' : ''}`, onclick: () => theme({ background: id }) }, label)))),
    h('h3', {}, 'Data'),
    h('div', { class: 'card row wrap' },
      h('button', { class: 'btn', onclick: () => api('openDataFolder') }, 'Open data folder'),
      h('button', { class: 'btn danger', disabled: !S.engine.active.length, onclick: () => run(() => api('revertAll'), 'Everything reverted.') }, 'Revert every change'),
      h('span', { class: 'muted small' }, 'Backups, maps, packs and settings live in the data folder.')),
    h('p', { class: 'muted small' }, 'Boostpad is a free, open-source fan project. Not affiliated with or endorsed by Psyonix or Epic Games. Rocket League is a trademark of Psyonix LLC.'));
};

/* ---------- boot ---------- */

window.boostpad.on('state', ({ state, flushed }) => {
  S = state;
  const ok = flushed.filter((f) => f.ok).length, failed = flushed.filter((f) => !f.ok);
  if (ok) toast(`${ok} queued change${ok === 1 ? '' : 's'} applied.`);
  for (const f of failed) toast(`${f.key}: ${f.message}`, true);
  render();
});
api('getState').then((s) => { S = s; render(); });
