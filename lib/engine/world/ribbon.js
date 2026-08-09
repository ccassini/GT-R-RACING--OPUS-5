// ═══════════════════════════════════════════════════════
//  RIBBON — geometry primitive for anything that follows the
//  centreline: road, painted lines, kerbs, run-off, guardrail.
//
//  A surface is a grid of quads spanning two lateral offsets, with
//  an arbitrary number of columns across. Callers supply offsets,
//  heights and colours as functions of (sample, u), which is enough
//  to express every painted surface on the circuit — including ones
//  that need colour variation *across* the width, like the rubbered-in
//  racing line or striped kerbs.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';

/**
 * @typedef {object} SurfaceCtx
 * @property {number} index  centreline sample index
 * @property {number} t      normalised track parameter
 * @property {number} px, py, pz  centreline position
 * @property {number} sx, sz      unit side vector
 * @property {number} curvature, signedCurvature
 * @property {number} along  arc length from the start line
 * @property {number} span   0..1 across the built range
 */

/**
 * @param {import('./track.js').Circuit} circuit
 * @param {object} opts
 * @param {(ctx: SurfaceCtx, u: number) => number} opts.lateral  offset at u in [0,1]
 * @param {(ctx: SurfaceCtx, u: number, lateral: number) => number} [opts.height]
 * @param {(ctx: SurfaceCtx, u: number, lateral: number) => THREE.Color} [opts.color]
 * @param {number} [opts.columns]   quads across the width (default 1)
 * @param {number} [opts.start]     first sample index
 * @param {number} [opts.count]     sample steps to cover (default whole loop)
 * @param {number} [opts.uvLength]  world units per V tile; 0 disables UVs
 * @param {number} [opts.uvWidth]   world units per U tile; 0 stretches
 *   the texture across the full width, which smears detail on anything
 *   much wider than it is long — set it to match uvLength for asphalt.
 * @param {number} [opts.step]      sample stride (default 1)
 */
