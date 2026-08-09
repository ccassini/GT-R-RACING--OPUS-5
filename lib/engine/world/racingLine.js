// ═══════════════════════════════════════════════════════
//  RACING LINE — out-in-out line derived from curvature
//
//  Used three ways: to rubber-in the asphalt visually, to steer the
//  AI, and to draw the optional guide line for the player. Computing
//  it once per circuit keeps all three in agreement.
// ═══════════════════════════════════════════════════════
import { clamp } from '../util.js';

/** Keep the line this far inside the white line. */
const EDGE_MARGIN = 2.4;
/**
 * Standard deviation of the smoothing kernel, in metres. Repeated
 * [.25 .5 .25] passes add 0.5 samples of variance each, so the pass
 * count is derived from this rather than hard-coded — that keeps the
 * line equally flowing on a 2 km street circuit and a 4 km speedway.
 */
const SMOOTHING_METRES = 16;

/**
 * @param {import('./track.js').Circuit} circuit
 * @returns {Float32Array} lateral offset per centreline sample
 */
export function computeRacingLine(circuit) {
  if (circuit._racingLine) return circuit._racingLine;

  const n = circuit.sampleCount;
  const limit = circuit.halfWidth - EDGE_MARGIN;
  const sigmaSamples = SMOOTHING_METRES / circuit.metresPerSample;
  const passes = clamp(Math.round(2 * sigmaSamples * sigmaSamples), 40, 900);

  let maxCurv = 1e-6;
  for (let i = 0; i < n; i++) maxCurv = Math.max(maxCurv, circuit.curvature[i]);

  // Seed: aim at the apex, proportional to how tight the corner is.
  let line = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const signed = circuit.signedCurvature[i];
    const strength = Math.min(1, circuit.curvature[i] / (maxCurv * 0.62));
    // The curve bends toward -side when signed curvature is positive,
    // so the apex sits on that same half of the track.
    line[i] = -Math.sign(signed) * strength * limit;
  }

  // Heavy smoothing turns apex seeking into a real out-in-out arc:
  // the entry and exit naturally swing wide of the corner itself.
  let next = new Float32Array(n);
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < n; i++) {
      const a = line[(i - 1 + n) % n];
      const b = line[i];
      const c = line[(i + 1) % n];
      next[i] = a * 0.25 + b * 0.5 + c * 0.25;
    }
    const swap = line; line = next; next = swap;
  }

  for (let i = 0; i < n; i++) line[i] = clamp(line[i], -limit, limit);

  circuit._racingLine = line;
  return line;
}

/** Interpolated racing-line offset at a normalised parameter. */
export function racingLineAt(circuit, t) {
  const line = computeRacingLine(circuit);
  const n = circuit.sampleCount;
  const f = (((t % 1) + 1) % 1) * n;
  const i0 = Math.floor(f) % n;
  const i1 = (i0 + 1) % n;
  const a = f - Math.floor(f);
  return line[i0] * (1 - a) + line[i1] * a;
}
