// Now-playing bridge. Runs media.ps1 in Windows PowerShell, which reads Windows'
// media controls, and turns its output into a small state object:
//   { found, app, source, title, artist, album, playing, position, duration, updated, art }
// `art` is a data: URL. Position is as of `updated` (epoch ms); add elapsed time while playing.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT = path.join(__dirname, 'media.ps1');
const run = (action) => {
  const text = `$action = '${action}'\n${fs.readFileSync(SCRIPT, 'utf8')}`;
  return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(text, 'utf16le').toString('base64')], { windowsHide: true });
};

// "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" -> "Spotify", "chrome.exe" -> "Chrome"
function sourceName(app = '') {
  if (/spotify/i.test(app)) return 'Spotify';
  const base = app.split('!')[0].split('\\').pop().replace(/\.exe$/i, '').replace(/_.*$/, '').split('.').pop();
  return base ? base[0].toUpperCase() + base.slice(1) : 'Windows';
}

// Turns one line from the script into a state, keeping the cover art between lines.
function makeParser() {
  let art = { track: '', url: '' };
  return (line) => {
    let raw;
    try { raw = JSON.parse(line); } catch { return null; }
    if (!raw.found) return { found: false, error: raw.error || '' };
    const track = `${raw.title}|${raw.artist}`;
    if (raw.art) art = { track, url: `data:image/${raw.art.startsWith('iVBOR') ? 'png' : 'jpeg'};base64,${raw.art}` };
    return {
      found: true, app: raw.app, source: sourceName(raw.app), title: raw.title || 'Unknown track', artist: raw.artist || '', album: raw.album || '',
      playing: !!raw.playing, position: raw.position || 0, duration: raw.duration || 0, updated: raw.updated || Date.now(),
      art: art.track === track ? art.url : '',
    };
  };
}

/** Starts watching. onState is called whenever something changes. Returns { stop }. */
function watch(onState) {
  if (process.platform !== 'win32') { onState({ found: false, error: 'Only available on Windows' }); return { stop() {} }; }
  let child = null, stopped = false, last = '', buffer = '';
  const parse = makeParser();
  const start = () => {
    child = run('watch');
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        const state = line && parse(line);
        if (!state) continue;
        const key = JSON.stringify(state);
        if (key !== last) { last = key; onState(state); }
      }
    });
    child.on('error', () => onState({ found: false, error: 'Could not start PowerShell' }));
    child.on('exit', () => { if (!stopped) setTimeout(start, 5000); }); // restart if it dies
  };
  start();
  return { stop() { stopped = true; if (child) child.kill(); } };
}

function control(action) {
  if (process.platform !== 'win32' || !['toggle', 'next', 'prev'].includes(action)) return;
  run(action).on('error', () => {});
}

module.exports = { watch, control, sourceName, makeParser };
