// ═══════════════════════════════════════════════════════
//  CITYSCAPE — buildings for the street and desert circuits
//
//  From above a city is roofs, so roofs get the detail: plant rooms,
//  helipads, cooling units, parapets. Facades carry a generated
//  window texture whose lit cells become real glare once the bloom
//  pass runs, which is what sells the night race.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';
import { makeRng, makeFbm2D, rngRange, rngPick, clamp01 } from '../util.js';

const WINDOW_TEX_SIZE = 128;

/**
 * @param {THREE.Group} group
 * @param {import('./track.js').Circuit} circuit
 * @param {object} theme
 * @param {{ heightAt(x: number, z: number): number }} terrain
 * @param {object} quality
 * @param {object[]} disposables
 */
export function buildCityscape(group, circuit, theme, terrain, quality, disposables) {
  const city = theme.city;
  if (!city) return;

  const rng = makeRng(20260807);
  const density = makeFbm2D({ seed: 4242, octaves: 3, lacunarity: 2.2, gain: 0.55 });

  const facade = createFacadeTexture(city);
  disposables.push(facade);

  // Tint comes from InstancedMesh.setColorAt, which three applies via
  // instanceColor. Setting vertexColors here would make the shader read
  // a `color` attribute the box geometry does not have — i.e. black.
  const wallMat = new THREE.MeshLambertMaterial({ map: facade });
  const roofMat = new THREE.MeshLambertMaterial();
  disposables.push(wallMat, roofMat);

  const blocks = [];
  const scratch = {};

  // Buildings crowd the circuit but never overhang it.
  const inner = circuit.clearance + 6;
  const outer = Math.min(520, 150 + circuit.span * 0.24);
  const spacing = 24 / Math.max(0.45, quality.sceneryScale * city.density);
  const b = circuit.bounds;
  const pad = outer;

  for (let x = b.minX - pad; x <= b.maxX + pad; x += spacing) {
    for (let z = b.minZ - pad; z <= b.maxZ + pad; z += spacing) {
      const jx = x + rngRange(rng, -spacing * 0.32, spacing * 0.32);
      const jz = z + rngRange(rng, -spacing * 0.32, spacing * 0.32);
      const info = circuit.nearest(jx, jz, scratch);
      if (info.dist < inner || info.dist > outer) continue;

      const d = density(jx * 0.006, jz * 0.006) * 0.5 + 0.5;
      if (rng() > clamp01(d * 1.7 - 0.2)) continue;

      // Taller the further from the circuit, so the track stays legible
      // and the skyline builds toward the horizon.
      const distanceFactor = clamp01((info.dist - inner) / (outer - inner));
      const height = rngRange(
        rng,
        city.minHeight,
        city.minHeight + (city.maxHeight - city.minHeight) * (0.32 + distanceFactor * 0.85),
      );

      blocks.push({
        x: jx,
        z: jz,
        y: terrain.heightAt(jx, jz),
        width: rngRange(rng, 9, 20),
        depth: rngRange(rng, 9, 20),
        height,
        rotation: circuit.heading[info.index] + rngRange(rng, -0.35, 0.35),
        wall: rngPick(rng, city.wall),
        roof: rngPick(rng, city.roof),
      });
    }
  }

  if (city.skyline > 0) addSkylineCluster(blocks, circuit, city, terrain, rng);
  if (blocks.length === 0) return;

  addBlocks(group, blocks, wallMat, roofMat, city, disposables, rng);
}

function addSkylineCluster(blocks, circuit, city, terrain, rng) {
  // A dense knot of towers on one side of the circuit: the skyline you
  // see over the barriers on every lap.
  const angle = rngRange(rng, 0, Math.PI * 2);
  const distance = Math.min(1150, circuit.span * 0.62 + 180);
  const cx = circuit.center.x + Math.cos(angle) * distance;
  const cz = circuit.center.z + Math.sin(angle) * distance;

  for (let i = 0; i < 34; i++) {
    const r = rngRange(rng, 0, 150);
    const a = rngRange(rng, 0, Math.PI * 2);
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    const closeness = 1 - r / 150;
    blocks.push({
      x,
      z,
      y: terrain.heightAt(x, z),
      width: rngRange(rng, 14, 26),
      depth: rngRange(rng, 14, 26),
      height: rngRange(rng, 60, 90 + closeness * 190),
      rotation: rngRange(rng, 0, Math.PI),
      wall: rngPick(rng, city.wall),
      roof: rngPick(rng, city.roof),
    });
  }
}

