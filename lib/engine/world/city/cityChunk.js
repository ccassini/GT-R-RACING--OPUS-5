// ═══════════════════════════════════════════════════════
//  CHUNK — 512 metres of city, built on demand
//
//  Ground first, then the road network, then whatever is standing on
//  the blocks between the roads. Every chunk is built from the map
//  functions alone, so two visits to the same corner produce identical
//  geometry and nothing has to be remembered in between.
//
//  Roads are ribbons rather than painted terrain. The alternative —
//  colouring the ground mesh — needs a vertex every two metres to make
//  a five-metre lane look like a lane, which is four hundred times the
//  geometry for the ninety percent of a chunk that is not road.
//
//  ── Junctions ──
//  A ribbon carries its own footways, baked into the texture either
//  side of the carriageway. That is one draw call instead of three and
//  it puts the kerb exactly where the paint is, but it means a road
//  drawn straight through a crossroads drags its pavement across the
//  other road's carriageway. So a crossing is built explicitly:
//
//    · the through road stops its full-width ribbon short of the
//      crossing and lays a carriageway-only slab across it,
//    · the giving-way road runs up to the through road's kerb line.
//
//  Rank decides which is which — wider class first, and within a class
//  the one running north-south. The result tiles exactly: no ribbon
//  ever overlaps another, so nothing z-fights, and no gap is left for
//  the ground to show through.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';
import { smoothstep } from '../../util.js';
import { CHUNK, MOTORWAY_GRID, ROADS, SUPERBLOCK } from './cityConfig.js';
import { ROAD_TEXTURE_METRES } from './cityMaterials.js';
import { buildBlocks } from './cityBuildings.js';

/** Ground resolution. 32 segments over 512 m is a 16 m facet. */
const GROUND_SEGMENTS = 32;
/** Metres between ribbon cross-sections. Roads follow the hills at this. */
const RIBBON_STEP = 12;
/** How far the road floats over the ground mesh. */
const ROAD_LIFT = 0.12;

/**
 * Precedence. The `+1` goes to the line running north-south, or to a
 * street grid's u lines, so that two roads of the same class still have
 * an unambiguous winner at every crossing.
 */
const RANK = { motorway: 6, boulevard: 4, street: 2 };

export function buildChunk({ map, materials, theme, quality, cx, cz }) {
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  const rect = { x0, z0, x1: x0 + CHUNK, z1: z0 + CHUNK };

  const group = new THREE.Group();
  group.name = `chunk:${cx},${cz}`;
  const geometries = [];

  const lines = collectRoadLines(map, rect);
  addGround(group, geometries, map, materials, theme, rect);
  addRoads(group, geometries, map, materials, rect, lines);
  const blocks = buildBlocks({ group, geometries, map, materials, theme, quality, rect, lines });

  return {
    group,
    /** Oriented boxes the player and the traffic have to drive around. */
    obstacles: blocks.obstacles,
    dispose() {
      group.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      geometries.length = 0;
      group.clear();
    },
  };
}

// ── Road lines ─────────────────────────────────────────
// Every road is one infinite straight, described parametrically. That
// makes a crossing a two-line solve rather than four special cases, and
// it is the only reason a street grid at twenty degrees to the
// boulevard beside it can be clipped against it at all.

