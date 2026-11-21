// "Now playing" pill. Click-through, drawn over the game.
const $ = (id) => document.getElementById(id);
let media = { found: false }, shownTrack = '', edit = false;

function paint() {
  const pill = $('pill');
  pill.classList.toggle('off', !media.found);
  pill.classList.toggle('paused', !!media.found && !media.playing);
  const title = media.found ? media.title : (edit ? 'Now playing' : ''), artist = media.found ? media.artist : (edit ? 'Drag to move' : '');
  const track = `${title}|${artist}`;
  if (track !== shownTrack) {
    shownTrack = track;
    $('title').textContent = title;
    $('artist').textContent = artist;
    $('text').classList.remove('change');
    void $('text').offsetWidth; // restart the animation
    $('text').classList.add('change');
  }
  $('art').style.backgroundImage = media.found && media.art ? `url("${media.art}")` : 'none';
  tick();
}

function tick() {
  if (!media.found || !media.duration) { $('bar').firstElementChild.style.width = '0'; return; }
  const now = media.position + (media.playing ? (Date.now() - media.updated) / 1000 : 0);
  $('bar').firstElementChild.style.width = `${Math.max(0, Math.min(100, (now / media.duration) * 100))}%`;
}

function configure(cfg) {
  edit = !!cfg.edit;
  document.body.classList.toggle('edit', edit);
  $('stage').style.transform = `scale(${(cfg.size || 100) / 100})`;
  paint();
}

window.openw.on('media', (state) => { media = state; paint(); });
window.openw.on('overlay-config', configure);
window.openw.call('overlayConfig', 'music').then(configure);
window.openw.call('mediaState').then((state) => { media = state; paint(); });
setInterval(tick, 1000);
