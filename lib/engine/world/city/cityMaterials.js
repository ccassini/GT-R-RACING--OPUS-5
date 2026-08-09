// ═══════════════════════════════════════════════════════
//  CITY MATERIALS — built once, shared by every chunk
//
//  Eighty chunks are resident at any moment and each one is thrown
//  away and rebuilt as the player drives. If a chunk owned its own
//  materials it would also own its own canvas textures, which means
//  uploading a megabyte of asphalt to the GPU every time someone
//  crosses a street. So the whole world shares this set, and a chunk
//  only ever creates and disposes geometry.
//
//  Road markings come from the texture rather than from geometry: one
//  strip per road class, mapped across the carriageway and repeating
//  every eight metres along it, so a dash is a dash at any speed.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng } from '../../util.js';
import { ROADS } from './cityConfig.js';

/** Metres of road covered by one repeat of the marking texture. */
export const ROAD_TEXTURE_METRES = 8;

export function createCityMaterials(theme) {
  const disposables = [];
  const keep = (item) => {
    disposables.push(item);
    return item;
  };

  // Two strips per road class. The full one carries footways at its
  // edges; the junction one is carriageway only and unmarked, because a
  // crossing has no lane to divide and no pavement to run through it.
  const road = {};
  const junction = {};
  for (const [kind, spec] of Object.entries(ROADS)) {
    road[kind] = keep(
      new THREE.MeshLambertMaterial({ map: keep(createRoadTexture(theme, spec, true)) }),
    );
    junction[kind] = keep(
      new THREE.MeshLambertMaterial({
        map: keep(createRoadTexture(theme, { ...spec, pavement: 0 }, false)),
      }),
    );
  }

  const ground = keep(
    new THREE.MeshLambertMaterial({
      map: keep(createGroundTexture()),
      vertexColors: true,
      flatShading: true,
    }),
  );

  // Buildings are merged rather than instanced, so their UVs already
  // carry the right number of window bays for each wall's real size and
  // their colour arrives per vertex. The texture repeat stays at one.
  const wall = keep(
    new THREE.MeshLambertMaterial({
      map: keep(createFacadeTexture(theme)),
      vertexColors: true,
    }),
  );

  const roof = keep(new THREE.MeshLambertMaterial({ vertexColors: true }));

  const glass = keep(
    new THREE.MeshPhongMaterial({
      map: keep(createGlassTexture(theme)),
      vertexColors: true,
      shininess: 42,
      specular: 0x6d7d90,
    }),
  );

  // Trees and street furniture pack several parts into one geometry and
  // colour them per vertex, so each is a single instanced draw call.
  const foliage = keep(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const furniture = keep(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const structure = keep(new THREE.MeshLambertMaterial({ vertexColors: true }));

  // Instanced geometry is shared for the same reason the textures are:
  // a chunk should cost geometry it actually owns, and nothing else.
  const shape = {
    box: keep(new THREE.BoxGeometry(1, 1, 1)),
    tree: keep(createTreeShape()),
    lamp: keep(createLampShape()),
  };

  return {
    road,
    junction,
    ground,
    wall,
    roof,
    glass,
    foliage,
    furniture,
    structure,
    shape,
    dispose() {
      for (const item of disposables) item.dispose?.();
      disposables.length = 0;
    },
  };
}

// ── Instanced shapes ───────────────────────────────────
// Each of these packs several parts into one geometry and carries its
// colours per vertex, so a thousand street trees are one draw call.

/**
 * Colour a part and strip its index. Three's primitives disagree about
 * indexing — cylinders and boxes are indexed, icosahedra are not — and
 * mergeGeometries refuses a mixture, so everything is flattened before
 * it goes in. These shapes are a few hundred triangles each and shared
 * by the whole world, so the duplicated vertices cost nothing.
 */
function tint(source, hex) {
  const geometry = source.index ? source.toNonIndexed() : source;
  if (geometry !== source) source.dispose();
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color(hex);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Merge coloured parts into one geometry and release the sources. */
export function mergeParts(parts) {
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('City geometry parts failed to merge');
  return merged;
}

/** Unit tree: base at y = 0, roughly seven metres tall at scale one. */
function createTreeShape() {
  const trunk = new THREE.CylinderGeometry(0.17, 0.27, 2.6, 5);
  trunk.translate(0, 1.3, 0);

  const canopy = new THREE.IcosahedronGeometry(1, 0);
  canopy.scale(2.0, 2.5, 2.0);
  canopy.translate(0, 4.3, 0);

  return mergeParts([tint(trunk, 0x4c3521), tint(canopy, 0x3d6b2e)]);
}

/** Unit street light, arm reaching toward +x. */
function createLampShape() {
  const post = new THREE.CylinderGeometry(0.11, 0.16, 8, 5);
  post.translate(0, 4, 0);

  const arm = new THREE.BoxGeometry(1.7, 0.13, 0.13);
  arm.translate(0.85, 7.9, 0);

  const head = new THREE.BoxGeometry(0.86, 0.22, 0.4);
  head.translate(1.6, 7.72, 0);

  return mergeParts([
    tint(post, 0x3f444c),
    tint(arm, 0x3f444c),
    tint(head, 0xd8d2c0),
  ]);
}

// ── Road surface ───────────────────────────────────────

/**
 * One strip across the whole ribbon: footway, kerb, carriageway, kerb,
 * footway. The ribbon geometry is drawn at halfWidth + pavement, so the
 * footway has to be part of this texture — drawing it as its own mesh
 * would double the road draw calls and put two coplanar surfaces a
 * centimetre apart along every kerb in the city.
 */
function createRoadTexture(theme, spec, markings) {
  // Wide enough that a fifteen-centimetre line is still a few pixels
  // across on a thirty-metre motorway.
  const w = 512;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const rng = makeRng(4711 + spec.lanes);
  const pal = theme.road;
  const lanes = spec.lanes;

  // Where the carriageway sits inside the strip.
  const total = spec.halfWidth + spec.pavement;
  const edge = (spec.pavement / (total * 2)) * w;
  const road = { x0: edge, x1: w - edge, width: w - edge * 2 };
  /** A motorway has a hard shoulder, not a pavement. */
  const isMotorway = lanes >= 6;

  ctx.fillStyle = hex(pal.asphalt);
  ctx.fillRect(0, 0, w, h);

  // ── Wheel tracks: two polished bands per lane ──
  for (let lane = 0; lane < lanes; lane++) {
    const centre = road.x0 + ((lane + 0.5) / lanes) * road.width;
    const laneWidth = road.width / lanes;
    const grad = ctx.createLinearGradient(centre - laneWidth / 2, 0, centre + laneWidth / 2, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.28, 'rgba(255,255,255,0.06)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.05)');
    grad.addColorStop(0.72, 'rgba(255,255,255,0.06)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(centre - laneWidth / 2, 0, laneWidth, h);
  }

  // ── Aggregate ──
  for (let i = 0; i < 5200; i++) {
    const shade = rng() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${0.03 + rng() * 0.06})`;
    ctx.fillRect(road.x0 + rng() * road.width, rng() * h, 1 + rng() * 2, 1 + rng() * 2);
  }

  // ── Patch repairs. Nothing else stops a procedural road reading as
  //    a printed strip of paper. ──
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = `rgba(20,20,24,${0.05 + rng() * 0.08})`;
    ctx.fillRect(road.x0 + rng() * road.width, rng() * h, 14 + rng() * 60, 10 + rng() * 50);
  }

  if (edge > 0.5) {
    if (isMotorway) drawShoulders(ctx, { w, h, edge, pal });
    else drawFootways(ctx, { w, h, edge, pal, rng });
  }

  if (markings) {
    drawMarkings(ctx, {
      w, h, road, lanes, pal, isMotorway,
      metresPerPixel: (total * 2) / w,
    });
  }

  const tex = new THREE.CanvasTexture(canvas);
  // Clamped across the road and repeating along it: the strip is the
  // full cross-section exactly once, however wide the road is.
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function drawFootways(ctx, { w, h, edge, pal, rng }) {
  const kerb = Math.max(2, edge * 0.22);

  for (const [x, dir] of [[0, 1], [w - edge, -1]]) {
    ctx.fillStyle = hex(pal.apron);
    ctx.fillRect(x, 0, edge, h);

    // Slab joints, so the pavement is not a flat band of cream.
    ctx.fillStyle = 'rgba(0,0,0,0.11)';
    for (let y = 0; y < h; y += h / 20) ctx.fillRect(x, y, edge, 1.2);
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.02 + rng() * 0.05})`;
      ctx.fillRect(x + rng() * edge, rng() * h, 1.5, 1.5);
    }

    // The kerb face, on the carriageway side of the footway.
    const kerbX = dir > 0 ? x + edge - kerb : x;
    ctx.fillStyle = hex(pal.kerbB);
    ctx.fillRect(kerbX, 0, kerb, h);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(dir > 0 ? kerbX + kerb - 1.5 : kerbX, 0, 1.5, h);
  }
}

function drawShoulders(ctx, { w, h, edge, pal }) {
  // Hard shoulder: same asphalt, a rumble strip, then the barrier line.
  for (const [x, dir] of [[0, 1], [w - edge, -1]]) {
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(x, 0, edge, h);

    const rumbleX = dir > 0 ? x + edge - 4 : x;
    ctx.fillStyle = hex(pal.line);
    ctx.globalAlpha = 0.55;
    for (let y = 0; y < h; y += 9) ctx.fillRect(rumbleX, y, 4, 5);
    ctx.globalAlpha = 1;

    ctx.fillStyle = hex(pal.apron);
    ctx.fillRect(dir > 0 ? x : x + edge - 3, 0, 3, h);
  }
}

/** Real-world marking dimensions, in metres. */
const PAINT = { width: 0.15, dash: 3, median: 0.55 };

/**
 * Markings drawn from metres rather than from fractions of the texture.
 *
 * Both of the things that made the old roads read as toys came from
 * working in texture space: a line width of 1.4% of the strip is a
 * 44 cm stripe on a motorway, three times what road paint actually is,
 * and a "dash" of 45% of an eight-metre repeat is 3.6 m of paint with
 * 40 cm of gap — which is a solid line with a stutter in it.
 */
function drawMarkings(ctx, { w, h, road, lanes, pal, isMotorway, metresPerPixel }) {
  const across = (metres) => metres / metresPerPixel;
  const along = (metres) => (metres / ROAD_TEXTURE_METRES) * h;
  const line = hex(pal.line);
  const width = Math.max(1.5, across(PAINT.width));

  const solid = (centre, colour = line, alpha = 0.9) => {
    ctx.fillStyle = colour;
    ctx.globalAlpha = alpha;
    ctx.fillRect(centre - width / 2, 0, width, h);
    ctx.globalAlpha = 1;
  };
  const dashed = (centre) => {
    ctx.fillStyle = line;
    ctx.globalAlpha = 0.8;
    // Exactly one dash per repeat: three metres of paint, five of gap.
    ctx.fillRect(centre - width / 2, 0, width, along(PAINT.dash));
    ctx.globalAlpha = 1;
  };

  // Edge lines belong on roads wide enough to have a hard edge. A
  // two-lane street is defined by its kerbs, and painting it like a
  // trunk road is what made every side street look like a runway.
  if (lanes > 2) {
    solid(road.x0 + across(0.4) + width / 2, line, 0.8);
    solid(road.x1 - across(0.4) - width / 2, line, 0.8);
  }

  for (let lane = 1; lane < lanes; lane++) {
    const u = road.x0 + (lane / lanes) * road.width;
    if (lane * 2 !== lanes) {
      dashed(u);
      continue;
    }

    // The middle, where the traffic changes direction.
    if (lanes === 2) {
      // One dashed centre line: a residential street you may overtake on.
      dashed(u);
    } else if (isMotorway) {
      // A central reservation, in the colour a median is painted.
      const gap = across(PAINT.median);
      solid(u - gap, hex(pal.runoffPaint), 0.95);
      solid(u + gap, hex(pal.runoffPaint), 0.95);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(u - gap, 0, gap * 2, h);
    } else {
      // Double solid: no overtaking on a four-lane boulevard.
      const gap = across(0.2);
      solid(u - gap);
      solid(u + gap);
    }
  }
}

function createGroundTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rng = makeRng(3355);

  ctx.fillStyle = '#f2efe8';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2400; i++) {
    const shade = 150 + Math.floor(rng() * 96);
    ctx.fillStyle = `rgba(${shade},${shade + 5},${shade - 10},${0.16 + rng() * 0.3})`;
    ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 3, 1 + rng() * 3);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(48, 48);
  return tex;
}

