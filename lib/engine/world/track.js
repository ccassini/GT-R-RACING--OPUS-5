// ═══════════════════════════════════════════════════════
//  TRACK — the sampled centreline field
//
//  A Circuit precomputes a dense table of centreline samples
//  (position, tangent, side, curvature, arc length). Everything
//  downstream — physics, AI, terrain flattening, mesh building —
//  queries that table instead of re-evaluating the spline.
//
//  The catalogue itself lives in circuits.js so that UI code can read
//  circuit names without pulling in Three.js. Re-exported here so
//  engine modules keep their single import.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';
import { CORNER_CURVATURE, SURFACE } from '../config.js';
import { clamp, wrap01, lerp } from '../util.js';
import { CIRCUITS, DEFAULT_LAYOUT, getCircuitById } from './circuits.js';

export { BARRIER, ENVIRONMENT, CIRCUITS, DEFAULT_LAYOUT, getCircuitById } from './circuits.js';

/** Roughly one centreline sample per metre, within sane bounds. */
const SAMPLES_PER_METRE = 1;
const MIN_SAMPLES = 1400;
const MAX_SAMPLES = 4200;

// ── Circuit ────────────────────────────────────────────

export class Circuit {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.environment = def.environment ?? ENVIRONMENT.FOREST;

    const layout = { ...DEFAULT_LAYOUT, ...(def.layout ?? {}) };
    this.width = layout.width;
    this.halfWidth = layout.width / 2;
    this.kerbWidth = layout.kerb;
    this.runoffWidth = layout.runoff;
    this.barrierStyle = layout.barrier;
    /** Distance from centreline to the barrier face. */
    this.barrierOffset = this.halfWidth + layout.kerb + layout.runoff + layout.barrierGap;
    /** Cars are stopped just short of the barrier so it reads as solid. */
    this.barrierLimit = this.barrierOffset - 1.1;
    /** Nothing may be planted or built inside this radius. */
    this.clearance = this.barrierOffset + 4;

