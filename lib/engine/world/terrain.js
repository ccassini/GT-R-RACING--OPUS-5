// ═══════════════════════════════════════════════════════
//  TERRAIN — faceted low-poly ground with baked colour zones
//
//  Seen from above the ground is most of the frame, so it does a
//  lot of work here: rolling relief that flattens into the circuit,
//  mown grass banding that follows the racing direction, dry and
//  rocky patches for tonal variation, and a water table that only
//  surfaces well away from the track.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';
import { clamp01, lerp, smoothstep, makeFbm2D, makeRng } from '../util.js';

const STRIPE_LENGTH = 13;

export function createTerrain(scene, circuit, theme, quality) {
  const pal = theme.terrain;

  // The ground has to cover whatever the circuit spans, plus enough
  // margin that the horizon never shows an edge.
  const planeSize = Math.max(900, circuit.span * 2.2 + 560);
  // Aim for a constant cell size rather than a constant vertex count,
  // so a 5 km circuit is not paying for 19 m facets it cannot use.
  const targetCell = 900 / quality.terrainSegments * 2.6;
  const segments = Math.round(
    Math.min(288, Math.max(96, planeSize / targetCell)),
  );

  /** Fully flat out to here, measured from the centreline. */
  const flatRadius = circuit.clearance + 2;
  /** Relief reaches full amplitude by here. */
  const reliefRadius = flatRadius + 90;
  /** Mown-stripe banding fades out by here. */
  const mownRadius = flatRadius + 44;
  const mown = pal.mown !== false;

  const relief = makeFbm2D({ seed: 24601, octaves: 5, lacunarity: 2.1, gain: 0.52 });
  const ridge = makeFbm2D({ seed: 991, octaves: 3, lacunarity: 2.4, gain: 0.5 });
  const patch = makeFbm2D({ seed: 5150, octaves: 3, lacunarity: 2.2, gain: 0.55 });
  const amplitude = 18 * pal.relief;
  const waterLevel = pal.waterLevel ?? -5.5;

  const scratch = {};
  const far = { t: 0, index: 0, lateral: 0, dist: Infinity, y: 0 };
  // Anything outside this box is unambiguously clear of the circuit, so
  // it can skip the nearest-point search entirely. On a long lap that
  // is most of the ground plane.
  const farBox = {
    minX: circuit.bounds.minX - reliefRadius,
    maxX: circuit.bounds.maxX + reliefRadius,
    minZ: circuit.bounds.minZ - reliefRadius,
    maxZ: circuit.bounds.maxZ + reliefRadius,
  };

  /** Distance from the centreline plus the local track surface height. */
  function trackInfo(x, z) {
    if (x < farBox.minX || x > farBox.maxX || z < farBox.minZ || z > farBox.maxZ) {
      return far;
    }
    return circuit.nearest(x, z, scratch);
  }

  function reliefAt(x, z) {
    const base = relief(x * 0.0062, z * 0.0062);
    const detail = ridge(x * 0.021, z * 0.021) * 0.22;
    return (base + detail) * amplitude;
  }

  function heightAt(x, z) {
    const info = trackInfo(x, z);
    const blend = smoothstep(flatRadius, reliefRadius, info.dist);
    const ground = info.y - 0.4;
    if (blend <= 0) return ground;
    return lerp(ground, ground + reliefAt(x, z), blend);
  }

  // ── Geometry ──

  const geometry = new THREE.PlaneGeometry(planeSize, planeSize, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(circuit.center.x, 0, circuit.center.z);

  const position = geometry.attributes.position;
  const count = position.count;
  const colors = new Float32Array(count * 3);

  const cGrassLow = new THREE.Color(pal.grassLow);
  const cGrassHigh = new THREE.Color(pal.grassHigh);
  const cDry = new THREE.Color(pal.dry);
  const cRock = new THREE.Color(pal.rock);
  const cSand = new THREE.Color(pal.sand);
  const tmp = new THREE.Color();
  const tmp2 = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);

    const info = trackInfo(x, z);
    const blend = smoothstep(flatRadius, reliefRadius, info.dist);
    const r = reliefAt(x, z);
    const y = lerp(info.y - 0.4, info.y - 0.4 + r, blend);
    position.setY(i, y);

    // ── Colour zones ──
    const noise = patch(x * 0.014, z * 0.014);
    const elevation = clamp01((r / amplitude) * 0.5 + 0.5);

    tmp.copy(cGrassLow).lerp(cGrassHigh, clamp01(elevation * 1.15 + noise * 0.3));

    // Dry ochre patches, mostly on higher ground.
    const dryness = clamp01(smoothstep(0.12, 0.62, noise) * (0.35 + elevation * 0.9));
    tmp.lerp(cDry, dryness * 0.75);

    // Exposed rock on ridges.
    const rockiness = smoothstep(0.72, 1.0, elevation) * smoothstep(0.0, 0.4, noise + 0.3);
    tmp.lerp(cRock, rockiness * 0.8);

    // Beach ring around anything that dips toward the water table.
    const shore = 1 - smoothstep(waterLevel, waterLevel + 6.5, y);
    tmp.lerp(cSand, clamp01(shore) * 0.85 * blend);

    // Mown banding near the circuit: alternating stripes following the
    // racing direction, the way a real paddock infield is cut.
    if (mown && info.dist < mownRadius) {
      const along = info.t * circuit.length;
      const band = Math.floor(along / STRIPE_LENGTH) % 2 === 0 ? 1.15 : 0.86;
      const strength = 1 - smoothstep(mownRadius * 0.45, mownRadius, info.dist);
      tmp2.copy(tmp).multiplyScalar(band);
      tmp.lerp(tmp2, strength);
    }

    // Scorched gravel apron immediately outside the run-off.
    const apron = 1 - smoothstep(flatRadius - 3, flatRadius + 9, info.dist);
    tmp.lerp(cDry, apron * 0.3);

    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: createGroundDetail(),
    flatShading: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  scene.add(mesh);

  // ── Water ──
  const water = createWater(scene, circuit, theme, waterLevel, planeSize);

  return {
    mesh,
    heightAt,
    waterLevel,
    update(dt) { water.update(dt); },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.map?.dispose();
      material.dispose();
      water.dispose();
    },
  };
}