// ── Buildings ──────────────────────────────────────────

function createFacadeTexture(theme) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rng = makeRng(6161);
  const lit = hex(theme.city.window);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  const cols = 6;
  const rows = 8;
  const cw = size / cols;
  const ch = size / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw + cw * 0.2;
      const y = r * ch + ch * 0.18;
      if (rng() < theme.city.windowLit) {
        ctx.fillStyle = lit;
        ctx.globalAlpha = 0.5 + rng() * 0.4;
      } else {
        ctx.fillStyle = '#39404d';
        ctx.globalAlpha = 0.42 + rng() * 0.34;
      }
      ctx.fillRect(x, y, cw * 0.6, ch * 0.46);
    }
  }
  ctx.globalAlpha = 1;

  // Floor slabs, and a darker band at the base so the ground floor
  // reads as shopfront rather than as more of the same.
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  for (let r = 0; r < rows; r++) ctx.fillRect(0, r * ch + ch * 0.72, size, ch * 0.13);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function createGlassTexture(theme) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rng = makeRng(2929);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  // A curtain wall is mullions and reflection, not punched windows.
  const rows = 10;
  const cols = 8;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tint = 0.62 + rng() * 0.34;
      ctx.fillStyle = `rgba(${Math.round(196 * tint)},${Math.round(214 * tint)},${Math.round(232 * tint)},1)`;
      ctx.fillRect(
        (c * size) / cols + 1,
        (r * size) / rows + 1,
        size / cols - 2,
        size / rows - 2,
      );
    }
  }
  ctx.fillStyle = 'rgba(28,34,44,0.5)';
  for (let r = 0; r <= rows; r++) ctx.fillRect(0, (r * size) / rows - 1, size, 2);
  for (let c = 0; c <= cols; c++) ctx.fillRect((c * size) / cols - 1, 0, 2, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

const hex = (packed) => `#${packed.toString(16).padStart(6, '0')}`;
