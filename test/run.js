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
const { Maps, Packs, MAP_SLOT } = require('../src/main/core/library');

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

  test('mod packs: valid pack loads, path escapes are rejected', () => {
    const packs = new Packs(path.join(tmp, 'packs'));
    const src = path.join(tmp, 'Cool Ball');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'ball.upk'), 'x');
    fs.writeFileSync(path.join(src, 'pack.json'), JSON.stringify({ name: 'Cool Ball', type: 'ball', files: { 'Ball_Default_SF.upk': 'ball.upk' } }));
    const pack = packs.import(src);
    assert.strictEqual(pack.type, 'ball');
    assert.strictEqual(packs.ops(pack.id)[0].gameFile, 'Ball_Default_SF.upk');
    for (const files of [{ '..\\..\\evil.upk': 'ball.upk' }, { 'Ball_Default_SF.upk': '..\\s.json' }]) {
      fs.writeFileSync(path.join(src, 'pack.json'), JSON.stringify({ name: 'bad', files }));
      assert.throws(() => packs.import(src), /invalid entry/);
      assert.deepStrictEqual(packs.list(), [], 'a rejected pack must not stay in the library');
    }
  });

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

  await runAll();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${skipped} skipped${process.exitCode ? ', FAILURES above' : ''}`);
})();
