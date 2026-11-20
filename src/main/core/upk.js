// Minimal reader/patcher for Rocket League's cooked UE3 packages (.upk).
//
// Layout (as found in the shipping game, file version 868):
//   [package summary, plain] [header block, AES-256-ECB] [padding] [zlib chunks]
// The encrypted header block starts at NameOffset and holds the name, import and
// export tables. We only ever touch the name table, and only in place: a renamed
// entry keeps its byte length (shorter names are null-padded), so no offset in the
// file moves and the compressed object data is never rewritten.
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');

const TAG = 0x9e2a83c1;
// Publicly documented package key used by community tools. More can be supplied.
const DEFAULT_KEYS = ['C7DF6B13252ACC7147BB51C98AD7E34B7FE500B77FA5FAB293E2F24E6B17E779'];

class UpkError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function parseSummary(buf) {
  let o = 0;
  const i32 = () => { const v = buf.readInt32LE(o); o += 4; return v; };
  const u32 = () => { const v = buf.readUInt32LE(o); o += 4; return v; };
  const u16 = () => { const v = buf.readUInt16LE(o); o += 2; return v; };
  const skip = (n) => { o += n; };
  const fstr = () => { const n = i32(); skip(n >= 0 ? n : -2 * n); };
  // note: never write `o += i32() * k` — `o` would be read before i32() advances it
  try {
    if (u32() !== TAG) throw new UpkError('NOT_UPK', 'Not an Unreal package');
    const fileVersion = u16();
    const licenseeVersion = u16();
    const totalHeaderSize = i32();
    fstr(); // folder name
    u32(); // package flags
    const nameCount = i32(), nameOffset = i32();
    const exportCount = i32(), exportOffset = i32();
    const importCount = i32(), importOffset = i32();
    const dependsOffset = i32();
    skip(16); // import/export guid offsets + counts, thumbnail table offset
    skip(16); // package guid
    skip(i32() * 12); // generations
    skip(12); // engine version, cooker version, compression flags
    skip(i32() * 16); // compressed chunks (unused by the game's own format)
    i32();
    for (let n = i32(); n > 0; n--) fstr(); // additional packages to cook
    for (let n = i32(); n > 0; n--) { skip(20); skip(i32() * 4); } // texture allocations
    const garbageSize = i32(), chunkInfoOffset = i32(), lastBlockSize = i32();
    return {
      fileVersion, licenseeVersion, totalHeaderSize, nameCount, nameOffset, exportCount,
      exportOffset, importCount, importOffset, dependsOffset, garbageSize, chunkInfoOffset,
      lastBlockSize, summaryEnd: o,
    };
  } catch (e) {
    if (e instanceof UpkError) throw e;
    throw new UpkError('BAD_SUMMARY', 'Could not read the package summary');
  }
}

function headerRange(s, fileSize) {
  const size = (s.totalHeaderSize - s.garbageSize - s.nameOffset + 15) & ~15;
  if (size <= 0 || s.nameOffset + size > fileSize) {
    throw new UpkError('NOT_ENCRYPTED', 'Package does not use the encrypted header layout');
  }
  return { start: s.nameOffset, size };
}

function aes(mode, key, data) {
  const c = (mode === 'dec' ? crypto.createDecipheriv : crypto.createCipheriv)('aes-256-ecb', key, null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(data), c.final()]);
}

// Returns the name entries, or null when the block is not a valid name table
// (which is how a wrong key is detected).
function parseNames(plain, s) {
  const names = [];
  let p = 0;
  for (let i = 0; i < s.nameCount; i++) {
    if (p + 4 > plain.length) return null;
    const len = plain.readInt32LE(p);
    const bytes = len >= 0 ? len : -2 * len;
    if (len === 0 || bytes > 2048 || p + 4 + bytes + 8 > plain.length) return null;
    const raw = len > 0
      ? plain.toString('latin1', p + 4, p + 4 + len)
      : plain.toString('utf16le', p + 4, p + 4 + bytes);
    const nul = raw.indexOf('\0');
    if (nul < 0) return null;
    names.push({ index: i, offset: p, len, wide: len < 0, text: raw.slice(0, nul) });
    p += 4 + bytes + 8;
  }
  return p === s.importOffset - s.nameOffset ? names : null;
}

