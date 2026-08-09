// ═══════════════════════════════════════════════════════
//  PARTICLES — one GPU point cloud, several emitters
//
//  Tyre smoke, dirt, sparks and nitro all share a single buffer and
//  draw call. Each particle carries its own colour, size curve and
//  drag, which is enough variety without a second system.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';
import { clamp01 } from '../util.js';

const VERTEX = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 tint;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    vAlpha = alpha;
    vTint = tint;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (320.0 / max(-mv.z, 1.0));
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  precision mediump float;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.15, d) * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vTint, a);
  }
`;

export class ParticleSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {number} capacity
   * @param {'additive'|'normal'} blending
   */
  constructor(scene, capacity, blending = 'normal') {
    this.capacity = capacity;
    this.cursor = 0;

    this.positions = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    this.tints = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.growth = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.peakAlpha = new Float32Array(capacity);

    for (let i = 0; i < capacity; i++) this.positions[i * 3 + 1] = -1000;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1));
    geometry.setAttribute('tint', new THREE.BufferAttribute(this.tints, 3));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2000);

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    });

    this.geometry = geometry;
    this.material = material;
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
    this.scene = scene;
  }

  emit({
    x, y, z,
    vx = 0, vy = 0, vz = 0,
    size = 2, growth = 4, life = 1,
    color = 0xffffff, alpha = 0.6,
    drag = 1.4, gravity = 0,
  }) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;

    const p3 = i * 3;
    this.positions[p3] = x;
    this.positions[p3 + 1] = y;
    this.positions[p3 + 2] = z;
    this.velocities[p3] = vx;
    this.velocities[p3 + 1] = vy;
    this.velocities[p3 + 2] = vz;

    const c = COLOR_CACHE.setHex(color);
    this.tints[p3] = c.r;
    this.tints[p3 + 1] = c.g;
    this.tints[p3 + 2] = c.b;

    this.sizes[i] = size;
    this.growth[i] = growth;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.peakAlpha[i] = alpha;
    this.alphas[i] = alpha;
    this.drag[i] = drag;
    this.gravity[i] = gravity;
  }

  update(dt) {
    const { positions, velocities, life, maxLife } = this;
    for (let i = 0; i < this.capacity; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      const p3 = i * 3;

      if (life[i] <= 0) {
        positions[p3 + 1] = -1000;
        this.alphas[i] = 0;
        continue;
      }

      const decay = Math.max(0, 1 - this.drag[i] * dt);
      velocities[p3] *= decay;
      velocities[p3 + 1] = velocities[p3 + 1] * decay - this.gravity[i] * dt;
      velocities[p3 + 2] *= decay;

      positions[p3] += velocities[p3] * dt;
      positions[p3 + 1] += velocities[p3 + 1] * dt;
      positions[p3 + 2] += velocities[p3 + 2] * dt;

      const t = life[i] / maxLife[i];
      this.sizes[i] += this.growth[i] * dt;
      // Quick fade in, slow fade out.
      this.alphas[i] = this.peakAlpha[i] * Math.min(1, (1 - t) * 6) * t;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.size.needsUpdate = true;
    this.geometry.attributes.alpha.needsUpdate = true;
    this.geometry.attributes.tint.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alphas.fill(0);
    for (let i = 0; i < this.capacity; i++) this.positions[i * 3 + 1] = -1000;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.alpha.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}

const COLOR_CACHE = new THREE.Color();

// ── Emitters ───────────────────────────────────────────

/**
 * Bundles the smoke/dirt/spark systems and the emitter helpers that
 * translate a vehicle's state into particles.
 */
export class VehicleFx {
  constructor(scene, quality, theme) {
    this.smoke = new ParticleSystem(scene, quality.smokeCount, 'normal');
    this.dirt = new ParticleSystem(scene, quality.dustCount, 'normal');
    this.sparks = new ParticleSystem(scene, quality.sparkCount, 'additive');
    this.smokeColor = new THREE.Color(theme.light.hemiSky).lerp(new THREE.Color(0xffffff), 0.45).getHex();
    this.dirtColor = new THREE.Color(theme.terrain.dry).getHex();
    this.accumulators = new WeakMap();
  }

  update(dt) {
    this.smoke.update(dt);
    this.dirt.update(dt);
    this.sparks.update(dt);
  }

  clear() {
    this.smoke.clear();
    this.dirt.clear();
    this.sparks.clear();
  }

  dispose() {
    this.smoke.dispose();
    this.dirt.dispose();
    this.sparks.dispose();
  }

  /** Drive every emitter from one vehicle's per-frame state. */
  emitForVehicle(vehicle, dt) {
    const absSpeed = Math.abs(vehicle.speed);
    const absDrift = Math.abs(vehicle.drift);
    const speedFrac = clamp01(absSpeed / vehicle.maxSpeed);

    const backX = -Math.sin(vehicle.velHeading);
    const backZ = -Math.cos(vehicle.velHeading);
    const rightX = Math.cos(vehicle.heading);
    const rightZ = -Math.sin(vehicle.heading);
    const rearOffset = vehicle.halfLength * 0.86;
    const trackHalf = vehicle.car.shape.trackWidth / 2;

    const acc = this.#accumulator(vehicle);

    // ── Tyre smoke while sliding ──
    const slideStrength = clamp01((absDrift - 0.14) / 0.5) * speedFrac;
    if (slideStrength > 0.02 && vehicle.onTrack) {
      acc.smoke += slideStrength * 90 * dt;
      while (acc.smoke >= 1) {
        acc.smoke -= 1;
        for (const side of [-1, 1]) {
          this.smoke.emit({
            x: vehicle.x + backX * rearOffset + rightX * side * trackHalf,
            y: vehicle.y + 0.25,
            z: vehicle.z + backZ * rearOffset + rightZ * side * trackHalf,
            vx: backX * absSpeed * 0.16 + (Math.random() - 0.5) * 2.4,
            vy: 1.4 + Math.random() * 1.6,
            vz: backZ * absSpeed * 0.16 + (Math.random() - 0.5) * 2.4,
            size: 1.6 + Math.random() * 1.4,
            growth: 5.5,
            life: 0.85 + Math.random() * 0.6,
            color: this.smokeColor,
            alpha: 0.16 + slideStrength * 0.2,
            drag: 1.9,
            gravity: -0.6,
          });
        }
      }
    }

    // ── Dirt kicked up off the island ──
    if (!vehicle.onTrack && absSpeed > 5) {
      acc.dirt += speedFrac * 70 * dt;
      while (acc.dirt >= 1) {
        acc.dirt -= 1;
        this.dirt.emit({
          x: vehicle.x + backX * rearOffset + (Math.random() - 0.5) * 1.6,
          y: vehicle.y + 0.2,
          z: vehicle.z + backZ * rearOffset + (Math.random() - 0.5) * 1.6,
          vx: backX * absSpeed * 0.3 + (Math.random() - 0.5) * 4,
          vy: 2 + Math.random() * 3,
          vz: backZ * absSpeed * 0.3 + (Math.random() - 0.5) * 4,
          size: 1.4 + Math.random() * 1.8,
          growth: 3.4,
          life: 0.7 + Math.random() * 0.5,
          color: this.dirtColor,
          alpha: 0.5,
          drag: 1.5,
          gravity: 5,
        });
      }
    }

    // ── Kerb sparks ──
    if (vehicle.surface === 'kerb' && absSpeed > 16) {
      acc.spark += speedFrac * 26 * dt;
      while (acc.spark >= 1) {
        acc.spark -= 1;
        this.sparks.emit({
          x: vehicle.x + (Math.random() - 0.5) * 1.5,
          y: vehicle.y + 0.14,
          z: vehicle.z + (Math.random() - 0.5) * 1.5,
          vx: backX * 8 + (Math.random() - 0.5) * 6,
          vy: 1.5 + Math.random() * 2.5,
          vz: backZ * 8 + (Math.random() - 0.5) * 6,
          size: 0.5,
          growth: -0.4,
          life: 0.28 + Math.random() * 0.2,
          color: 0xffb44a,
          alpha: 1,
          drag: 0.9,
          gravity: 9,
        });
      }
    }

    // ── Nitro plume ──
    if (vehicle.boostActive) {
      acc.boost += 120 * dt;
      while (acc.boost >= 1) {
        acc.boost -= 1;
        for (const side of [-1, 1]) {
          this.sparks.emit({
            x: vehicle.x + backX * (vehicle.halfLength + 0.3) + rightX * side * 0.4,
            y: vehicle.y + 0.4,
            z: vehicle.z + backZ * (vehicle.halfLength + 0.3) + rightZ * side * 0.4,
            vx: backX * 12 + (Math.random() - 0.5) * 2,
            vy: 0.6 + Math.random(),
            vz: backZ * 12 + (Math.random() - 0.5) * 2,
            size: 1.1 + Math.random() * 0.7,
            growth: 2.6,
            life: 0.3 + Math.random() * 0.2,
            color: Math.random() < 0.5 ? 0x8fdcff : 0xffe9b0,
            alpha: 0.85,
            drag: 2.6,
            gravity: -1.5,
          });
        }
      }
    }
  }

  /** Burst used on car-to-car and barrier contact. */
  impact(x, y, z, strength) {
    const count = Math.round(6 + strength * 16);
    for (let i = 0; i < count; i++) {
      this.sparks.emit({
        x, y: y + 0.35, z,
        vx: (Math.random() - 0.5) * 14 * strength,
        vy: 1 + Math.random() * 5 * strength,
        vz: (Math.random() - 0.5) * 14 * strength,
        size: 0.5 + Math.random() * 0.4,
        growth: -0.3,
        life: 0.3 + Math.random() * 0.3,
        color: Math.random() < 0.7 ? 0xffc25e : 0xfff3d0,
        alpha: 1,
        drag: 1.1,
        gravity: 11,
      });
    }
  }

  #accumulator(vehicle) {
    let acc = this.accumulators.get(vehicle);
    if (!acc) {
      acc = { smoke: 0, dirt: 0, spark: 0, boost: 0 };
      this.accumulators.set(vehicle, acc);
    }
    return acc;
  }
}
