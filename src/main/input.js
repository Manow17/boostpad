// OpenW Input from the main process: runs the helper (bin/openw-input.exe, built from
// native/openw-input.cpp), hands it the profile, and passes on what it reports. Also checks
// for the two drivers it relies on and drives HidHide, which hides the real controller from
// games so they see only OpenW's virtual one.
const { spawn, execFile } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('../shared/transform');

const EXE = path.join(__dirname, '..', '..', 'bin', 'openw-input.exe');

class Input extends EventEmitter {
  constructor(exe = EXE) {
    super();
    this.exe = exe;
    this.proc = null;
    this.watching = false;
    this.status = { running: false, vigem: null, pad: null, error: '' };
  }

  get running() { return !!this.proc; }

  // own: take PlayStation controllers for the helper alone, so games cannot open them
  start(profile, { own = false } = {}) {
    if (this.proc) return this.configure(profile);
    if (!fs.existsSync(this.exe)) throw new Error('The input helper (bin/openw-input.exe) is missing. Build it with npm run build-input.');
    const proc = spawn(this.exe, own ? ['--own'] : [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    this.proc = proc;
    this.status = { running: true, vigem: null, pad: null, error: '' };
    let buf = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { this.line(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
    });
    proc.stdin.on('error', () => { /* it quit: the exit handler reports it */ });
    proc.on('error', (e) => { this.status.error = e.message; });
    proc.on('exit', (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.status = { ...this.status, running: false, pad: null, error: code ? this.status.error || `The input helper stopped (code ${code}).` : this.status.error };
      this.emit('status', this.status);
    });
    this.configure(profile);
    if (this.watching) this.write('watch 1');
    this.emit('status', this.status);
  }

  line(text) {
    const [kind, ...rest] = text.split(' ');
    if (kind === 'state') {
      const v = rest.map(Number);
      this.emit('state', { raw: v.slice(0, 6), rawButtons: v[6], out: v.slice(7, 13), outButtons: v[13] });
      return;
    }
    if (kind === 'vigem') this.status.vigem = rest[0] === 'ok';
    else if (kind === 'pad') this.status.pad = rest[0] === 'none' ? null : { kind: rest[0], conn: rest[1], access: rest[3] || 'shared' };
    else if (kind === 'error') this.status.error = rest.slice(1).join(' ');
    else return;
    this.emit('status', { ...this.status });
  }

  write(text) { if (this.proc && this.proc.stdin.writable) this.proc.stdin.write(`${text}\n`); }
  configure(profile) { for (const l of T.lines(profile)) this.write(l); }
  watch(on) { this.watching = !!on; this.write(`watch ${on ? 1 : 0}`); }
  own(on) { this.write(`own ${on ? 1 : 0}`); }
  reopen() { this.write('reopen'); }

  stop() {
    const proc = this.proc;
    if (!proc) return;
    this.write('quit');
    proc.stdin.end();
    setTimeout(() => { if (proc.exitCode == null) proc.kill(); }, 1500);
  }
}

/* ---------- drivers ---------- */

const regKey = (key) => new Promise((resolve) => execFile('reg', ['query', key], { windowsHide: true }, (err) => resolve(!err)));

const pf = process.env.ProgramFiles || 'C:\\Program Files';
const CLI_PLACES = [
  path.join(pf, 'Nefarius Software Solutions', 'HidHide', 'x64', 'HidHideCLI.exe'),
  path.join(pf, 'Nefarius Software Solutions', 'HidHide', 'HidHideCLI.exe'),
  path.join(pf, 'Nefarius Software Solutions e.U', 'HidHide', 'x64', 'HidHideCLI.exe'),
];
const hidHideCli = () => CLI_PLACES.find((p) => fs.existsSync(p)) || null;

async function drivers() {
  const [vigem, hidhide] = await Promise.all([
    regKey('HKLM\\SYSTEM\\CurrentControlSet\\Services\\ViGEmBus'),
    regKey('HKLM\\SYSTEM\\CurrentControlSet\\Services\\HidHide'),
  ]);
  return { vigem, hidhide: hidhide && !!hidHideCli(), helper: fs.existsSync(EXE) };
}

/* ---------- HidHide ---------- */

// HidHideCLI writes UTF-16 on some versions and UTF-8 on others.
const decode = (buf) => (buf.length > 1 && (buf[1] === 0 || (buf[0] === 0xFF && buf[1] === 0xFE)) ? buf.toString('utf16le') : buf.toString('utf8')).replace(/^\uFEFF/, '');
const cli = (args) => new Promise((resolve, reject) => {
  const exe = hidHideCli();
  if (!exe) return reject(new Error('HidHide is not installed.'));
  execFile(exe, args, { encoding: 'buffer', windowsHide: true, timeout: 10000 }, (err, out) => (err ? reject(err) : resolve(decode(out))));
});
const quoted = (text) => [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

// Every device entry in --dev-gaming's JSON, wherever it sits.
function gamingDevices(json) {
  const found = [];
  const walk = (node, group) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, group));
    if (!node || typeof node !== 'object') return;
    if (typeof node.deviceInstancePath === 'string') found.push({ ...node, group });
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, node.friendlyName || group);
  };
  walk(json, '');
  return found;
}

