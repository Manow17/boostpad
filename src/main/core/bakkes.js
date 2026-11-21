// BakkesMod bridge for the Training page: Boostpad's own BakkesMod plugin, Boostpad Training
// (bakkesmod-plugin/, built into assets/bakkesmod/BoostpadTraining.dll), with freeplay
// checkpoints and impulse setups.
//
// Boostpad never touches the running game itself; the plugin does, inside BakkesMod. Boostpad
// installs it, binds its buttons and writes its settings: live over BakkesMod's RCON (a
// websocket on this PC, password from BakkesMod's own config) while it runs with the game, and
// in BakkesMod's files otherwise (binds.cfg, cfg/boostpad.cfg run right after the plugin loads).
const fs = require('fs');
const path = require('path');

const DIR = () => path.join(process.env.APPDATA || '', 'bakkesmod', 'bakkesmod');
const CFG = () => path.join(DIR(), 'cfg', 'config.cfg');
const BINDS = () => path.join(DIR(), 'cfg', 'binds.cfg');
const PLUGINS = () => path.join(DIR(), 'cfg', 'plugins.cfg');
const OUR_CFG = () => path.join(DIR(), 'cfg', 'boostpad.cfg');
const DLL_NAME = 'BoostpadTraining.dll';
const BUNDLED = path.join(__dirname, '..', '..', '..', 'assets', 'bakkesmod', DLL_NAME);

// The plugin's commands that sit on a button.
const ACTIONS = [
  { id: 'rewind', command: 'bp_rewind', label: 'Rewind', hint: 'Freezes Free Play; steer left and right to go back and forth through the last seconds. Press again to play on from there.' },
  { id: 'checkpoint', command: 'bp_checkpoint', label: 'Save / load checkpoint', hint: 'While rewinding: keeps this moment. While playing: jumps back to it.' },
  { id: 'prev', command: 'bp_checkpoint_prev', label: 'Previous checkpoint' },
  { id: 'next', command: 'bp_checkpoint_next', label: 'Next checkpoint' },
  { id: 'freezeBall', command: 'bp_freeze_ball', label: 'Hold the ball', hint: 'The ball stays where it is until you press again.' },
  { id: 'mirror', command: 'bp_mirror', label: 'Mirror the moment', hint: 'Left becomes right, to practise both sides.' },
  { id: 'impulse', command: 'bp_impulse', label: 'Impulse (current setup)', hint: 'Launches the ball as the selected impulse setup says.' },
];
const DEFAULT_BUTTONS = {
  rewind: 'XboxTypeS_RightThumbStick', checkpoint: 'XboxTypeS_Back', prev: 'XboxTypeS_DPad_Left', next: 'XboxTypeS_DPad_Right',
  freezeBall: 'XboxTypeS_DPad_Up', mirror: 'XboxTypeS_DPad_Down', impulse: 'T',
};

// Plugin settings, with type and default.
const OPTIONS = {
  bp_history: ['int', 30], bp_scrub_speed: ['float', 1.5], bp_variance: ['int', 0], bp_reset_on_goal: ['bool', false],
  bp_mirror_random: ['bool', false], bp_in_training: ['bool', false], bp_show_text: ['bool', true],
};
// An impulse setup: where the ball starts around the car and how it comes at you.
const SETUP_FIELDS = {
  kind: 'bp_impulse_kind', distance: 'bp_impulse_distance', side: 'bp_impulse_side', height: 'bp_impulse_height', speed: 'bp_impulse_speed',
  targetHeight: 'bp_impulse_target_height', lead: 'bp_impulse_lead', spin: 'bp_impulse_spin', random: 'bp_impulse_random', stopCar: 'bp_impulse_stop_car',
};
const KINDS = [['pass', 'Pass along the ground'], ['lob', 'Lob over to you'], ['high', 'High ball from ahead'], ['wall', 'Off the side wall'], ['bounce', 'Bouncing ball'], ['custom', 'Custom']];
const DEFAULT_SETUPS = [
  { id: 'pass', name: 'Ground pass', key: '', kind: 'pass', distance: 2400, side: 35, height: 100, speed: 1500, targetHeight: 100, lead: 0.9, spin: 0, random: 20, stopCar: false },
  { id: 'lob', name: 'Lob to the car', key: '', kind: 'lob', distance: 2600, side: 0, height: 100, speed: 1300, targetHeight: 900, lead: 1.2, spin: 1, random: 20, stopCar: false },
  { id: 'aerial', name: 'Aerial ball', key: '', kind: 'high', distance: 3000, side: 0, height: 1400, speed: 1200, targetHeight: 1200, lead: 1.4, spin: 0, random: 15, stopCar: false },
  { id: 'wall', name: 'Wall feed', key: '', kind: 'wall', distance: 2200, side: 90, height: 600, speed: 1400, targetHeight: 300, lead: 0.9, spin: 2, random: 20, stopCar: false },
  { id: 'bounce', name: 'Bounce dribble', key: '', kind: 'bounce', distance: 900, side: 0, height: 900, speed: 900, targetHeight: 93, lead: 0.6, spin: 0, random: 10, stopCar: true },
];

