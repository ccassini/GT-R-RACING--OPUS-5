// ═══════════════════════════════════════════════════════
//  CITY MAP — the whole metropolis as a pure function
//
//  Nothing here is stored. Ask what is at (x, z) and this module
//  computes it: the height of the ground, whether it is sea, which
//  district you are standing in, and whether there is road under the
//  wheels. Five thousand square kilometres, and the memory cost is the
//  handful of closures below.
//
//  That is the whole trick behind the streaming. A chunk can be built,
//  thrown away and rebuilt three minutes later and come back
//  byte-identical, because the generator never had any state to lose.
//
//  Everything is allocation-free on the hot path: `sampleSurface` is
//  called for every car every frame and for every terrain vertex of
//  every chunk, so it writes into a caller-owned object.
// ═══════════════════════════════════════════════════════
import { SURFACE } from '../../config.js';
import { clamp, clamp01, lerp, smoothstep, makeFbm2D } from '../../util.js';
import {
  BRIDGES,
  CENTRES,
  CHUNK,
  COASTS,
  DISTRICTS,
  INLET,
  MOTORWAY_GRID,
  PLACES,
  ROADS,
  SEABED,
  STRAIT,
  SUPERBLOCK,
  WORLD_HALF,
  hash2i,
} from './cityConfig.js';

/** Sea beyond this distance from the middle, on either axis. */
const EDGE_WATER = WORLD_HALF - 2600;

/** Rounded division that keeps working for negative coordinates. */
const nearestMultiple = (v, step) => Math.round(v / step) * step;