export function collectRoadLines(map, rect) {
  const sb = map.superblockAtIndex(
    Math.floor(rect.x0 / SUPERBLOCK),
    Math.floor(rect.z0 / SUPERBLOCK),
    {},
  );

  const margin = ROADS.motorway.halfWidth + ROADS.motorway.pavement + 4;
  /** Kept separately for the street lights, which only dress arterials. */
  const alongZ = [];
  const alongX = [];
  const all = [];

  const add = (kind, primary, origin, dir, bounds = null, drawable = true) => {
    all.push({
      kind,
      spec: ROADS[kind],
      rank: RANK[kind] + (primary ? 1 : 0),
      origin,
      dir,
      /** Where this line exists at all. Null means everywhere. */
      bounds,
      /** False for a neighbour's street: it clips, but this chunk does
       *  not draw it — the chunk that owns that superblock does. */
      drawable,
      /** Cached for the building placer, which needs it per lot. */
      heading: Math.atan2(dir.x, dir.z),
    });
  };

  for (const [step, kind] of [[MOTORWAY_GRID, 'motorway'], [SUPERBLOCK, 'boulevard']]) {
    for (let X = ceilTo(rect.x0 - margin, step); X <= rect.x1 + margin; X += step) {
      if (kind === 'boulevard' && X % MOTORWAY_GRID === 0) continue;
      alongZ.push({ kind, at: X });
      // Parameter along the line is world z, so the lane markings on a
      // motorway line up across every chunk it passes through.
      add(kind, true, { x: X, z: 0 }, { x: 0, z: 1 });
    }
    for (let Z = ceilTo(rect.z0 - margin, step); Z <= rect.z1 + margin; Z += step) {
      if (kind === 'boulevard' && Z % MOTORWAY_GRID === 0) continue;
      alongX.push({ kind, at: Z });
      add(kind, false, { x: 0, z: Z }, { x: 1, z: 0 });
    }
  }

  // Street grids. This chunk's own superblock, and — where the chunk
  // sits against a superblock edge — the neighbour's as well.
  //
  // A boulevard runs along that edge, and its footway reaches thirteen
  // metres past it into territory where a completely different street
  // grid applies. Without the neighbour's lines in the set, nothing
  // cuts the boulevard's ribbon where those streets meet it, and the
  // two are drawn in the same plane.
  let streets = { u: [], v: [], spacing: 0 };
  for (let dsx = -1; dsx <= 1; dsx++) {
    for (let dsz = -1; dsz <= 1; dsz++) {
      const own = dsx === 0 && dsz === 0;
      const nb = own ? sb : map.superblockAtIndex(sb.sx + dsx, sb.sz + dsz, {});
      if (nb.spacing <= 0) continue;

      const bounds = {
        x0: nb.sx * SUPERBLOCK, z0: nb.sz * SUPERBLOCK,
        x1: (nb.sx + 1) * SUPERBLOCK, z1: (nb.sz + 1) * SUPERBLOCK,
      };
      if (!own && !overlaps(bounds, rect, margin)) continue;

      const offsets = streetOffsets(nb, rect);
      if (own) streets = offsets;

      const uDir = { x: nb.cos, z: nb.sin };
      const vDir = { x: -nb.sin, z: nb.cos };
      for (const U of offsets.u) {
        add('street', true, { x: nb.cx + uDir.x * U, z: nb.cz + uDir.z * U }, vDir, bounds, own);
      }
      for (const V of offsets.v) {
        add('street', false, { x: nb.cx + vDir.x * V, z: nb.cz + vDir.z * V }, uDir, bounds, own);
      }
    }
  }

  return { sb, alongZ, alongX, streets, all };
}

const overlaps = (bounds, rect, margin) =>
  bounds.x0 - margin < rect.x1 && bounds.x1 + margin > rect.x0
  && bounds.z0 - margin < rect.z1 && bounds.z1 + margin > rect.z0;

/**
 * Which local grid lines reach this chunk. A chunk always sits inside
 * exactly one superblock — 512 divides 2048 on the same origin — so
 * there is never more than one grid to mix.
 */
function streetOffsets(sb, rect) {
  if (sb.spacing <= 0) return { u: [], v: [], spacing: 0 };

  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const [x, z] of [
    [rect.x0, rect.z0], [rect.x1, rect.z0], [rect.x0, rect.z1], [rect.x1, rect.z1],
  ]) {
    const dx = x - sb.cx;
    const dz = z - sb.cz;
    const u = dx * sb.cos + dz * sb.sin;
    const v = -dx * sb.sin + dz * sb.cos;
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }

  const sp = sb.spacing;
  const pad = ROADS.street.halfWidth + ROADS.street.pavement;
  const u = [];
  const v = [];
  for (let k = Math.ceil((uMin - pad) / sp); k <= (uMax + pad) / sp; k++) u.push(k * sp);
  for (let k = Math.ceil((vMin - pad) / sp); k <= (vMax + pad) / sp; k++) v.push(k * sp);
  return { u, v, spacing: sp };
}

// ── Ground ─────────────────────────────────────────────

