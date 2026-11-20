const { app, BrowserWindow, ipcMain, dialog, shell, screen, protocol, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const game = require('./core/game');
const { Store } = require('./core/store');
const { Engine } = require('./core/engine');
const { buildCatalog, annotate } = require('./core/catalog');
const { readThumbnail } = require('./core/thumbs');
const mediaBridge = require('./media');
const upk = require('./core/upk');
const { Maps, MAP_SLOT } = require('./core/library');
const arenas = require('./core/arenas');
const { readLabels, applyLabels } = require('./core/labels');

const DEFAULTS = {
  platform: null,
  installDir: null,
  theme: { mode: 'dark' },
  presets: [],
  profile: { name: '', title: '', titleColor: '#00d8c8', glow: false, rank: '', avatar: '' },
  overlay: {
    onlyInGame: true, // show overlays only while Rocket League is the window in front
    pad: { on: false, x: null, y: null, size: 100, opacity: 100, body: '#f2f3f5', keys: '#1b1c21', glow: '#00d8c8' },
    music: { on: false, x: null, y: null, size: 100, source: 'auto' },
  },
};

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const smokeShot = arg('smoke'); // --smoke=<png path>: render once, save a screenshot, quit
if (arg('data')) app.setPath('userData', path.resolve(arg('data')));

let win = null, settings, engine, maps, catalog = null, arenaList = null, running = false;

const ACCENT = '#00d8c8';
const ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');
// Window colours per theme: page background and the colour of the minimise/maximise/close glyphs.
const CHROME = { dark: { bg: '#0e0f12', symbol: '#f1f2f4' }, light: { bg: '#e7e8ec', symbol: '#17181c' } };
const chrome = () => CHROME[settings.get('theme').mode] || CHROME.dark;
const titleBar = () => ({ color: '#00000000', symbolColor: chrome().symbol, height: 60 });
function applyChrome() {
  if (!win || win.isDestroyed()) return;
  win.setBackgroundColor(chrome().bg);
  win.setTitleBarOverlay(titleBar());
}

// Item pictures, served to the page as thumb://item/<file>. Each one is decoded
// from the game's own thumbnail package on first use and kept as a small JPEG.
const THUMB_SIZE = 192;
function thumbnail(file) {
  if (path.basename(file) !== file || !/_T_SF\.upk$/i.test(file) || !cooked()) return null;
  const dir = path.join(app.getPath('userData'), 'thumbs');
  const cached = path.join(dir, `${file.toLowerCase()}.jpg`);
  if (fs.existsSync(cached)) { const jpg = fs.readFileSync(cached); return jpg.length ? jpg : null; }
  fs.mkdirSync(dir, { recursive: true });
  let jpg = Buffer.alloc(0); // an empty file remembers "this one has no readable picture"
  try {
    const { width, height, bgra } = readThumbnail(cooked(), file, extraKeys);
    jpg = nativeImage.createFromBitmap(bgra, { width, height }).resize({ width: THUMB_SIZE, height: THUMB_SIZE, quality: 'best' }).toJPEG(86);
  } catch { /* unreadable package or unknown layout */ }
  fs.writeFileSync(cached, jpg);
  return jpg.length ? jpg : null;
}

// Extra decryption keys the user has added (keys.txt in the data folder). Boostpad
// ships only the long-published default key; newer items need a key list.
let extraKeys = [];
const keysFile = () => path.join(app.getPath('userData'), 'keys.txt');
function loadKeys() {
  try { extraKeys = upk.parseKeys(fs.readFileSync(keysFile(), 'utf8')); } catch { extraKeys = []; }
}
// Forget "no readable picture" answers, so they are tried again with the current keys.
function retryMissingThumbs() {
  const dir = path.join(app.getPath('userData'), 'thumbs');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    const file = path.join(dir, name);
    if (fs.statSync(file).size === 0) fs.rmSync(file, { force: true });
  }
}

const cooked = () => (settings.get('installDir') ? game.cookedDir(settings.get('installDir')) : null);
const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

