// Builds merged arenas by editing map packages at the object level.
//
// Most arenas keep their stadium and surroundings together in one map file, so a merge
// cannot be done by swapping whole files. Instead, two packages are built:
//   base          a copy of the stadium arena's map with its surroundings hidden. It keeps
//                 the gameplay (boost pads, goals, spawns, collision) and the stadium.
//   surroundings  a copy of the other arena's map (or one of its outside parts) with its
//                 stadium hidden and its gameplay actors taken out of the level. It is
//                 written as a new file, and the base loads it in place of one of its own
//                 parts (its streaming level name is renamed to the new file's name).
//
// Every edit keeps sizes the same (a mesh reference set to none, an actor reference
// cleared from the level's list, a name shortened in place), so only the compressed
// chunks and the chunk table in the encrypted header change.
const zlib = require('zlib');
const crypto = require('crypto');
const upk = require('./upk');

const TAG = 0x9e2a83c1;
const BLOCK = 131072;

/* ---------- package in and out ---------- */

function open(buf, keys = []) {
  const t = upk.readTables(buf, keys);
  const base = t.chunks[0].uoff;
  const last = t.chunks[t.chunks.length - 1];
  const u = Buffer.alloc(last.uoff + last.usize - base);
  for (const c of t.chunks) upk.inflateChunk(buf, c.coff).copy(u, c.uoff - base);
  return { buf, t, u, base, names: t.names, obj: (e) => u.subarray(e.offset - base, e.offset - base + e.size) };
}

function deflateChunk(data) {
  const blocks = [];
  for (let o = 0; o < data.length; o += BLOCK) {
    const raw = data.subarray(o, Math.min(o + BLOCK, data.length));
    blocks.push({ z: zlib.deflateSync(raw, { level: 6 }), n: raw.length });
  }
  const head = Buffer.alloc(16 + blocks.length * 8);
  head.writeUInt32LE(TAG, 0);
  head.writeInt32LE(BLOCK, 4);
  head.writeInt32LE(blocks.reduce((s, b) => s + b.z.length, 0), 8);
  head.writeInt32LE(data.length, 12);
  blocks.forEach((b, i) => { head.writeInt32LE(b.z.length, 16 + i * 8); head.writeInt32LE(b.n, 20 + i * 8); });
  return Buffer.concat([head, ...blocks.map((b) => b.z)]);
}

// renames: { oldName: newName }, matched case-insensitively; a new name may be shorter.
function repack(P, key, renames = {}) {
  const { t, buf } = P;
  const plain = Buffer.from(t.pkg.plain);
  for (const [from, to] of Object.entries(renames)) {
    const hits = t.pkg.names.filter((n) => n.text.toLowerCase() === from.toLowerCase());
    if (!hits.length) throw new Error(`"${from}" is not in the package`);
    for (const n of hits) {
      if (n.wide || to.length > n.len - 1 || !/^[\x21-\x7e]+$/.test(to)) throw new Error(`Cannot rename "${from}" to "${to}"`);
      plain.fill(0, n.offset + 4, n.offset + 4 + n.len);
      plain.write(to, n.offset + 4, 'latin1');
    }
  }
  const parts = [Buffer.from(buf.subarray(0, t.chunks[0].coff))];
  let at = t.chunks[0].coff;
  for (const c of t.chunks) {
    const z = deflateChunk(P.u.subarray(c.uoff - P.base, c.uoff - P.base + c.usize));
    plain.writeBigInt64LE(BigInt(at), c.at + 12);
    plain.writeInt32LE(z.length, c.at + 20);
    parts.push(z);
    at += z.length;
  }
  upk.aes('enc', key, plain).copy(parts[0], t.pkg.range.start);
  return Buffer.concat(parts);
}

/* ---------- reading objects ---------- */

function tagged(P, data) {
  const { names } = P;
  if (data.length >= 12 && names[data.readInt32LE(4)] === 'None') return { props: [], end: 12 };
  let start = -1;
  for (const s of [0, 4, 8, 12, 16, 20, 24, 28]) {
    if (s + 12 > data.length) break;
    const ty = names[data.readInt32LE(s + 8)];
    if (names[data.readInt32LE(s)] !== undefined && ty && /Property$/.test(ty)) { start = s; break; }
  }
  if (start < 0) return null;
  const props = [];
  let p = start;
  for (let guard = 0; guard < 500 && p + 8 <= data.length; guard++) {
    const n = names[data.readInt32LE(p)];
    if (n === undefined) return null;
    if (n === 'None') return { props, end: p + 8 };
    const type = names[data.readInt32LE(p + 8)];
    if (!type || !/Property$/.test(type)) return null;
    const size = data.readInt32LE(p + 16);
    let q = p + 24;
    if (type === 'StructProperty' || type === 'ByteProperty') q += 8;
    if (type === 'BoolProperty') q += 1;
    props.push({ name: n, type, size, at: q });
    p = q + size;
  }
  return null;
}
const prop = (r, name) => r && r.props.find((p) => p.name === name);
const vec = (d, p) => (p && p.size === 12 ? { x: d.readFloatLE(p.at), y: d.readFloatLE(p.at + 4), z: d.readFloatLE(p.at + 8) } : null);

// Local bounds of a mesh in this package: { c: centre, e: extent } (null for imported meshes).
function meshBounds(P, index, cache) {
  if (index <= 0) return null;
  if (cache.has(index)) return cache.get(index);
  const e = P.t.exports[index - 1];
  const d = P.obj(e);
  const r = tagged(P, d);
  let b = null;
  if (r && r.end + 28 <= d.length) {
    const f = (k) => d.readFloatLE(r.end + k * 4);
    b = { c: { x: f(0), y: f(1), z: f(2) }, e: { x: f(3), y: f(4), z: f(5) } };
    if (![b.c.x, b.c.y, b.e.x, b.e.y].every(Number.isFinite)) b = null;
  }
  cache.set(index, b);
  return b;
}

