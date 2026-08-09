// ═══════════════════════════════════════════════════════
//  AI — racing-line following with lookahead braking,
//  awareness of other cars, and per-driver personality.
//
//  Rivals drive the same Vehicle physics the player does. They only
//  produce inputs, which keeps everyone honest: no AI car can do
//  something the player's car physically could not.
// ═══════════════════════════════════════════════════════
import { BOOST, CORNER_CURVATURE } from '../config.js';
import { clamp, angleDelta, lapDelta, smoothstep } from '../util.js';
import { racingLineAt } from '../world/racingLine.js';
import { SURFACE } from './vehicle.js';

const LOOK_NEAR = 16;
const LOOK_MID = 34;
const BRAKE_LOOK = 62;
const AVOID_RADIUS = 15;

export const PERSONALITIES = [
  { id: 'charger', label: 'CHARGER', aggression: 1.0, patience: 0.35, driftLove: 0.16, lineError: 0.6 },
  { id: 'metronome', label: 'METRONOME', aggression: 0.62, patience: 0.9, driftLove: 0.02, lineError: 0.15 },
  { id: 'opportunist', label: 'OPPORTUNIST', aggression: 0.85, patience: 0.55, driftLove: 0.09, lineError: 0.35 },
  { id: 'bruiser', label: 'BRUISER', aggression: 0.95, patience: 0.3, driftLove: 0.05, lineError: 0.8 },
  { id: 'stylist', label: 'STYLIST', aggression: 0.78, patience: 0.6, driftLove: 0.24, lineError: 0.45 },
];

export class Driver {
  /**
   * @param {import('./vehicle.js').Vehicle} vehicle
   * @param {object} personality
   * @param {object} difficulty entry from DIFFICULTIES
   * @param {number} seed
   */
  constructor(vehicle, personality, difficulty, seed = 0) {
    this.vehicle = vehicle;
    this.personality = personality;
    this.difficulty = difficulty;
    this.seed = seed;
    this.wobblePhase = seed * 2.7;
    this.lineOffset = 0;
    this.recoverTimer = 0;
  }

  /**
   * @param {import('../world/track.js').Circuit} circuit
   * @param {import('./vehicle.js').Vehicle[]} field  every car, this one included
   * @param {import('./vehicle.js').Vehicle|null} player  null when nobody is driving
   */
  update(circuit, field, player, dt, elapsed) {
    const v = this.vehicle;
    const p = this.personality;
    const d = this.difficulty;

    if (v.finished) {
      v.input.throttle = 0;
      v.input.brake = 0.35;
      v.input.steer = this.#steerTowardLine(circuit, LOOK_MID, 0);
      v.input.handbrake = false;
      v.input.boost = false;
      return;
    }

    // Slow drift of the chosen line, so cars are not welded to one path.
    this.wobblePhase += dt * (0.35 + p.aggression * 0.3);
    const skill = d.aiSkill;
    const wobble = Math.sin(this.wobblePhase) * p.lineError * (1.4 - skill) * 2.6;

    // ── Steering ──
    const nearSteer = this.#steerTowardLine(circuit, LOOK_NEAR, wobble);
    const midSteer = this.#steerTowardLine(circuit, LOOK_MID, wobble);
    let steer = midSteer * 0.62 + nearSteer * 0.38;

    // ── Traffic ──
    const traffic = this.#avoidTraffic(field, p, skill);
    steer = clamp(steer + traffic.steer, -1, 1);

    // ── Corner speed ──
    const curvatureAhead = circuit.maxCurvatureAhead(v.trackT, BRAKE_LOOK);
    const nearCurvature = circuit.maxCurvatureAhead(v.trackT, 22);
    const blended = nearCurvature * 0.6 + curvatureAhead * 0.4;

    // A better driver carries more speed through the same corner.
    const cornerCeiling = 1 - smoothstep(0, CORNER_CURVATURE * 3.4, blended) * (0.46 - skill * 0.12);
    let target = v.maxSpeed * cornerCeiling * d.aiSpeed;

    if (traffic.blocked) target *= 0.94;
    if (traffic.overtaking) target *= 1.04;
    if (v.surface === SURFACE.OFF) target *= 0.7;

    target *= this.#rubberBand(player, d);
    target = clamp(target, v.maxSpeed * 0.35, v.maxSpeed * 1.05);

    // ── Pedals ──
    const error = v.speed - target;
    let throttle = 0;
    let brake = 0;
    if (error < -3) throttle = 1;
    else if (error < -0.8) throttle = 0.75;
    else if (error < 1) throttle = 0.4;
    else if (error < 4) throttle = 0.08;
    else brake = clamp((error - 3) / 9, 0.15, 1);

    // ── Recovery from an off ──
    if (v.surface === SURFACE.OFF) this.recoverTimer = 1.2;
    if (this.recoverTimer > 0) {
      this.recoverTimer -= dt;
      throttle = Math.max(throttle, 0.6);
      brake = 0;
    }

    // ── Handbrake for tight corners, mostly for show ──
    const handbrake =
      nearCurvature > CORNER_CURVATURE * 2.2 &&
      Math.abs(steer) > 0.42 &&
      v.speed > v.maxSpeed * 0.55 &&
      Math.random() < p.driftLove * dt * 30;

    // ── Nitro on the exits ──
    const straightAhead = curvatureAhead < CORNER_CURVATURE * 0.8;
    const boost =
      v.boost > BOOST.capacity * (0.55 - d.aiSkill * 0.2) &&
      straightAhead &&
      v.speed > v.maxSpeed * 0.6;

    v.input.throttle = throttle;
    v.input.brake = brake;
    v.input.steer = steer;
    v.input.handbrake = handbrake;
    v.input.boost = boost;
  }