// The controllers HidHide can hide, grouped as one entry per physical controller.
function controllers(json, hidden) {
  const groups = new Map();
  for (const d of gamingDevices(json)) {
    if (d.present === false) continue;
    const key = d.baseContainerDeviceInstancePath || d.deviceInstancePath;
    const ids = /VID_([0-9A-F]{4}).*PID_([0-9A-F]{4})/i.exec(d.deviceInstancePath) || [];
    const g = groups.get(key) || { name: d.group || d.description || d.product || 'Controller', vid: (ids[1] || '').toUpperCase(), pid: (ids[2] || '').toUpperCase(), paths: [] };
    for (const p of [d.deviceInstancePath, d.baseContainerDeviceInstancePath]) if (p && !g.paths.includes(p)) g.paths.push(p);
    groups.set(key, g);
  }
  const lower = new Set(hidden.map((p) => p.toLowerCase()));
  return [...groups.values()].map((g) => ({
    ...g,
    hidden: g.paths.some((p) => lower.has(p.toLowerCase())),
    // an Xbox 360 pad may be OpenW's own virtual one
    virtual: g.vid === '045E' && g.pid === '028E',
  }));
}

async function hidState() {
  if (!hidHideCli()) return { installed: false, controllers: [], hidden: [], cloak: false, apps: [] };
  const read = (args) => cli(args).catch(() => null);
  const [gaming, list, cloak, apps] = await Promise.all([read(['--dev-gaming']), read(['--dev-list']), read(['--cloak-state']), read(['--app-list'])]);
  let json = [];
  try { json = gaming ? JSON.parse(gaming) : []; } catch { json = []; }
  const hidden = list ? quoted(list) : [];
  return {
    installed: true,
    readable: gaming != null,
    controllers: controllers(json, hidden),
    hidden,
    cloak: cloak ? /cloak-on/i.test(cloak) : null,
    apps: apps ? quoted(apps) : [],
    helperAllowed: apps ? quoted(apps).some((p) => p.toLowerCase() === EXE.toLowerCase()) : null,
  };
}

// Changing HidHide needs administrator rights: the commands run in one elevated PowerShell,
// so Windows asks once.
function elevated(commands) {
  const exe = hidHideCli();
  if (!exe) return Promise.reject(new Error('HidHide is not installed.'));
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openw-hidhide-'));
  const script = path.join(dir, 'hidhide.ps1');
  fs.writeFileSync(script, `$cli = ${q(exe)}\r\n${commands.map((args) => `& $cli ${args.map(q).join(' ')}`).join('\r\n')}\r\n`, 'utf8');
  const start = `Start-Process -FilePath powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${q(`"${script}"`)}`;
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', start], { windowsHide: true }, (err) => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (err) reject(new Error('Windows did not give HidHide permission, so nothing changed.'));
    else resolve();
  }));
}

// Hide these device paths from every app except the input helper.
const hide = (paths) => elevated([['--app-reg', EXE], ...paths.map((p) => ['--dev-hide', p]), ['--cloak-on']]);
const show = (paths) => elevated(paths.map((p) => ['--dev-unhide', p]));

module.exports = { Input, EXE, drivers, hidState, hide, show, controllers, gamingDevices, decode };