function addBlocks(group, blocks, wallMat, roofMat, city, disposables, rng) {
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  // Only the four sides carry the window texture; caps are handled by
  // the roof slab so the facade never smears across a rooftop.
  const roofGeo = new THREE.BoxGeometry(1, 1, 1);
  const parapetGeo = new THREE.BoxGeometry(1, 1, 1);
  const beaconGeo = new THREE.BoxGeometry(1, 0.5, 1);
  disposables.push(wallGeo, roofGeo, parapetGeo, beaconGeo);

  // Rooftop beacons. Unlit material so they punch through the bloom
  // threshold — from above they are what makes a night city read as
  // a city rather than a field of dark slabs.
  const beaconMat = new THREE.MeshBasicMaterial({ color: city.window });
  disposables.push(beaconMat);

  const walls = new THREE.InstancedMesh(wallGeo, wallMat, blocks.length);
  const roofs = new THREE.InstancedMesh(roofGeo, roofMat, blocks.length);
  const parapets = new THREE.InstancedMesh(parapetGeo, roofMat, blocks.length);
  for (const mesh of [walls, roofs, parapets]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }

  const beaconSlots = blocks.filter(() => rng() < 0.35 + city.windowLit * 0.5);
  const beacons = new THREE.InstancedMesh(beaconGeo, beaconMat, Math.max(1, beaconSlots.length));

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  blocks.forEach((block, i) => {
    dummy.position.set(block.x, block.y + block.height / 2, block.z);
    dummy.rotation.set(0, block.rotation, 0);
    dummy.scale.set(block.width, block.height, block.depth);
    dummy.updateMatrix();
    walls.setMatrixAt(i, dummy.matrix);
    walls.setColorAt(i, color.setHex(block.wall).multiplyScalar(rngRange(rng, 0.88, 1.12)));

    dummy.position.set(block.x, block.y + block.height + 0.35, block.z);
    dummy.scale.set(block.width * 1.04, 0.7, block.depth * 1.04);
    dummy.updateMatrix();
    roofs.setMatrixAt(i, dummy.matrix);
    roofs.setColorAt(i, color.setHex(block.roof));

    // Rooftop plant room, offset so the aerial view has something to read.
    dummy.position.set(
      block.x + Math.cos(block.rotation) * block.width * 0.16,
      block.y + block.height + 1.9,
      block.z - Math.sin(block.rotation) * block.depth * 0.16,
    );
    dummy.scale.set(block.width * 0.34, 2.4, block.depth * 0.34);
    dummy.updateMatrix();
    parapets.setMatrixAt(i, dummy.matrix);
    parapets.setColorAt(i, color.setHex(block.roof).multiplyScalar(1.18));
  });

  beaconSlots.forEach((block, i) => {
    dummy.position.set(
      block.x - Math.cos(block.rotation) * block.width * 0.28,
      block.y + block.height + 1.1,
      block.z + Math.sin(block.rotation) * block.depth * 0.28,
    );
    dummy.rotation.set(0, block.rotation, 0);
    dummy.scale.set(1.6, 1, 1.6);
    dummy.updateMatrix();
    beacons.setMatrixAt(i, dummy.matrix);
  });
  beacons.instanceMatrix.needsUpdate = true;
  if (beaconSlots.length > 0) group.add(beacons);

  for (const mesh of [walls, roofs, parapets]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }
}

// ── Facade texture ─────────────────────────────────────

function createFacadeTexture(city) {
  const size = WINDOW_TEX_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rng = makeRng(9090);

  // White base so the per-instance colour supplies the wall tone.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  const cols = 8;
  const rows = 10;
  const cellW = size / cols;
  const cellH = size / rows;
  const litHex = `#${city.window.toString(16).padStart(6, '0')}`;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cellW + cellW * 0.22;
      const y = r * cellH + cellH * 0.22;
      const w = cellW * 0.56;
      const h = cellH * 0.5;
      if (rng() < city.windowLit) {
        ctx.fillStyle = litHex;
        ctx.globalAlpha = 0.55 + rng() * 0.45;
      } else {
        ctx.fillStyle = '#2b3242';
        ctx.globalAlpha = 0.5 + rng() * 0.35;
      }
      ctx.fillRect(x, y, w, h);
    }
  }
  ctx.globalAlpha = 1;

  // Floor slabs between window bands.
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  for (let r = 0; r < rows; r++) ctx.fillRect(0, r * cellH + cellH * 0.78, size, cellH * 0.16);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 6);
  tex.anisotropy = 4;
  return tex;
}
