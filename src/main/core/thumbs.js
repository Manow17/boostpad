// Reads an item's own thumbnail out of the game's "<item>_T_SF.upk" package.
// Nothing is bundled or downloaded: the picture comes from the user's install.
// Returns raw BGRA pixels; the caller scales and encodes them.
const fs = require('fs');
const path = require('path');
const upk = require('./upk');

const PREFERRED = [/_TThumbnail$/i, /Thumbnail$/i, /Thumbnail/i];

function pickTexture(exports) {
  const textures = exports.filter((e) => e.cls === 'Texture2D');
  for (const re of PREFERRED) {
    const hit = textures.find((e) => re.test(e.name));
    if (hit) return hit;
  }
  return textures.find((e) => !/mask|background/i.test(e.name)) || textures[0] || null;
}

// UE3 tagged properties: name(8) type(8) size(4) index(4) [extra] value, ended by "None".
function readProps(d, names) {
  const props = {};
  let p = 4; // skip the object's net index
  for (let guard = 0; guard < 64; guard++) {
    const name = names[d.readInt32LE(p)];
    if (name === 'None') return { props, end: p + 8 };
    const type = names[d.readInt32LE(p + 8)];
    const size = d.readInt32LE(p + 16);
    let value = p + 24;
    if (type === 'ByteProperty' || type === 'StructProperty') value += 8; // enum / struct name
    if (type === 'IntProperty') props[name] = d.readInt32LE(value);
    else if (type === 'ByteProperty' || type === 'NameProperty') props[name] = names[d.readInt32LE(value)];
    p = value + (type === 'BoolProperty' ? 1 : size);
  }
  throw new Error('property list did not end');
}

// Mip list. A mip kept in a .tfc file has an 8-byte offset and no data; an inline
// mip is followed directly by its bytes. Both end with the mip's width and height.
function readMips(d, start, width) {
  let p = start + 12;
  const count = d.readInt32LE(p);
  p += 4;
  if (count < 1 || count > 16) throw new Error('unexpected mip count');
  const mips = [];
  for (let i = 0; i < count; i++) {
    const flags = d.readUInt32LE(p), elements = d.readInt32LE(p + 4), size = d.readInt32LE(p + 8);
    const mip = { flags, elements, size };
    if (flags & 1) { mip.tfcOffset = Number(d.readBigInt64LE(p + 12)); p += 20; }
    else { mip.data = d.subarray(p + 12, p + 12 + size); p += 12 + size; }
    mip.width = d.readInt32LE(p);
    mip.height = d.readInt32LE(p + 4);
    p += 8;
    if (mip.width < 1 || mip.width > 4096 || mip.height < 1 || mip.height > 4096 || mip.width > width) throw new Error('unexpected mip layout');
    mips.push(mip);
  }
  return mips;
}

const rgb565 = (c) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];

function decodeDxt(data, width, height, dxt5) {
  const out = Buffer.alloc(width * height * 4, 255);
  const blockSize = dxt5 ? 16 : 8;
  let p = 0;
  for (let by = 0; by < height; by += 4) {
    for (let bx = 0; bx < width; bx += 4, p += blockSize) {
      const alpha = new Array(16).fill(255);
      if (dxt5) {
        const a0 = data[p], a1 = data[p + 1];
        const table = [a0, a1];
        for (let i = 1; i <= 6; i++) {
          if (a0 > a1) table.push(((7 - i) * a0 + i * a1) / 7);
          else table.push(i <= 4 ? ((5 - i) * a0 + i * a1) / 5 : (i === 5 ? 0 : 255));
        }
        const bits = data.readUIntLE(p + 2, 6);
        for (let i = 0; i < 16; i++) alpha[i] = table[Math.floor(bits / 2 ** (3 * i)) % 8];
      }
      const c = p + (dxt5 ? 8 : 0);
      const c0 = data.readUInt16LE(c), c1 = data.readUInt16LE(c + 2);
      const [r0, g0, b0] = rgb565(c0), [r1, g1, b1] = rgb565(c1);
      const pal = [[r0, g0, b0, 255], [r1, g1, b1, 255]];
      if (dxt5 || c0 > c1) pal.push([(2 * r0 + r1) / 3, (2 * g0 + g1) / 3, (2 * b0 + b1) / 3, 255], [(r0 + 2 * r1) / 3, (g0 + 2 * g1) / 3, (b0 + 2 * b1) / 3, 255]);
      else pal.push([(r0 + r1) / 2, (g0 + g1) / 2, (b0 + b1) / 2, 255], [0, 0, 0, 0]);
      const idx = data.readUInt32LE(c + 4);
      for (let i = 0; i < 16; i++) {
        const x = bx + (i & 3), y = by + (i >> 2);
        if (x >= width || y >= height) continue;
        const col = pal[(idx >>> (2 * i)) & 3], o = (y * width + x) * 4;
        out[o] = col[2]; out[o + 1] = col[1]; out[o + 2] = col[0];
        out[o + 3] = dxt5 ? alpha[i] : col[3];
      }
    }
  }
  return out;
}