// Lists the items and checks which packages are readable. The check is remembered
// per file; the first run (or the first after adding keys) takes a few seconds, so
// it is done in slices to keep the window responsive.
let catalogJob = null;
async function buildIndex() {
  const dir = cooked(), keys = extraKeys;
  const built = buildCatalog(dir);
  const index = new Store(path.join(app.getPath('userData'), 'index.json'), { dir: '', keys: 0, files: {} });
  const fresh = index.get('dir') === dir && index.get('keys') === keys.length;
  const files = fresh ? index.get('files') : {};
  if (!fresh) retryMissingThumbs();
  const swapped = new Set(engine.list().active.map((r) => r.key));
  for (let i = 0; i < built.items.length; i += 120) {
    annotate(dir, built.items.slice(i, i + 120), files, swapped, keys);
    await new Promise((resolve) => setImmediate(resolve));
  }
  index.data = { dir, keys: keys.length, files };
  index.save();
  // real item names, from the game's own text file
  built.named = applyLabels(built.items, readLabels(dir, keys));
  built.items.sort((a, b) => a.label.localeCompare(b.label));
  if (dir === cooked() && keys === extraKeys) catalog = built; // nothing changed while we worked
}

function snapshot() {
  const dir = settings.get('installDir');
  return {
    version: app.getVersion(),
    settings: settings.data,
    install: { platform: settings.get('platform'), dir, valid: !!dir && game.isValidInstall(dir) },
    running,
    engine: engine.list(),
    mapSlot: MAP_SLOT,
    keys: extraKeys.length,
    overlayMove: overlayEdit,
  };
}

async function pick(options) {
  const res = await dialog.showOpenDialog(win, options);
  return res.canceled ? [] : res.filePaths;
}

// ---- overlays: click-through windows drawn over the game ----
// Two of them: the controller ("pad") and the now-playing pill ("music"). Each has
// its own position, size and look in settings.overlay, and is shown only while
// Rocket League is the window in front (unless that option is off, or the user is
// previewing or moving them).
const OVERLAYS = {
  pad: { page: 'overlay.html', width: 420, height: 300 },
  music: { page: 'nowplaying.html', width: 400, height: 70 },
};
const ANCHORS = ['tl', 'tc', 'tr', 'bl', 'bc', 'br'];
const DEFAULT_ANCHOR = { pad: 'br', music: 'tc' };
const overlayWins = {};
let overlayEdit = false, previewUntil = 0, previewTimer = null;
let foreground = ''; // process name of the window in front, '' when unknown

const inGame = () => (foreground ? /^RocketLeague/i.test(foreground) : running);
const overlaySize = (kind) => {
  const scale = settings.get('overlay')[kind].size / 100;
  return { width: Math.round(OVERLAYS[kind].width * scale), height: Math.round(OVERLAYS[kind].height * scale) };
};
function anchorPosition(kind, anchor) {
  const area = screen.getPrimaryDisplay().bounds, { width, height } = overlaySize(kind), gap = 16;
  const x = anchor[1] === 'l' ? area.x + gap : anchor[1] === 'r' ? area.x + area.width - width - gap : area.x + Math.round((area.width - width) / 2);
  const y = anchor[0] === 't' ? area.y + gap : area.y + area.height - height - gap;
  return { x, y };
}
function overlayPayload(kind) {
  return { ...settings.get('overlay')[kind], edit: overlayEdit };
}
function overlayShown(kind) {
  const o = settings.get('overlay');
  return o[kind].on && (overlayEdit || Date.now() < previewUntil || !o.onlyInGame || inGame());
}
function syncOverlays() {
  const o = settings.get('overlay');
  for (const kind of Object.keys(OVERLAYS)) {
    const cfg = o[kind];
    let w = overlayWins[kind];
    if (!cfg.on) { if (w && !w.isDestroyed()) w.destroy(); delete overlayWins[kind]; continue; }
    const size = overlaySize(kind);
    const at = cfg.x == null || cfg.y == null ? anchorPosition(kind, DEFAULT_ANCHOR[kind]) : { x: cfg.x, y: cfg.y };
    if (!w || w.isDestroyed()) {
      w = overlayWins[kind] = new BrowserWindow({
        ...size, ...at, frame: false, transparent: true, resizable: false, skipTaskbar: true, focusable: false, show: false, hasShadow: false, icon: ICON,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
      });
      w.setAlwaysOnTop(true, 'screen-saver');
      w.loadFile(path.join(__dirname, '../renderer', OVERLAYS[kind].page));
      // dragged to a new place while "Move overlays" is on: remember it
      w.on('moved', () => {
        if (!overlayEdit || w.isDestroyed()) return;
        const [x, y] = w.getPosition();
        const next = settings.get('overlay');
        next[kind] = { ...next[kind], x, y };
        settings.set('overlay', next);
        send('state', { state: snapshot(), flushed: [] });
      });
    }
    const b = w.getBounds();
    if (b.width !== size.width || b.height !== size.height || b.x !== at.x || b.y !== at.y) w.setBounds({ ...at, ...size });
    w.setIgnoreMouseEvents(!overlayEdit);
    w.setFocusable(overlayEdit);
    w.webContents.send('overlay-config', overlayPayload(kind));
    if (overlayShown(kind)) { if (!w.isVisible()) w.showInactive(); } else if (w.isVisible()) w.hide();
  }
}

