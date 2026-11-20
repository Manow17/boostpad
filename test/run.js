// Core tests. They never write to the real game folder: packages are copied
// into a temp "CookedPCConsole" first. Tests that need game files are skipped
// when Rocket League is not installed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

const game = require('../src/main/core/game');
const upk = require('../src/main/core/upk');
const { buildCatalog, annotate, canSwap, prettify } = require('../src/main/core/catalog');
const { readThumbnail, decodeDxt } = require('../src/main/core/thumbs');
const { Engine } = require('../src/main/core/engine');
const { Store } = require('../src/main/core/store');
const { Maps, MAP_SLOT } = require('../src/main/core/library');
const arenas = require('../src/main/core/arenas');
const mapbuild = require('../src/main/core/mapbuild');
const { readLabels, readTexts, applyLabels } = require('../src/main/core/labels');

const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boostpad-test-'));
let passed = 0, skipped = 0;
const tests = [];
function test(name, fn, skip) { tests.push({ name, fn, skip }); }
async function runAll() {
  for (const { name, fn, skip } of tests) { // one at a time: they share a folder
    if (skip) { skipped++; console.log(`  skip  ${name}`); continue; }
    try { await fn(); passed++; console.log(`  ok    ${name}`); }
    catch (e) { process.exitCode = 1; console.log(`  FAIL  ${name}\n        ${e.stack}`); }
  }
}

function makeEngine(cooked, running = { value: false }) {
  const data = fs.mkdtempSync(path.join(tmp, 'data-'));
  const engine = new Engine({
    store: new Store(path.join(data, 'state.json')),
    backupDir: path.join(data, 'backups'),
    getCookedDir: () => cooked,
    isRunning: async () => running.value,
  });
  return { engine, running, data };
}

