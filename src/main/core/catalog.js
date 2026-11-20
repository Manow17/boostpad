// Builds the item catalog from the game's own files. Nothing is bundled: every
// item listed is a package that exists in the user's install.
const fs = require('fs');

// file-name prefix -> category
const PREFIXES = {
  body: 'cars',
  wheel: 'wheels',
  boost: 'boosts',
  skin: 'decals',
  hat: 'toppers',
  antenna: 'antennas', flag: 'antennas', countryflag: 'antennas', streamerflag: 'antennas',
  tourneyflag: 'antennas', pennant: 'antennas',
  engineaudio: 'engines',
  ss: 'trails',
  explosion: 'explosions',
  paintfinish: 'finishes',
  playerbanner: 'banners',
  avatarborder: 'borders',
  anthem: 'anthems',
};

const CATEGORIES = [
  { id: 'cars', label: 'Cars' },
  { id: 'wheels', label: 'Wheels' },
  { id: 'boosts', label: 'Boosts' },
  { id: 'decals', label: 'Decals' },
  { id: 'toppers', label: 'Toppers' },
  { id: 'antennas', label: 'Antennas' },
  { id: 'engines', label: 'Engine Sounds' },
  { id: 'trails', label: 'Trails' },
  { id: 'explosions', label: 'Goal Explosions' },
  { id: 'finishes', label: 'Paint Finishes' },
  { id: 'banners', label: 'Player Banners' },
  { id: 'borders', label: 'Avatar Borders' },
  { id: 'anthems', label: 'Player Anthems' },
];

// "AlphaReward" -> "Alpha Reward", "star_holo" -> "Star Holo"
function prettify(raw) {
  return raw
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function buildCatalog(cookedDir) {
  const files = fs.readdirSync(cookedDir);
  const lower = new Set(files.map((f) => f.toLowerCase()));
  const items = [];
  for (const file of files) {
    const m = /^([A-Za-z]+)_(.+)_SF\.upk$/i.exec(file);
    if (!m || /_T$/i.test(m[2])) continue; // "_T_SF" packages are thumbnails
    const category = PREFIXES[m[1].toLowerCase()];
    if (!category) continue;
    items.push({
      id: file.toLowerCase(),
      file,
      category,
      name: prettify(m[2]),
      hasThumb: lower.has(`${m[1]}_${m[2]}_t_sf.upk`.toLowerCase()),
    });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return { categories: CATEGORIES, items, fileCount: files.length };
}

module.exports = { CATEGORIES, buildCatalog, prettify };
