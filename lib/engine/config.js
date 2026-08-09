// ═══════════════════════════════════════════════════════
//  CONFIG — tunables, quality tiers, art-direction themes
//
//  Art direction: "Golden Hour Circuit".
//  A stylised low-poly diorama seen from above: flat-shaded
//  geometry, a very low sun casting long raking shadows, and
//  a teal-in-the-shadows / amber-in-the-highlights grade.
//  Asphalt is deliberately cool blue-grey so warm light pops.
// ═══════════════════════════════════════════════════════

// ── Track geometry ─────────────────────────────────────
// Width, kerbs, run-off and barrier style are per circuit — see the
// `layout` block on each entry in world/track.js.

/** Curvature above this counts as "a corner" for kerbs, tyre walls and AI. */
export const CORNER_CURVATURE = 0.012;

// ── Base vehicle physics ───────────────────────────────
// Per-car stats in cars/catalog.js scale these.
export const PHYS = {
  maxSpeed: 65,
  /** Tuned so the quickest car reaches 100 km/h in about 2.2 s. */
  accel: 15,
  brake: 26,
  drag: 4,
  reverseFrac: 0.28,
  turnRate: 2.75,
  handbrakeGrip: 0.32,
  handbrakeDrag: 22,
  brakeTurnBonus: 1.4,
  handbrakeTurnBonus: 1.85,
  /** Multiplier applied to the on-screen km/h readout. */
  speedToKmh: 3.4,
};

/**
 * What is under the wheels. Lives here rather than in vehicle.js
 * because both the circuit and the open-world map have to classify a
 * position, and neither should have to import the physics to do it.
 */
export const SURFACE = { TRACK: 'track', KERB: 'kerb', OFF: 'off' };

/**
 * Surfaces are defined by a hard speed ceiling, not by extra drag.
 * Drag alone barely beat engine power, so grass felt the same as
 * asphalt. A ceiling plus progressive braking above it means leaving
 * the black costs real time and the player feels it instantly.
 */
export const SURFACES = {
  track: {
    /** Fraction of the car's top speed reachable here. */
    ceiling: 1.0,
    grip: 1.0,
    /** Throttle authority while over the ceiling. */
    power: 1.0,
    /** Base deceleration applied above the ceiling, m/s². */
    bite: 0,
  },
  kerb: {
    ceiling: 0.88,
    grip: 0.8,
    power: 0.85,
    bite: 12,
  },
  off: {
    ceiling: 0.4,
    grip: 0.46,
    power: 0.42,
    bite: 30,
  },
};

/** Extra deceleration per unit of speed above a surface's ceiling. */
export const OVER_CEILING_BITE = 2.4;

// ── Nitro, charged by drifting ─────────────────────────
export const BOOST = {
  capacity: 400,
  /** Charge per second at a full-quality drift. */
  chargeRate: 46,
  drainRate: 42,
  /** Minimum charge before the player is allowed to fire it. */
  minToFire: 22,
  speedBonus: 0.28,
  accelBonus: 0.85,
};

// ── Drift scoring ──────────────────────────────────────
export const DRIFT = {
  minAngle: 0.16,
  maxAngle: 0.95,
  minSpeed: 12,
  /** Score per second at a perfect drift, before the combo multiplier. */
  baseScore: 240,
  comboStep: 1.8,
  maxCombo: 5,
  /** Seconds of non-drifting before the combo drops. */
  breakGrace: 0.7,
};

// ── Difficulty tiers ───────────────────────────────────
export const DIFFICULTIES = {
  rookie: {
    id: 'rookie',
    label: 'ROOKIE',
    blurb: 'Forgiving rivals. Learn the circuit.',
    aiSpeed: 0.86,
    aiSkill: 0.7,
    rubberBand: 0.1,
    aiAggression: 0.55,
  },
  pro: {
    id: 'pro',
    label: 'PRO',
    blurb: 'Rivals hold the racing line and defend.',
    aiSpeed: 0.955,
    aiSkill: 0.9,
    rubberBand: 0.18,
    aiAggression: 0.8,
  },
  ace: {
    id: 'ace',
    label: 'ACE',
    blurb: 'Ruthless pace. Mistakes are punished.',
    aiSpeed: 1.02,
    aiSkill: 1.0,
    rubberBand: 0.1,
    aiAggression: 0.95,
  },
};

