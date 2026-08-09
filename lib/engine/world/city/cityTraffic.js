// ═══════════════════════════════════════════════════════
//  TRAFFIC — the cars that are not racing
//
//  An empty city is a model of a city. These are what make it a place.
//
//  There is no road graph to route on, because there is no road graph:
//  the network only exists as a distance field. So a traffic car drives
//  straight until the surface ahead stops being road, then probes left
//  and right and takes whichever way is still tarmac. That is enough to
//  produce cars that turn at junctions, follow curves and pile up
//  behind each other, at three surface queries per car per second.
//
//  They share the player's collision solver, so hitting one is a real
//  impact with real consequences rather than a car driving through a
//  ghost.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';
import { SURFACE } from '../../config.js';
import { mergeParts } from './cityMaterials.js';
import { angleDelta, clamp, makeRng, rngPick, rngRange } from '../../util.js';

/** Where traffic appears and disappears, in metres from the player. */
const SPAWN_MIN = 110;
const SPAWN_MAX = 300;
const DESPAWN = 460;
/** How far ahead a car looks for road before deciding to turn. */
const LOOKAHEAD = 20;
/** Lane keeping: radians of steer per metre off the lane centre. */
const LANE_GAIN = 0.075;
const LANE_MAX_ANGLE = 0.5;
const LANE_RATE = 4.5;
/** How far ahead a car watches the car in front. */
const FOLLOW_RANGE = 26;

const BODY_COLORS = [
  0xdcdcdc, 0x2b2f36, 0x8f959c, 0xb0362c, 0x28527a,
  0xd8c9a8, 0x3f6b4a, 0x6a4f7a, 0xcfa53a, 0x1f2933,
];

