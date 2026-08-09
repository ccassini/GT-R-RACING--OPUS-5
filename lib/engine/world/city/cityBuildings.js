// ═══════════════════════════════════════════════════════
//  BLOCKS — what stands between the roads
//
//  The street grid already divides a superblock into cells. This module
//  takes each cell, sets it back from the kerb, subdivides what is left
//  into lots, and puts a building on each one sized by the district it
//  landed in. A cell belongs to whichever chunk contains its centre, so
//  a building is generated exactly once no matter how many chunk
//  borders it straddles.
//
//  Anything over seventy metres is stepped rather than extruded. A
//  two-hundred-metre box is a two-hundred-metre box from any angle; two
//  setbacks and a crown cost two extra instances and are the difference
//  between a skyline and a bar chart.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';
import { clamp01, lerp, makeRng, rngPick, rngRange } from '../../util.js';
import { ROADS, SUPERBLOCK, hash2i } from './cityConfig.js';

/**
 * Metres between the kerb and the nearest wall. Deliberately small: a
 * dense city has its buildings on the footway, and every metre of
 * setback here becomes a metre of bare ground running the length of
 * every street.
 */
const SETBACK = 1.6;
/** A lot smaller than this is not worth a building. */
const MIN_LOT = 7;
/** Above this height a building gets stepped instead of extruded. */
const TOWER_THRESHOLD = 70;

/**
 * Metres of wall covered by one repeat of each facade texture. The
 * facade tile is six bays by eight floors, the curtain wall eight by
 * ten — these are those counts turned into real dimensions.
 */
const FACADE_TILE = { width: 21, height: 25.6 };
const CURTAIN_TILE = { width: 21, height: 34 };
const ROOF_TILE = { width: 20, height: 20 };

export function buildBlocks({ group, geometries, map, materials, theme, quality, rect, lines }) {
  const sb = lines.sb;
  const sink = { walls: [], glass: [], roofs: [], obstacles: [] };
  const trees = [];
  const lamps = [];

  if (sb.spacing > 0) collectLots(map, theme, sb, rect, sink, lines.all);
  collectTrees(map, rect, quality, trees);
  collectLamps(map, rect, lines, quality, lamps);

  addMerged(group, geometries, materials.wall, sink.walls, FACADE_TILE);
  addMerged(group, geometries, materials.glass, sink.glass, CURTAIN_TILE);
  addMerged(group, geometries, materials.roof, sink.roofs, ROOF_TILE);
  addInstanced(group, geometries, materials.shape.tree, materials.foliage, trees, false);
  addInstanced(group, geometries, materials.shape.lamp, materials.furniture, lamps, false);

  return { obstacles: sink.obstacles };
}

