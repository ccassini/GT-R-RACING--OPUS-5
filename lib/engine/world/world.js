// ═══════════════════════════════════════════════════════
//  WORLD — assembles one circuit's environment and tears it
//  down again, so switching tracks is a single call.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';
import { THEMES, QUALITY } from '../config.js';
import { Circuit, getCircuitById, setActiveCircuit } from './track.js';
import { createSky } from './sky.js';
import { createLighting } from './lighting.js';
import { createTerrain } from './terrain.js';
import { createTrackMesh } from './trackMesh.js';
import { createTrackDressing } from './trackDressing.js';
import { createScenery } from './scenery.js';

/**
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer
 * @param {{ circuitId: string, quality: string }} opts
 */
export function buildWorld(scene, renderer, { circuitId, quality: qualityId }) {
  const def = getCircuitById(circuitId);
  const theme = THEMES[def.theme] ?? THEMES.goldenHour;
  const quality = QUALITY[qualityId] ?? QUALITY.high;

  const circuit = setActiveCircuit(new Circuit(def));

  scene.fog = new THREE.FogExp2(theme.fog.color, theme.fog.density);

  const sky = createSky(scene, theme);
  const lighting = createLighting(scene, theme, quality);
  const terrain = createTerrain(scene, circuit, theme, quality);
  const trackMesh = createTrackMesh(scene, circuit, theme, renderer);
  const dressing = createTrackDressing(scene, circuit, theme);
  const scenery = createScenery(scene, circuit, theme, terrain, quality);

  lighting.focusOn(circuit.px[0], circuit.pz[0]);

  return {
    circuit,
    theme,
    quality,
    sky,
    lighting,
    terrain,
    trackMesh,
    scenery,
    startLights: dressing.startLights,
    racingLine: trackMesh.racingLine,

    setGuideLineVisible(visible) {
      trackMesh.guideLine.visible = visible;
    },

    update(dt) {
      sky.update(dt);
      terrain.update(dt);
    },

    dispose() {
      scenery.dispose();
      dressing.dispose();
      trackMesh.dispose();
      terrain.dispose();
      lighting.dispose();
      sky.dispose();
      scene.fog = null;
    },
  };
}