export function createTraffic({ scene, map, count }) {
  const geometry = createTrafficShape();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
  mesh.name = 'city:traffic';
  mesh.castShadow = true;
  mesh.count = 0;
  mesh.frustumCulled = false;
  scene.add(mesh);

  const rng = makeRng(0x7ac1);
  const dummy = new THREE.Object3D();
  const tone = new THREE.Color();
  const probe = {};
  const laneProbe = {};
  const homeProbe = {};

  /** Live cars. Each carries the fields the collision solver expects. */
  const cars = [];
  for (let i = 0; i < count; i++) {
    cars.push({
      active: false,
      x: 0, y: 0, z: 0,
      heading: 0,
      speed: 0,
      cruise: 14,
      halfLength: 2.2,
      halfWidth: 0.95,
      isPlayer: false,
      impulseX: 0,
      impulseZ: 0,
      collisionCooldown: 0,
      physics: { mass: 1.05 },
      color: BODY_COLORS[i % BODY_COLORS.length],
      /** Which lane out from the centre, on the right of travel. */
      laneIndex: 0,
      repathTimer: 0,
    });
  }

  function onRoad(x, z) {
    map.sampleSurface(x, z, probe);
    return probe.surface === SURFACE.TRACK && !probe.water;
  }

  /**
   * Centre of the nth lane out from the middle, on the right-hand side.
   * Lane 0 is the inside lane; a two-lane street only has lane 0.
   */
  function laneOffset(road, index) {
    const laneWidth = (road.halfWidth * 2) / Math.max(2, road.lanes);
    const lanes = Math.max(1, Math.floor(road.lanes / 2));
    return (Math.min(index, lanes - 1) + 0.5) * laneWidth;
  }

  function spawn(car, px, pz) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const angle = rng() * Math.PI * 2;
      const radius = rngRange(rng, SPAWN_MIN, SPAWN_MAX);
      const point = map.snapToRoad(px + Math.cos(angle) * radius, pz + Math.sin(angle) * radius, {});
      if (map.isWater(point.x, point.z)) continue;
      if (!onRoad(point.x, point.z)) continue;

      const lane = map.roadAt(point.x, point.z, {});
      if (lane.kind === null) continue;

      // Face either way along the road, then take a lane on the right of
      // whichever way that is.
      const forward = rng() < 0.5;
      const heading = lane.heading + (forward ? 0 : Math.PI);
      car.laneIndex = Math.floor(rng() * Math.max(1, Math.floor(lane.lanes / 2)));
      const offset = laneOffset(lane, car.laneIndex) * (forward ? 1 : -1);

      // `lateral` is measured along the road's right-hand normal, so
      // stepping along that normal is how a lane offset becomes a place.
      const nx = Math.cos(lane.heading);
      const nz = -Math.sin(lane.heading);
      car.x = point.x + nx * (offset - lane.lateral);
      car.z = point.z + nz * (offset - lane.lateral);
      if (!onRoad(car.x, car.z)) {
        car.x = point.x;
        car.z = point.z;
      }
      car.heading = heading;
      car.y = probe.y;
      car.cruise = lane.kind === 'motorway'
        ? rngRange(rng, 22, 30)
        : lane.kind === 'boulevard'
          ? rngRange(rng, 13, 19)
          : rngRange(rng, 8, 13);
      car.speed = car.cruise;
      car.color = rngPick(rng, BODY_COLORS);
      car.impulseX = 0;
      car.impulseZ = 0;
      car.active = true;
      return true;
    }
    return false;
  }

  /**
   * Hold the lane. Every frame the car asks where it is across the road
   * it is *already on* — not the nearest road, which mid-junction is the
   * one it is crossing — and steers back toward the middle of its lane.
   *
   * Without this the cars aligned to the road and then drifted wherever
   * the last turn left them, which is how you end up with traffic in
   * both directions sharing one side of the street.
   */
  function keepLane(car, dt) {
    const road = map.roadAlong(car.x, car.z, car.heading, laneProbe);
    if (road.kind === null) return false;

    const forward = Math.cos(car.heading - road.heading) >= 0;
    const travel = road.heading + (forward ? 0 : Math.PI);
    const wanted = laneOffset(road, car.laneIndex) * (forward ? 1 : -1);

    // Positive error means "move to my own right", whichever way I face.
    const error = (wanted - road.lateral) * (forward ? 1 : -1);
    const correction = clamp(error * LANE_GAIN, -LANE_MAX_ANGLE, LANE_MAX_ANGLE);

    const target = travel + correction;
    car.heading += angleDelta(car.heading, target) * Math.min(1, LANE_RATE * dt);
    return true;
  }

  /**
   * Straight on if the road continues, otherwise take whichever turn is
   * still road. A junction is not a decision point in the data — it is
   * simply where going straight stops working.
   *
   * A turn snaps the heading onto the new road's actual direction, not
   * a blind ninety degrees: the street grids are rotated, so "left" is
   * rarely a right angle, and landing off-axis means the lane keeper
   * spends the next hundred metres arguing with the kerb.
   */
  function steer(car) {
    const ahead = LOOKAHEAD + car.speed * 0.35;
    const fx = car.x + Math.sin(car.heading) * ahead;
    const fz = car.z + Math.cos(car.heading) * ahead;
    if (onRoad(fx, fz)) return true;

    const order = rng() < 0.5 ? [1, -1] : [-1, 1];
    for (const dir of order) {
      const turn = car.heading + dir * Math.PI * 0.5;
      const tx = car.x + Math.sin(turn) * 18;
      const tz = car.z + Math.cos(turn) * 18;
      if (!onRoad(tx, tz)) continue;
      car.heading = alignToRoad(tx, tz, turn);
      car.laneIndex = 0;
      return true;
    }

    const back = car.heading + Math.PI;
    if (onRoad(car.x + Math.sin(back) * 14, car.z + Math.cos(back) * 14)) {
      car.heading = alignToRoad(car.x, car.z, back);
      return true;
    }
    return false;
  }

  /** The road's own direction, taken in the sense the car is going. */
  function alignToRoad(x, z, heading) {
    const road = map.roadAlong(x, z, heading, laneProbe);
    if (road.kind === null) return heading;
    return Math.cos(heading - road.heading) >= 0 ? road.heading : road.heading + Math.PI;
  }

  /** Metres of clear road a car wants in front of it before it lifts. */
  function gapAhead(car, cars) {
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    let nearest = Infinity;

    for (const other of cars) {
      if (other === car || !other.active) continue;
      const dx = other.x - car.x;
      const dz = other.z - car.z;
      const along = dx * fx + dz * fz;
      if (along <= 0 || along > FOLLOW_RANGE) continue;
      // Only what is actually in this lane, not the oncoming carriageway.
      if (Math.abs(dx * fz - dz * fx) > 2.4) continue;
      if (along < nearest) nearest = along;
    }
    return nearest;
  }

  return {
    cars,

    update(dt, px, pz) {
      let visible = 0;

      for (const car of cars) {
        if (!car.active) {
          spawn(car, px, pz);
          if (!car.active) continue;
        }

        const dx = car.x - px;
        const dz = car.z - pz;
        if (dx * dx + dz * dz > DESPAWN * DESPAWN) {
          car.active = false;
          continue;
        }

        car.repathTimer -= dt;
        if (car.repathTimer <= 0) {
          car.repathTimer = 0.28;
          if (!steer(car)) {
            car.active = false;
            continue;
          }
        }

        map.sampleSurface(car.x, car.z, probe);
        if (probe.surface !== SURFACE.TRACK) {
          // Off the tarmac entirely — head back to the nearest road and
          // let the lane keeper take over once there.
          const home = map.snapToRoad(car.x, car.z, homeProbe);
          car.heading += angleDelta(car.heading, Math.atan2(home.x - car.x, home.z - car.z)) * 0.25;
        } else {
          keepLane(car, dt);
        }

        // Lift off for whatever is in front, so a queue behaves like a
        // queue instead of a pile-up.
        const gap = gapAhead(car, cars);
        const wanted = gap < FOLLOW_RANGE
          ? car.cruise * clamp((gap - 7) / 18, 0, 1)
          : car.cruise;
        car.speed += (wanted - car.speed) * Math.min(1, dt * (wanted < car.speed ? 3.2 : 1.6));
        car.x += Math.sin(car.heading) * car.speed * dt + car.impulseX * dt;
        car.z += Math.cos(car.heading) * car.speed * dt + car.impulseZ * dt;
        car.y = probe.y;

        const decay = Math.max(0, 1 - 4 * dt);
        car.impulseX *= decay;
        car.impulseZ *= decay;
        car.collisionCooldown = Math.max(0, car.collisionCooldown - dt);

        dummy.position.set(car.x, car.y + 0.05, car.z);
        dummy.rotation.set(0, car.heading, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(visible, dummy.matrix);
        mesh.setColorAt(visible, tone.setHex(car.color));
        visible += 1;
      }

      mesh.count = visible;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },

    /** Drop every car — used when the player teleports across the city. */
    reset() {
      for (const car of cars) car.active = false;
      mesh.count = 0;
    },

    /** The live cars, for the collision solver. */
    activeCars(out) {
      out.length = 0;
      for (const car of cars) if (car.active) out.push(car);
      return out;
    },

    dispose() {
      scene.remove(mesh);
      mesh.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}

// ── Shape ──────────────────────────────────────────────
// Two hundred triangles. Traffic is read at speed and at distance, and
// anything more detailed than this is detail nobody sees.

function createTrafficShape() {
  const parts = [];

  const body = new THREE.BoxGeometry(1.86, 0.72, 4.3);
  body.translate(0, 0.72, 0);
  parts.push(paint(body, 1, 1, 1));

  const cabin = new THREE.BoxGeometry(1.68, 0.62, 2.15);
  cabin.translate(0, 1.38, -0.18);
  parts.push(paint(cabin, 0.32, 0.36, 0.42));

  const wheel = () => new THREE.CylinderGeometry(0.34, 0.34, 0.24, 8);
  for (const [x, z] of [[0.88, 1.36], [-0.88, 1.36], [0.88, -1.42], [-0.88, -1.42]]) {
    const w = wheel();
    w.rotateZ(Math.PI / 2);
    w.translate(x, 0.34, z);
    parts.push(paint(w, 0.11, 0.11, 0.12));
  }

  return mergeParts(parts);
}

/** Colour a part and strip its index — see mergeParts for why. */
function paint(source, r, g, b) {
  const geometry = source.index ? source.toNonIndexed() : source;
  if (geometry !== source) source.dispose();
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}
