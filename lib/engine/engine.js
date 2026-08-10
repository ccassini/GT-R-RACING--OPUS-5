// ═══════════════════════════════════════════════════════
//  GAME ENGINE — simulation, rendering and nothing else
//
//  This used to be main.js, and it used to reach into the document for
//  every panel it wanted to update. It no longer knows the DOM exists
//  beyond the canvas it was handed. React owns all pixels that are not
//  WebGL; the engine owns the scene and publishes what it knows:
//
//    progress(fraction, status)   during boot
//    frame(telemetry)             once per rendered frame, hot path
//    message({ text, sub, … })    discrete race callouts
//    racestate({ state, paused })
//    results(payload)             a race finished
//    camera(id)
//
//  `telemetry` is one object reused for the lifetime of the engine.
//  Allocating a fresh snapshot sixty times a second is exactly the kind
//  of garbage that shows up as frame-time jitter, so the HUD reads
//  fields off a stable object and writes them straight to DOM refs.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';
import {
  QUALITY, DIFFICULTIES, DRIFT, BOOST, PHYS,
  CAMERA_ORDER, CAMERA_ORDER_ROAM,
} from './config.js';
import { clamp01, formatLapTime } from './util.js';
import { buildWorld } from './world/world.js';
import { buildCityWorld } from './world/city/cityWorld.js';
import { getPlaceById } from './world/city/cityConfig.js';
import { getCarById, getPaint, buildRivalRoster, RIVAL_NAMES } from './cars/catalog.js';
import { createCarModel, preloadAuthoredRaceCars } from './cars/model.js';
import { CameraRig, CinematicDirector } from './camera.js';
import { createPostFx } from './render/postfx.js';
import { RENDER_TUNING } from './render/runtimeQuality.js';
import { Vehicle, resolveCollisions, clampToBarrier } from './race/vehicle.js';
import { revsFor } from './race/revs.js';
import {
  RoamStats, clampToDeck, clampToShore, clearCameraBoom, resolveBuildingCollisions,
} from './race/roam.js';
import { Driver, PERSONALITIES } from './race/ai.js';
import { RaceDirector, RACE_STATE, currentLapTime } from './race/director.js';
import { VehicleFx } from './fx/particles.js';
import { createTireMarks } from './fx/tireMarks.js';
import { Audio } from './audio/audio.js';

export const MODE = { ATTRACT: 'attract', GARAGE: 'garage', RACE: 'race', WORLD: 'world' };

/** Free roam needs to see kilometres, not the length of a pit straight. */
const ROAM_FAR_PLANE = 11000;
const CIRCUIT_FAR_PLANE = 4200;
/** Fraction of the streaming ring that must exist before the car moves. */
const ROAM_ENTRY_PROGRESS = 0.72;

export const GARAGE_INSPECTION_VIEWS = Object.freeze({
  front: Object.freeze({ headingDegrees: 0 }),
  side: Object.freeze({ headingDegrees: 90 }),
  rear: Object.freeze({ headingDegrees: 180 }),
  'front-three-quarter': Object.freeze({ headingDegrees: 45 }),
});

const FIELD_SIZE = 6;
const GARAGE_FOV = 30;
const VISUAL_TEST_API = '__SUNSET_RACING_VISUAL_TEST__';
const DEFAULT_INSPECTION_VIEW = 'front-three-quarter';
const UP = new THREE.Vector3(0, 1, 0);

function readVisualTestConfig() {
  if (typeof window === 'undefined') return { enabled: false, viewId: DEFAULT_INSPECTION_VIEW };
  const query = new URLSearchParams(window.location.search);
  const rawFlag = query.get('visualTest');
  const enabled = rawFlag !== null && rawFlag !== '0' && rawFlag.toLowerCase() !== 'false';
  const requestedView = query.get('garageView');
  const viewId = Object.hasOwn(GARAGE_INSPECTION_VIEWS, requestedView)
    ? requestedView
    : DEFAULT_INSPECTION_VIEW;
  return { enabled, viewId };
}

/** Minimal typed-event emitter. Smaller than importing one. */
class Emitter {
  #handlers = new Map();