/* ---------- what is stadium and what is surroundings ---------- */

// Names that say it outright; otherwise the position decides. A standard pitch is
// 8192 x 10240 units around the origin; stands reach a few thousand units further.
const OUTSIDE_NAME = /OOB|sky|cloud|sunplane|moon|horizon|mountain|terrain|backdrop|skyline|ocean/i;
const STADIUM_NAME = /stadium|stand|field|goal|crowd|bleach|arena|pitch|seat|boost|collision|ramp|cage|dome|net(post)?s?_|wall|floor|trim|glass/i;
function isStadium(name, pos, ext) {
  if (/OOB/i.test(name)) return false;
  if (STADIUM_NAME.test(name)) return true;
  if (OUTSIDE_NAME.test(name)) return false;
  if (!pos) return true;
  const size = ext ? Math.max(ext.x, ext.y) : 0;
  return Math.abs(pos.x) <= 8000 && Math.abs(pos.y) <= 9600 && size < 15000;
}

// Actor classes that are gameplay, lighting or atmosphere: they stay with the stadium
// and never come along with the surroundings.
const GAME_ONLY = /^(WorldInfo|VehiclePickup|Goal|PlayerStart|Pylon|PointInSpace|CameraActor|SpectatorVolume|TriggerVolume|DecalBlockingActor|GroundStaticMeshActor|FXActor|LightmassImportanceVolume|PrefabInstance|ExponentialHeightFog|HeightFog|WindDirectionalSource|SceneCapture|StaticLightCollectionActor|.*Light$|.*Volume|MapInfo|ArenaSoundSettings|CrowdSounds|StatEvent|Note)/;
const ART = /^(StaticMeshCollectionActor|StaticMeshActor|InstancedFoliageActor)$/;

// The level object and its actor list: owner, count, references.
function levelActors(P) {
  const level = P.t.exports.find((e) => e.cls === 'Level');
  if (!level) throw new Error('No level in this package');
  const d = P.obj(level);
  const r = tagged(P, d);
  if (!r) throw new Error('Unreadable level');
  const at = r.end + 4; // the owner comes first
  const count = d.readInt32LE(at);
  if (count < 0 || at + 4 + count * 4 > d.length) throw new Error('Unreadable actor list');
  return { d, at: at + 4, count };
}

/**
 * Keeps one side of a map package, in place: 'stadium' or 'surroundings'.
 * With 'surroundings', gameplay, lights and atmosphere actors are taken out of the level.
 * Returns counts of what is kept and hidden.
 */
function keepSide(P, side) {
  const keepStadium = side === 'stadium';
  const cache = new Map();
  const stats = { kept: 0, hidden: 0, actorsRemoved: 0 };
  const { d: lv, at, count } = levelActors(P);
  for (let i = 0; i < count; i++) {
    const ref = lv.readInt32LE(at + i * 4);
    if (ref <= 0) continue;
    const actor = P.t.exports[ref - 1];
    const remove = () => { lv.writeInt32LE(0, at + i * 4); stats.actorsRemoved++; };
    if (i === 0) continue; // WorldInfo: every level has one
    if (actor.cls === 'StaticMeshCollectionActor') {
      const d = P.obj(actor);
      const list = prop(tagged(P, d), 'StaticMeshComponents');
      if (!list) continue;
      const n = d.readInt32LE(list.at);
      for (let k = 0; k < n; k++) {
        const ci = d.readInt32LE(list.at + 4 + k * 4);
        if (ci <= 0) continue;
        const comp = P.t.exports[ci - 1];
        const cd = P.obj(comp);
        const cr = tagged(P, cd);
        const sm = prop(cr, 'StaticMesh');
        if (!sm || sm.type !== 'ObjectProperty') continue;
        const mesh = cd.readInt32LE(sm.at);
        if (mesh === 0) continue;
        const b = meshBounds(P, mesh, cache);
        const tr = vec(cd, prop(cr, 'Translation')) || { x: 0, y: 0, z: 0 };
        const pos = b ? { x: tr.x + b.c.x, y: tr.y + b.c.y } : tr;
        const name = mesh > 0 ? P.t.exports[mesh - 1].name : '';
        if (isStadium(name, pos, b && b.e) === keepStadium) stats.kept++;
        else { cd.writeInt32LE(0, sm.at); stats.hidden++; }
      }
    } else if (actor.cls === 'InstancedFoliageActor') {
      if (keepStadium) remove(); // foliage is scenery
    } else if (GAME_ONLY.test(actor.cls)) {
      if (!keepStadium) remove();
    } else {
      // anything else that is placed somewhere (animated props, emitters, decals): by position
      const d = P.obj(actor);
      const loc = vec(d, prop(tagged(P, d), 'Location'));
      const stadium = isStadium(actor.name, loc, null);
      if (stadium !== keepStadium) remove();
    }
  }
  return stats;
}

// Streaming level names a map loads (its part packages), as written in its name table.
function partNames(P, partFiles) {
  const wanted = new Set(partFiles.map((f) => f.replace(/\.upk$/i, '').toLowerCase()));
  return P.t.pkg.names.filter((n) => wanted.has(n.text.toLowerCase())).map((n) => n.text);
}

// A short file name for a built surroundings package, the same for the same merge.
function newFileName(seed, maxLen) {
  const hex = crypto.createHash('sha1').update(seed).digest('hex');
  return `BP${hex.slice(0, Math.max(4, Math.min(8, maxLen - 2)))}`;
}

module.exports = { open, repack, keepSide, levelActors, partNames, newFileName, isStadium, deflateChunk, tagged };
