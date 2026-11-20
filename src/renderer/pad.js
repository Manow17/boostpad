// A PlayStation-style (DualSense layout) controller, drawn for this project, that
// lights up with live input. Used by the overlay window and by the preview in the app.
//   Pad.mount(el)            draws it into el
//   Pad.style(el, colours)   { body, keys, glow, opacity }
//   Pad.update(el, gamepad)  shows a Gamepad's current buttons, triggers and sticks
// Button numbers follow the standard Gamepad mapping.
const Pad = (() => {
  const SVG = `
<svg viewBox="0 0 420 300" xmlns="http://www.w3.org/2000/svg" class="padsvg">
  <!-- triggers (L2/R2) fill from the bottom as they are pressed, bumpers (L1/R1) below them -->
  <g class="p-shell">
    <rect x="74" y="8" width="62" height="30" rx="11"/><rect x="284" y="8" width="62" height="30" rx="11"/>
  </g>
  <rect class="p-fill" data-trigger="6" x="74" y="38" width="62" height="0" rx="11"/>
  <rect class="p-fill" data-trigger="7" x="284" y="38" width="62" height="0" rx="11"/>
  <rect class="p-shell p-btn" data-b="4" x="66" y="42" width="78" height="15" rx="7"/>
  <rect class="p-shell p-btn" data-b="5" x="276" y="42" width="78" height="15" rx="7"/>

  <!-- shell: two grips, with the darker centre section between them -->
  <path class="p-body" d="M118 62 C150 54 270 54 302 62 C330 60 352 70 366 100 C386 146 404 214 398 250 C394 282 358 286 344 262 C330 240 318 222 286 214 L134 214 C102 222 90 240 76 262 C62 286 26 282 22 250 C16 214 34 146 54 100 C68 70 90 60 118 62 Z"/>
  <path class="p-inner" d="M132 132 C160 124 260 124 288 132 C306 150 312 186 300 214 L120 214 C108 186 114 150 132 132 Z"/>

  <!-- touchpad, create and options -->
  <path class="p-key p-btn" data-b="17" d="M152 62 h116 a9 9 0 0 1 9 10 l-7 44 a11 11 0 0 1 -11 9 h-98 a11 11 0 0 1 -11 -9 l-7 -44 a9 9 0 0 1 9 -10 Z"/>
  <rect class="p-key p-btn" data-b="8" x="124" y="72" width="8" height="18" rx="4"/>
  <rect class="p-key p-btn" data-b="9" x="288" y="72" width="8" height="18" rx="4"/>

  <!-- d-pad -->
  <path class="p-key p-btn" data-b="12" d="M89 88 h18 a4 4 0 0 1 4 4 v12 l-13 10 l-13 -10 v-12 a4 4 0 0 1 4 -4 Z"/>
  <path class="p-key p-btn" data-b="13" d="M89 152 h18 a4 4 0 0 0 4 -4 v-12 l-13 -10 l-13 10 v12 a4 4 0 0 0 4 4 Z"/>
  <path class="p-key p-btn" data-b="14" d="M66 111 v18 a4 4 0 0 0 4 4 h12 l10 -13 l-10 -13 h-12 a4 4 0 0 0 -4 4 Z"/>
  <path class="p-key p-btn" data-b="15" d="M130 111 v18 a4 4 0 0 1 -4 4 h-12 l-10 -13 l10 -13 h12 a4 4 0 0 1 4 4 Z"/>

  <!-- face buttons with their symbols -->
  <circle class="p-key p-btn" data-b="3" cx="322" cy="94" r="14"/><circle class="p-key p-btn" data-b="0" cx="322" cy="146" r="14"/>
  <circle class="p-key p-btn" data-b="2" cx="296" cy="120" r="14"/><circle class="p-key p-btn" data-b="1" cx="348" cy="120" r="14"/>
  <g class="p-mark">
    <path d="M322 87 l6.500 11 h-13 Z"/><path d="M317 141 l10 10 M327 141 l-10 10"/>
    <rect x="290.500" y="114.500" width="11" height="11"/><circle cx="348" cy="120" r="6"/>
  </g>

  <!-- sticks: the ring is L3/R3, the cap moves -->
  <circle class="p-well p-btn" data-b="10" cx="156" cy="174" r="27"/><circle class="p-well p-btn" data-b="11" cx="264" cy="174" r="27"/>
  <circle class="p-cap" data-stick="0" cx="156" cy="174" r="18"/><circle class="p-cap" data-stick="2" cx="264" cy="174" r="18"/>
  <circle class="p-key p-btn" data-b="16" cx="210" cy="176" r="9"/>
</svg>`;

  const CSS = `
.padsvg { display: block; width: 100%; height: auto; --pad-body: #f2f3f5; --pad-keys: #1b1c21; --pad-glow: #00d8c8; }
.padsvg .p-body { fill: var(--pad-body); stroke: color-mix(in srgb, var(--pad-keys) 35%, var(--pad-body)); stroke-width: 2; }
.padsvg .p-shell { fill: var(--pad-body); stroke: color-mix(in srgb, var(--pad-keys) 35%, var(--pad-body)); stroke-width: 2; }
.padsvg .p-inner { fill: color-mix(in srgb, var(--pad-keys) 88%, var(--pad-body)); }
.padsvg .p-key { fill: var(--pad-keys); stroke: color-mix(in srgb, var(--pad-body) 30%, var(--pad-keys)); stroke-width: 1.5; }
.padsvg .p-well { fill: color-mix(in srgb, var(--pad-keys) 70%, #000); stroke: color-mix(in srgb, var(--pad-body) 30%, var(--pad-keys)); stroke-width: 1.5; }
.padsvg .p-cap { fill: color-mix(in srgb, var(--pad-keys) 82%, var(--pad-body)); stroke: color-mix(in srgb, var(--pad-body) 45%, var(--pad-keys)); stroke-width: 1.5; }
.padsvg .p-mark { fill: none; stroke: color-mix(in srgb, var(--pad-body) 75%, var(--pad-keys)); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.padsvg .p-fill { fill: var(--pad-glow); pointer-events: none; }
.padsvg .p-btn { transition: fill .05s; }
.padsvg .p-btn.on, .padsvg .p-shell.p-btn.on { fill: var(--pad-glow); filter: drop-shadow(0 0 5px var(--pad-glow)); }
.padsvg .p-cap.on { fill: var(--pad-glow); }`;

  function mount(el) {
    if (!document.getElementById('pad-style')) document.head.append(Object.assign(document.createElement('style'), { id: 'pad-style', textContent: CSS }));
    el.innerHTML = SVG;
    return el;
  }

  function style(el, { body, keys, glow, opacity }) {
    const svg = el.querySelector('.padsvg');
    if (!svg) return;
    const hex = (v, fallback) => (/^#[0-9a-f]{6}$/i.test(v) ? v : fallback);
    svg.style.setProperty('--pad-body', hex(body, '#f2f3f5'));
    svg.style.setProperty('--pad-keys', hex(keys, '#1b1c21'));
    svg.style.setProperty('--pad-glow', hex(glow, '#00d8c8'));
    svg.style.opacity = Math.max(20, Math.min(100, Number(opacity) || 100)) / 100;
  }

  function update(el, gamepad) {
    for (const btn of el.querySelectorAll('[data-b]')) {
      const b = gamepad && gamepad.buttons[Number(btn.dataset.b)];
      btn.classList.toggle('on', !!b && (b.pressed || b.value > 0.15));
    }
    for (const fill of el.querySelectorAll('[data-trigger]')) {
      const b = gamepad && gamepad.buttons[Number(fill.dataset.trigger)];
      const h = Math.round(30 * (b ? b.value : 0));
      fill.setAttribute('height', h);
      fill.setAttribute('y', 38 - h);
    }
    for (const cap of el.querySelectorAll('[data-stick]')) {
      const axis = Number(cap.dataset.stick), x = gamepad ? gamepad.axes[axis] || 0 : 0, y = gamepad ? gamepad.axes[axis + 1] || 0 : 0;
      cap.setAttribute('cx', (axis === 0 ? 156 : 264) + x * 10);
      cap.setAttribute('cy', 174 + y * 10);
      cap.classList.toggle('on', Math.hypot(x, y) > 0.25);
    }
  }

  const first = () => [...navigator.getGamepads()].find((p) => p && p.connected) || null;
  return { mount, style, update, first };
})();
