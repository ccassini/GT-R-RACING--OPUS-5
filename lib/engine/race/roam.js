// ═══════════════════════════════════════════════════════
//  FREE ROAM — what stops a car in a city with no barriers
//
//  A circuit is a corridor: one signed distance from the centreline
//  decides everything. A city is not. Here the things that stop a car
//  are buildings, the sea, and the parapet of a bridge deck sixty
//  metres over it, and each has to be answered differently.
//
//  All three resolvers move the car and hand back an impact strength,
//  so the engine can shake the camera and play the hit without knowing
//  what was hit.
// ═══════════════════════════════════════════════════════
import { clamp01 } from '../util.js';

/** Restitution against something that does not move. */
const WALL_BOUNCE = 0.55;

// ── Buildings ──────────────────────────────────────────

const AXES = [
  { x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 },
];

/**
 * Separating-axis test between the car and one building footprint.
 * The building never moves, so the whole correction goes to the car.
 */
function penetration(vehicle, box) {
  const aFwd = { x: Math.sin(vehicle.heading), z: Math.cos(vehicle.heading) };
  const aRight = { x: Math.cos(vehicle.heading), z: -Math.sin(vehicle.heading) };
  const bFwd = { x: Math.sin(box.rot), z: Math.cos(box.rot) };
  const bRight = { x: Math.cos(box.rot), z: -Math.sin(box.rot) };

  AXES[0] = aFwd; AXES[1] = aRight; AXES[2] = bFwd; AXES[3] = bRight;

  let minOverlap = Infinity;
  let nx = 0;
  let nz = 0;

  for (const axis of AXES) {
    const rA = vehicle.halfWidth * Math.abs(aRight.x * axis.x + aRight.z * axis.z)
      + vehicle.halfLength * Math.abs(aFwd.x * axis.x + aFwd.z * axis.z);
    const rB = box.halfW * Math.abs(bRight.x * axis.x + bRight.z * axis.z)
      + box.halfD * Math.abs(bFwd.x * axis.x + bFwd.z * axis.z);

    const dA = vehicle.x * axis.x + vehicle.z * axis.z;
    const dB = box.x * axis.x + box.z * axis.z;
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
 * @param {object} vehicle
 * @param {Array<{x:number,z:number,halfW:number,halfD:number,rot:number}>} obstacles
 * @param {(force: number) => void} [onImpact]
 */
export function resolveBuildingCollisions(vehicle, obstacles, onImpact) {
  let strongest = 0;

  for (const box of obstacles) {
    const hit = penetration(vehicle, box);
    if (!hit) continue;

    vehicle.x -= hit.nx * hit.overlap;
    vehicle.z -= hit.nz * hit.overlap;

    // How square-on the hit was. A graze along a wall should cost speed
    // and paint, not bring the car to a stop.
    const travelX = Math.sin(vehicle.velHeading);
    const travelZ = Math.cos(vehicle.velHeading);
    const head = Math.abs(travelX * hit.nx + travelZ * hit.nz);
    const force = clamp01(Math.abs(vehicle.speed) / vehicle.maxSpeed) * head;

    vehicle.speed *= 1 - WALL_BOUNCE * head;
    vehicle.impulseX -= hit.nx * 7 * head;
    vehicle.impulseZ -= hit.nz * 7 * head;
    if (force > strongest) strongest = force;
  }

  if (strongest > 0.04 && onImpact && vehicle.collisionCooldown <= 0) {
    vehicle.collisionCooldown = 0.28;
    onImpact(strongest);
  }
  return strongest;
}

// ── Water ──────────────────────────────────────────────

const normal = { x: 0, z: 0 };

/**
 * The sea is not a wall, so it is not modelled as one. A car that gets
 * a wheel in the water is pushed back up the shoreline gradient and
 * loses most of its speed — you can get wet, you cannot get out to sea.
 */
export function clampToShore(vehicle, map, onHit) {
  const shore = map.shoreDistance(vehicle.x, vehicle.z);
  if (shore > 0) return 0;
  if (vehicle.onBridge) return 0;

  map.shoreNormal(vehicle.x, vehicle.z, normal);
  const push = Math.min(-shore + 0.6, 12);
  vehicle.x += normal.x * push;
  vehicle.z += normal.z * push;

  const force = clamp01(Math.abs(vehicle.speed) / vehicle.maxSpeed);
  vehicle.speed *= 0.55;
  vehicle.impulseX += normal.x * 3;
  vehicle.impulseZ += normal.z * 3;

  if (onHit && vehicle.collisionCooldown <= 0) {
    vehicle.collisionCooldown = 0.35;
    onHit(force * 0.7);
  }
  return force;
}

// ── Bridge parapets ────────────────────────────────────

/**
 * On a deck there is nothing under the car but sixty metres of air, so
 * the parapet has to be solid even though it is drawn as a handrail.
 * The clamp releases as the deck ramps back down to the ground, which
 * is what lets a driver leave the bridge onto ordinary streets.
 */
export function clampToDeck(vehicle, map, onHit) {
  const deck = map.bridgeAt(vehicle.x, vehicle.z, {});
  if (!deck || deck.ramp < 0.02) return 0;

  const limit = deck.halfWidth;
  const over = Math.abs(deck.lateral) - limit;
  if (over <= 0) return 0;

  const sign = Math.sign(deck.lateral) || 1;
  vehicle.z -= sign * over;
  vehicle.speed *= 0.82;
  vehicle.impulseZ -= sign * 5;

  const force = clamp01(Math.abs(vehicle.speed) / vehicle.maxSpeed) * 0.6;
  if (onHit && vehicle.collisionCooldown <= 0) {
    vehicle.collisionCooldown = 0.3;
    onHit(force);
  }
  return force;
}

// ── Camera ─────────────────────────────────────────────

/**
 * Pull the camera in until nothing is standing between it and the car.
 * Eight samples along the boom is coarse, but the failure it prevents —
 * a chase camera parked inside a forty-storey wall — is not subtle.
 *
 * @returns {number} fraction of the boom that is clear, in (0, 1]
 */
export function clearCameraBoom(car, camera, obstacles) {
  if (obstacles.length === 0) return 1;

  const dx = camera.x - car.x;
  const dy = camera.y - car.y;
  const dz = camera.z - car.z;

  for (let i = 8; i >= 1; i--) {
    const t = i / 8;
    const px = car.x + dx * t;
    const py = car.y + dy * t;
    const pz = car.z + dz * t;
    if (!insideAny(px, py, pz, car.y, obstacles)) return t;
  }
  return 0.18;
}

function insideAny(x, y, z, groundY, obstacles) {
  for (const box of obstacles) {
    if (y > groundY + box.height) continue;
    const dx = x - box.x;
    const dz = z - box.z;
    const cos = Math.cos(box.rot);
    const sin = Math.sin(box.rot);
    const local = Math.abs(dx * cos - dz * sin);
    const lateral = Math.abs(dx * sin + dz * cos);
    // Half a metre of skin, so the camera does not sit flush to glass.
    if (local < box.halfD + 0.5 && lateral < box.halfW + 0.5) return true;
  }
  return false;
}

// ── Session stats ──────────────────────────────────────

/** What free roam has instead of a lap time. */
export class RoamStats {
  constructor() {
    this.reset();
  }

  reset() {
    this.distance = 0;
    this.topSpeed = 0;
    this.airTime = 0;
    this.elapsed = 0;
    this.bridges = new Set();
    this.districts = new Set();
    this._lastX = null;
    this._lastZ = null;
  }

  update(dt, vehicle, districtId) {
    this.elapsed += dt;
    if (this._lastX !== null) {
      this.distance += Math.hypot(vehicle.x - this._lastX, vehicle.z - this._lastZ);
    }
    this._lastX = vehicle.x;
    this._lastZ = vehicle.z;

    const kmh = Math.abs(vehicle.speed);
    if (kmh > this.topSpeed) this.topSpeed = kmh;
    if (vehicle.onBridge) this.bridges.add(vehicle.onBridge.id);
    if (districtId) this.districts.add(districtId);
  }
}
