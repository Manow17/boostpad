// BakkesMod bridge for the Training page: the Freeplay Checkpoint plugin's settings and
// buttons. Boostpad never touches the game for this; BakkesMod does. While BakkesMod runs,
// changes go through its RCON plugin (a websocket on this PC, password from its own
// config). While it is closed, its config files are edited; it reads them when it starts.
const fs = require('fs');
const path = require('path');

const DIR = () => path.join(process.env.APPDATA || '', 'bakkesmod', 'bakkesmod');
const CFG = () => path.join(DIR(), 'cfg', 'config.cfg');
const BINDS = () => path.join(DIR(), 'cfg', 'binds.cfg');

// The plugin's commands that can sit on a button, and the setting that holds each button.
const ACTIONS = [
  { id: 'freeze', command: 'cpt_freeze', key: 'cpt_freeze_key', label: 'Rewind', hint: 'Freezes the game; move the stick to scrub back and forth through the last seconds.' },
  { id: 'checkpoint', command: 'cpt_do_checkpoint', key: 'cpt_do_checkpoint_key', label: 'Save / load checkpoint', hint: 'While rewinding: saves this moment. While playing: jumps back to the last checkpoint.' },
  { id: 'prev', command: 'cpt_prev_checkpoint', key: 'cpt_prev_checkpoint_key', label: 'Previous checkpoint' },
  { id: 'next', command: 'cpt_next_checkpoint', key: 'cpt_next_checkpoint_key', label: 'Next checkpoint' },
  { id: 'freezeBall', command: 'cpt_freeze_ball', key: 'cpt_freeze_ball_key', label: 'Freeze the ball' },
  { id: 'mirror', command: 'cpt_mirror_state', key: 'cpt_mirror_state_key', label: 'Mirror the moment' },
];

// The plugin's options Boostpad shows, with their type.
const OPTIONS = {
  cpt_history_length: 'int', cpt_load_after_reset: 'int', cpt_variance_tot: 'int',
  cpt_reset_on_goal: 'bool', cpt_reset_on_ball_ground: 'bool', cpt_next_instead_of_reset: 'bool',
  cpt_randomize_loads: 'bool', cpt_mirror_loads: 'bool', cpt_clean_history: 'bool', cpt_show_boost: 'bool',
  cpt_variance_ball_dir: 'bool', cpt_variance_ball_spd: 'bool', cpt_variance_ball_rot: 'bool',
  cpt_variance_car_dir: 'bool', cpt_variance_car_spd: 'bool', cpt_variance_car_rot: 'bool',
  cpt_disable_training: 'bool', cpt_disable_workshop: 'bool',
};

// Buttons BakkesMod knows by these names (Unreal's Xbox names; PlayStation in brackets).
const BUTTONS = [
  ['XboxTypeS_A', 'A (Cross)'], ['XboxTypeS_B', 'B (Circle)'], ['XboxTypeS_X', 'X (Square)'], ['XboxTypeS_Y', 'Y (Triangle)'],
  ['XboxTypeS_LeftShoulder', 'LB (L1)'], ['XboxTypeS_RightShoulder', 'RB (R1)'],
  ['XboxTypeS_LeftTrigger', 'LT (L2)'], ['XboxTypeS_RightTrigger', 'RT (R2)'],
  ['XboxTypeS_LeftThumbStick', 'Left stick click (L3)'], ['XboxTypeS_RightThumbStick', 'Right stick click (R3)'],
  ['XboxTypeS_Back', 'Back / View (Share)'], ['XboxTypeS_Start', 'Start / Menu (Options)'],
  ['XboxTypeS_DPad_Up', 'D-pad up'], ['XboxTypeS_DPad_Down', 'D-pad down'], ['XboxTypeS_DPad_Left', 'D-pad left'], ['XboxTypeS_DPad_Right', 'D-pad right'],
  ['One', 'Keyboard 1'], ['Two', 'Keyboard 2'], ['Three', 'Keyboard 3'], ['Four', 'Keyboard 4'],
  ['R', 'Keyboard R'], ['T', 'Keyboard T'], ['G', 'Keyboard G'], ['F', 'Keyboard F'],
];

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

