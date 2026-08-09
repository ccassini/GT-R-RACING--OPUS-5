// ═══════════════════════════════════════════════════════
//  CAR TEXTURES — the two surfaces that genuinely need one
//
//  The livery itself is vertex colour now, in model.js. A canvas
//  projected down the Y axis works from the race camera and nowhere
//  else: every near-vertical panel smears the paint into streaks, and
//  the windscreen ends up wearing a stretched race number.
//
//  What is left here is the roof roundel, which sits on a flat
//  horizontal quad where planar mapping is correct, and the soft
//  contact shadow under the car.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';

const hex = (v) => `#${v.toString(16).padStart(6, '0')}`;

/**
 * Race-number roundel for the roof decal.
 *
 * @param {number} number
 * @param {{ base: number, accent: number, trim: number }} paint
 * @returns {THREE.CanvasTexture}
 */
export function createRoofNumberTexture(number, paint) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const mid = size / 2;

  ctx.fillStyle = hex(paint.trim);
  ctx.beginPath();
  ctx.arc(mid, mid, size * 0.44, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = hex(paint.accent);
  ctx.lineWidth = size * 0.045;
  ctx.beginPath();
  ctx.arc(mid, mid, size * 0.4, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = hex(paint.accent);
  ctx.font = `900 ${size * 0.56}px Anton, Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), mid, mid + size * 0.03);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ── Contact shadow ─────────────────────────────────────

let shadowTexture = null;

/** One radial gradient, shared by every car on the grid. */
export function getContactShadowTexture() {
  if (shadowTexture) return shadowTexture;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.68)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.4)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  shadowTexture = new THREE.CanvasTexture(canvas);
  return shadowTexture;
}
