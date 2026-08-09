// ═══════════════════════════════════════════════════════
//  SCENERY — instanced forest, rocks and infield dressing
//
//  Placement is noise-driven rather than uniform, so the treeline
//  breaks into clearings and thickets instead of the even carpet a
//  plain Poisson fill produces. Canopies are built to read from
//  directly above: concentric cone rings for pines, irregular
//  faceted blobs for broadleaves.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';
import { clamp01, smoothstep, makeRng, makeFbm2D, rngRange, rngPick } from '../util.js';
import { mergeGeometries } from './ribbon.js';
import { ENVIRONMENT } from './track.js';
import { buildCityscape } from './cityscape.js';

export function createScenery(scene, circuit, theme, terrain, quality) {
  const group = new THREE.Group();
  group.name = 'scenery';
  scene.add(group);

  const disposables = [];
  const rng = makeRng(7391);
  const density = makeFbm2D({ seed: 314, octaves: 3, lacunarity: 2.3, gain: 0.55 });
  const scale = quality.sceneryScale;

  const clearance = circuit.clearance;
  const nearRing = clearance + 12;
  const midRing = clearance + 120 + circuit.span * 0.1;
  const farRing = midRing + 130;

  const slots = { pine: [], broadleaf: [], autumn: [], bush: [], rock: [], palm: [] };
  const scratch = {};

  const sample = (spacing, minDist, maxDist, place) => {
    const b = circuit.bounds;
    const pad = maxDist + 20;
    const step = spacing / Math.max(0.35, scale);
    for (let x = b.minX - pad; x <= b.maxX + pad; x += step) {
      for (let z = b.minZ - pad; z <= b.maxZ + pad; z += step) {
        const jx = x + rngRange(rng, -step * 0.45, step * 0.45);
        const jz = z + rngRange(rng, -step * 0.45, step * 0.45);
        const info = circuit.nearest(jx, jz, scratch);
        if (info.dist < minDist || info.dist > maxDist) continue;
        // Noise-driven thickets and clearings.
        const d = density(jx * 0.011, jz * 0.011) * 0.5 + 0.5;
        if (rng() > clamp01(d * 1.5 - 0.15)) continue;
        place(jx, jz, info.dist, d);
      }
    }
  };

  const environment = circuit.environment;
  const foliage = theme.foliage;

  if (environment === ENVIRONMENT.CIRCUIT) {
    // A permanent facility, not a forest road: the ground stays open
    // so the circuit itself is the composition. Planting is ornamental
    // and set well back, the way a real motorsport park is landscaped.
    const treeLine = clearance + 70;
    sample(26, clearance + 8, treeLine, (x, z) => {
      if (rng() < 0.35) slots.broadleaf.push(makeSlot(rng, x, z, terrain, 0.6, 1.0));
      else slots.bush.push(makeSlot(rng, x, z, terrain, 0.5, 1.0));
    });
    // A screen of trees on the perimeter, far enough back to be backdrop.
    sample(17, treeLine, farRing, (x, z, dist) => {
      const slot = makeSlot(rng, x, z, terrain, 0.8, 1.5 + smoothstep(treeLine, farRing, dist) * 0.5);
      if (rng() < 0.55) slots.pine.push(slot);
      else slots.broadleaf.push(slot);
    });
    buildInfieldCamp(group, disposables, circuit, terrain, rng);
  } else if (environment === ENVIRONMENT.COAST) {
    sample(7, clearance, nearRing, (x, z) => {
      if (rng() < 0.6) slots.bush.push(makeSlot(rng, x, z, terrain, 0.5, 1.1));
      else slots.rock.push(makeSlot(rng, x, z, terrain, 0.4, 1.0));
    });
    sample(11, nearRing, midRing, (x, z, dist) => {
      const roll = rng();
      const slot = makeSlot(rng, x, z, terrain, 0.65, 1.35 + smoothstep(nearRing, midRing, dist) * 0.5);
      if (roll < 0.4) slots.pine.push(slot);
      else if (roll < 0.4 + (1 - foliage.autumnRatio) * 0.5) slots.broadleaf.push(slot);
      else if (roll < 0.9) slots.autumn.push(slot);
      else slots.bush.push(makeSlot(rng, x, z, terrain, 0.5, 1.2));
    });
    sample(16, midRing, farRing, (x, z) => {
      slots.pine.push(makeSlot(rng, x, z, terrain, 1.1, 2.0));
    });
    buildInfieldCamp(group, disposables, circuit, terrain, rng);
  } else if (environment === ENVIRONMENT.HARBOUR) {
    // Street circuit: palms and planters line the barriers, the city
    // itself does the rest of the work.
    sample(16, clearance, clearance + 20, (x, z) => {
      if (rng() < 0.55) slots.palm.push(makeSlot(rng, x, z, terrain, 0.8, 1.25));
      else slots.bush.push(makeSlot(rng, x, z, terrain, 0.5, 0.9));
    });
    sample(22, clearance + 20, clearance + 90, (x, z) => {
      slots.broadleaf.push(makeSlot(rng, x, z, terrain, 0.6, 1.1));
    });
    buildCityscape(group, circuit, theme, terrain, quality, disposables);
    buildHarbour(group, disposables, circuit, theme, rng);
  } else {
    // Desert: sparse palms and rock, then the floodlit skyline.
    sample(20, clearance, clearance + 34, (x, z) => {
      if (rng() < 0.45) slots.palm.push(makeSlot(rng, x, z, terrain, 0.6, 0.95));
      else slots.rock.push(makeSlot(rng, x, z, terrain, 0.5, 1.4));
    });
    sample(30, clearance + 34, clearance + 160, (x, z) => {
      if (rng() < 0.3) slots.palm.push(makeSlot(rng, x, z, terrain, 0.55, 0.9));
      else slots.rock.push(makeSlot(rng, x, z, terrain, 0.6, 1.8));
    });
    buildCityscape(group, circuit, theme, terrain, quality, disposables);
  }

  // ── Build instanced meshes ──
  addTreeType(group, disposables, slots.pine, buildPineCanopy(), buildTrunk(0.22, 0.42, 3.4), foliage.pine, foliage.trunk, rng);
  addTreeType(group, disposables, slots.broadleaf, buildBlobCanopy(rng, 1.0), buildTrunk(0.3, 0.55, 4.2), foliage.broadleaf, foliage.trunk, rng);
  addTreeType(group, disposables, slots.autumn, buildBlobCanopy(rng, 0.82), buildTrunk(0.26, 0.48, 3.8), foliage.autumn, foliage.trunk, rng);
  addTreeType(group, disposables, slots.palm, buildPalmCrown(), buildTrunk(0.18, 0.3, 6.2), foliage.pine, foliage.trunk, rng);
  addSimpleType(group, disposables, slots.bush, buildBushGeo(), foliage.broadleaf, rng);
  addSimpleType(group, disposables, slots.rock, buildRockGeo(), [theme.terrain.rock, 0x8b8378, 0x6f675c], rng);

  buildMountains(group, disposables, circuit, theme);

  return {
    group,
    dispose() {
      scene.remove(group);
      for (const d of disposables) d.dispose();
    },
  };
}