// binds.cfg: `bind KEY "cmd1;cmd2"`. Each plugin command ends up on exactly the button chosen
// for it; other commands on the same buttons (BakkesMod's own) stay.
function readBinds(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^bind\s+(\S+)\s+"([^"]*)"/.exec(line);
    if (m) out[m[1]] = m[2].split(';').map((c) => c.trim()).filter(Boolean);
  }
  return out;
}
function writeBinds(text, keys) {
  const binds = readBinds(text);
  const ours = new Set(ACTIONS.map((a) => a.command));
  for (const key of Object.keys(binds)) binds[key] = binds[key].filter((c) => !ours.has(c));
  for (const a of ACTIONS) {
    const key = keys[a.id];
    if (key) (binds[key] ??= []).push(a.command);
  }
  const head = String(text).split(/\r?\n/).filter((l) => l.startsWith('//'));
  const body = Object.entries(binds).filter(([, cmds]) => cmds.length).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, cmds]) => `bind ${key} "${cmds.join(';')}"`);
  return [...head, ...body, ''].join('\n');
}

const typed = (name, v) => (OPTIONS[name] === 'bool' ? v === '1' || v === 1 || v === true : Number(v) || 0);
const raw = (name, v) => (OPTIONS[name] === 'bool' ? (v ? '1' : '0') : String(Math.max(0, Math.round(Number(v) || 0))));

/* ---------- RCON ---------- */

// Sends commands to BakkesMod. Resolves with false when it is not listening.
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

/* ---------- the page's state and changes ---------- */

function state(isRunning) {
  const dir = DIR();
  const installed = fs.existsSync(path.join(dir, 'cfg'));
  if (!installed) return { installed: false };
  const cfg = readCvars(fs.existsSync(CFG()) ? fs.readFileSync(CFG(), 'utf8') : '');
  const plugins = fs.existsSync(path.join(dir, 'cfg', 'plugins.cfg')) ? fs.readFileSync(path.join(dir, 'cfg', 'plugins.cfg'), 'utf8') : '';
  const options = Object.fromEntries(Object.keys(OPTIONS).map((k) => [k, typed(k, cfg[k])]));
  const buttons = Object.fromEntries(ACTIONS.map((a) => [a.id, cfg[a.key] || '']));
  return {
    installed,
    running: !!isRunning,
    plugin: fs.existsSync(path.join(dir, 'plugins', 'CheckpointPlugin.dll')),
    loaded: /plugin\s+load\s+checkpointplugin/i.test(plugins),
    rcon: cfg.rcon_enabled === '1',
    options, buttons,
    actions: ACTIONS.map(({ id, label, hint }) => ({ id, label, hint })),
    choices: BUTTONS,
  };
}

/**
 * Saves options and buttons. While BakkesMod runs: over RCON, then BakkesMod writes its own
 * files. While it is closed: straight into its files. Returns { via: 'rcon' | 'files' }.
 */
async function save({ options = {}, buttons = {} }, bakkesRunning) {
  const known = new Set(BUTTONS.map(([k]) => k));
  const values = {};
  for (const [k, v] of Object.entries(options)) if (k in OPTIONS) values[k] = raw(k, v);
  for (const a of ACTIONS) if (a.id in buttons) {
    if (buttons[a.id] && !known.has(buttons[a.id])) throw new Error(`Unknown button ${buttons[a.id]}`);
    values[a.key] = buttons[a.id] || '';
  }
  const cfgText = fs.readFileSync(CFG(), 'utf8');
  const cfg = readCvars(cfgText);
  const keys = Object.fromEntries(ACTIONS.map((a) => [a.id, a.id in buttons ? buttons[a.id] : cfg[a.key]]));
  const bindsText = fs.existsSync(BINDS()) ? fs.readFileSync(BINDS(), 'utf8') : '';
  const newBindsText = writeBinds(bindsText, keys);
  if (bakkesRunning) {
    if (cfg.rcon_enabled !== '1') throw new Error('BakkesMod is running with RCON switched off. Close BakkesMod and save again.');
    const commands = Object.entries(values).map(([k, v]) => `${k} "${v}"`);
    // only the buttons whose commands change are bound again
    const before = readBinds(bindsText), after = readBinds(newBindsText);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const a = (after[key] || []).join(';'), b = (before[key] || []).join(';');
      if (a !== b) commands.push(a ? `bind ${key} "${a}"` : `unbind ${key}`);
    }
    commands.push('writeconfig');
    const ok = await rcon(commands, { port: Number(cfg.rcon_port) || 9002, password: cfg.rcon_password || '' });
    if (!ok) throw new Error('BakkesMod is running but did not answer. Start Rocket League with BakkesMod, or close BakkesMod, then save again.');
    fs.writeFileSync(BINDS(), newBindsText); // what BakkesMod now has; it writes the same on exit
    return { via: 'rcon' };
  }
  fs.writeFileSync(CFG(), writeCvars(cfgText, values));
  fs.writeFileSync(BINDS(), newBindsText);
  return { via: 'files' };
}

module.exports = { state, save, readCvars, writeCvars, readBinds, writeBinds, rcon, ACTIONS, OPTIONS, BUTTONS };
