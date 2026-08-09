// ═══════════════════════════════════════════════════════
//  STREAMING — keep the neighbourhood, forget the city
//
//  At any moment a few dozen chunks around the player are real
//  geometry and the other seventy-eight thousand are not built at all.
//  Chunks enter nearest-first and leave when they fall outside the
//  ring, and building them is capped at a few milliseconds a frame:
//  a late chunk is a chunk that appears through the haze a second
//  later, a slow frame is something the player feels in the steering.
//
//  Beyond the detailed ring, one instanced mesh carries the rest of the
//  skyline as plain massing blocks out to seven kilometres. It costs a
//  single draw call and is the entire reason the world looks like a
//  metropolis rather than like a suburb inside a fog bank.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';
import { clamp01, lerp } from '../../util.js';
import { CHUNK, chunkKey, chunkOf, hash2f } from './cityConfig.js';
import { buildChunk } from './cityChunk.js';

/** Massing cell size for the distant skyline, in metres. */
const FAR_CELL = CHUNK * 2;
/** How far the massing blocks reach, in cells. */
const FAR_RADIUS = 7;
/** Blocks per far cell. Three is enough for a jagged silhouette. */
const FAR_PER_CELL = 3;

export function createCityStream({ scene, map, materials, theme, quality, radius }) {
  const root = new THREE.Group();
  root.name = 'city:chunks';
  scene.add(root);

  const live = new Map();
  let pending = [];
  let lastCx = NaN;
  let lastCz = NaN;

  const far = createFarSkyline(scene, map, theme, radius);

  function refill(cx, cz) {
    pending = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const key = chunkKey(cx + dx, cz + dz);
        if (live.has(key)) continue;
        pending.push({ cx: cx + dx, cz: cz + dz, key, d2: dx * dx + dz * dz });
      }
    }
    // Nearest first, so the road under the wheels is never the last
    // thing to arrive.
    pending.sort((a, b) => a.d2 - b.d2);
  }

  function evict(cx, cz) {
    const limit = radius + 1;
    for (const [key, chunk] of live) {
      if (Math.abs(chunk.cx - cx) <= limit && Math.abs(chunk.cz - cz) <= limit) continue;
      chunk.dispose();
      live.delete(key);
    }
  }

  return {
    root,

    /** True once the ring around the player is fully built. */
    get ready() {
      return pending.length === 0;
    },

    get progress() {
      const total = (radius * 2 + 1) ** 2;
      return clamp01(live.size / total);
    },

    get chunkCount() {
      return live.size;
    },

    update(x, z, budgetMs) {
      const cx = chunkOf(x);
      const cz = chunkOf(z);
      if (cx !== lastCx || cz !== lastCz) {
        lastCx = cx;
        lastCz = cz;
        refill(cx, cz);
        evict(cx, cz);
        far.update(cx, cz);
      }

      const deadline = performance.now() + budgetMs;
      while (pending.length > 0) {
        const next = pending.shift();
        const chunk = buildChunk({
          map, materials, theme, quality, cx: next.cx, cz: next.cz,
        });
        chunk.cx = next.cx;
        chunk.cz = next.cz;
        root.add(chunk.group);
        live.set(next.key, chunk);
        if (performance.now() >= deadline) break;
      }
    },

    /** Build everything queued right now. Used once, during the load. */
    flush() {
      while (pending.length > 0) {
        const next = pending.shift();
        const chunk = buildChunk({
          map, materials, theme, quality, cx: next.cx, cz: next.cz,
        });
        chunk.cx = next.cx;
        chunk.cz = next.cz;
        root.add(chunk.group);
        live.set(next.key, chunk);
      }
    },

    /**
     * Every building close enough to hit, gathered from the chunks whose
     * footprint the point is near. Written into a caller-owned array so
     * the collision pass allocates nothing.
     */
    obstaclesNear(x, z, reach, out) {
      out.length = 0;
      const cx = chunkOf(x);
      const cz = chunkOf(z);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const chunk = live.get(chunkKey(cx + dx, cz + dz));
          if (!chunk) continue;
          for (const box of chunk.obstacles) {
            const ddx = box.x - x;
            const ddz = box.z - z;
            const span = reach + Math.max(box.halfW, box.halfD);
            if (ddx * ddx + ddz * ddz > span * span) continue;
            out.push(box);
          }
        }
      }
      return out;
    },

    dispose() {
      for (const chunk of live.values()) chunk.dispose();
      live.clear();
      pending = [];
      far.dispose();
      scene.remove(root);
      root.clear();
    },
  };
}

// ── Distant massing ────────────────────────────────────

function createFarSkyline(scene, map, theme, detailRadius) {
  const cells = (FAR_RADIUS * 2 + 1) ** 2;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshLambertMaterial({ fog: true });
  const mesh = new THREE.InstancedMesh(geometry, material, cells * FAR_PER_CELL);
  mesh.name = 'city:skyline';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.count = 0;
  scene.add(mesh);

  const dummy = new THREE.Object3D();
  const tone = new THREE.Color();
  const district = {};
  /** Cells nearer than this are already real geometry. */
  const inner = ((detailRadius + 1) * CHUNK) / FAR_CELL;

  return {
    update(cx, cz) {
      const centreCell = {
        x: Math.floor((cx * CHUNK) / FAR_CELL),
        z: Math.floor((cz * CHUNK) / FAR_CELL),
      };
      let n = 0;

      for (let dz = -FAR_RADIUS; dz <= FAR_RADIUS; dz++) {
        for (let dx = -FAR_RADIUS; dx <= FAR_RADIUS; dx++) {
          if (Math.abs(dx) <= inner && Math.abs(dz) <= inner) continue;

          const gx = (centreCell.x + dx) * FAR_CELL + FAR_CELL / 2;
          const gz = (centreCell.z + dz) * FAR_CELL + FAR_CELL / 2;
          if (map.isWater(gx, gz)) continue;

          map.districtAt(gx, gz, district);
          const spec = district.spec;
          if (spec.coverage <= 0) continue;

          const ground = map.heightAt(gx, gz);
          for (let k = 0; k < FAR_PER_CELL; k++) {
            const jitter = hash2f(centreCell.x + dx, (centreCell.z + dz) * 7 + k, 0x4d2f);
            const spread = hash2f((centreCell.x + dx) * 3 + k, centreCell.z + dz, 0x91bb);
            const height = lerp(spec.height[0], spec.height[1], 0.28 + jitter * 0.72)
              * (0.55 + district.intensity * 0.8);
            const footprint = FAR_CELL * (0.2 + spread * 0.16);

            dummy.position.set(
              gx + (spread - 0.5) * FAR_CELL * 0.55,
              ground + height / 2,
              gz + (jitter - 0.5) * FAR_CELL * 0.55,
            );
            dummy.rotation.set(0, jitter * Math.PI, 0);
            dummy.scale.set(footprint, height, footprint);
            dummy.updateMatrix();
            mesh.setMatrixAt(n, dummy.matrix);
            // Pushed toward the fog colour, because at this range that
            // is what the eye expects of anything that far away.
            tone.setHex(spec.wall[0]).lerp(new THREE.Color(theme.fog.color), 0.42);
            mesh.setColorAt(n, tone);
            n += 1;
          }
        }
      }

      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    },

    dispose() {
      scene.remove(mesh);
      mesh.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
