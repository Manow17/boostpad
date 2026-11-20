// Controller overlay window: draws the pad and lights it up with live input.
const root = document.getElementById('pad');
let cfg = { model: 'auto' };
const model = () => (cfg.model && cfg.model !== 'auto' ? cfg.model : Pad.guess(Pad.first()) || 'ps5');
Pad.mount(root, model());

function configure(next) {
  cfg = next;
  if (root.dataset.model !== model()) Pad.mount(root, model());
  Pad.style(root, cfg);
  document.body.classList.toggle('edit', !!cfg.edit);
}

function frame() {
  if (root.dataset.model !== model()) { Pad.mount(root, model()); Pad.style(root, cfg); } // a different controller was plugged in
  Pad.update(root, Pad.first());
  requestAnimationFrame(frame);
}

window.boostpad.on('overlay-config', configure);
window.boostpad.call('overlayConfig', 'pad').then(configure);
requestAnimationFrame(frame);