// Buttons BakkesMod knows by these names (Unreal's Xbox names; PlayStation in brackets).
const BUTTONS = [
  ['XboxTypeS_A', 'A (Cross)'], ['XboxTypeS_B', 'B (Circle)'], ['XboxTypeS_X', 'X (Square)'], ['XboxTypeS_Y', 'Y (Triangle)'],
  ['XboxTypeS_LeftShoulder', 'LB (L1)'], ['XboxTypeS_RightShoulder', 'RB (R1)'],
  ['XboxTypeS_LeftTrigger', 'LT (L2)'], ['XboxTypeS_RightTrigger', 'RT (R2)'],
  ['XboxTypeS_LeftThumbStick', 'Left stick click (L3)'], ['XboxTypeS_RightThumbStick', 'Right stick click (R3)'],
  ['XboxTypeS_Back', 'Back / View (Share)'], ['XboxTypeS_Start', 'Start / Menu (Options)'],
  ['XboxTypeS_DPad_Up', 'D-pad up'], ['XboxTypeS_DPad_Down', 'D-pad down'], ['XboxTypeS_DPad_Left', 'D-pad left'], ['XboxTypeS_DPad_Right', 'D-pad right'],
  ['One', 'Keyboard 1'], ['Two', 'Keyboard 2'], ['Three', 'Keyboard 3'], ['Four', 'Keyboard 4'], ['Five', 'Keyboard 5'], ['Six', 'Keyboard 6'],
  ['R', 'Keyboard R'], ['T', 'Keyboard T'], ['G', 'Keyboard G'], ['F', 'Keyboard F'], ['V', 'Keyboard V'], ['B', 'Keyboard B'],
  ['F5', 'Keyboard F5'], ['F6', 'Keyboard F6'], ['F7', 'Keyboard F7'], ['F8', 'Keyboard F8'],
];

/* ---------- BakkesMod's files ---------- */

// config.cfg: `name "value" //description`
function readCvars(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^(\w+)\s+"([^"]*)"/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
function writeCvars(text, values) {
  const seen = new Set();
  const lines = String(text).split(/\r?\n/).map((line) => {
    const m = /^(\w+)\s+"([^"]*)"(.*)$/.exec(line);
    if (!m || !(m[1] in values)) return line;
    seen.add(m[1]);
    return `${m[1]} "${values[m[1]]}"${m[3]}`;
  });
  for (const [k, v] of Object.entries(values)) if (!seen.has(k)) lines.push(`${k} "${v}"`);
  return lines.join('\r\n');
}

// binds.cfg: `bind KEY "cmd1;cmd2"`
function readBinds(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^bind\s+(\S+)\s+"([^"]*)"/.exec(line);
    if (m) out[m[1]] = m[2].split(';').map((c) => c.trim()).filter(Boolean);
  }
  return out;
}
// Boostpad's commands go on the chosen buttons; any earlier Boostpad command is taken off,
// Freeplay Checkpoint's (cpt_) commands are taken off the buttons Boostpad uses, and
// BakkesMod's own commands stay.
const OURS = (c) => /^bp_/.test(c);
function writeBinds(text, wanted) {
  const binds = readBinds(text);
  // a setup's button carries several commands joined into one
  const setupCommand = (c) => c.startsWith('bp_impulse_kind ');
  for (const key of Object.keys(binds)) binds[key] = binds[key].filter((c) => !OURS(c) && !setupCommand(c));
  for (const [key, cmds] of Object.entries(wanted)) {
    binds[key] = (binds[key] || []).filter((c) => !/^cpt_/.test(c));
    binds[key].push(...cmds);
  }
  const head = String(text).split(/\r?\n/).filter((l) => l.startsWith('//'));
  const body = Object.entries(binds).filter(([, cmds]) => cmds.length).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, cmds]) => `bind ${key} "${cmds.join(';')}"`);
  return [...head, ...body, ''].join('\n');
}