function makeSlot(rng, x, z, terrain, minScale, maxScale) {
  return {
    x,
    z,
    y: terrain.heightAt(x, z),
    scale: rngRange(rng, minScale, maxScale),
    rotation: rngRange(rng, 0, Math.PI * 2),
    tilt: rngRange(rng, -0.05, 0.05),
  };
}

// ── Instancing helpers ─────────────────────────────────

function addTreeType(group, disposables, slots, canopyGeo, trunkGeo, canopyColors, trunkColors, rng) {
  if (slots.length === 0) {
    canopyGeo.dispose();
    trunkGeo.dispose();
    return;
  }
  addInstanced(group, disposables, slots, canopyGeo, canopyColors, rng, true);
  addInstanced(group, disposables, slots, trunkGeo, trunkColors, rng, false);
}

function addSimpleType(group, disposables, slots, geo, colors, rng) {
  if (slots.length === 0) {
    geo.dispose();
    return;
  }
  addInstanced(group, disposables, slots, geo, colors, rng, true);
}

function addInstanced(group, disposables, slots, geometry, palette, rng, castShadow) {
  const material = new THREE.MeshLambertMaterial({
    vertexColors: !!geometry.getAttribute('color'),
    flatShading: true,
  });
  disposables.push(geometry, material);

  const mesh = new THREE.InstancedMesh(geometry, material, slots.length);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    dummy.position.set(s.x, s.y, s.z);
    dummy.rotation.set(s.tilt, s.rotation, s.tilt * 0.6);
    dummy.scale.setScalar(s.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    // Per-instance hue plus a small brightness jitter keeps a big
    // instanced forest from looking like one repeated object.
    color.setHex(rngPick(rng, palette)).multiplyScalar(rngRange(rng, 0.86, 1.12));
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  group.add(mesh);
  return mesh;
}

// ── Geometry factories ─────────────────────────────────
// Vertex colours here are greyscale shading only; hue comes from
// the per-instance colour so one geometry serves a whole palette.

function shadeGeometry(geometry, shade) {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function buildTrunk(topR, bottomR, height) {
  const geo = new THREE.CylinderGeometry(topR, bottomR, height, 6);
  geo.translate(0, height / 2, 0);
  return shadeGeometry(geo, 1);
}

/** Stacked cones: from above this reads as concentric rings. */
function buildPineCanopy() {
  const layers = [
    { r: 2.9, h: 3.4, y: 2.6, shade: 0.82 },
    { r: 2.35, h: 2.8, y: 4.7, shade: 0.93 },
    { r: 1.8, h: 2.3, y: 6.5, shade: 1.03 },
    { r: 1.15, h: 1.9, y: 8.0, shade: 1.14 },
  ];
  const parts = layers.map((l) => {
    const geo = new THREE.ConeGeometry(l.r, l.h, 7);
    geo.translate(0, l.y + l.h / 2, 0);
    return shadeGeometry(geo, l.shade);
  });
  return mergeGeometries(parts);
}

/** Irregular faceted blobs — a broadleaf canopy seen from the top. */
function buildBlobCanopy(rng, squash) {
  const blobs = [
    { x: 0, y: 5.0, z: 0, r: 2.9, shade: 1.0 },
    { x: 1.5, y: 4.5, z: 0.7, r: 2.0, shade: 0.88 },
    { x: -1.3, y: 4.7, z: -0.9, r: 2.2, shade: 0.92 },
    { x: 0.4, y: 6.1, z: -0.4, r: 1.9, shade: 1.12 },
    { x: -0.7, y: 4.2, z: 1.2, r: 1.8, shade: 0.84 },
  ];
  const parts = blobs.map((b) => {
    const geo = new THREE.IcosahedronGeometry(b.r, 0);
    geo.scale(1, squash, 1);
    // Nudge vertices so no two canopies share an outline.
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(
        i,
        pos.getX(i) * rngRange(rng, 0.86, 1.14),
        pos.getY(i) * rngRange(rng, 0.86, 1.14),
        pos.getZ(i) * rngRange(rng, 0.86, 1.14),
      );
    }
    geo.translate(b.x, b.y * squash, b.z);
    return shadeGeometry(geo, b.shade);
  });
  return mergeGeometries(parts);
}

/** Radial fronds — a palm reads as a star from directly above. */
function buildPalmCrown() {
  const parts = [];
  const fronds = 7;
  for (let i = 0; i < fronds; i++) {
    const angle = (i / fronds) * Math.PI * 2;
    const geo = new THREE.ConeGeometry(0.72, 4.4, 4);
    geo.rotateX(Math.PI / 2);
    geo.rotateZ(-0.55);
    geo.rotateY(angle);
    geo.translate(Math.cos(angle) * 1.5, 6.2 - 0.5, Math.sin(angle) * 1.5);
    parts.push(shadeGeometry(geo, 0.86 + (i % 3) * 0.1));
  }
  const crown = new THREE.IcosahedronGeometry(0.65, 0);
  crown.translate(0, 6.3, 0);
  parts.push(shadeGeometry(crown, 1.1));
  return mergeGeometries(parts);
}

function buildBushGeo() {
  const geo = new THREE.IcosahedronGeometry(1.25, 0);
  geo.scale(1.15, 0.66, 1.15);
  geo.translate(0, 0.7, 0);
  return shadeGeometry(geo, 1);
}

function buildRockGeo() {
  const geo = new THREE.DodecahedronGeometry(1.05, 0);
  geo.scale(1.2, 0.62, 1.0);
  geo.translate(0, 0.42, 0);
  return shadeGeometry(geo, 1);
}

// ── Infield spectator camp ─────────────────────────────
// Campers and tents inside the loop: strong colour blocks that give
// the aerial view something man-made to read against the forest.

function buildInfieldCamp(group, disposables, circuit, terrain, rng) {
  const vanGeo = new THREE.BoxGeometry(2.4, 1.9, 5.4);
  const vanRoofGeo = new THREE.BoxGeometry(2.2, 0.5, 3.0);
  const tentGeo = new THREE.ConeGeometry(1.6, 1.8, 4);
  const vanMat = new THREE.MeshLambertMaterial({ vertexColors: false });
  disposables.push(vanGeo, vanRoofGeo, tentGeo, vanMat);

  const palette = [0xf2ede3, 0xffb020, 0xff4d2e, 0x35e0a1, 0x3f8cff, 0xd8d3c6];
  const vans = [];
  const tents = [];
  const scratch = {};

  const cx = circuit.center.x;
  const cz = circuit.center.z;
  for (let i = 0; i < 90; i++) {
    const x = cx + rngRange(rng, -circuit.span * 0.4, circuit.span * 0.4);
    const z = cz + rngRange(rng, -circuit.span * 0.4, circuit.span * 0.4);
    const info = circuit.nearest(x, z, scratch);
    if (info.dist < circuit.clearance + 8 || info.dist > 80) continue;
    const slot = {
      x, z,
      y: terrain.heightAt(x, z),
      rotation: rngRange(rng, 0, Math.PI * 2),
      color: rngPick(rng, palette),
    };
    (rng() < 0.55 ? vans : tents).push(slot);
  }

  const place = (geo, slots, yOffset, mat) => {
    if (slots.length === 0) return;
    const mesh = new THREE.InstancedMesh(geo, mat, slots.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    slots.forEach((s, i) => {
      dummy.position.set(s.x, s.y + yOffset, s.z);
      dummy.rotation.set(0, s.rotation, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.setHex(s.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  };

  place(vanGeo, vans, 0.95, vanMat);
  place(vanRoofGeo, vans, 2.1, vanMat);
  place(tentGeo, tents, 0.9, vanMat);
}

// ── Harbour: yachts moored inside the loop ─────────────

function buildHarbour(group, disposables, circuit, theme, rng) {
  const level = theme.terrain.waterLevel ?? -3;
  const hullGeo = new THREE.BoxGeometry(4.2, 1.5, 13);
  const deckGeo = new THREE.BoxGeometry(3.2, 1.1, 5.2);
  const mastGeo = new THREE.CylinderGeometry(0.12, 0.14, 13, 6);
  const hullMat = new THREE.MeshLambertMaterial({ vertexColors: false });
  disposables.push(hullGeo, deckGeo, mastGeo, hullMat);

  // A marina basin tucked into the infield, away from the racing line.
  const basinX = circuit.center.x + circuit.span * 0.12;
  const basinZ = circuit.center.z - circuit.span * 0.1;

  const boats = [];
  const scratch = {};
  for (let i = 0; i < 34; i++) {
    const x = basinX + rngRange(rng, -70, 70);
    const z = basinZ + rngRange(rng, -55, 55);
    if (circuit.nearest(x, z, scratch).dist < circuit.clearance + 10) continue;
    boats.push({
      x, z,
      rotation: rngRange(rng, -0.25, 0.25) + (i % 2 ? Math.PI : 0),
      color: rngPick(rng, [0xf4f0e6, 0xe8e2d4, 0xd6cfc0, 0xf7f4ec]),
      scale: rngRange(rng, 0.75, 1.35),
    });
  }
  if (boats.length === 0) return;

  const place = (geo, yOffset, scaleY = 1) => {
    const mesh = new THREE.InstancedMesh(geo, hullMat, boats.length);
    mesh.castShadow = true;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    boats.forEach((boat, i) => {
      dummy.position.set(boat.x, level + yOffset * boat.scale, boat.z);
      dummy.rotation.set(0, boat.rotation, 0);
      dummy.scale.set(boat.scale, boat.scale * scaleY, boat.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.setHex(boat.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  };

  place(hullGeo, 0.5);
  place(deckGeo, 1.7);
  place(mastGeo, 8.2);
}

// ── Background mountains ───────────────────────────────

function buildMountains(group, disposables, circuit, theme) {
  // Push the ranges outside whatever the circuit spans, so a four
  // kilometre lap does not run into its own horizon.
  const base = Math.min(1650, circuit.span * 0.7 + 380);
  const ranges = [
    { radius: base * 1.5, peaks: 13, height: 130, mix: 0.72, y: -8 },
    { radius: base * 1.22, peaks: 10, height: 160, mix: 0.5, y: -6 },
    { radius: base, peaks: 8, height: 190, mix: 0.3, y: -4 },
  ];

  const fog = new THREE.Color(theme.fog.color);
  const rock = new THREE.Color(theme.terrain.rock);

  for (const range of ranges) {
    const segments = range.peaks * 10;
    const positions = [];
    const colors = [];
    const indices = [];
    const base = new THREE.Color().copy(rock).lerp(fog, range.mix);
    const cap = new THREE.Color().copy(base).lerp(new THREE.Color(theme.sky.horizon), 0.35);

    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      let h = 0;
      h += Math.sin(angle * range.peaks + 1.3) * 0.45;
      h += Math.sin(angle * range.peaks * 2.1 + 0.7) * 0.22;
      h += Math.sin(angle * range.peaks * 0.5 + 2.1) * 0.3;
      h = Math.max(0, h) ** 1.6;
      const peak = h * range.height + 8;

      const bx = circuit.center.x + Math.cos(angle) * (range.radius + 14);
      const bz = circuit.center.z + Math.sin(angle) * (range.radius + 14);
      const tx = circuit.center.x + Math.cos(angle) * range.radius;
      const tz = circuit.center.z + Math.sin(angle) * range.radius;

      positions.push(bx, range.y, bz, tx, peak + range.y, tz);
      colors.push(base.r, base.g, base.b, cap.r, cap.g, cap.b);
      if (i < segments) {
        const b = i * 2;
        indices.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true });
    disposables.push(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -900;
    group.add(mesh);
  }
}