  on(name, fn) {
    if (!this.#handlers.has(name)) this.#handlers.set(name, new Set());
    this.#handlers.get(name).add(fn);
    return () => this.off(name, fn);
  }

  off(name, fn) {
    this.#handlers.get(name)?.delete(fn);
  }

  emit(name, payload) {
    const set = this.#handlers.get(name);
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  clear() {
    this.#handlers.clear();
  }
}

export class GameEngine {
  /**
   * @param {object} options
   * @param {HTMLCanvasElement} options.canvas
   * @param {import('../state').GameState} options.state
   * @param {import('../chain/platform').Platform} options.platform
   */
  constructor({ canvas, state, platform }) {
    this.canvas = canvas;
    this.state = state;
    this.platform = platform;
    this.events = new Emitter();

    this.audio = new Audio(state.settings);
    this.mode = MODE.ATTRACT;
    this.paused = false;
    this.disposed = false;
    this.inputEnabled = false;
    /** True while the scene is being swapped between circuit and city. */
    this.transitioning = false;

    this.keys = new Set();
    this.clock = new THREE.Clock();
    this.vehicles = [];
    this.drivers = new Map();
    this.director = null;
    this.showcase = null;
    this.showcaseLighting = null;
    this.turntable = 0;
    this.frameHandle = 0;
    this.smoothSpeed = 0;
    this.visualTest = { ...readVisualTestConfig(), api: null };
    this.#installVisualTestApi();

    // ── Free roam ──
    /** The open-world surface provider. Null whenever a circuit is loaded. */
    this.cityMap = null;
    this.roamStats = new RoamStats();
    /** Reused every frame: the collision passes must not allocate. */
    this.roamActors = [];
    this.roamObstacles = [];
    this.roamDistrict = {};
    /** Reused: the tachometer reading, recomputed every frame. */
    this.revs = {};

    /** Reused every frame. See the module header. */
    this.telemetry = {
      active: false,
      position: 1,
      fieldSize: FIELD_SIZE,
      lap: 1,
      totalLaps: 3,
      currentLap: 0,
      bestLap: 0,
      gapAhead: null,
      displaySpeed: 0,
      speedFraction: 0,
      topSpeedKmh: 0,
      gear: 'N',
      rpm: 0,
      rpmFrac: 0,
      redline: false,
      boostFraction: 0,
      boostReady: false,
      boostFiring: false,
      driftScore: 0,
      driftCombo: 0,
      driftActive: false,
      wrongWay: false,
      showMinimap: true,
      standings: [],
      circuit: null,
      vehicles: null,
      dt: 0,
      mode: MODE.ATTRACT,
      /** Free-roam fields. Meaningless during a race, and vice versa. */
      roam: {
        x: 0,
        z: 0,
        heading: 0,
        districtId: '',
        districtName: '',
        districtLabel: '',
        placeName: null,
        bridgeName: null,
        distance: 0,
        topSpeedKmh: 0,
        elapsed: 0,
        chunks: 0,
        streaming: false,
        offRoad: false,
      },
    };
  }

  /**
   * Test-only browser contract. It exists solely behind ?visualTest=1 and
   * keeps production gameplay free of global engine controls.
   */
  #installVisualTestApi() {
    if (!this.visualTest.enabled) return;
    const api = {
      ready: false,
      views: Object.entries(GARAGE_INSPECTION_VIEWS).map(([id, value]) => ({
        id,
        headingDegrees: value.headingDegrees,
      })),
      selectCar: (carId, paintId) => {
        if (!api.ready) throw new Error('Visual test engine is not ready');
        const car = getCarById(carId);
        if (car.id !== carId) throw new Error(`Unknown car id: ${carId}`);
        const paint = getPaint(car, paintId);
        this.state.updateSetup({ carId, paintId: paint.id });
        this.buildShowcase();
        this.#applyInspectionPose();
        this.#renderInspectionFrame();
        return this.#visualTestState();
      },
      setView: (viewId) => {
        if (!Object.hasOwn(GARAGE_INSPECTION_VIEWS, viewId)) {
          throw new Error(`Unknown garage inspection view: ${viewId}`);
        }
        this.visualTest.viewId = viewId;
        this.#applyInspectionPose();
        return this.#visualTestState();
      },
      render: () => {
        this.#renderInspectionFrame();
        return this.#visualTestState();
      },
      getState: () => this.#visualTestState(),
    };
    this.visualTest.api = api;
    window[VISUAL_TEST_API] = api;
  }

  #visualTestState() {
    const view = GARAGE_INSPECTION_VIEWS[this.visualTest.viewId];
    return {
      ready: this.visualTest.api?.ready ?? false,
      frozen: this.visualTest.enabled && this.mode === MODE.GARAGE,
      mode: this.mode,
      carId: this.state.setup.carId,
      paintId: this.state.setup.paintId,
      viewId: this.visualTest.viewId,
      headingDegrees: view.headingDegrees,
      authored: Boolean(this.showcase?.userData?.authored),
      showcaseRotation: this.showcase?.rotation.y ?? null,
    };
  }

  // ══ Boot ═══════════════════════════════════════════

  /** @param {(fraction: number, status: string) => void} [onProgress] */
  async boot(onProgress) {
    const report = (fraction, status) => {
      onProgress?.(fraction, status);
      this.events.emit('progress', { fraction, status });
    };

    report(0.05, 'Warming up the renderer…');
    this.#createRenderer();
    await nextFrame();
    if (this.disposed) return;

    report(0.25, 'Laying the asphalt…');
    await nextFrame();
    this.buildWorld(this.state.setup.circuitId);
    if (this.disposed) return;

    report(0.55, 'Loading the race-car workshop…');
    await preloadAuthoredRaceCars();
    if (this.disposed) return;

    report(0.65, 'Rolling out the field…');
    await nextFrame();
    this.buildField();
    if (this.disposed) return;

    report(0.88, 'Wiring the pit wall…');
    await nextFrame();
    await this.platform.init();
    if (this.disposed) return;

    this.#bindDrivingInput();
    this.setCamera(this.state.settings.camera);

    report(1, 'Ready.');
    this.enterAttract();
    this.clock.start();
    this.#loop();
    if (this.visualTest.api) this.visualTest.api.ready = true;
  }

  #createRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDER_TUNING.gameplayExposure;

