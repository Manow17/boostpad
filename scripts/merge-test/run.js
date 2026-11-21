// Merge tester: builds many merges at once, starts Rocket League, loads every merged arena in
// Free Play through BakkesMod, and takes screenshots from fixed angles, one contact sheet per
// arena, so the results can be looked through without playing each map.
//
//   node scripts/merge-test/run.js [--round 1] [--rounds 1] [--limit 60] [--pairs stadium:place,...]
//                                  [--keep] [--angles kickoff,left,back,right,sky,edge]
//
// It takes over the PC while it runs (it presses keys and moves the mouse in the game window),
// so start it when nobody is using the computer. Its merges are kept apart from your own
// OpenW changes (its own records and backups in %APPDATA%\OpenW\merge-test) and arenas
// you have changed yourself are left out. Everything it writes is reverted at the end, also
// after an error; --keep leaves the last round in place.
// Needs: Rocket League (Epic or Steam, as set in OpenW), BakkesMod with its RCON plugin.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const root = path.join(__dirname, '..', '..', 'src', 'main', 'core');
const upk = require(path.join(root, 'upk'));
const mapbuild = require(path.join(root, 'mapbuild'));
const arenas = require(path.join(root, 'arenas'));
const game = require(path.join(root, 'game'));
const { Engine } = require(path.join(root, 'engine'));
const { Store } = require(path.join(root, 'store'));
const { readTexts } = require(path.join(root, 'labels'));

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const flag = (name) => process.argv.includes(`--${name}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const APPDATA = path.join(process.env.APPDATA, 'OpenW');
const HOME = path.join(APPDATA, 'merge-test');
const settings = JSON.parse(fs.readFileSync(path.join(APPDATA, 'settings.json'), 'utf8'));
const cooked = game.cookedDir(settings.installDir);
const keys = fs.existsSync(path.join(APPDATA, 'keys.txt')) ? upk.parseKeys(fs.readFileSync(path.join(APPDATA, 'keys.txt'), 'utf8')) : [];
const ANGLES = arg('angles', 'kickoff,left,back,right,sky,edge').split(',');

/* ---------- the tester's own engine, apart from the user's OpenW changes ---------- */
fs.mkdirSync(HOME, { recursive: true });
const engine = new Engine({
  store: new Store(path.join(HOME, 'state.json')), backupDir: path.join(HOME, 'backups'),
  getCookedDir: () => cooked, isRunning: game.isRunning, getKeys: () => keys,
});
const userState = fs.existsSync(path.join(APPDATA, 'state.json')) ? JSON.parse(fs.readFileSync(path.join(APPDATA, 'state.json'), 'utf8')) : { active: {}, queue: [] };
const userFiles = new Set([...Object.keys(userState.active || {}), ...(userState.queue || []).map((q) => q.key)]);
// a file the user changed: its original is in the user's backups
const pristine = (f) => {
  const mine = engine.pristine(f);
  if (mine !== path.join(cooked, f)) return mine;
  const theirs = path.join(APPDATA, 'backups', f.toLowerCase());
  return userFiles.has(f.toLowerCase()) && fs.existsSync(theirs) ? theirs : mine;
};

function revertAll() {
  const active = Object.keys(engine.store.get('active'));
  for (const key of active) { try { engine.revertNow(key); } catch (e) { log('revert failed', key, e.message); } }
  engine.store.set('queue', []);
  if (active.length) log(`reverted ${active.length} test files`);
}

/* ---------- the game, BakkesMod and the helper ---------- */
async function closeGame() {
  if (!(await game.isRunning())) return;
  log('closing Rocket League');
  execFile('taskkill', ['/IM', 'RocketLeague.exe'], { windowsHide: true }, () => {});
  for (let i = 0; i < 60 && (await game.isRunning()); i++) await sleep(1000);
  if (await game.isRunning()) { execFile('taskkill', ['/IM', 'RocketLeague.exe', '/F'], { windowsHide: true }, () => {}); await sleep(3000); }
}
function openUrl(url) { execFile('cmd', ['/c', 'start', '', url], { windowsHide: true }, () => {}); }

const bakkesCfg = () => {
  const text = fs.readFileSync(path.join(process.env.APPDATA, 'bakkesmod', 'bakkesmod', 'cfg', 'config.cfg'), 'utf8');
  const get = (k) => (new RegExp(`^${k}\\s+"([^"]*)"`, 'm').exec(text) || [])[1];
  return { port: Number(get('rcon_port')) || 9002, password: get('rcon_password') || '' };
};
function rcon(command, timeout = 4000) {
  const { port, password } = bakkesCfg();
  return new Promise((resolve) => {
    let ws; const done = (v) => { clearTimeout(t); try { ws.close(); } catch { /* closing */ } resolve(v); };
    const t = setTimeout(() => done(false), timeout);
    try { ws = new WebSocket(`ws://127.0.0.1:${port}`); } catch { done(false); return; }
    ws.onerror = () => done(false);
    ws.onopen = () => ws.send(`rcon_password ${password}`);
    ws.onmessage = (e) => { const s = String(e.data); if (/authyes/i.test(s)) { ws.send(command); setTimeout(() => done(true), 300); } else if (/authno/i.test(s)) done(false); };
  });
}
async function startBakkes() {
  if (await rcon('echo openw')) return true;
  const exe = 'C:\\Program Files\\BakkesMod\\BakkesMod.exe';
  if (!(await game.isProcessRunning('BakkesMod.exe'))) { log('starting BakkesMod'); spawn(exe, [], { detached: true, stdio: 'ignore' }).unref(); }
  for (let i = 0; i < 90; i++) { await sleep(2000); if (await rcon('echo openw')) return true; }
  return false;
}

