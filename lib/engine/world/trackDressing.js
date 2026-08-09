// ═══════════════════════════════════════════════════════
//  TRACK DRESSING — the furniture that makes it a circuit
//
//  Barriers come in two flavours: armco with gravel behind it for the
//  permanent circuits, and unbroken concrete walls a metre off the
//  kerb for the street tracks. Everything is instanced or merged so
//  a four-kilometre lap still costs a handful of draw calls.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';
import { CORNER_CURVATURE } from '../config.js';
import { makeRng, rngRange, rngPick } from '../util.js';
import { BARRIER, ENVIRONMENT } from './track.js';
import { buildSurface, findRanges, mergeGeometries } from './ribbon.js';

const RAIL_HEIGHT = 1.05;
const WALL_HEIGHT = 1.35;
const POST_SPACING = 4.5;

const SPONSOR_COLORS = [0xff4d2e, 0xffb020, 0x35e0a1, 0x3f8cff, 0xf2ede3];

export function createTrackDressing(scene, circuit, theme) {
  const group = new THREE.Group();
  group.name = 'trackDressing';
  scene.add(group);
  const disposables = [];
  const rng = makeRng(1337);

  const isStreet = circuit.barrierStyle === BARRIER.WALL;
  const offset = circuit.barrierOffset;

  if (isStreet) buildWall(group, circuit, theme, disposables, offset);
  else buildGuardrail(group, circuit, disposables, offset);

  buildImpactAbsorbers(group, circuit, disposables, rng, offset, isStreet);
  buildBrakingBoards(group, circuit, disposables, offset);
  buildMarshalPosts(group, circuit, disposables, rng, offset);
  // A permanent facility gets a proper spectator complex; the street
  // and desert circuits get a single stand on the main straight.
  const isFacility = circuit.environment === ENVIRONMENT.CIRCUIT;
  const standPositions = isFacility ? [0.035, 0.42, 0.71] : [0.035];
  for (const t of standPositions) {
    buildGrandstand(group, circuit, disposables, rng, offset, t);
  }
  if (isFacility) buildPaddock(group, circuit, disposables, offset);
  if (theme.light.floodlights) buildFloodlights(group, circuit, disposables, offset);
  const gantry = buildStartGantry(group, circuit, theme, disposables);

  return {
    group,
    startLights: gantry.lights,
    dispose() {
      scene.remove(group);
      for (const d of disposables) {
        if (d.map) d.map.dispose();
        d.dispose();
      }
    },
  };
}

function addMesh(parent, geometry, material, { cast = true, receive = true } = {}) {
  if (!geometry) return null;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  parent.add(mesh);
  return mesh;
}

const meshStep = (circuit, metres) => Math.max(1, Math.round(metres / circuit.metresPerSample));

// ── Armco guardrail ────────────────────────────────────

