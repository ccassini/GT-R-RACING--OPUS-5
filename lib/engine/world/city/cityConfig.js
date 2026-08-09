// ═══════════════════════════════════════════════════════
//  OPEN WORLD — the constants that define one metropolis
//
//  MARMARA is 72 km square: 5,184 km² of drivable ground, which is
//  İstanbul's footprint to within four percent. None of it is stored.
//  Every metre of road, every building and every hillside is a pure
//  function of (seed, x, z) evaluated when the player gets close
//  enough to see it, and thrown away when they leave.
//
//  This module is data only — no Three.js, no DOM, no randomness that
//  is not seeded. UI code can import it to print district names without
//  pulling the renderer into the bundle.
// ═══════════════════════════════════════════════════════

/** Half-extent in metres. The world spans [-HALF, HALF] on both axes. */
export const WORLD_HALF = 36000;
export const WORLD_SIZE = WORLD_HALF * 2;

/** Streaming granularity. One chunk is one build job and one dispose. */
export const CHUNK = 512;

/**
 * The road armature, coarsest first. Each tier is a whole multiple of
 * the next so the lattices nest exactly and never produce slivers.
 */
export const MOTORWAY_GRID = 4096;
export const SUPERBLOCK = 2048;

/**
 * Road widths, in metres. `halfWidth` is the carriageway, kerb to kerb;
 * `pavement` is the footway either side, which is the KERB surface the
 * car can put two wheels on before it is properly off the road.
 *
 * The footways are generous on purpose. They are drawn as part of the
 * road ribbon, and every metre of them is a metre that does not have to
 * be covered by the low-polygon ground mesh — which cannot resolve a
 * three-metre strip and leaves a dark trench along the kerb when asked.
 */
export const ROADS = {
  motorway: { halfWidth: 13, pavement: 2.6, lanes: 6, priority: 3 },
  boulevard: { halfWidth: 8.5, pavement: 4, lanes: 4, priority: 2 },
  street: { halfWidth: 5, pavement: 3, lanes: 2, priority: 1 },
};

/** Sea level. Everything else is measured from it. */
export const SEA_LEVEL = 0;
export const SEABED = -18;

// ── Geography ──────────────────────────────────────────
// The strait is the spine of the map: it splits the city into two
// shores, forces every long journey through one of three bridges, and
// gives the skyline something to stand behind.

export const STRAIT = {
  /** Centreline of the channel as a function of z. */
  baseX: -1400,
  swing: [
    { amplitude: 2600, wavelength: 27000, phase: 0 },
    { amplitude: 900, wavelength: 10400, phase: 1.4 },
    { amplitude: 320, wavelength: 3900, phase: 2.7 },
  ],
  /** Half-width of the water, also modulated along its length. */
  baseHalf: 560,
  halfSwing: [
    { amplitude: 250, wavelength: 16000, phase: 0.7 },
    { amplitude: 110, wavelength: 6100, phase: 2.1 },
  ],
  /** North of this the channel opens into the northern sea. */
  northMouth: -29000,
  /** South of this it opens into the southern sea. */
  southMouth: 11000,
};

/** A drowned river valley branching west off the strait — the horn. */
export const INLET = {
  z: 4200,
  half: 240,
  reach: 7600,
  /** Metres of westward run before the inlet tapers to nothing. */
  taper: 2200,
};

export const COASTS = {
  /** Water where z is greater than this. */
  south: { base: 12800, amplitude: 2100, wavelength: 15000 },
  /** Water where z is less than this. */
  north: { base: -30500, amplitude: 1500, wavelength: 12000 },
};

/**
 * Suspension bridges. Each carries one east-west motorway line, so the
 * z values are multiples of MOTORWAY_GRID by construction — a bridge
 * that did not land on a motorway would be a bridge to nowhere.
 */
export const BRIDGES = [
  {
    id: 'star',
    name: 'STAR BRIDGE',
    label: 'STAR BRIDGE',
    z: -MOTORWAY_GRID * 4,
    deckHeight: 62,
    towerHeight: 168,
    /** Metres of approach viaduct either side of the water. */
    approach: 620,
  },
  {
    id: 'golden',
    name: 'GOLDEN BRIDGE',
    label: 'GOLDEN BRIDGE',
    z: -MOTORWAY_GRID,
    deckHeight: 58,
    towerHeight: 152,
    approach: 560,
  },
  {
    id: 'iron',
    name: 'IRON BRIDGE',
    label: 'IRON BRIDGE',
    z: MOTORWAY_GRID * 2,
    deckHeight: 54,
    towerHeight: 138,
    approach: 520,
  },
];

