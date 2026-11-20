// The mod engine. Every change Boostpad makes to the game goes through here:
// it replaces one existing file in CookedPCConsole, after saving the original,
// and can always put the original back. While the game runs, changes are queued.
//
// Operations:
//   { kind: 'swap', sourceFile, targetFile }  the item you own (source) gets the
//       look of another item (target): target's package, internally renamed to
//       the source's name, is written over the source file.
//   { kind: 'file', gameFile, from }           gameFile is replaced by an
//       arbitrary file (workshop map, mod pack file).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const upk = require('./upk');

class EngineError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

class Engine {
  constructor({ store, backupDir, getCookedDir, isRunning, getKeys = () => [] }) {
    Object.assign(this, { store, backupDir, getCookedDir, isRunning, getKeys });
    if (!store.get('active')) store.set('active', {});
    if (!store.get('queue')) store.set('queue', []);
  }

  cooked() {
    const dir = this.getCookedDir();
    if (!dir) throw new EngineError('NO_GAME', 'Rocket League folder is not set');
    return dir;
  }

  destName(op) {
    const name = op.kind === 'swap' ? op.sourceFile : op.gameFile;
    if (!name || path.basename(name) !== name) throw new EngineError('BAD_OP', 'Invalid game file name');
    return name;
  }

  internalName(fileName) {
    const wanted = upk.baseName(fileName);
    try {
      const pkg = upk.readPackageFile(path.join(this.cooked(), fileName), this.getKeys());
      const hit = pkg.names.find((n) => n.text.toLowerCase() === wanted.toLowerCase());
      if (hit) return hit.text;
    } catch { /* fall back to the file name's casing */ }
    return wanted;
  }

  // Dry run: can this swap be built? Returns { ok, code?, message? }.
  checkSwap(op) {
    try { this.buildContent(op); return { ok: true }; }
    catch (e) { return { ok: false, code: e.code || 'ERROR', message: e.message }; }
  }

  buildContent(op) {
    if (op.kind === 'file') return fs.readFileSync(op.from);
    if (op.kind !== 'swap') throw new EngineError('BAD_OP', `Unknown operation "${op.kind}"`);
    if (op.sourceFile.toLowerCase() === op.targetFile.toLowerCase()) {
      throw new EngineError('SAME_ITEM', 'Pick two different items');
    }
    const cooked = this.cooked();
    // Always read the target from its pristine copy if we have modified it.
    const targetKey = op.targetFile.toLowerCase();
    const targetPath = this.store.get('active')[targetKey]
      ? path.join(this.backupDir, targetKey)
      : path.join(cooked, op.targetFile);
    const from = upk.baseName(op.targetFile);
    const to = this.internalName(op.sourceFile);
    const res = upk.renameNames(fs.readFileSync(targetPath), [
      { from, to },
      { from: `${from}_SF`, to: `${to}_SF` },
    ], this.getKeys());
    if (res.missing.includes(from)) {
      throw new EngineError('UNEXPECTED_LAYOUT', `"${from}" was not found inside ${op.targetFile}`);
    }
    return res.buffer;
  }

  list() {
    return { active: Object.values(this.store.get('active')), queue: this.store.get('queue') };
  }

  async apply(op) {
    this.destName(op);
    if (await this.isRunning()) return this.enqueue({ type: 'apply', op });
    return { queued: false, record: this.applyNow(op) };
  }

  async revert(destKey) {
    if (await this.isRunning()) return this.enqueue({ type: 'revert', dest: destKey });
    this.revertNow(destKey);
    return { queued: false };
  }

  async revertAll() {
    const out = [];
    for (const key of Object.keys(this.store.get('active'))) out.push(await this.revert(key));
    return out;
  }

  enqueue(entry) {
    const key = (entry.type === 'apply' ? this.destName(entry.op) : entry.dest).toLowerCase();
    const queue = this.store.get('queue').filter((q) => q.key !== key);
    queue.push({ ...entry, key, queuedAt: Date.now() });
    this.store.set('queue', queue);
    return { queued: true };
  }

  unqueue(key) {
    this.store.set('queue', this.store.get('queue').filter((q) => q.key !== key));
  }

  // Run everything that was queued while the game was open.
  async flushQueue() {
    if (await this.isRunning()) return [];
    const queue = this.store.get('queue');
    this.store.set('queue', []);
    return queue.map((q) => {
      try {
        if (q.type === 'apply') this.applyNow(q.op); else this.revertNow(q.dest);
        return { key: q.key, ok: true };
      } catch (e) {
        return { key: q.key, ok: false, code: e.code, message: e.message };
      }
    });
  }

  applyNow(op) {
    const name = this.destName(op);
    const key = name.toLowerCase();
    const dest = path.join(this.cooked(), name);
    if (!fs.existsSync(dest)) throw new EngineError('NO_SUCH_GAME_FILE', `${name} is not in the game folder`);
    const content = this.buildContent(op);

    this.dropIfOverwritten(key);
    const backup = path.join(this.backupDir, key);
    fs.mkdirSync(this.backupDir, { recursive: true });
    if (!fs.existsSync(backup)) fs.copyFileSync(dest, backup); // first change: keep the original

    const tmp = `${dest}.boostpad-tmp`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, dest);
    const st = fs.statSync(dest);

    const record = {
      id: crypto.randomUUID(), key, file: name, op, appliedAt: Date.now(),
      written: { size: st.size, mtimeMs: st.mtimeMs },
    };
    const active = this.store.get('active');
    active[key] = record;
    this.store.set('active', active);
    return record;
  }

  revertNow(key) {
    const active = this.store.get('active');
    const rec = active[key];
    if (!rec) return;
    const backup = path.join(this.backupDir, key);
    if (!this.dropIfOverwritten(key) && fs.existsSync(backup)) {
      fs.copyFileSync(backup, path.join(this.cooked(), rec.file));
      fs.rmSync(backup, { force: true });
      delete active[key];
      this.store.set('active', active);
    }
  }

  // A game update or "verify files" replaces our file with a fresh original.
  // In that case the old backup is stale and must never be restored.
  dropIfOverwritten(key) {
    const active = this.store.get('active');
    const rec = active[key];
    if (!rec) return false;
    let st = null;
    try { st = fs.statSync(path.join(this.cooked(), rec.file)); } catch { /* file gone */ }
    const ours = st && st.size === rec.written.size && Math.abs(st.mtimeMs - rec.written.mtimeMs) < 2000;
    if (ours) return false;
    fs.rmSync(path.join(this.backupDir, key), { force: true });
    delete active[key];
    this.store.set('active', active);
    return true;
  }

  reconcile() {
    return Object.keys(this.store.get('active')).filter((key) => this.dropIfOverwritten(key));
  }
}

module.exports = { Engine, EngineError };