// What a setup's settings are as commands, and its own button's command (set it, then launch).
const setupValues = (s) => Object.fromEntries(Object.entries(SETUP_FIELDS).map(([field, cvar]) => [cvar, field === 'kind' ? s.kind : field === 'stopCar' ? (s.stopCar ? '1' : '0') : String(Number(s[field]) || 0)]));
const setupCommands = (s) => [...Object.entries(setupValues(s)).map(([k, v]) => `${k} ${v}`), 'bp_impulse'];

/* ---------- RCON ---------- */

function rcon(commands, { port, password, timeout = 3000 } = {}) {
  return new Promise((resolve) => {
    let ws;
    const done = (ok) => { clearTimeout(timer); try { ws && ws.close(); } catch { /* closing */ } resolve(ok); };
    const timer = setTimeout(() => done(false), timeout);
    try { ws = new WebSocket(`ws://127.0.0.1:${port}`); } catch { done(false); return; }
    ws.onerror = () => done(false);
    ws.onopen = () => ws.send(`rcon_password ${password}`);
    ws.onmessage = (e) => {
      const text = String(e.data);
      if (/authyes/i.test(text)) { for (const c of commands) ws.send(c); setTimeout(() => done(true), 300); }
      else if (/authno/i.test(text)) done(false);
    };
  });
}
function rconSettings() {
  const cfg = readCvars(fs.existsSync(CFG()) ? fs.readFileSync(CFG(), 'utf8') : '');
  return { enabled: cfg.rcon_enabled === '1', port: Number(cfg.rcon_port) || 9002, password: cfg.rcon_password || '' };
}

/* ---------- the page's state and changes ---------- */

const sameFile = (a, b) => { try { return fs.readFileSync(a).equals(fs.readFileSync(b)); } catch { return false; } };

// saved = Boostpad's own copy of the Training settings ({ buttons, options, setups, current }).
function state(live, saved = {}) {
  const dir = DIR();
  if (!fs.existsSync(path.join(dir, 'cfg'))) return { installed: false };
  const ours = path.join(dir, 'plugins', DLL_NAME);
  const plugins = fs.existsSync(PLUGINS()) ? fs.readFileSync(PLUGINS(), 'utf8') : '';
  return {
    installed: true, running: !!live,
    plugin: fs.existsSync(ours), upToDate: fs.existsSync(ours) && sameFile(ours, BUNDLED), bundled: fs.existsSync(BUNDLED),
    loaded: /plugin\s+load\s+boostpadtraining/i.test(plugins),
    rcon: rconSettings().enabled,
    buttons: { ...DEFAULT_BUTTONS, ...(saved.buttons || {}) },
    options: Object.fromEntries(Object.entries(OPTIONS).map(([k, [, d]]) => [k, saved.options && k in saved.options ? saved.options[k] : d])),
    setups: saved.setups && saved.setups.length ? saved.setups : DEFAULT_SETUPS,
    current: saved.current || 'pass',
    actions: ACTIONS.map(({ id, label, hint }) => ({ id, label, hint })),
    choices: BUTTONS, kinds: KINDS,
  };
}

const raw = (name, v) => {
  const [type] = OPTIONS[name];
  if (type === 'bool') return v ? '1' : '0';
  if (type === 'int') return String(Math.round(Number(v) || 0));
  return String(Number(v) || 0);
};

/**
 * Installs or updates the plugin. While BakkesMod runs it is unloaded, replaced and loaded again
 * over RCON; otherwise it is added to plugins.cfg and loads the next time BakkesMod starts.
 */