function buildGuardrail(group, circuit, disposables, offset) {
  const railMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const postMat = new THREE.MeshLambertMaterial({ color: 0x6a6f78 });
  disposables.push(railMat, postMat);

  const metal = new THREE.Color(0xb9bec7);
  const metalDark = new THREE.Color(0x7d838d);
  const scratch = new THREE.Color();
  const sponsors = SPONSOR_COLORS.map((c) => new THREE.Color(c));
  const step = meshStep(circuit, 2.2);

  const railGeos = [];
  for (const sign of [-1, 1]) {
    railGeos.push(buildSurface(circuit, {
      columns: 4,
      step,
      // Fake the W-profile: the middle band steps out a little.
      lateral: (ctx, u) => sign * (offset + (u > 0.3 && u < 0.7 ? 0.1 : 0)),
      height: (ctx, u) => 0.25 + u * RAIL_HEIGHT,
      color: (ctx, u) => {
        const block = Math.floor(ctx.along / 34);
        const isSponsor = block % 3 === 0 && u > 0.18 && u < 0.86;
        if (isSponsor) return sponsors[Math.abs(block * 7 + (sign > 0 ? 2 : 0)) % sponsors.length];
        return scratch.copy(u > 0.3 && u < 0.7 ? metalDark : metal);
      },
    }));
  }
  const railGeo = mergeGeometries(railGeos);
  disposables.push(railGeo);
  addMesh(group, railGeo, railMat);

  const postCount = Math.max(2, Math.floor(circuit.length / POST_SPACING));
  const postGeo = new THREE.BoxGeometry(0.16, 1.35, 0.16);
  disposables.push(postGeo);
  const posts = new THREE.InstancedMesh(postGeo, postMat, postCount * 2);
  posts.castShadow = true;
  const dummy = new THREE.Object3D();
  let idx = 0;
  for (let i = 0; i < postCount; i++) {
    const s = circuit.indexAt(i / postCount);
    for (const sign of [-1, 1]) {
      dummy.position.set(
        circuit.px[s] + circuit.sx[s] * sign * (offset - 0.16),
        circuit.py[s] + 0.55,
        circuit.pz[s] + circuit.sz[s] * sign * (offset - 0.16),
      );
      dummy.rotation.set(0, circuit.heading[s], 0);
      dummy.updateMatrix();
      posts.setMatrixAt(idx++, dummy.matrix);
    }
  }
  posts.instanceMatrix.needsUpdate = true;
  group.add(posts);
}

// ── Street-circuit concrete wall ───────────────────────

function buildWall(group, circuit, theme, disposables, offset) {
  const wallMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  disposables.push(wallMat);

  const concrete = new THREE.Color(0xd9d3c6);
  const concreteShade = new THREE.Color(0xa9a396);
  const kerbA = new THREE.Color(theme.road.kerbA);
  const kerbB = new THREE.Color(theme.road.kerbB);
  const scratch = new THREE.Color();
  const sponsors = SPONSOR_COLORS.map((c) => new THREE.Color(c));
  const step = meshStep(circuit, 1.8);

  const geos = [];
  for (const sign of [-1, 1]) {
    geos.push(buildSurface(circuit, {
      columns: 6,
      step,
      lateral: () => sign * offset,
      height: (ctx, u) => u * WALL_HEIGHT,
      color: (ctx, u) => {
        // Red-and-white striped cap, the street-circuit signature.
        if (u > 0.86) {
          return Math.floor(ctx.along / 2.4) % 2 === 0 ? kerbA : kerbB;
        }
        const block = Math.floor(ctx.along / 26);
        if (block % 4 === 0 && u > 0.24 && u < 0.78) {
          return sponsors[Math.abs(block * 5 + (sign > 0 ? 1 : 0)) % sponsors.length];
        }
        // Vertical panel joints every 3 m.
        const joint = Math.abs((ctx.along % 3) - 1.5) < 0.12;
        return scratch.copy(joint ? concreteShade : concrete)
          .multiplyScalar(0.86 + u * 0.2);
      },
    }));
  }
  const wallGeo = mergeGeometries(geos);
  disposables.push(wallGeo);
  addMesh(group, wallGeo, wallMat);

  // Debris fencing above the wall on the fastest stretches.
  const fenceMat = new THREE.MeshLambertMaterial({
    color: 0x8d97a8, transparent: true, opacity: 0.28,
    side: THREE.DoubleSide, depthWrite: false,
  });
  disposables.push(fenceMat);
  const fenceGeos = [];
  for (const sign of [-1, 1]) {
    fenceGeos.push(buildSurface(circuit, {
      columns: 1,
      step: meshStep(circuit, 4),
      lateral: () => sign * (offset + 0.05),
      height: (ctx, u) => WALL_HEIGHT + u * 2.6,
    }));
  }
  const fenceGeo = mergeGeometries(fenceGeos);
  disposables.push(fenceGeo);
  addMesh(group, fenceGeo, fenceMat, { cast: false, receive: false });
}

// ── Impact absorbers at the corners ────────────────────
// Tyre stacks behind armco, TecPro blocks against a street wall.

