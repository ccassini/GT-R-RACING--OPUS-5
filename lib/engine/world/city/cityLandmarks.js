// ═══════════════════════════════════════════════════════
//  LANDMARKS — the handful of things placed by hand
//
//  Everything else in this city is a consequence of noise. These are
//  not. A generated metropolis with no fixed points is impossible to
//  navigate and impossible to describe: every junction looks like every
//  other junction, so nowhere is anywhere.
//
//  So three bridges, a tower, an arena, a mosque and a container port
//  are pinned to known coordinates and built once at world load. They
//  are what a player steers by, and what the map has to say when it
//  names a place.
//
//  The bridge decks themselves are not here — the motorway ribbon in
//  the streaming chunks already climbs them, because the surface query
//  returns deck height over the water. This module builds the parts a
//  road cannot: towers, cables, girders and piers.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';
import { makeRng, rngRange } from '../../util.js';
import { BRIDGES, LANDMARKS, ROADS } from './cityConfig.js';

const DECK_HALF = ROADS.motorway.halfWidth + 1.6;

export function createLandmarks(scene, map, materials, theme) {
  const group = new THREE.Group();
  group.name = 'city:landmarks';
  const owned = [];
  const keep = (item) => {
    owned.push(item);
    return item;
  };

  for (const bridge of BRIDGES) addBridge(group, keep, map, materials, bridge);
  for (const spec of LANDMARKS) {
    if (spec.kind === 'tower') addTower(group, keep, map, materials, spec);
    if (spec.kind === 'stadium') addStadium(group, keep, map, materials, spec);
    if (spec.kind === 'mosque') addMosque(group, keep, map, materials, spec);
    if (spec.kind === 'port') addPort(group, keep, map, materials, spec);
  }
  void theme;

  scene.add(group);

  return {
    group,
    dispose() {
      scene.remove(group);
      for (const item of owned) item.dispose?.();
      owned.length = 0;
      group.clear();
    },
  };
}

// ── Bridges ────────────────────────────────────────────