function addMerged(group, geometries, material, boxes, tile) {
  if (boxes.length === 0) return;
  const builder = createBoxBuilder(tile.width, tile.height);
  for (const box of boxes) builder.add(box);

  const geometry = builder.finish();
  if (!geometry) return;
  geometries.push(geometry);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

// ── Lots ───────────────────────────────────────────────

/**
 * Turn a superblock's cells into building lots.
 *
 * Exported because it is the half of this module worth testing: it is
 * pure — map queries in, plain records out, no Three.js — and the
 * invariant it has to hold, that no wall ever stands in a road, is
 * invisible from anywhere else in the codebase.
 */
export function collectLots(map, theme, sb, rect, sink, roadLines) {
  const sp = sb.spacing;
  const kerb = ROADS.street.halfWidth + ROADS.street.pavement;
  const usable = sp - 2 * (kerb + SETBACK);
  if (usable < MIN_LOT) return;

  // Cell centres sit halfway between street lines, so they are offset
  // by half a spacing from the grid the roads were drawn on.
  const range = localRange(sb, rect, sp);
  const district = {};
  const road = {};

  for (let i = range.iMin; i <= range.iMax; i++) {
    for (let j = range.jMin; j <= range.jMax; j++) {
      const u = (i + 0.5) * sp;
      const v = (j + 0.5) * sp;
      const x = sb.cx + u * sb.cos - v * sb.sin;
      const z = sb.cz + u * sb.sin + v * sb.cos;

      // One owner per cell: the chunk its centre falls in.
      if (x < rect.x0 || x >= rect.x1 || z < rect.z0 || z >= rect.z1) continue;
      if (map.isWater(x, z)) continue;

      // A cell whose centre is on an arterial is gone; a cell merely
      // beside one keeps whichever lots clear the kerb. Rejecting the
      // whole cell instead left a sixty-metre dead band of bare ground
      // along both sides of every boulevard in the city.
      map.roadAt(x, z, road);
      if (road.kind !== 'street' && road.dist < 0) continue;

      map.districtAt(x, z, district);
      const spec = district.spec;
      if (spec.coverage <= 0) continue;

      const rng = makeRng(hash2i(i, j, sb.hash ^ 0x2f19));
      if (rng() > spec.coverage) continue;

      fillCell({ map, theme, sb, spec, district, x, z, usable, rng, sink, roadLines });
    }
  }
}

function fillCell({ map, theme, sb, spec, district, x, z, usable, rng, sink, roadLines }) {
  const monolith = rng() < spec.monolith;
  // Lot size is the district's, not a global guess. A works district
  // subdivided at thirty metres is a field of sheds with yards between
  // them; at seventy it is the warehouses it should have been.
  const target = spec.lotSize;
  const cols = monolith ? 1 : Math.max(1, Math.round(usable / rngRange(rng, target * 0.8, target * 1.3)));
  const rows = monolith ? 1 : Math.max(1, Math.round(usable / rngRange(rng, target * 0.8, target * 1.3)));
  const lotW = usable / cols;
  const lotD = usable / rows;
  if (Math.min(lotW, lotD) < MIN_LOT) return;

  for (let a = 0; a < cols; a++) {
    for (let b = 0; b < rows; b++) {
      if (!monolith && rng() > 0.88) continue;

      const offU = -usable / 2 + lotW * (a + 0.5);
      const offV = -usable / 2 + lotD * (b + 0.5);
      const bx = x + offU * sb.cos - offV * sb.sin;
      const bz = z + offU * sb.sin + offV * sb.cos;
      if (map.isWater(bx, bz)) continue;

      const inset = rngRange(rng, 0.2, 1.1);
      const w = Math.max(MIN_LOT * 0.7, lotW - inset * 2);
      const d = Math.max(MIN_LOT * 0.7, lotD - inset * 2);

      // A mesh rotated by `rotation.y = t` points its local +X at
      // (cos t, -sin t), but the superblock's u axis is (cos t, +sin t).
      // Handing the grid angle straight to the mesh therefore turns
      // every building by twice the superblock angle, and the corners
      // end up out in the road.
      const rot = -sb.rotation + rngRange(rng, -0.02, 0.02);

      // Nothing gets built in a road. Checked per lot rather than per
      // cell, so a block beside a motorway still gets the buildings
      // that do fit beside it.
      if (!clearsRoads(roadLines, bx, bz, w, d, rot)) continue;

      // Tall is rare — but the floor matters more than the ceiling.
      // Scaling the whole range by intensity collapsed every outlying
      // district to the bottom of its own band: a port five kilometres
      // from any centre got nothing but eight-metre sheds, because the
      // intensity field there is legitimately zero. Intensity now moves
      // the ceiling, and the district's own range sets the rest.
      const shape = Math.pow(rng(), 2.8);
      const reach = 0.55 + clamp01(district.intensity) * 0.45;
      const height = lerp(spec.height[0], spec.height[1], clamp01(0.15 + shape * reach));
      const y = map.heightAt(bx, bz);

      emitBuilding({ theme, spec, rng, x: bx, z: bz, y, w, d, height, rot, sink });
      sink.obstacles.push({ x: bx, z: bz, halfW: w / 2, halfD: d / 2, rot, height });
    }
  }
}

/** Metres of daylight left between a wall and the edge of the pavement. */
const ROAD_CLEARANCE = 0.7;

/**
 * Does an oriented lot clear every road near it, pavement included?
 *
 * Checked against the whole line set rather than against the nearest
 * road, because "nearest" is measured to the carriageway and the road
 * classes are not the same width: a boulevard whose kerb is further
 * away than a side street's still has five metres of footway reaching
 * past it, and a lot that passed the single-road test would have a
 * corner standing in it.
 *
 * The test itself is exact. What decides whether a corner reaches the
 * kerb is the rectangle's support radius along the road's normal, and
 * a circumscribed circle over-rejects so badly for the long thin lots
 * that line a boulevard that it empties the block instead.
 */
function clearsRoads(roadLines, x, z, w, d, rot) {
  if (!roadLines) return true;

  for (const line of roadLines) {
    const nx = line.dir.z;
    const nz = -line.dir.x;
    const perp = Math.abs((x - line.origin.x) * nx + (z - line.origin.z) * nz);
    const outer = line.spec.halfWidth + line.spec.pavement;
    // Cheap reject before the trigonometry: nothing can reach further
    // than half the lot's diagonal.
    if (perp > outer + (w + d) * 0.5 + ROAD_CLEARANCE) continue;

    // A mesh turned by `rot` has axes (cos rot, -sin rot) and
    // (sin rot, cos rot); the road normal is (cos h, -sin h).
    const delta = rot - line.heading;
    const reach = (w / 2) * Math.abs(Math.cos(delta)) + (d / 2) * Math.abs(Math.sin(delta));
    if (perp < outer + reach + ROAD_CLEARANCE) return false;
  }
  return true;
}

function emitBuilding({ theme, spec, rng, x, z, y, w, d, height, rot, sink }) {
  const isTower = height > TOWER_THRESHOLD;
  const target = isTower && rng() < 0.62 ? sink.glass : sink.walls;
  const wallColor = isTower
    ? rngPick(rng, theme.city.wall)
    : rngPick(rng, spec.wall);
  const roofColor = rngPick(rng, spec.roof);

  if (!isTower) {
    target.push({ x, z, y: y + height / 2, w, h: height, d, rot, color: wallColor });
    sink.roofs.push({
      x, z, y: y + height + 0.35, w: w * 1.05, h: 0.7, d: d * 1.05, rot, color: roofColor,
    });
    // A plant room, offset so the roof reads as a roof from above.
    if (height > 14) {
      sink.roofs.push({
        x: x + Math.cos(rot) * w * 0.18,
        z: z - Math.sin(rot) * d * 0.18,
        y: y + height + 1.9,
        w: w * 0.3, h: 2.4, d: d * 0.3, rot,
        color: roofColor,
      });
    }
    return;
  }

  // Stepped tower: podium, shaft, crown. Each stage keeps the one under
  // it visible, which is what gives a skyline its silhouette.
  const podium = Math.min(height * 0.22, rngRange(rng, 12, 26));
  const crown = rngRange(rng, 0.12, 0.2) * height;
  const shaft = height - podium - crown;

  target.push({ x, z, y: y + podium / 2, w, h: podium, d, rot, color: wallColor });
  target.push({
    x, z, y: y + podium + shaft / 2,
    w: w * 0.84, h: shaft, d: d * 0.84, rot, color: wallColor,
  });
  target.push({
    x, z, y: y + podium + shaft + crown / 2,
    w: w * 0.62, h: crown, d: d * 0.62, rot, color: wallColor,
  });
  sink.roofs.push({
    x, z, y: y + height + 1.4,
    w: w * 0.18, h: 2.8, d: d * 0.18, rot, color: roofColor,
  });
  // A mast on the tallest of them, so the horizon has punctuation.
  if (height > 150) {
    sink.roofs.push({
      x, z, y: y + height + rngRange(rng, 8, 22),
      w: 0.9, h: rngRange(rng, 14, 34), d: 0.9, rot, color: 0xd8d8d8,
    });
  }
}

// ── Planting and street furniture ──────────────────────

function collectTrees(map, rect, quality, out) {
  const spacing = 17 / Math.max(0.5, quality.sceneryScale);
  const district = {};
  const road = {};

  for (let x = rect.x0 + spacing * 0.5; x < rect.x1; x += spacing) {
    for (let z = rect.z0 + spacing * 0.5; z < rect.z1; z += spacing) {
      const rng = makeRng(hash2i(Math.round(x), Math.round(z), 0x71c3));
      const px = x + rngRange(rng, -spacing * 0.4, spacing * 0.4);
      const pz = z + rngRange(rng, -spacing * 0.4, spacing * 0.4);
      if (map.isWater(px, pz)) continue;

      map.districtAt(px, pz, district);
      const density = district.spec.trees;
      if (density <= 0) continue;

      map.roadAt(px, pz, road);
      const verge = road.dist > road.pavement * 0.4 && road.dist < 11;
      const open = district.id === 'park' && road.dist > 8;
      if (!verge && !open) continue;
      if (rng() > density) continue;

      const scale = rngRange(rng, 0.72, 1.28) * (district.id === 'park' ? 1.15 : 0.92);
      out.push({
        x: px,
        z: pz,
        y: map.heightAt(px, pz),
        w: scale,
        h: scale * rngRange(rng, 0.9, 1.25),
        d: scale,
        rot: rngRange(rng, 0, Math.PI * 2),
        color: null,
      });
    }
  }
}

/**
 * Street lights, alternating sides down every arterial.
 *
 * The lamp's arm runs along its local +X, which a Y rotation of `rot`
 * points at (cos rot, -sin rot). It has to reach out over the
 * carriageway, so the rotation is derived from which side of the road
 * the post is standing on — get the sign wrong and every lamp in the
 * city hangs over the pavement with its back to the traffic.
 */
function collectLamps(map, rect, lines, quality, out) {
  const step = 36 / Math.max(0.5, quality.sceneryScale);
  const probe = {};

  const place = (x, z, rot) => {
    map.sampleSurface(x, z, probe);
    if (probe.water) return;
    out.push({ x, z, y: probe.y, w: 1, h: 1, d: 1, rot, color: null });
  };

  for (const line of lines.alongZ) {
    const spec = ROADS[line.kind];
    const offset = spec.halfWidth + spec.pavement * 0.5;
    for (let z = ceilTo(rect.z0, step); z < rect.z1; z += step) {
      const side = ((z / step) | 0) % 2 === 0 ? 1 : -1;
      // Arm points back toward -side on the x axis.
      place(line.at + offset * side, z, side > 0 ? Math.PI : 0);
    }
  }
  for (const line of lines.alongX) {
    const spec = ROADS[line.kind];
    const offset = spec.halfWidth + spec.pavement * 0.5;
    for (let x = ceilTo(rect.x0, step); x < rect.x1; x += step) {
      const side = ((x / step) | 0) % 2 === 0 ? 1 : -1;
      // Arm points back toward -side on the z axis.
      place(x, line.at + offset * side, side > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
  }
}

// ── Building geometry ──────────────────────────────────

/**
 * Buildings are merged, not instanced.
 *
 * An instanced box has to share one set of UVs, and a box's UVs run
 * 0..1 per face however big the box is — so a single facade texture is
 * stretched across a seventy-metre warehouse and squeezed onto a ten-
 * metre shopfront. Bucketing by height only fixes one axis of that.
 *
 * Merging costs a per-chunk geometry, but a chunk's buildings come to a
 * few thousand vertices, the UVs can be computed from each building's
 * real dimensions, and the whole block becomes one draw call instead of
 * one per height band. It is cheaper and it is correct.
 */
const FACE = [
  // [normal, along-axis, up is always +y]
  { nx: 0, nz: 1, ax: 1, az: 0 },
  { nx: 0, nz: -1, ax: -1, az: 0 },
  { nx: 1, nz: 0, ax: 0, az: -1 },
  { nx: -1, nz: 0, ax: 0, az: 1 },
];

function createBoxBuilder(tileWidth, tileHeight) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const tone = new THREE.Color();

  const vertex = (x, y, z, nx, ny, nz, u, v) => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(u, v);
    colors.push(tone.r, tone.g, tone.b);
  };

  return {
    get empty() {
      return positions.length === 0;
    },

    /** One box, centred on (x, y, z), turned `rot` about Y. */
    add({ x, y, z, w, h, d, rot, color }) {
      tone.setHex(color);
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      // Local +X is (cos, -sin) and local +Z is (sin, cos): the basis
      // three.js uses for a mesh rotated about Y, so a merged building
      // sits exactly where the instanced one did.
      const world = (lx, lz) => [x + lx * cos + lz * sin, z - lx * sin + lz * cos];

      for (const face of FACE) {
        const halfAlong = face.ax !== 0 ? w / 2 : d / 2;
        const halfOut = face.ax !== 0 ? d / 2 : w / 2;
        const [nwx, nwz] = [face.nx * cos + face.nz * sin, -face.nx * sin + face.nz * cos];
        const [awx, awz] = [face.ax * cos + face.az * sin, -face.ax * sin + face.az * cos];

        const [ox, oz] = world(face.nx * halfOut, face.nz * halfOut);
        const uMax = (halfAlong * 2) / tileWidth;
        const vMax = h / tileHeight;

        const corner = (side, top) => {
          const px = ox + awx * halfAlong * side;
          const pz = oz + awz * halfAlong * side;
          vertex(px, y + (top ? h / 2 : -h / 2), pz, nwx, 0, nwz,
            side < 0 ? 0 : uMax, top ? vMax : 0);
        };
        corner(-1, false); corner(1, false); corner(1, true);
        corner(-1, false); corner(1, true); corner(-1, true);
      }

      // Roof. Never seen edge-on, so one flat quad is plenty.
      const top = y + h / 2;
      const roof = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const [a, b, c, e] = roof.map(([sx, sz]) => world((sx * w) / 2, (sz * d) / 2));
      const uv = [[0, 0], [w / tileWidth, 0], [w / tileWidth, d / tileWidth], [0, d / tileWidth]];
      for (const [i, j, k] of [[0, 1, 2], [0, 2, 3]]) {
        for (const idx of [i, j, k]) {
          const point = [a, b, c, e][idx];
          vertex(point[0], top, point[1], 0, 1, 0, uv[idx][0], uv[idx][1]);
        }
      }
    },

    finish() {
      if (positions.length === 0) return null;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeBoundingSphere();
      return geometry;
    },
  };
}

// ── Instancing ─────────────────────────────────────────

const dummy = new THREE.Object3D();
const tone = new THREE.Color();

function addInstanced(group, geometries, geometry, material, items, castShadow) {
  if (items.length === 0) return;

  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;

  items.forEach((item, i) => {
    dummy.position.set(item.x, item.y, item.z);
    dummy.rotation.set(0, item.rot, 0);
    dummy.scale.set(item.w, item.h, item.d);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (item.color !== null && item.color !== undefined) {
      mesh.setColorAt(i, tone.setHex(item.color));
    }
  });

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  group.add(mesh);
  // The shared geometry outlives the chunk; only the per-chunk instance
  // buffers die with it, and InstancedMesh.dispose() releases those.
  geometries.push({ dispose: () => mesh.dispose() });
}

// ── Helpers ────────────────────────────────────────────

/** Which local cell indices can possibly have a centre inside the chunk. */
function localRange(sb, rect, sp) {
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
  // Clamped to the superblock, so a cell never spills into a neighbour
  // that is running its grid at a different angle.
  const limit = SUPERBLOCK / 2;
  return {
    iMin: Math.floor(Math.max(uMin, -limit) / sp - 0.5),
    iMax: Math.ceil(Math.min(uMax, limit) / sp),
    jMin: Math.floor(Math.max(vMin, -limit) / sp - 0.5),
    jMax: Math.ceil(Math.min(vMax, limit) / sp),
  };
}

const ceilTo = (value, step) => Math.ceil(value / step) * step;
