// Reads the user's Steam Input layouts (Steam's own text files) and turns one into an OpenW
// Input profile with the same values. Setting names, numbers and defaults are Steam's, as its
// client reports them (see src/shared/transform.js for what they mean).
const fs = require('fs');
const path = require('path');

/* ---------- Valve KeyValues text ---------- */

// "key" "value" and "key" { ... }. A key that repeats (such as "group") becomes an array.
function parseVdf(text) {
  let i = 0;
  const n = text.length;
  const skip = () => {
    for (;;) {
      while (i < n && /\s/.test(text[i])) i++;
      if (text[i] === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
      break;
    }
  };
  const str = () => {
    if (text[i] === '"') {
      let out = '';
      i++;
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) { const c = text[i + 1]; out += c === 'n' ? '\n' : c === 't' ? '\t' : c; i += 2; } else out += text[i++];
      }
      i++;
      return out;
    }
    const start = i;
    while (i < n && !/[\s{}"]/.test(text[i])) i++;
    return text.slice(start, i);
  };
  const obj = () => {
    const o = {};
    for (;;) {
      skip();
      if (i >= n || text[i] === '}') { i++; return o; }
      const key = str();
      skip();
      const value = text[i] === '{' ? (i++, obj()) : str();
      if (Object.hasOwn(o, key)) o[key] = [].concat(o[key], [value]);
      else o[key] = value;
    }
  };
  return obj();
}
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/* ---------- finding the layouts ---------- */

const CONTROLLER_FILES = /^controller_(ps4|ps5|xbox360|xboxone|xboxelite|switch_pro|generic|steamcontroller_gordon|neptune)\.vdf$/i;

// Every layout Steam keeps for this PC's accounts, newest first.
function findLayouts(steamDir) {
  const root = path.join(steamDir, 'steamapps', 'common', 'Steam Controller Configs');
  const out = [];
  let accounts = [];
  try { accounts = fs.readdirSync(root); } catch { return out; }
  for (const account of accounts) {
    const configDir = path.join(root, account, 'config');
    let apps = [];
    try { apps = fs.readdirSync(configDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { continue; }
    for (const app of apps) {
      let files = [];
      try { files = fs.readdirSync(path.join(configDir, app)); } catch { continue; }
      for (const f of files) {
        const m = CONTROLLER_FILES.exec(f);
        if (!m) continue;
        const file = path.join(configDir, app, f);
        out.push({ app, controller: m[1].toLowerCase(), file, account, modified: fs.statSync(file).mtimeMs });
      }
    }
  }
  return out.sort((a, b) => b.modified - a.modified);
}

// The lightbar colour Steam uses for this PC's PlayStation controllers (newest preferences).
function steamLightbar(steamDir) {
  const root = path.join(steamDir, 'steamapps', 'common', 'Steam Controller Configs');
  let best = null;
  try {
    for (const account of fs.readdirSync(root)) {
      const dir = path.join(root, account, 'config');
      for (const f of fs.readdirSync(dir)) {
        if (!/^preferences_/i.test(f)) continue;
        const file = path.join(dir, f), t = fs.statSync(file).mtimeMs;
        const p = parseVdf(fs.readFileSync(file, 'utf8')).ControllerPersonalization || {};
        if (p.color_red == null || !/PS4|PS5|DualSense|DualShock/i.test(p.name || '')) continue;
        if (!best || t > best.t) best = { t, rgb: [p.color_red, p.color_green, p.color_blue].map(Number) };
      }
    }
  } catch { /* none */ }
  return best ? `#${best.rgb.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}` : '';
}

/* ---------- layout -> OpenW profile ---------- */

// Steam's xinput_button names -> the virtual Xbox controller's buttons in OpenW.
const XINPUT = {
  a: 'A', b: 'B', x: 'X', y: 'Y', shoulder_left: 'LB', shoulder_right: 'RB', joystick_left: 'LS', joystick_right: 'RS',
  start: 'Start', select: 'Back', guide: 'Guide', dpad_up: 'Up', dpad_down: 'Down', dpad_left: 'Left', dpad_right: 'Right',
  trigger_left: 'LT', trigger_right: 'RT',
};
// Where each Steam input sits on OpenW's list of real-controller buttons.
const FACE = { button_a: 'A', button_b: 'B', button_x: 'X', button_y: 'Y' };
const DPAD = { dpad_north: 'Up', dpad_south: 'Down', dpad_west: 'Left', dpad_east: 'Right' };
const SWITCHES = { button_escape: 'Start', button_menu: 'Back', left_bumper: 'LB', right_bumper: 'RB', button_back_left: 'PaddleL', button_back_right: 'PaddleR', button_capture: 'Mute' };

// "xinput_button A, , " -> 'A'; anything else (keys, mouse) -> null
function bindingOutput(binding) {
  const m = /^\s*xinput_button\s+([a-z_]+)/i.exec(String(binding || ''));
  return m ? XINPUT[m[1].toLowerCase()] || null : null;
}

// One input's activators -> OpenW's button fields (regular press, long press, turbo, toggle).
function inputBinding(input, skipped, label) {
  const out = {};
  const acts = input && input.activators ? input.activators : {};
  for (const [kind, raw] of Object.entries(acts)) {
    for (const act of list(raw)) {
      const bindings = list(act.bindings && act.bindings.binding);
      const to = bindings.map(bindingOutput).find(Boolean) || '';
      if (bindings.length && !to) skipped.push(`${label}: ${bindings[0].split(',')[0].trim()}`);
      const st = act.settings || {};
      if (kind === 'Full_Press') {
        out.to = to;
        if (st.toggle === '1') out.toggle = true;
        if (st.hold_repeats === '1') { out.turbo = true; if (st.repeat_rate) out.rate = Math.max(1, Math.min(30, Math.round(1000 / Math.max(1, Number(st.repeat_rate))))); }
      } else if (kind === 'Long_Press') {
        out.hold = to;
        if (st.long_press_time) out.holdMs = Number(st.long_press_time);
      } else if (bindings.length) skipped.push(`${label}: ${kind.replace('_', ' ').toLowerCase()}`);
    }
  }
  return out;
}

const num = (v, d) => (v == null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const CURVES = ['linear', 'aggressive', 'relaxed', 'wide', 'extrawide', 'custom'];
const SHAPES = ['cross', 'circle', 'square'];
const SOURCES = ['none', 'calibration', 'custom'];

// A joystick_move group's settings -> an OpenW stick (Steam's numbers; absent ones are Steam's defaults).
function stickFrom(group, side, skipped, T) {
  const s = (group && group.settings) || {};
  const d = T.blank('').sticks[side];
  const out = num(s.output_joystick, side === 'left' ? 0 : 1);
  if (out === 2) skipped.push(`${side} stick: mouse output`);
  return {
    ...d,
    source: SOURCES[num(s.deadzone_enable_type, 0)] || d.source,
    inner: num(s.deadzone_inner_radius, d.inner),
    outer: num(s.deadzone_outer_radius, d.outer),
    shape: SHAPES[num(s.deadzone_shape, 1)] || d.shape,
    curve: CURVES[num(s.curve_exponent, 0)] || d.curve,
    customCurve: num(s.custom_curve_exponent, d.customCurve),
    anti: num(s.anti_deadzone, d.anti),
    antiBuffer: num(s.anti_deadzone_buffer, d.antiBuffer),
    scaleX: num(s.sensitivity_horiz_scale, d.scaleX),
    scaleY: num(s.sensitivity_vert_scale, d.scaleY),
    invertX: s.invert_x === '1',
    invertY: s.invert_y === '1',
    output: out === 1 ? 'right' : out === 0 ? 'left' : 'none',
    ring: { ...d.ring, radius: num(s.edge_binding_radius, d.ring.radius), invert: s.edge_binding_invert === '1' },
  };
}

function triggerFrom(group, side, T) {
  const s = (group && group.settings) || {};
  const d = T.blank('').triggers[side];
  const out = num(s.output_trigger, side === 'left' ? 1 : 2);
  return {
    ...d,
    start: num(s.trigger_deadzone_start ?? s.deadzone_inner_radius, d.start),
    end: num(s.trigger_deadzone_end ?? s.deadzone_outer_radius, d.end),
    curve: CURVES[num(s.curve_exponent, 0)] || d.curve,
    customCurve: num(s.custom_curve_exponent, d.customCurve),
    output: out === 1 ? 'left' : out === 2 ? 'right' : 'none',
  };
}

// A layout file -> { profile, skipped } (skipped: Steam bindings OpenW cannot play).
function importLayout(file, T, { name, light } = {}) {
  const root = parseVdf(fs.readFileSync(file, 'utf8')).controller_mappings || {};
  const groups = new Map(list(root.group).map((g) => [String(g.id), g]));
  const preset = list(root.preset).find((p) => p.name === 'Default') || list(root.preset)[0] || {};
  const active = {}; // source -> group (only active ones)
  for (const [id, how] of Object.entries(preset.group_source_bindings || {})) {
    const [source, state] = String(how).split(/\s+/);
    if (state === 'active' && groups.has(id)) active[source] = groups.get(id);
  }
  const skipped = [];
  const p = T.blank(name || 'Steam layout');
  const st = active.joystick, rs = active.right_joystick;
  if (st && st.mode === 'joystick_move') p.sticks.left = stickFrom(st, 'left', skipped, T);
  else if (st) skipped.push(`left stick: ${st.mode}`);
  if (rs && rs.mode === 'joystick_move') p.sticks.right = stickFrom(rs, 'right', skipped, T);
  else if (rs) skipped.push(`right stick: ${rs.mode}`);
  if (active.left_trigger && active.left_trigger.mode === 'trigger') p.triggers.left = triggerFrom(active.left_trigger, 'left', T);
  if (active.right_trigger && active.right_trigger.mode === 'trigger') p.triggers.right = triggerFrom(active.right_trigger, 'right', T);

  // buttons start empty: the layout says what each one does
  for (const k of Object.keys(p.buttons)) p.buttons[k] = { ...p.buttons[k], to: '' };
  const setButton = (src, input, label) => { if (input) p.buttons[src] = { ...p.buttons[src], ...inputBinding(input, skipped, label) }; };
  const inputsOf = (g) => (g && g.inputs) || {};
  for (const [k, src] of Object.entries(FACE)) setButton(src, inputsOf(active.button_diamond)[k], src);
  for (const [k, src] of Object.entries(DPAD)) setButton(src, inputsOf(active.dpad)[k], src);
  for (const [k, src] of Object.entries(SWITCHES)) setButton(src, inputsOf(active.switch)[k], src);
  setButton('LS', inputsOf(st).click, 'left stick click');
  setButton('RS', inputsOf(rs).click, 'right stick click');
  // the PlayStation touchpad: Steam splits it into halves; a click on each half is its own button
  setButton('Touchpad', inputsOf(active.left_trackpad).click, 'touchpad (left half)');
  setButton('TouchpadRight', inputsOf(active.right_trackpad).click, 'touchpad (right half)');
  if (active.center_trackpad) setButton('Touchpad', inputsOf(active.center_trackpad).click, 'touchpad');
  // the PS / Xbox button opens Steam in Steam Input; in OpenW it stays the guide button
  p.buttons.Guide = { ...p.buttons.Guide, to: 'Guide' };
  if (light) p.light = light;
  return { profile: p, skipped };
}

module.exports = { parseVdf, findLayouts, importLayout, steamLightbar, bindingOutput };
