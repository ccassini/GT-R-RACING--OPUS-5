// ═══════════════════════════════════════════════════════
//  CAMERA RIG — bird's-eye by default, with a pure overhead
//  and a low chase view a keypress away.
//
//  BIRD sits at roughly 53 degrees above the car: high enough to be
//  a genuine aerial view, shallow enough that the long sunset
//  shadows and 40-90 m of road ahead still read. The yaw lags the
//  car heavily on purpose — a top-down camera that snaps to every
//  steering input is unreadable.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';
import { CAMERAS, CAMERA_ORDER } from './config.js';
import { angleDelta, clamp01, damp, lerp } from './util.js';

export class CameraRig {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(CAMERAS.chase.fov, aspect, 1.2, 4200);
    this.modeId = 'chase';
    this.mode = CAMERAS.chase;

    this.yaw = 0;
    this.focus = new THREE.Vector3();
    this.position = new THREE.Vector3();
    this.shakeAmount = 0;
    this.shakeOffset = new THREE.Vector3();
    this.rollAngle = 0;
    this.fov = this.mode.fov;

    this._forward = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._look = new THREE.Vector3();
  }

  setMode(id) {
    if (!CAMERAS[id]) return this.modeId;
    this.modeId = id;
    this.mode = CAMERAS[id];
    return id;
  }

  cycleMode() {
    const next = (CAMERA_ORDER.indexOf(this.modeId) + 1) % CAMERA_ORDER.length;
    return this.setMode(CAMERA_ORDER[next]);
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  addShake(amount) {
    this.shakeAmount = Math.min(1.4, this.shakeAmount + amount);
  }

  /**
   * @param {object} subject { x, y, z, heading, velHeading, speed, maxSpeed, drift }
   * @param {number} dt
   * @param {boolean} [snap] place the camera instantly (race start, mode switch)
   */
  follow(subject, dt, snap = false) {
    const m = this.mode;
    const speedFrac = clamp01(Math.abs(subject.speed) / (subject.maxSpeed || 1));

    // Track the direction of travel, not the nose: during a drift the
    // camera should stay behind where the car is actually going.
    const travel = lerp(subject.heading, subject.heading - (subject.drift ?? 0) * 0.6, 0.5);
    const yawStep = snap ? 1 : 1 - Math.exp(-m.yawRate * dt);
    this.yaw += angleDelta(this.yaw, travel) * yawStep;

    this._forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));

    // Look ahead of the car, further the faster it is going.
    this._look.set(subject.x, subject.y ?? 0, subject.z)
      .addScaledVector(this._forward, m.lookAhead * speedFrac);

    const height = m.height + m.speedHeight * speedFrac;
    const behind = m.behind + m.speedBehind * speedFrac;

    this._desired.copy(this._look)
      .addScaledVector(this._forward, -behind);
    this._desired.y += height;

    if (snap) {
      this.position.copy(this._desired);
      this.focus.copy(this._look);
    } else {
      const rate = m.followRate;
      this.position.set(
        damp(this.position.x, this._desired.x, rate, dt),
        damp(this.position.y, this._desired.y, rate, dt),
        damp(this.position.z, this._desired.z, rate, dt),
      );
      this.focus.set(
        damp(this.focus.x, this._look.x, rate * 1.25, dt),
        damp(this.focus.y, this._look.y, rate * 1.25, dt),
        damp(this.focus.z, this._look.z, rate * 1.25, dt),
      );
    }

    this.#applyShake(dt);
    this.camera.position.copy(this.position).add(this.shakeOffset);
    this.camera.lookAt(this.focus);

    // Bank into the drift for a touch of motion energy.
    const targetRoll = -(subject.drift ?? 0) * m.roll;
    this.rollAngle = damp(this.rollAngle, targetRoll, 5, dt);
    this.camera.rotateZ(this.rollAngle);

    const targetFov = m.fov + m.speedFov * speedFrac;
    this.fov = snap ? targetFov : damp(this.fov, targetFov, 4, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Directly place the camera — used by the cinematic director. */
  place(position, lookAt, fov, dt) {
    const rate = 2.4;
    this.position.set(
      damp(this.position.x, position.x, rate, dt),
      damp(this.position.y, position.y, rate, dt),
      damp(this.position.z, position.z, rate, dt),
    );
    this.focus.set(
      damp(this.focus.x, lookAt.x, rate, dt),
      damp(this.focus.y, lookAt.y, rate, dt),
      damp(this.focus.z, lookAt.z, rate, dt),
    );
    this.#applyShake(dt);
    this.camera.position.copy(this.position).add(this.shakeOffset);
    this.camera.lookAt(this.focus);
    this.rollAngle = damp(this.rollAngle, 0, 4, dt);
    this.fov = damp(this.fov, fov, 2.5, dt);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  snapTo(position, lookAt, fov) {
    this.position.copy(position);
    this.focus.copy(lookAt);
    this.camera.position.copy(position);
    this.camera.lookAt(lookAt);
    this.fov = fov;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  #applyShake(dt) {
    if (this.shakeAmount <= 0.0001) {
      this.shakeOffset.set(0, 0, 0);
      return;
    }
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 2.4);
    const a = this.shakeAmount * this.shakeAmount * 0.9;
    this.shakeOffset.set(
      (Math.random() - 0.5) * a,
      (Math.random() - 0.5) * a * 0.7,
      (Math.random() - 0.5) * a,
    );
  }
}

