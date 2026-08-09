// ═══════════════════════════════════════════════════════
//  VEHICLE — one physics model, driven by player input or AI
//
//  Arcade handling on purpose: a heading that steers directly and a
//  velocity heading that chases it at a rate set by grip. The gap
//  between the two *is* the drift, and it drives the tyre smoke, the
//  scoring and the nitro charge.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';
import { PHYS, BOOST, DRIFT, SURFACE, SURFACES, OVER_CEILING_BITE } from '../config.js';
import { statsToPhysics } from '../cars/catalog.js';
import { clamp, clamp01, angleDelta, damp, lerp } from '../util.js';

export { SURFACE };

export class Vehicle {
  /**
   * @param {object} opts
   * @param {object} opts.car    catalogue entry
   * @param {object} opts.paint
   * @param {THREE.Group} opts.mesh
   * @param {boolean} opts.isPlayer
   * @param {string} opts.name   short name for the standings tower
   */
  constructor({ car, paint, mesh, isPlayer = false, name }) {
    this.car = car;
    this.paint = paint;
    this.mesh = mesh;
    this.isPlayer = isPlayer;
    this.name = name;
    this.physics = statsToPhysics(car.stats);

    this.halfLength = car.shape.length / 2;
    this.halfWidth = car.shape.width / 2;

    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };

