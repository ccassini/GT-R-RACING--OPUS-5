// Shared rendering policy for authored cars and the garage presentation.

const MATERIAL_TUNING = Object.freeze({
  paint: Object.freeze({
    metalness: 0.14,
    roughness: 0.36,
    clearcoat: 0.30,
    clearcoatRoughness: 0.30,
    envMapIntensity: 0.55,
  }),
  accent: Object.freeze({
    metalness: 0.10,
    roughness: 0.40,
    clearcoat: 0.18,
    clearcoatRoughness: 0.34,
    envMapIntensity: 0.50,
  }),
  carbon: Object.freeze({
    metalness: 0.03,
    roughness: 0.48,
    clearcoat: 0.06,
    clearcoatRoughness: 0.42,
    envMapIntensity: 0.42,
  }),
  glass: Object.freeze({
    metalness: 0,
    roughness: 0.24,
    clearcoat: 0.08,
    clearcoatRoughness: 0.38,
    envMapIntensity: 0.35,
    opacity: 0.76,
    transparent: true,
    depthWrite: false,
  }),
  rubber: Object.freeze({ metalness: 0, roughness: 0.90, envMapIntensity: 0.18 }),
  wheel: Object.freeze({ metalness: 0.78, roughness: 0.36, envMapIntensity: 0.58 }),
  'brake-disc': Object.freeze({ metalness: 0.72, roughness: 0.42, envMapIntensity: 0.48 }),
  caliper: Object.freeze({ metalness: 0.18, roughness: 0.42, envMapIntensity: 0.45 }),
  headlight: Object.freeze({
    metalness: 0,
    roughness: 0.30,
    emissive: 0x121a20,
    emissiveIntensity: 0.07,
    envMapIntensity: 0.30,
  }),
  'brake-light': Object.freeze({
    metalness: 0,
    roughness: 0.34,
    emissive: 0x000000,
    emissiveIntensity: 0,
    envMapIntensity: 0.28,
  }),
});

export const RENDER_TUNING = Object.freeze({
  gameplayExposure: 1.16,
  garage: Object.freeze({
    exposure: 1.04,
    key: Object.freeze({
      type: 'spot', color: 0xffead7, intensity: 1.15,
      distance: 30, angle: 0.82, penumbra: 0.90, decay: 2,
    }),
    fill: Object.freeze({
      type: 'hemisphere', skyColor: 0xb7c8dc, groundColor: 0x191c24, intensity: 0.22,
    }),
    rim: Object.freeze({ type: 'directional', color: 0xffead8, intensity: 0.38 }),
  }),
});

export function authoredMaterialKind(source) {
  return typeof source?.name === 'string' ? source.name.trim().toLowerCase() : '';
}

/** Clone once per named authored material; unnamed sources keep object identity. */
export function sharedAuthoredMaterial(cache, source, cloneMaterial) {
  const kind = authoredMaterialKind(source);
  const key = kind || source;
  if (!cache.has(key)) cache.set(key, cloneMaterial(source, kind));
  return cache.get(key);
}

export function authoredMaterialTuning(kind) {
  return MATERIAL_TUNING[kind] ?? null;
}

/** OutputPass performs the final tone mapping / color-space conversion. */
export function orderedPostFxPasses(renderPass, gradePass, outputPass) {
  return [renderPass, gradePass, outputPass];
}