function buildImpactAbsorbers(group, circuit, disposables, rng, offset, isStreet) {
  const ranges = findRanges(circuit, (i) => circuit.curvature[i] > CORNER_CURVATURE * 1.8, {
    pad: 0, minLength: meshStep(circuit, 24),
  });
  if (ranges.length === 0) return;

  const spacing = isStreet ? meshStep(circuit, 3.2) : meshStep(circuit, 9);
  const positions = [];
  for (const range of ranges) {
    const from = range.start + Math.floor(range.count * 0.28);
    const span = Math.floor(range.count * 0.45);
    for (let k = 0; k < span; k += spacing) {
      const i = (from + k) % circuit.sampleCount;
      const outward = circuit.signedCurvature[i] > 0 ? 1 : -1;
      const lateral = outward * (offset - (isStreet ? 0.7 : 1.1));
      positions.push({
        x: circuit.px[i] + circuit.sx[i] * lateral,
        y: circuit.py[i],
        z: circuit.pz[i] + circuit.sz[i] * lateral,
        rot: isStreet ? circuit.heading[i] : rngRange(rng, 0, Math.PI),
        alt: Math.floor(k / spacing) % 2 === 0,
      });
    }
  }
  if (positions.length === 0) return;

  const dummy = new THREE.Object3D();

  if (isStreet) {
    const geo = new THREE.BoxGeometry(1.0, 0.95, 1.4);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
    disposables.push(geo, mat);
    const mesh = new THREE.InstancedMesh(geo, mat, positions.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const color = new THREE.Color();
    positions.forEach((p, i) => {
      dummy.position.set(p.x, p.y + 0.48, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.setHex(p.alt ? 0x2f6fd8 : 0xe23a2a));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    return;
  }

  const stacked = [];
  for (const p of positions) {
    for (let s = 0; s < 2; s++) stacked.push({ ...p, y: p.y + 0.18 + s * 0.34 });
  }
  const geo = new THREE.CylinderGeometry(0.6, 0.6, 0.34, 12, 1, false);
  const mat = new THREE.MeshLambertMaterial({ color: 0x2a2c33 });
  disposables.push(geo, mat);
  const mesh = new THREE.InstancedMesh(geo, mat, stacked.length);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  stacked.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.rot, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
}

// ── Braking distance boards ────────────────────────────

function buildBrakingBoards(group, circuit, disposables, offset) {
  const ranges = findRanges(circuit, (i) => circuit.curvature[i] > CORNER_CURVATURE * 1.1, {
    pad: 0, minLength: meshStep(circuit, 22),
  });

  const boardGeo = new THREE.PlaneGeometry(2.1, 1.5);
  const postGeo = new THREE.BoxGeometry(0.12, 1.9, 0.12);
  const postMat = new THREE.MeshLambertMaterial({ color: 0x40444c });
  disposables.push(boardGeo, postGeo, postMat);

  const materials = new Map();
  const materialFor = (label) => {
    if (!materials.has(label)) {
      const mat = new THREE.MeshBasicMaterial({ map: createBoardTexture(label), side: THREE.DoubleSide });
      disposables.push(mat);
      materials.set(label, mat);
    }
    return materials.get(label);
  };

  for (const range of ranges) {
    for (const distance of [150, 100, 50]) {
      const t = ((range.start / circuit.sampleCount) - distance / circuit.length + 1) % 1;
      const idx = circuit.indexAt(t);
      const outward = circuit.signedCurvature[range.start] > 0 ? 1 : -1;
      const lateral = outward * (offset + 1.4);
      const x = circuit.px[idx] + circuit.sx[idx] * lateral;
      const z = circuit.pz[idx] + circuit.sz[idx] * lateral;
      const y = circuit.py[idx];

      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(x, y + 0.95, z);
      post.castShadow = true;
      group.add(post);

      const board = new THREE.Mesh(boardGeo, materialFor(String(distance)));
      board.position.set(x, y + 2.2, z);
      board.rotation.y = circuit.heading[idx] + Math.PI / 2;
      board.castShadow = true;
      group.add(board);
    }
  }
}

function createBoardTexture(label) {
  const w = 168;
  const h = 120;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0f1116';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#f2ede3';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  ctx.fillStyle = '#f2ede3';
  ctx.font = '900 74px Barlow Condensed, Arial Narrow, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

// ── Marshal posts ──────────────────────────────────────

function buildMarshalPosts(group, circuit, disposables, rng, offset) {
  const count = Math.max(6, Math.round(circuit.length / 320));
  const boothGeo = new THREE.BoxGeometry(2.2, 1.7, 1.6);
  const roofGeo = new THREE.BoxGeometry(2.6, 0.16, 2.0);
  const boothMat = new THREE.MeshLambertMaterial({ color: 0xe8e4da });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xff4d2e });
  disposables.push(boothGeo, roofGeo, boothMat, roofMat);

  for (let i = 0; i < count; i++) {
    const idx = circuit.indexAt((i + 0.35) / count);
    const sign = i % 2 === 0 ? 1 : -1;
    const lateral = sign * (offset + 3.4);
    const x = circuit.px[idx] + circuit.sx[idx] * lateral;
    const z = circuit.pz[idx] + circuit.sz[idx] * lateral;
    const y = circuit.py[idx];
    const rot = circuit.heading[idx] + rngRange(rng, -0.15, 0.15);

    const booth = new THREE.Mesh(boothGeo, boothMat);
    booth.position.set(x, y + 0.85, z);
    booth.rotation.y = rot;
    booth.castShadow = true;
    booth.receiveShadow = true;
    group.add(booth);

    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(x, y + 1.78, z);
    roof.rotation.y = rot;
    roof.castShadow = true;
    group.add(roof);
  }
}

// ── Floodlight pylons (night circuits) ─────────────────

function buildFloodlights(group, circuit, disposables, offset) {
  const count = Math.max(8, Math.round(circuit.length / 220));
  const mastGeo = new THREE.CylinderGeometry(0.22, 0.4, 22, 8);
  const headGeo = new THREE.BoxGeometry(4.2, 0.8, 1.0);
  const lampGeo = new THREE.BoxGeometry(3.8, 0.4, 0.6);
  const mastMat = new THREE.MeshLambertMaterial({ color: 0x3a4150 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff4d8 });
  disposables.push(mastGeo, headGeo, lampGeo, mastMat, lampMat);

  for (let i = 0; i < count; i++) {
    const idx = circuit.indexAt(i / count);
    const sign = i % 2 === 0 ? 1 : -1;
    const lateral = sign * (offset + 7);
    const x = circuit.px[idx] + circuit.sx[idx] * lateral;
    const z = circuit.pz[idx] + circuit.sz[idx] * lateral;
    const y = circuit.py[idx];

    const mast = new THREE.Mesh(mastGeo, mastMat);
    mast.position.set(x, y + 11, z);
    mast.castShadow = true;
    group.add(mast);

    const head = new THREE.Mesh(headGeo, mastMat);
    head.position.set(x, y + 22.2, z);
    head.rotation.y = circuit.heading[idx];
    group.add(head);

    // Emissive plate the bloom pass turns into a real glare source.
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(x, y + 21.7, z);
    lamp.rotation.y = circuit.heading[idx];
    group.add(lamp);
  }
}

// ── Grandstand ─────────────────────────────────────────

/**
 * A grandstand is a solid wedge, not a stack of parts. Building it as
 * one closed volume — front wall, raked deck, back wall, sides, floor —
 * means no floating planes, no seeing through it, and no oversized
 * slabs hanging in the air. The crowd is a texture on the deck face.
 */
function buildGrandstand(group, circuit, disposables, rng, offset, t = 0.035) {
  const idx = circuit.indexAt(t);
  const heading = circuit.heading[idx];
  const side = Math.round(t * 1000) % 2 === 0 ? 1 : -1;

  const stand = new THREE.Group();
  stand.position.set(
    circuit.px[idx] + circuit.sx[idx] * side * (offset + 6),
    circuit.py[idx],
    circuit.pz[idx] + circuit.sz[idx] * side * (offset + 6),
  );
  // +Z of the stand must point away from the track on either side.
  stand.rotation.y = side > 0 ? heading + Math.PI / 2 : heading - Math.PI / 2;
  group.add(stand);

  const W = 26;      // along the track
  const D = 10.5;    // away from the track
  const H = 6.4;     // height at the back
  const FRONT = 1.3; // height of the front wall

  const concreteMat = new THREE.MeshLambertMaterial({ color: 0xcac6bb });
  const seatingMat = new THREE.MeshLambertMaterial({ map: createCrowdTexture(rng) });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x8a929e });
  const accentMat = new THREE.MeshLambertMaterial({ color: 0xff4d2e });
  disposables.push(concreteMat, seatingMat, roofMat, accentMat);

  const shellGeo = buildWedgeGeometry(W, D, H, FRONT);
  disposables.push(shellGeo);
  const shell = new THREE.Mesh(shellGeo, [concreteMat, seatingMat]);
  shell.castShadow = true;
  shell.receiveShadow = true;
  stand.add(shell);

  // Sponsor band along the front wall.
  const bandGeo = new THREE.BoxGeometry(W + 0.2, 0.5, 0.18);
  disposables.push(bandGeo);
  const band = new THREE.Mesh(bandGeo, accentMat);
  band.position.set(0, FRONT - 0.35, -0.1);
  stand.add(band);

  // Canopy over the back rows, inset so it never overhangs the sides.
  const canopyD = D * 0.4;
  const canopyGeo = new THREE.BoxGeometry(W - 1, 0.35, canopyD);
  const edgeGeo = new THREE.BoxGeometry(W - 1, 0.3, 0.3);
  const columnGeo = new THREE.BoxGeometry(0.4, 2.6, 0.4);
  disposables.push(canopyGeo, edgeGeo, columnGeo);

  const canopyY = H + 2.6;
  const canopy = new THREE.Mesh(canopyGeo, roofMat);
  canopy.position.set(0, canopyY, D - canopyD / 2);
  canopy.castShadow = true;
  stand.add(canopy);

  const edge = new THREE.Mesh(edgeGeo, accentMat);
  edge.position.set(0, canopyY - 0.05, D - canopyD);
  stand.add(edge);

  for (const sx of [-1, 1]) {
    const column = new THREE.Mesh(columnGeo, concreteMat);
    column.position.set(sx * (W / 2 - 1), canopyY - 1.3, D - canopyD + 0.4);
    column.castShadow = true;
    stand.add(column);
  }
}