// ── Districts ──────────────────────────────────────────
// A district decides three things: how tightly the local streets are
// spaced, how tall the buildings get, and what colour the place is.
// Everything else about the city falls out of those three.

export const DISTRICTS = {
  core: {
    id: 'core',
    name: 'GOLDCREST',
    label: 'FINANCIAL CORE',
    streetSpacing: 132,
    /** Target footprint of one building, in metres. A block is filled
     *  with as many of these as fit — which is what separates a works
     *  district of vast sheds from a quarter of narrow shopfronts. */
    lotSize: 36,
    coverage: 0.86,
    height: [46, 205],
    /** Chance a lot holds one big tower instead of several smaller ones. */
    monolith: 0.62,
    // Not all glass. A financial core built entirely from blue curtain
    // wall is a blue box from every angle; the stone and pale concrete
    // in here are what give the skyline any tonal range at all.
    wall: [0x9aa4ae, 0x8b95a2, 0xb4b6b4, 0x7e8894, 0xada79b, 0xc0bcb0],
    roof: [0x53596a, 0x454b5b, 0x5f6470],
    ground: 0x5f6169,
    trees: 0.06,
  },
  midrise: {
    id: 'midrise',
    name: 'NEWMARKET',
    label: 'CENTRAL DISTRICTS',
    streetSpacing: 98,
    lotSize: 32,
    coverage: 0.8,
    height: [17, 52],
    monolith: 0.22,
    wall: [0xc8bda8, 0xb5a993, 0xd6cbb6, 0xa89d88, 0xc0b49e],
    roof: [0x6b5f52, 0x5c5145, 0x776a5c],
    ground: 0x555149,
    trees: 0.18,
  },
  residential: {
    id: 'residential',
    name: 'NORTHGATE',
    label: 'RESIDENTIAL',
    streetSpacing: 76,
    lotSize: 24,
    coverage: 0.74,
    height: [9, 27],
    monolith: 0.06,
    wall: [0xd9cdb4, 0xcbbfa4, 0xe3d9c4, 0xbfb298, 0xd2c4aa],
    roof: [0xa8553c, 0x8f4735, 0xb86444, 0x7d5a45],
    ground: 0x5b5747,
    trees: 0.36,
  },
  oldtown: {
    id: 'oldtown',
    name: 'OLDCASTLE',
    label: 'OLD QUARTER',
    streetSpacing: 54,
    lotSize: 17,
    coverage: 0.88,
    height: [7, 18],
    monolith: 0.02,
    wall: [0xe0d3b8, 0xd2c3a4, 0xecdfc6, 0xc7b795],
    roof: [0xb05a3a, 0x9c4d31, 0xc2694a],
    ground: 0x635c48,
    trees: 0.14,
  },
  industrial: {
    id: 'industrial',
    name: 'IRONWORKS',
    label: 'PORT AND WORKS',
    streetSpacing: 172,
    lotSize: 74,
    coverage: 0.86,
    height: [8, 17],
    monolith: 0.34,
    wall: [0x8d8f8a, 0x9b9d96, 0x7c7e7a, 0xa6a49a],
    roof: [0x6d7076, 0x5f6268, 0x797c82],
    ground: 0x4f4d45,
    trees: 0.03,
  },
  waterfront: {
    id: 'waterfront',
    name: 'BLUE HARBOUR',
    label: 'WATERFRONT',
    streetSpacing: 112,
    lotSize: 30,
    coverage: 0.66,
    height: [11, 34],
    monolith: 0.18,
    wall: [0xe8e0d0, 0xdad1c0, 0xf1ebdd, 0xcfc5b2],
    roof: [0x4f6e7d, 0x456170, 0x5b7d8c],
    ground: 0x6a6350,
    trees: 0.3,
  },
  suburb: {
    id: 'suburb',
    name: 'PINE RIDGE',
    label: 'HILLSIDE',
    streetSpacing: 88,
    lotSize: 21,
    coverage: 0.72,
    height: [6, 14],
    monolith: 0.02,
    wall: [0xe4dcc8, 0xd8cfb9, 0xefe8d8, 0xccc2ac],
    roof: [0xa85f42, 0x94533a, 0xb96f50],
    ground: 0x55603f,
    trees: 0.62,
  },
  park: {
    id: 'park',
    name: 'GREENHILL',
    label: 'PARKLAND',
    streetSpacing: 0,
    lotSize: 0,
    coverage: 0,
    height: [0, 0],
    monolith: 0,
    wall: [0xd8d0bc],
    roof: [0x7a6a55],
    ground: 0x3f6031,
    trees: 1,
  },
  water: {
    id: 'water',
    name: 'THE STRAIT',
    label: 'THE STRAIT',
    streetSpacing: 0,
    lotSize: 0,
    coverage: 0,
    height: [0, 0],
    monolith: 0,
    wall: [0x8fa2b8],
    roof: [0x4a5566],
    ground: 0x1f5670,
    trees: 0,
  },
};