    this.reset(0, 0, 0);
  }

  reset(x, z, heading) {
    this.x = x;
    this.z = z;
    this.y = 0;
    this.heading = heading;
    this.velHeading = heading;
    this.speed = 0;
    this.drift = 0;
    this.onTrack = true;
    this.surface = SURFACE.TRACK;
    this.inWater = false;
    this.onBridge = null;
    this.impulseX = 0;
    this.impulseZ = 0;
    this.wheelSpin = 0;
    this.steerVisual = 0;

    this.boost = BOOST.capacity;
    this.boostActive = false;
    this.driftScore = 0;
    this.driftCombo = 1;
    this.driftTimer = 0;
    this.driftBank = 0;
    this.driftGrace = 0;

    this.trackT = 0;
    this.prevTrackT = 0;
    this.lateral = 0;
    this.distanceFromCentre = 0;
    this.lap = 0;
    this.hasPassedHalf = false;
    /** False until the car has crossed the line for the first time. */
    this.started = false;
    this.finished = false;
    this.finishTime = 0;
    this.progress = 0;
    this.position = 1;
    this.collisionCooldown = 0;

    this._nearest = {};
  }

  get maxSpeed() {
    return PHYS.maxSpeed * this.physics.speed;
  }

  get displaySpeed() {
    return Math.round(Math.abs(this.speed) * PHYS.speedToKmh);
  }

  get boostFraction() {
    return this.boost / BOOST.capacity;
  }

  // ── Simulation ──

  /**
   * @param {number} dt
   * @param {{ sampleSurface(x: number, z: number, out: object): object }} ground
   *   A circuit or the open-world city map — the physics does not care
   *   which, as long as it can be asked what is under the wheels.
   */
  step(dt, ground) {
    const p = this.physics;
    const input = this.input;

    const nearest = ground.sampleSurface(this.x, this.z, this._nearest);
    this.trackT = nearest.t ?? 0;
    this.lateral = nearest.lateral ?? 0;
    this.distanceFromCentre = nearest.dist;
    this.y = nearest.y;
    this.surface = nearest.surface;
    this.onTrack = this.surface !== SURFACE.OFF;
    this.inWater = nearest.water === true;
    this.onBridge = nearest.bridge ?? null;

    // ── Nitro ──
    const wantsBoost = input.boost && this.boost >= BOOST.minToFire;
    if (this.boostActive) {
      this.boost = Math.max(0, this.boost - BOOST.drainRate * dt);
      if (this.boost <= 0 || !input.boost) this.boostActive = false;
    } else if (wantsBoost) {
      this.boostActive = true;
    }

    const boostMul = this.boostActive ? 1 : 0;
    const topSpeed = PHYS.maxSpeed * p.speed * (1 + BOOST.speedBonus * boostMul);
    const surface = SURFACES[this.surface];

    // ── Longitudinal ──
    // Power tapers as the car approaches its ceiling, so acceleration
    // is punchy off a corner and flattens out at the top end.
    const ceiling = topSpeed * surface.ceiling;
    const absBefore = Math.abs(this.speed);
    const headroom = clamp01(1 - absBefore / Math.max(ceiling, 1));
    const accel = PHYS.accel * p.accel
      * (1 + BOOST.accelBonus * boostMul)
      * surface.power
      * (0.35 + 0.65 * headroom);

    if (input.throttle > 0) {
      this.speed += accel * input.throttle * dt;
    } else if (input.brake > 0) {
      this.speed -= PHYS.brake * input.brake * dt;
    } else {
      const drag = PHYS.drag * dt;
      this.speed = this.speed > 0 ? Math.max(0, this.speed - drag) : Math.min(0, this.speed + drag);
    }

    if (input.handbrake && Math.abs(this.speed) > 2) {
      const drag = PHYS.handbrakeDrag * dt;
      this.speed = this.speed > 0 ? Math.max(0, this.speed - drag) : Math.min(0, this.speed + drag);
    }

    // Over the surface ceiling the ground fights back, harder the
    // further over you are. This is what makes grass cost lap time.
    const overBy = Math.abs(this.speed) - ceiling;
    if (overBy > 0) {
      const decel = (surface.bite + overBy * OVER_CEILING_BITE) * dt;
      const magnitude = Math.max(ceiling, Math.abs(this.speed) - decel);
      this.speed = Math.sign(this.speed) * magnitude;
    }

    this.speed = clamp(this.speed, -topSpeed * PHYS.reverseFrac, topSpeed);

    // ── Steering ──
    const absSpeed = Math.abs(this.speed);
    const speedFrac = absSpeed / this.maxSpeed;
    // Barely responsive when crawling, progressively duller at speed.
    const authority = Math.min(absSpeed / 12, 1) * Math.max(0.45, 1 - speedFrac * 0.55);
    const brakeBonus = input.brake > 0.3 && this.speed > 2 ? PHYS.brakeTurnBonus : 1;
    const handbrakeBonus = input.handbrake ? PHYS.handbrakeTurnBonus : 1;

    this.heading += input.steer * PHYS.turnRate * p.turn * authority * brakeBonus * handbrakeBonus * dt;

    let grip = surface.grip * p.grip;
    if (input.handbrake) grip *= PHYS.handbrakeGrip;
    grip /= p.drift;

    this.velHeading += angleDelta(this.velHeading, this.heading) * clamp01(grip * 5 * dt);
    this.drift = angleDelta(this.velHeading, this.heading);

    // ── Integrate ──
    const moveX = Math.sin(this.velHeading);
    const moveZ = Math.cos(this.velHeading);
    this.x += moveX * this.speed * dt + this.impulseX * dt;
    this.z += moveZ * this.speed * dt + this.impulseZ * dt;

    const decay = Math.max(0, 1 - 5 * dt);
    this.impulseX *= decay;
    this.impulseZ *= decay;
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);

    this.#updateDrift(dt, absSpeed);
    this.wheelSpin += (this.speed / Math.max(0.1, this.car.shape.wheelRadius)) * dt;
  }

  #updateDrift(dt, absSpeed) {
    const absDrift = Math.abs(this.drift);
    const isDrifting =
      absDrift > DRIFT.minAngle && absSpeed > DRIFT.minSpeed && this.surface !== SURFACE.OFF;

    if (isDrifting) {
      // Quality peaks at a big-but-controlled angle and falls off past it.
      const angleQuality = clamp01(
        (absDrift - DRIFT.minAngle) / (DRIFT.maxAngle - DRIFT.minAngle),
      );
      const shaped = Math.sin(angleQuality * Math.PI) * 0.6 + angleQuality * 0.4;
      const speedQuality = clamp01(absSpeed / this.maxSpeed);
      const quality = shaped * speedQuality;

      this.driftTimer += dt;
      this.driftCombo = Math.min(
        DRIFT.maxCombo,
        1 + Math.floor(this.driftTimer / DRIFT.comboStep),
      );
      this.driftBank += DRIFT.baseScore * quality * this.driftCombo * dt;
      if (!this.boostActive) {
        this.boost = Math.min(
          BOOST.capacity,
          this.boost + BOOST.chargeRate * quality * dt,
        );
      }
      this.driftGrace = DRIFT.breakGrace;
    } else if (this.driftTimer > 0) {
      this.driftGrace -= dt;
      if (this.driftGrace <= 0) {
        this.driftScore += this.driftBank;
        this.driftBank = 0;
        this.driftTimer = 0;
        this.driftCombo = 1;
      }
    }
  }

  /** Total score including the drift currently in progress. */
  get totalDriftScore() {
    return this.driftScore + this.driftBank;
  }

  // ── Presentation ──

  applyVisuals(dt) {
    const mesh = this.mesh;
    const data = mesh.userData;

    mesh.position.set(this.x, this.y, this.z);
    mesh.rotation.y = this.heading;

    // Lean into the slide and pitch under load.
    const targetRoll = clamp(this.drift * 0.32, -0.28, 0.28);
    mesh.rotation.z = damp(mesh.rotation.z, targetRoll, 6, dt);
    const load = (this.input.throttle > 0 ? -0.035 : 0) + (this.input.brake > 0 ? 0.05 : 0);
    mesh.rotation.x = damp(mesh.rotation.x, load * clamp01(Math.abs(this.speed) / this.maxSpeed), 6, dt);

    // Steered front wheels.
    const maxSteer = 0.46 * Math.max(0.35, 1 - Math.abs(this.speed) / this.maxSpeed * 0.5);
    this.steerVisual = damp(this.steerVisual, this.input.steer * maxSteer, 9, dt);
    for (const pivot of data.frontWheels) pivot.rotation.y = this.steerVisual;
    for (const spinner of data.allWheels) spinner.rotation.x = this.wheelSpin;

    // Brake lights.
    const braking = this.input.brake > 0.15 || this.input.handbrake || this.speed < -0.8;
    const mat = data.brakeLightMaterial;
    mat.emissive.setHex(braking ? 0xff2a12 : 0x000000);
    mat.emissiveIntensity = braking ? 2.4 : 0;

    // Nitro jets.
    const jetTarget = this.boostActive ? 1 : 0;
    const jetMat = data.jetMaterial;
    jetMat.opacity = damp(jetMat.opacity, jetTarget * 0.85, 12, dt);
    const stretch = jetMat.opacity * (0.85 + Math.random() * 0.35);
    for (const jet of data.jets) jet.scale.set(0.8 + stretch * 0.4, 0.8 + stretch * 0.4, stretch);

    // Contact shadow tightens as the car is loaded up.
    data.contactShadow.material.opacity = lerp(0.5, 0.32, clamp01(Math.abs(this.speed) / this.maxSpeed));
  }
}

