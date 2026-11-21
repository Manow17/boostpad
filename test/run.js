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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openw-test-'));
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
    // Newer packages use keys OpenW does not have; test with ones it can read.
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
    // built merges: [file, from, side, created, gameplay], and the renames of the main file
    const built = (p) => p.ops.map((o) => [/^BP[0-9a-f]+\.upk$/.test(o.gameFile) ? 'new' : o.gameFile, o.from, o.side, !!o.create, !!o.gameplay]);
    const renamed = (p) => Object.keys(p.ops[p.ops.length - 1].renames);
    // the place arena stays its own map (sky, light, fog, gameplay) with only its stadium out; its stadium
    // file loads the other arena's stadium; its outside parts load without their stadium pieces
    let p = arenas.mergePlan(beach, cs, all);
    assert.deepStrictEqual([p.how, p.play.map((a) => a.id)], ['build', ['cs_p']]);
    assert.deepStrictEqual(built(p), [
      ['new', 'Beach_Field.upk', 'stadium', true, false], ['new', 'CS_OOB.upk', 'surroundings', true, false], ['new', 'CS_OOB2.upk', 'surroundings', true, false],
      ['cs_p.upk', 'cs_p.upk', 'surroundings', false, true]]);
    assert.deepStrictEqual(renamed(p), ['CS_Field', 'CS_OOB', 'CS_OOB2']);
    assert.ok(p.ops.filter((o) => o.side === 'stadium').every((o) => o.lights === false && o.gameplay === false), 'the stadium brings no lights or gameplay');
    assert.ok(p.ops[p.ops.length - 1].lights === true, 'the place keeps its lights');
    assert.match(p.note, /did not fit/); // only one slot: Salty Shores' main map stays out
    // a one-file stadium arena: its main map, stadium side, in the place's stadium file
    p = arenas.mergePlan(dusk, beach, all);
    assert.deepStrictEqual(built(p), [
      ['new', 'ff_dusk_p.upk', 'stadium', true, false], ['new', 'Beach_OOB.upk', 'surroundings', true, false], ['new', 'Beach_OOB2.upk', 'surroundings', true, false],
      ['beach_p.upk', 'beach_p.upk', 'surroundings', false, true]]);
    // a place with only a sound part: the stadium loads there, and its background sounds go quiet
    p = arenas.mergePlan(tenth, park, all);
    assert.deepStrictEqual(built(p), [['new', 'stadium_10a_p.upk', 'stadium', true, false], ['park_p.upk', 'park_p.upk', 'surroundings', false, true]]);
    assert.deepStrictEqual(renamed(p), ['Park_SFX']);
    assert.match(p.note, /background sounds/);
    assert.ok(p.ops.every((o) => !o.create || o.gameFile.length - 4 <= 'Park_SFX'.length), 'new names fit in the slot they replace');
    // a place with no part files at all: the stadium arena's map is the base, the place's main map first in its parts
    const mann = arena('eurostadium_p', 'Mannfield', []);
    p = arenas.mergePlan(tenth, mann, [...all, mann]);
    assert.deepStrictEqual(built(p), [['new', 'eurostadium_p.upk', 'surroundings', true, false], ['eurostadium_p.upk', 'stadium_10a_p.upk', 'stadium', false, true]]);
    assert.match(p.note, /light and fog/);
    assert.strictEqual(arenas.mergePlan(mann, arena('eurostadium_dusk_p', 'Mannfield (Dusk)', []), all).how, 'none');
    // with what was read from the maps: each side gets the right stadium region to keep or to clear
    const R = [{ x0: -6000, x1: 6000, y0: -8000, y1: 8000 }], R2 = [{ x0: -5000, x1: 5000, y0: -7000, y1: 7000 }];
    p = arenas.mergePlan(beach, cs, all, { stadiumRegion: R, placeRegion: R2, stadiumHolders: new Set(['beach_p.upk']), placeHolders: new Set() });
    assert.ok(p.ops.every((o) => (o.side === 'stadium' ? o.region === R : o.region === R2 && o.clear === R)));
    assert.ok(p.ops.some((o) => o.from === 'CS_OOB.upk'), 'an outside part is filtered even without stadium pieces, to clear the new stadium');
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
    assert.strictEqual(plan.how, 'build');
    const main = plan.ops[plan.ops.length - 1];
    // Champions Field stays its own map; its stadium file loads Salty Shores' stadium
    assert.deepStrictEqual([main.gameFile, main.from, main.side, main.gameplay], [cs.file, cs.file, 'surroundings', true]);
    assert.ok(plan.ops.some((o) => o.from === beach.field && o.side === 'stadium' && main.renames[cs.field.replace(/\.upk$/i, '')] === o.gameFile.replace(/\.upk$/i, '')));
    const again = arenas.scanArenas(real, cache); // second pass comes from the cache
    assert.strictEqual(again.length, list.length);
    console.log(`        ${list.length} arenas, ${list.filter((a) => a.field).length} with a stadium part, ${list.filter((a) => arenas.snowPlan(a, list)).length} with a snow option`);
  }, !real);

  test('a swap is written with the key of the file it replaces', async () => {
    const keysFile = path.join(process.env.APPDATA || '', 'OpenW', 'keys.txt');
    if (!fs.existsSync(keysFile)) return; // needs a key list to find two items with different keys
    const keys = upk.parseKeys(fs.readFileSync(keysFile, 'utf8'));
    const keyOf = (f) => upk.keyOfFile(path.join(real, f), keys).toString('hex');
    // Lunation is encrypted with a key from the list, Cosmological with the built-in one
    const lunation = 'skin_IndigoD_SF.upk', cosmo = 'skin_bloodbros_SF.upk';
    if (!fs.existsSync(path.join(real, lunation)) || !fs.existsSync(path.join(real, cosmo))) return;
    const dir = fs.mkdtempSync(path.join(tmp, 'keys-'));
    const backup = path.join(process.env.APPDATA, 'OpenW', 'backups', lunation.toLowerCase());
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
    const keysFile = path.join(process.env.APPDATA || '', 'OpenW', 'keys.txt');
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
    for (const op of [...arenas.mergePlan(neon, aqua, all).ops, ...arenas.mergePlan(mann, dfh, all).ops, ...arenas.mergePlan(dfh, winter, all).ops]) changes.set(op.gameFile.toLowerCase(), op);
    // the merged arenas are listed under their merge (the added files are not arenas)
    assert.deepStrictEqual(arenas.mergedArenas(all, changes).map((m) => [m.arena.id, m.label]).sort(),
      [['stadium_p', 'Mannfield stadium in DFH Stadium'], ['stadium_winter_p', 'DFH Stadium stadium in DFH Stadium (Snowy)'], ['underwater_p', 'Neon Fields stadium in AquaDome']]);
    // every match with a built merge builds it again in every arena's place, with the same added files
    const b = changes.get('stadium_winter_p.upk');
    let ops = arenas.everyMatchOps(winter, all, changes, 'x');
    // (the merged map is the place's own, with its stadium out and its parts pointed at the added files)
    assert.ok(ops.length && ops.every((o) => o.kind === 'build' && o.from === 'stadium_winter_p.upk' && o.renames === b.renames && o.side === 'surroundings' && o.gameplay === true && o.lights === true));
    ops = arenas.everyMatchOps(aqua, all, changes, 'Neon Fields stadium in AquaDome');
    assert.deepStrictEqual(ops.map((o) => `${o.gameFile}<-${o.from}`), ['music_p.upk<-underwater_p.upk', 'eurostadium_p.upk<-underwater_p.upk', 'FNI_Stadium_P.upk<-underwater_p.upk']);
    assert.ok(ops.every((o) => o.chosen === 'underwater_p' && o.label.startsWith('Neon Fields stadium in AquaDome in place of')));
    ops = arenas.everyMatchOps(dfh, all, changes);
    assert.ok(ops.length && ops.every((o) => o.from === 'stadium_p.upk' && o.side === 'surroundings' && o.gameplay === true));
    // merged arenas get no snow: the snowy version would replace what makes the merge
    for (const a of [aqua, winter, dfh]) assert.strictEqual(arenas.snowPlan(a, all, changes), null);
    assert.strictEqual(arenas.snowPlan(dfh, all).op.sourceGameFile, 'stadium_winter_p.upk');
  });

  test('ground under the new pitch is lowered, even when it has no position of its own', () => {
    const keysFile = path.join(process.env.APPDATA || '', 'OpenW', 'keys.txt');
    const file = path.join(real || '', 'Outlaw_Oasis_OOB.upk');
    if (!fs.existsSync(keysFile) || !fs.existsSync(file)) return;
    const keys = upk.parseKeys(fs.readFileSync(keysFile, 'utf8'));
    const backup = path.join(process.env.APPDATA, 'OpenW', 'backups', 'outlaw_oasis_oob.upk');
    const buf = fs.readFileSync(fs.existsSync(backup) ? backup : file);
    const P = mapbuild.open(buf, keys);
    const before = mapbuild.inventory(P).find((i) => i.name === 'OL_Terrain_Ground_Main');
    const pitch = [{ x0: -4700, x1: 4700, y0: -6400, y1: 6400 }];
    const stats = mapbuild.keepSide(P, 'surroundings', { region: pitch, clear: pitch, part: true, lights: true });
    assert.strictEqual(stats.lowered, 1);
    const again = mapbuild.open(mapbuild.repack(P, Buffer.from(upk.DEFAULT_KEYS[0], 'hex')), keys);
    const after = mapbuild.inventory(again).find((i) => i.name === 'OL_Terrain_Ground_Main');
    assert.strictEqual(Math.round(after.box.c.z), Math.round(before.box.c.z) - 25);
    assert.strictEqual(again.t.exports.length, P.t.exports.length);
  }, !real);

  test('a map is taken apart and put back together without changing anything else', () => {
    const keysFile = path.join(process.env.APPDATA || '', 'OpenW', 'keys.txt');
    const file = path.join(real || '', 'Farm_GRS_P.upk');
    if (!fs.existsSync(keysFile) || !fs.existsSync(file)) return;
    const keys = upk.parseKeys(fs.readFileSync(keysFile, 'utf8'));
    const backup = path.join(process.env.APPDATA, 'OpenW', 'backups', 'farm_grs_p.upk');
    const buf = fs.readFileSync(fs.existsSync(backup) ? backup : file);
    // unchanged: every object comes back byte for byte
    const P = mapbuild.open(buf, keys);
    const again = mapbuild.repack(P, P.t.pkg.key);
    const t = upk.readTables(again, keys);
    assert.ok(t.exports.every((e, i) => upk.readObject(again, t, e).equals(P.obj(P.t.exports[i]))));
    // one side kept: some meshes hidden, gameplay gone from the surroundings, a part renamed, still readable
    const S = mapbuild.open(buf, keys);
    const log = [];
    const stats = mapbuild.keepSide(S, 'surroundings', { region: mapbuild.arenaRegion([mapbuild.open(buf, keys)]) }, log);
    assert.ok(stats.hidden > 20 && stats.kept > 20, JSON.stringify(stats));
    // no gameplay and no lights come along with the outside; sky and fog do
    assert.ok(log.filter((l) => /^(VehiclePickup|Goal|PlayerStart|StaticLightCollectionActor)/.test(l.what)).every((l) => !l.kept));
    assert.ok(log.some((l) => /SkySphere/.test(l.name) && l.kept));
    // and its stadium is gone: nothing kept sits on the pitch
    assert.ok(log.filter((l) => l.kept && l.what === 'mesh' && l.x !== null && !/sky|fog|sun/i.test(l.name)).every((l) => Math.abs(l.x) > 4096 || Math.abs(l.y) > 5120));
    const built = mapbuild.repack(S, Buffer.from(upk.DEFAULT_KEYS[0], 'hex'), { Farm_SFX: 'BPabcd12' });
    const t2 = upk.readTables(built, keys);
    assert.ok(t2.names.includes('BPabcd12') && !t2.names.some((n) => /^farm_sfx$/i.test(n)));
    assert.strictEqual(t2.exports.length, P.t.exports.length);
  }, !real);

  test('a copied arena file is written with the replaced file\'s key', async () => {
    const keysFile = path.join(process.env.APPDATA || '', 'OpenW', 'keys.txt');
    if (!fs.existsSync(keysFile)) return;
    const keys = upk.parseKeys(fs.readFileSync(keysFile, 'utf8'));
    // two small arena parts that use different keys
    const parts = ['Music_Field.upk', 'Underwater_Field.upk', 'CS_Field.upk', 'Beach_Field.upk'].filter((f) => fs.existsSync(path.join(real, f)));
    const keyOf = (dir, f) => upk.keyOfFile(path.join(dir, f), keys).toString('hex');
    const backups = path.join(process.env.APPDATA, 'OpenW', 'backups');
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

  /* ---------- OpenW Input ---------- */
  const TX = require('../src/shared/transform');
  const inputLib = require('../src/main/input');

  test('input: stick settings do what they say (dead zones, square diagonals, cross axes, anti-deadzone, curve)', () => {
    const cfg = (patch) => TX.stickCfg({ ...TX.blank('t').sticks.left, ...patch });
    const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);
    // inside the inner dead zone nothing comes out; the edge minus the outer dead zone is full
    assert.deepStrictEqual(TX.stick(0.05, 0.05, cfg({ inner: 10 })), [0, 0]);
    near(TX.stick(0.95, 0, cfg({ inner: 10, outer: 5 }))[0], 1);
    near(TX.stick(0.525, 0, cfg({ inner: 10, outer: 5 }))[0], 0.5);
    // circle keeps a diagonal round; square takes it to the corner
    const d = Math.SQRT1_2;
    near(TX.stick(d, d, cfg({ inner: 0, outer: 0 }))[0], d);
    near(TX.stick(d, d, cfg({ shape: 'square', inner: 0, outer: 0 }))[0], 1);
    near(TX.stick(d, d, cfg({ shape: 'square', inner: 0, outer: 0 }))[1], 1);
    // cross: a small sideways wobble on a straight push is cut, the push itself is not
    const [cx, cy] = TX.stick(0.08, 0.9, cfg({ shape: 'cross', inner: 10, outer: 0 }));
    assert.strictEqual(cx, 0); assert.ok(cy > 0.85);
    // anti-deadzone: the first movement past the dead zone already gives that much
    assert.ok(TX.stick(0.11, 0, cfg({ inner: 10, outer: 0, anti: 20 }))[0] >= 0.2);
    // ... unless the buffer eases into it
    assert.ok(TX.stick(0.11, 0, cfg({ inner: 10, outer: 0, anti: 20, buffer: 20 }))[0] < 0.05);
    // relaxed curve is finer near the centre, aggressive quicker
    assert.ok(TX.stick(0.5, 0, cfg({ inner: 0, outer: 0, curve: 'relaxed' }))[0] < 0.5);
    assert.ok(TX.stick(0.5, 0, cfg({ inner: 0, outer: 0, curve: 'aggressive' }))[0] > 0.5);
    // invert and single axis
    assert.deepStrictEqual(TX.stick(0.5, 0.5, cfg({ inner: 0, outer: 0, invertY: true, axes: 'x' })).map((v) => +v.toFixed(4)), [0.5, 0]);
    // triggers: range and hair-free curve
    const t = TX.trigCfg({ ...TX.blank('t').triggers.left, start: 10, end: 90 });
    assert.strictEqual(TX.trigger(0.05, t), 0); near(TX.trigger(0.5, t), 0.5); near(TX.trigger(0.95, t), 1);
  });

  test('input: the helper computes exactly what the page shows', () => {
    const { execFileSync } = require('child_process');
    // random settings of every kind, each checked on random sticks and triggers
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const lines = [], expect = [];
    for (let k = 0; k < 60; k++) {
      const p = TX.blank('t');
      Object.assign(p.sticks.left, { shape: pick(['circle', 'cross', 'square']), inner: Math.round(rnd() * 40), outer: Math.round(rnd() * 20), curve: pick(['linear', 'aggressive', 'relaxed', 'wide', 'extrawide', 'custom']),
        exponent: 0.3 + rnd() * 3, anti: Math.round(rnd() * 40), buffer: Math.round(rnd() * 30), scaleX: 50 + Math.round(rnd() * 150), scaleY: 50 + Math.round(rnd() * 150), invertX: rnd() < 0.3, invertY: rnd() < 0.3, axes: pick(['both', 'x', 'y']) });
      Object.assign(p.triggers.left, { start: Math.round(rnd() * 50), end: 50 + Math.round(rnd() * 50), curve: pick(['linear', 'wide', 'custom']), exponent: 0.3 + rnd() * 3 });
      lines.push(...TX.lines(p).filter((l) => !l.startsWith('button')));
      // the helper gets settings rounded to 4 places, so the page's maths uses the same numbers
      const sc = Object.fromEntries(Object.entries(TX.stickCfg(p.sticks.left)).map(([key, v]) => [key, +v.toFixed(4)]));
      const tc = Object.fromEntries(Object.entries(TX.trigCfg(p.triggers.left)).map(([key, v]) => [key, +v.toFixed(4)]));
      for (let j = 0; j < 20; j++) {
        const x = +(rnd() * 2 - 1).toFixed(4), y = +(rnd() * 2 - 1).toFixed(4), tv = +rnd().toFixed(4);
        lines.push(`in 0 ${x} ${y}`, `tin 0 ${tv}`);
        expect.push(TX.stick(x, y, sc), TX.trigger(tv, tc));
      }
    }
    const out = execFileSync(inputLib.EXE, ['--transform'], { input: `${lines.join('\n')}\n`, encoding: 'utf8' }).trim().split(/\r?\n/);
    assert.strictEqual(out.length, expect.length);
    out.forEach((line, i) => {
      const got = line.split(' ').slice(1).map(Number), want = [].concat(expect[i]);
      want.forEach((w, j) => assert.ok(Math.abs(got[j] - w) < 2e-6, `line ${i}: helper ${line}, page ${want.join(' ')}`));
    });
  }, !fs.existsSync(inputLib.EXE));

  test('input: profiles become the helper\'s lines, and old or pasted ones are completed', () => {
    const p = TX.blank('Test');
    p.buttons.A = { ...p.buttons.A, to: 'B', turbo: true, rate: 15, hold: 'Y', holdMs: 300 };
    p.sticks.left.ring = { to: 'LB', at: 80, invert: true };
    p.light = '#ff8000';
    const l = TX.lines(p);
    assert.strictEqual(l[l.length - 1], 'apply');
    assert.strictEqual(l.filter((x) => x.startsWith('button ')).length, TX.SOURCES.length);
    assert.strictEqual(l.find((x) => x.startsWith('button 0 ')), `button 0 ${TX.OUT.B} 1 15 0 ${TX.OUT.Y} 300`);
    assert.ok(l[0].endsWith(` 0.8 1 ${TX.OUT.LB} 0`), l[0]);
    assert.ok(l.includes('light 255 128 0'));
    assert.strictEqual(l.find((x) => x.startsWith('button 15 ')).split(' ')[2], String(TX.OUT.Back), 'touchpad click is View by default');
    const old = TX.complete({ name: 'Old', sticks: { left: { inner: 20 } } });
    assert.strictEqual(old.sticks.left.inner, 20);
    assert.strictEqual(old.sticks.left.shape, 'circle');
    assert.strictEqual(old.sticks.right.output, 'right');
    assert.strictEqual(old.buttons.Guide.to, 'Guide');
  });

  test('input: the helper\'s messages are understood', () => {
    const inp = new inputLib.Input(path.join(tmp, 'nowhere.exe'));
    const seen = [];
    inp.on('status', (s) => seen.push(s));
    inp.on('state', (s) => seen.push(s));
    inp.line('vigem ok 1');
    inp.line('pad dualsense bt 0 own');
    inp.line('state 0.1 -0.2 0 0 0.5 1 3 0.12 -0.25 0 0 0.6 1 4096');
    inp.line('pad none');
    assert.strictEqual(seen[0].vigem, true);
    assert.deepStrictEqual(seen[1].pad, { kind: 'dualsense', conn: 'bt', access: 'own' });
    assert.deepStrictEqual(seen[2].raw, [0.1, -0.2, 0, 0, 0.5, 1]);
    assert.strictEqual(seen[2].outButtons, 4096);
    assert.strictEqual(seen[3].pad, null);
    assert.throws(() => inp.start(TX.blank('x')), /missing/);
  });

  test('input: HidHide\'s controller list is grouped per controller, with what is hidden marked', () => {
    const json = [
      { friendlyName: 'Wireless Controller', devices: [
        { present: true, gamingDevice: true, deviceInstancePath: 'HID\\VID_054C&PID_09CC&MI_03\\8&1', baseContainerDeviceInstancePath: 'USB\\VID_054C&PID_09CC\\5&2' },
        { present: true, gamingDevice: true, deviceInstancePath: 'HID\\VID_054C&PID_09CC&MI_03&Col02\\8&1', baseContainerDeviceInstancePath: 'USB\\VID_054C&PID_09CC\\5&2' }] },
      { friendlyName: 'Xbox 360 Controller for Windows', devices: [
        { present: true, gamingDevice: true, deviceInstancePath: 'USB\\VID_045E&PID_028E\\1&2', baseContainerDeviceInstancePath: 'USB\\VID_045E&PID_028E\\1&2' }] },
      { friendlyName: 'Gone', devices: [{ present: false, deviceInstancePath: 'HID\\VID_1234&PID_5678\\1' }] },
    ];
    const list = inputLib.controllers(json, ['hid\\vid_054c&pid_09cc&mi_03\\8&1']);
    assert.strictEqual(list.length, 2);
    assert.deepStrictEqual(list[0].paths, ['HID\\VID_054C&PID_09CC&MI_03\\8&1', 'USB\\VID_054C&PID_09CC\\5&2', 'HID\\VID_054C&PID_09CC&MI_03&Col02\\8&1']);
    assert.strictEqual(list[0].hidden, true);
    assert.strictEqual(list[0].name, 'Wireless Controller');
    assert.strictEqual(list[1].virtual, true);
    assert.strictEqual(inputLib.decode(Buffer.from('﻿--cloak-on', 'utf16le')), '--cloak-on');
  });

  test('input: the driver installers OpenW comes with are intact, and the install script is valid PowerShell', () => {
    const { execFileSync } = require('child_process');
    for (const w of Object.keys(inputLib.DRIVERS)) assert.ok(inputLib.bundled(w), `${inputLib.DRIVERS[w].file} is missing or changed`);
    const files = Object.keys(inputLib.DRIVERS).map((w) => [w, inputLib.bundled(w)]);
    const script = `$out = ${inputLib.psQuote(path.join(tmp, "it's out.txt"))}\r\n${inputLib.installScript(files)}`;
    const file = path.join(tmp, 'install.ps1');
    fs.writeFileSync(file, script);
    const parse = `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile(${inputLib.psQuote(file)}, [ref]$null, [ref]$e); $e.Count`;
    assert.strictEqual(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', parse], { encoding: 'utf8' }).trim(), '0');
    assert.ok(script.includes("'/exenoui','/qn','/norestart'"));
  });

  await runAll();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${skipped} skipped${process.exitCode ? ', FAILURES above' : ''}`);
})();