  #steerTowardLine(circuit, lookDistance, wobble) {
    const v = this.vehicle;
    const aheadT = v.trackT + lookDistance / circuit.length;
    const idx = circuit.indexAt(aheadT);
    const lateral = clamp(
      racingLineAt(circuit, aheadT) + wobble + this.lineOffset,
      -circuit.halfWidth + 2,
      circuit.halfWidth - 2,
    );

    const targetX = circuit.px[idx] + circuit.sx[idx] * lateral;
    const targetZ = circuit.pz[idx] + circuit.sz[idx] * lateral;
    const desired = Math.atan2(targetX - v.x, targetZ - v.z);
    return clamp(angleDelta(v.heading, desired) * 2.8, -1, 1);
  }

  #avoidTraffic(field, personality, skill) {
    const v = this.vehicle;
    let steer = 0;
    let blocked = false;
    let overtaking = false;

    const forwardX = Math.sin(v.heading);
    const forwardZ = Math.cos(v.heading);

    for (const other of field) {
      if (other === v) continue;
      const dx = other.x - v.x;
      const dz = other.z - v.z;
      const distance = Math.hypot(dx, dz);
      if (distance > AVOID_RADIUS || distance < 0.001) continue;

      const ahead = dx * forwardX + dz * forwardZ;
      const lateralSide = dx * forwardZ - dz * forwardX;
      const urgency = 1 - distance / AVOID_RADIUS;

      if (ahead > 0) {
        // Someone in front: pick a side and commit.
        const dodge = lateralSide > 0 ? -1 : 1;
        steer += dodge * urgency * (0.55 + personality.aggression * 0.35) * skill;
        blocked = true;
        if (v.speed > other.speed + 1) overtaking = true;
      } else if (other.isPlayer && distance < 11 && personality.aggression > 0.7) {
        // Defend the inside line against the player behind.
        steer += Math.sign(lateralSide) * 0.25 * personality.aggression * (1 - personality.patience);
      }
    }

    return { steer: clamp(steer, -0.85, 0.85), blocked, overtaking };
  }

  /**
   * Keep the pack in shot without letting it feel rigged: rivals that
   * fall a long way behind get a small boost, runaway leaders lift.
   */
  #rubberBand(player, difficulty) {
    if (!player || player.finished) return 1;
    const gap = lapDelta(player.progress % 1, this.vehicle.progress % 1)
      + (this.vehicle.lap - player.lap);
    const clamped = clamp(gap, -0.5, 0.5);
    if (clamped < -0.02) return 1 + Math.abs(clamped) * difficulty.rubberBand * 2;
    if (clamped > 0.02) return 1 - clamped * difficulty.rubberBand;
    return 1;
  }
}