function addGround(group, geometries, map, materials, theme, rect) {
  const seg = GROUND_SEGMENTS;
  const geometry = new THREE.PlaneGeometry(CHUNK, CHUNK, seg, seg);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(rect.x0 + CHUNK / 2, 0, rect.z0 + CHUNK / 2);

  const position = geometry.attributes.position;
  const count = position.count;
  const colors = new Float32Array(count * 3);

  const tone = new THREE.Color();
  const water = new THREE.Color(theme.terrain.waterDeep);
  const sand = new THREE.Color(theme.terrain.sand);
  // Forecourt paving, a shade down from the footway so the kerb line
  // still reads against it.
  const forecourt = new THREE.Color(theme.road.apron).multiplyScalar(0.6);
  const district = {};
  const road = {};

  for (let i = 0; i < count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const shore = map.shoreDistance(x, z);
    let y = map.heightAt(x, z);

    // A shallow trough under the carriageway. Without it a ribbon laid
    // flat across a cross-slope has the hillside poking through its
    // outside edge, which is the one artefact that instantly reads as
    // "generated" from a low camera.
    map.roadAt(x, z, road);
    if (road.dist < 14) y -= 0.4 * smoothstep(14, 0, road.dist);
    position.setY(i, y);

    if (shore <= 0) {
      tone.copy(water);
    } else {
      map.districtAt(x, z, district);
      tone.set(district.spec.ground);

      // The strip between the kerb and the building line is paved, not
      // planted. Buildings stand back a few metres from the footway and
      // without this that gap is a dark trench running the length of
      // every street in the city.
      const built = Math.min(1, district.spec.coverage * 1.4);
      // Narrow, now that the footways carry most of the width: this only
      // has to bridge the metre or two between kerb and wall.
      if (built > 0 && road.dist < road.pavement + 12) {
        const paved = 1 - smoothstep(road.pavement + 1, road.pavement + 12, road.dist);
        tone.lerp(forecourt, paved * built * 0.8);
      }

      // Beaches, and a little tonal drift so a whole chunk is never one
      // flat colour under the low-poly shading.
      tone.lerp(sand, Math.max(0, 1 - shore / 90) * 0.7);
      const drift = map.intensityAt(x, z);
      tone.multiplyScalar(0.9 + drift * 0.22 + (((i * 2654435761) >>> 24) / 255) * 0.08);
    }

    colors[i * 3] = tone.r;
    colors[i * 3 + 1] = tone.g;
    colors[i * 3 + 2] = tone.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometries.push(geometry);

  const mesh = new THREE.Mesh(geometry, materials.ground);
  mesh.receiveShadow = true;
  group.add(mesh);
}

// ── Roads ──────────────────────────────────────────────

function addRoads(group, geometries, map, materials, rect, lines) {
  const builders = new Map();
  const builderFor = (key) => {
    let builder = builders.get(key);
    if (!builder) {
      builder = createRibbonBuilder();
      builders.set(key, builder);
    }
    return builder;
  };

  for (const line of lines.all) {
    if (!line.drawable) continue;
    const spans = roadSpansFor(lines.all, line, rect);
    if (!spans) continue;

    for (const [a, b] of spans.full) {
      emitRibbon(builderFor(`${line.kind}:road`), map, line, a, b, true);
    }
    for (const [a, b] of spans.junction) {
      emitRibbon(builderFor(`${line.kind}:junction`), map, line, a, b, false);
    }
  }

  for (const [key, builder] of builders) {
    const geometry = builder.finish();
    if (!geometry) continue;
    geometries.push(geometry);
    const [kind, surface] = key.split(':');
    const material = surface === 'junction' ? materials.junction[kind] : materials.road[kind];
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    group.add(mesh);
  }
}

/**
 * Split one line into the runs drawn at full width, footways included,
 * and the runs drawn as bare carriageway across a crossing.
 *
 * Pulled out of the mesh builder so the tiling rule can be tested
 * without a renderer. The property that matters — that no road's
 * footway is ever laid across another road's carriageway — is a fact
 * about these intervals, not about the triangles they become.
 *
 * @returns {{ full: number[][], junction: number[][] } | null}
 */
export function roadSpansFor(allLines, line, rect) {
  const span = clipToRect(line.origin, line.dir, rect);
  if (!span) return null;

  const cuts = [];
  const junctions = [];
  /** How far this ribbon reaches from its own centreline. */
  const lateral = line.spec.halfWidth + line.spec.pavement;

  for (const other of allLines) {
    if (other === line) continue;
    const outranked = other.rank > line.rank;

    // A rotated street grid can throw a line almost parallel to the
    // arterial along its superblock edge, a few metres off the kerb.
    // There is no junction to build there — the bigger road simply
    // swallows the smaller one, so the smaller one is not drawn.
    if (outranked && swallowedBy(line, other, span)) return null;
    // Give way to a wider road at its kerb line; clear a narrower one by
    // its whole ribbon, because the slab laid across the crossing has to
    // reach past where that road's footway would otherwise have run.
    const clearance = outranked
      ? other.spec.halfWidth
      : other.spec.halfWidth + other.spec.pavement;

    // The crossing is measured between centrelines, but what has to
    // clear the other road is the ribbon's outside edge. Where the two
    // roads meet at an angle, a point thirteen metres off this
    // centreline sits a good deal closer to the other one — so the cut
    // has to grow by this ribbon's own reach, projected onto the other
    // road's normal. Skipping this term is what leaves a footway lying
    // across a carriageway at every skewed junction in the city.
    const skew = Math.abs(line.dir.x * other.dir.x + line.dir.z * other.dir.z);
    const interval = crossingInterval(line, other, clearance + lateral * skew);
    if (!interval) continue;
    // A street only exists inside its own superblock. Cutting against
    // the line where it has been extended past that would carve gaps
    // out of roads that nothing actually crosses.
    if (!crossingIsReal(line, other, interval, span)) continue;

    cuts.push(interval);
    if (!outranked) junctions.push(interval);
  }

  return {
    full: subtract([span], cuts).filter(([a, b]) => b - a >= 2),
    // Merged, because two narrow streets crossing within a few metres of
    // each other would otherwise lay two slabs in the same plane.
    junction: merge(junctions, span).filter(([a, b]) => b - a >= 0.5),
  };
}

/**
 * Does the crossing fall where the cutting line actually exists?
 *
 * The tolerance matters: a superblock's rectangle is half-open, and the
 * boulevard that has to be cut runs exactly along its far edge. Testing
 * the bare bounds rejects every crossing on that edge — which is most
 * of the crossings a boulevard has.
 */
function crossingIsReal(line, other, interval, span) {
  if (!other.bounds) return true;
  // Measured where the crossing actually meets this road. For two lines
  // a few degrees off parallel the raw interval runs for hundreds of
  // metres, and its midpoint can be nowhere near the chunk.
  const lo = Math.max(interval[0], span[0]);
  const hi = Math.min(interval[1], span[1]);
  if (hi < lo) return false;
  const mid = (lo + hi) / 2;
  const x = line.origin.x + line.dir.x * mid;
  const z = line.origin.z + line.dir.z * mid;
  const b = other.bounds;
  const slack = other.spec.halfWidth + other.spec.pavement;
  return x >= b.x0 - slack && x < b.x1 + slack
    && z >= b.z0 - slack && z < b.z1 + slack;
}

/**
 * Is `line` running close enough to parallel with `other`, and near
 * enough to it, that `other`'s ribbon covers it outright?
 *
 * Two roads meeting at an angle make a junction. Two roads running a
 * few degrees apart and a few metres apart make a mess: there is no
 * crossing to cut, just two strips of asphalt in the same plane for
 * hundreds of metres.
 */
function swallowedBy(line, other, span) {
  const nx = other.dir.z;
  const nz = -other.dir.x;
  const along = line.dir.x * nx + line.dir.z * nz;
  // |along| is the sine of the angle between the two roads.
  if (Math.abs(along) > 0.26) return false;

  const offset = (line.origin.x - other.origin.x) * nx + (line.origin.z - other.origin.z) * nz;
  const reach = other.spec.halfWidth + other.spec.pavement
    + line.spec.halfWidth + line.spec.pavement;
  // Checked at both ends: a shallow angle means the gap changes along
  // the run, and only the part inside this chunk matters.
  return Math.abs(offset + along * span[0]) < reach
    || Math.abs(offset + along * span[1]) < reach;
}

/**
 * Where one line passes within `reach` metres of another's centreline,
 * as an interval in the first line's own parameter. Null when they are
 * parallel, which is most pairs in a grid.
 */
function crossingInterval(line, other, reach) {
  const nx = other.dir.z;
  const nz = -other.dir.x;
  const along = line.dir.x * nx + line.dir.z * nz;
  if (Math.abs(along) < 1e-6) return null;

  const offset = (line.origin.x - other.origin.x) * nx + (line.origin.z - other.origin.z) * nz;
  const a = (-reach - offset) / along;
  const b = (reach - offset) / along;
  return a < b ? [a, b] : [b, a];
}

/** Liang–Barsky against the chunk rectangle, in the line's own parameter. */
function clipToRect(origin, dir, rect) {
  let t0 = -Infinity;
  let t1 = Infinity;
  const edges = [
    [-dir.x, origin.x - rect.x0],
    [dir.x, rect.x1 - origin.x],
    [-dir.z, origin.z - rect.z0],
    [dir.z, rect.z1 - origin.z],
  ];
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return t1 - t0 > 1 ? [t0, t1] : null;
}

/**
 * Interval subtraction. Small n, so the obvious O(n·m) is the right one.
 *
 * Exported for its own test: everything that stops two road ribbons
 * sharing a plane comes down to this function being right, and the
 * symptom of it being wrong — a junction that flickers only at certain
 * camera angles — is close to undebuggable from the outside.
 */
export function subtract(spans, cuts) {
  let result = spans;
  for (const [ca, cb] of cuts) {
    const next = [];
    for (const [a, b] of result) {
      if (cb <= a || ca >= b) {
        next.push([a, b]);
        continue;
      }
      if (ca > a) next.push([a, ca]);
      if (cb < b) next.push([cb, b]);
    }
    result = next;
    if (result.length === 0) break;
  }
  return result;
}

/** Union of overlapping intervals, clamped to `bounds`. */
export function merge(intervals, bounds) {
  if (intervals.length === 0) return [];
  const sorted = intervals
    .map(([a, b]) => [Math.max(a, bounds[0]), Math.min(b, bounds[1])])
    .filter(([a, b]) => b > a)
    .sort((p, q) => p[0] - q[0]);

  const out = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else out.push([span[0], span[1]]);
  }
  return out;
}

