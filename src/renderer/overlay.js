// Overlay window: controller input display (standard Gamepad API mapping).
const $ = (id) => document.getElementById(id);

function configure(cfg) {
  document.body.className = cfg.style === 'dark' ? 'dark' : 'light';
  document.body.style.setProperty('--accent', cfg.accent);
  $('root').style.transform = `scale(${cfg.size / 100})`;
  $('pad').hidden = !cfg.controller;
}

function frame() {
  const pad = [...navigator.getGamepads()].find((p) => p && p.connected);
  if (pad) {
    pad.buttons.forEach((b, i) => { const el = $(`b${i}`); if (el) el.classList.toggle('on', b.pressed || b.value > 0.15); });
    const move = (id, x, y, cx, cy) => { $(id).setAttribute('cx', cx + x * 11); $(id).setAttribute('cy', cy + y * 11); };
    move('ls', pad.axes[0] || 0, pad.axes[1] || 0, 110, 124);
    move('rs', pad.axes[2] || 0, pad.axes[3] || 0, 190, 124);
  }
  requestAnimationFrame(frame);
}

window.boostpad.on('overlay-config', configure);
window.boostpad.call('overlayConfig').then(configure);
requestAnimationFrame(frame);
