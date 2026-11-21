// Arena maps. An arena is a "<Name>_P.upk" map file. Newer arenas are built from
// parts, each its own file, which the map loads by name:
//   <Name>_Field    the stadium itself (pitch, walls, goals, stands)
//   <Name>_OOB...   the surroundings outside the walls
//   <Name>_VFX/FX   weather and effects
// Because a part is loaded by file name, replacing one arena's part file with
// another arena's part is how a "merge" is done. Older arenas are a single file.
const fs = require('fs');
const path = require('path');
const upk = require('./upk');

// Internal name of the arena family -> the name players know. Only ones I am sure of.
const FRIENDLY = {
  stadium: 'DFH Stadium', eurostadium: 'Mannfield', park: 'Beckwith Park', utopiastadium: 'Utopia Coliseum',
  trainstation: 'Urban Central', wasteland: 'Wasteland', neotokyo: 'Neo Tokyo', underwater: 'AquaDome',
  farm: 'Farmstead', beach: 'Salty Shores', cs: 'Champions Field', chn_stadium: 'Forbidden Temple',
  fni_stadium: 'Forbidden Temple (Fire & Ice)', arc: 'Starbase ARC', music: 'Neon Fields', outlaw: 'Deadeye Canyon',
  throwbackstadium: 'Throwback Stadium', hoopsstadium: 'Dunk House', hoopsstreet: 'The Block',
};
const VARIANTS = { day: 'Day', night: 'Night', dusk: 'Dusk', dawn: 'Dawn', rainy: 'Rainy', snowy: 'Snowy', snow: 'Snowy', snownight: 'Snowy Night', winter: 'Snowy', foggy: 'Stormy', hw: 'Haunted', standard: 'Standard' };

// "CS_Day_P" -> "Champions Field (Day)"; unknown families keep their internal name.
function arenaName(base) {
  const stem = base.replace(/_P$/i, '');
  const lower = stem.toLowerCase();
  const family = Object.keys(FRIENDLY).filter((k) => lower === k || lower.startsWith(`${k}_`)).sort((a, b) => b.length - a.length)[0];
  if (!family) return stem.replace(/_/g, ' ');
  const rest = stem.slice(family.length).split('_').filter(Boolean).map((t) => VARIANTS[t.toLowerCase()] || t);
  return FRIENDLY[family] + (rest.length ? ` (${rest.join(' ')})` : '');
}

function partKind(partBase) {
  if (/_Field$/i.test(partBase)) return 'field';
  if (/_(VFX|FX|Effects)(_P)?$/i.test(partBase)) return 'effects';
  if (/_Lights?(_S)?$/i.test(partBase)) return 'lights';
  if (/_(SFX|Audio|Audio_Map)$/i.test(partBase)) return 'audio';
  return 'surroundings';
}

// Whole-arena snowy versions that ship with the game: the only places with falling snow.
const SNOWY_VERSIONS = { stadium: 'Stadium_Winter_P', park: 'Park_Snowy_P', eurostadium: 'EuroStadium_SnowNight_P', utopiastadium: 'UtopiaStadium_Snow_P' };

// Arenas that are not a normal soccar pitch: Rocket Labs, Hoops, Dropshot, Snow Day,
// Knockout, Quads, and soccar arenas with an unusual shape. They are never used for,
// or replaced by, "same arena every match".
const NOT_STANDARD = /^(labs_|hoops|shattershot|throwbackhockey|ko_|street_p$|wasteland_p$|wasteland_night_p$|neotokyo_p$|arc_p$)/i;

/**
 * Reads every arena and the part files it loads.
 * cache: { "<file>": { size, parts: [...] } }, updated in place (reading a map header is slow).
 * names: arena file (lower case) -> name the game shows, from the game's own text (labels.js).
 */
