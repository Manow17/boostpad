/* OpenW Input's stick and trigger maths, for the Controller page's previews and for the
   settings the helper gets. The helper (native/openw-input.cpp) does the same in C++; a test
   compares the two. Loaded by the page as a script and by the main process with require. */
(function (root) {
  // Response curves, as exponents on the stick's travel past the dead zone.
  const CURVES = { linear: 1, aggressive: 0.6, relaxed: 1.5, wide: 2, extrawide: 3 };
  const SHAPES = { circle: 0, cross: 1, square: 2 };
  const OUTPUTS = { left: 0, right: 1, none: 2 };
  const AXES = { both: 0, x: 1, y: 2 };

  // Buttons on the real controller, in the helper's bit order.
  const SOURCES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LS', 'RS', 'Back', 'Start', 'Guide', 'Up', 'Down', 'Left', 'Right', 'Touchpad', 'Mute', 'FnL', 'FnR', 'PaddleL', 'PaddleR'];
  // Buttons of the virtual Xbox 360 controller, plus a full trigger pull.
  const OUT = { A: 0x1000, B: 0x2000, X: 0x4000, Y: 0x8000, LB: 0x100, RB: 0x200, LS: 0x40, RS: 0x80, Back: 0x20, Start: 0x10, Guide: 0x400, Up: 0x1, Down: 0x2, Left: 0x4, Right: 0x8, LT: 0x10000, RT: 0x20000 };

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const clamp01 = (v) => clamp(v, 0, 1);
  const exponentOf = (s) => (s.curve === 'custom' ? s.exponent : CURVES[s.curve] || 1);

  // Settings as saved (percentages, names) -> the numbers the maths uses.
  function stickCfg(s) {
    return {
      shape: SHAPES[s.shape] ?? 0, inner: clamp(s.inner / 100, 0, 0.9), outer: clamp(s.outer / 100, 0, 0.5),
      expo: clamp(exponentOf(s), 0.1, 10), anti: clamp(s.anti / 100, 0, 0.9), buffer: clamp(s.buffer / 100, 0, 0.5),
      scaleX: s.scaleX / 100, scaleY: s.scaleY / 100, invX: s.invertX ? 1 : 0, invY: s.invertY ? 1 : 0,
      output: OUTPUTS[s.output] ?? 0, axes: AXES[s.axes] ?? 0,
      ringAt: clamp(((s.ring && s.ring.at) ?? 90) / 100, 0, 1), ringInvert: s.ring && s.ring.invert ? 1 : 0,
      ringMask: (s.ring && OUT[s.ring.to]) || 0, smoothing: clamp((s.smoothing || 0) / 100, 0, 1),
    };
  }
  function trigCfg(t) {
    const start = clamp(t.start / 100, 0, 0.95);
    return { start, end: clamp(t.end / 100, start + 0.01, 1), expo: clamp(exponentOf(t), 0.1, 10), hair: t.hair ? 1 : 0, output: OUTPUTS[t.output] ?? 0 };
  }

  // Travel past the dead zone -> output: dead zones, response curve, anti-deadzone.
  function shapeMag(m, c) {
    if (m <= c.inner) return 0;
    const span = Math.max(0.01, 1 - c.outer - c.inner);
    let t = Math.pow(clamp01((m - c.inner) / span), c.expo);
    if (c.anti > 0 && t > 0) {
      if (c.buffer > 0 && t < c.buffer) t = (t / c.buffer) * c.anti;
      else t = c.anti + ((1 - c.anti) * (t - c.buffer)) / (1 - c.buffer);
    }
    return clamp01(t);
  }

  function stick(x, y, c) {
    let ox, oy;
    if (c.shape === 1) {
      ox = Math.sign(x) * shapeMag(Math.abs(x), c);
      oy = Math.sign(y) * shapeMag(Math.abs(y), c);
    } else {
      const m = Math.hypot(x, y);
      if (m < 1e-9) { ox = 0; oy = 0; } else {
        const t = shapeMag(m, c);
        // square: the direction is stretched from the circle onto the square
        const d = c.shape === 2 ? Math.max(Math.abs(x), Math.abs(y)) : m;
        ox = (x / d) * t; oy = (y / d) * t;
      }
    }
    ox *= c.scaleX; oy *= c.scaleY;
    if (c.invX) ox = -ox;
    if (c.invY) oy = -oy;
    if (c.axes === 1) oy = 0; else if (c.axes === 2) ox = 0;
    return [clamp(ox, -1, 1), clamp(oy, -1, 1)];
  }

  function trigger(t, c) {
    const v = clamp01((t - c.start) / Math.max(0.01, c.end - c.start));
    return v <= 0 ? 0 : Math.pow(v, c.expo);
  }

  const n = (v) => (typeof v === 'string' ? v : Number.isFinite(v) ? +v.toFixed(4) : 0);
  // A profile -> the helper's settings lines (see parseLine in openw-input.cpp), ending in "apply".
  function lines(p) {
    const out = [];
    ['left', 'right'].forEach((side, i) => {
      const c = stickCfg(p.sticks[side]);
      out.push(['stick', i, c.shape, c.inner, c.outer, c.expo, c.anti, c.buffer, c.scaleX, c.scaleY, c.invX, c.invY, c.output, c.axes, c.ringAt, c.ringInvert, c.ringMask, c.smoothing].map(n).join(' '));
    });
    ['left', 'right'].forEach((side, i) => {
      const c = trigCfg(p.triggers[side]);
      out.push(['trigger', i, c.start, c.end, c.expo, c.hair, c.output].map(n).join(' '));
    });
    SOURCES.forEach((src, i) => {
      const b = p.buttons[src] || {};
      out.push(['button', i, OUT[b.to] || 0, b.turbo ? 1 : 0, b.rate || 10, b.toggle ? 1 : 0, OUT[b.hold] || 0, b.hold ? b.holdMs || 400 : 0].map(n).join(' '));
    });
    out.push(`rumble ${Math.round(p.rumble ?? 100)}`);
    const rgb = /^#([0-9a-f]{6})$/i.exec(p.light || '');
    out.push(rgb ? `light ${parseInt(rgb[1].slice(0, 2), 16)} ${parseInt(rgb[1].slice(2, 4), 16)} ${parseInt(rgb[1].slice(4), 16)}` : 'light -1 0 0');
    out.push('apply');
    return out;
  }

  /* ---------- profiles ---------- */

  const stickDefaults = (output) => ({ shape: 'circle', inner: 8, outer: 2, curve: 'linear', exponent: 1, anti: 0, buffer: 0, scaleX: 100, scaleY: 100,
    invertX: false, invertY: false, output, axes: 'both', ring: { to: '', at: 90, invert: false }, smoothing: 0 });
  const trigDefaults = (output) => ({ start: 0, end: 100, curve: 'linear', exponent: 1, hair: false, output });
  const DEFAULT_TO = { Touchpad: 'Back', Mute: '', FnL: '', FnR: '', PaddleL: '', PaddleR: '' };
  function blank(name) {
    const buttons = {};
    for (const s of SOURCES) buttons[s] = { to: s in DEFAULT_TO ? DEFAULT_TO[s] : s, turbo: false, rate: 10, toggle: false, hold: '', holdMs: 400 };
    return { name, sticks: { left: stickDefaults('left'), right: stickDefaults('right') }, triggers: { left: trigDefaults('left'), right: trigDefaults('right') }, buttons, rumble: 100, light: '' };
  }
  // Starting points for a new profile.
  const TEMPLATES = {
    standard: () => blank('Standard'),
    square: () => {
      const p = blank('Square dead zone');
      Object.assign(p.sticks.left, { shape: 'square', inner: 5, outer: 3 });
      return p;
    },
    precise: () => {
      const p = blank('Precise');
      Object.assign(p.sticks.left, { shape: 'square', inner: 4, outer: 2, curve: 'relaxed', anti: 10, buffer: 5 });
      return p;
    },
  };
  // Fills anything an older or pasted profile lacks.
  function complete(p) {
    const base = blank(p && p.name ? String(p.name).slice(0, 40) : 'Profile');
    if (!p || typeof p !== 'object') return base;
    for (const side of ['left', 'right']) {
      base.sticks[side] = { ...base.sticks[side], ...(p.sticks && p.sticks[side]), ring: { ...base.sticks[side].ring, ...(p.sticks && p.sticks[side] && p.sticks[side].ring) } };
      base.triggers[side] = { ...base.triggers[side], ...(p.triggers && p.triggers[side]) };
    }
    for (const s of SOURCES) base.buttons[s] = { ...base.buttons[s], ...(p.buttons && p.buttons[s]) };
    if (Number.isFinite(p.rumble)) base.rumble = p.rumble;
    if (typeof p.light === 'string') base.light = p.light;
    if (p.id) base.id = String(p.id);
    return base;
  }

  const api = { CURVES, SOURCES, OUT, stickCfg, trigCfg, shapeMag, stick, trigger, lines, blank, complete, TEMPLATES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenWTransform = api;
}(typeof window !== 'undefined' ? window : globalThis));