// ── Ground detail texture ──────────────────────────────
// Near-white with sparse darker speckle: adds grain without shifting
// the palette the vertex colours establish.

function createGroundDetail() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rng = makeRng(9182);

  ctx.fillStyle = '#efece6';
  ctx.fillRect(0, 0, size, size);

  // Tufts: short strokes at mixed angles read as cut grass from above.
  for (let i = 0; i < 5200; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const len = 2 + rng() * 6;
    const angle = rng() * Math.PI;
    const shade = 150 + Math.floor(rng() * 95);
    ctx.strokeStyle = `rgba(${shade},${shade + 6},${shade - 12},${0.3 + rng() * 0.45})`;
    ctx.lineWidth = 0.8 + rng() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }
  // Broader tonal patches so it does not read as uniform noise.
  for (let i = 0; i < 90; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const shade = rng() < 0.5 ? 176 : 232;
    ctx.fillStyle = `rgba(${shade},${shade + 4},${shade - 8},${0.12 + rng() * 0.2})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 8 + rng() * 34, 6 + rng() * 26, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(160, 160);
  return tex;
}

// ── Water ──────────────────────────────────────────────

const WATER_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3  uShallow;
  uniform vec3  uDeep;
  uniform vec3  uSunColor;
  uniform vec3  uSunDir;
  uniform float uTime;
  varying vec2  vUv;
  varying vec3  vWorld;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float valueNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    vec2 p = vWorld.xz * 0.05;
    float w1 = valueNoise(p + vec2(uTime * 0.06, uTime * 0.021));
    float w2 = valueNoise(p * 2.6 - vec2(uTime * 0.033, uTime * 0.05));
    float ripple = w1 * 0.65 + w2 * 0.35;

    vec3 col = mix(uDeep, uShallow, smoothstep(0.35, 0.72, ripple));

    // Broken specular streak toward the sun.
    vec3 view = normalize(cameraPosition - vWorld);
    float spec = pow(max(dot(reflect(-uSunDir, vec3(0.0, 1.0, 0.0)), view), 0.0), 22.0);
    col += uSunColor * spec * 0.9 * smoothstep(0.55, 0.95, ripple);
    col += uSunColor * smoothstep(0.86, 1.0, ripple) * 0.22;

    gl_FragColor = vec4(col, 0.92);
  }
`;

function createWater(scene, circuit, theme, level, planeSize) {
  const geometry = new THREE.PlaneGeometry(planeSize, planeSize, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(circuit.center.x, level, circuit.center.z);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uShallow: { value: new THREE.Color(theme.terrain.water) },
      uDeep: { value: new THREE.Color(theme.terrain.waterDeep) },
      uSunColor: { value: new THREE.Color(theme.light.sunColor) },
      uSunDir: { value: new THREE.Vector3(0.6, 0.35, 0.4).normalize() },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: WATER_FRAG,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -5;
  scene.add(mesh);

  let time = 0;
  return {
    update(dt) {
      time += dt;
      material.uniforms.uTime.value = time;
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
