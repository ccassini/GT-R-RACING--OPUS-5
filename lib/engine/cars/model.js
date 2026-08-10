// ═══════════════════════════════════════════════════════
//  CAR MODEL — authored GLB fleet runtime
//
//  Vehicle geometry lives exclusively in the Blender-authored fleet asset.
//  This module adapts those meshes to the game's paint, wheel, braking,
//  boost and contact-shadow contracts; there is deliberately no primitive
//  fallback that can silently put obsolete cars back on the grid.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getContactShadowTexture } from './livery.js';
import {
  authoredMaterialKind,
  authoredMaterialTuning,
  sharedAuthoredMaterial,
} from '../render/runtimeQuality.js';

const GLASS = 0x15202c;
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
const AUTHORED_RACE_CARS = `${BASE_PATH}/assets/cars/authored-race-cars.glb`;
const REQUIRED_AUTHORED_CAR_COUNT = 6;

let authoredCarTemplates = null;
let authoredCarLoad = null;

/**
 * GLTFLoader removes reserved binding characters such as `:` from node.name,
 * but preserves Blender's original name in userData.name.
 */
export function collectAuthoredCarTemplates(root) {
  const templates = new Map();
  root.traverse((node) => {
    const sourceName = node.userData?.name ?? node.name;
    if (sourceName?.startsWith('car:')) templates.set(sourceName.slice(4), node);
  });
  return templates;
}

/** Load and validate the required authored fleet before synchronous creation. */
export async function preloadAuthoredRaceCars() {
  if (authoredCarTemplates) return authoredCarTemplates;
  if (!authoredCarLoad) {
    authoredCarLoad = new GLTFLoader().loadAsync(AUTHORED_RACE_CARS)
      .then((gltf) => {
        const templates = collectAuthoredCarTemplates(gltf.scene);
        if (templates.size !== REQUIRED_AUTHORED_CAR_COUNT) {
          throw new Error(
            `Expected ${REQUIRED_AUTHORED_CAR_COUNT} authored car roots, received ${templates.size}`,
          );
        }
        authoredCarTemplates = templates;
        return templates;
      })
      .catch((cause) => {
        authoredCarLoad = null;
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(
          `Required authored race-car asset failed to load (${AUTHORED_RACE_CARS}): ${detail}`,
          { cause },
        );
      });
  }
  return authoredCarLoad;
}

/**
 * @param {object} car
 * @param {object} paint
 * @returns {THREE.Group}
 */
export function createCarModel(car, paint) {
  if (!authoredCarTemplates) {
    throw new Error(
      'Authored race-car templates are unavailable; await preloadAuthoredRaceCars() before creating vehicles.',
    );
  }
  const template = authoredCarTemplates.get(car.id);
  if (!template) throw new Error(`Required authored car template is missing: car:${car.id}`);
  return createAuthoredCarModel(template, car, paint);
}

function findNode(root, key) {
  let found = null;
  root.traverse((node) => {
    if (!found && node.name?.includes(key)) found = node;
  });
  return found;
}

function requireNodes(root, carId, keys) {
  return keys.map((key) => {
    const node = findNode(root, key);
    if (!node) throw new Error(`Authored car:${carId} is missing required runtime node: ${key}`);
    return node;
  });
}

function createAuthoredCarModel(template, car, paint) {
  const group = template.clone(true);
  group.name = `car:${car.id}`;
  const ownedMaterials = [];
  const materialsByKind = new Map();
  let bodyMaterial = null;
  let headlightMaterial = null;
  let brakeLightMaterial = null;

  group.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;

    const source = node.material;
    const kind = authoredMaterialKind(source);
    const material = sharedAuthoredMaterial(materialsByKind, source, (original, materialKind) => {
      const clone = original.clone();
      const tuning = authoredMaterialTuning(materialKind);
      if (tuning) {
        for (const [property, value] of Object.entries(tuning)) {
          if (property === 'emissive') clone.emissive?.setHex(value);
          else clone[property] = value;
        }
      }
      ownedMaterials.push(clone);
      return clone;
    });

    if (kind === 'paint') {
      material.color.set(paint.base);
      bodyMaterial = material;
    } else if (kind === 'accent') {
      material.color.set(paint.accent);
    } else if (kind === 'glass') {
      material.color.set(GLASS);
    } else if (kind === 'headlight') {
      headlightMaterial = material;
    } else if (kind === 'brake-light') {
      brakeLightMaterial = material;
    }
    node.material = material;
  });

  try {
    if (!bodyMaterial) throw new Error(`Authored car:${car.id} has no paint material`);
    if (!headlightMaterial) throw new Error(`Authored car:${car.id} has no headlight material`);
    if (!brakeLightMaterial?.emissive) {
      throw new Error(`Authored car:${car.id} has no animated brake-light material`);
    }

    const frontWheels = requireNodes(group, car.id, ['fl_l_pivot', 'fl_r_pivot']);
    const allWheels = requireNodes(group, car.id, [
      'fl_l_spinner', 'fl_r_spinner', 'rl_l_spinner', 'rl_r_spinner',
    ]);
    return finishRuntimeAssembly({
      group,
      car,
      paint,
      frontWheels,
      allWheels,
      bodyMaterial,
      headlightMaterial,
      brakeLightMaterial,
      ownedMaterials,
    });
  } catch (error) {
    for (const material of ownedMaterials) material.dispose();
    throw error;
  }
}

function finishRuntimeAssembly({
  group,
  car,
  paint,
  frontWheels,
  allWheels,
  bodyMaterial,
  headlightMaterial,
  brakeLightMaterial,
  ownedMaterials,
}) {
  // Vehicle.applyVisuals owns these runtime effects. They remain separate from
  // the authored mesh so the GLB contains no lights or effect placeholders.
  const jetGeometry = new THREE.ConeGeometry(0.09, 0.42, 12);
  const jetMaterial = new THREE.MeshBasicMaterial({
    color: 0x7fd4ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  ownedMaterials.push(jetMaterial);

  const jets = [-1, 1].map((side) => {
    const jet = new THREE.Mesh(jetGeometry, jetMaterial);
    jet.name = `runtime:nitro-jet:${side < 0 ? 'left' : 'right'}`;
    jet.position.set(
      side * car.shape.width * 0.19,
      car.shape.rideHeight + 0.28,
      -car.shape.length * 0.52,
    );
    jet.rotation.x = -Math.PI / 2;
    group.add(jet);
    return jet;
  });

  const shadowGeometry = new THREE.PlaneGeometry(
    car.shape.width * 1.85,
    car.shape.length * 1.25,
  );
  shadowGeometry.rotateX(-Math.PI / 2);
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: getContactShadowTexture(),
    transparent: true,
    depthWrite: false,
    opacity: 0.55,
  });
  ownedMaterials.push(shadowMaterial);
  const contactShadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  contactShadow.name = 'runtime:contact-shadow';
  contactShadow.position.y = 0.018;
  contactShadow.renderOrder = 3;
  group.add(contactShadow);

  group.userData = {
    car,
    paint,
    frontWheels,
    allWheels,
    brakeLightMaterial,
    headlightMaterial,
    jetMaterial,
    jets,
    bodyMaterial,
    contactShadow,
    wheelRadius: car.shape.wheelRadius,
    dimensions: { length: car.shape.length, width: car.shape.width },
    authored: true,
    dispose() {
      jetGeometry.dispose();
      shadowGeometry.dispose();
      for (const material of ownedMaterials) material.dispose();
    },
  };
  return group;
}
