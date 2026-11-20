// Locate Rocket League (Epic Games / Steam), check whether it is running, launch it.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const EPIC_MANIFESTS = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';
const EPIC_APP = 'Sugar'; // Epic's internal app name for Rocket League
const STEAM_APPID = '252950';
const EXE = 'RocketLeague.exe';

function cookedDir(installDir) {
  return path.join(installDir, 'TAGame', 'CookedPCConsole');
}

function isValidInstall(installDir) {
  try { return fs.statSync(cookedDir(installDir)).isDirectory(); } catch { return false; }
}

function detectEpic(manifestDir = EPIC_MANIFESTS) {
  let files = [];
  try { files = fs.readdirSync(manifestDir).filter((f) => f.endsWith('.item')); } catch { return null; }
  for (const f of files) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(manifestDir, f), 'utf8'));
      if (m.AppName === EPIC_APP && isValidInstall(m.InstallLocation)) return m.InstallLocation;
    } catch { /* skip unreadable manifest */ }
  }
  return null;
}

function regQuery(key, value) {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', value], { windowsHide: true }, (err, out) => {
      if (err) return resolve(null);
      const m = out.match(new RegExp(value + '\\s+REG_\\w+\\s+(.+)'));
      resolve(m ? m[1].trim() : null);
    });
  });
}

async function detectSteam() {
  const roots = new Set();
  const reg = await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath');
  if (reg) roots.add(path.normalize(reg));
  roots.add('C:\\Program Files (x86)\\Steam');
  for (const root of [...roots]) {
    try {
      const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) roots.add(m[1].replace(/\\\\/g, '\\'));
    } catch { /* no library file here */ }
  }
  for (const root of roots) {
    const dir = path.join(root, 'steamapps', 'common', 'rocketleague');
    if (isValidInstall(dir)) return dir;
  }
  return null;
}

async function detect() {
  return { epic: detectEpic(), steam: await detectSteam() };
}

function isRunning() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${EXE}`, '/NH', '/FO', 'CSV'], { windowsHide: true }, (err, out) => {
      resolve(!err && out.toLowerCase().includes(EXE.toLowerCase()));
    });
  });
}

function launchUrl(platform) {
  return platform === 'steam'
    ? `steam://rungameid/${STEAM_APPID}`
    : `com.epicgames.launcher://apps/${EPIC_APP}?action=launch&silent=true`;
}

module.exports = { cookedDir, isValidInstall, detectEpic, detectSteam, detect, isRunning, launchUrl };