export function createCityMap(seed = 20260809) {
  const reliefBig = makeFbm2D({ seed: seed ^ 0x1a2b, octaves: 4, lacunarity: 2.1, gain: 0.5 });
  const reliefMid = makeFbm2D({ seed: seed ^ 0x4e33, octaves: 2, lacunarity: 2.2, gain: 0.5 });
  const reliefFine = makeFbm2D({ seed: seed ^ 0x77c1, octaves: 3, lacunarity: 2.3, gain: 0.5 });
  const zoneNoise = makeFbm2D({ seed: seed ^ 0x5f0d, octaves: 3, lacunarity: 2.2, gain: 0.55 });
  const parkNoise = makeFbm2D({ seed: seed ^ 0x2c9e, octaves: 2, lacunarity: 2.4, gain: 0.5 });
  const worksNoise = makeFbm2D({ seed: seed ^ 0x3ab7, octaves: 2, lacunarity: 2.2, gain: 0.5 });
  const coastNoise = makeFbm2D({ seed: seed ^ 0x9110, octaves: 3, lacunarity: 2.0, gain: 0.5 });

  // ── Geography ────────────────────────────────────────

  function straitCentre(z) {
    let x = STRAIT.baseX;
    for (const s of STRAIT.swing) {
      x += s.amplitude * Math.sin((z / s.wavelength) * Math.PI * 2 + s.phase);
    }
    return x;
  }

  function straitHalf(z) {
    let h = STRAIT.baseHalf;
    for (const s of STRAIT.halfSwing) {
      h += s.amplitude * Math.sin((z / s.wavelength) * Math.PI * 2 + s.phase);
    }
    return Math.max(220, h);
  }

  /**
   * Signed distance to the nearest shoreline: positive on land, negative
   * in water, in metres. The union of every body of water is a plain
   * `min` of their individual signed distances, which is why the strait,
   * the inlet and four open seas cost four comparisons between them.
   */
  // Both of the fields below are asked the same question several times
  // in a row — a terrain vertex wants its height, its district and its
  // road, and all three want the shoreline and the urban intensity at
  // exactly the same point. A single-entry memo turns four evaluations
  // into one and is the cheapest speed-up in this file by a distance.
  let shoreX = NaN;
  let shoreZ = NaN;
  let shoreValue = 0;

  function shoreDistance(x, z) {
    if (x === shoreX && z === shoreZ) return shoreValue;
    shoreX = x;
    shoreZ = z;
    shoreValue = computeShoreDistance(x, z);
    return shoreValue;
  }

  function computeShoreDistance(x, z) {
    // The strait, running the full height of the map.
    let d = Math.abs(x - straitCentre(z)) - straitHalf(z);

    // The inlet branching west off it, as a capsule: distance to the
    // segment, less a half-width that tapers to nothing at the head.
    //
    // It has to be written this way. Testing `x` against the ends and
    // using |z - centre| inside makes the field jump by a kilometre the
    // moment you cross the head of the inlet, and a discontinuous
    // distance field is a vertical cliff in the terrain built from it.
    const mouth = straitCentre(INLET.z);
    const west = mouth - INLET.reach;
    const nearest = clamp(x, west, mouth);
    const along = (nearest - west) / INLET.reach;
    const half = INLET.half * smoothstep(0, INLET.taper / INLET.reach, along);
    d = Math.min(d, Math.hypot(x - nearest, z - INLET.z) - half);

    // Open sea north and south, with a noisy coastline.
    const south = COASTS.south.base
      + COASTS.south.amplitude * coastNoise(x / COASTS.south.wavelength, 11.5);
    const north = COASTS.north.base
      + COASTS.north.amplitude * coastNoise(x / COASTS.north.wavelength, -7.25);
    d = Math.min(d, south - z, z - north);

    // The edge of the world is water, so there is never a visible seam.
    d = Math.min(d, EDGE_WATER - Math.abs(x), EDGE_WATER - Math.abs(z));
    return d;
  }

  const isWater = (x, z) => shoreDistance(x, z) <= 0;

  /**
   * Outward normal of the shoreline, for pushing a car back onto land.
   * Central differences over four metres — cheaper and steadier than
   * anything analytic, given how many terms feed the distance field.
   */
  function shoreNormal(x, z, out) {
    const e = 4;
    out.x = shoreDistance(x + e, z) - shoreDistance(x - e, z);
    out.z = shoreDistance(x, z + e) - shoreDistance(x, z - e);
    const len = Math.hypot(out.x, out.z) || 1;
    out.x /= len;
    out.z /= len;
    return out;
  }

  // ── Urban intensity ──────────────────────────────────
  // How "downtown" a spot is, in roughly [0, 1.1]. Every zoning
  // decision in the city reads off this one number.

  let intensityX = NaN;
  let intensityZ = NaN;
  let intensityValue = 0;

  function intensityAt(x, z) {
    if (x === intensityX && z === intensityZ) return intensityValue;
    intensityX = x;
    intensityZ = z;
    intensityValue = computeIntensity(x, z);
    return intensityValue;
  }

  function computeIntensity(x, z) {
    let peak = 0;
    for (const c of CENTRES) {
      const dx = x - c.x;
      const dz = z - c.z;
      const falloff = 1 - (dx * dx + dz * dz) / (c.radius * c.radius * 4.2);
      if (falloff <= 0) continue;
      const value = c.weight * falloff * falloff;
      if (value > peak) peak = value;
    }
    return clamp01(peak + zoneNoise(x * 0.00019, z * 0.00019) * 0.26 + 0.06);
  }

  // ── Terrain ──────────────────────────────────────────

  function landHeight(x, z) {
    const big = reliefBig(x * 0.00042, z * 0.00042) * 0.5 + 0.5;
    // The one that makes the place read as hilly. Two kilometres of
    // gentle swell is a plain from inside a car; a crest every eight
    // hundred metres is a city built on hills, and you feel it the
    // moment the road tips over one.
    const mid = reliefMid(x * 0.00115, z * 0.00115);
    const fine = reliefFine(x * 0.0016, z * 0.0016);
    const rolling = 11 + big * 72 + mid * 22 + fine * 7;
    // Downtown is built on levelled ground. Without this the core reads
    // as a ski slope with towers on it, and the long boulevards that
    // make a grid legible from the air stop being legible.
    const flat = 15 + big * 20 + fine * 2.5;
    // Never below the sea it is supposed to be standing above: a metre
    // of negative relief inland becomes a lake with roads running
    // through it, which nothing downstream is equipped to handle.
    return Math.max(2.6, lerp(rolling, flat, smoothstep(0.52, 0.9, intensityAt(x, z))));
  }

  function heightAt(x, z) {
    const shore = shoreDistance(x, z);
    if (shore >= 240) return landHeight(x, z);
    // A beach ramp rather than a cliff, and a seabed that drops away.
    return lerp(SEABED, landHeight(x, z), smoothstep(-90, 240, shore));
  }

  // ── Districts ────────────────────────────────────────

  const districtScratch = { id: 'residential', spec: DISTRICTS.residential, intensity: 0, place: null };

  function districtAt(x, z, out = districtScratch) {
    out.place = null;
    if (isWater(x, z)) {
      out.id = 'water';
      out.spec = DISTRICTS.water;
      out.intensity = 0;
      return out;
    }

    const intensity = intensityAt(x, z);
    out.intensity = intensity;

    // Hand-pinned places win, so the old quarter cannot quietly become
    // a business park because the noise field drifted.
    for (const place of PLACES) {
      if (place.x === null) continue;
      const dx = x - place.x;
      const dz = z - place.z;
      if (dx * dx + dz * dz < place.radius * place.radius) {
        out.id = place.district;
        out.spec = DISTRICTS[place.district];
        out.place = place;
        // A pinned place carries its own urban intensity. The noise
        // field is honestly near zero five kilometres from the nearest
        // centre, and everything downstream that reads intensity — how
        // tall the buildings get, how paved the ground is — would take
        // that at face value and build a ghost town on top of it.
        out.intensity = Math.max(intensity, place.intensity ?? 0);
        return out;
      }
    }

    const id = zoneFor(x, z, intensity);
    out.id = id;
    out.spec = DISTRICTS[id];
    return out;
  }

  function zoneFor(x, z, intensity) {
    if (parkNoise(x * 0.00027, z * 0.00027) > 0.44 && intensity < 0.72) return 'park';
    if (intensity > 0.84) return 'core';
    if (intensity > 0.6) return 'midrise';
    if (intensity < 0.44 && worksNoise(x * 0.00033, z * 0.00033) > 0.34) return 'industrial';
    if (intensity > 0.3 && shoreDistance(x, z) < 460) return 'waterfront';
    if (intensity > 0.33) return 'residential';
    return 'suburb';
  }

  // ── Superblocks ──────────────────────────────────────
  // Each 2 km cell carries its own street grid at its own angle. That
  // one decision is what stops 5,000 km² of city reading as Manhattan
  // stretched to the horizon: neighbourhoods meet at an angle on the
  // boulevard between them, exactly as they do in a city that grew.

  const blockScratch = {
    sx: 0, sz: 0, cx: 0, cz: 0, rotation: 0, cos: 1, sin: 0,
    spacing: 0, districtId: 'residential', spec: DISTRICTS.residential, hash: 0,
  };

  function superblockAt(x, z, out = blockScratch) {
    const sx = Math.floor(x / SUPERBLOCK);
    const sz = Math.floor(z / SUPERBLOCK);
    if (out.sx === sx && out.sz === sz && out.spacing !== 0) return out;
    return superblockAtIndex(sx, sz, out);
  }

  function superblockAtIndex(sx, sz, out = blockScratch) {
    const cx = sx * SUPERBLOCK + SUPERBLOCK / 2;
    const cz = sz * SUPERBLOCK + SUPERBLOCK / 2;
    const h = hash2i(sx, sz, seed ^ 0x51ed);
    const district = districtAt(cx, cz, {});

    // The denser the district the straighter the grid: a financial core
    // is surveyed, a hillside suburb followed the contours.
    const swing = district.id === 'oldtown' ? 0.52 : district.id === 'core' ? 0.12 : 0.34;
    const rotation = (((h & 0x3ff) / 0x3ff) - 0.5) * 2 * swing;

    out.sx = sx;
    out.sz = sz;
    out.cx = cx;
    out.cz = cz;
    out.hash = h;
    out.rotation = rotation;
    out.cos = Math.cos(rotation);
    out.sin = Math.sin(rotation);
    out.districtId = district.id;
    out.spec = district.spec;
    // A little spacing jitter per superblock, so two neighbouring
    // residential cells are not the same block size to the metre.
    const jitter = 0.86 + ((h >>> 12) & 0xff) / 0xff * 0.3;
    out.spacing = district.spec.streetSpacing * jitter;
    return out;
  }

  // ── Roads ────────────────────────────────────────────

  const roadScratch = {
    dist: Infinity, lateral: 0, kind: null,
    halfWidth: 0, pavement: 0, lanes: 0, heading: 0,
  };

  /**
   * Signed distance to the road network: zero or less means the wheels
   * are on the carriageway. `dist` is metres past the kerb line, so the
   * caller decides where pavement ends and dirt begins.
   *
   * `lateral` is the signed offset from that road's centreline, measured
   * along the right-hand normal of `heading`. Traffic needs the sign,
   * not just the distance — without it a car can tell that it is three
   * metres from the middle of the road but not which side, which is the
   * whole of what a carriageway is for.
   */
  function roadAt(x, z, out = roadScratch) {
    return queryRoad(x, z, out, null);
  }

  /**
   * The same query, restricted to roads running roughly along `heading`.
   *
   * A car driving through a crossroads is, for a moment, nearer to the
   * middle of the road it is crossing than to the middle of its own —
   * so the plain nearest-road query hands it the wrong one and it tries
   * to turn. Asking for the road it is already travelling along is what
   * lets traffic drive straight through a junction.
   */
  function roadAlong(x, z, heading, out = roadScratch) {
    return queryRoad(x, z, out, heading);
  }

  /** Roads within this much of parallel count as "the same road". */
  const ALIGNED = Math.cos(Math.PI / 5);

  function queryRoad(x, z, out, alignTo) {
    out.dist = Infinity;
    out.lateral = 0;
    out.kind = null;
    out.halfWidth = 0;
    out.pavement = 0;
    out.lanes = 0;
    out.heading = 0;

    const consider = (signed, spec, kind, heading) => {
      // A road is bidirectional, so |cos| — heading and heading + PI are
      // the same piece of tarmac.
      if (alignTo !== null && Math.abs(Math.cos(heading - alignTo)) < ALIGNED) return;
      const d = Math.abs(signed) - spec.halfWidth;
      if (d >= out.dist) return;
      out.dist = d;
      out.lateral = signed;
      out.kind = kind;
      out.halfWidth = spec.halfWidth;
      out.pavement = spec.pavement;
      out.lanes = spec.lanes;
      out.heading = heading;
    };

    // Motorways: one lattice line every four kilometres, both axes.
    // The sign convention is the road's right-hand normal, which for a
    // line running along +z is +x, and for one along +x is -z.
    consider(x - nearestMultiple(x, MOTORWAY_GRID), ROADS.motorway, 'motorway', 0);
    consider(-(z - nearestMultiple(z, MOTORWAY_GRID)), ROADS.motorway, 'motorway', Math.PI / 2);

    // Boulevards: every superblock edge that is not already a motorway.
    const bx = nearestMultiple(x, SUPERBLOCK);
    if (bx % MOTORWAY_GRID !== 0) consider(x - bx, ROADS.boulevard, 'boulevard', 0);
    const bz = nearestMultiple(z, SUPERBLOCK);
    if (bz % MOTORWAY_GRID !== 0) consider(-(z - bz), ROADS.boulevard, 'boulevard', Math.PI / 2);

    // Local streets, in the superblock's own rotated frame.
    const sb = superblockAt(x, z);
    if (sb.spacing > 0) {
      const dx = x - sb.cx;
      const dz = z - sb.cz;
      const u = dx * sb.cos + dz * sb.sin;
      const v = -dx * sb.sin + dz * sb.cos;
      const sp = sb.spacing;
      consider(u - nearestMultiple(u, sp), ROADS.street, 'street', -sb.rotation);
      consider(-(v - nearestMultiple(v, sp)), ROADS.street, 'street', Math.PI / 2 - sb.rotation);
    }

    return out;
  }

  // ── Bridges ──────────────────────────────────────────

  const bridgeScratch = { bridge: null, y: 0, ramp: 0, lateral: 0, halfWidth: 0 };
  /** Deck half-width including the parapet the car cannot cross. */
  const DECK_HALF = ROADS.motorway.halfWidth + 1.6;

  function bridgeAt(x, z, out = bridgeScratch) {
    for (const bridge of BRIDGES) {
      const lateral = z - bridge.z;
      if (Math.abs(lateral) > DECK_HALF + 24) continue;

      const centre = straitCentre(bridge.z);
      const water = straitHalf(bridge.z);
      const spanHalf = water + bridge.approach;
      const along = Math.abs(x - centre);
      if (along > spanHalf) continue;

      // Flat over the water, ramping down to meet the ground on the
      // approaches. Blending against the live terrain height means the
      // abutment always lands exactly on the road it continues.
      const ramp = 1 - smoothstep(water / spanHalf, 1, along / spanHalf);
      if (ramp <= 0.001) continue;

      out.bridge = bridge;
      out.ramp = ramp;
      out.lateral = lateral;
      out.halfWidth = DECK_HALF;
      out.y = lerp(heightAt(x, z), bridge.deckHeight, ramp);
      return out;
    }
    out.bridge = null;
    return null;
  }

  // ── The surface under the wheels ─────────────────────

  const surfaceScratch = {
    y: 0, surface: SURFACE.OFF, dist: 0, kind: null,
    water: false, bridge: null, heading: 0,
  };

  function sampleSurface(x, z, out = surfaceScratch) {
    const deck = bridgeAt(x, z);
    if (deck) {
      out.y = deck.y;
      out.bridge = deck.bridge;
      out.water = false;
      out.kind = 'bridge';
      out.heading = Math.PI / 2;
      const over = Math.abs(deck.lateral) - ROADS.motorway.halfWidth;
      out.dist = over;
      out.surface = over <= 0 ? SURFACE.TRACK : SURFACE.KERB;
      return out;
    }

    out.bridge = null;
    const shore = shoreDistance(x, z);
    if (shore <= 0) {
      out.y = heightAt(x, z);
      out.water = true;
      out.kind = null;
      out.dist = -shore;
      out.surface = SURFACE.OFF;
      return out;
    }

    const road = roadAt(x, z);
    out.water = false;
    out.y = heightAt(x, z);
    out.dist = road.dist;
    out.kind = road.kind;
    out.heading = road.heading;
    out.surface = road.dist <= 0
      ? SURFACE.TRACK
      : road.dist <= road.pavement
        ? SURFACE.KERB
        : SURFACE.OFF;
    return out;
  }

  /**
   * Nearest point on the road network, found by walking down the
   * distance field. Used to drop the player back on tarmac and to spawn
   * traffic without needing a graph of the whole city in memory.
   */
  function snapToRoad(x, z, out = { x: 0, z: 0, heading: 0, kind: null }) {
    let px = x;
    let pz = z;
    for (let i = 0; i < 24; i++) {
      const road = roadAt(px, pz, roadScratch);
      if (road.dist <= -1) break;
      const e = 2;
      const gx = roadAt(px + e, pz, {}).dist - roadAt(px - e, pz, {}).dist;
      const gz = roadAt(px, pz + e, {}).dist - roadAt(px, pz - e, {}).dist;
      const len = Math.hypot(gx, gz) || 1;
      const step = Math.min(road.dist + 2, 80);
      px -= (gx / len) * step;
      pz -= (gz / len) * step;
    }
    const road = roadAt(px, pz, {});
    out.x = px;
    out.z = pz;
    out.heading = road.heading;
    out.kind = road.kind;
    return out;
  }

  /** A place to start a drive: on tarmac, on land, clear of a bridge. */
  function spawnNear(x, z) {
    const point = snapToRoad(x, z, {});
    for (let attempt = 0; attempt < 8; attempt++) {
      if (!isWater(point.x, point.z)) break;
      snapToRoad(x + (attempt + 1) * 240, z + (attempt + 1) * 190, point);
    }
    return {
      x: point.x,
      z: point.z,
      y: heightAt(point.x, point.z),
      heading: point.heading,
    };
  }

  return {
    seed,
    chunkSize: CHUNK,
    districts: DISTRICTS,

    straitCentre,
    straitHalf,
    shoreDistance,
    shoreNormal,
    isWater,

    intensityAt,
    heightAt,
    districtAt,
    superblockAt,
    superblockAtIndex,

    roadAt,
    roadAlong,
    bridgeAt,
    sampleSurface,
    snapToRoad,
    spawnNear,

    /** Circuit-compatible fields the rest of the engine reads. */
    clamp,
    bounds: { minX: -WORLD_HALF, maxX: WORLD_HALF, minZ: -WORLD_HALF, maxZ: WORLD_HALF },
  };
}
