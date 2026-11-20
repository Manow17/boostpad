// Local libraries: workshop maps and mod packs. Both are plain folders in the
// app's data directory, and both are applied through the engine as file ops.
const fs = require('fs');
const path = require('path');

const MAP_SLOT = 'Labs_Underpass_P.upk'; // the arena a workshop map takes the place of
const PACK_TYPES = ['ball', 'decal', 'boostmeter', 'wheels', 'menu', 'loading', 'music', 'sound', 'other'];

function safeName(name) {
  return name.replace(/[^\w.\- ()]/g, '_').slice(0, 80);
}

class Maps {
  constructor(dir) { this.dir = dir; fs.mkdirSync(dir, { recursive: true }); }

  list() {
    return fs.readdirSync(this.dir)
      .filter((f) => /\.(upk|udk)$/i.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(this.dir, f));
        return { id: f, name: f.replace(/\.(upk|udk)$/i, '').replace(/_/g, ' '), size: st.size, addedAt: st.mtimeMs };
      });
  }

  add(files) {
    const added = [];
    for (const file of files) {
      if (!/\.(upk|udk)$/i.test(file)) continue;
      const name = safeName(path.basename(file));
      fs.copyFileSync(file, path.join(this.dir, name));
      added.push(name);
    }
    return added;
  }

  remove(id) { fs.rmSync(path.join(this.dir, path.basename(id)), { force: true }); }

  op(id) {
    const from = path.join(this.dir, path.basename(id));
    if (!fs.existsSync(from)) throw new Error('Map file not found');
    return { kind: 'file', gameFile: MAP_SLOT, from, category: 'map', label: path.basename(id).replace(/\.(upk|udk)$/i, '') };
  }
}

// A pack is a folder with a pack.json:
//   { "name": "...", "type": "ball", "author": "...",
//     "files": { "<file in CookedPCConsole>": "<replacement file in the pack>" } }
class Packs {
  constructor(dir) { this.dir = dir; fs.mkdirSync(dir, { recursive: true }); }

  read(id) {
    const root = path.join(this.dir, path.basename(id));
    const meta = JSON.parse(fs.readFileSync(path.join(root, 'pack.json'), 'utf8'));
    const files = [];
    for (const [gameFile, rel] of Object.entries(meta.files || {})) {
      const from = path.resolve(root, String(rel));
      // game file must be a bare file name, and the replacement must live in the pack
      if (path.basename(gameFile) !== gameFile || !from.startsWith(root + path.sep) || !fs.existsSync(from)) {
        throw new Error(`Pack "${id}" has an invalid entry for ${gameFile}`);
      }
      files.push({ gameFile, from });
    }
    return {
      id: path.basename(id),
      name: String(meta.name || id),
      type: PACK_TYPES.includes(meta.type) ? meta.type : 'other',
      author: String(meta.author || ''),
      description: String(meta.description || ''),
      files,
    };
  }

  list() {
    const out = [];
    for (const id of fs.readdirSync(this.dir)) {
      try { out.push(this.read(id)); } catch (e) { out.push({ id, name: id, type: 'other', error: e.message, files: [] }); }
    }
    return out;
  }

  // Import a folder that contains a pack.json.
  import(folder) {
    if (!fs.existsSync(path.join(folder, 'pack.json'))) throw new Error('That folder has no pack.json');
    const id = safeName(path.basename(folder));
    const dest = path.join(this.dir, id);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(folder, dest, { recursive: true });
    try { return this.read(id); }
    catch (e) { fs.rmSync(dest, { recursive: true, force: true }); throw e; }
  }

  remove(id) { fs.rmSync(path.join(this.dir, path.basename(id)), { recursive: true, force: true }); }

  ops(id) {
    const pack = this.read(id);
    return pack.files.map((f) => ({
      kind: 'file', gameFile: f.gameFile, from: f.from, category: pack.type, label: pack.name, packId: pack.id,
    }));
  }
}

module.exports = { Maps, Packs, MAP_SLOT, PACK_TYPES };