/**
 * Closed wedge: low at the front, raked up to the back. Material group
 * 0 is the structure, group 1 is the seating face.
 */
function buildWedgeGeometry(width, depth, height, frontHeight) {
  const hw = width / 2;
  const v = [
    [-hw, 0, 0], [hw, 0, 0],                      // 0,1 front bottom
    [-hw, frontHeight, 0], [hw, frontHeight, 0],  // 2,3 front top
    [-hw, height, depth], [hw, height, depth],    // 4,5 back top
    [-hw, 0, depth], [hw, 0, depth],              // 6,7 back bottom
  ];

  const quad = (a, b, c, d) => [a, b, c, a, c, d];
  const structure = [
    ...quad(0, 1, 3, 2),   // front wall
    ...quad(5, 4, 6, 7),   // back wall
    ...quad(6, 7, 1, 0),   // floor
    ...quad(0, 2, 4, 6),   // left side
    ...quad(7, 5, 3, 1),   // right side
  ];
  const seating = quad(2, 3, 5, 4); // raked deck

  const positions = [];
  const uvs = [];
  const pushTri = (indices, uvFn) => {
    for (const i of indices) {
      positions.push(v[i][0], v[i][1], v[i][2]);
      uvs.push(...uvFn(i));
    }
  };

  // Structure faces get flat UVs; only the deck needs a real mapping.
  pushTri(structure, () => [0, 0]);
  const deckUv = { 2: [0, 0], 3: [1, 0], 5: [1, 1], 4: [0, 1] };
  pushTri(seating, (i) => deckUv[i]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.addGroup(0, structure.length, 0);
  geometry.addGroup(structure.length, seating.length, 1);
  return geometry;
}

/**
 * Seating texture: rows of small figures split by stairwells, with the
 * step shadow baked in so the rake reads from directly above.
 */
function createCrowdTexture(rng) {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#a8a49a';
  ctx.fillRect(0, 0, w, h);

  const rows = 14;
  const cols = 64;
  const rowH = h / rows;
  const colW = w / cols;
  const palette = ['#ff4d2e', '#ffb020', '#35e0a1', '#3f8cff', '#f2ede3',
                   '#c94fd6', '#22303f', '#e8623a', '#2f6f52', '#d8d3c6'];
  const aisles = [Math.floor(cols * 0.28), Math.floor(cols * 0.72)];

  for (let r = 0; r < rows; r++) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, r * rowH + rowH * 0.8, w, rowH * 0.2);

    for (let c = 0; c < cols; c++) {
      if (aisles.some((a) => Math.abs(c - a) < 2)) continue;
      if (rng() < 0.16) continue; // empty seats
      ctx.fillStyle = palette[Math.floor(rng() * palette.length)];
      ctx.fillRect(
        c * colW + colW * 0.2,
        r * rowH + rowH * 0.16,
        colW * 0.6,
        rowH * 0.54,
      );
    }
  }

  ctx.fillStyle = 'rgba(226,222,212,0.8)';
  for (const a of aisles) ctx.fillRect(a * colW, 0, colW * 2.2, h);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (const a of aisles) {
    for (let r = 0; r < rows * 2; r++) {
      ctx.fillRect(a * colW, r * (h / (rows * 2)) + 2, colW * 2.2, 2);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  return tex;
}

// ── Paddock ────────────────────────────────────────────
// A long pit building down the main straight, which is what tells the
// aerial camera this is a permanent circuit and not a country road.

function buildPaddock(group, circuit, disposables, offset) {
  const idx = circuit.indexAt(0.965);
  const heading = circuit.heading[idx];
  const lateral = -(offset + 11);

  const paddock = new THREE.Group();
  paddock.position.set(
    circuit.px[idx] + circuit.sx[idx] * lateral,
    circuit.py[idx],
    circuit.pz[idx] + circuit.sz[idx] * lateral,
  );
  paddock.rotation.y = heading;
  group.add(paddock);

  const length = Math.min(150, circuit.length * 0.06);
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xdedad0 });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x3d4653 });
  const trimMat = new THREE.MeshLambertMaterial({ color: 0xffb020 });
  const glassMat = new THREE.MeshPhongMaterial({ color: 0x1b2634, shininess: 160, specular: 0x9fc0e0 });
  disposables.push(wallMat, roofMat, trimMat, glassMat);

  const shellGeo = new THREE.BoxGeometry(11, 7.5, length);
  const roofGeo = new THREE.BoxGeometry(13.5, 0.7, length + 2);
  const bandGeo = new THREE.BoxGeometry(0.5, 1.1, length);
  const glassGeo = new THREE.BoxGeometry(0.4, 2.2, length - 6);
  disposables.push(shellGeo, roofGeo, bandGeo, glassGeo);

  const shell = new THREE.Mesh(shellGeo, wallMat);
  shell.position.y = 3.75;
  shell.castShadow = true;
  shell.receiveShadow = true;
  paddock.add(shell);

  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.y = 7.8;
  roof.castShadow = true;
  paddock.add(roof);

  // Trackside face: glazed hospitality over a painted band.
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.position.set(5.6, 5.4, 0);
  paddock.add(glass);

  const band = new THREE.Mesh(bandGeo, trimMat);
  band.position.set(5.6, 2.2, 0);
  paddock.add(band);

  // Garage doors facing the pit lane.
  const doorGeo = new THREE.BoxGeometry(0.35, 3, 5);
  disposables.push(doorGeo);
  const doorCount = Math.max(4, Math.floor(length / 12));
  for (let i = 0; i < doorCount; i++) {
    const door = new THREE.Mesh(doorGeo, roofMat);
    door.position.set(5.6, 1.6, (i / (doorCount - 1) - 0.5) * (length - 8));
    paddock.add(door);
  }
}