function scanArenas(cookedDir, cache = {}, extraKeys = [], names = new Map()) {
  const files = fs.readdirSync(cookedDir).filter((f) => /\.upk$/i.test(f) && !/_SF\.upk$/i.test(f));
  const byLower = new Map(files.map((f) => [f.replace(/\.upk$/i, '').toLowerCase(), f]));
  const isMap = (f) => /_P\.upk$/i.test(f) && !/^BG_|_Art_|_VFX_P|_OOB_P|MapImage/i.test(f);
  const arenas = [];
  for (const file of files.filter(isMap)) {
    const base = file.replace(/\.upk$/i, '');
    const size = fs.statSync(path.join(cookedDir, file)).size;
    let entry = cache[file];
    if (!entry || entry.size !== size) {
      let parts = [];
      try {
        // a part is another package this map names that belongs to the same arena family
        // ("Mall_Day_P" loads "Mall_Field") and is not an arena map itself
        const family = `${base.split('_')[0].toLowerCase()}_`;
        parts = [...new Set(upk.readNamesFile(path.join(cookedDir, file), extraKeys).map((n) => n.toLowerCase()))]
          .filter((n) => n !== base.toLowerCase() && n.startsWith(family) && byLower.has(n) && !isMap(byLower.get(n)))
          .map((n) => byLower.get(n));
      } catch { /* unreadable map: listed without parts */ }
      entry = cache[file] = { size, parts };
    }
    const parts = entry.parts.filter((p) => byLower.has(p.replace(/\.upk$/i, '').toLowerCase()))
      .map((p) => ({ file: p, kind: partKind(p.replace(/\.upk$/i, '')) }));
    const id = base.toLowerCase();
    arenas.push({
      id, file, size, name: names.get(id) || arenaName(base),
      playable: names.has(id), // the game lists it as an arena you can play
      standard: names.has(id) && !NOT_STANDARD.test(id),
      field: (parts.find((p) => p.kind === 'field') || {}).file || null, parts,
    });
  }
  // names the game gives several files are told apart by their file name
  const seen = new Map();
  for (const a of arenas) seen.set(a.name, (seen.get(a.name) || 0) + 1);
  for (const a of arenas) if (seen.get(a.name) > 1) a.name += ` · ${a.file.replace(/_P\.upk$/i, '').replace(/_/g, ' ')}`;
  arenas.sort((a, b) => (b.playable - a.playable) || a.name.localeCompare(b.name));
  return arenas;
}

// Which arenas show a changed game file: the arena itself, or every arena that loads that part.
function arenasUsing(arenas, gameFile) {
  const lower = gameFile.toLowerCase();
  return arenas.filter((a) => a.file.toLowerCase() === lower || a.parts.some((p) => p.file.toLowerCase() === lower));
}

// Parts that hold what lies outside the stadium walls, the main one first.
const OUTSIDE = /(OOB|Mountains|Buildings|Trees|DriftMtn|_Sky)/i;
function outsideParts(arena) {
  const main = (p) => (/_OOB(_P)?\.upk$/i.test(p.file) ? 0 : 1);
  return arena.parts.filter((p) => p.kind === 'surroundings' && OUTSIDE.test(p.file))
    .sort((a, b) => main(a) - main(b) || a.file.localeCompare(b.file));
}

/**
 * The stadium of `stadium` in the surroundings of `place`, strictly: nothing of the stadium
 * arena's outside shows, and nothing of the place arena's stadium. Built at the object level
 * (mapbuild.js): every piece of both maps is sorted into stadium or outside, and each side
 * keeps only its own.
 *
 * Two shapes, depending on which arena has part files to point elsewhere ("slots"):
 *   A  the stadium arena has parts. Place's main file becomes the stadium arena's map with
 *      its gameplay and only its stadium. Its outside parts (and, when more room is needed,
 *      its sound parts) are pointed at new files: place's map and outside parts with only
 *      their outside. A stadium-arena part that holds some of its stadium (Champions Field's
 *      upper ring is in CS_OOB2) keeps only that stadium; its stadium file loads as it is.
 *   B  the stadium arena is one file with no parts (Mannfield). Place's main file keeps its
 *      own gameplay and only its outside; its stadium file (or a sound part) is pointed at
 *      a new file: the stadium arena's map with only its stadium.
 * info (optional, from reading the maps): { stadiumRegion, placeRegion, free: Set of stadium-arena
 * part files that hold none of its stadium }. Without it, a best guess is planned for display.
 * Standard soccar arenas only: the pitch shape comes with the stadium.
 * Returns { how: 'build', ops, play, note } or { how: 'none', reason }.
 */