// ── Quality tiers ──────────────────────────────────────
export const QUALITY = {
  low: {
    id: 'low',
    label: 'LOW',
    pixelRatio: 1,
    shadowMapSize: 1024,
    shadowRadius: 90,
    postFx: false,
    bloom: false,
    sceneryScale: 0.5,
    terrainSegments: 96,
    smokeCount: 120,
    dustCount: 80,
    sparkCount: 60,
    maxTireMarks: 3000,
  },
  medium: {
    id: 'medium',
    label: 'MEDIUM',
    pixelRatio: 1.5,
    shadowMapSize: 2048,
    shadowRadius: 105,
    postFx: true,
    bloom: true,
    sceneryScale: 0.8,
    terrainSegments: 160,
    smokeCount: 220,
    dustCount: 150,
    sparkCount: 120,
    maxTireMarks: 6000,
  },
  high: {
    id: 'high',
    label: 'HIGH',
    pixelRatio: 2,
    shadowMapSize: 4096,
    shadowRadius: 120,
    postFx: true,
    bloom: true,
    sceneryScale: 1,
    terrainSegments: 224,
    smokeCount: 320,
    dustCount: 220,
    sparkCount: 180,
    maxTireMarks: 9000,
  },
};

// ── Camera rig ─────────────────────────────────────────
// BIRD is the default: a high raking angle that keeps the long
// sunset shadows and the whole car footprint in frame.
export const CAMERAS = {
  // ~53 degrees above the car: unmistakably an aerial view, but
  // shallow enough to see roughly 40 m of road ahead at rest and
  // 90 m flat out, which is what makes it drivable.
  bird: {
    id: 'bird',
    label: 'BIRD',
    height: 34,
    behind: 26,
    fov: 50,
    /** Extra height/distance/FOV at top speed. */
    speedHeight: 12,
    speedBehind: 10,
    speedFov: 8,
    followRate: 6.5,
    yawRate: 3.2,
    lookAhead: 20,
    roll: 0.05,
  },
  top: {
    id: 'top',
    label: 'TOP',
    height: 58,
    behind: 0.01,
    fov: 46,
    speedHeight: 20,
    speedBehind: 0,
    speedFov: 6,
    followRate: 7.5,
    yawRate: 3.0,
    lookAhead: 16,
    roll: 0,
  },
  chase: {
    id: 'chase',
    label: 'CHASE',
    height: 6.4,
    behind: 14.5,
    fov: 62,
    speedHeight: 1.2,
    speedBehind: 3.5,
    speedFov: 14,
    followRate: 5.5,
    yawRate: 5.5,
    lookAhead: 5,
    roll: 0.16,
  },
  // The open-world default. A bird's-eye view over a district of
  // two-hundred-metre towers is a view of rooftops, so free roam sits
  // low enough to see down the street and read the junction ahead.
  roam: {
    id: 'roam',
    label: 'ROAM',
    height: 9.6,
    behind: 19,
    fov: 60,
    speedHeight: 2.6,
    speedBehind: 6.5,
    speedFov: 12,
    followRate: 5,
    yawRate: 4.2,
    lookAhead: 9,
    roll: 0.1,
  },
};

export const CAMERA_ORDER = ['bird', 'top', 'chase'];
/** Free roam gets its own cycle: no overhead view, roam first. */
export const CAMERA_ORDER_ROAM = ['roam', 'chase', 'bird'];