// ── Start gantry + light rig ───────────────────────────

function buildStartGantry(group, circuit, theme, disposables) {
  const frame = circuit.frame(0);
  const halfW = circuit.halfWidth;
  const gantry = new THREE.Group();
  gantry.position.copy(frame.point);
  gantry.rotation.y = frame.heading;
  group.add(gantry);

  const towerMat = new THREE.MeshLambertMaterial({ color: 0xe9e5db });
  const beamMat = new THREE.MeshLambertMaterial({ color: 0x1b1f28 });
  const towerGeo = new THREE.BoxGeometry(1.0, 9.5, 1.0);
  disposables.push(towerMat, beamMat, towerGeo);

  for (const sign of [-1, 1]) {
    const tower = new THREE.Mesh(towerGeo, towerMat);
    tower.position.set(sign * (halfW + 2.2), 4.75, 0);
    tower.castShadow = true;
    tower.receiveShadow = true;
    gantry.add(tower);
  }

  const beamGeo = new THREE.BoxGeometry(circuit.width + 6, 1.5, 1.3);
  disposables.push(beamGeo);
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.set(0, 9.2, 0);
  beam.castShadow = true;
  gantry.add(beam);

  const bannerTex = createBannerTexture(circuit.name, theme);
  const bannerMat = new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide });
  const bannerGeo = new THREE.PlaneGeometry(circuit.width + 5, 1.25);
  disposables.push(bannerMat, bannerGeo);
  for (const [z, rotY] of [[0.7, 0], [-0.7, Math.PI]]) {
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    banner.position.set(0, 9.2, z);
    banner.rotation.y = rotY;
    gantry.add(banner);
  }

  const lightGeo = new THREE.SphereGeometry(0.4, 14, 10);
  const housingGeo = new THREE.BoxGeometry(8.4, 1.1, 0.5);
  disposables.push(lightGeo, housingGeo);

  const lights = [];
  for (let i = 0; i < 5; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x2a1416 });
    disposables.push(mat);
    const bulb = new THREE.Mesh(lightGeo, mat);
    bulb.position.set((i - 2) * 1.5, 7.9, 0.75);
    gantry.add(bulb);
    lights.push({ mesh: bulb, material: mat });
  }

  const housing = new THREE.Mesh(housingGeo, beamMat);
  housing.position.set(0, 7.9, 0.4);
  gantry.add(housing);

  const OFF = 0x2a1416;
  const RED = 0xff2418;
  const GREEN = 0x2bff7a;

  return {
    lights: {
      /** 0 = all off, 1..5 = that many red lights lit, 'go' = all green. */
      set(stage) {
        for (let i = 0; i < lights.length; i++) {
          const on = stage === 'go' ? true : i < stage;
          lights[i].material.color.setHex(stage === 'go' ? GREEN : on ? RED : OFF);
        }
      },
    },
  };
}

function createBannerTexture(name, theme) {
  const w = 1024;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#11141b';
  ctx.fillRect(0, 0, w, h);

  const cell = 16;
  for (const originX of [0, w - cell * 6]) {
    for (let cx = 0; cx < 6; cx++) {
      for (let cy = 0; cy < h / cell; cy++) {
        if ((cx + cy) % 2 !== 0) continue;
        ctx.fillStyle = '#f2ede3';
        ctx.fillRect(originX + cx * cell, cy * cell, cell, cell);
      }
    }
  }

  ctx.fillStyle = `#${theme.road.kerbA.toString(16).padStart(6, '0')}`;
  ctx.fillRect(cell * 6, h - 10, w - cell * 12, 6);

  ctx.fillStyle = '#f2ede3';
  ctx.font = '900 62px Anton, Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, w / 2, h / 2 - 6);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  return tex;
}