    // Layouts are authored at a readable scale and stretched to their
    // real length here. Elevation grows with the square root so a
    // longer circuit gets gentler gradients, not a rollercoaster.
    const scale = def.scale ?? 1;
    const rise = Math.sqrt(scale);
    const pts = def.points.map(([x, y, z]) => new THREE.Vector3(x * scale, y * rise, z * scale));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.32);
    this.length = this.curve.getLength();

    this.#buildSamples();
    this.#buildBounds();
  }

  // ── Sample table ──

  #buildSamples() {
    const n = Math.round(
      clamp(this.length * SAMPLES_PER_METRE, MIN_SAMPLES, MAX_SAMPLES),
    );
    this.sampleCount = n;
    this.metresPerSample = this.length / n;

    // Coarse scan resolution for nearest-point queries, in samples.
    this.coarseStride = Math.max(4, Math.round(14 / this.metresPerSample));
    this.mediumStride = Math.max(2, Math.round(this.coarseStride / 4));

    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.tx = new Float32Array(n);
    this.tz = new Float32Array(n);
    this.sx = new Float32Array(n);
    this.sz = new Float32Array(n);
    this.heading = new Float32Array(n);
    this.curvature = new Float32Array(n);
    this.signedCurvature = new Float32Array(n);

    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3();

    for (let i = 0; i < n; i++) {
      const t = i / n;
      const p = this.curve.getPointAt(t);
      const tan = this.curve.getTangentAt(t).normalize();
      side.crossVectors(tan, up).normalize();
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);

      this.px[i] = p.x;
      this.py[i] = p.y;
      this.pz[i] = p.z;
      this.tx[i] = tan.x;
      this.tz[i] = tan.z;
      this.sx[i] = side.x;
      this.sz[i] = side.z;
      this.heading[i] = Math.atan2(tan.x, tan.z);
    }

    // Curvature = change of heading per unit arc length, then smoothed
    // over a couple of metres so kerb and AI thresholds do not chatter.
    const arcStep = this.metresPerSample;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const prev = this.heading[(i - 1 + n) % n];
      const next = this.heading[(i + 1) % n];
      let d = next - prev;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      raw[i] = d / (2 * arcStep);
    }

    const window = Math.max(2, Math.round(3 / arcStep));
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -window; k <= window; k++) sum += raw[(i + k + n) % n];
      const mean = sum / (window * 2 + 1);
      this.signedCurvature[i] = mean;
      this.curvature[i] = Math.abs(mean);
    }
  }

  #buildBounds() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.sampleCount; i++) {
      if (this.px[i] < minX) minX = this.px[i];
      if (this.px[i] > maxX) maxX = this.px[i];
      if (this.pz[i] < minZ) minZ = this.pz[i];
      if (this.pz[i] > maxZ) maxZ = this.pz[i];
    }
    this.bounds = { minX, maxX, minZ, maxZ };
    this.center = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
    this.span = Math.max(maxX - minX, maxZ - minZ);
  }

  // ── Queries ──

  indexAt(t) {
    return Math.floor(wrap01(t) * this.sampleCount) % this.sampleCount;
  }

  frame(t) {
    return this.frameInto(t, {
      point: new THREE.Vector3(),
      tangent: new THREE.Vector3(),
      side: new THREE.Vector3(),
      heading: 0,
      curvature: 0,
    });
  }

  frameInto(t, out) {
    const n = this.sampleCount;
    const f = wrap01(t) * n;
    const i0 = Math.floor(f) % n;
    const i1 = (i0 + 1) % n;
    const a = f - Math.floor(f);

    out.point.set(
      lerp(this.px[i0], this.px[i1], a),
      lerp(this.py[i0], this.py[i1], a),
      lerp(this.pz[i0], this.pz[i1], a),
    );
    out.tangent.set(lerp(this.tx[i0], this.tx[i1], a), 0, lerp(this.tz[i0], this.tz[i1], a)).normalize();
    out.side.set(lerp(this.sx[i0], this.sx[i1], a), 0, lerp(this.sz[i0], this.sz[i1], a)).normalize();
    out.heading = Math.atan2(out.tangent.x, out.tangent.z);
    out.curvature = lerp(this.curvature[i0], this.curvature[i1], a);
    return out;
  }

  curvatureAt(t) {
    return this.curvature[this.indexAt(t)];
  }

  signedCurvatureAt(t) {
    return this.signedCurvature[this.indexAt(t)];
  }

  /** Highest curvature found within `distance` metres ahead of t. */
  maxCurvatureAhead(t, distance) {
    const n = this.sampleCount;
    const start = this.indexAt(t);
    const steps = Math.max(1, Math.round(distance / this.metresPerSample));
    const stride = Math.max(1, Math.round(steps / 24));
    let max = 0;
    for (let k = 0; k <= steps; k += stride) {
      const c = this.curvature[(start + k) % n];
      if (c > max) max = c;
    }
    return max;
  }

  /**
   * Nearest point on the centreline, found with a three-level scan so
   * the cost stays flat as circuits get longer: coarse sweep of the
   * whole loop, medium sweep of the winning neighbourhood, then exact.
   * Returns { t, dist, lateral, y, index }; `lateral` is signed.
   */
  nearest(x, z, out = {}) {
    const n = this.sampleCount;
    const coarse = this.coarseStride;
    const medium = this.mediumStride;

    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i += coarse) {
      const dx = this.px[i] - x;
      const dz = this.pz[i] - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; bestI = i; }
    }
    for (let k = -coarse; k <= coarse; k += medium) {
      const i = (bestI + k + n) % n;
      const dx = this.px[i] - x;
      const dz = this.pz[i] - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; bestI = i; }
    }
    for (let k = -medium; k <= medium; k++) {
      const i = (bestI + k + n) % n;
      const dx = this.px[i] - x;
      const dz = this.pz[i] - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; bestI = i; }
    }

    const segT = this.#projectOnSegment(x, z, bestI);
    const dx = x - this.px[bestI];
    const dz = z - this.pz[bestI];
    const lateral = dx * this.sx[bestI] + dz * this.sz[bestI];

    out.t = wrap01((bestI + segT) / n);
    out.index = bestI;
    out.lateral = lateral;
    out.dist = Math.abs(lateral);
    out.y = this.py[bestI];
    return out;
  }

  /**
   * The ground query the physics asks for, in the one shape both this
   * class and the open-world map answer in. That interface is the only
   * reason a car built for a closed circuit can be dropped into five
   * thousand square kilometres of city and still know what it is
   * driving on.
   */
  sampleSurface(x, z, out = {}) {
    this.nearest(x, z, out);
    out.surface = out.dist < this.halfWidth - 0.35
      ? SURFACE.TRACK
      : out.dist < this.halfWidth + this.kerbWidth
        ? SURFACE.KERB
        : SURFACE.OFF;
    out.water = false;
    out.bridge = null;
    return out;
  }

  /** Signed offset in [-1, 1] where ±1 is the track edge. */
  normalisedLateral(lateral) {
    return clamp(lateral / this.halfWidth, -1, 1);
  }

  /** Sub-sample position within the segment straddling `index`, in [-1, 1]. */
  #projectOnSegment(x, z, index) {
    const n = this.sampleCount;
    const a = (index - 1 + n) % n;
    const b = (index + 1) % n;
    const vx = this.px[b] - this.px[a];
    const vz = this.pz[b] - this.pz[a];
    const lenSq = vx * vx + vz * vz;
    if (lenSq < 1e-9) return 0;
    const s = clamp(((x - this.px[a]) * vx + (z - this.pz[a]) * vz) / lenSq, 0, 1);
    return s * 2 - 1;
  }

  isCornerAt(t) {
    return this.curvatureAt(t) > CORNER_CURVATURE;
  }

  /** Polyline of the centreline, for minimaps and previews. */
  outline(steps = 260) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const idx = this.indexAt(i / steps);
      pts.push({ x: this.px[idx], z: this.pz[idx] });
    }
    return pts;
  }
}

// ── Shared instance management ─────────────────────────

let active = null;

export function setActiveCircuit(circuit) {
  active = circuit;
  return circuit;
}

export function getActiveCircuit() {
  if (!active) throw new Error('No active circuit — call setActiveCircuit() first');
  return active;
}

export function loadCircuit(id) {
  return setActiveCircuit(new Circuit(getCircuitById(id)));
}
