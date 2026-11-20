// Tiny JSON-file store. One file, written atomically.
const fs = require('fs');
const path = require('path');

class Store {
  constructor(file, defaults = {}) {
    this.file = file;
    this.data = structuredClone(defaults);
    try {
      Object.assign(this.data, JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch { /* first run or unreadable: keep defaults */ }
  }
  get(key) { return this.data[key]; }
  set(key, value) { this.data[key] = value; this.save(); return value; }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store };
