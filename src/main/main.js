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
const { Maps, Packs, MAP_SLOT } = require('./core/library');

const DEFAULTS = {
  platform: null,
  installDir: null,
  experimentalSwaps: false,
  theme: { mode: 'dark' },
  presets: [],
  profile: { name: '', title: '', titleColor: '#00d8c8', glow: false, rank: '', avatar: '' },
  overlay: { controller: false, nowPlaying: false, style: 'light', size: 100, x: null, y: null },
  syncUrl: '',
};

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const smokeShot = arg('smoke'); // --smoke=<png path>: render once, save a screenshot, quit
if (arg('data')) app.setPath('userData', path.resolve(arg('data')));

let win = null, overlay = null, settings, engine, maps, packs, catalog = null, running = false;

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
  };
}

async function pick(options) {
  const res = await dialog.showOpenDialog(win, options);
  return res.canceled ? [] : res.filePaths;
}

function setOverlay() {
  const cfg = settings.get('overlay');
  const wanted = !!cfg.controller;
  if (!wanted) { if (overlay) overlay.destroy(); overlay = null; return; }
  if (!overlay) {
    const area = screen.getPrimaryDisplay().workArea;
    overlay = new BrowserWindow({
      width: 420, height: 300, x: cfg.x ?? area.x + area.width - 440, y: cfg.y ?? area.y + 20,
      frame: false, transparent: true, resizable: false, skipTaskbar: true, focusable: false, show: false, icon: ICON,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
    });
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.setIgnoreMouseEvents(true);
    overlay.loadFile(path.join(__dirname, '../renderer/overlay.html'));
    overlay.once('ready-to-show', () => overlay.showInactive());
    overlay.on('closed', () => { overlay = null; });
  } else {
    overlay.webContents.send('overlay-config', overlayPayload());
  }
}

function overlayPayload() {
  return { ...settings.get('overlay'), accent: ACCENT };
}

// What is playing (Spotify, through Windows' media controls) and the pill that
// shows it at the top of the screen.
// (test hook: --fake-media gives test runs a made-up track, so the pages can be screenshotted)
let mediaState = smokeShot && process.argv.includes('--fake-media')
  ? { found: true, app: 'Spotify.exe', source: 'Spotify', title: 'Example Track', artist: 'Example Artist', album: 'Example Album', playing: true, position: 62, duration: 201, updated: Date.now(), art: '' }
  : { found: false };
let mediaWatcher = null, nowPlaying = null;
function startMedia() {
  mediaWatcher = mediaBridge.watch((state) => {
    mediaState = state;
    send('media', state);
    if (nowPlaying && !nowPlaying.isDestroyed()) nowPlaying.webContents.send('media', state);
  });
}
function setNowPlaying() {
  const wanted = !!settings.get('overlay').nowPlaying;
  if (!wanted) { if (nowPlaying) nowPlaying.destroy(); nowPlaying = null; return; }
  if (nowPlaying) return;
  const area = screen.getPrimaryDisplay().bounds, width = 400, height = 70;
  nowPlaying = new BrowserWindow({
    width, height, x: Math.round(area.x + (area.width - width) / 2), y: area.y + 6,
    frame: false, transparent: true, resizable: false, skipTaskbar: true, focusable: false, show: false, hasShadow: false, icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  nowPlaying.setAlwaysOnTop(true, 'screen-saver');
  nowPlaying.setIgnoreMouseEvents(true);
  nowPlaying.loadFile(path.join(__dirname, '../renderer/nowplaying.html'));
  nowPlaying.once('ready-to-show', () => nowPlaying.showInactive());
  nowPlaying.on('closed', () => { nowPlaying = null; });
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
    return snapshot();
  },
  async browseInstall(platform) {
    const [dir] = await pick({ title: 'Select the rocketleague folder', properties: ['openDirectory'] });
    return dir ? api.setInstall(platform, dir) : snapshot();
  },
  setSetting(key, value) {
    if (!(key in DEFAULTS)) throw new Error(`Unknown setting ${key}`);
    settings.set(key, value);
    if (key === 'overlay') { setOverlay(); setNowPlaying(); }
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
    if (op.kind === 'swap' && !settings.get('experimentalSwaps')) throw new Error('Item swaps are experimental. Turn them on in Settings first.');
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

  packsList: () => packs.list(),
  async packsImport() {
    const [dir] = await pick({ title: 'Select a mod pack folder (with pack.json)', properties: ['openDirectory'] });
    if (dir) packs.import(dir);
    return packs.list();
  },
  packsRemove(id) { packs.remove(id); return packs.list(); },
  async packsApply(id) {
    let queued = false;
    for (const op of packs.ops(id)) queued = (await engine.apply(op)).queued || queued;
    return { queued, state: snapshot() };
  },
  async packsRevert(id) {
    for (const rec of engine.list().active) if (rec.op.packId === id) await engine.revert(rec.key);
    return snapshot();
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
  mediaControl(action) { mediaBridge.control(action); },
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
  overlayConfig: () => overlayPayload(),
};

async function poll() {
  const now = await game.isRunning();
  if (now === running) return;
  running = now;
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
  packs = new Packs(path.join(data, 'packs'));
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
  win.on('closed', () => { for (const w of [overlay, nowPlaying]) if (w && !w.isDestroyed()) w.destroy(); });
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
  setOverlay();
  setNowPlaying();
  startMedia();
  setInterval(poll, 4000);
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { if (mediaWatcher) mediaWatcher.stop(); });