function mergePlan(stadium, place, all = [], info = null) {
  if (!stadium || !place) throw new Error('Arena not found');
  if (stadium.id === place.id) return { how: 'none', reason: 'Pick two different arenas.' };
  const odd = [stadium, place].filter((a) => !a.standard);
  if (odd.length) return { how: 'none', reason: `${odd.map((a) => a.name).join(' and ')} ${odd.length > 1 ? 'have' : 'has'} a pitch of another shape, so the walls and the ball would not line up.` };
  const label = `${stadium.name} stadium in ${place.name}`;
  const group = `merge:${stadium.id}:${place.id}`;
  const sRegion = (info && info.stadiumRegion) || null, pRegion = (info && info.placeRegion) || null;
  const base = { kind: 'build', category: 'map', group, label };
  const stadiumSide = (from, extra = {}) => ({ ...base, from, side: 'stadium', region: sRegion, clear: [], gameplay: false, ...extra });
  const outsideSide = (from, extra = {}) => ({ ...base, from, side: 'surroundings', region: pRegion, clear: sRegion || [], gameplay: false, ...extra });
  const name = (p) => p.file.replace(/\.upk$/i, '');
  const newFile = (i, slot) => `${mapbuildName(`${stadium.id}>${place.id}:${i}`, name(slot).length)}.upk`;
  const ops = [];
  const renames = {};
  let note = '';

  const sParts = stadium.parts.filter((p) => p.kind !== 'field' && p.kind !== 'lights');
  if (sParts.length) {
    // A: the stadium arena's map is the base
    // without reading the maps: a one-file arena's outside parts and any effects part hold none of its stadium
    const isFree = (p) => (info ? info.free.has(p.file.toLowerCase()) : !stadium.field || p.kind === 'effects');
    const outsideSlots = sParts.filter((p) => p.kind !== 'audio');
    const freeSlots = [...outsideSlots.filter(isFree), ...sParts.filter((p) => p.kind === 'audio')];
    // the place arena's outside, most first: a one-file arena keeps it in its main file, a newer one in its outside parts
    const outsideFiles = place.parts.filter((p) => p.kind === 'surroundings').map((p) => p.file);
    const partFiles = new Set(place.parts.map((p) => p.file));
    const sources = [...(place.field ? [...outsideFiles, place.file] : [place.file, ...outsideFiles]),
      ...place.parts.filter((p) => p.kind === 'effects').map((p) => p.file)];
    const assigned = new Map();
    freeSlots.forEach((slot, i) => { if (sources[i]) assigned.set(slot, sources[i]); });
    sParts.forEach((slot, i) => {
      const source = assigned.get(slot);
      if (!source && slot.kind === 'audio') return; // a sound part with nothing to put there stays
      const file = newFile(i, slot);
      renames[name(slot)] = file.replace(/\.upk$/i, '');
      // nothing of the stadium arena's outside may load: a part not used for the place's outside keeps only
      // its stadium, or loads nothing when it holds none of it
      ops.push(source ? outsideSide(source, { gameFile: file, create: true, part: partFiles.has(source) })
        : isFree(slot) ? stadiumSide(slot.file, { gameFile: file, create: true, side: 'empty' })
          : stadiumSide(slot.file, { gameFile: file, create: true, part: true }));
    });
    const missing = sources.length - assigned.size;
    if (!assigned.size) return { how: 'none', reason: `${stadium.name} has no part file the outside of ${place.name} can be loaded in.` };
    ops.push(stadiumSide(stadium.file, { gameFile: place.file, gameplay: true, renames }));
    const quiet = [...assigned.keys()].filter((s) => s.kind === 'audio');
    note = [quiet.length ? `${stadium.name}’s background sounds make room for it, so they are quiet.` : '',
      missing > 0 ? `${missing === 1 ? 'One part' : `${missing} parts`} of ${place.name}’s surroundings did not fit and are left out.` : ''].filter(Boolean).join(' ');
  } else {
    // B: the place arena's map is the base, keeping only its outside
    const pParts = place.parts.filter((p) => p.kind !== 'lights');
    const slot = pParts.find((p) => p.kind === 'field') || pParts.find((p) => p.kind === 'audio') || pParts.find((p) => p.kind === 'effects');
    if (!slot) return { how: 'none', reason: `${stadium.name} and ${place.name} are each one file with no parts, so there is nowhere to load one into the other.` };
    pParts.forEach((p, i) => {
      if (p.kind === 'audio' && p !== slot) return;
      const file = newFile(i, p);
      renames[name(p)] = file.replace(/\.upk$/i, '');
      ops.push(p === slot ? stadiumSide(stadium.file, { gameFile: file, create: true })
        : outsideSide(p.file, { gameFile: file, create: true, part: true }));
    });
    ops.push(outsideSide(place.file, { gameFile: place.file, gameplay: true, renames }));
    if (slot.kind === 'audio') note = `${place.name}’s background sounds make room for it, so they are quiet.`;
  }
  return { how: 'build', ops, play: [place], note, files: ops.length };
}
// A short file name for a built part, the same every time for the same merge.
function mapbuildName(seed, maxLen) {
  const hex = require('crypto').createHash('sha1').update(seed).digest('hex');
  return `BP${hex.slice(0, Math.max(4, Math.min(8, maxLen - 2)))}`;
}
// What mergePlan needs to know about the stadium arena's parts and both stadiums, read from
// the maps. open(file) returns an opened package (mapbuild.open) or null.
function mergeInfo(stadium, place, open, mapbuild) {
  const holders = (a) => [a.file, a.field, ...a.parts.filter((p) => p.kind === 'surroundings').map((p) => p.file)].filter(Boolean);
  const region = (a) => mapbuild.arenaRegion(holders(a).map(open).filter(Boolean));
  const stadiumRegion = region(stadium), placeRegion = region(place);
  const free = new Set();
  for (const p of stadium.parts.filter((x) => x.kind === 'surroundings' || x.kind === 'effects')) {
    const pkg = open(p.file);
    if (pkg && mapbuild.stadiumPieces(pkg, stadiumRegion) === 0) free.add(p.file.toLowerCase());
  }
  return { stadiumRegion, placeRegion, free };
}
/* ---------- merged arenas ----------
 * `changes` is what Boostpad has changed in the game folder: game file (lower case) -> op.
 * Merges and snow are copies, so they can be followed back to the file that is really loaded. */