(async () => {
  const found = await game.detect();
  const install = found.epic || found.steam;
  const real = install ? game.cookedDir(install) : null;
  console.log(`game: ${install || 'not installed'}`);

  test('prettify item names', () => {
    assert.strictEqual(prettify('AlphaReward'), 'Alpha Reward');
    assert.strictEqual(prettify('star_holo'), 'Star Holo');
  });

  test('store round-trips', () => {
    const f = path.join(tmp, 's.json');
    new Store(f, { a: 1 }).set('b', [2]);
    assert.deepStrictEqual(new Store(f).data, { a: 1, b: [2] });
  });

  test('catalog lists items from the install', () => {
    const cat = buildCatalog(real);
    const count = (c) => cat.items.filter((i) => i.category === c).length;
    assert.ok(count('cars') > 50 && count('wheels') > 200 && count('decals') > 500);
    assert.ok(cat.items.every((i) => !/_T_SF\.upk$/i.test(i.file)));
    console.log(`        ${cat.items.length} items in ${cat.categories.length} categories`);
  }, !real);

  // Pick a few real wheel packages to work on, copied to a temp folder.
  let cooked = null, files = [];
  if (real) {
    cooked = path.join(tmp, 'CookedPCConsole');
    fs.mkdirSync(cooked);
    files = buildCatalog(real).items.filter((i) => i.category === 'wheels').map((i) => i.file)
      .sort((a, b) => a.length - b.length);
    // Newer packages use keys Boostpad does not have; test with ones it can read.
    const readable = (f) => { try { upk.readPackageFile(path.join(real, f)); return true; } catch { return false; } };
    const mid = Math.floor(files.length / 2);
    files = [files.find(readable), files.slice(mid).find(readable), files.findLast(readable)];
    for (const f of [...files, MAP_SLOT]) fs.copyFileSync(path.join(real, f), path.join(cooked, f));
  }
  const [shortF, midF, longF] = files;

  test('package header decrypts and the name table parses', () => {
    for (const f of files) {
      const pkg = upk.readPackageFile(path.join(cooked, f));
      assert.strictEqual(pkg.names.length, pkg.summary.nameCount);
      const base = upk.baseName(f).toLowerCase();
      assert.ok(pkg.names.some((n) => n.text.toLowerCase() === base), `${f} has no "${base}" name`);
    }
  }, !real);

  test('rename is in place: same size, only the header block changes', () => {
    const buf = fs.readFileSync(path.join(cooked, longF));
    const from = upk.baseName(longF), to = upk.baseName(shortF);
    const res = upk.renameNames(buf, [{ from, to }, { from: `${from}_SF`, to: `${to}_SF` }]);
    assert.strictEqual(res.buffer.length, buf.length);
    const before = upk.readPackage(buf), after = upk.readPackage(res.buffer);
    const { start, size } = before.range;
    assert.ok(buf.subarray(0, start).equals(res.buffer.subarray(0, start)));
    assert.ok(buf.subarray(start + size).equals(res.buffer.subarray(start + size)));
    assert.strictEqual(after.names.length, before.names.length);
    assert.ok(after.names.some((n) => n.text === to));
    assert.ok(!after.names.some((n) => n.text.toLowerCase() === from.toLowerCase()));
    const changed = after.names.filter((n, i) => n.text !== before.names[i].text).length;
    assert.strictEqual(changed, res.renamed.length);
  }, !real);

  test('a longer name is refused, not truncated', () => {
    const buf = fs.readFileSync(path.join(cooked, shortF));
    assert.throws(
      () => upk.renameNames(buf, [{ from: upk.baseName(shortF), to: upk.baseName(longF) }]),
      (e) => e.code === 'NAME_TOO_LONG',
    );
  }, !real);

  test('swap writes the file, keeps a backup, and revert restores it exactly', async () => {
    const { engine, data } = makeEngine(cooked);
    const dest = path.join(cooked, shortF);
    const original = sha(dest);
    assert.deepStrictEqual(engine.checkSwap({ kind: 'swap', sourceFile: shortF, targetFile: longF }), { ok: true });
    const res = await engine.apply({ kind: 'swap', sourceFile: shortF, targetFile: longF });
    assert.strictEqual(res.queued, false);
    assert.notStrictEqual(sha(dest), original);
    assert.strictEqual(sha(path.join(data, 'backups', shortF.toLowerCase())), original);
    // the swapped package now answers to the source item's name
    const base = upk.baseName(shortF).toLowerCase();
    assert.ok(upk.readPackageFile(dest).names.some((n) => n.text.toLowerCase() === base));
    // applying a second swap on top must not overwrite the pristine backup
    await engine.apply({ kind: 'swap', sourceFile: shortF, targetFile: midF });
    assert.strictEqual(sha(path.join(data, 'backups', shortF.toLowerCase())), original);
    await engine.revert(shortF.toLowerCase());
    assert.strictEqual(sha(dest), original);
    assert.strictEqual(engine.list().active.length, 0);
    assert.ok(!fs.existsSync(path.join(data, 'backups', shortF.toLowerCase())));
  }, !real);

  test('changes are queued while the game runs and applied when it closes', async () => {
    const { engine, running } = makeEngine(cooked, { value: true });
    const dest = path.join(cooked, midF);
    const original = sha(dest);
    const res = await engine.apply({ kind: 'swap', sourceFile: midF, targetFile: longF });
    assert.strictEqual(res.queued, true);
    assert.strictEqual(sha(dest), original);
    assert.deepStrictEqual(await engine.flushQueue(), []); // still running: nothing happens
    running.value = false;
    const done = await engine.flushQueue();
    assert.ok(done.length === 1 && done[0].ok);
    assert.notStrictEqual(sha(dest), original);
    await engine.revertAll();
    assert.strictEqual(sha(dest), original);
  }, !real);

  test('a file replaced by a game update is left alone on revert', async () => {
    const { engine, data } = makeEngine(cooked);
    const dest = path.join(cooked, midF);
    const original = fs.readFileSync(dest);
    await engine.apply({ kind: 'swap', sourceFile: midF, targetFile: longF });
    const updated = Buffer.concat([original, Buffer.from('new game version')]);
    fs.writeFileSync(dest, updated); // simulate the launcher patching the file
    assert.deepStrictEqual(engine.reconcile(), [midF.toLowerCase()]);
    assert.ok(fs.readFileSync(dest).equals(updated));
    assert.ok(!fs.existsSync(path.join(data, 'backups', midF.toLowerCase())));
    fs.writeFileSync(dest, original);
  }, !real);

  test('workshop map takes the Underpass slot and unloads cleanly', async () => {
    const { engine, data } = makeEngine(cooked);
    const maps = new Maps(path.join(data, 'maps'));
    const fake = path.join(tmp, 'My_Test_Map.upk');
    fs.writeFileSync(fake, 'not a real map');
    assert.deepStrictEqual(maps.add([fake, path.join(tmp, 's.json')]), ['My_Test_Map.upk']);
    const slot = path.join(cooked, MAP_SLOT);
    const original = sha(slot);
    await engine.apply(maps.op('My_Test_Map.upk'));
    assert.strictEqual(fs.readFileSync(slot, 'utf8'), 'not a real map');
    await engine.revert(MAP_SLOT.toLowerCase());
    assert.strictEqual(sha(slot), original);
  }, !real);

  test('arena names and part kinds', () => {
    assert.strictEqual(arenas.arenaName('CS_Day_P'), 'Champions Field (Day)');
    assert.strictEqual(arenas.arenaName('Stadium_P'), 'DFH Stadium');
    assert.strictEqual(arenas.arenaName('FNI_Stadium_P'), 'Forbidden Temple (Fire & Ice)');
    assert.strictEqual(arenas.arenaName('Labs_Basin_P'), 'Labs Basin');
    assert.deepStrictEqual(['CS_Field', 'CS_OOB2', 'CHN_Stadium_VFX', 'CS_Lights', 'Park_SFX'].map(arenas.partKind), ['field', 'surroundings', 'effects', 'lights', 'audio']);
  });

  test('every pair of standard arenas gets a merge, the best kind that fits', () => {
    const part = (file) => ({ file, kind: arenas.partKind(file.replace(/\.upk$/, '')) });
    const arena = (id, name, parts, standard = true) => ({
      id, name, file: `${id}.upk`, standard, parts: parts.map(part),
      field: (parts.find((p) => /_Field\.upk$/.test(p)) || null),
    });
    const beach = arena('beach_p', 'Salty Shores', ['Beach_Field.upk', 'Beach_OOB.upk', 'Beach_OOB2.upk']);
    const cs = arena('cs_p', 'Champions Field', ['CS_Field.upk', 'CS_OOB.upk', 'CS_OOB2.upk']);
    const tenth = arena('stadium_10a_p', 'DFH Stadium (10th Anniversary)', ['Stadium_10A_OOB.upk', 'Stadium_10A_SFX.upk']);
    const dusk = arena('ff_dusk_p', 'Estadio Vida', ['FF_Dusk_OOB.upk', 'FF_Dusk_BlueOOB.upk', 'FF_Dusk_SFX.upk']);
    const park = arena('park_p', 'Beckwith Park', ['Park_SFX.upk']);
    const hoops = arena('hoopsstadium_p', 'Dunk House', [], false);
    const all = [beach, cs, tenth, dusk, park, hoops];
    const pairs = (p) => p.ops.map((o) => `${o.gameFile}<-${o.sourceGameFile}`);
    // built merges: [file, from, side, created], and the renames of the main file
    const built = (p) => p.ops.map((o) => [/^BP[0-9a-f]+\.upk$/.test(o.gameFile) ? 'new' : o.gameFile, o.from, o.side, !!o.create]);
    const renamed = (p) => Object.keys(p.ops[p.ops.length - 1].renames);
    // both have a stadium part: the stadium is swapped, play the other arena
    let p = arenas.mergePlan(beach, cs, all);
    assert.deepStrictEqual([p.how, pairs(p), p.play.map((a) => a.id)], ['stadium', ['CS_Field.upk<-Beach_Field.upk'], ['cs_p']]);
    // a single-file stadium: its map loads the other arena's surroundings in place of its own outside
    // parts (and, when more are needed, its sound part); the main file is written last
    p = arenas.mergePlan(dusk, beach, all);
    assert.deepStrictEqual([p.how, p.play.map((a) => a.id)], ['build', ['beach_p']]);
    assert.deepStrictEqual(built(p), [
      ['new', 'Beach_OOB.upk', 'surroundings', true], ['new', 'Beach_OOB2.upk', 'surroundings', true], ['new', 'beach_p.upk', 'surroundings', true],
      ['beach_p.upk', 'ff_dusk_p.upk', 'stadium', false]]);
    assert.deepStrictEqual(renamed(p), ['FF_Dusk_OOB', 'FF_Dusk_BlueOOB', 'FF_Dusk_SFX']);
    assert.match(p.note, /background sounds/);
    // fewer surroundings than slots: a left-over outside part keeps only its stadium side; the sound part stays
    p = arenas.mergePlan(dusk, tenth, all);
    assert.deepStrictEqual(built(p), [
      ['new', 'stadium_10a_p.upk', 'surroundings', true], ['new', 'Stadium_10A_OOB.upk', 'surroundings', true],
      ['stadium_10a_p.upk', 'ff_dusk_p.upk', 'stadium', false]]);
    p = arenas.mergePlan(tenth, park, all);
    assert.deepStrictEqual(built(p), [['new', 'park_p.upk', 'surroundings', true], ['park_p.upk', 'stadium_10a_p.upk', 'stadium', false]]);
    assert.ok(p.ops.every((o) => !o.create || o.gameFile.length - 4 <= 'Stadium_10A_OOB'.length), 'new names fit in the slot they replace');
    // an arena with its own stadium file keeps its outside parts (part of its stands are there), so only
    // a sound or effects part can be a slot; with none, the whole arena is played instead
    p = arenas.mergePlan(cs, tenth, all);
    assert.deepStrictEqual([p.how, pairs(p)], ['whole', ['stadium_10a_p.upk<-cs_p.upk']]);
    p = arenas.mergePlan(park, beach, all);
    assert.deepStrictEqual([p.how, renamed(p)], ['build', ['Park_SFX']]);
    // every file of one merge shares a group, so it is undone as one
    assert.ok(arenas.mergePlan(dusk, beach, all).ops.every((o) => o.group === 'merge:ff_dusk_p:beach_p' && o.label === 'Estadio Vida stadium in Salty Shores'));
    // a different pitch cannot be swapped whole
    assert.strictEqual(arenas.mergePlan(park, hoops, all).how, 'none');
    assert.strictEqual(arenas.mergePlan(park, park, all).how, 'none');
  });

  test('arenas are scanned from the install with their parts', () => {
    const cache = {};
    const list = arenas.scanArenas(real, cache);
    const cs = list.find((a) => a.id === 'cs_p'), beach = list.find((a) => a.id === 'beach_p'), park = list.find((a) => a.id === 'park_p');
    assert.ok(list.length > 50 && cs && beach && park);
    assert.strictEqual(cs.field.toLowerCase(), 'cs_field.upk');
    assert.strictEqual(park.field, null, 'Beckwith Park is a single file');
    assert.strictEqual(arenas.snowPlan(park, list).how, 'version');
    // scanned without the game's text, so "standard" is not known here
    const plan = arenas.mergePlan({ ...beach, standard: true }, { ...cs, standard: true }, list);
    assert.strictEqual(plan.how, 'stadium');
    assert.deepStrictEqual(plan.ops.map((o) => [o.gameFile, o.sourceGameFile]), [[cs.field, beach.field]]);
    const again = arenas.scanArenas(real, cache); // second pass comes from the cache
    assert.strictEqual(again.length, list.length);
    console.log(`        ${list.length} arenas, ${list.filter((a) => a.field).length} with a stadium part, ${list.filter((a) => arenas.snowPlan(a, list)).length} with a snow option`);
  }, !real);

  test('a swap is written with the key of the file it replaces', async () => {
    const keysFile = path.join(process.env.APPDATA || '', 'boostpad', 'keys.txt');
    if (!fs.existsSync(keysFile)) return; // needs a key list to find two items with different keys
    const keys = upk.parseKeys(fs.readFileSync(keysFile, 'utf8'));
    const keyOf = (f) => upk.keyOfFile(path.join(real, f), keys).toString('hex');
    // Lunation is encrypted with a key from the list, Cosmological with the built-in one
    const lunation = 'skin_IndigoD_SF.upk', cosmo = 'skin_bloodbros_SF.upk';
    if (!fs.existsSync(path.join(real, lunation)) || !fs.existsSync(path.join(real, cosmo))) return;
    const dir = fs.mkdtempSync(path.join(tmp, 'keys-'));
    const backup = path.join(process.env.APPDATA, 'boostpad', 'backups', lunation.toLowerCase());
    fs.copyFileSync(fs.existsSync(backup) ? backup : path.join(real, lunation), path.join(dir, lunation)); // the original, even if swapped in the game
    fs.copyFileSync(path.join(real, cosmo), path.join(dir, cosmo));
    const wanted = upk.keyOfFile(path.join(dir, lunation), keys).toString('hex');
    assert.notStrictEqual(wanted, keyOf(cosmo), 'test needs two items with different keys');
    const { engine } = makeEngine(dir);
    engine.getKeys = () => keys;
    await engine.apply({ kind: 'swap', sourceFile: lunation, targetFile: cosmo });
    const written = upk.readPackageFile(path.join(dir, lunation), keys);
    assert.strictEqual(written.key.toString('hex'), wanted, 'written with the donor key: the game cannot read it');
    assert.ok(written.names.some((n) => n.text === 'skin_IndigoD'));
  }, !real);

  test('arena names come from the game text; every-match covers standard arenas only', () => {
    const keysFile = path.join(process.env.APPDATA || '', 'boostpad', 'keys.txt');
    const keys = fs.existsSync(keysFile) ? upk.parseKeys(fs.readFileSync(keysFile, 'utf8')) : [];
    const { maps } = readTexts(real, keys);
    if (!maps.size) return; // the game text needs a key list
    const list = arenas.scanArenas(real, {}, keys, maps);
    const byId = (id) => list.find((a) => a.id === id);
    assert.strictEqual(byId('cs_day_p').name, 'Champions Field (Day)');
    assert.strictEqual(byId('underwater_p').name, 'AquaDome');
    assert.ok(byId('stadium_p').standard && !byId('labs_basin_p').standard && !byId('hoopsstadium_p').standard);
    const ops = arenas.everyMatchOps(byId('stadium_p'), list);
    assert.ok(ops.length > 30 && ops.every((o) => o.kind === 'copy' && o.sourceGameFile === byId('stadium_p').file && o.group === 'everymatch'));
    assert.ok(!ops.some((o) => /labs_|hoops|shattershot/i.test(o.gameFile)));
    assert.deepStrictEqual(arenas.arenasUsing(list, 'Underwater_Field.upk').map((a) => a.name), ['AquaDome']);
    // snow: only arenas with a snowy version in the game, and not the snowy version itself
    assert.deepStrictEqual(['stadium_p', 'park_night_p', 'underwater_p', 'cs_p', 'stadium_winter_p'].map((id) => (arenas.snowPlan(byId(id), list) || {}).snowy),
      ['DFH Stadium (Snowy)', 'Beckwith Park (Snowy)', undefined, undefined, undefined]);
  }, !real);

  test('merged arenas can be used in every match and get snow, and the merge stays', () => {
    const part = (file) => ({ file, kind: arenas.partKind(file.replace(/\.upk$/, '')) });
    const arena = (id, name, parts) => ({ id, name, file: `${id}.upk`, standard: true, playable: true, parts: parts.map(part), field: parts.find((p) => /_Field/.test(p)) || null });
    const aqua = arena('underwater_p', 'AquaDome', ['Underwater_Field.upk', 'Underwater_FX.upk']);
    const neon = arena('music_p', 'Neon Fields', ['Music_Field.upk', 'Music_Effects.upk']);
    const mann = arena('eurostadium_p', 'Mannfield', []);
    const dfh = arena('stadium_p', 'DFH Stadium', ['Stadium_OOB_Audio_Map.upk']);
    const winter = arena('stadium_winter_p', 'DFH Stadium (Snowy)', ['Stadium_OOB_Audio_Map.upk']);
    const fni = { ...arena('fni_stadium_p', 'Forbidden Temple (Fire & Ice)', ['FNI_Stadium_VFX.upk']), file: 'FNI_Stadium_P.upk' };
    const all = [aqua, neon, mann, dfh, winter, fni];
    const changes = new Map();
    // Mannfield has no part files, so as the stadium arena it can only be played whole
    assert.strictEqual(arenas.mergePlan(mann, dfh, all).how, 'whole');
    for (const op of [...arenas.mergePlan(neon, aqua, all).ops, ...arenas.mergePlan(mann, dfh, all).ops, ...arenas.mergePlan(dfh, winter, all).ops]) changes.set(op.gameFile.toLowerCase(), op);
    // the merged arenas are listed under their merge (the added files are not arenas)
    assert.deepStrictEqual(arenas.mergedArenas(all, changes).map((m) => [m.arena.id, m.label]).sort(),
      [['stadium_p', 'Mannfield stadium in DFH Stadium'], ['stadium_winter_p', 'DFH Stadium stadium in DFH Stadium (Snowy)'], ['underwater_p', 'Neon Fields stadium in AquaDome']]);
    // every match with a built merge builds it again in every arena's place, with the same added files
    const b = changes.get('stadium_winter_p.upk');
    let ops = arenas.everyMatchOps(winter, all, changes, 'x');
    assert.ok(ops.length && ops.every((o) => o.kind === 'build' && o.from === 'stadium_p.upk' && o.renames === b.renames && o.side === 'stadium'));
    // every match with the stadium merge: AquaDome's main file loads the merged stadium; the merged-over Mannfield is left alone
    // every match with the stadium merge: AquaDome's main file loads the merged stadium; arenas merged over are left alone
    ops = arenas.everyMatchOps(aqua, all, changes, 'Neon Fields stadium in AquaDome');
    assert.deepStrictEqual(ops.map((o) => `${o.gameFile}<-${o.sourceGameFile}`), ['music_p.upk<-underwater_p.upk', 'eurostadium_p.upk<-underwater_p.upk', 'FNI_Stadium_P.upk<-underwater_p.upk']);
    assert.ok(ops.every((o) => o.chosen === 'underwater_p' && o.label.startsWith('Neon Fields stadium in AquaDome in place of')));
    // every match with the whole-arena merge copies what DFH Stadium really loads now: Mannfield
    ops = arenas.everyMatchOps(dfh, all, changes);
    assert.ok(ops.every((o) => o.sourceGameFile === 'eurostadium_p.upk') && !ops.some((o) => o.gameFile === 'eurostadium_p.upk'));
    // stadium and built merges get no snow: the snowy version would replace what makes the merge
    assert.strictEqual(arenas.snowPlan(aqua, all, changes), null);
    assert.strictEqual(arenas.snowPlan(winter, all, changes), null);
    assert.strictEqual(arenas.snowPlan(dfh, all).op.sourceGameFile, 'stadium_winter_p.upk');
    // snow on a whole merge: DFH Stadium (now Mannfield) becomes the snowy Mannfield, still as part of that merge
    const snowyMann = arena('eurostadium_snownight_p', 'Mannfield (Snowy)', []);
    const s = arenas.snowPlan(dfh, [...all, { ...snowyMann, file: 'EuroStadium_SnowNight_P.upk' }], changes);
    assert.deepStrictEqual([s.how, s.op.gameFile, s.op.sourceGameFile, s.op.group, s.op.label], ['version', 'stadium_p.upk', 'EuroStadium_SnowNight_P.upk', 'merge:eurostadium_p:stadium_p', 'Mannfield stadium in DFH Stadium, snowy']);
  });

  test('Steam shortcut file: read and written back exactly, our entry added and removed cleanly', () => {
    const steam = require('../src/main/core/steam');
    const { T } = steam;
    const int = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
    // someone's existing shortcut, with a 64-bit field Boostpad does not know about
    const root = [{ type: T.MAP, key: 'shortcuts', value: [{ type: T.MAP, key: '0', value: [
      { type: T.INT, key: 'appid', value: int(2999999999) }, { type: T.STR, key: 'AppName', value: 'Epic Games Launcher' },
      { type: T.STR, key: 'Exe', value: '"C:\\Epic\\EpicGamesLauncher.exe"' }, { type: T.U64, key: 'Something', value: Buffer.alloc(8, 7) },
      { type: T.MAP, key: 'tags', value: [{ type: T.STR, key: '0', value: 'Games' }] }] }] }];
    const file = steam.writeVdf(root);
    assert.ok(steam.writeVdf(steam.parseVdf(file)).equals(file), 'round trip');
    const added = steam.withShortcut(steam.parseVdf(file), { launcherExe: 'C:\\Epic\\EpicGamesLauncher.exe', rlExe: 'C:\\RL\\RocketLeague.exe' });
    const back = steam.parseVdf(added.bytes);
    const ours = steam.findOurs(back);
    const field = (k) => ours.value.find((f) => f.key === k);
    assert.strictEqual(ours.key, '1');
    assert.strictEqual(field('LaunchOptions').value, steam.RL_LINK);
    assert.strictEqual(field('appid').value.readUInt32LE(0), added.appid);
    assert.ok(added.appid >= 0x80000000 && added.appid === steam.shortcutAppId('"C:\\Epic\\EpicGamesLauncher.exe"', steam.NAME));
    assert.strictEqual(steam.gameId(added.appid), ((BigInt(added.appid) << 32n) | 0x02000000n).toString());
    // adding twice keeps one entry; removing gives back the file as it was
    const twice = steam.parseVdf(steam.withShortcut(back, { launcherExe: 'C:\\Epic\\EpicGamesLauncher.exe' }).bytes);
    assert.strictEqual(twice[0].value.length, 2);
    assert.ok(steam.withoutShortcut(twice).equals(file));
  });

  test('checkpoint buttons and options are written into BakkesMod\'s files', () => {
    const bakkes = require('../src/main/core/bakkes');
    const cfg = 'rcon_port "9002" //\r\ncpt_freeze_key "XboxTypeS_RightThumbStick" //Key to bind\r\ncpt_history_length "30" //Save history';
    const out = bakkes.writeCvars(cfg, { cpt_freeze_key: 'XboxTypeS_LeftThumbStick', cpt_reset_on_goal: '1' });
    assert.deepStrictEqual(bakkes.readCvars(out), { rcon_port: '9002', cpt_freeze_key: 'XboxTypeS_LeftThumbStick', cpt_history_length: '30', cpt_reset_on_goal: '1' });
    assert.match(out, /cpt_freeze_key "XboxTypeS_LeftThumbStick" \/\/Key to bind/); // descriptions stay
    const binds = '//Warning: rewritten\nbind F2 "togglemenu settings"\nbind XboxTypeS_DPad_Up "default_up;cpt_freeze_ball"\nbind XboxTypeS_RightThumbStick "cpt_freeze"\n';
    // freeze moves to L3, freeze-ball is switched off: R3 loses its bind, D-pad up keeps BakkesMod's own command
    const b = bakkes.readBinds(bakkes.writeBinds(binds, { freeze: 'XboxTypeS_LeftThumbStick', freezeBall: '' }));
    assert.deepStrictEqual(b, { F2: ['togglemenu settings'], XboxTypeS_DPad_Up: ['default_up'], XboxTypeS_LeftThumbStick: ['cpt_freeze'] });
  });

  test('a map is taken apart and put back together without changing anything else', () => {
    const keysFile = path.join(process.env.APPDATA || '', 'boostpad', 'keys.txt');
    const file = path.join(real || '', 'Farm_GRS_P.upk');
    if (!fs.existsSync(keysFile) || !fs.existsSync(file)) return;
    const keys = upk.parseKeys(fs.readFileSync(keysFile, 'utf8'));
    const backup = path.join(process.env.APPDATA, 'boostpad', 'backups', 'farm_grs_p.upk');
    const buf = fs.readFileSync(fs.existsSync(backup) ? backup : file);
    // unchanged: every object comes back byte for byte
    const P = mapbuild.open(buf, keys);
    const again = mapbuild.repack(P, P.t.pkg.key);
    const t = upk.readTables(again, keys);
    assert.ok(t.exports.every((e, i) => upk.readObject(again, t, e).equals(P.obj(P.t.exports[i]))));
    // one side kept: some meshes hidden, gameplay gone from the surroundings, a part renamed, still readable
    const S = mapbuild.open(buf, keys);
    const stats = mapbuild.keepSide(S, 'surroundings');
    assert.ok(stats.hidden > 20 && stats.kept > 20 && stats.actorsRemoved > 50, JSON.stringify(stats));
    const built = mapbuild.repack(S, Buffer.from(upk.DEFAULT_KEYS[0], 'hex'), { Farm_SFX: 'BPabcd12' });
    const t2 = upk.readTables(built, keys);
    assert.ok(t2.names.includes('BPabcd12') && !t2.names.some((n) => /^farm_sfx$/i.test(n)));
    assert.strictEqual(t2.exports.length, P.t.exports.length);
  }, !real);

  test('a copied arena file is written with the replaced file\'s key', async () => {
    const keysFile = path.join(process.env.APPDATA || '', 'boostpad', 'keys.txt');
    if (!fs.existsSync(keysFile)) return;
    const keys = upk.parseKeys(fs.readFileSync(keysFile, 'utf8'));
    // two small arena parts that use different keys
    const parts = ['Music_Field.upk', 'Underwater_Field.upk', 'CS_Field.upk', 'Beach_Field.upk'].filter((f) => fs.existsSync(path.join(real, f)));
    const keyOf = (dir, f) => upk.keyOfFile(path.join(dir, f), keys).toString('hex');
    const backups = path.join(process.env.APPDATA, 'boostpad', 'backups');
    const original = (f) => (fs.existsSync(path.join(backups, f.toLowerCase())) ? path.join(backups, f.toLowerCase()) : path.join(real, f));
    const dir = fs.mkdtempSync(path.join(tmp, 'arena-'));
    for (const f of parts) fs.copyFileSync(original(f), path.join(dir, f));
    const pair = parts.flatMap((a) => parts.map((b) => [a, b])).find(([a, b]) => a !== b && keyOf(dir, a) !== keyOf(dir, b));
    if (!pair) return;
    const [dest, src] = pair, want = keyOf(dir, dest);
    const { engine } = makeEngine(dir);
    engine.getKeys = () => keys;
    await engine.apply({ kind: 'copy', gameFile: dest, sourceGameFile: src });
    assert.strictEqual(keyOf(dir, dest), want);
    assert.deepStrictEqual(upk.readPackageFile(path.join(dir, dest), keys).names.map((n) => n.text), upk.readPackageFile(path.join(dir, src), keys).names.map((n) => n.text));
  }, !real);

  test('copy: one game file becomes a copy of another, and reverts', async () => {
    const { engine } = makeEngine(cooked);
    const dest = path.join(cooked, midF), original = sha(dest);
    await engine.apply({ kind: 'copy', gameFile: midF, sourceGameFile: longF });
    assert.strictEqual(sha(dest), sha(path.join(cooked, longF)));
    assert.strictEqual(engine.checkSwap({ kind: 'copy', gameFile: midF, sourceGameFile: '..\\x.upk' }).ok, false);
    await engine.revert(midF.toLowerCase());
    assert.strictEqual(sha(dest), original);
  }, !real);

  test('probe agrees with a full read, and compatible looks are marked', () => {
    const cat = buildCatalog(real);
    const wheels = cat.items.filter((i) => i.category === 'wheels');
    const sample = wheels.filter((_, n) => n % 25 === 0);
    annotate(real, sample);
    for (const item of sample) {
      let full = true;
      try { upk.readPackageFile(path.join(real, item.file)); } catch { full = false; }
      assert.strictEqual(item.ok, full, `${item.file}: probe says ${item.ok}, full read says ${full}`);
    }
    const a = { id: 'a', len: 10, ok: true }, longer = { id: 'b', len: 12, ok: true }, locked = { id: 'c', len: 12, ok: false };
    assert.ok(canSwap(a, longer) && !canSwap(longer, a) && !canSwap(a, locked) && !canSwap(a, a));
    // the rule must match what the engine can actually build
    const { engine } = makeEngine(real);
    const readable = sample.filter((i) => i.ok);
    for (const target of readable.slice(0, 12)) {
      const built = engine.checkSwap({ kind: 'swap', sourceFile: readable[0].file, targetFile: target.file }).ok;
      assert.strictEqual(built, canSwap(readable[0], target), `${readable[0].file} -> ${target.file}`);
    }
  }, !real);

  test('item pictures decode from the game thumbnails', () => {
    const cat = buildCatalog(real);
    annotate(real, cat.items.filter((i) => i.category === 'boosts'));
    const boosts = cat.items.filter((i) => i.category === 'boosts' && i.ok && i.thumb).slice(0, 25);
    let decoded = 0;
    for (const item of boosts) {
      let pic;
      try { pic = readThumbnail(real, item.thumb); } catch { continue; } // thumbnail package may use another key
      assert.ok(pic.width >= 64 && pic.height >= 64 && pic.bgra.length === pic.width * pic.height * 4);
      assert.ok(new Set(pic.bgra.subarray(0, 4096 * 4)).size > 4 || new Set(pic.bgra).size > 4, `${item.thumb} is a flat colour`);
      decoded++;
    }
    assert.ok(decoded >= boosts.length * 0.8, `only ${decoded} of ${boosts.length} decoded`);
  }, !real);

  test('DXT1 block decodes to the right colours', () => {
    // one 4x4 block: colour0 = pure red, colour1 = pure blue, every pixel uses colour0
    const block = Buffer.from([0x00, 0xf8, 0x1f, 0x00, 0, 0, 0, 0]);
    const px = decodeDxt(block, 4, 4, false);
    assert.deepStrictEqual([...px.subarray(0, 4)], [0, 0, 255, 255]); // BGRA
  });

  test('key lists: hex and base64 lines are read, junk and the built-in key are dropped', () => {
    const hex = 'ab'.repeat(32), b64 = Buffer.alloc(32, 7).toString('base64');
    const keys = upk.parseKeys(`# comment\n${hex}\n${hex.toUpperCase()}\n${b64}\nnot a key\n${upk.DEFAULT_KEYS[0]}\n`);
    assert.deepStrictEqual(keys, [hex, Buffer.alloc(32, 7).toString('hex')]);
  });

  test('wrong extra keys do not stop a readable package from opening', () => {
    const wrong = ['11'.repeat(32), '22'.repeat(32)];
    const pkg = upk.readPackageFile(path.join(cooked, shortF), wrong);
    assert.ok(pkg.names.length > 0);
    assert.strictEqual(upk.probeFile(path.join(cooked, shortF), wrong), true);
  }, !real);

  test('item names: labels are applied, decals get their car, missing ones keep the internal name', () => {
    const items = [
      { file: 'skin_IndigoD_SF.upk', name: 'Indigo D', category: 'decals' },
      { file: 'skin_grain_stripes_SF.upk', name: 'Grain Stripes', category: 'decals' },
      { file: 'body_grain_SF.upk', name: 'Grain', category: 'cars' },
      { file: 'boost_unknown_SF.upk', name: 'Unknown', category: 'boosts' },
    ];
    const named = applyLabels(items, new Map([['skin_indigod', 'Lunation'], ['skin_grain_stripes', 'Stripes'], ['body_grain', 'Fennec']]));
    assert.strictEqual(named, 3);
    assert.deepStrictEqual(items.map((i) => [i.label, i.sub]), [['Lunation', ''], ['Stripes', 'Fennec'], ['Fennec', ''], ['Unknown', '']]);
    assert.strictEqual(readLabels(path.join(tmp, 'nowhere')).size, 0, 'a missing text file gives no labels, not an error');
  });

  await runAll();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${skipped} skipped${process.exitCode ? ', FAILURES above' : ''}`);
})();