// ── Collisions ─────────────────────────────────────────
// Separating-axis test between two oriented rectangles, then a
// mass-weighted push apart plus a lateral impulse so contact feels
// like contact rather than two boxes teleporting.

const AXES = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }];

function overlapOf(a, b) {
  const aFwd = { x: Math.sin(a.heading), z: Math.cos(a.heading) };
  const aRight = { x: Math.cos(a.heading), z: -Math.sin(a.heading) };
  const bFwd = { x: Math.sin(b.heading), z: Math.cos(b.heading) };
  const bRight = { x: Math.cos(b.heading), z: -Math.sin(b.heading) };

  AXES[0] = aFwd; AXES[1] = aRight; AXES[2] = bFwd; AXES[3] = bRight;

  let minOverlap = Infinity;
  let nx = 0;
  let nz = 0;

  for (const axis of AXES) {
    const rA = a.halfWidth * Math.abs(aRight.x * axis.x + aRight.z * axis.z)
             + a.halfLength * Math.abs(aFwd.x * axis.x + aFwd.z * axis.z);
    const rB = b.halfWidth * Math.abs(bRight.x * axis.x + bRight.z * axis.z)
             + b.halfLength * Math.abs(bFwd.x * axis.x + bFwd.z * axis.z);

    const dA = a.x * axis.x + a.z * axis.z;
    const dB = b.x * axis.x + b.z * axis.z;
    const gap = Math.abs(dB - dA) - (rA + rB);
    if (gap > 0) return null;

    if (-gap < minOverlap) {
      minOverlap = -gap;
      const flip = dB - dA < 0 ? -1 : 1;
      nx = axis.x * flip;
      nz = axis.z * flip;
    }
  }
  return { overlap: minOverlap, nx, nz };
}