// ── Ribbons ────────────────────────────────────────────

function createRibbonBuilder() {
  const positions = [];
  const uvs = [];
  const indices = [];
  return {
    /** One cross-section: two vertices, and a quad back to the last pair. */
    push(lx, ly, lz, rx, ry, rz, v, stitch) {
      const base = positions.length / 3;
      positions.push(lx, ly, lz, rx, ry, rz);
      uvs.push(0, v, 1, v);
      if (stitch) {
        indices.push(base - 2, base - 1, base, base - 1, base + 1, base);
      }
    },
    finish() {
      if (indices.length === 0) return null;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      return geometry;
    },
  };
}

const surfaceProbe = {};

/**
 * Lay one run of road between two parameters on a line, following the
 * ground under it. Height comes from the full surface query rather than
 * the terrain, which is what lifts a motorway onto a bridge deck
 * without this function knowing bridges exist.
 *
 * The texture's v coordinate is the line parameter itself, so lane
 * dashes continue across a chunk boundary without a seam.
 */
function emitRibbon(builder, map, line, from, to, withPavement) {
  const length = to - from;
  if (length < 1) return;

  const half = withPavement
    ? line.spec.halfWidth + line.spec.pavement
    : line.spec.halfWidth;
  const nx = -line.dir.z * half;
  const nz = line.dir.x * half;

  const steps = Math.max(1, Math.round(length / RIBBON_STEP));
  let stitch = false;

  for (let i = 0; i <= steps; i++) {
    const s = from + (length * i) / steps;
    const x = line.origin.x + line.dir.x * s;
    const z = line.origin.z + line.dir.z * s;
    map.sampleSurface(x, z, surfaceProbe);

    // Roads stop at the water's edge — unless the water has a bridge
    // over it, in which case the same query already returned the deck.
    if (surfaceProbe.water) {
      stitch = false;
      continue;
    }

    // Each kerb gets its own height. Holding the ribbon flat across its
    // width was what forced the whole map to be gently rolling: on a
    // real gradient a thirty-metre carriageway would then float several
    // metres clear of the hillside on its uphill side. Cambered like
    // this, the roads lie on the ground and the ground can have hills.
    const v = s / ROAD_TEXTURE_METRES;
    const y = surfaceProbe.y + ROAD_LIFT;
    const left = crossHeight(map, x - nx, z - nz, y, surfaceProbe);
    const right = crossHeight(map, x + nx, z + nz, y, surfaceProbe);
    builder.push(x - nx, left, z - nz, x + nx, right, z + nz, v, stitch);
    stitch = true;
  }
}

/**
 * Height at one kerb. A bridge deck stays dead level — its parapet is
 * not going to follow the seabed — so the centre height wins there.
 */
function crossHeight(map, x, z, centreY, centreProbe) {
  if (centreProbe.bridge) return centreY;
  const probe = map.sampleSurface(x, z, edgeProbe);
  if (probe.water || probe.bridge) return centreY;
  return probe.y + ROAD_LIFT;
}

const edgeProbe = {};

const ceilTo = (value, step) => Math.ceil(value / step) * step;