function startHelper() {
  const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'helper.ps1')], { stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '';
  const waiting = [];
  ps.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); const w = waiting.shift(); if (w) w(line); }
  });
  const send = (cmd) => new Promise((r) => { waiting.push(r); ps.stdin.write(`${cmd}\n`); });
  const ready = new Promise((r) => waiting.push(r)); // the "ready" line
  return { send, ready, quit: () => { try { ps.stdin.write('quit\n'); } catch { /* gone */ } } };
}

// Launch.log grows as the game loads maps; wait for "Bringing World <map>" after a mark.
const LOG = path.join(process.env.USERPROFILE, 'Documents', 'My Games', 'Rocket League', 'TAGame', 'Logs', 'Launch.log');
const logSize = () => { try { return fs.statSync(LOG).size; } catch { return 0; } };
async function waitForMap(map, from, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(1000);
    try {
      const fd = fs.openSync(LOG, 'r'); const size = fs.fstatSync(fd).size;
      const b = Buffer.alloc(Math.max(0, size - from)); fs.readSync(fd, b, 0, b.length, from); fs.closeSync(fd);
      if (new RegExp(`Bringing World ${map}\\.TheWorld up for play`, 'i').test(b.toString('latin1'))) return true;
    } catch { /* log busy */ }
  }
  return false;
}

/* ---------- one arena's screenshots ---------- */
const MOUSE = Number(arg('mouse', '900')); // mouse counts for a quarter turn of the camera (tune with --mouse)
async function shoot(h, dir, base) {
  const shots = [];
  const take = async (angle) => {
    const file = path.join(dir, `${base}_${angle}.jpg`);
    const dark = Number(await h.send(`shot ${file} 1280`));
    shots.push({ angle, file, dark: Number.isFinite(dark) ? Math.round(dark * 1000) / 10 : null });
  };
  await h.send('focus');
  await sleep(1500);
  for (const angle of ANGLES) {
    if (angle === 'kickoff') await take('kickoff');
    if (angle === 'left') { await h.send(`mouse ${-MOUSE} 0`); await sleep(400); await take('left'); await h.send(`mouse ${MOUSE} 0`); await sleep(800); }
    if (angle === 'right') { await h.send(`mouse ${MOUSE} 0`); await sleep(400); await take('right'); await h.send(`mouse ${-MOUSE} 0`); await sleep(800); }
    if (angle === 'back') { await h.send('down LeftControl'); await sleep(500); await take('back'); await h.send('up LeftControl'); await sleep(500); }
    if (angle === 'sky') { await h.send(`mouse 0 ${-MOUSE}`); await sleep(400); await take('sky'); await h.send(`mouse 0 ${MOUSE}`); await sleep(800); }
    if (angle === 'edge') {
      // drive to a side wall: turn right while rolling, then boost straight; look over the wall
      await h.send('down W'); await h.send('tap D 650'); await h.send('down LeftShift'); await sleep(1600);
      await h.send('up LeftShift'); await h.send('up W'); await sleep(700);
      await take('edge');
      await h.send(`mouse 0 ${-Math.round(MOUSE / 2)}`); await sleep(400); await take('edgeup'); await h.send(`mouse 0 ${Math.round(MOUSE / 2)}`);
      await h.send('tap Backspace 120'); await sleep(1500);
    }
  }
  return shots;
}