const isMerge = (op) => op && / stadium in /.test(op.label || '') && op.group !== 'everymatch';

// The arena whose files are really loaded when `arena` is played: a whole-arena merge
// (or a snowy version) makes its main file a copy of another arena's.
function effectiveArena(arena, arenas, changes) {
  let a = arena;
  for (let i = 0; i < 5; i++) {
    const op = changes.get(a.file.toLowerCase());
    const src = op && op.kind === 'copy' && op.group !== 'everymatch' && arenas.find((x) => x.file.toLowerCase() === op.sourceGameFile.toLowerCase());
    if (!src) break;
    a = src;
  }
  return a;
}

// Arenas that look different because of a merge, each under the name of that merge.
function mergedArenas(arenas, changes) {
  const out = new Map();
  for (const op of changes.values()) {
    if (!isMerge(op)) continue;
    for (const a of arenasUsing(arenas, op.gameFile)) if (a.standard && !out.has(a.id)) out.set(a.id, { arena: a, label: op.label.replace(/, snowy$/, ''), group: op.group || null });
  }
  return [...out.values()];
}

// "Same arena every match": every standard arena file becomes a copy of what `chosen`
// really loads (for a whole-arena merge, the arena merged in). Whatever arena the game
// picks, it loads that. The pitch is the same size in all standard arenas, so the ball and
// walls still line up. Arena files you changed yourself (a merge, snow) are left as they are.
function everyMatchOps(chosen, arenas, changes = new Map(), label = chosen.name) {
  if (!chosen.standard) throw new Error('Pick a standard soccar arena');
  const source = effectiveArena(chosen, arenas, changes).file;
  const own = (a) => { const op = changes.get(a.file.toLowerCase()); return op && op.group !== 'everymatch'; };
  // a built merge is built again in each arena's place (its added files are shared); a copy of the
  // original main file would lose it
  const built = changes.get(chosen.file.toLowerCase());
  const make = built && built.kind === 'build' && built.group !== 'everymatch'
    ? (a) => ({ kind: 'build', gameFile: a.file, from: built.from, side: built.side, renames: built.renames, region: built.region, clear: built.clear, gameplay: built.gameplay })
    : (a) => ({ kind: 'copy', gameFile: a.file, sourceGameFile: source });
  return arenas.filter((a) => a.standard && a.id !== chosen.id && a.file.toLowerCase() !== source.toLowerCase() && !own(a)).map((a) => ({
    ...make(a), category: 'map', group: 'everymatch', chosen: chosen.id, label: `${label} in place of ${a.name}`,
  }));
}

/**
 * Snow for an arena, merged or not. Falling snow only exists inside the game's four snowy
 * arenas (there is no separate snow file: Forbidden Temple (Fire & Ice)'s effects file is
 * its fire dragon, checked in game), so snow means playing the snowy version of the arena.
 * Works on what the arena really loads: a whole-arena merge of DFH Stadium becomes the
 * snowy DFH Stadium and stays a merge. A stadium or surroundings merge cannot get snow,
 * because the snowy version would replace the files that make the merge.
 * Returns { how: 'version', op, play } or null.
 */
function snowPlan(arena, arenas, changes = new Map()) {
  const merge = mergedArenas(arenas, changes).find((m) => m.arena.id === arena.id);
  const eff = effectiveArena(arena, arenas, changes);
  if (merge && eff.id === arena.id) return null;
  const stem = eff.file.replace(/_P\.upk$/i, '').toLowerCase();
  const family = Object.keys(SNOWY_VERSIONS).find((k) => stem === k || stem.startsWith(`${k}_`));
  const snowy = family && arenas.find((a) => a.file.toLowerCase() === `${SNOWY_VERSIONS[family].toLowerCase()}.upk`);
  if (!snowy || snowy.id === eff.id) return null; // no snowy version, or already it
  const op = { kind: 'copy', gameFile: arena.file, sourceGameFile: snowy.file, category: 'map', label: `Snow on ${arena.name}` };
  if (merge) Object.assign(op, { group: merge.group, label: `${merge.label}, snowy` }); // stays part of its merge
  return { how: 'version', op, play: [arena], snowy: snowy.name };
}

module.exports = { scanArenas, arenaName, partKind, mergePlan, mergeInfo, outsideParts, arenasUsing, everyMatchOps, effectiveArena, mergedArenas, snowPlan };