function addBridge(group, keep, map, materials, bridge) {
  const centre = map.straitCentre(bridge.z);
  const water = map.straitHalf(bridge.z);
  const deckY = bridge.deckHeight;
  const towerX = [centre - water * 0.82, centre + water * 0.82];

  // Box girder under the deck. Flat, because the profile is flat for
  // the whole water crossing — the gradients are all on the approaches.
  const girder = keep(new THREE.BoxGeometry(water * 2 + 60, 3.4, DECK_HALF * 2 - 1.5));
  const girderMesh = new THREE.Mesh(girder, materials.roof);
  girderMesh.position.set(centre, deckY - 2.1, bridge.z);
  girderMesh.castShadow = true;
  group.add(girderMesh);

  // Parapets, so the deck reads as something you cannot fall off.
  const parapet = keep(new THREE.BoxGeometry(water * 2 + 60, 1.25, 0.5));
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(parapet, materials.roof);
    rail.position.set(centre, deckY + 0.7, bridge.z + side * DECK_HALF);
    group.add(rail);
  }

  // Towers: two legs and two cross beams each.
  const legGeo = keep(new THREE.BoxGeometry(5.5, bridge.towerHeight, 5.5));
  const beamGeo = keep(new THREE.BoxGeometry(6, 3.2, DECK_HALF * 2 + 12));
  for (const x of towerX) {
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, materials.roof);
      leg.position.set(x, bridge.towerHeight / 2, bridge.z + side * (DECK_HALF + 3));
      leg.castShadow = true;
      group.add(leg);
    }
    for (const at of [bridge.towerHeight * 0.98, deckY + 12]) {
      const beam = new THREE.Mesh(beamGeo, materials.roof);
      beam.position.set(x, at, bridge.z);
      group.add(beam);
    }
  }

  // Main cables, as a real catenary between the tower tops and down to
  // the abutments. This is the shape the whole structure is read by.
  const top = bridge.towerHeight * 0.94;
  const sag = top - deckY - 6;
  for (const side of [-1, 1]) {
    const z = bridge.z + side * (DECK_HALF + 3);
    const points = [];
    const anchorL = centre - water - bridge.approach * 0.55;
    const anchorR = centre + water + bridge.approach * 0.55;
    points.push(new THREE.Vector3(anchorL, deckY + 2, z));
    points.push(new THREE.Vector3(towerX[0], top, z));
    for (let i = 1; i < 12; i++) {
      const t = i / 12;
      const x = towerX[0] + (towerX[1] - towerX[0]) * t;
      // cosh-shaped dip, normalised so the ends meet the tower tops.
      const s = (t - 0.5) * 2;
      points.push(new THREE.Vector3(x, top - sag * (1 - s * s), z));
    }
    points.push(new THREE.Vector3(towerX[1], top, z));
    points.push(new THREE.Vector3(anchorR, deckY + 2, z));

    const curve = new THREE.CatmullRomCurve3(points);
    const tube = keep(new THREE.TubeGeometry(curve, 96, 0.55, 5, false));
    group.add(new THREE.Mesh(tube, materials.roof));

    // Hangers down to the deck.
    const hanger = keep(new THREE.BoxGeometry(0.28, 1, 0.28));
    const count = 26;
    const mesh = new THREE.InstancedMesh(hanger, materials.roof, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const x = towerX[0] + (towerX[1] - towerX[0]) * t;
      const s = (t - 0.5) * 2;
      const cableY = top - sag * (1 - s * s);
      dummy.position.set(x, (cableY + deckY) / 2, z);
      dummy.scale.set(1, Math.max(1, cableY - deckY), 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    keep({ dispose: () => mesh.dispose() });
    group.add(mesh);
  }

  // Approach piers, marching out of the city up to the deck.
  const pierGeo = keep(new THREE.BoxGeometry(4.5, 1, 8));
  const piers = [];
  for (const dir of [-1, 1]) {
    for (let d = water + 40; d < water + bridge.approach; d += 46) {
      const x = centre + dir * d;
      const ground = map.heightAt(x, bridge.z);
      const surface = map.sampleSurface(x, bridge.z, {});
      const height = surface.y - ground;
      if (height < 3) continue;
      piers.push({ x, y: ground + height / 2, height });
    }
  }
  if (piers.length > 0) {
    const mesh = new THREE.InstancedMesh(pierGeo, materials.roof, piers.length);
    const dummy = new THREE.Object3D();
    piers.forEach((pier, i) => {
      dummy.position.set(pier.x, pier.y, bridge.z);
      dummy.scale.set(1, pier.height, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.computeBoundingSphere();
    keep({ dispose: () => mesh.dispose() });
    group.add(mesh);
  }
}

// ── Observation tower ──────────────────────────────────

function addTower(group, keep, map, materials, spec) {
  const base = map.heightAt(spec.x, spec.z);
  const shaftHeight = spec.height * 0.66;

  const shaft = keep(new THREE.CylinderGeometry(5.5, 11, shaftHeight, 16));
  const shaftMesh = new THREE.Mesh(shaft, materials.roof);
  shaftMesh.position.set(spec.x, base + shaftHeight / 2, spec.z);
  shaftMesh.castShadow = true;
  group.add(shaftMesh);

  const pod = keep(new THREE.CylinderGeometry(17, 22, 16, 20));
  const podMesh = new THREE.Mesh(pod, materials.glass);
  podMesh.position.set(spec.x, base + shaftHeight + 4, spec.z);
  podMesh.castShadow = true;
  group.add(podMesh);

  const upper = keep(new THREE.CylinderGeometry(11, 15, 9, 18));
  const upperMesh = new THREE.Mesh(upper, materials.roof);
  upperMesh.position.set(spec.x, base + shaftHeight + 17, spec.z);
  group.add(upperMesh);

  const mast = keep(new THREE.CylinderGeometry(0.8, 2.4, spec.height * 0.3, 8));
  const mastMesh = new THREE.Mesh(mast, materials.roof);
  mastMesh.position.set(spec.x, base + shaftHeight + 21 + spec.height * 0.15, spec.z);
  group.add(mastMesh);
}

// ── Arena ──────────────────────────────────────────────

function addStadium(group, keep, map, materials, spec) {
  const base = map.heightAt(spec.x, spec.z);

  const bowl = keep(new THREE.CylinderGeometry(spec.radius, spec.radius * 0.82, 34, 40, 1, true));
  const bowlMesh = new THREE.Mesh(bowl, materials.roof);
  bowlMesh.position.set(spec.x, base + 17, spec.z);
  bowlMesh.castShadow = true;
  group.add(bowlMesh);

  const rim = keep(new THREE.TorusGeometry(spec.radius * 0.96, 6, 8, 40));
  const rimMesh = new THREE.Mesh(rim, materials.roof);
  rimMesh.rotation.x = Math.PI / 2;
  rimMesh.position.set(spec.x, base + 36, spec.z);
  group.add(rimMesh);

  const pitch = keep(new THREE.CircleGeometry(spec.radius * 0.62, 32));
  const pitchMesh = new THREE.Mesh(
    pitch,
    new THREE.MeshLambertMaterial({ color: 0x2f6d34 }),
  );
  keep(pitchMesh.material);
  pitchMesh.rotation.x = -Math.PI / 2;
  pitchMesh.position.set(spec.x, base + 1.2, spec.z);
  group.add(pitchMesh);
}

// ── Mosque ─────────────────────────────────────────────

function addMosque(group, keep, map, materials, spec) {
  const base = map.heightAt(spec.x, spec.z);

  const hall = keep(new THREE.BoxGeometry(52, 22, 52));
  const hallMesh = new THREE.Mesh(hall, materials.wall);
  hallMesh.position.set(spec.x, base + 11, spec.z);
  hallMesh.castShadow = true;
  group.add(hallMesh);

  const dome = keep(new THREE.SphereGeometry(21, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2));
  const domeMesh = new THREE.Mesh(dome, materials.roof);
  domeMesh.position.set(spec.x, base + 22, spec.z);
  domeMesh.castShadow = true;
  group.add(domeMesh);

  const semi = keep(new THREE.SphereGeometry(11, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2));
  for (const [dx, dz] of [[30, 0], [-30, 0], [0, 30], [0, -30]]) {
    const mesh = new THREE.Mesh(semi, materials.roof);
    mesh.position.set(spec.x + dx, base + 16, spec.z + dz);
    group.add(mesh);
  }

  const shaft = keep(new THREE.CylinderGeometry(2.1, 2.8, 58, 12));
  const cap = keep(new THREE.ConeGeometry(3.1, 12, 12));
  for (const [dx, dz] of [[36, 36], [-36, 36], [36, -36], [-36, -36]]) {
    const minaret = new THREE.Mesh(shaft, materials.wall);
    minaret.position.set(spec.x + dx, base + 29, spec.z + dz);
    minaret.castShadow = true;
    group.add(minaret);

    const tip = new THREE.Mesh(cap, materials.roof);
    tip.position.set(spec.x + dx, base + 64, spec.z + dz);
    group.add(tip);
  }
}

// ── Container port ─────────────────────────────────────

function addPort(group, keep, map, materials, spec) {
  const rng = makeRng(70707);
  const base = map.heightAt(spec.x, spec.z);

  // Cranes along the quay, all facing the water.
  const legGeo = keep(new THREE.BoxGeometry(2, 46, 2));
  const boomGeo = keep(new THREE.BoxGeometry(120, 2.6, 3.4));
  for (let i = 0; i < 6; i++) {
    const x = spec.x - spec.radius + (i / 5) * spec.radius * 2;
    for (const dz of [-16, 16]) {
      for (const dx of [-11, 11]) {
        const leg = new THREE.Mesh(legGeo, materials.roof);
        leg.position.set(x + dx, base + 23, spec.z + dz);
        leg.castShadow = true;
        group.add(leg);
      }
    }
    const boom = new THREE.Mesh(boomGeo, materials.roof);
    boom.position.set(x - 34, base + 47, spec.z);
    boom.castShadow = true;
    group.add(boom);
  }

  // Container stacks. Bright, boxy, and the only saturated colour for a
  // kilometre in any direction.
  const palette = [0xc4452e, 0x2f6ea8, 0xd8a02c, 0x3f8c5a, 0x8a4d9e, 0xb8b2a4];
  const boxes = [];
  for (let i = 0; i < 420; i++) {
    // Stacked inland of the quay. Put them on the seaward side and half
    // the yard lands in the water and is skipped, leaving the cranes
    // standing over nothing.
    const x = spec.x + rngRange(rng, -spec.radius, spec.radius);
    const z = spec.z - rngRange(rng, 70, 430);
    if (map.isWater(x, z)) continue;
    const stack = 1 + Math.floor(rng() * 4);
    for (let s = 0; s < stack; s++) {
      boxes.push({
        x, z,
        y: map.heightAt(x, z) + 1.4 + s * 2.8,
        rot: Math.round(rng()) * Math.PI / 2,
        color: palette[Math.floor(rng() * palette.length)],
      });
    }
  }
  if (boxes.length > 0) {
    const geo = keep(new THREE.BoxGeometry(12.2, 2.7, 2.5));
    const mesh = new THREE.InstancedMesh(geo, materials.wall, boxes.length);
    const dummy = new THREE.Object3D();
    const tone = new THREE.Color();
    boxes.forEach((box, i) => {
      dummy.position.set(box.x, box.y, box.z);
      dummy.rotation.set(0, box.rot, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, tone.setHex(box.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.computeBoundingSphere();
    keep({ dispose: () => mesh.dispose() });
    group.add(mesh);
  }
}
