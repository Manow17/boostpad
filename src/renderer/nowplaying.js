// Top-of-screen "now playing" pill. Click-through, drawn over the game.
const $ = (id) => document.getElementById(id);
let media = { found: false }, shownTrack = '';

function paint() {
  const pill = $('pill');
  pill.classList.toggle('off', !media.found);
  pill.classList.toggle('paused', !!media.found && !media.playing);
  if (!media.found) return;
  const track = `${media.title}|${media.artist}`;
  if (track !== shownTrack) {
    shownTrack = track;
    $('title').textContent = media.title;
    $('artist').textContent = media.artist;
    $('text').classList.remove('change');
    void $('text').offsetWidth; // restart the animation
    $('text').classList.add('change');
  }
  $('art').style.backgroundImage = media.art ? `url("${media.art}")` : 'none';
  tick();
}

function tick() {
  if (!media.found || !media.duration) { $('bar').firstElementChild.style.width = '0'; return; }
  const now = media.position + (media.playing ? (Date.now() - media.updated) / 1000 : 0);
  $('bar').firstElementChild.style.width = `${Math.max(0, Math.min(100, (now / media.duration) * 100))}%`;
}

window.boostpad.on('media', (state) => { media = state; paint(); });
window.boostpad.call('mediaState').then((state) => { media = state; paint(); });
setInterval(tick, 1000);
