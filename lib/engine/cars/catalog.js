// ═══════════════════════════════════════════════════════
//  CAR CATALOGUE — six original performance machines
//
//  Each entry is a fictional widebody race car with its own
//  silhouette language. Names and makers are invented; the
//  visual cues borrow only broad family traits (German muscle,
//  Italian exotic, Japanese power, tech coupe, endurance GT).
//
//  `stats` drive both garage bars and physics multipliers.
//  `shape` + `design` drive the procedural body in model.js.
// ═══════════════════════════════════════════════════════

/**
 * Derive physics multipliers from the displayed 0-100 stats.
 * The spread is deliberately wide: a GT4 should be visibly slower down
 * a straight than a GTE, or the garage numbers are decoration.
 */
export function statsToPhysics(stats) {
  return {
    speed: 0.34 + (stats.topSpeed / 100) * 0.88,
    accel: 0.55 + (stats.accel / 100) * 0.9,
    grip: 0.7 + (stats.grip / 100) * 0.58,
    turn: 0.72 + (stats.handling / 100) * 0.54,
    /** Low-grip cars rotate more freely and bank boost faster. */
    drift: 1.42 - (stats.grip / 100) * 0.68,
    mass: 0.8 + (stats.topSpeed / 100) * 0.5 - (stats.handling / 100) * 0.22,
  };
}

const PALETTE = {
  coral: { base: 0xe63a20, accent: 0x18324f, trim: 0xf4efe5 },
  amber: { base: 0xf5a213, accent: 0x1a1a1f, trim: 0xf4efe5 },
  mint: { base: 0x27d39a, accent: 0x123b30, trim: 0xf4efe5 },
  violet: { base: 0x6a3ad4, accent: 0x14101f, trim: 0xd9d1f5 },
  ice: { base: 0xeef1f5, accent: 0x1d4ed8, trim: 0x11151c },
  cobalt: { base: 0x1f6fe0, accent: 0xeef1f5, trim: 0x0d1a2b },
  sand: { base: 0xd8c48a, accent: 0x2f2a22, trim: 0xf4efe5 },
  crimson: { base: 0x9c1128, accent: 0xf0d68a, trim: 0xf4efe5 },
  forest: { base: 0x18624a, accent: 0xf0b429, trim: 0xf4efe5 },
  slate: { base: 0x3d4756, accent: 0xff6b35, trim: 0xe8eaee },
  bone: { base: 0xece5d5, accent: 0xc0392b, trim: 0x22262e },
  ink: { base: 0x14171d, accent: 0x35e0a1, trim: 0xf4efe5 },
};

const paints = (...names) => names.map((n) => ({ id: n, ...PALETTE[n] }));

/**
 * Aero packages by class. Wing size, canards and splitter depth
 * are the camera-readable signals of how serious a car looks.
 */
export const AERO = {
  gt4: { wingWidth: 0.82, wingChord: 0.34, wingHeight: 0.34, canards: 0, splitter: 0.16, swanNeck: false },
  gt3: { wingWidth: 0.94, wingChord: 0.46, wingHeight: 0.56, canards: 1, splitter: 0.26, swanNeck: true },
  gt3evo: { wingWidth: 0.97, wingChord: 0.50, wingHeight: 0.62, canards: 2, splitter: 0.30, swanNeck: true },
  gt2: { wingWidth: 1.0, wingChord: 0.56, wingHeight: 0.70, canards: 2, splitter: 0.32, swanNeck: true },
  gte: { wingWidth: 1.0, wingChord: 0.58, wingHeight: 0.66, canards: 2, splitter: 0.38, swanNeck: true },
};