/* ---------- main ---------- */
(async () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = path.join(HOME, 'runs', stamp);
  fs.mkdirSync(out, { recursive: true });
  const report = { started: new Date().toISOString(), cooked, rounds: [] };
  const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  let helper = null;
  try {
    await closeGame();
    revertAll(); // a run that stopped half-way

    const all = arenas.scanArenas(cooked, {}, keys, readTexts(cooked, keys).maps, pristine);
    const touched = (a) => [a.file, ...a.parts.map((p) => p.file)].some((f) => userFiles.has(f.toLowerCase()));
    const pool = all.filter((a) => a.standard && !touched(a));
    log(`${pool.length} standard arenas to use (${all.filter((a) => a.standard && touched(a)).length} left out: you changed them)`);

    const rounds = [];
    if (arg('pairs')) {
      rounds.push(arg('pairs').split(',').map((s) => s.split(':')).map(([s, p]) => [pool.find((a) => a.id === s), pool.find((a) => a.id === p)]).filter(([s, p]) => s && p));
    } else {
      const first = Number(arg('round', '1')), count = Number(arg('rounds', '1')), limit = Number(arg('limit', String(pool.length)));
      for (let r = first; r < first + count; r++) rounds.push(pool.slice(0, limit).map((s, i) => [s, pool[(i + r) % pool.length]]));
    }

    for (const [ri, pairs] of rounds.entries()) {
      const round = { pairs: [] };
      report.rounds.push(round);
      // build every merge of the round (each place arena once, so they never touch the same file)
      for (const [S, P] of pairs) {
        const entry = { stadium: S.name, place: P.name, stadiumId: S.id, placeId: P.id };
        round.pairs.push(entry);
        try {
          const opened = new Map();
          const open = (f) => { const k = f.toLowerCase(); if (!opened.has(k)) { try { opened.set(k, mapbuild.open(fs.readFileSync(pristine(f)), keys)); } catch { opened.set(k, null); } } return opened.get(k); };
          const plan = arenas.mergePlan(S, P, all, arenas.mergeInfo(S, P, open, mapbuild));
          entry.how = plan.how; entry.note = plan.note || plan.reason || '';
          if (plan.how === 'none') continue;
          for (const op of plan.ops) engine.applyNow({ ...op, from: op.from });
          entry.built = true;
          log(`built  ${S.name} -> ${P.name}`);
        } catch (e) { entry.error = e.message; log(`FAILED ${S.name} -> ${P.name}: ${e.message}`); }
        save();
      }

      // the game reads arena files when it starts
      log('starting Rocket League');
      openUrl(game.launchUrl(settings.platform));
      for (let i = 0; i < 120 && !(await game.isRunning()); i++) await sleep(1000);
      await sleep(45000);
      if (!(await startBakkes())) throw new Error('BakkesMod did not answer over RCON (is its RCON plugin on?)');
      helper = startHelper();
      await helper.ready;
      await helper.send('focus'); await helper.send('tap Enter 100'); await sleep(8000); // past the title screen

      for (const entry of round.pairs.filter((p) => p.built)) {
        const P = pool.find((a) => a.id === entry.placeId);
        const map = P.file.replace(/\.upk$/i, '');
        const mark = logSize();
        await rcon(`load_freeplay ${map}`);
        entry.loaded = await waitForMap(map, mark);
        if (!entry.loaded) { log(`did not load ${map}`); entry.error = (entry.error || '') + ' map did not load'; save(); continue; }
        await sleep(5000);
        const base = `${String(round.pairs.indexOf(entry) + 1).padStart(2, '0')}_${entry.stadiumId}_in_${entry.placeId}`.replace(/[^\w-]/g, '');
        entry.shots = await shoot(helper, out, base);
        entry.sheet = path.join(out, `${base}.jpg`);
        await helper.send(`sheet ${entry.sheet} 3 ${entry.shots.map((s) => s.file).join(' ')}`);
        entry.darkest = Math.max(...entry.shots.map((s) => s.dark || 0));
        log(`shot   ${entry.stadium} in ${entry.place}  (darkest ${entry.darkest}%)`);
        save();
      }
      helper.quit(); helper = null;
      await closeGame();
      if (!(flag('keep') && ri === rounds.length - 1)) revertAll();
    }
  } catch (e) {
    report.error = e.message;
    log('stopped:', e.message);
  } finally {
    if (helper) helper.quit();
    if (!flag('keep')) { await closeGame(); revertAll(); }
    report.finished = new Date().toISOString();
    save();
    // a page with every contact sheet, darkest first
    const rows = report.rounds.flatMap((r) => r.pairs).filter((p) => p.sheet)
      .sort((a, b) => (b.darkest || 0) - (a.darkest || 0))
      .map((p) => `<h3>${p.stadium} stadium in ${p.place} — ${p.how}${p.darkest ? `, darkest shot ${p.darkest}% black` : ''}</h3><img src="${path.basename(p.sheet)}" width="1280">`);
    fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Merge test ${stamp}</title><body style="background:#111;color:#eee;font:14px sans-serif">${rows.join('\n')}</body>`);
    log('results in', out);
    process.exit(0);
  }
})();