// Keys as buffers: the built-in one first, then any the user has added.
const keyCache = new WeakMap();
function keyBuffers(extraKeys = []) {
  if (!keyCache.has(extraKeys)) {
    keyCache.set(extraKeys, [...DEFAULT_KEYS, ...extraKeys].map((hex) => Buffer.from(hex, 'hex')).filter((k) => k.length === 32));
  }
  return keyCache.get(extraKeys);
}

// Quick test of one key: do the first two cipher blocks decrypt to the start of a
// name table (a length, then printable text)? Lets a long key list be tried cheaply.
function fitsNameTable(key, block) {
  const plain = aes('dec', key, block.subarray(0, 32));
  const len = plain.readInt32LE(0);
  if (len < 2 || len > 1024) return false;
  const text = plain.subarray(4, Math.min(32, 4 + len - 1));
  return text.every((c) => c >= 0x20 && c < 0x7f) && (4 + len > 32 || plain[4 + len - 1] === 0);
}

// Reads a key list: one key per line, 64 hex characters or base64 of 32 bytes.
function parseKeys(text) {
  const keys = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (/^[0-9a-fA-F]{64}$/.test(t)) keys.add(t.toLowerCase());
    else if (/^[A-Za-z0-9+/]{43}=$/.test(t)) keys.add(Buffer.from(t, 'base64').toString('hex'));
  }
  DEFAULT_KEYS.forEach((k) => keys.delete(k.toLowerCase()));
  return [...keys];
}

function readPackage(buf, extraKeys = []) {
  const summary = parseSummary(buf);
  const range = headerRange(summary, buf.length);
  const block = buf.subarray(range.start, range.start + range.size);
  for (const key of keyBuffers(extraKeys)) {
    if (block.length < 32 || !fitsNameTable(key, block)) continue;
    const plain = aes('dec', key, block);
    const names = parseNames(plain, summary);
    if (names) return { summary, range, key, plain, names };
  }
  throw new UpkError('NO_KEY', 'Could not decrypt the package header with the known keys');
}

function readPackageFile(file, extraKeys) {
  return readPackage(fs.readFileSync(file), extraKeys);
}

/**
 * Rename name-table entries in place.
 * renames: [{ from, to }] — matched case-insensitively against whole names.
 * Returns { buffer, renamed, missing }. Throws NAME_TOO_LONG when `to` does not
 * fit in the bytes of the entry it replaces.
 */
function renameNames(buf, renames, extraKeys = []) {
  const pkg = readPackage(buf, extraKeys);
  const plain = Buffer.from(pkg.plain);
  const renamed = [], missing = [];
  for (const { from, to } of renames) {
    const hits = pkg.names.filter((n) => n.text.toLowerCase() === from.toLowerCase());
    if (!hits.length) { missing.push(from); continue; }
    for (const n of hits) {
      if (n.wide || !/^[\x20-\x7e]+$/.test(to)) throw new UpkError('BAD_NAME', `Cannot rename "${from}"`);
      if (to.length > n.len - 1) {
        throw new UpkError('NAME_TOO_LONG', `"${to}" (${to.length}) does not fit in "${n.text}" (${n.len - 1})`);
      }
      plain.fill(0, n.offset + 4, n.offset + 4 + n.len);
      plain.write(to, n.offset + 4, 'latin1');
      renamed.push({ from: n.text, to });
    }
  }
  const out = Buffer.from(buf);
  aes('enc', pkg.key, plain).copy(out, pkg.range.start);
  return { buffer: out, renamed, missing };
}

