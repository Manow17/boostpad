const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const game = require('./core/game');
const { Store } = require('./core/store');
const { Engine } = require('./core/engine');
const { buildCatalog } = require('./core/catalog');
const { Maps, Packs, MAP_SLOT } = require('./core/library');

const DEFAULTS = {
  platform: null,
  installDir: null,
  experimentalSwaps: false,
  theme: { accent: '#ff7a1a', background: 'ink' },
  presets: [],
  music: { files: [], volume: 0.6 },
  profile: { name: '', title: '', titleColor: '#ffd166', glow: false, rank: '', avatar: '' },
  tracker: { playlist: 'Doubles 2v2', entries: [] },
  overlay: { controller: false, mmr: false, style: 'light', size: 100, x: null, y: null },
  syncUrl: '',
};

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const smokeShot = arg('smoke'); // --smoke=<png path>: render once, save a screenshot, quit
if (arg('data')) app.setPath('userData', path.resolve(arg('data')));

let win = null, overlay = null, settings, engine, maps, packs, catalog = null, running = false;

const cooked = () => (settings.get('installDir') ? game.cookedDir(settings.get('installDir')) : null);
const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

function snapshot() {
  const dir = settings.get('installDir');
  return {
    version: app.getVersion(),
    settings: settings.data,
    install: { platform: settings.get('platform'), dir, valid: !!dir && game.isValidInstall(dir) },
    running,
    engine: engine.list(),
    mapSlot: MAP_SLOT,
  };
}

async function pick(options) {
  const res = await dialog.showOpenDialog(win, options);
  return res.canceled ? [] : res.filePaths;
}

function setOverlay() {
  const cfg = settings.get('overlay');
  const wanted = cfg.controller || cfg.mmr;
  if (!wanted) { if (overlay) overlay.destroy(); overlay = null; return; }
  if (!overlay) {
    const area = screen.getPrimaryDisplay().workArea;
    overlay = new BrowserWindow({
      width: 420, height: 300, x: cfg.x ?? area.x + area.width - 440, y: cfg.y ?? area.y + 20,
      frame: false, transparent: true, resizable: false, skipTaskbar: true, focusable: false, show: false,
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
  const t = settings.get('tracker');
  const last = t.entries.filter((e) => e.playlist === t.playlist).at(-1);
  return { ...settings.get('overlay'), accent: settings.get('theme').accent, mmr: settings.get('overlay').mmr ? (last?.mmr ?? null) : null, playlist: t.playlist };
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
    if (key === 'overlay' || key === 'tracker' || key === 'theme') setOverlay();
    return snapshot();
  },

  getCatalog() {
    if (!catalog) catalog = buildCatalog(cooked());
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

  async musicAdd() {
    const files = await pick({ title: 'Add music', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: ['mp3', 'ogg', 'wav', 'flac', 'm4a'] }] });
    const music = settings.get('music');
    music.files = [...new Set([...music.files, ...files])];
    settings.set('music', music);
    return snapshot();
  },
  async pickAvatar() {
    const [file] = await pick({ title: 'Choose a picture', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (!file) return null;
    if (fs.statSync(file).size > 400 * 1024) throw new Error('Picture must be under 400 KB');
    const ext = path.extname(file).slice(1).replace('jpg', 'jpeg');
    return `data:image/${ext};base64,${fs.readFileSync(file).toString('base64')}`;
  },

  launchGame() { shell.openExternal(game.launchUrl(settings.get('platform'))); },
  openDataFolder() { shell.openPath(app.getPath('userData')); },
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

app.whenReady().then(async () => {
  const data = app.getPath('userData');
  settings = new Store(path.join(data, 'settings.json'), DEFAULTS);
  engine = new Engine({
    store: new Store(path.join(data, 'state.json')),
    backupDir: path.join(data, 'backups'),
    getCookedDir: cooked,
    isRunning: game.isRunning,
  });
  maps = new Maps(path.join(data, 'maps'));
  packs = new Packs(path.join(data, 'packs'));
  if (cooked() && game.isValidInstall(settings.get('installDir'))) engine.reconcile();
  running = await game.isRunning();

  ipcMain.handle('api', async (_e, method, ...args) => {
    if (!Object.hasOwn(api, method)) throw new Error(`Unknown method ${method}`);
    return api[method](...args);
  });

  win = new BrowserWindow({
    width: 1320, height: 840, minWidth: 1000, minHeight: 660, backgroundColor: '#080a10', show: !smokeShot,
    autoHideMenuBar: true, title: 'Boostpad',
    // custom title bar: the page draws the bar, Windows draws only the three buttons
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#eef1f7', height: 40 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  await win.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: arg('tab') || '' });

  if (smokeShot) {
    const errors = [];
    win.webContents.on('console-message', (e) => { if (e.level === 'error') errors.push(e.message); });
    // test hook, smoke mode only: --smoke-eval=<file.js> runs in the page before the screenshot
    if (arg('smoke-eval')) setTimeout(() => win.webContents.executeJavaScript(fs.readFileSync(arg('smoke-eval'), 'utf8')).catch((e) => errors.push(String(e))), 1200);
    setTimeout(async () => {
      fs.writeFileSync(smokeShot, (await win.webContents.capturePage()).toPNG());
      console.log(JSON.stringify({ smoke: 'ok', errors }));
      app.exit(errors.length ? 1 : 0);
    }, arg("smoke-eval") ? 5000 : 2500);
    return;
  }
  setOverlay();
  setInterval(poll, 4000);
});

app.on('window-all-closed', () => app.quit());
