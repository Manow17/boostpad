// Steam Input for the Epic version of Rocket League.
//
// Steam Input only works for a game Steam starts. Boostpad adds a non-Steam shortcut that
// starts the Epic Games Launcher with Rocket League's launch link: Steam hooks the launcher,
// and the hook follows into the game it starts, so the game gets Steam Input and the Steam
// overlay, with the stick settings (dead zone shape, outer ring, anti-deadzone, response
// curve) in Steam's own controller configurator. The launcher must not be open already,
// or it hands the link to the open one and Steam never sees the game.
//
// Shortcuts live in userdata/<account>/config/shortcuts.vdf (binary VDF). Steam keeps
// them in memory and writes the file when it exits, so the file is only changed while
// Steam is closed.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');

const NAME = 'Rocket League (Steam Input)';
const RL_LINK = 'com.epicgames.launcher://apps/9773aa1aa54f4f7b80e44bef04986cea%3A530145df28a24424923f5828cc9031a1%3ASugar?action=launch&silent=true';

/* ---------- binary VDF ---------- */
// node: { type, key, value } ; map values are arrays of nodes, so order and unknown types survive.
const T = { MAP: 0, STR: 1, INT: 2, FLOAT: 3, PTR: 4, WSTR: 5, COLOR: 6, U64: 7, END: 8, I64: 10 };
const FIXED = { [T.INT]: 4, [T.FLOAT]: 4, [T.PTR]: 4, [T.COLOR]: 4, [T.U64]: 8, [T.I64]: 8 };

function parseVdf(buf) {
  let p = 0;
  const cstr = () => { const end = buf.indexOf(0, p); if (end < 0) throw new Error('Broken VDF'); const s = buf.toString('utf8', p, end); p = end + 1; return s; };
  const map = () => {
    const out = [];
    for (;;) {
      if (p >= buf.length) throw new Error('Broken VDF');
      const type = buf[p++];
      if (type === T.END) return out;
      const key = cstr();
      if (type === T.MAP) out.push({ type, key, value: map() });
      else if (type === T.STR) out.push({ type, key, value: cstr() });
      else if (type in FIXED) { out.push({ type, key, value: Buffer.from(buf.subarray(p, p + FIXED[type])) }); p += FIXED[type]; }
      else throw new Error(`Unknown VDF type ${type}`);
    }
  };
  const root = map();
  return root;
}
function writeVdf(nodes) {
  const parts = [];
  const cstr = (s) => parts.push(Buffer.from(`${s}\0`, 'utf8'));
  const map = (list) => {
    for (const n of list) {
      parts.push(Buffer.from([n.type]));
      cstr(n.key);
      if (n.type === T.MAP) map(n.value);
      else if (n.type === T.STR) cstr(n.value);
      else parts.push(n.value);
    }
    parts.push(Buffer.from([T.END]));
  };
  map(nodes);
  return Buffer.concat(parts);
}
const int = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
const get = (list, key) => list.find((n) => n.key.toLowerCase() === key.toLowerCase());

/* ---------- ids ---------- */

// Steam's id for a shortcut, as it computes it: crc32 of exe + name, top bit set.
function shortcutAppId(exe, name) {
  return (zlib.crc32(Buffer.from(exe + name, 'utf8')) | 0x80000000) >>> 0;
}
// The id steam://rungameid/ takes for a shortcut.
const gameId = (appid) => ((BigInt(appid) << 32n) | 0x02000000n).toString();

/* ---------- finding Steam ---------- */

function reg(key, value) {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', value], { windowsHide: true }, (err, out) => {
      const m = !err && out.match(new RegExp(`${value}\\s+REG_\\w+\\s+(.+)`));
      resolve(m ? m[1].trim() : null);
    });
  });
}
async function locate() {
  const steamPath = await reg('HKCU\\Software\\Valve\\Steam', 'SteamPath');
  if (!steamPath || !fs.existsSync(steamPath)) return null;
  let user = await reg('HKCU\\Software\\Valve\\Steam\\ActiveProcess', 'ActiveUser');
  user = user ? String(parseInt(user, 16) || parseInt(user, 10) || '') : '';
  const userdata = path.join(steamPath, 'userdata');
  if (!user || user === '0' || !fs.existsSync(path.join(userdata, user))) {
    // signed out: the account folder used last
    const dirs = fs.existsSync(userdata) ? fs.readdirSync(userdata).filter((d) => /^\d+$/.test(d) && d !== '0') : [];
    dirs.sort((a, b) => fs.statSync(path.join(userdata, b)).mtimeMs - fs.statSync(path.join(userdata, a)).mtimeMs);
    user = dirs[0] || '';
  }
  if (!user) return { steamPath, exe: path.join(steamPath, 'steam.exe') };
  return { steamPath, exe: path.join(steamPath, 'steam.exe'), user, shortcuts: path.join(userdata, user, 'config', 'shortcuts.vdf') };
}

/* ---------- the shortcut ---------- */

function readShortcuts(file) {
  if (!fs.existsSync(file)) return [{ type: T.MAP, key: 'shortcuts', value: [] }];
  return parseVdf(fs.readFileSync(file));
}
function findOurs(root) {
  const list = get(root, 'shortcuts');
  if (!list) return null;
  return list.value.find((n) => n.type === T.MAP && (get(n.value, 'AppName') || get(n.value, 'appname') || {}).value === NAME) || null;
}