/**
 * @param {Vehicle[]} vehicles
 * @param {(a: Vehicle, b: Vehicle, force: number) => void} [onImpact]
 */
export function resolveCollisions(vehicles, onImpact) {
  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i];
      const b = vehicles[j];

      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const reach = a.halfLength + b.halfLength;
      if (dx * dx + dz * dz > reach * reach) continue;

      const hit = overlapOf(a, b);
      if (!hit) continue;

      const massA = a.physics.mass;
      const massB = b.physics.mass;
      const total = massA + massB;
      const shareA = massB / total;
      const shareB = massA / total;

      a.x -= hit.nx * hit.overlap * shareA;
      a.z -= hit.nz * hit.overlap * shareA;
      b.x += hit.nx * hit.overlap * shareB;
      b.z += hit.nz * hit.overlap * shareB;

      const closing = Math.abs(a.speed - b.speed) + 4;
      const impulse = clamp(closing * 0.85, 3, 16);
      a.impulseX -= hit.nx * impulse * shareA;
      a.impulseZ -= hit.nz * impulse * shareA;
      b.impulseX += hit.nx * impulse * shareB;
      b.impulseZ += hit.nz * impulse * shareB;

      a.speed *= 0.9;
      b.speed *= 0.9;
      if (!a.isPlayer) a.heading += (Math.random() - 0.5) * 0.08;
      if (!b.isPlayer) b.heading += (Math.random() - 0.5) * 0.08;

      if (onImpact && (a.collisionCooldown <= 0 || b.collisionCooldown <= 0)) {
        a.collisionCooldown = 0.25;
        b.collisionCooldown = 0.25;
        onImpact(a, b, impulse / 16);
      }
    }
  }
}

/** Keep cars from driving out of the world; the barrier is solid. */
export function clampToBarrier(vehicle, circuit, limit, onHit) {
  const overshoot = vehicle.distanceFromCentre - limit;
  if (overshoot <= 0) return;

  const idx = circuit.indexAt(vehicle.trackT);
  const sign = Math.sign(vehicle.lateral) || 1;
  vehicle.x -= circuit.sx[idx] * sign * overshoot;
  vehicle.z -= circuit.sz[idx] * sign * overshoot;
  vehicle.speed *= 0.72;
  vehicle.impulseX -= circuit.sx[idx] * sign * 6;
  vehicle.impulseZ -= circuit.sz[idx] * sign * 6;
  if (onHit && vehicle.collisionCooldown <= 0) {
    vehicle.collisionCooldown = 0.3;
    onHit(vehicle, clamp01(Math.abs(vehicle.speed) / vehicle.maxSpeed));
  }
}