// What is playing, read from Windows' media controls (any app that shows up there).
// (test hook: --fake-media gives test runs a made-up track, so the pages can be screenshotted)
let mediaState = smokeShot && process.argv.includes('--fake-media')
  ? { found: true, app: 'Spotify.exe', source: 'Spotify', title: 'Example Track', artist: 'Example Artist', album: 'Example Album', playing: true, position: 62, duration: 201, updated: Date.now(), art: '' }
  : { found: false };
let mediaWatcher = null;
function startMedia() {
  if (mediaWatcher) mediaWatcher.stop();
  mediaWatcher = mediaBridge.watch({
    source: settings.get('overlay').music.source,
    onState(state) {
      mediaState = state;
      send('media', state);
      const w = overlayWins.music;
      if (w && !w.isDestroyed()) w.webContents.send('media', state);
    },
    onForeground(name) { foreground = name; syncOverlays(); },
  });
}

// Everything the UI can ask for. Each method returns plain JSON.
const api = {
  getState: () => snapshot(),
  detectGame: () => game.detect(),

  setInstall(platform, dir) {
    if (!game.isValidInstall(dir)) throw new Error('That folder does not contain TAGame\\CookedPCConsole');
    settings.set('platform', platform);
    settings.set('installDir', dir);
    catalog = null;
    arenaList = null;
    return snapshot();
  },
  async browseInstall(platform) {
    const [dir] = await pick({ title: 'Select the rocketleague folder', properties: ['openDirectory'] });
    return dir ? api.setInstall(platform, dir) : snapshot();
  },
  setSetting(key, value) {
    if (!(key in DEFAULTS)) throw new Error(`Unknown setting ${key}`);
    settings.set(key, value);
    if (key === 'overlay') {
      syncOverlays();
      if (value.music.source !== (mediaWatcher && mediaWatcher.source)) startMedia(); // follow a different app
    }
    if (key === 'theme') applyChrome();
    return snapshot();
  },

  async getCatalog() {
    if (!catalog) {
      catalogJob ??= buildIndex().finally(() => { catalogJob = null; });
      await catalogJob;
    }
    return catalog;
  },

  checkSwap: (op) => engine.checkSwap(op),
  async apply(op) {
    const res = await engine.apply(op);
    return { ...res, state: snapshot() };
  },
  async revert(key) { await engine.revert(key); return snapshot(); },
  async revertAll() { await engine.revertAll(); return snapshot(); },
  unqueue(key) { engine.unqueue(key); return snapshot(); },

  mapsList: () => maps.list(),
  async mapsAdd() {
    const files = await pick({ title: 'Add workshop map files', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Maps', extensions: ['upk', 'udk'] }] });
    maps.add(files);
    return maps.list();
  },
  mapsRemove(id) { maps.remove(id); return maps.list(); },
  mapsLoad: (id) => api.apply(maps.op(id)),

  // Map Merge: arenas and the part files they load
  arenas() {
    if (!arenaList) {
      const cache = new Store(path.join(app.getPath('userData'), 'arenas.json'), { dir: '', keys: 0, files: {} });
      const files = cache.get('dir') === cooked() && cache.get('keys') === extraKeys.length ? cache.get('files') : {};
      arenaList = arenas.scanArenas(cooked(), files, extraKeys);
      cache.data = { dir: cooked(), keys: extraKeys.length, files };
      cache.save();
    }
    return arenaList;
  },
  mergeArenas(donorId, baseId) {
    const list = api.arenas(), find = (id) => list.find((a) => a.id === id);
    if (!find(donorId) || !find(baseId)) throw new Error('Arena not found');
    return api.apply(arenas.mergeOp(find(donorId), find(baseId)));
  },
  snowArena(id) {
    const arena = api.arenas().find((a) => a.id === id);
    if (!arena) throw new Error('Arena not found');
    return api.apply(arenas.snowOp(arena));
  },

  presetSave(name) {
    const ops = engine.list().active.map((r) => r.op);
    if (!ops.length) throw new Error('Nothing is active yet. Apply something first.');
    const presets = settings.get('presets');
    presets.push({ id: Date.now().toString(36), name: String(name).slice(0, 40) || 'My setup', ops, savedAt: Date.now() });
    settings.set('presets', presets);
    return snapshot();
  },
  async presetLoad(id) {
    const preset = settings.get('presets').find((p) => p.id === id);
    if (!preset) throw new Error('Preset not found');
    await engine.revertAll();
    const errors = [];
    for (const op of preset.ops) {
      try { await engine.apply(op); } catch (e) { errors.push(`${op.label || op.gameFile || op.sourceFile}: ${e.message}`); }
    }
    return { errors, state: snapshot() };
  },
  presetDelete(id) {
    settings.set('presets', settings.get('presets').filter((p) => p.id !== id));
    return snapshot();
  },
  presetExport(id) {
    const p = settings.get('presets').find((x) => x.id === id);
    // only swaps are portable: file ops point at paths on this PC
    return JSON.stringify({ boostpadPreset: 1, name: p.name, ops: p.ops.filter((o) => o.kind === 'swap') });
  },
  presetImport(text) {
    const data = JSON.parse(text);
    if (data.boostpadPreset !== 1 || !Array.isArray(data.ops)) throw new Error('Not a Boostpad preset');
    const ops = data.ops.filter((o) => o.kind === 'swap' && typeof o.sourceFile === 'string' && typeof o.targetFile === 'string')
      .map((o) => ({ kind: 'swap', sourceFile: path.basename(o.sourceFile), targetFile: path.basename(o.targetFile), label: String(o.label || ''), category: String(o.category || '') }));
    const presets = settings.get('presets');
    presets.push({ id: Date.now().toString(36), name: String(data.name || 'Imported').slice(0, 40), ops, savedAt: Date.now() });
    settings.set('presets', presets);
    return snapshot();
  },

  mediaState: () => mediaState,
  mediaSources: () => mediaBridge.SOURCES.map(({ id, name }) => ({ id, name })),
  mediaControl(action) { mediaBridge.control(action, settings.get('overlay').music.source); },
  async pickAvatar() {
    const [file] = await pick({ title: 'Choose a picture', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (!file) return null;
    if (fs.statSync(file).size > 400 * 1024) throw new Error('Picture must be under 400 KB');
    const ext = path.extname(file).slice(1).replace('jpg', 'jpeg');
    return `data:image/${ext};base64,${fs.readFileSync(file).toString('base64')}`;
  },

  launchGame() { shell.openExternal(game.launchUrl(settings.get('platform'))); },
  openDataFolder() { shell.openPath(app.getPath('userData')); },

  async importKeys() {
    const [file] = await pick({ title: 'Choose a key list (keys.txt)', properties: ['openFile'], filters: [{ name: 'Key list', extensions: ['txt'] }] });
    if (!file) return snapshot();
    const text = fs.readFileSync(file, 'utf8');
    if (!upk.parseKeys(text).length) throw new Error('No keys found in that file. Expected one key per line (64 hex characters or base64).');
    fs.writeFileSync(keysFile(), text);
    return api.reloadKeys();
  },
  removeKeys() {
    fs.rmSync(keysFile(), { force: true });
    return api.reloadKeys();
  },
  reloadKeys() {
    loadKeys();
    retryMissingThumbs();
    catalog = null;
    return snapshot();
  },
  overlayConfig: (kind) => overlayPayload(kind),
  // let the user drag the overlays to where they want them
  overlayMove(on) { overlayEdit = !!on; syncOverlays(); return snapshot(); },
  overlayPreview() {
    previewUntil = Date.now() + 8000;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(syncOverlays, 8100);
    syncOverlays();
  },
  overlayAnchor(kind, anchor) {
    if (!OVERLAYS[kind] || !(ANCHORS.includes(anchor) || anchor === 'reset')) throw new Error('Unknown position');
    const next = settings.get('overlay');
    next[kind] = { ...next[kind], ...(anchor === 'reset' ? { x: null, y: null } : anchorPosition(kind, anchor)) };
    settings.set('overlay', next);
    syncOverlays();
    return snapshot();
  },
};

async function poll() {
  const now = await game.isRunning();
  if (now === running) return;
  running = now;
  syncOverlays();
  let flushed = [];
  if (!running) flushed = await engine.flushQueue();
  send('state', { state: snapshot(), flushed });
}

protocol.registerSchemesAsPrivileged([{ scheme: 'thumb', privileges: { standard: true, secure: true } }]);
app.setAppUserModelId('io.github.boostpad'); // own taskbar identity and icon on Windows

app.whenReady().then(async () => {
  const data = app.getPath('userData');
  settings = new Store(path.join(data, 'settings.json'), DEFAULTS);
  engine = new Engine({
    store: new Store(path.join(data, 'state.json')),
    backupDir: path.join(data, 'backups'),
    getCookedDir: cooked,
    isRunning: game.isRunning,
    getKeys: () => extraKeys,
  });
  loadKeys();
  maps = new Maps(path.join(data, 'maps'));
  // settings from an older version: bring the overlay options into the current shape
  const saved = settings.get('overlay');
  if (!saved.pad || !saved.music) {
    settings.set('overlay', { ...DEFAULTS.overlay, pad: { ...DEFAULTS.overlay.pad, on: !!saved.controller }, music: { ...DEFAULTS.overlay.music, on: !!saved.nowPlaying } });
  }
  if (cooked() && game.isValidInstall(settings.get('installDir'))) engine.reconcile();
  running = await game.isRunning();

  protocol.handle('thumb', (request) => {
    let jpg = null;
    try { jpg = thumbnail(decodeURIComponent(new URL(request.url).pathname.slice(1))); } catch { /* answered as missing */ }
    return jpg
      ? new Response(jpg, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'max-age=31536000, immutable' } })
      : new Response('', { status: 404 });
  });

  ipcMain.handle('api', async (_e, method, ...args) => {
    if (!Object.hasOwn(api, method)) throw new Error(`Unknown method ${method}`);
    return api[method](...args);
  });

  win = new BrowserWindow({
    width: 1320, height: 840, minWidth: 1000, minHeight: 660, backgroundColor: chrome().bg, show: !smokeShot,
    autoHideMenuBar: true, title: 'Boostpad', icon: ICON,
    // custom title bar: the page draws the bar, Windows draws only the three buttons
    titleBarStyle: 'hidden', titleBarOverlay: titleBar(),
    // test runs render offscreen, which keeps animations running so the screenshot is truthful
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, offscreen: !!smokeShot },
  });
  win.on('closed', () => { for (const w of Object.values(overlayWins)) if (w && !w.isDestroyed()) w.destroy(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // test hook, smoke mode only: --smoke-page=nowplaying screenshots an overlay page instead of the app
  const page = smokeShot && arg('smoke-page') ? `${path.basename(arg('smoke-page'))}.html` : 'index.html';
  await win.loadFile(path.join(__dirname, '../renderer', page), { hash: arg('tab') || '' });

  if (smokeShot) {
    const errors = [];
    win.webContents.on('console-message', (e) => { if (e.level === 'error') errors.push(e.message); });
    // test hook, smoke mode only: --smoke-eval=<file.js> runs in the page before the screenshot
    if (arg('smoke-eval')) setTimeout(() => win.webContents.executeJavaScript(fs.readFileSync(arg('smoke-eval'), 'utf8')).catch((e) => errors.push(String(e))), 1200);
    setTimeout(async () => {
      fs.writeFileSync(smokeShot, (await win.webContents.capturePage()).toPNG());
      console.log(JSON.stringify({ smoke: 'ok', errors }));
      app.exit(errors.length ? 1 : 0);
    }, arg("smoke-wait") ? Number(arg("smoke-wait")) : arg("smoke-eval") ? 5000 : 2500);
    return;
  }
  syncOverlays();
  startMedia();
  setInterval(poll, 4000);
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { if (mediaWatcher) mediaWatcher.stop(); });
