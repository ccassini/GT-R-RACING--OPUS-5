// ═══════════════════════════════════════════════════════
//  CIRCUIT CATALOGUE — pure data, no dependencies
//
//  Deliberately separate from track.js. The Circuit class needs
//  Three.js to build its spline, and the menus need nothing but these
//  names, blurbs and layout numbers. Keeping them in one module put
//  half a megabyte of Three into the first-load bundle just so the
//  setup screen could print "GT-R RIDGE".
//
//  Layout is per circuit, not global: a harbour street track is narrow
//  with a wall a metre off the kerb, a desert speedway is wide with
//  acres of run-off, and both have to work.
// ═══════════════════════════════════════════════════════

export const BARRIER = { ARMCO: 'armco', WALL: 'wall' };
export const ENVIRONMENT = {
  /** Permanent Grand Prix facility: paddock, grandstands, open parkland. */
  CIRCUIT: 'circuit',
  COAST: 'coast',
  HARBOUR: 'harbour',
  DESERT: 'desert',
};

export const DEFAULT_LAYOUT = {
  width: 17,
  kerb: 1.5,
  runoff: 11,
  barrier: BARRIER.ARMCO,
  /** Metres between the kerb edge and the barrier face. */
  barrierGap: 1.2,
};

// ── Circuit catalogue ──────────────────────────────────

export const CIRCUITS = [
  {
    id: 'sunsetRidge',
    name: 'GT-R RIDGE',
    location: 'RIDGEWAY PARK · CALIFORNIA',
    theme: 'goldenHour',
    environment: ENVIRONMENT.CIRCUIT,
    grade: 'FLOWING',
    blurb: 'Wide asphalt run-off and fast sweepers, into a kilometre-long run to the line.',
    scale: 1.55,
    layout: { width: 18, runoff: 13 },
    points: [
      [0, 0, 0], [150, 0, -4], [290, 0, -34], [382, 0, -112], [404, 2, -212],
      [368, 4, -300], [286, 5, -356], [186, 4, -358], [116, 2, -306], [104, 1, -228],
      [136, 0, -160], [86, 0, -104], [-12, 0, -96], [-96, 0, -140], [-168, 1, -216],
      [-262, 3, -258], [-350, 4, -216], [-386, 4, -126], [-350, 2, -40],
      [-262, 1, 16], [-150, 0, 34], [-64, 0, 24],
    ],
  },
  {
    id: 'capeVerdant',
    name: 'CAPE VERDANT',
    location: 'VERDANT HEADLAND',
    theme: 'blueHour',
    environment: ENVIRONMENT.COAST,
    grade: 'FAST',
    blurb: 'The longest lap on the calendar. Two enormous straights either side of a brake-eating hairpin.',
    scale: 1.63,
    layout: { width: 19, runoff: 15 },
    points: [
      [0, 0, 0], [220, 0, 6], [400, 0, -20], [498, 0, -96], [516, 2, -196],
      [470, 4, -284], [372, 5, -330], [258, 5, -322], [188, 3, -262], [196, 2, -186],
      [140, 1, -128], [26, 0, -122], [-88, 0, -166], [-186, 1, -252], [-300, 3, -300],
      [-414, 4, -272], [-478, 4, -180], [-470, 3, -74], [-404, 1, 8],
      [-292, 0, 54], [-160, 0, 56], [-66, 0, 34],
    ],
  },
  {
    id: 'pineHollow',
    name: 'HOLLOW PARK',
    location: 'HOLLOW VALLEY MOTORSPORT PARK',
    theme: 'hazyNoon',
    environment: ENVIRONMENT.CIRCUIT,
    grade: 'TECHNICAL',
    blurb: 'Relentless. Twenty corners with almost no straight long enough to breathe in.',
    scale: 1.85,
    layout: { width: 15.5, runoff: 9 },
    points: [
      [0, 0, 0], [96, 0, -6], [168, 1, -48], [176, 3, -118], [124, 4, -160],
      [56, 4, -142], [24, 3, -92], [-42, 2, -78], [-84, 2, -128], [-150, 3, -164],
      [-224, 4, -142], [-248, 4, -76], [-206, 3, -22], [-244, 2, 44], [-212, 1, 104],
      [-136, 1, 118], [-74, 0, 84], [-30, 0, 40],
    ],
  },
  {
    id: 'portArdente',
    name: 'PORT ARDENTE',
    location: 'PRINCIPALITY OF ARDENTE',
    theme: 'harbourDusk',
    environment: ENVIRONMENT.HARBOUR,
    grade: 'STREET',
    blurb: 'A harbour street circuit. Barriers within touching distance, a hairpin you take at walking pace, and no forgiveness at all.',
    scale: 2.5,
    layout: { width: 13, kerb: 1.1, runoff: 2.6, barrier: BARRIER.WALL, barrierGap: 0.6 },
    points: [
      [0, 0, 0], [128, 0, 0], [206, 1, -22], [240, 3, -74], [232, 5, -132],
      [188, 6, -166], [140, 6, -150], [130, 5, -108], [96, 4, -84], [30, 4, -96],
      [-30, 4, -140], [-96, 5, -168], [-166, 6, -160], [-212, 5, -114],
      [-208, 3, -58], [-244, 2, -14], [-232, 1, 44], [-176, 0, 70],
      [-104, 0, 58], [-46, 0, 30],
    ],
  },
  {
    id: 'alRasha',
    name: 'AL RASHA',
    location: 'AL RASHA MARINA · NIGHT',
    theme: 'desertNight',
    environment: ENVIRONMENT.DESERT,
    grade: 'POWER',
    blurb: 'Floodlit desert speedway under the towers. Enormous straights, heavy braking, and nowhere to hide from top speed.',
    scale: 1.95,
    layout: { width: 20, kerb: 1.6, runoff: 6, barrier: BARRIER.WALL, barrierGap: 1.6 },
    points: [
      [0, 0, 0], [260, 0, 0], [440, 0, -18], [552, 0, -86], [580, 0, -184],
      [540, 0, -272], [438, 0, -318], [316, 0, -312], [252, 0, -256], [268, 0, -186],
      [216, 0, -140], [80, 0, -136], [-70, 0, -160], [-206, 0, -226], [-334, 0, -262],
      [-452, 0, -228], [-508, 0, -142], [-490, 0, -44], [-408, 0, 26],
      [-286, 0, 62], [-140, 0, 58], [-52, 0, 30],
    ],
  },
];

export const getCircuitById = (id) =>
  CIRCUITS.find((c) => c.id === id) ?? CIRCUITS[0];