// ═══════════════════════════════════════════════════════
//  CINEMATIC DIRECTOR — the menu / attract camera
//
//  This is where the sky earns its keep: shots deliberately drop to
//  ground level and look toward the sun between the aerial passes.
// ═══════════════════════════════════════════════════════

const SHOTS = [
  { id: 'lowSweep', duration: 8.5, fov: 40 },
  { id: 'crane', duration: 7.5, fov: 46 },
  { id: 'aerialChase', duration: 8, fov: 44 },
  { id: 'apex', duration: 7, fov: 34 },
];

export class CinematicDirector {
  constructor(circuit) {
    this.circuit = circuit;
    this.shotIndex = 0;
    this.elapsed = 0;
    this.position = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this._frame = circuit.frame(0);
  }

  next() {
    this.shotIndex = (this.shotIndex + 1) % SHOTS.length;
    this.elapsed = 0;
  }

  /**
   * @param {number} dt
   * @param {{x:number,y:number,z:number,heading:number}} subject car to feature
   * @param {CameraRig} rig
   */
  update(dt, subject, rig) {
    this.elapsed += dt;
    const shot = SHOTS[this.shotIndex];
    if (this.elapsed > shot.duration) this.next();

    const progress = this.elapsed / shot.duration;
    const forward = new THREE.Vector3(Math.sin(subject.heading), 0, Math.cos(subject.heading));
    const side = new THREE.Vector3(forward.z, 0, -forward.x);
    const base = new THREE.Vector3(subject.x, subject.y ?? 0, subject.z);

    switch (shot.id) {
      case 'lowSweep': {
        // Ground level, looking past the car into the sun.
        this.position.copy(base)
          .addScaledVector(forward, -9 - progress * 6)
          .addScaledVector(side, 6.5 - progress * 13);
        this.position.y = base.y + 1.5;
        this.lookAt.copy(base).addScaledVector(forward, 16);
        this.lookAt.y = base.y + 3.2;
        break;
      }
      case 'crane': {
        // Rise from the barrier line up into a wide aerial.
        const rise = progress * progress;
        this.position.copy(base)
          .addScaledVector(forward, -14)
          .addScaledVector(side, 18 - rise * 8);
        this.position.y = base.y + 3 + rise * 40;
        this.lookAt.copy(base);
        this.lookAt.y = base.y + 1;
        break;
      }
      case 'aerialChase': {
        this.position.copy(base)
          .addScaledVector(forward, -18)
          .addScaledVector(side, Math.sin(progress * Math.PI) * 14);
        this.position.y = base.y + 34;
        this.lookAt.copy(base).addScaledVector(forward, 12);
        break;
      }
      default: {
        // Static apex camera: the car sweeps through frame.
        const idx = this.circuit.indexAt(0.5 + this.shotIndex * 0.07);
        const c = this.circuit;
        this.position.set(
          c.px[idx] + c.sx[idx] * 26,
          c.py[idx] + 9,
          c.pz[idx] + c.sz[idx] * 26,
        );
        this.lookAt.copy(base);
        this.lookAt.y = base.y + 1;
        break;
      }
    }

    rig.place(this.position, this.lookAt, shot.fov, dt);
  }
}
