// Workshop maps: map files the user has added, kept in the app's data directory
// and applied through the engine as a file op.
const fs = require('fs');
const path = require('path');

const MAP_SLOT = 'Labs_Underpass_P.upk'; // the arena a workshop map takes the place of

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

module.exports = { Maps, MAP_SLOT };
