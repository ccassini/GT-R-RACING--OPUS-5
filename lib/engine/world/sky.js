// ═══════════════════════════════════════════════════════
//  SKY — procedural dome: gradient, sun disc, drifting cloud
//  banks and (for dusk themes) stars.
//
//  The race camera looks down, so the sky mostly matters for the
//  menu / attract / garage cameras — which is exactly where it
//  needs to carry the whole frame. It is built to be looked at.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform vec3  uZenith;
  uniform vec3  uMiddle;
  uniform vec3  uHorizon;
  uniform vec3  uSun;
  uniform vec3  uCloud;
  uniform vec3  uCloudShadow;
  uniform vec3  uSunDir;
  uniform float uCoverage;
  uniform float uStars;
  uniform float uTime;

  varying vec3 vDir;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * valueNoise(p);
      p = p * 2.03 + vec2(11.3, 7.1);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float y = dir.y;

    // ── Vertical gradient: horizon -> middle -> zenith ──
    vec3 col = mix(uMiddle, uZenith, smoothstep(0.08, 0.75, y));
    col = mix(uHorizon, col, smoothstep(-0.06, 0.22, y));

    // ── Stars, only above the haze and only for dusk themes ──
    if (uStars > 0.001) {
      vec2 sp = dir.xz / max(abs(dir.y) + 0.25, 0.05);
      float twinkle = hash21(floor(sp * 90.0));
      float star = step(0.9965, hash21(floor(sp * 240.0)));
      star *= 0.55 + 0.45 * sin(uTime * 2.1 + twinkle * 30.0);
      col += vec3(0.85, 0.9, 1.0) * star * uStars * smoothstep(0.1, 0.5, y);
    }

    // ── Cloud banks: project the view ray onto a high plane ──
    if (uCoverage > 0.001 && y > -0.02) {
      vec2 cuv = dir.xz / max(y + 0.13, 0.06);
      vec2 drift = vec2(uTime * 0.0045, uTime * 0.0018);
      float base = fbm(cuv * 0.75 + drift);
      float detail = fbm(cuv * 2.4 - drift * 1.7);
      float mask = base * 0.72 + detail * 0.28;

      float edge = 1.0 - uCoverage;
      float density = smoothstep(edge, edge + 0.24, mask);
      density *= smoothstep(-0.02, 0.16, y);            // fade into the horizon haze
      density *= 1.0 - smoothstep(0.55, 0.95, y);        // thin out overhead

      // Light the cloud from the sun side so banks read as volumes.
      float sunFacing = clamp(dot(normalize(dir - uSunDir * 0.35), -uSunDir) * 0.5 + 0.5, 0.0, 1.0);
      float lit = smoothstep(0.25, 0.9, detail) * (0.45 + 0.55 * sunFacing);
      vec3 cloudCol = mix(uCloudShadow, uCloud, lit);
      cloudCol += uSun * pow(max(dot(dir, uSunDir), 0.0), 8.0) * 0.35 * density;

      col = mix(col, cloudCol, clamp(density, 0.0, 0.92));
    }

    // ── Sun: hard disc, limb glow, wide bloom halo ──
    float sunDot = max(dot(dir, uSunDir), 0.0);
    col += uSun * pow(sunDot, 3000.0) * 6.0;   // disc
    col += uSun * pow(sunDot, 220.0)  * 1.1;   // limb
    col += uSun * pow(sunDot, 24.0)   * 0.35;  // inner halo
    col += uSun * pow(sunDot, 4.0)    * 0.14;  // wide scatter

    // ── Horizon haze: warm band that grounds the dome ──
    float haze = exp(-abs(y) * 14.0);
    col = mix(col, uHorizon * 1.04, haze * 0.4);

    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * @param {THREE.Scene} scene
 * @param {object} theme  entry from THEMES
 * @returns {{ mesh: THREE.Mesh, sunDirection: THREE.Vector3, update(dt: number): void, dispose(): void }}
 */
export function createSky(scene, theme) {
  const cfg = theme.sky;
  const sunDirection = directionFrom(cfg.sunElevation, cfg.sunAzimuth);

  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color(cfg.zenith) },
      uMiddle: { value: new THREE.Color(cfg.middle) },
      uHorizon: { value: new THREE.Color(cfg.horizon) },
      uSun: { value: new THREE.Color(cfg.sun) },
      uCloud: { value: new THREE.Color(cfg.cloud) },
      uCloudShadow: { value: new THREE.Color(cfg.cloudShadow) },
      uSunDir: { value: sunDirection.clone() },
      uCoverage: { value: cfg.cloudCoverage },
      uStars: { value: cfg.starIntensity },
      uTime: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });

  const geometry = new THREE.SphereGeometry(3600, 40, 24);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  scene.add(mesh);

  let time = 0;

  return {
    mesh,
    sunDirection,
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

/** Unit vector from an elevation (radians above horizon) and azimuth. */
export function directionFrom(elevation, azimuth) {
  const cosE = Math.cos(elevation);
  return new THREE.Vector3(
    Math.cos(azimuth) * cosE,
    Math.sin(elevation),
    Math.sin(azimuth) * cosE,
  ).normalize();
}
