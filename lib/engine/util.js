// ═══════════════════════════════════════════════════════
//  UTIL — math, deterministic noise, formatting
//  Pure functions only. No THREE, no DOM.
// ═══════════════════════════════════════════════════════

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));

export function smoothstep(edge0, edge1, x) {
  const t = clamp01(invLerp(edge0, edge1, x));
  return t * t * (3 - 2 * t);
}

/**
 * Frame-rate independent exponential smoothing.
 * `rate` is roughly "how many e-foldings per second".
 */
export const damp = (current, target, rate, dt) =>
  lerp(current, target, 1 - Math.exp(-rate * dt));

/** Shortest signed difference between two angles, in (-PI, PI]. */
export function angleDelta(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export const wrapAngle = (a) => angleDelta(0, a);

/** Wrap a normalised track parameter into [0, 1). */
export const wrap01 = (t) => ((t % 1) + 1) % 1;

/** Shortest signed difference between two lap parameters, in (-0.5, 0.5]. */
export function lapDelta(from, to) {
  let d = (to - from) % 1;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return d;
}

// ── Deterministic randomness ───────────────────────────

/** Small, fast, well-distributed PRNG. Returns a function in [0, 1). */
export function makeRng(seed = 1) {
  let a = seed >>> 0 || 1;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convenience wrappers around an rng function. */
export const rngRange = (rng, a, b) => a + rng() * (b - a);
export const rngPick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];
export const rngSign = (rng) => (rng() < 0.5 ? -1 : 1);

// ── Value noise / fBm ──────────────────────────────────

function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * Smooth 2D value noise in [-1, 1]. Deterministic for a given seed.
 */
export function makeNoise2D(seed = 1337) {
  const s = seed | 0;
  return function noise(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);

    const n00 = hash2(x0, y0, s);
    const n10 = hash2(x0 + 1, y0, s);
    const n01 = hash2(x0, y0 + 1, s);
    const n11 = hash2(x0 + 1, y0 + 1, s);

    const nx0 = lerp(n00, n10, ux);
    const nx1 = lerp(n01, n11, ux);
    return lerp(nx0, nx1, uy) * 2 - 1;
  };
}

/**
 * Fractal Brownian motion built on value noise.
 * Returns a function (x, y) => value in roughly [-1, 1].
 */
export function makeFbm2D({ seed = 1337, octaves = 4, lacunarity = 2.0, gain = 0.5 } = {}) {
  const noise = makeNoise2D(seed);
  // Normalise so the sum of amplitudes maps back to ~[-1, 1].
  let norm = 0;
  for (let i = 0, amp = 1; i < octaves; i++, amp *= gain) norm += amp;
  return function fbm(x, y) {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    for (let i = 0; i < octaves; i++) {
      sum += noise(x * freq, y * freq) * amp;
      freq *= lacunarity;
      amp *= gain;
    }
    return sum / norm;
  };
}

// ── Formatting ─────────────────────────────────────────

/** `1:23.456` — the canonical motorsport lap-time format. */
export function formatLapTime(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return '--:--.---';
  const mins = Math.floor(seconds / 60);
  const secs = seconds - mins * 60;
  const whole = Math.floor(secs);
  const ms = Math.round((secs - whole) * 1000);
  return `${mins}:${String(whole).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/** `+1.234` / `-0.512` — signed gap, for deltas against a reference lap. */
export function formatDelta(seconds) {
  if (!isFinite(seconds)) return '--.---';
  const sign = seconds >= 0 ? '+' : '-';
  return `${sign}${Math.abs(seconds).toFixed(3)}`;
}

/** `+2.4` — short gap used in the live standings tower. */
export function formatGap(seconds) {
  if (!isFinite(seconds)) return '--';
  if (Math.abs(seconds) >= 60) return `+${Math.floor(Math.abs(seconds) / 60)}m`;
  return `+${Math.abs(seconds).toFixed(1)}`;
}

export const ORDINALS = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH', '8TH'];
export const ordinal = (pos) => ORDINALS[pos - 1] ?? `${pos}TH`;
