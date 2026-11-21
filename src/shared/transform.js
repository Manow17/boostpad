/* OpenW Input's stick and trigger maths: Steam Input's own, measured from the Steam client
   (docs/steam-input.md). Values are in Steam's units: sticks from -32768 to 32767, settings as
   Steam stores them. The helper (native/openw-input.cpp) does the same in C++; tests compare
   the two, and compare both with points measured from Steam. Loaded by the page as a script
   and by the main process with require. */
(function (root) {
  const M = 32767;
  // Steam's response curves: out = s*r / (1 + (s-1)*r) on the stick's raw distance r (0..1),
  // where s is the curve's slope at the centre.
  const CURVE_SLOPES = { linear: 1, aggressive: 3, relaxed: 1 / 2, wide: 3 / 7, extrawide: 1 / 3 };
  const CURVE_NAMES = ['linear', 'aggressive', 'relaxed', 'wide', 'extrawide', 'custom'];
  const SHAPES = ['cross', 'circle', 'square'];
  const SOURCES_DZ = ['none', 'calibration', 'custom'];
  const OUTPUTS = { left: 0, right: 1, none: 2 };

  // Buttons on the real controller, in the helper's bit order.
  // (Touchpad is a click on its left half, or anywhere when the position is unknown; TouchpadRight the right half, as Steam splits it)
  const SOURCES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LS', 'RS', 'Back', 'Start', 'Guide', 'Up', 'Down', 'Left', 'Right', 'Touchpad', 'Mute', 'FnL', 'FnR', 'PaddleL', 'PaddleR', 'TouchpadRight'];
  // Buttons of the virtual Xbox 360 controller, plus a full trigger pull.
  const OUT = { A: 0x1000, B: 0x2000, X: 0x4000, Y: 0x8000, LB: 0x100, RB: 0x200, LS: 0x40, RS: 0x80, Back: 0x20, Start: 0x10, Guide: 0x400, Up: 0x1, Down: 0x2, Left: 0x4, Right: 0x8, LT: 0x10000, RT: 0x20000 };

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

  // Steam's Custom Response Curve slider (25..375) -> the curve's slope at the centre.
  // Measured: up to 201 it is x^3/(x^3+1), from 202 on 1 + (4-x)^-7, with x = value/100.
  function customSlope(v) {
    const x = clamp(Math.round(num(v, 200)), 25, 375) / 100;
    return Math.round(x * 100) <= 201 ? (x ** 3) / (x ** 3 + 1) : 1 + (4 - x) ** -7;
  }
  const slopeOf = (s) => (s.curve === 'custom' ? customSlope(s.customCurve) : CURVE_SLOPES[s.curve] ?? 1);
  const bend = (r, k) => (r > 0 ? (k * r) / (1 + (k - 1) * r) : 0);

  // Settings as saved -> the numbers the maths uses.
  function stickCfg(s) {
    const source = Math.max(0, SOURCES_DZ.indexOf(s.source));
    return {
      source, shape: Math.max(0, SHAPES.indexOf(s.shape)),
      inner: clamp(Math.round(num(s.inner, 0)), 0, 32000), outer: clamp(Math.round(num(s.outer, 28000)), 0, 32000),
      slope: slopeOf(s), anti: clamp(Math.round(num(s.anti, 0)), 0, M), buffer: clamp(Math.round(num(s.antiBuffer, 0)), 0, M),
      scaleX: clamp(num(s.scaleX, 100), 0, 100) / 100, scaleY: clamp(num(s.scaleY, 100), 0, 100) / 100,
      invX: s.invertX ? 1 : 0, invY: s.invertY ? 1 : 0, output: OUTPUTS[s.output] ?? 0,
      ringRadius: clamp(Math.round(num(s.ring && s.ring.radius, 25000)), 1, M), ringInvert: s.ring && s.ring.invert ? 1 : 0,
      ringMask: (s.ring && OUT[s.ring.to]) || 0, smoothing: clamp(num(s.smoothing, 0), 0, 100) / 100,
    };
  }
  function trigCfg(t) {
    const start = clamp(Math.round(num(t.start, 1000)), 0, M);
    return { start, end: clamp(Math.round(num(t.end, 32000)), 0, M), slope: CURVE_SLOPES[t.curve] ?? 1, hair: t.hair ? 1 : 0, output: OUTPUTS[t.output] ?? 0 };
  }

  const lin = (m, i, o) => (o > i ? clamp((m - i) / (o - i), 0, 1) : m > i ? 1 : 0);

  /* One stick, the way Steam does it (input and output from -32768 to 32767):
     - no dead zone (source None, or Inner 0 with Outer 32000): only the curve, on the round distance;
     - otherwise: buffer and anti-deadzone on the raw distance (round for Circle, per axis for Cross
       and Square), then the curve on the round distance, then Inner/Outer (round for Circle, per
       axis for the others); Square puts the result on a square's edge by its angle. */
  function stick(x, y, c) {
    const k = c.slope;
    let ox, oy;
    if (c.source === 0 || (c.inner === 0 && c.outer >= 32000)) {
      if (k === 1) { ox = x; oy = y; } else {
        const m = Math.hypot(x, y);
        if (m === 0) return [0, 0];
        const f = (bend(Math.min(m / M, 1), k) * M) / m;
        ox = x * f; oy = y * f;
      }
    } else {
      const anti = (v) => (v === 0 || (c.buffer && v < c.buffer) ? 0 : c.anti ? c.anti + v * (1 - c.anti / M) : v);
      if (c.shape === 1) {
        const m = Math.hypot(x, y);
        if (m === 0) return [0, 0];
        const m2 = anti(m);
        const t = lin(k === 1 ? m2 : bend(Math.min(m2 / M, 1), k) * M, c.inner, c.outer);
        ox = (x / m) * t * M; oy = (y / m) * t * M;
      } else {
        let vx = Math.sign(x) * anti(Math.abs(x)), vy = Math.sign(y) * anti(Math.abs(y));
        const m = Math.hypot(vx, vy);
        if (m > 0 && k !== 1) { const f = (bend(Math.min(m / M, 1), k) * M) / m; vx *= f; vy *= f; }
        const ax = lin(Math.abs(vx), c.inner, c.outer), ay = lin(Math.abs(vy), c.inner, c.outer);
        if (c.shape === 0) { ox = Math.sign(x) * ax * M; oy = Math.sign(y) * ay * M; } else {
          const L = Math.hypot(ax, ay);
          if (L === 0) return [0, 0];
          const frac = Math.atan2(Math.min(ax, ay), Math.max(ax, ay)) / (Math.PI / 4);
          const bx = ax >= ay ? L : L * frac, by = ax >= ay ? L * frac : L;
          ox = Math.sign(x) * bx * M; oy = Math.sign(y) * by * M;
        }
      }
    }
    ox *= c.scaleX; oy *= c.scaleY;
    if (c.invX) ox = -ox;
    if (c.invY) oy = -oy;
    return [Math.trunc(clamp(ox, -M, M)), Math.trunc(clamp(oy, -M, M))];
  }

  // A trigger: 0..32767 in and out; Steam's range (start/end) and response curve.
  function trigger(t, c) {
    const v = c.slope === 1 ? t : bend(Math.min(t / M, 1), c.slope) * M;
    return Math.trunc(lin(v, c.start, c.end) * M);
  }

  const n = (v) => (typeof v === 'string' ? v : Number.isFinite(v) ? +v.toFixed(6) : 0);
  // A profile -> the helper's settings lines (see parseLine in openw-input.cpp), ending in "apply".
  function lines(p) {
    const out = [];
    ['left', 'right'].forEach((side, i) => {
      const c = stickCfg(p.sticks[side]);
      out.push(['stick', i, c.source, c.shape, c.inner, c.outer, c.slope, c.anti, c.buffer, c.scaleX, c.scaleY, c.invX, c.invY, c.output, c.ringRadius, c.ringInvert, c.ringMask, c.smoothing].map(n).join(' '));
    });
    ['left', 'right'].forEach((side, i) => {
      const c = trigCfg(p.triggers[side]);
      out.push(['trigger', i, c.start, c.end, c.slope, c.hair, c.output].map(n).join(' '));
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

  // Steam's own defaults for a Joystick and a Trigger (as the Steam client reports them).
  const stickDefaults = (output) => ({ source: 'none', inner: 0, outer: 28000, shape: 'circle', curve: 'linear', customCurve: 200, anti: 0, antiBuffer: 0,
    scaleX: 100, scaleY: 100, invertX: false, invertY: false, output, ring: { to: '', radius: 25000, invert: false }, smoothing: 0 });
  const trigDefaults = (output) => ({ start: 1000, end: 32000, curve: 'linear', hair: false, output });
  const DEFAULT_TO = { Touchpad: 'Back', TouchpadRight: 'Start', Mute: '', FnL: '', FnR: '', PaddleL: '', PaddleR: '' };
  function blank(name) {
    const buttons = {};
    for (const s of SOURCES) buttons[s] = { to: s in DEFAULT_TO ? DEFAULT_TO[s] : s, turbo: false, rate: 10, toggle: false, hold: '', holdMs: 400 };
    return { name, sticks: { left: stickDefaults('left'), right: stickDefaults('right') }, triggers: { left: trigDefaults('left'), right: trigDefaults('right') }, buttons, rumble: 100, light: '', units: 'steam' };
  }
  // Starting points for a new profile.
  const TEMPLATES = {
    standard: () => blank('Steam defaults'),
    square: () => {
      const p = blank('Square dead zone');
      Object.assign(p.sticks.left, { source: 'custom', shape: 'square', inner: 3000, outer: 28000 });
      return p;
    },
  };

  // Profiles from before OpenW used Steam's units (percentages): converted as closely as they go.
  function fromPercent(s) {
    const pct = (v) => Math.round(clamp(num(v, 0), 0, 100) * 327.67);
    const inner = pct(s.inner), outer = clamp(Math.round((100 - clamp(num(s.outer, 0), 0, 50)) * 327.67), 0, 32000);
    return { source: inner > 0 || outer < 32000 ? 'custom' : 'none', inner, outer, shape: s.shape, curve: s.curve === 'custom' ? 'linear' : s.curve,
      anti: pct(s.anti), antiBuffer: pct(s.buffer), ring: { ...(s.ring || {}), radius: Math.round(clamp(num(s.ring && s.ring.at, 90), 1, 100) * 327.67) } };
  }
  // Fills anything an older or pasted profile lacks.
  function complete(p) {
    const base = blank(p && p.name ? String(p.name).slice(0, 40) : 'Profile');
    if (!p || typeof p !== 'object') return base;
    const old = p.units !== 'steam';
    for (const side of ['left', 'right']) {
      let s = (p.sticks && p.sticks[side]) || {};
      if (old && p.sticks) s = { ...s, ...fromPercent(s) };
      base.sticks[side] = { ...base.sticks[side], ...s, ring: { ...base.sticks[side].ring, ...(s.ring || {}) } };
      if (!SHAPES.includes(base.sticks[side].shape)) base.sticks[side].shape = 'circle';
      if (!CURVE_NAMES.includes(base.sticks[side].curve)) base.sticks[side].curve = 'linear';
      if (!SOURCES_DZ.includes(base.sticks[side].source)) base.sticks[side].source = 'none';
      let t = (p.triggers && p.triggers[side]) || {};
      if (old && p.triggers) t = { ...t, start: Math.round(clamp(num(t.start, 0), 0, 100) * 327.67), end: Math.round(clamp(num(t.end, 100), 0, 100) * 327.67) };
      base.triggers[side] = { ...base.triggers[side], ...t };
      if (!(base.triggers[side].curve in CURVE_SLOPES)) base.triggers[side].curve = 'linear';
    }
    for (const s of SOURCES) base.buttons[s] = { ...base.buttons[s], ...(p.buttons && p.buttons[s]) };
    if (Number.isFinite(p.rumble)) base.rumble = p.rumble;
    if (typeof p.light === 'string') base.light = p.light;
    if (p.id) base.id = String(p.id);
    if (p.from) base.from = String(p.from);
    return base;
  }

  const api = { M, CURVE_SLOPES, CURVE_NAMES, SOURCES, OUT, customSlope, stickCfg, trigCfg, stick, trigger, lines, blank, complete, TEMPLATES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenWTransform = api;
}(typeof window !== 'undefined' ? window : globalThis));
