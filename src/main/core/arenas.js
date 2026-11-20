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

// Whole-arena snowy versions that ship with the game, and the one stand-alone snow effects part.
const SNOWY_VERSIONS = { stadium: 'Stadium_Winter_P', park: 'Park_Snowy_P', eurostadium: 'EuroStadium_SnowNight_P', utopiastadium: 'UtopiaStadium_Snow_P' };
const SNOW_EFFECTS = 'FNI_Stadium_VFX';

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
    const stem = base.replace(/_P$/i, '').toLowerCase();
    const family = Object.keys(SNOWY_VERSIONS).find((k) => stem === k || stem.startsWith(`${k}_`));
    const snowyFile = family && byLower.get(SNOWY_VERSIONS[family].toLowerCase());
    const effects = parts.find((p) => p.kind === 'effects' && /_VFX\.upk$/i.test(p.file));
    const snowFx = byLower.get(SNOW_EFFECTS.toLowerCase());
    let snow = null;
    if (snowyFile && snowyFile !== file) snow = { how: 'version', gameFile: file, sourceGameFile: snowyFile };
    else if (effects && snowFx && effects.file !== snowFx) snow = { how: 'effects', gameFile: effects.file, sourceGameFile: snowFx };
    const id = base.toLowerCase();
    arenas.push({
      id, file, size, name: names.get(id) || arenaName(base),
      playable: names.has(id), // the game lists it as an arena you can play
      standard: names.has(id) && !NOT_STANDARD.test(id),
      field: (parts.find((p) => p.kind === 'field') || {}).file || null, parts, snow,
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

// "Same arena every match": every standard arena file becomes a copy of `chosen`.
// Whatever arena the game picks, it loads the chosen one. The pitch is the same size
// in all standard arenas, so the ball and walls still line up.
function everyMatchOps(chosen, arenas) {
  if (!chosen.standard) throw new Error('Pick a standard soccar arena');
  return arenas.filter((a) => a.standard && a.id !== chosen.id).map((a) => ({
    kind: 'copy', gameFile: a.file, sourceGameFile: chosen.file, category: 'map', group: 'everymatch', label: `${chosen.name} in place of ${a.name}`,
  }));
}

// Parts that hold what lies outside the stadium walls, the main one first.
const OUTSIDE = /(OOB|Mountains|Buildings|Trees|DriftMtn|_Sky)/i;
function outsideParts(arena) {
  const main = (p) => (/_OOB(_P)?\.upk$/i.test(p.file) ? 0 : 1);
  return arena.parts.filter((p) => p.kind === 'surroundings' && OUTSIDE.test(p.file))
    .sort((a, b) => main(a) - main(b) || a.file.localeCompare(b.file));
}

/**
 * How to show the stadium of `stadium` in the surroundings of `place`. Three ways,
 * the first that fits:
 *   stadium       both have a separate stadium part: place's becomes a copy of stadium's.
 *                 Play `place`.
 *   surroundings  `stadium` is one main file plus separate surroundings parts, and place
 *                 has surroundings parts: stadium's become copies of place's. Play `stadium`.
 *   whole         they cannot be taken apart, so the whole of `stadium` is played in
 *                 place of `place`.
 * Standard soccar arenas only: the pitch shape comes with the stadium.
 * Returns { how, ops, play: [arenas to play to see it], note } or { how: 'none', reason }.
 */
function mergePlan(stadium, place, all = []) {
  if (!stadium || !place) throw new Error('Arena not found');
  if (stadium.id === place.id) return { how: 'none', reason: 'Pick two different arenas.' };
  // the pitch shape comes with the stadium; only standard soccar pitches are the same everywhere
  const odd = [stadium, place].filter((a) => !a.standard);
  if (odd.length) return { how: 'none', reason: `${odd.map((a) => a.name).join(' and ')} ${odd.length > 1 ? 'have' : 'has'} a pitch of another shape, so the walls and the ball would not line up.` };
  const label = `${stadium.name} stadium in ${place.name}`;
  const group = `merge:${stadium.id}:${place.id}`;
  const copy = (gameFile, sourceGameFile) => ({ kind: 'copy', gameFile, sourceGameFile, category: 'map', group, label });
  if (stadium.field && place.field) {
    return { how: 'stadium', ops: [copy(place.field, stadium.field)], play: arenasUsing(all, place.field) };
  }
  // Only for a stadium arena without a separate stadium part: its stands are in its main
  // file and stay. Arenas with one keep part of the stands in their outside files
  // (Champions Field's upper ring is in CS_OOB2), so swapping those leaves the crowd in the air.
  const mine = stadium.field ? [] : outsideParts(stadium), theirs = outsideParts(place);
  if (mine.length && theirs.length) {
    // more parts than the other arena has: the extra ones get its parts again, so none of the old surroundings stay
    const ops = mine.map((p, i) => copy(p.file, theirs[i % theirs.length].file))
      .filter((op) => op.gameFile.toLowerCase() !== op.sourceGameFile.toLowerCase());
    const play = arenasUsing(all, mine[0].file);
    // no ops: the two already share their surroundings, so only a whole swap changes anything
    if (ops.length) {
      return { how: 'surroundings', ops, play, note: play.length > 1 ? 'Those arenas share these surroundings, so all of them change.' : '' };
    }
  }
  return { how: 'whole', ops: [copy(place.file, stadium.file)], play: [place] };
}
function snowOp(arena) {
  if (!arena.snow) throw new Error('This arena has no part where snow can go');
  return { kind: 'copy', gameFile: arena.snow.gameFile, sourceGameFile: arena.snow.sourceGameFile, category: 'map', label: `Snow on ${arena.name}` };
}

module.exports = { scanArenas, arenaName, partKind, mergePlan, outsideParts, snowOp, arenasUsing, everyMatchOps };