/** Adds (or updates) Boostpad's shortcut. Returns the new file bytes and the app id. */
function withShortcut(root, { launcherExe, rlExe }) {
  const exe = `"${launcherExe}"`;
  const appid = shortcutAppId(exe, NAME);
  let list = get(root, 'shortcuts');
  if (!list) { list = { type: T.MAP, key: 'shortcuts', value: [] }; root.push(list); }
  const fields = [
    { type: T.INT, key: 'appid', value: int(appid) },
    { type: T.STR, key: 'AppName', value: NAME },
    { type: T.STR, key: 'Exe', value: exe },
    { type: T.STR, key: 'StartDir', value: `"${path.dirname(launcherExe)}\\"` },
    { type: T.STR, key: 'icon', value: rlExe || '' },
    { type: T.STR, key: 'ShortcutPath', value: '' },
    { type: T.STR, key: 'LaunchOptions', value: RL_LINK },
    { type: T.INT, key: 'IsHidden', value: int(0) },
    { type: T.INT, key: 'AllowDesktopConfig', value: int(1) },
    { type: T.INT, key: 'AllowOverlay', value: int(1) },
    { type: T.INT, key: 'OpenVR', value: int(0) },
    { type: T.INT, key: 'Devkit', value: int(0) },
    { type: T.STR, key: 'DevkitGameID', value: '' },
    { type: T.INT, key: 'DevkitOverrideAppID', value: int(0) },
    { type: T.INT, key: 'LastPlayTime', value: int(0) },
    { type: T.STR, key: 'FlatpakAppID', value: '' },
    { type: T.MAP, key: 'tags', value: [] },
  ];
  const existing = findOurs(root);
  if (existing) existing.value = fields;
  else list.value.push({ type: T.MAP, key: String(list.value.length), value: fields });
  return { bytes: writeVdf(root), appid };
}
function withoutShortcut(root) {
  const list = get(root, 'shortcuts');
  if (!list) return writeVdf(root);
  list.value = list.value.filter((n) => !(n.type === T.MAP && (get(n.value, 'AppName') || {}).value === NAME));
  list.value.forEach((n, i) => { n.key = String(i); }); // Steam numbers them 0, 1, 2...
  return writeVdf(root);
}

/* ---------- processes ---------- */

function processPath(image) {
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-Command', `(Get-Process ${image} -ErrorAction SilentlyContinue | Select-Object -First 1).Path`], { windowsHide: true }, (err, out) => {
      resolve(!err && out.trim() ? out.trim() : null);
    });
  });
}
const isRunning = async (image) => !!(await processPath(image));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Asks Steam to exit and waits for it (Steam writes its files on the way out).
async function closeSteam(steamExe) {
  if (!(await isRunning('steam'))) return true;
  execFile(steamExe, ['-shutdown'], { windowsHide: true }, () => {});
  for (let i = 0; i < 60; i++) { await sleep(1000); if (!(await isRunning('steam'))) return true; }
  return false;
}
function startSteam(steamExe) {
  execFile(steamExe, ['-silent'], { windowsHide: true, detached: true }, () => {});
}

const LAUNCHER_PATHS = [
  'C:\\Program Files\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe',
  'C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe',
  'C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win32\\EpicGamesLauncher.exe',
];
async function findLauncher() {
  return (await processPath('EpicGamesLauncher')) || LAUNCHER_PATHS.find((p) => fs.existsSync(p)) || null;
}

/* ---------- what the Controller page uses ---------- */

async function status(rlExe) {
  const loc = await locate();
  if (!loc) return { steam: false };
  const launcher = await findLauncher();
  let ours = null;
  try { ours = loc.shortcuts && findOurs(readShortcuts(loc.shortcuts)); } catch { /* unreadable file: shown as not added */ }
  const appid = launcher ? shortcutAppId(`"${launcher}"`, NAME) : null;
  return {
    steam: true, user: loc.user || null, running: await isRunning('steam'), launcher, rlExe: rlExe && fs.existsSync(rlExe) ? rlExe : null,
    added: !!ours, appid, gameId: appid ? gameId(appid) : null, epicOpen: await isRunning('EpicGamesLauncher'),
  };
}

/**
 * Adds or removes the shortcut: closes Steam, keeps a copy of the file the first time,
 * writes it, starts Steam again if it was running.
 */
async function setShortcut(add, { rlExe, backupDir }) {
  const loc = await locate();
  if (!loc || !loc.shortcuts) throw new Error('No Steam account found on this PC. Sign in to Steam once, then try again.');
  const launcher = await findLauncher();
  if (add && !launcher) throw new Error('The Epic Games Launcher was not found.');
  const wasRunning = await isRunning('steam');
  if (!(await closeSteam(loc.exe))) throw new Error('Steam did not close. Close it yourself and try again.');
  const root = readShortcuts(loc.shortcuts);
  if (fs.existsSync(loc.shortcuts) && backupDir) {
    fs.mkdirSync(backupDir, { recursive: true });
    const copy = path.join(backupDir, 'steam-shortcuts.vdf');
    if (!fs.existsSync(copy)) fs.copyFileSync(loc.shortcuts, copy); // the file as it was before Boostpad
  }
  fs.mkdirSync(path.dirname(loc.shortcuts), { recursive: true });
  const bytes = add ? withShortcut(root, { launcherExe: launcher, rlExe }).bytes : withoutShortcut(root);
  fs.writeFileSync(loc.shortcuts, bytes);
  if (wasRunning) startSteam(loc.exe);
}

function closeLauncher() {
  return new Promise((resolve) => execFile('taskkill', ['/IM', 'EpicGamesLauncher.exe', '/F'], { windowsHide: true }, () => resolve()));
}

module.exports = { status, setShortcut, closeLauncher, isRunning, NAME, RL_LINK, parseVdf, writeVdf, shortcutAppId, gameId, locate, readShortcuts, findOurs, withShortcut, withoutShortcut, T };
