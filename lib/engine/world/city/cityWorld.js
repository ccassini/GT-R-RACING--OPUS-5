// ═══════════════════════════════════════════════════════
//  CITY WORLD — assembles the open world and tears it down
//
//  Same contract as world.js: hand it a scene, get back something with
//  a theme, a lighting rig, an update and a dispose. The engine does
//  not need to know whether it is looking at a circuit or at five
//  thousand square kilometres of İstanbul-scale metropolis.
//
//  What it adds is `map` — the surface provider the physics drives on —
//  and `follow`, which is where streaming, traffic and everything else
//  that has to chase the player gets its frame.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';
import { QUALITY, ROAM_BUILD_BUDGET_MS, ROAM_RADIUS, ROAM_TRAFFIC, THEMES } from '../../config.js';
import { createSky } from '../sky.js';
import { createLighting } from '../lighting.js';
import { createCityMap } from './cityMap.js';
import { createCityMaterials } from './cityMaterials.js';
import { createCityStream } from './cityStream.js';
import { createLandmarks } from './cityLandmarks.js';
import { createTraffic } from './cityTraffic.js';
import { WORLD_HALF } from './cityConfig.js';

/** Extent of the water plane that follows the player, in metres. */
const WATER_SPAN = 26000;

export function buildCityWorld(scene, { quality: qualityId, seed = 20260809, traffic: wantTraffic = true }) {
  const theme = THEMES.marmaraDawn;
  const quality = QUALITY[qualityId] ?? QUALITY.high;
  const radius = ROAM_RADIUS[qualityId] ?? ROAM_RADIUS.high;

  const map = createCityMap(seed);
  scene.fog = new THREE.FogExp2(theme.fog.color, theme.fog.density);

  const sky = createSky(scene, theme);
  const lighting = createLighting(scene, theme, quality);
  const materials = createCityMaterials(theme);
  const water = createWater(scene, theme);
  const stream = createCityStream({ scene, map, materials, theme, quality, radius });
  const landmarks = createLandmarks(scene, map, materials, theme);
  const traffic = wantTraffic
    ? createTraffic({ scene, map, count: ROAM_TRAFFIC[qualityId] ?? ROAM_TRAFFIC.high })
    : null;

  return {
    kind: 'city',
    map,
    /** There is no circuit out here. Callers must check before using it. */
    circuit: null,
    theme,
    quality,
    radius,
    sky,
    lighting,
    stream,
    traffic,
    landmarks,

    /** Race furniture the engine expects to exist. Free roam has none. */
    startLights: { set() {} },
    setGuideLineVisible() {},

    get ready() {
      return stream.ready;
    },

    get progress() {
      return stream.progress;
    },

    update(dt) {
      sky.update(dt);
      water.update(dt);
    },

    /**
     * Everything that has to chase the player: which chunks are real,
     * where the traffic is, and where the sky and the sea are centred.
     * The sky dome is a fixed-radius sphere, so out here it has to be
     * carried rather than driven away from.
     */
    follow(dt, x, z, camera) {
      stream.update(x, z, ROAM_BUILD_BUDGET_MS);
      traffic?.update(dt, x, z);
      water.follow(x, z);
      if (camera) sky.mesh.position.copy(camera.position);
      lighting.focusOn(x, z);
    },

    /** Fill the ring in one go, for the loading screen rather than mid-drive. */
    prime(x, z) {
      stream.update(x, z, 0);
      stream.flush();
    },

    dispose() {
      traffic?.dispose();
      landmarks.dispose();
      stream.dispose();
      water.dispose();
      materials.dispose();
      lighting.dispose();
      sky.dispose();
      scene.fog = null;
    },
  };
}

// ── The sea ────────────────────────────────────────────
// One plane, following the player. The shader reads world position, so
// moving it does not move the waves.

const WATER_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3  uShallow;
  uniform vec3  uDeep;
  uniform vec3  uSunColor;
  uniform vec3  uSunDir;
  uniform float uTime;
  // Declared here rather than taken from three's fog chunk: this
  // material fades to the haze itself, so it owns the two uniforms.
  uniform vec3  uFogColor;
  uniform float uFogDensity;
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
    vec2 p = vWorld.xz * 0.045;
    float w1 = valueNoise(p + vec2(uTime * 0.05, uTime * 0.018));
    float w2 = valueNoise(p * 2.8 - vec2(uTime * 0.03, uTime * 0.045));
    float ripple = w1 * 0.62 + w2 * 0.38;

    vec3 col = mix(uDeep, uShallow, smoothstep(0.32, 0.74, ripple));

    vec3 view = normalize(cameraPosition - vWorld);
    float spec = pow(max(dot(reflect(-uSunDir, vec3(0.0, 1.0, 0.0)), view), 0.0), 26.0);
    col += uSunColor * spec * 0.85 * smoothstep(0.52, 0.95, ripple);
    col += uSunColor * smoothstep(0.88, 1.0, ripple) * 0.2;

    // Distance haze, matched to the scene fog so the strait does not
    // stay sharply blue a kilometre past everything standing on land.
    float depth = length(cameraPosition - vWorld);
    float fogAmount = 1.0 - exp(-pow(depth * uFogDensity, 2.0));
    gl_FragColor = vec4(mix(col, uFogColor, clamp(fogAmount, 0.0, 1.0)), 0.94);
  }
`;

function createWater(scene, theme) {
  const geometry = new THREE.PlaneGeometry(WATER_SPAN, WATER_SPAN, 1, 1);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    fog: false,
    uniforms: {
      uShallow: { value: new THREE.Color(theme.terrain.water) },
      uDeep: { value: new THREE.Color(theme.terrain.waterDeep) },
      uSunColor: { value: new THREE.Color(theme.light.sunColor) },
      uSunDir: { value: new THREE.Vector3(0.55, 0.4, 0.45).normalize() },
      uFogColor: { value: new THREE.Color(theme.fog.color) },
      uFogDensity: { value: theme.fog.density },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: WATER_FRAG,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -5;
  mesh.frustumCulled = false;
  scene.add(mesh);

  let time = 0;
  return {
    mesh,
    follow(x, z) {
      // Snapped, so the plane never slides by a fraction of a metre and
      // shimmers against the shoreline.
      mesh.position.set(
        Math.round(Math.max(-WORLD_HALF, Math.min(WORLD_HALF, x)) / 64) * 64,
        0,
        Math.round(Math.max(-WORLD_HALF, Math.min(WORLD_HALF, z)) / 64) * 64,
      );
    },
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
