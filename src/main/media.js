// Now-playing bridge. Runs media.ps1 in Windows PowerShell, which reads Windows'
// media controls, and turns its output into a small state object:
//   { found, app, source, title, artist, album, playing, position, duration, updated, art }
// `art` is a data: URL. Position is as of `updated` (epoch ms); add elapsed time while playing.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Apps the user can choose to follow. `match` is tested against the app id Windows reports.
const SOURCES = [
  { id: 'auto', name: 'Any app (whatever is playing)', match: '' },
  { id: 'spotify', name: 'Spotify', match: 'spotify' },
  { id: 'apple', name: 'Apple Music / iTunes', match: 'applemusic|itunes' },
  { id: 'tidal', name: 'TIDAL', match: 'tidal' },
  { id: 'deezer', name: 'Deezer', match: 'deezer' },
  { id: 'amazon', name: 'Amazon Music', match: 'amazon' },
  { id: 'qobuz', name: 'Qobuz', match: 'qobuz' },
  { id: 'browser', name: 'Browser (YouTube Music, SoundCloud…)', match: 'chrome|msedge|firefox|opera|brave|vivaldi' },
  { id: 'vlc', name: 'VLC', match: 'vlc' },
  { id: 'foobar', name: 'foobar2000', match: 'foobar' },
  { id: 'musicbee', name: 'MusicBee', match: 'musicbee' },
  { id: 'aimp', name: 'AIMP', match: 'aimp' },
  { id: 'wmp', name: 'Windows Media Player', match: 'zunemusic|wmplayer|mediaplayer' },
];
const NAMES = [['spotify', 'Spotify'], ['applemusic', 'Apple Music'], ['itunes', 'iTunes'], ['tidal', 'TIDAL'], ['deezer', 'Deezer'], ['amazon', 'Amazon Music'],
  ['qobuz', 'Qobuz'], ['chrome', 'Chrome'], ['msedge', 'Edge'], ['firefox', 'Firefox'], ['opera', 'Opera'], ['brave', 'Brave'], ['vivaldi', 'Vivaldi'],
  ['vlc', 'VLC'], ['foobar', 'foobar2000'], ['musicbee', 'MusicBee'], ['aimp', 'AIMP'], ['zunemusic', 'Media Player'], ['wmplayer', 'Media Player']];

const SCRIPT = path.join(__dirname, 'media.ps1');
const run = (action, source = 'auto') => {
  const match = (SOURCES.find((s) => s.id === source) || SOURCES[0]).match; // fixed strings only: never user text
  const text = `$action = '${action}'\n$prefer = '${match}'\n${fs.readFileSync(SCRIPT, 'utf8')}`;
  return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(text, 'utf16le').toString('base64')], { windowsHide: true });
};

// "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" -> "Spotify", "chrome.exe" -> "Chrome"
function sourceName(app = '') {
  const lower = app.toLowerCase();
  const known = NAMES.find(([key]) => lower.includes(key));
  if (known) return known[1];
  const base = app.split('!')[0].split('\\').pop().replace(/\.exe$/i, '').replace(/_.*$/, '').split('.').pop();
  return base ? base[0].toUpperCase() + base.slice(1) : 'Windows';
}

// Turns one line from the script into { state, front }, keeping the cover art between lines.
function makeParser() {
  let art = { track: '', url: '' };
  return (line) => {
    let raw;
    try { raw = JSON.parse(line); } catch { return null; }
    const front = typeof raw.front === 'string' ? raw.front : '';
    if (!raw.found) return { front, state: { found: false, error: raw.error || '' } };
    const track = `${raw.title}|${raw.artist}`;
    if (raw.art) art = { track, url: `data:image/${raw.art.startsWith('iVBOR') ? 'png' : 'jpeg'};base64,${raw.art}` };
    return {
      front,
      state: {
        found: true, app: raw.app, source: sourceName(raw.app), title: raw.title || 'Unknown track', artist: raw.artist || '', album: raw.album || '',
        playing: !!raw.playing, position: raw.position || 0, duration: raw.duration || 0, updated: raw.updated || Date.now(),
        art: art.track === track ? art.url : '',
      },
    };
  };
}

/**
 * Starts watching. onState is called when the track or its state changes, onForeground
 * when a different program comes to the front. Returns { stop, source }.
 */
function watch({ source = 'auto', onState, onForeground = () => {} }) {
  if (process.platform !== 'win32') { onState({ found: false, error: 'Only available on Windows' }); return { stop() {}, source }; }
  let child = null, stopped = false, lastState = '', lastFront = null, buffer = '';
  const parse = makeParser();
  const start = () => {
    child = run('watch', source);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        const parsed = line && parse(line);
        if (!parsed || stopped) continue;
        const key = JSON.stringify(parsed.state);
        if (key !== lastState) { lastState = key; onState(parsed.state); }
        if (parsed.front !== lastFront) { lastFront = parsed.front; onForeground(parsed.front); }
      }
    });
    child.on('error', () => onState({ found: false, error: 'Could not start PowerShell' }));
    child.on('exit', () => { if (!stopped) setTimeout(start, 5000); }); // restart if it dies
  };
  start();
  return { source, stop() { stopped = true; if (child) child.kill(); } };
}

function control(action, source) {
  if (process.platform !== 'win32' || !['toggle', 'next', 'prev'].includes(action)) return;
  run(action, source).on('error', () => {});
}

module.exports = { SOURCES, watch, control, sourceName, makeParser };