// ── Art-direction themes ───────────────────────────────
// Each circuit picks one. Colours are plain hex ints so they can
// be fed straight into THREE.Color.
export const THEMES = {
  goldenHour: {
    id: 'goldenHour',
    label: 'GOLDEN HOUR',
    sky: {
      zenith: 0x1d1a40,
      middle: 0xb2637e,
      horizon: 0xff9d52,
      sun: 0xfff2c0,
      sunElevation: 0.018,
      sunAzimuth: 0.62,
      cloud: 0xffc79a,
      cloudShadow: 0x6b3f5e,
      cloudCoverage: 0.42,
      starIntensity: 0.0,
    },
    fog: { color: 0xe8926a, density: 0.0017 },
    light: {
      sunColor: 0xffdcaa,
      sunIntensity: 2.35,
      // Low elevation -> shadows ~2.9x object height. Long raking shadows
      // striping the track are the signature of the look from above.
      sunElevation: 0.33,
      sunAzimuth: 0.62,
      ambientColor: 0x6e6c96,
      ambientIntensity: 0.66,
      hemiSky: 0xffcda2,
      hemiGround: 0x2b3524,
      hemiIntensity: 0.68,
      rimColor: 0x7d6cc8,
      rimIntensity: 0.35,
      shadowTint: 0x2a3358,
    },
    terrain: {
      grassLow: 0x3f6b34,
      grassHigh: 0x557e3c,
      dry: 0x9a8a45,
      rock: 0x6d5f52,
      sand: 0xbfa276,
      water: 0x2a5c78,
      waterDeep: 0x123a52,
      waterLevel: -7,
      relief: 1.0,
    },
    road: {
      asphalt: 0x5d6069,
      asphaltWorn: 0x6e7179,
      line: 0xf1ece0,
      kerbA: 0xd93b28,
      kerbB: 0xf3efe6,
      runoff: 0x53613a,
      runoffAsphalt: 0x5a5d68,
      runoffPaint: 0x2f6f52,
      runoffStripe: 0x2f5fb8,
      apron: 0xe8e2d2,
      gravel: 0xb2a181,
    },
    foliage: {
      pine: [0x27512a, 0x2f6330, 0x1e4324, 0x376f33],
      broadleaf: [0x4a7a2f, 0x5c8c34, 0x3c6a29],
      autumn: [0xc4621f, 0xd98a24, 0xa2411a, 0xe08a30],
      trunk: [0x4a2d19, 0x5b3a22, 0x38220f],
      autumnRatio: 0.34,
    },
    grade: {
      // Only a whisper of blue in the lift — any more and the dark
      // asphalt turns purple instead of reading as tarmac.
      lift: [0.014, 0.016, 0.026],
      gain: [1.06, 1.0, 0.95],
      saturation: 1.12,
      contrast: 1.06,
      vignette: 0.3,
      grain: 0.03,
      bloomStrength: 0.62,
      bloomThreshold: 0.72,
      bloomRadius: 0.55,
    },
  },

  blueHour: {
    id: 'blueHour',
    label: 'BLUE HOUR',
    sky: {
      zenith: 0x0a1436,
      middle: 0x3c539c,
      horizon: 0xffab6d,
      sun: 0xffd79a,
      sunElevation: 0.008,
      sunAzimuth: 2.35,
      cloud: 0xc7a6c4,
      cloudShadow: 0x2c2c56,
      cloudCoverage: 0.3,
      starIntensity: 0.55,
    },
    fog: { color: 0x6b6ea8, density: 0.0019 },
    light: {
      sunColor: 0xffbf8f,
      sunIntensity: 1.9,
      sunElevation: 0.29,
      sunAzimuth: 2.35,
      ambientColor: 0x53619e,
      ambientIntensity: 0.55,
      hemiSky: 0x8fa6e8,
      hemiGround: 0x22303a,
      hemiIntensity: 0.6,
      rimColor: 0xff9a6a,
      rimIntensity: 0.45,
      shadowTint: 0x1c2a52,
    },
    terrain: {
      grassLow: 0x2f5540,
      grassHigh: 0x3f6a4c,
      dry: 0x7d7a52,
      rock: 0x5a5766,
      sand: 0xc9b184,
      water: 0x1d4d78,
      waterDeep: 0x0b2440,
      waterLevel: -4,
      relief: 0.75,
    },
    road: {
      asphalt: 0x2c2f3c,
      asphaltWorn: 0x3a3d4c,
      line: 0xeceaf2,
      kerbA: 0xcf3450,
      kerbB: 0xeef0f6,
      runoff: 0x44553f,
      runoffAsphalt: 0x4a4d5a,
      runoffPaint: 0x2b5f7a,
      runoffStripe: 0x2f5fb8,
      apron: 0xdcd8cc,
      gravel: 0x9c8f76,
    },
    foliage: {
      pine: [0x1e4433, 0x255238, 0x18362a],
      broadleaf: [0x35603f, 0x437245, 0x2c5136],
      autumn: [0x9c5430, 0xb06a2c, 0x7d3a22],
      trunk: [0x3a2618, 0x4a3120, 0x2a1a10],
      autumnRatio: 0.2,
    },
    grade: {
      lift: [0.006, 0.014, 0.045],
      gain: [1.03, 1.0, 1.02],
      saturation: 1.14,
      contrast: 1.1,
      vignette: 0.5,
      grain: 0.045,
      bloomStrength: 0.85,
      bloomThreshold: 0.62,
      bloomRadius: 0.62,
    },
  },

  hazyNoon: {
    id: 'hazyNoon',
    label: 'CLEAR AFTERNOON',
    sky: {
      zenith: 0x1e5fb4,
      middle: 0x6fa8dc,
      horizon: 0xf7e2b8,
      sun: 0xfff8e0,
      sunElevation: 0.24,
      sunAzimuth: 1.55,
      cloud: 0xfffaf0,
      cloudShadow: 0x9fb3cc,
      cloudCoverage: 0.4,
      starIntensity: 0,
    },
    fog: { color: 0xbfd2dd, density: 0.0013 },
    light: {
      sunColor: 0xfff2cf,
      sunIntensity: 2.55,
      sunElevation: 0.62,
      sunAzimuth: 1.55,
      ambientColor: 0x7f93b4,
      ambientIntensity: 0.6,
      hemiSky: 0xcfe4f7,
      hemiGround: 0x466030,
      hemiIntensity: 0.72,
      rimColor: 0xa8cfe8,
      rimIntensity: 0.28,
      shadowTint: 0x33456a,
    },
    terrain: {
      grassLow: 0x4f7d31,
      grassHigh: 0x6f9a3f,
      dry: 0xb4a45a,
      rock: 0x847a6e,
      sand: 0xcbb68c,
      water: 0x2e7ea0,
      waterDeep: 0x175570,
      waterLevel: -11,
      relief: 1.3,
    },
    road: {
      asphalt: 0x4d505c,
      asphaltWorn: 0x5f6270,
      line: 0xf6f4ee,
      kerbA: 0xd2402c,
      kerbB: 0xf8f6f0,
      runoff: 0x5f7439,
      runoffAsphalt: 0x5e6270,
      runoffPaint: 0x2f7a56,
      runoffStripe: 0x2f5fb8,
      apron: 0xeeeade,
      gravel: 0xbcac89,
    },
    foliage: {
      pine: [0x2c5c2c, 0x36703a, 0x214a26],
      broadleaf: [0x54873a, 0x669b40, 0x437030],
      autumn: [0xc07a25, 0xd8a234, 0x9c561c],
      trunk: [0x50331d, 0x624126, 0x3c2513],
      autumnRatio: 0.16,
    },
    grade: {
      lift: [0.004, 0.01, 0.026],
      gain: [1.04, 1.0, 0.97],
      saturation: 1.14,
      contrast: 1.08,
      vignette: 0.3,
      grain: 0.022,
      bloomStrength: 0.5,
      bloomThreshold: 0.78,
      bloomRadius: 0.45,
    },
  },

  // ── Monaco-style harbour street circuit, late dusk ──
  harbourDusk: {
    id: 'harbourDusk',
    label: 'HARBOUR DUSK',
    sky: {
      zenith: 0x241c46,
      middle: 0x7d5279,
      horizon: 0xff8a5c,
      sun: 0xffd9a0,
      sunElevation: 0.03,
      sunAzimuth: 1.95,
      cloud: 0xd9a0b0,
      cloudShadow: 0x3f2c52,
      cloudCoverage: 0.34,
      starIntensity: 0.3,
    },
    fog: { color: 0x8d6a80, density: 0.0013 },
    light: {
      sunColor: 0xffcfa4,
      sunIntensity: 2.7,
      sunElevation: 0.3,
      sunAzimuth: 1.95,
      ambientColor: 0x6f6a9c,
      ambientIntensity: 0.98,
      hemiSky: 0xffc6a4,
      hemiGround: 0x453f52,
      hemiIntensity: 0.9,
      rimColor: 0x86b6ff,
      rimIntensity: 0.5,
      shadowTint: 0x352d54,
    },
    terrain: {
      // A street circuit is paved, not planted: promenade stone with
      // pockets of parkland rather than a green infield.
      grassLow: 0x8b8375,
      grassHigh: 0x9d9484,
      dry: 0xb0a58e,
      rock: 0x8a8177,
      sand: 0xc9b892,
      water: 0x1f6c8c,
      waterDeep: 0x0e3a52,
      waterLevel: -3,
      relief: 0.35,
      mown: false,
    },
    road: {
      asphalt: 0x55576a,
      asphaltWorn: 0x67697c,
      line: 0xf4f0e6,
      kerbA: 0xd93b28,
      kerbB: 0xf3efe6,
      runoff: 0x7a7466,
      runoffAsphalt: 0x666a78,
      runoffPaint: 0xb8342a,
      runoffStripe: 0xb8342a,
      apron: 0xe4dccb,
      gravel: 0xa79877,
    },
    foliage: {
      pine: [0x2b5238, 0x336040, 0x224630],
      broadleaf: [0x3f7040, 0x4d8348, 0x356034],
      autumn: [0xb0762c, 0xc78d34, 0x8f5722],
      trunk: [0x4a3320, 0x5a4028, 0x372414],
      autumnRatio: 0.1,
    },
    city: {
      wall: [0xe6ddcc, 0xd8ccb6, 0xc8b9a0, 0xefe7d8, 0xbfae95],
      roof: [0xb4553f, 0xa04a37, 0xc26a4a, 0x8f6f5a],
      window: 0xffd9a0,
      windowLit: 0.55,
      minHeight: 8,
      maxHeight: 34,
      density: 1,
      skyline: 0,
    },
    grade: {
      lift: [0.03, 0.028, 0.055],
      gain: [1.06, 1.0, 0.98],
      saturation: 1.16,
      contrast: 1.05,
      vignette: 0.32,
      grain: 0.028,
      bloomStrength: 0.8,
      bloomThreshold: 0.66,
      bloomRadius: 0.58,
    },
  },

  // ── Dubai-style floodlit desert street circuit, night ──
  desertNight: {
    id: 'desertNight',
    label: 'DESERT NIGHT',
    sky: {
      zenith: 0x04060f,
      middle: 0x0c1730,
      horizon: 0x4a3348,
      sun: 0xfff0d0,
      sunElevation: 0.42,
      sunAzimuth: 4.1,
      cloud: 0x1c2740,
      cloudShadow: 0x080c18,
      cloudCoverage: 0.16,
      starIntensity: 1,
    },
    fog: { color: 0x141c34, density: 0.0011 },
    light: {
      // Floodlights, not a sun: high, hard and cool. Ambient stays
      // very low so only what the rigs actually reach is lit — that
      // contrast is the whole reason to run a race at night.
      sunColor: 0xe6f0ff,
      sunIntensity: 2.1,
      sunElevation: 0.95,
      sunAzimuth: 2.4,
      ambientColor: 0x1b2340,
      ambientIntensity: 0.34,
      hemiSky: 0x2a3a63,
      hemiGround: 0x140f0a,
      hemiIntensity: 0.32,
      rimColor: 0xff9b45,
      rimIntensity: 0.5,
      shadowTint: 0x080d1c,
      floodlights: true,
    },
    terrain: {
      // Night sand: dark enough that the floodlit ribbon of track is
      // the brightest thing in frame by a wide margin.
      grassLow: 0x39301f,
      grassHigh: 0x473c28,
      dry: 0x52452c,
      rock: 0x2e2a24,
      sand: 0x5f5136,
      water: 0x0c2338,
      waterDeep: 0x05101f,
      waterLevel: -8,
      relief: 1.15,
      mown: false,
    },
    road: {
      asphalt: 0x3b3e4a,
      asphaltWorn: 0x4a4d59,
      line: 0xf6f4ee,
      kerbA: 0xd93b28,
      kerbB: 0xf3efe6,
      runoff: 0x4d4029,
      runoffAsphalt: 0x44474f,
      runoffPaint: 0x1f4f8f,
      runoffStripe: 0x1f4f8f,
      apron: 0xd8d2c4,
      gravel: 0x6e5f42,
    },
    foliage: {
      pine: [0x2f4a2c, 0x3a5a33, 0x24391f],
      broadleaf: [0x3d5c30, 0x4a6d38, 0x2f4a26],
      autumn: [0x8a6a2c, 0x9c7a30, 0x6f5222],
      trunk: [0x5a4526, 0x6a5430, 0x40311a],
      autumnRatio: 0,
    },
    city: {
      wall: [0x2a3450, 0x33405e, 0x222b42, 0x3b4a6c],
      roof: [0x2e3850, 0x3a445e, 0x27304a],
      window: 0xffd48a,
      windowLit: 0.85,
      minHeight: 24,
      maxHeight: 150,
      density: 0.55,
      /** Extra tower cluster on the horizon, Dubai-marina style. */
      skyline: 1,
    },
    grade: {
      lift: [0.004, 0.008, 0.03],
      gain: [1.04, 1.0, 1.05],
      saturation: 1.2,
      contrast: 1.12,
      vignette: 0.46,
      grain: 0.045,
      // Only genuine light sources glare: floodlight heads, headlights
      // and lit windows. A low threshold here blooms the tarmac itself.
      bloomStrength: 0.75,
      bloomThreshold: 0.85,
      bloomRadius: 0.7,
    },
  },

  // ── The open world: a clear morning over the strait ──
  //  Free roam is measured in kilometres, not corner numbers, so the
  //  grade is built around depth rather than drama: a pale, slightly
  //  cool haze that separates each ridge of the city from the next, and
  //  a sun high enough to keep four kilometres of street legible.
  marmaraDawn: {
    id: 'marmaraDawn',
    label: 'MARMARA MORNING',
    sky: {
      zenith: 0x1b4f96,
      middle: 0x74a6d8,
      horizon: 0xf6d9b0,
      sun: 0xfff4dc,
      sunElevation: 0.2,
      sunAzimuth: 1.12,
      cloud: 0xfdf6ec,
      cloudShadow: 0xa8bcd2,
      cloudCoverage: 0.34,
      starIntensity: 0,
    },
    // Thin, on purpose. Heavy haze would hide the streaming boundary for
    // free, but it would also hide the skyline across the strait, which
    // is the one view the whole world exists to deliver. So the fog is
    // set for four kilometres of visibility and the boundary is covered
    // by distant massing blocks instead.
    fog: { color: 0xa9c2da, density: 0.00042 },
    light: {
      sunColor: 0xfff0d8,
      // Higher than any circuit uses, and for a reason: at the thirty
      // degrees that flatters a race track, a street between two
      // forty-storey towers never sees daylight and the whole drive
      // happens in a blue trench.
      //
      // But the budget is fixed. Circuits get away with sun 2.35 plus
      // ambient 0.66 because almost nothing there faces the sun square
      // on; raise the sun and every road surface in the city does, so
      // the fill has to come down to match or the asphalt clips white.
      sunIntensity: 2.4,
      sunElevation: 0.62,
      sunAzimuth: 1.12,
      // Shade in a city is sky light bouncing between stone, not a
      // clear zenith seen from an open track. Keeping the fill this
      // desaturated is what stops a street in shadow reading as dusk.
      ambientColor: 0x9ea7b8,
      ambientIntensity: 0.66,
      hemiSky: 0xd8e4ee,
      hemiGround: 0x7a7052,
      hemiIntensity: 0.7,
      rimColor: 0xc2d4e4,
      rimIntensity: 0.3,
      shadowTint: 0x646a80,
    },
    terrain: {
      grassLow: 0x5c6b3a,
      grassHigh: 0x74853f,
      dry: 0xa79a5f,
      rock: 0x8b8171,
      sand: 0xd0bf95,
      water: 0x2b7d9e,
      waterDeep: 0x0d3a58,
      waterLevel: 0,
      relief: 1,
      mown: false,
    },
    road: {
      asphalt: 0x4b4e58,
      asphaltWorn: 0x5b5e69,
      line: 0xf2eee2,
      kerbA: 0xa8a294,
      // Pavements read far brighter in the world than on a circuit:
      // there are kilometres of them, they run edge to edge in frame,
      // and the sun is high. Cream, not white.
      kerbB: 0x9d9789,
      runoff: 0x6b6a52,
      runoffAsphalt: 0x55585f,
      runoffPaint: 0xd6b23a,
      runoffStripe: 0xd6b23a,
      apron: 0x938d80,
      gravel: 0xa89a7c,
    },
    foliage: {
      pine: [0x2e5233, 0x37623a, 0x24422a, 0x3e6f3c],
      broadleaf: [0x4c7a37, 0x5d8c3e, 0x3f6a30],
      autumn: [0xb0762c, 0xc08a33, 0x8f5722],
      trunk: [0x4d3420, 0x5c4028, 0x3a2716],
      autumnRatio: 0.12,
    },
    city: {
      wall: [0xc9c0ae, 0xb6ab96, 0xdad2c2, 0x9fa9b6, 0x8f9db0],
      roof: [0x6a5f52, 0x55606f, 0x7a6a58],
      window: 0xffe1a8,
      windowLit: 0.16,
      minHeight: 10,
      maxHeight: 210,
      density: 1,
      skyline: 0,
    },
    grade: {
      // Almost no tint in the lift. The circuits put teal in their
      // shadows to make a warm key read warmer; a city is mostly
      // shadow, so the same trick would turn the whole world blue.
      lift: [0.014, 0.014, 0.02],
      gain: [1.05, 1.0, 0.96],
      saturation: 1.08,
      contrast: 1.06,
      vignette: 0.28,
      grain: 0.02,
      bloomStrength: 0.42,
      bloomThreshold: 0.82,
      bloomRadius: 0.5,
    },
  },
};

// ── Open world ─────────────────────────────────────────
/** How many 512 m chunks stay resident around the player, per tier. */
export const ROAM_RADIUS = { low: 2, medium: 3, high: 4 };
/** Milliseconds of chunk building allowed per frame. Frame rate wins. */
export const ROAM_BUILD_BUDGET_MS = 5;
/** Ambient traffic held around the player, per tier. */
export const ROAM_TRAFFIC = { low: 10, medium: 20, high: 32 };

export const LAP_OPTIONS = [3, 5, 8];
export const DEFAULT_LAPS = 3;
export const GRID_SIZE = 6;
