// ═══════════════════════════════════════════════════════
//  LIGHTING — key sun + sky fill + rim, all theme-driven.
//
//  From a bird's-eye camera the shadows *are* the composition, so
//  the shadow frustum is kept tight and re-centred on whatever the
//  camera is watching. That buys roughly 4x the effective shadow
//  resolution of a world-sized frustum.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';
import { directionFrom } from './sky.js';

const SUN_DISTANCE = 190;
/** Snap the shadow frustum to this grid so shadow texels stay stable. */
const SNAP = 2;

export function createLighting(scene, theme, quality) {
  const cfg = theme.light;
  const direction = directionFrom(cfg.sunElevation, cfg.sunAzimuth);

  const sun = new THREE.DirectionalLight(cfg.sunColor, cfg.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;

  const radius = quality.shadowRadius;
  const cam = sun.shadow.camera;
  cam.left = -radius;
  cam.right = radius;
  cam.top = radius;
  cam.bottom = -radius;
  cam.near = 10;
  cam.far = SUN_DISTANCE * 2.2;
  cam.updateProjectionMatrix();

  scene.add(sun);
  scene.add(sun.target);

  // Ambient carries the shadow colour: cool tint in the dark, so the
  // warm key light reads as genuinely warm by contrast.
  const ambientColor = new THREE.Color(cfg.ambientColor).lerp(
    new THREE.Color(cfg.shadowTint), 0.45,
  );
  const ambient = new THREE.AmbientLight(ambientColor, cfg.ambientIntensity);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(cfg.hemiSky, cfg.hemiGround, cfg.hemiIntensity);
  hemi.position.set(0, 60, 0);
  scene.add(hemi);

  // Opposite-side rim: separates silhouettes from the ground when
  // seen from above, where there is no horizon to read depth against.
  const rim = new THREE.DirectionalLight(cfg.rimColor, cfg.rimIntensity);
  rim.position.copy(direction).multiplyScalar(-120).setY(70);
  scene.add(rim);

  const focus = new THREE.Vector3();

  return {
    sun,
    ambient,
    hemi,
    rim,
    direction,

    /** Re-centre the shadow frustum on a world position. */
    focusOn(x, z) {
      focus.set(
        Math.round(x / SNAP) * SNAP,
        0,
        Math.round(z / SNAP) * SNAP,
      );
      sun.target.position.copy(focus);
      sun.target.updateMatrixWorld();
      sun.position.copy(focus).addScaledVector(direction, SUN_DISTANCE);
    },

    /** Widen the frustum for cinematic shots that cover more ground. */
    setShadowRadius(r) {
      const c = sun.shadow.camera;
      c.left = -r; c.right = r; c.top = r; c.bottom = -r;
      c.updateProjectionMatrix();
    },

    dispose() {
      scene.remove(sun, sun.target, ambient, hemi, rim);
      sun.dispose();
      ambient.dispose();
      hemi.dispose();
      rim.dispose();
    },
  };
}