const FORMATS = {
  PF_A8R8G8B8: { bytes: (w, h) => w * h * 4, decode: (d) => Buffer.from(d) },
  PF_DXT1: { bytes: (w, h) => Math.ceil(w / 4) * Math.ceil(h / 4) * 8, decode: (d, w, h) => decodeDxt(d, w, h, false) },
  PF_DXT5: { bytes: (w, h) => Math.ceil(w / 4) * Math.ceil(h / 4) * 16, decode: (d, w, h) => decodeDxt(d, w, h, true) },
};

// Thumbnails are shown on a dark tile, so see-through pixels are blended onto black.
function flatten(bgra) {
  for (let o = 0; o < bgra.length; o += 4) {
    const a = bgra[o + 3];
    if (a === 255) continue;
    bgra[o] = bgra[o] * a / 255; bgra[o + 1] = bgra[o + 1] * a / 255; bgra[o + 2] = bgra[o + 2] * a / 255; bgra[o + 3] = 255;
  }
  return bgra;
}

function mipBytes(mip, cookedDir, tfcName) {
  if (mip.data) return mip.flags & 2 ? upk.inflateChunk(mip.data, 0) : mip.data;
  if (!tfcName || path.basename(tfcName) !== tfcName) return null;
  const file = path.join(cookedDir, `${tfcName}.tfc`);
  if (!fs.existsSync(file)) return null;
  const raw = Buffer.alloc(mip.size);
  const fd = fs.openSync(file, 'r');
  try { if (fs.readSync(fd, raw, 0, mip.size, mip.tfcOffset) < mip.size) return null; } finally { fs.closeSync(fd); }
  return mip.flags & 2 ? upk.inflateChunk(raw, 0) : raw;
}

/** Returns { width, height, bgra } for the thumbnail in `file` (a *_T_SF.upk in cookedDir). */
function readThumbnail(cookedDir, file, extraKeys = []) {
  const buf = fs.readFileSync(path.join(cookedDir, file));
  const tables = upk.readTables(buf, extraKeys);
  const texture = pickTexture(tables.exports);
  if (!texture) throw new Error('no thumbnail texture in package');
  const d = upk.readObject(buf, tables, texture);
  const { props, end } = readProps(d, tables.names);
  const format = FORMATS[props.Format];
  if (!format) throw new Error(`unsupported texture format ${props.Format}`);
  // largest mip first; skip any whose bytes are not available or not the expected size
  for (const mip of readMips(d, end, props.SizeX)) {
    if (mip.width > 1024) continue;
    let bytes = null;
    try { bytes = mipBytes(mip, cookedDir, props.TextureFileCacheName); } catch { /* try the next mip */ }
    if (!bytes || bytes.length < format.bytes(mip.width, mip.height)) continue;
    return { width: mip.width, height: mip.height, bgra: flatten(format.decode(bytes, mip.width, mip.height)) };
  }
  throw new Error('no readable mip');
}

module.exports = { readThumbnail, pickTexture, decodeDxt };