    this.scene = new THREE.Scene();
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);

    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
  }

  resize() {
    if (!this.renderer) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.rig.setAspect(w / h);
    this.postFx?.setSize(w, h);
  }

  // ══ World ══════════════════════════════════════════

  buildWorld(circuitId) {
    const qualityId = this.state.settings.quality;
    const quality = QUALITY[qualityId];

    this.world?.dispose();
    this.fx?.dispose();
    this.tireMarks?.dispose();
    this.postFx?.dispose();

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
    this.renderer.shadowMap.type =
      qualityId === 'low' ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;

    this.world = buildWorld(this.scene, this.renderer, { circuitId, quality: qualityId });
    this.circuit = this.world.circuit;
    this.quality = quality;

    this.fx = new VehicleFx(this.scene, quality, this.world.theme);
    this.tireMarks = createTireMarks(this.scene, quality);
    this.cinematic = new CinematicDirector(this.circuit);
    // The guide is a driving aid, not set dressing — it only belongs on
    // screen once the player is actually behind the wheel.
    this.world.setGuideLineVisible(
      this.mode === MODE.RACE && this.state.settings.showGhostLine,
    );

    this.postFx = quality.postFx
      ? createPostFx(this.renderer, this.scene, this.rig.camera, this.world.theme, quality)
      : null;

    this.telemetry.circuit = this.circuit;
  }

  /** Rebuild the world and put the field back on it without a black frame. */
  reloadWorld(circuitId) {
    const previousMode = this.mode;
    this.buildWorld(circuitId);

    for (const vehicle of this.vehicles) this.scene.add(vehicle.mesh);
    if (this.showcase) {
      this.scene.add(this.showcase);
      const spot = this.#showcaseSpot();
      this.showcase.position.set(spot.x, spot.y + 0.35, spot.z);
    }

    if (previousMode === MODE.GARAGE) this.enterGarage({ silent: true });
    else this.enterAttract();
  }

  /** Quality changed: the whole world has to be rebuilt at the new tier. */
  applyQuality() {
    this.reloadWorld(this.state.setup.circuitId);
  }

  // ══ Field ══════════════════════════════════════════

  buildField() {
    for (const vehicle of this.vehicles) {
      this.scene.remove(vehicle.mesh);
      vehicle.mesh.userData.dispose?.();
    }
    this.vehicles.length = 0;
    this.drivers.clear();

    const { carId, paintId, difficulty } = this.state.setup;
    const playerCar = getCarById(carId);
    const playerPaint = getPaint(playerCar, paintId);

    const playerMesh = createCarModel(playerCar, playerPaint);
    this.scene.add(playerMesh);
    this.player = new Vehicle({
      car: playerCar,
      paint: playerPaint,
      mesh: playerMesh,
      isPlayer: true,
      name: 'YOU',
    });
    this.vehicles.push(this.player);

    const roster = buildRivalRoster(carId, FIELD_SIZE - 1);
    roster.forEach((entry, i) => {
      const mesh = createCarModel(entry.car, entry.paint);
      this.scene.add(mesh);
      this.vehicles.push(
        new Vehicle({
          car: entry.car,
          paint: entry.paint,
          mesh,
          name: RIVAL_NAMES[i % RIVAL_NAMES.length],
        }),
      );
    });

    const tier = DIFFICULTIES[difficulty];
    this.vehicles.forEach((vehicle, i) => {
      this.drivers.set(
        vehicle,
        new Driver(vehicle, PERSONALITIES[i % PERSONALITIES.length], tier, i),
      );
    });

    this.audio.setPlayerCar(playerCar);
    this.telemetry.fieldSize = this.vehicles.length;
    this.telemetry.vehicles = this.vehicles;
    this.buildShowcase();
  }

  /** The car on the turntable in the garage. */
  buildShowcase() {
    // The turntable is parked beside the start line. In the open world
    // there is no start line, and nothing to park it beside.
    if (!this.circuit) return;
    if (this.showcase) {
      this.scene.remove(this.showcase);
      this.showcase.userData.dispose?.();
      this.showcase = null;
    }

    const { carId, paintId } = this.state.setup;
    const car = getCarById(carId);
    const model = createCarModel(car, getPaint(car, paintId));

    const spot = this.#showcaseSpot();
    model.position.set(spot.x, spot.y + 0.35, spot.z);
    model.visible = this.mode === MODE.GARAGE;
    this.scene.add(model);
    this.showcase = model;

    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(4.2, 4.5, 0.3, 40),
      new THREE.MeshLambertMaterial({ color: 0x2c313d }),
    );
    plinth.position.set(0, -0.16, 0);
    plinth.receiveShadow = true;
    model.add(plinth);

    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(4.62, 4.62, 0.12, 40),
      new THREE.MeshBasicMaterial({ color: 0xffb020 }),
    );
    ring.position.set(0, -0.3, 0);
    model.add(ring);

    this.#placeShowcaseLighting(spot);
  }

  /**
   * A restrained display rig lives in world space, not under the rotating car.
   * This keeps highlights stable and prevents the old close point light from
   * washing the fascia and windscreen into white glare.
   */
  #placeShowcaseLighting(spot) {
    if (!this.showcaseLighting) {
      const rig = new THREE.Group();
      rig.name = 'garage:soft-lighting';
      const specs = RENDER_TUNING.garage;

      const key = new THREE.SpotLight(
        specs.key.color,
        specs.key.intensity,
        specs.key.distance,
        specs.key.angle,
        specs.key.penumbra,
        specs.key.decay,
      );
      key.name = 'garage:key';
      key.position.set(5.2, 7.8, 4.6);
      key.target.position.set(0, 0.75, 0);
      rig.add(key, key.target);

      const fill = new THREE.HemisphereLight(
        specs.fill.skyColor,
        specs.fill.groundColor,
        specs.fill.intensity,
      );
      fill.name = 'garage:fill';
      rig.add(fill);

      const rim = new THREE.DirectionalLight(specs.rim.color, specs.rim.intensity);
      rim.name = 'garage:rim';
      rim.position.set(-4.5, 4.2, -5.5);
      rim.target.position.set(0, 0.65, 0);
      rig.add(rim, rim.target);

      this.showcaseLighting = rig;
    }

    if (this.showcaseLighting.parent !== this.scene) this.scene.add(this.showcaseLighting);
    this.showcaseLighting.position.set(spot.x, spot.y, spot.z);
    this.showcaseLighting.visible = this.mode === MODE.GARAGE;
  }

  #showcaseSpot() {
    const idx = this.circuit.indexAt(0.015);
    const lateral = -(this.circuit.barrierOffset + 9);
    return {
      x: this.circuit.px[idx] + this.circuit.sx[idx] * lateral,
      y: this.circuit.py[idx],
      z: this.circuit.pz[idx] + this.circuit.sz[idx] * lateral,
    };
  }

  // ══ Modes ══════════════════════════════════════════

  enterAttract() {
    // Leaving the open world means rebuilding the circuit first; there
    // is no attract loop without one.
    if (this.mode === MODE.WORLD) {
      this.exitWorld();
      return;
    }
    this.mode = MODE.ATTRACT;
    this.paused = false;
    this.director = null;
    this.inputEnabled = false;
    this.telemetry.active = false;
    this.telemetry.mode = MODE.ATTRACT;
    this.renderer.toneMappingExposure = RENDER_TUNING.gameplayExposure;

    if (this.showcase) this.showcase.visible = false;
    if (this.showcaseLighting) this.showcaseLighting.visible = false;
    this.world.setGuideLineVisible(false);
    this.audio.resetEngines();
    this.#spreadFieldForAttract();
    this.world.lighting.setShadowRadius(this.quality.shadowRadius * 1.3);
    this.events.emit('racestate', { state: null, paused: false, mode: this.mode });
  }

  enterGarage({ silent = false } = {}) {
    if (!silent) this.audio.uiSelect();
    this.mode = MODE.GARAGE;
    this.telemetry.mode = MODE.GARAGE;
    this.paused = false;
    this.inputEnabled = false;
    this.telemetry.active = false;
    this.renderer.toneMappingExposure = RENDER_TUNING.garage.exposure;

    this.world.setGuideLineVisible(false);
    this.buildShowcase();
    if (this.showcase) this.showcase.visible = true;
    if (this.showcaseLighting) this.showcaseLighting.visible = true;

    // Snap rather than fly: the car has to be on screen the moment the
    // panel is, not two seconds after a damped camera catches up.
    const pose = this.#garageCameraPose();
    this.rig.snapTo(pose.position, pose.target, GARAGE_FOV);
    this.events.emit('racestate', { state: null, paused: false, mode: this.mode });
  }

  #spreadFieldForAttract() {
    this.vehicles.forEach((vehicle, i) => {
      const t = (i / this.vehicles.length + 0.08) % 1;
      const idx = this.circuit.indexAt(t);
      const lateral = (i % 2 === 0 ? 1 : -1) * 3;
      vehicle.reset(
        this.circuit.px[idx] + this.circuit.sx[idx] * lateral,
        this.circuit.pz[idx] + this.circuit.sz[idx] * lateral,
        this.circuit.heading[idx],
      );
      vehicle.trackT = t;
      vehicle.prevTrackT = t;
      vehicle.speed = vehicle.maxSpeed * 0.6;
      vehicle.mesh.visible = true;
      vehicle.applyVisuals(0.016);
    });
    this.tireMarks.clear();
    this.fx.clear();
  }

  // ══ Free roam ══════════════════════════════════════

  /**
   * Swap the circuit for the open world.
   *
   * This is a full teardown and rebuild rather than a mode flag. A
   * Grand Prix circuit and five thousand square kilometres of city each
   * want the whole frame budget and the whole texture budget; keeping
   * both resident would cost what keeping two games open costs, to save
   * a transition the player makes twice a session.
   *
   * @param {{ placeId?: string, onProgress?: (f: number, s: string) => void }} [options]
   */
  async enterWorld({ placeId, onProgress } = {}) {
    const report = (fraction, status) => {
      onProgress?.(fraction, status);
      this.events.emit('progress', { fraction, status });
    };

    this.audio.uiSelect();
    this.transitioning = true;
    this.mode = MODE.WORLD;
    this.paused = false;
    this.inputEnabled = false;
    this.director = null;
    this.telemetry.active = false;
    this.telemetry.mode = MODE.WORLD;
    this.telemetry.circuit = null;

    report(0.06, 'Clearing the circuit…');
    await nextFrame();
    if (this.disposed) return;

    const qualityId = this.state.settings.quality;
    const quality = QUALITY[qualityId];
    this.world?.dispose();
    this.fx?.dispose();
    this.tireMarks?.dispose();
    this.postFx?.dispose();
    this.circuit = null;
    this.quality = quality;

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
    this.renderer.shadowMap.type =
      qualityId === 'low' ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
    this.renderer.toneMappingExposure = RENDER_TUNING.gameplayExposure;

    report(0.16, 'Surveying the coastline…');
    await nextFrame();
    if (this.disposed) return;

    this.world = buildCityWorld(this.scene, {
      quality: qualityId,
      seed: this.state.setup.worldSeed,
      traffic: this.state.settings.traffic !== false,
    });
    this.cityMap = this.world.map;
    this.fx = new VehicleFx(this.scene, quality, this.world.theme);
    this.tireMarks = createTireMarks(this.scene, quality);
    this.postFx = quality.postFx
      ? createPostFx(this.renderer, this.scene, this.rig.camera, this.world.theme, quality)
      : null;

    // The far plane has to reach the skyline across the strait, which is
    // two and a half times further than any circuit ever needed.
    this.rig.camera.near = 2;
    this.rig.camera.far = ROAM_FAR_PLANE;
    this.rig.camera.updateProjectionMatrix();
    this.rig.setMode('roam');

    if (this.showcase) this.showcase.visible = false;
    if (this.showcaseLighting) this.showcaseLighting.visible = false;
    // Nobody else is racing out here. The rivals stay built so a return
    // to the circuit costs nothing, but they are not in this city.
    for (const vehicle of this.vehicles) vehicle.mesh.visible = vehicle.isPlayer;

    const place = getPlaceById(placeId ?? this.state.setup.worldPlaceId);
    const anchorX = place.x ?? this.cityMap.straitCentre(place.z);
    const spawn = this.cityMap.spawnNear(anchorX, place.z);
    this.player.reset(spawn.x, spawn.z, spawn.heading);
    this.player.y = spawn.y;
    this.player.mesh.position.set(spawn.x, spawn.y, spawn.z);
    this.roamStats.reset();
    this.world.traffic?.reset();

    // Streamed in behind the loading screen rather than in one block, so
    // the progress bar is telling the truth about what is happening.
    //
    // The wait ends before the ring is finished. Chunks arrive nearest
    // first, so by the time the near ones are up the far ones are past
    // the point where anyone can tell they are missing — and they carry
    // on building during the first seconds of driving, which is what
    // the frame budget in `follow` exists for.
    this.world.stream.update(spawn.x, spawn.z, 0);
    while (!this.world.ready && this.world.progress < ROAM_ENTRY_PROGRESS) {
      await nextFrame();
      if (this.disposed) return;
      this.world.stream.update(spawn.x, spawn.z, 26);
      report(0.24 + (this.world.progress / ROAM_ENTRY_PROGRESS) * 0.7, `Building ${place.name}…`);
    }

    this.world.follow(0.016, spawn.x, spawn.z, this.rig.camera);
    this.rig.follow(this.#subjectFor(this.player), 0.016, true);
    this.player.applyVisuals(0.016);

    report(1, 'Ready.');
    this.transitioning = false;
    this.inputEnabled = true;
    this.telemetry.active = true;
    this.clock.getDelta();
    this.events.emit('racestate', { state: null, paused: false, mode: this.mode });
    this.#message(place.name, { sub: place.label, duration: 2.8 });
  }

  /** Put the circuit back. The city is disposed by buildWorld. */
  exitWorld() {
    if (this.mode !== MODE.WORLD) return;
    this.transitioning = true;
    this.mode = MODE.ATTRACT;
    this.cityMap = null;
    this.rig.camera.near = 1.2;
    this.rig.camera.far = CIRCUIT_FAR_PLANE;
    this.rig.camera.updateProjectionMatrix();

    this.buildWorld(this.state.setup.circuitId);
    for (const vehicle of this.vehicles) vehicle.mesh.visible = true;
    this.rig.setMode(this.state.settings.camera);
    this.enterAttract();
    this.transitioning = false;
    this.clock.getDelta();
  }

  /** Drop the car back on the nearest road, facing along it. */
  respawnInWorld() {
    if (this.mode !== MODE.WORLD || !this.cityMap) return;
    const spot = this.cityMap.spawnNear(this.player.x, this.player.z);
    this.player.reset(spot.x, spot.z, spot.heading);
    this.player.y = spot.y;
    this.rig.follow(this.#subjectFor(this.player), 0.016, true);
    this.#message('BACK ON THE ROAD', { duration: 1.2 });
  }

  /** Jump to a named place. Cheaper than a reload: the map is a function. */
  async travelTo(placeId) {
    if (this.mode !== MODE.WORLD || !this.cityMap) return;
    const place = getPlaceById(placeId);
    const anchorX = place.x ?? this.cityMap.straitCentre(place.z);
    const spawn = this.cityMap.spawnNear(anchorX, place.z);

    this.transitioning = true;
    this.player.reset(spawn.x, spawn.z, spawn.heading);
    this.player.y = spawn.y;
    this.world.traffic?.reset();
    this.tireMarks.clear();
    this.fx.clear();

    this.world.stream.update(spawn.x, spawn.z, 0);
    while (!this.world.ready && this.world.progress < ROAM_ENTRY_PROGRESS) {
      await nextFrame();
      if (this.disposed) return;
      this.world.stream.update(spawn.x, spawn.z, 26);
    }

    this.world.follow(0.016, spawn.x, spawn.z, this.rig.camera);
    this.rig.follow(this.#subjectFor(this.player), 0.016, true);
    this.transitioning = false;
    this.clock.getDelta();
    this.#message(place.name, { sub: place.label, duration: 2.4 });
  }

  #updateRoam(dt) {
    const player = this.player;
    const world = this.world;

    Object.assign(player.input, this.#playerInput());
    player.step(dt, this.cityMap);

    // Traffic moves first, so the solver sees where the cars actually
    // are this frame rather than where they were last frame.
    world.traffic?.update(dt, player.x, player.z);

    const actors = this.roamActors;
    actors.length = 0;
    actors.push(player);
    if (world.traffic) {
      for (const car of world.traffic.cars) if (car.active) actors.push(car);
    }
    resolveCollisions(actors, (a, b, force) => {
      this.audio.impact(force);
      this.fx.impact((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, force);
      if (a.isPlayer || b.isPlayer) {
        this.rig.addShake(force * 0.9);
        this.postFx?.pulse(0xff7a4d, force * 0.5);
      }
    });

    world.stream.obstaclesNear(player.x, player.z, 46, this.roamObstacles);
    const onHit = (force) => {
      this.audio.impact(force);
      this.fx.impact(player.x, player.y, player.z, force);
      this.rig.addShake(force);
      this.postFx?.pulse(0xff7a4d, force * 0.5);
    };
    resolveBuildingCollisions(player, this.roamObstacles, onHit);
    clampToDeck(player, this.cityMap, onHit);
    clampToShore(player, this.cityMap, onHit);

    player.applyVisuals(dt);
    this.fx.emitForVehicle(player, dt);
    this.#layTireMarks(player);

    this.rig.follow(this.#subjectFor(player), dt);
    this.#keepCameraClear(player);
    world.follow(dt, player.x, player.z, this.rig.camera);

    this.roamStats.update(dt, player, this.roamDistrict.id);
    this.#fillRoamTelemetry(dt);
    this.#trackBoostFeedback();
    this.#updateAudio(dt);
  }

  /**
   * A chase camera nineteen metres behind the car will end up inside a
   * forty-storey wall roughly every third junction. Shortening the boom
   * until the line of sight is clear is the whole fix.
   */
  #keepCameraClear(player) {
    const camera = this.rig.camera;
    const eyeY = player.y + 1.3;
    const boom = clearCameraBoom(
      { x: player.x, y: eyeY, z: player.z },
      camera.position,
      this.roamObstacles,
    );
    if (boom >= 1) return;

    camera.position.set(
      player.x + (camera.position.x - player.x) * boom,
      eyeY + (camera.position.y - eyeY) * boom,
      player.z + (camera.position.z - player.z) * boom,
    );
    camera.lookAt(this.rig.focus);
    camera.rotateZ(this.rig.rollAngle);
  }

  #fillRoamTelemetry(dt) {
    const t = this.telemetry;
    const r = t.roam;
    const player = this.player;

    t.mode = MODE.WORLD;
    t.dt = dt;

    this.smoothSpeed += (player.displaySpeed - this.smoothSpeed) * Math.min(1, 12 * dt);
    t.displaySpeed = Math.round(this.smoothSpeed);
    t.speedFraction = clamp01(Math.abs(player.speed) / player.maxSpeed);
    t.topSpeedKmh = Math.round(player.maxSpeed * PHYS.speedToKmh);
    t.redline = t.speedFraction > 0.86;

    // Gear and revs from one function, so the readout and the needle
    // cannot disagree about which gear the car is in.
    const revs = revsFor(t.speedFraction, player.input.throttle, this.revs);
    t.rpm = revs.rpm;
    t.rpmFrac = revs.rpmFrac;
    t.gear = player.speed < -0.4 ? 'R' : revs.gear;

    t.boostFraction = player.boostFraction;
    t.boostReady = player.boost >= BOOST.minToFire;
    t.boostFiring = player.boostActive;
    t.driftScore = Math.round(player.totalDriftScore);
    t.driftCombo = player.driftCombo;
    t.driftActive = player.driftTimer > 0;
    t.showMinimap = this.state.settings.showMinimap;

    const district = this.cityMap.districtAt(player.x, player.z, this.roamDistrict);
    r.x = player.x;
    r.z = player.z;
    r.heading = player.heading;
    r.districtId = district.id;
    r.districtName = district.spec.name;
    r.districtLabel = district.spec.label;
    r.placeName = district.place?.name ?? null;
    r.bridgeName = player.onBridge?.name ?? null;
    r.distance = this.roamStats.distance;
    r.topSpeedKmh = Math.round(this.roamStats.topSpeed * PHYS.speedToKmh);
    r.elapsed = this.roamStats.elapsed;
    r.chunks = this.world.stream.chunkCount;
    r.streaming = !this.world.ready;
    r.offRoad = !player.onTrack;
  }

  startRace() {
    this.audio.start();
    this.audio.uiSelect();

    // Rebuild if the garage or setup changed the car since last time.
    const { carId, paintId } = this.state.setup;
    if (this.player.car.id !== carId || this.player.paint.id !== paintId) this.buildField();

    const tier = DIFFICULTIES[this.state.setup.difficulty];
    for (const driver of this.drivers.values()) driver.difficulty = tier;

    this.mode = MODE.RACE;
    this.telemetry.mode = MODE.RACE;
    this.paused = false;
    this.inputEnabled = true;
    this.smoothSpeed = 0;
    this.raceStartedAt = Date.now();
    this.renderer.toneMappingExposure = RENDER_TUNING.gameplayExposure;
    if (this.showcase) this.showcase.visible = false;
    if (this.showcaseLighting) this.showcaseLighting.visible = false;

    this.director = new RaceDirector({
      circuit: this.circuit,
      vehicles: this.vehicles,
      totalLaps: this.state.setup.laps,
      events: {
        onLights: (stage) => this.world.startLights.set(stage),
        onCountdownBeep: (stage) => this.audio.countdownBeep(stage),
        onStart: () => {
          this.audio.goSignal();
          this.#message('GO', { tone: 'good', duration: 1 });
        },
        onLap: (vehicle, lap) => {
          if (!vehicle.isPlayer) return;
          this.audio.lapChime();
          const last = this.director.timingFor(vehicle).laps.at(-1);
          this.#message(`LAP ${lap}`, { sub: formatLapTime(last), duration: 1.6 });
        },
        onSector: () => {},
        onFinish: (vehicle) => {
          if (!vehicle.isPlayer) return;
          this.audio.finishFanfare();
          this.#message('FINISH', { tone: 'good', duration: 2.4 });
        },
        onRaceEnd: (results) => this.#finishRace(results),
      },
    });

    this.world.lighting.setShadowRadius(this.quality.shadowRadius);
    this.world.setGuideLineVisible(this.state.settings.showGhostLine);
    this.world.startLights.set(0);
    this.tireMarks.clear();
    this.fx.clear();

    this.telemetry.active = true;
    this.telemetry.totalLaps = this.director.totalLaps;
    this.rig.follow(this.#subjectFor(this.player), 0.016, true);

    this.#message('GET READY', { duration: 1.5 });
    this.events.emit('racestate', { state: RACE_STATE.COUNTDOWN, paused: false, mode: this.mode });
  }

  setPaused(paused) {
    if (this.mode !== MODE.RACE && this.mode !== MODE.WORLD) return;
    this.paused = paused;
    this.inputEnabled = !paused;
    if (paused) this.keys.clear();
    this.audio[paused ? 'uiBack' : 'uiSelect']();
    this.events.emit('racestate', {
      state: this.director?.state ?? null,
      paused,
      mode: this.mode,
    });
  }

  #message(text, opts = {}) {
    this.events.emit('message', { text, sub: '', tone: '', duration: 1.4, ...opts });
  }

  // ══ Results ════════════════════════════════════════

  #finishRace(results) {
    const playerResult = results.find((entry) => entry.isPlayer) ?? null;
    const timing = this.director.timingFor(this.player);

    const bestLapRecord = timing?.best
      ? this.state.submitLap(this.circuit.id, timing.best, this.player.car.id)
      : false;
    const driftRecord = this.state.submitDrift(this.player.totalDriftScore);

    this.state.submitRace({
      circuitId: this.circuit.id,
      carId: this.player.car.id,
      laps: this.director.totalLaps,
      time: playerResult?.time ?? Infinity,
      position: playerResult?.position ?? results.length,
      finished: !!playerResult?.finished,
    });

    if (bestLapRecord || driftRecord) this.audio.recordChime();

    const payload = {
      circuitId: this.circuit.id,
      circuitName: this.circuit.name,
      laps: this.director.totalLaps,
      difficulty: this.state.setup.difficulty,
      startedAt: this.raceStartedAt ?? Date.now(),
      results,
      playerResult,
      bestLapRecord,
      driftRecord,
      timingFor: (vehicle) => this.director.timingFor(vehicle),
    };

    // Let the cars roll to a stop before the screen drops in.
    this.resultsTimer = setTimeout(() => {
      if (this.disposed) return;
      this.telemetry.active = false;
      this.inputEnabled = false;
      this.events.emit('results', payload);
      this.enterAttract();
    }, 2200);
  }

  // ══ Camera ═════════════════════════════════════════

  setCamera(id) {
    this.rig.setMode(id);
    this.events.emit('camera', id);
  }

  cycleCamera() {
    // Free roam has its own cycle. A pure overhead view of a district
    // of two-hundred-metre towers shows the player nothing but roofs.
    const order = this.mode === MODE.WORLD ? CAMERA_ORDER_ROAM : CAMERA_ORDER;
    const next = (order.indexOf(this.rig.modeId) + 1) % order.length;
    const id = this.rig.setMode(order[next]);
    if (this.mode !== MODE.WORLD) this.state.updateSettings({ camera: id });
    this.events.emit('camera', id);
    // A permanent "CAM BIRD" corner label is clutter for something the
    // player changes twice a race. Say it once, then get out of the way.
    this.#message(`CAM ${id.toUpperCase()}`, { duration: 1 });
    return id;
  }

  setGhostLine(on) {
    this.world?.setGuideLineVisible(on && this.mode === MODE.RACE);
  }

  // ══ Input ══════════════════════════════════════════

  /**
   * Only the continuous driving keys. Escape, camera cycling and
   * restart are discrete UI concerns and belong to React, which knows
   * which screen is open; the engine does not and should not.
   */
  #bindDrivingInput() {
    this.onKeyDown = (event) => {
      if (!event.repeat) this.audio.start();
      if (this.inputEnabled && DRIVING_KEYS.has(event.code)) event.preventDefault();
      this.keys.add(event.code);
    };
    this.onKeyUp = (event) => this.keys.delete(event.code);
    this.onBlur = () => this.keys.clear();

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  #playerInput() {
    const held = (...codes) => codes.some((code) => this.keys.has(code));
    // Local +X points to screen-left with this camera basis, and the
    // heading integrates toward +X, so LEFT is the positive steer.
    return {
      throttle: held('KeyW', 'ArrowUp') ? 1 : 0,
      brake: held('KeyS', 'ArrowDown') ? 1 : 0,
      steer: (held('KeyA', 'ArrowLeft') ? 1 : 0) + (held('KeyD', 'ArrowRight') ? -1 : 0),
      handbrake: held('Space'),
      boost: held('ShiftLeft', 'ShiftRight'),
    };
  }

  // ══ Simulation ═════════════════════════════════════

  #subjectFor(vehicle) {
    return {
      x: vehicle.x,
      y: vehicle.y,
      z: vehicle.z,
      heading: vehicle.heading,
      velHeading: vehicle.velHeading,
      speed: vehicle.speed,
      maxSpeed: vehicle.maxSpeed,
      drift: vehicle.drift,
    };
  }

  #simulate(dt, { playerControlled }) {
    for (const vehicle of this.vehicles) {
      if (vehicle.isPlayer && playerControlled) {
        Object.assign(vehicle.input, this.#playerInput());
      } else {
        this.drivers
          .get(vehicle)
          ?.update(
            this.circuit,
            this.vehicles,
            playerControlled ? this.player : null,
            dt,
            this.clock.elapsedTime,
          );
      }
      vehicle.step(dt, this.circuit);
    }

    resolveCollisions(this.vehicles, (a, b, force) => {
      this.audio.impact(force);
      this.fx.impact((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, force);
      if (a.isPlayer || b.isPlayer) {
        this.rig.addShake(force * 0.9);
        this.postFx?.pulse(0xff7a4d, force * 0.5);
      }
    });

    for (const vehicle of this.vehicles) {
      clampToBarrier(vehicle, this.circuit, this.circuit.barrierLimit, (hit, force) => {
        this.audio.impact(force);
        this.fx.impact(hit.x, hit.y, hit.z, force * 0.8);
        if (hit.isPlayer) this.rig.addShake(force);
      });
      vehicle.applyVisuals(dt);
      this.fx.emitForVehicle(vehicle, dt);
      this.#layTireMarks(vehicle);
    }
  }

  #layTireMarks(vehicle) {
    const absDrift = Math.abs(vehicle.drift);
    const absSpeed = Math.abs(vehicle.speed);
    const sliding = absDrift > DRIFT.minAngle * 0.7 && absSpeed > 6;
    const locked = vehicle.input.handbrake && absSpeed > 4;

    if ((sliding || locked) && vehicle.onTrack) {
      const intensity =
        clamp01(absDrift / 0.6) * clamp01(absSpeed / vehicle.maxSpeed) + 0.18;
      this.tireMarks.addForVehicle(vehicle, Math.min(1, intensity));
    } else {
      this.tireMarks.breakForVehicle(vehicle);
    }
  }

  #updateAudio(dt) {
    if (!this.audio.ready) return;
    const racing = this.mode === MODE.RACE || this.mode === MODE.WORLD;
    const listener = racing ? this.player : this.vehicles[0];

    this.audio.engine.update(
      {
        speedFrac: clamp01(Math.abs(listener.speed) / listener.maxSpeed),
        rpmFrac: this.revs.rpmFrac,
        throttle: listener.input.throttle,
        boost: listener.boostActive,
      },
      dt,
    );

    // The rival mix is a race feature. In the open world the cars around
    // you are ambient traffic, and six of them idling in your ear is not
    // the sound of a city.
    if (this.mode === MODE.WORLD) return;

    for (const vehicle of this.vehicles) {
      if (vehicle === listener) continue;
      if (vehicle.soundIdx === undefined) vehicle.soundIdx = this.audio.addRival();
      if (vehicle.soundIdx < 0) continue;
      this.audio.rivals.updateCar(
        vehicle.soundIdx,
        vehicle.x, vehicle.y, vehicle.z,
        vehicle.speed,
        listener.x, listener.y, listener.z,
        listener.heading,
        dt,
      );
    }
  }

  #trackBoostFeedback() {
    const player = this.player;
    if (player.boostActive && !this.wasBoosting) {
      this.audio.boostFire();
      this.postFx?.pulse(0x8fe8ff, 0.5);
      this.rig.addShake(0.35);
    }
    this.wasBoosting = player.boostActive;

    if (player.driftCombo >= DRIFT.maxCombo && !this.maxComboShown) {
      this.maxComboShown = true;
      this.#message('MAX COMBO', { tone: 'good', duration: 1.1 });
    }
    if (player.driftTimer === 0) this.maxComboShown = false;
  }

  // ══ Telemetry ══════════════════════════════════════

  /** Fills the shared snapshot in place. No allocation in here. */
  #fillTelemetry(dt) {
    const t = this.telemetry;
    const player = this.player;
    const director = this.director;
    const timing = director.timingFor(player);

    t.dt = dt;
    t.position = player.position;
    t.fieldSize = director.vehicles.length;
    t.lap = Math.min(player.lap + 1, director.totalLaps);
    t.totalLaps = director.totalLaps;
    t.currentLap = currentLapTime(director, player);
    t.bestLap = timing?.best ?? 0;
    t.gapAhead = director.playerGapAhead();

    this.smoothSpeed += (player.displaySpeed - this.smoothSpeed) * Math.min(1, 12 * dt);
    t.displaySpeed = Math.round(this.smoothSpeed);
    t.speedFraction = clamp01(Math.abs(player.speed) / player.maxSpeed);
    t.topSpeedKmh = Math.round(player.maxSpeed * PHYS.speedToKmh);
    t.redline = t.speedFraction > 0.86;

    // Gear and revs from one function, so the readout and the needle
    // cannot disagree about which gear the car is in.
    const revs = revsFor(t.speedFraction, player.input.throttle, this.revs);
    t.rpm = revs.rpm;
    t.rpmFrac = revs.rpmFrac;
    t.gear = player.speed < -0.4 ? 'R' : revs.gear;

    t.boostFraction = player.boostFraction;
    t.boostReady = player.boost >= BOOST.minToFire;
    t.boostFiring = player.boostActive;

    t.driftScore = Math.round(player.totalDriftScore);
    t.driftCombo = player.driftCombo;
    t.driftActive = player.driftTimer > 0;

    t.wrongWay = director.isWrongWay(player);
    t.showMinimap = this.state.settings.showMinimap;
    t.standings = director.standings;
  }

  // ══ Loop ═══════════════════════════════════════════

  #loop = () => {
    if (this.disposed) return;
    this.frameHandle = requestAnimationFrame(this.#loop);

    const measuredDt = Math.min(this.clock.getDelta(), 0.05);
    // A world swap disposes the scene and rebuilds it over several
    // frames. Nothing may touch it in between, including the renderer.
    if (this.transitioning) return;

    const visualTestFrame = this.visualTest.enabled;
    const dt = visualTestFrame ? 0 : measuredDt;
    if (!visualTestFrame) this.world.update(dt);

    if (this.mode === MODE.RACE && !this.paused) {
      this.director.update(dt);
      const live =
        this.director.state === RACE_STATE.RACING ||
        this.director.state === RACE_STATE.FINISHED;

      if (live) this.#simulate(dt, { playerControlled: true });
      else for (const vehicle of this.vehicles) vehicle.applyVisuals(dt);

      this.rig.follow(this.#subjectFor(this.player), dt);
      this.world.lighting.focusOn(this.player.x, this.player.z);
      this.#fillTelemetry(dt);
      this.#trackBoostFeedback();
      this.#updateAudio(dt);
    } else if (this.mode === MODE.WORLD) {
      if (!this.paused) this.#updateRoam(dt);
    } else if (this.mode === MODE.GARAGE) {
      this.#updateGarage(dt);
    } else if (!this.paused) {
      this.#simulate(dt, { playerControlled: false });
      const lead = this.vehicles[0];
      this.cinematic.update(dt, this.#subjectFor(lead), this.rig);
      this.world.lighting.focusOn(lead.x, lead.z);
      this.#updateAudio(dt);
    }

    if (!visualTestFrame) this.fx.update(dt);

    if (this.postFx) this.postFx.render(dt);
    else this.renderer.render(this.scene, this.rig.camera);

    this.events.emit('frame', this.telemetry);
  };

  #updateGarage(dt) {
    if (this.visualTest.enabled) {
      this.#applyInspectionPose();
      return;
    }

    // Keep the demo race running so there is movement behind the panel.
    this.#simulate(dt, { playerControlled: false });
    this.#updateAudio(dt);
    if (!this.showcase) return;

    this.turntable += dt * 0.32;
    this.showcase.rotation.y = this.turntable;

    const pose = this.#garageCameraPose();
    this.rig.place(pose.position, pose.target, GARAGE_FOV, dt);
    this.world.lighting.focusOn(pose.target.x, pose.target.z);
  }

  /** Slow orbit around the plinth, framed clear of the panel on the left. */
  #garageCameraPose() {
    if (this.visualTest.enabled) return this.#inspectionCameraPose();

    const spot = this.#showcaseSpot();
    // Closer, slightly lower orbit so fascia, wheels and aero read clearly.
    const radius = 11.8;
    const angle = this.turntable * 0.35 + 0.6;
    const position = new THREE.Vector3(
      spot.x + Math.cos(angle) * radius,
      spot.y + 4.2 + Math.sin(this.turntable * 0.5) * 0.85,
      spot.z + Math.sin(angle) * radius,
    );
    const car = new THREE.Vector3(spot.x, spot.y + 0.85, spot.z);

    const viewDir = car.clone().sub(position).normalize();
    const screenRight = new THREE.Vector3().crossVectors(viewDir, UP).normalize();
    return { position, target: car.addScaledVector(screenRight, -3.6) };
  }

  /** Cardinal camera positions used for repeatable front/side/rear reviews. */
  #inspectionCameraPose() {
    const spot = this.#showcaseSpot();
    const view = GARAGE_INSPECTION_VIEWS[this.visualTest.viewId];
    const heading = THREE.MathUtils.degToRad(view.headingDegrees);
    const radius = 11.8;
    const position = new THREE.Vector3(
      spot.x + Math.sin(heading) * radius,
      spot.y + 3.15,
      spot.z + Math.cos(heading) * radius,
    );
    const car = new THREE.Vector3(spot.x, spot.y + 0.82, spot.z);
    const viewDir = car.clone().sub(position).normalize();
    const screenRight = new THREE.Vector3().crossVectors(viewDir, UP).normalize();
    return { position, target: car.addScaledVector(screenRight, -3.6) };
  }

  #applyInspectionPose() {
    if (!this.visualTest.enabled || this.mode !== MODE.GARAGE || !this.showcase) return;
    this.turntable = 0;
    this.showcase.rotation.y = 0;
    const pose = this.#inspectionCameraPose();
    this.rig.snapTo(pose.position, pose.target, GARAGE_FOV);
    this.world.lighting.focusOn(pose.target.x, pose.target.z);
  }

  #renderInspectionFrame() {
    if (!this.visualTest.enabled || !this.renderer) return;
    this.#applyInspectionPose();
    if (this.postFx) this.postFx.render(0);
    else this.renderer.render(this.scene, this.rig.camera);
  }

  // ══ Teardown ═══════════════════════════════════════

  /**
   * Full teardown. React Strict Mode mounts, unmounts and remounts in
   * development, so leaking a WebGL context here costs a context per
   * edit until the browser starts dropping the oldest one.
   */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    cancelAnimationFrame(this.frameHandle);
    clearTimeout(this.resultsTimer);

    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    if (this.visualTest.api && window[VISUAL_TEST_API] === this.visualTest.api) {
      delete window[VISUAL_TEST_API];
    }
    this.visualTest.api = null;

    for (const vehicle of this.vehicles) vehicle.mesh.userData.dispose?.();
    this.showcase?.userData.dispose?.();
    if (this.showcaseLighting) this.scene?.remove(this.showcaseLighting);
    this.showcaseLighting = null;
    this.vehicles.length = 0;
    this.drivers.clear();

    this.world?.dispose();
    this.fx?.dispose();
    this.tireMarks?.dispose();
    this.postFx?.dispose();
    this.audio?.dispose?.();
    this.renderer?.dispose();
    this.events.clear();
  }
}

const DRIVING_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight',
]);

/**
 * Yield long enough for the loading screen to repaint. Races rAF
 * against a timer, because a throttled or hidden tab can withhold
 * animation frames indefinitely and boot must not hang on that.
 */
const nextFrame = () =>
  new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 60);
  });
