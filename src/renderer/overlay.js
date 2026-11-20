// Controller overlay window: draws the pad and lights it up with live input.
const root = Pad.mount(document.getElementById('pad'));

function configure(cfg) {
  Pad.style(root, cfg);
  document.body.classList.toggle('edit', !!cfg.edit);
}

function frame() {
  Pad.update(root, Pad.first());
  requestAnimationFrame(frame);
}

window.boostpad.on('overlay-config', configure);
window.boostpad.call('overlayConfig', 'pad').then(configure);
requestAnimationFrame(frame);