// Cheap check: can this package be read with the keys we have? Reads only the
// summary and the first two cipher blocks, so thousands of files can be checked.
function probeFile(file, extraKeys = []) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(16384);
    const summary = parseSummary(head.subarray(0, fs.readSync(fd, head, 0, head.length, 0)));
    const block = Buffer.alloc(32);
    if (fs.readSync(fd, block, 0, 32, summary.nameOffset) < 32) return false;
    return keyBuffers(extraKeys).some((key) => fitsNameTable(key, block));
  } catch { return false; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

// ----- read-only access to objects (used for thumbnails) -----

// Import/export tables and the list of compressed chunks.
function readTables(buf, extraKeys = []) {
  const pkg = readPackage(buf, extraKeys);
  const { summary: s, plain } = pkg;
  const names = pkg.names.map((n) => n.text);
  const imports = [];
  let p = s.importOffset - s.nameOffset;
  for (let i = 0; i < s.importCount; i++, p += 28) imports.push(names[plain.readInt32LE(p + 20)]);
  const exports = [];
  p = s.exportOffset - s.nameOffset;
  for (let i = 0; i < s.exportCount; i++) {
    const cls = plain.readInt32LE(p), number = plain.readInt32LE(p + 16);
    exports.push({
      cls: cls < 0 ? imports[-cls - 1] : (cls > 0 ? '' : 'Class'),
      name: names[plain.readInt32LE(p + 12)] + (number ? `_${number - 1}` : ''),
      size: plain.readInt32LE(p + 32),
      offset: Number(plain.readBigInt64LE(p + 36)),
    });
    p += 72 + plain.readInt32LE(p + 48) * 4;
  }
  const chunks = [];
  p = s.chunkInfoOffset; // relative to the start of the decrypted block
  const count = plain.readInt32LE(p);
  p += 4;
  for (let i = 0; i < count; i++, p += 24) {
    chunks.push({ uoff: Number(plain.readBigInt64LE(p)), usize: plain.readInt32LE(p + 8), coff: Number(plain.readBigInt64LE(p + 12)), csize: plain.readInt32LE(p + 20) });
  }
  return { names, exports, chunks };
}

// One compressed chunk: tag, block size, sizes, a table of blocks, then zlib blocks.
function inflateChunk(buf, at) {
  if (buf.readUInt32LE(at) !== TAG) throw new UpkError('BAD_CHUNK', 'Compressed chunk has no tag');
  const blockSize = buf.readInt32LE(at + 4), total = buf.readInt32LE(at + 12);
  const blocks = Math.ceil(total / blockSize);
  let table = at + 16, data = table + blocks * 8;
  const out = [];
  for (let i = 0; i < blocks; i++, table += 8) {
    const size = buf.readInt32LE(table);
    out.push(zlib.inflateSync(buf.subarray(data, data + size)));
    data += size;
  }
  return Buffer.concat(out);
}

// The serialized bytes of one export, taken from the chunks that hold it.
function readObject(buf, tables, exp) {
  const parts = [];
  let at = exp.offset, left = exp.size;
  while (left > 0) {
    const chunk = tables.chunks.find((c) => at >= c.uoff && at < c.uoff + c.usize);
    if (!chunk) throw new UpkError('BAD_OFFSET', `Object "${exp.name}" is outside the package data`);
    chunk.data ??= inflateChunk(buf, chunk.coff);
    const part = chunk.data.subarray(at - chunk.uoff, at - chunk.uoff + left);
    parts.push(part);
    at += part.length;
    left -= part.length;
  }
  return parts.length === 1 ? parts[0] : Buffer.concat(parts);
}

// "WHEEL_Star_SF.upk" -> "WHEEL_Star"
function baseName(fileName) {
  return fileName.replace(/\.upk$/i, '').replace(/_SF$/i, '');
}

module.exports = {
  UpkError, DEFAULT_KEYS, parseSummary, readPackage, readPackageFile, renameNames, baseName,
  probeFile, parseKeys, readTables, inflateChunk, readObject,
};