export function buildSurface(circuit, opts) {
  const {
    lateral,
    height = () => 0,
    color = null,
    columns = 1,
    start = 0,
    count = circuit.sampleCount,
    uvLength = 0,
    uvWidth = 0,
    step = 1,
  } = opts;

  const n = circuit.sampleCount;
  const rows = Math.max(2, Math.floor(count / step) + 1);
  const cols = Math.max(1, columns);

  const positions = new Float32Array(rows * (cols + 1) * 3);
  const colors = color ? new Float32Array(rows * (cols + 1) * 3) : null;
  const uvs = uvLength > 0 ? new Float32Array(rows * (cols + 1) * 2) : null;
  const indices = [];

  const arcPerSample = circuit.length / n;
  const ctx = {
    index: 0, t: 0, px: 0, py: 0, pz: 0, sx: 0, sz: 0,
    curvature: 0, signedCurvature: 0, along: 0, span: 0,
  };

  let vi = 0;
  for (let r = 0; r < rows; r++) {
    const raw = start + r * step;
    const i = ((raw % n) + n) % n;
    ctx.index = i;
    ctx.t = i / n;
    ctx.px = circuit.px[i];
    ctx.py = circuit.py[i];
    ctx.pz = circuit.pz[i];
    ctx.sx = circuit.sx[i];
    ctx.sz = circuit.sz[i];
    ctx.curvature = circuit.curvature[i];
    ctx.signedCurvature = circuit.signedCurvature[i];
    ctx.along = raw * arcPerSample;
    ctx.span = r / (rows - 1);

    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const lat = lateral(ctx, u);
      const p3 = vi * 3;
      positions[p3] = ctx.px + ctx.sx * lat;
      positions[p3 + 1] = ctx.py + height(ctx, u, lat);
      positions[p3 + 2] = ctx.pz + ctx.sz * lat;
      if (colors) {
        const col = color(ctx, u, lat);
        colors[p3] = col.r;
        colors[p3 + 1] = col.g;
        colors[p3 + 2] = col.b;
      }
      if (uvs) {
        uvs[vi * 2] = uvWidth > 0 ? lat / uvWidth : u;
        uvs[vi * 2 + 1] = ctx.along / uvLength;
      }
      vi++;
    }
  }

  // A ribbon whose lateral offset *decreases* with u runs its columns
  // in the opposite direction, which flips the winding and makes the
  // whole strip a back face — invisible under FrontSide culling. That
  // is what used to hide every left-hand edge line and kerb.
  const stride = cols + 1;
  const firstLateral = lateral(ctx, 0);
  const lastLateral = lateral(ctx, 1);
  const flipped = lastLateral < firstLateral;

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * stride + c;
      const b = a + 1;
      const d = a + stride;
      const e = d + 1;
      // CCW winding so normals point up.
      if (flipped) indices.push(a, d, b, b, d, e);
      else indices.push(a, b, d, b, e, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Contiguous index ranges where `predicate(index)` holds, wrapped
 * around the closed loop and optionally padded on both ends.
 */
export function findRanges(circuit, predicate, { pad = 0, minLength = 4 } = {}) {
  const n = circuit.sampleCount;
  let flags = new Uint8Array(n);
  for (let i = 0; i < n; i++) flags[i] = predicate(i) ? 1 : 0;

  if (pad > 0) {
    const padded = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (!flags[i]) continue;
      for (let k = -pad; k <= pad; k++) padded[(i + k + n) % n] = 1;
    }
    flags = padded;
  }

  // Rotate to a gap so a range is never split across the seam.
  let origin = 0;
  while (origin < n && flags[origin]) origin++;
  if (origin >= n) return [{ start: 0, count: n }];

  const ranges = [];
  let runStart = -1;
  for (let k = 0; k <= n; k++) {
    const i = (origin + k) % n;
    const on = k < n && flags[i] === 1;
    if (on && runStart < 0) runStart = i;
    if (!on && runStart >= 0) {
      const length = ((i - runStart + n) % n) || n;
      if (length >= minLength) ranges.push({ start: runStart, count: length });
      runStart = -1;
    }
  }
  return ranges;
}

/** Merge geometries that share an attribute layout, disposing the inputs. */
export function mergeGeometries(geometries) {
  const valid = geometries.filter(Boolean);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];

  const hasColor = valid.every((g) => g.getAttribute('color'));
  const hasUv = valid.every((g) => g.getAttribute('uv'));

  // Primitives differ: cones and cylinders are indexed, icosahedra and
  // extrusions are not. Treat a missing index as the implicit 0..n-1.
  const indexCountOf = (g) => (g.index ? g.index.count : g.getAttribute('position').count);

  let vertexTotal = 0;
  let indexTotal = 0;
  for (const g of valid) {
    vertexTotal += g.getAttribute('position').count;
    indexTotal += indexCountOf(g);
  }

  const positions = new Float32Array(vertexTotal * 3);
  const normals = new Float32Array(vertexTotal * 3);
  const colors = hasColor ? new Float32Array(vertexTotal * 3) : null;
  const uvs = hasUv ? new Float32Array(vertexTotal * 2) : null;
  const indices = vertexTotal > 65535 ? new Uint32Array(indexTotal) : new Uint16Array(indexTotal);

  let vOffset = 0;
  let iOffset = 0;
  for (const g of valid) {
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const col = g.getAttribute('color');
    const uv = g.getAttribute('uv');
    positions.set(pos.array, vOffset * 3);
    if (nor) normals.set(nor.array, vOffset * 3);
    if (colors && col) colors.set(col.array, vOffset * 3);
    if (uvs && uv) uvs.set(uv.array, vOffset * 2);
    const length = indexCountOf(g);
    if (g.index) {
      const idx = g.index.array;
      for (let i = 0; i < length; i++) indices[iOffset + i] = idx[i] + vOffset;
    } else {
      for (let i = 0; i < length; i++) indices[iOffset + i] = i + vOffset;
    }
    vOffset += pos.count;
    iOffset += length;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (colors) merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (uvs) merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}