async function install(live) {
  if (!fs.existsSync(BUNDLED)) throw new Error('The plugin is not built. Run bakkesmod-plugin\\build.cmd.');
  const dest = path.join(DIR(), 'plugins', DLL_NAME);
  const r = rconSettings();
  if (live && r.enabled) await rcon(['plugin unload boostpadtraining'], r);
  try { fs.copyFileSync(BUNDLED, dest); } catch (e) { throw new Error(`Could not copy the plugin into BakkesMod (${e.code}). Close Rocket League and try again.`); }
  let plugins = fs.existsSync(PLUGINS()) ? fs.readFileSync(PLUGINS(), 'utf8') : '';
  if (!/plugin\s+load\s+boostpadtraining/i.test(plugins)) plugins = `${plugins.replace(/\s*$/, '')}\nplugin load boostpadtraining\nexec boostpad\n`;
  fs.writeFileSync(PLUGINS(), plugins);
  if (live && r.enabled) await rcon(['plugin load boostpadtraining', 'exec boostpad'], r);
  return { via: live && r.enabled ? 'rcon' : 'files' };
}

/**
 * Writes buttons, options and the current impulse setup: cfg/boostpad.cfg (run after the plugin
 * loads), binds.cfg, and live over RCON when BakkesMod runs with the game.
 * changes: { buttons, options, setups, current }
 */
async function save(changes, live) {
  const known = new Set(BUTTONS.map(([k]) => k));
  const values = {};
  for (const [k, v] of Object.entries(changes.options || {})) if (k in OPTIONS) values[k] = raw(k, v);
  const setups = changes.setups || DEFAULT_SETUPS;
  const current = setups.find((s) => s.id === changes.current) || setups[0];
  if (current) Object.assign(values, setupValues(current));

  const wanted = {};
  const add = (key, cmds) => { if (!key) return; if (!known.has(key)) throw new Error(`Unknown button ${key}`); (wanted[key] ??= []).push(...cmds); };
  for (const a of ACTIONS) add((changes.buttons || {})[a.id], [a.command]);
  for (const s of setups) add(s.key, setupCommands(s));

  const cfgLines = Object.entries(values).map(([k, v]) => `${k} "${v}"`);
  fs.writeFileSync(OUR_CFG(), `// written by Boostpad (Training page)\r\n${cfgLines.join('\r\n')}\r\n`);
  const bindsText = fs.existsSync(BINDS()) ? fs.readFileSync(BINDS(), 'utf8') : '';
  const newBinds = writeBinds(bindsText, wanted);
  const r = rconSettings();
  if (live) {
    if (!r.enabled) throw new Error('BakkesMod is running with RCON switched off. Close Rocket League and save again.');
    const before = readBinds(bindsText), after = readBinds(newBinds);
    const commands = [...cfgLines.map((l) => l.replace(/^(\w+) "(.*)"$/, '$1 "$2"'))];
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const a = (after[key] || []).join(';'), b = (before[key] || []).join(';');
      if (a !== b) commands.push(a ? `bind ${key} "${a}"` : `unbind ${key}`);
    }
    commands.push('writeconfig');
    if (!(await rcon(commands, r))) throw new Error('BakkesMod is running but did not answer. Close Rocket League and save again.');
  }
  fs.writeFileSync(BINDS(), newBinds);
  // config.cfg too, so the values hold even before boostpad.cfg runs
  if (!live && fs.existsSync(CFG())) fs.writeFileSync(CFG(), writeCvars(fs.readFileSync(CFG(), 'utf8'), values));
  return { via: live ? 'rcon' : 'files' };
}

// Try a setup right now (BakkesMod must be running with the game, in Free Play).
async function tryNow(setup) {
  const r = rconSettings();
  if (!r.enabled) throw new Error('BakkesMod RCON is off');
  if (!(await rcon(setupCommands(setup), r))) throw new Error('Start Rocket League with BakkesMod and open Free Play first.');
}

module.exports = { state, save, install, tryNow, readCvars, writeCvars, readBinds, writeBinds, setupCommands, rcon, ACTIONS, OPTIONS, BUTTONS, DEFAULT_SETUPS, DEFAULT_BUTTONS, KINDS };