/**
 * The two downtowns, one on each shore, plus the secondary centres that
 * stop the map reading as one blob with suburbs around it.
 */
export const CENTRES = [
  { x: -5200, z: -2400, weight: 1.0, radius: 4200 },
  { x: 4600, z: 1200, weight: 0.94, radius: 3800 },
  { x: -13500, z: -12000, weight: 0.66, radius: 3000 },
  { x: 12800, z: -9800, weight: 0.62, radius: 2800 },
  { x: -2200, z: 14500, weight: 0.55, radius: 2600 },
  { x: 17500, z: 8200, weight: 0.5, radius: 2400 },
  { x: -20000, z: 6500, weight: 0.48, radius: 2500 },
];

/**
 * Places worth driving to. These seed the spawn menu and the labels on
 * the world map, and each one pins a district so the generator cannot
 * quietly turn the old quarter into a business park.
 */
export const PLACES = [
  {
    id: 'goldcrest',
    name: 'GOLDCREST',
    label: 'FINANCIAL CORE · WEST SHORE',
    blurb: 'Glass towers packed onto a headland. Wide boulevards, tight blocks, no daylight at street level.',
    x: -5200,
    z: -2400,
    intensity: 1,
    district: 'core',
    radius: 2600,
  },
  {
    id: 'oldcastle',
    name: 'OLDCASTLE',
    label: 'OLD QUARTER · THE PENINSULA',
    blurb: 'Fifty-metre blocks and lanes barely wider than the car. The oldest street pattern on the map.',
    x: -3400,
    z: 6900,
    intensity: 0.72,
    district: 'oldtown',
    radius: 2300,
  },
  {
    id: 'blueharbour',
    name: 'BLUE HARBOUR',
    label: 'WATERFRONT · EAST SHORE',
    blurb: 'A promenade running the length of the strait, with all three bridges in view.',
    x: 3200,
    z: 3400,
    intensity: 0.62,
    district: 'waterfront',
    radius: 2200,
  },
  {
    id: 'ironworks',
    name: 'IRONWORKS',
    label: 'PORT AND WORKS · SOUTH',
    blurb: 'Container cranes, long empty straights between the sheds, and nobody to get in the way.',
    x: 9400,
    z: 11200,
    intensity: 0.5,
    district: 'industrial',
    radius: 2600,
  },
  {
    id: 'pineridge',
    name: 'PINE RIDGE',
    label: 'HILLSIDE · NORTH EAST',
    blurb: 'The steepest ground in the city. Every crest shows you the whole skyline before it drops away again.',
    x: 14200,
    z: -14800,
    intensity: 0.34,
    district: 'suburb',
    radius: 2800,
  },
  {
    id: 'starbridge',
    name: 'STAR BRIDGE',
    label: 'NORTH CROSSING',
    blurb: 'Sixty metres of air over the strait, and the longest flat-out run in the world.',
    x: null,
    z: -MOTORWAY_GRID * 4,
    intensity: 0.5,
    district: 'core',
    radius: 900,
    bridgeId: 'star',
  },
];

/** Landmark structures placed by hand, in world metres. */
export const LANDMARKS = [
  { id: 'tower', kind: 'tower', name: 'MARMARA TOWER', x: 8600, z: -6200, height: 268 },
  { id: 'arena', kind: 'stadium', name: 'ARENA', x: -11200, z: 3600, radius: 190 },
  { id: 'port', kind: 'port', name: 'THE DOCKS', x: 10200, z: 12600, radius: 620 },
  { id: 'mosque', kind: 'mosque', name: 'GRAND MOSQUE', x: -3400, z: 6900, radius: 120 },
];

export const getPlaceById = (id) => PLACES.find((place) => place.id === id) ?? PLACES[0];
export const getBridgeById = (id) => BRIDGES.find((bridge) => bridge.id === id) ?? null;

/** Chunk coordinate helpers. Floor division, so negatives behave. */
export const chunkOf = (v) => Math.floor(v / CHUNK);
export const chunkKey = (cx, cz) => `${cx},${cz}`;

/** Deterministic 32-bit hash of two integers plus a seed. */
export function hash2i(ix, iy, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The same hash, mapped to [0, 1). */
export const hash2f = (ix, iy, seed) => hash2i(ix, iy, seed) / 4294967296;
