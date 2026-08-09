// ═══════════════════════════════════════════════════════
//  TYRE MARKS — rubber laid down on the asphalt
//
//  A ring buffer of quads stitched between successive samples per
//  wheel. Once full it overwrites the oldest marks, so a long race
//  leaves a rolling trail instead of stopping dead at a cap.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';

const VERTS_PER_QUAD = 6;
const MARK_WIDTH = 0.34;
/** Minimum travel before a new quad is stitched, in metres. */
const MIN_STEP = 0.35;

export function createTireMarks(scene, quality) {
  const capacity = quality.maxTireMarks;
  const maxVerts = capacity * VERTS_PER_QUAD;

  const positions = new Float32Array(maxVerts * 3);
  const alphas = new Float32Array(maxVerts);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setDrawRange(0, 0);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2000);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    vertexShader: /* glsl */ `
      attribute float alpha;
      varying float vAlpha;
      void main() {
        vAlpha = alpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      varying float vAlpha;
      void main() {
        if (vAlpha < 0.01) discard;
        gl_FragColor = vec4(0.055, 0.05, 0.055, vAlpha * 0.72);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  scene.add(mesh);

  let cursor = 0;
  let written = 0;
  const chains = new Map();

  function chainFor(id) {
    let chain = chains.get(id);
    if (!chain) {
      chain = { left: null, right: null };
      chains.set(id, chain);
    }
    return chain;
  }

  function writeQuad(prev, next, intensity) {
    const vi = cursor * VERTS_PER_QUAD;
    const pi = vi * 3;

    positions[pi + 0] = prev.lx; positions[pi + 1] = prev.y; positions[pi + 2] = prev.lz;
    positions[pi + 3] = prev.rx; positions[pi + 4] = prev.y; positions[pi + 5] = prev.rz;
    positions[pi + 6] = next.lx; positions[pi + 7] = next.y; positions[pi + 8] = next.lz;
    positions[pi + 9] = next.lx; positions[pi + 10] = next.y; positions[pi + 11] = next.lz;
    positions[pi + 12] = prev.rx; positions[pi + 13] = prev.y; positions[pi + 14] = prev.rz;
    positions[pi + 15] = next.rx; positions[pi + 16] = next.y; positions[pi + 17] = next.rz;

    for (let v = 0; v < VERTS_PER_QUAD; v++) alphas[vi + v] = intensity;

    cursor = (cursor + 1) % capacity;
    written = Math.min(capacity, written + 1);
    geometry.setDrawRange(0, written * VERTS_PER_QUAD);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.alpha.needsUpdate = true;
  }

  /**
   * @param {string} id      unique per wheel, e.g. `player:left`
   * @param {number} cx, cz  contact patch centre
   * @param {number} y       surface height
   * @param {number} heading car heading, for the mark's width axis
   * @param {number} intensity 0..1
   */
  function add(id, cx, cz, y, heading, intensity) {
    const rightX = Math.cos(heading);
    const rightZ = -Math.sin(heading);
    const hw = MARK_WIDTH / 2;

    const sample = {
      lx: cx - rightX * hw,
      lz: cz - rightZ * hw,
      rx: cx + rightX * hw,
      rz: cz + rightZ * hw,
      // Must clear the road's camber crown (0.095 above the centreline)
      // or the quads z-fight with the tarmac and read as bright slivers.
      y: y + 0.125,
      cx,
      cz,
    };

    const chain = chainFor(id);
    const prev = chain.left;
    if (prev) {
      const moved = Math.hypot(sample.cx - prev.cx, sample.cz - prev.cz);
      if (moved < MIN_STEP) return;
      writeQuad(prev, sample, intensity);
    }
    chain.left = sample;
  }

  function breakChain(id) {
    const chain = chains.get(id);
    if (chain) chain.left = null;
  }

  /** Lay marks for both rear wheels of a vehicle in one call. */
  function addForVehicle(vehicle, intensity) {
    const rightX = Math.cos(vehicle.heading);
    const rightZ = -Math.sin(vehicle.heading);
    const backX = -Math.sin(vehicle.heading);
    const backZ = -Math.cos(vehicle.heading);
    const rear = vehicle.car.shape.wheelbase / 2;
    const half = vehicle.car.shape.trackWidth / 2;
    const id = vehicle.name;

    for (const side of [-1, 1]) {
      add(
        `${id}:${side}`,
        vehicle.x + backX * rear + rightX * side * half,
        vehicle.z + backZ * rear + rightZ * side * half,
        vehicle.y,
        vehicle.heading,
        intensity,
      );
    }
  }

  function breakForVehicle(vehicle) {
    breakChain(`${vehicle.name}:-1`);
    breakChain(`${vehicle.name}:1`);
  }

  function clear() {
    cursor = 0;
    written = 0;
    chains.clear();
    geometry.setDrawRange(0, 0);
  }

  return {
    mesh,
    add,
    addForVehicle,
    breakChain,
    breakForVehicle,
    clear,
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
