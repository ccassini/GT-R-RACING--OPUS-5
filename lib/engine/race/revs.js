// ═══════════════════════════════════════════════════════
//  REVS — what the tachometer needle is actually pointing at
//
//  The HUD already showed a gear, derived by chopping the speed range
//  into six. A rev counter driven straight off speed would then be the
//  speedometer again with a different scale on it — the needle would
//  sweep once from a standstill to terminal velocity and never drop.
//
//  So the same six bands set the revs: inside a gear the needle climbs
//  to the limiter, and crossing into the next one drops it back into
//  the middle of the range. The gear readout and the needle come from
//  this one function, so they can never disagree about which gear the
//  car is in.
//
//  Instrument only. The engine note is synthesised from road speed and
//  is deliberately left alone.
// ═══════════════════════════════════════════════════════
import { clamp01, lerp } from '../util.js';

export const IDLE_RPM = 800;
export const REDLINE_RPM = 8000;
export const GEAR_COUNT = 6;
/** Fraction of the rev range where the red zone starts. */
export const REDLINE_FRACTION = 0.78;

/** Where the needle lands after a shift, as a fraction of the range. */
const FIRST_GEAR_FLOOR = 0.1;
const UPSHIFT_FLOOR = 0.44;
/** Below this the car is stationary enough to be sitting in neutral. */
const ROLLING = 0.015;

/**
 * @param {number} speedFrac 0..1 of the car's own top speed
 * @param {number} throttle  0..1
 * @param {object} [out]     reused; this runs every frame
 */
export function revsFor(speedFrac, throttle, out = {}) {
  if (speedFrac < ROLLING) {
    // Neutral: blipping the throttle revs it, lifting lets it fall back.
    out.gearIndex = -1;
    out.gear = 'N';
    out.rpmFrac = throttle * 0.5;
    out.rpm = lerp(IDLE_RPM, REDLINE_RPM * 0.7, out.rpmFrac);
    return out;
  }

  const scaled = clamp01(speedFrac) * GEAR_COUNT;
  const gearIndex = Math.min(GEAR_COUNT - 1, Math.floor(scaled));
  const within = Math.min(1, scaled - gearIndex);
  const floor = gearIndex === 0 ? FIRST_GEAR_FLOOR : UPSHIFT_FLOOR;

  out.gearIndex = gearIndex;
  out.gear = String(gearIndex + 1);
  out.rpmFrac = clamp01(floor + within * (1 - floor));
  out.rpm = lerp(IDLE_RPM, REDLINE_RPM, out.rpmFrac);
  return out;
}