export const CARS = [
  {
    id: 'comet',
    name: 'COMET GT-R',
    maker: 'ASTRA MOTORS',
    class: 'GT3',
    number: 7,
    voice: 'v12',
    aero: 'gt3',
    blurb: 'Aggressive German performance coupe. Long bonnet, twin-kidney intakes and L-blade lamps — the benchmark lap time.',
    stats: { topSpeed: 90, accel: 70, grip: 76, handling: 74 },
    livery: 'stripe',
    design: { profile: 'german-muscle', silhouette: 'long-hood-gt', fascia: 'twin-cooling-frame', cooling: 'outer-brake-ducts', sideDetail: 'haunch-vent', tail: 'l-notches', headlight: 'angel-blade', wheel: 'turbine-centerlock', aero: 'touring-deck' },
    paints: paints('coral', 'ice', 'forest', 'ink'),
    shape: {
      length: 4.78, width: 2.04, height: 0.72,
      noseWidth: 0.58, frontArch: 0.97, waist: 0.84, rearArch: 1.0, tailWidth: 0.86,
      cabinCenter: -0.16, cabinLength: 0.38, cabinWidth: 0.70, cabinHeight: 0.48,
      wheelbase: 2.78, trackWidth: 1.84, wheelRadius: 0.41, wheelWidth: 0.36,
      rideHeight: 0.19,
    },
  },
  {
    id: 'vulcan',
    name: 'VULCAN GT-R',
    maker: 'BRAND HEAVY',
    class: 'GT2',
    number: 44,
    voice: 'v12',
    aero: 'gt2',
    blurb: 'Sharp mid-engine exotic. Hexagon intakes, knife-edge nose and Y-hex lamps — nothing on the grid looks like this.',
    stats: { topSpeed: 118, accel: 86, grip: 50, handling: 54 },
    livery: 'arrow',
    design: { profile: 'mid-wedge', silhouette: 'cab-forward-wedge', fascia: 'knife-nose', cooling: 'deep-side-scoop', sideDetail: 'flying-buttress', tail: 'hex-lamps', headlight: 'y-cluster', wheel: 'blade-centerlock', aero: 'high-diffuser' },
    paints: paints('amber', 'crimson', 'slate', 'ink'),
    shape: {
      length: 4.62, width: 2.16, height: 0.58,
      noseWidth: 0.42, frontArch: 0.94, waist: 0.78, rearArch: 1.0, tailWidth: 0.72,
      cabinCenter: -0.28, cabinLength: 0.32, cabinWidth: 0.62, cabinHeight: 0.38,
      wheelbase: 2.70, trackWidth: 1.96, wheelRadius: 0.42, wheelWidth: 0.44,
      rideHeight: 0.15,
    },
  },
  {
    id: 'sable',
    name: 'SABLE GT-R',
    maker: 'SABLE RACING',
    class: 'GTE',
    number: 9,
    voice: 'v12',
    aero: 'gte',
    blurb: 'Sculpted Italian fastback. Oval grille, flowing haunches and twin oval lamps — elegance at terminal velocity.',
    stats: { topSpeed: 125, accel: 74, grip: 84, handling: 64 },
    livery: 'gradient',
    design: { profile: 'italian-fastback', silhouette: 'teardrop-fastback', fascia: 'low-oval-intake', cooling: 'sculpted-gills', sideDetail: 'fender-cut', tail: 'twin-oval', headlight: 'teardrop', wheel: 'five-star-centerlock', aero: 'flowing-foil' },
    paints: paints('crimson', 'ice', 'cobalt', 'forest'),
    shape: {
      length: 4.96, width: 2.08, height: 0.62,
      noseWidth: 0.66, frontArch: 0.98, waist: 0.80, rearArch: 1.0, tailWidth: 0.84,
      cabinCenter: -0.10, cabinLength: 0.36, cabinWidth: 0.66, cabinHeight: 0.40,
      wheelbase: 2.88, trackWidth: 1.88, wheelRadius: 0.42, wheelWidth: 0.40,
      rideHeight: 0.16,
    },
  },
  {
    id: 'bolt',
    name: 'BOLT GT-R',
    maker: 'VOLTA',
    class: 'GT ELECTRIC',
    number: 88,
    voice: 'ev',
    aero: 'gt3',
    blurb: 'Modern tech performance coupe. Single-frame grille, razor LED strips and a sealed aero channel — precision over drama.',
    stats: { topSpeed: 83, accel: 100, grip: 80, handling: 82 },
    livery: 'edge',
    design: { profile: 'tech-coupe', silhouette: 'monolithic-fastback', fascia: 'sealed-frame', cooling: 'lower-aero-channel', sideDetail: 'aero-channel', tail: 'pixel-bar', headlight: 'led-strip', wheel: 'technical-mesh', aero: 'active-deck' },
    paints: paints('cobalt', 'mint', 'bone', 'ink'),
    shape: {
      length: 4.68, width: 2.02, height: 0.70,
      noseWidth: 0.72, frontArch: 0.96, waist: 0.88, rearArch: 0.99, tailWidth: 0.90,
      cabinCenter: -0.08, cabinLength: 0.42, cabinWidth: 0.74, cabinHeight: 0.46,
      wheelbase: 2.72, trackWidth: 1.82, wheelRadius: 0.40, wheelWidth: 0.34,
      rideHeight: 0.18,
    },
  },
  {
    id: 'onyx',
    name: 'ONYX GT-R',
    maker: 'KUROI',
    class: 'GT3 EVO',
    number: 3,
    voice: 'v12',
    aero: 'gt3evo',
    blurb: 'Powerful Japanese race weapon. Boxy widebody, deep side scoops and four round lamps — built to bully the apex.',
    stats: { topSpeed: 93, accel: 68, grip: 56, handling: 88 },
    livery: 'split',
    design: { profile: 'boxer-widebody', silhouette: 'square-arch-widebody', fascia: 'broad-mouth', cooling: 'hood-extractors', sideDetail: 'deep-scoop', tail: 'quad-round', headlight: 'quad-circle', wheel: 'forged-five-spoke', aero: 'pedestal-wing' },
    paints: paints('violet', 'ink', 'sand', 'crimson'),
    shape: {
      length: 4.70, width: 2.12, height: 0.68,
      noseWidth: 0.70, frontArch: 0.99, waist: 0.86, rearArch: 1.0, tailWidth: 0.92,
      cabinCenter: -0.12, cabinLength: 0.40, cabinWidth: 0.72, cabinHeight: 0.44,
      wheelbase: 2.78, trackWidth: 1.94, wheelRadius: 0.42, wheelWidth: 0.40,
      rideHeight: 0.17,
    },
  },
  {
    id: 'orion',
    name: 'ORION GT-R',
    maker: 'ARCTIC AUTOMOTIVE',
    class: 'GTE',
    number: 61,
    voice: 'v12',
    aero: 'gte',
    blurb: 'Pure endurance track weapon. Swan-neck wing, vertical lamps and a planted stance for the long stint.',
    stats: { topSpeed: 103, accel: 88, grip: 86, handling: 78 },
    livery: 'blocks',
    design: { profile: 'endurance-prototype', silhouette: 'race-cell-enduro', fascia: 'split-channel', cooling: 'louvered-arches', sideDetail: 'clean-flank', tail: 'vertical-lamps', headlight: 'proto-blade', wheel: 'endurance-centerlock', aero: 'swan-neck-wing' },
    paints: paints('ice', 'slate', 'cobalt', 'amber'),
    shape: {
      length: 4.88, width: 2.06, height: 0.66,
      noseWidth: 0.62, frontArch: 0.97, waist: 0.82, rearArch: 1.0, tailWidth: 0.88,
      cabinCenter: -0.06, cabinLength: 0.36, cabinWidth: 0.68, cabinHeight: 0.42,
      wheelbase: 2.84, trackWidth: 1.86, wheelRadius: 0.42, wheelWidth: 0.38,
      rideHeight: 0.16,
    },
  },
];

export const getCarById = (id) => CARS.find((c) => c.id === id) ?? CARS[0];

export const getPaint = (car, paintId) =>
  car.paints.find((p) => p.id === paintId) ?? car.paints[0];

export const getAero = (car) => AERO[car.aero] ?? AERO.gt3;

/** Rival grid: everyone except the player's pick, in catalogue order. */
export function buildRivalRoster(playerCarId, count) {
  const pool = CARS.filter((c) => c.id !== playerCarId);
  const roster = [];
  for (let i = 0; i < count; i++) {
    const car = pool[i % pool.length];
    roster.push({ car, paint: car.paints[(i + 1) % car.paints.length] });
  }
  return roster;
}

/** Short driver names for the standings tower. */
export const RIVAL_NAMES = ['REYES', 'HALLOW', 'KOVACS', 'MBEKI', 'STRAND', 'OKADA', 'VIDAL'];
