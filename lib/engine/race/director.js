// ═══════════════════════════════════════════════════════
//  RACE DIRECTOR — grid, lights, laps, sectors, standings
//
//  Owns everything about *the race* and nothing about rendering, so
//  the same object drives the HUD, the results screen and the
//  attract-mode demo race.
// ═══════════════════════════════════════════════════════
import { GRID_SIZE } from '../config.js';
import { wrap01 } from '../util.js';

export const RACE_STATE = {
  GRID: 'grid',
  COUNTDOWN: 'countdown',
  RACING: 'racing',
  FINISHED: 'finished',
};

const GRID_ROW_SPACING = 8.2;
const GRID_LATERAL = 3.6;
const GRID_FIRST_OFFSET = 9;
/** Seconds each red light stays on during the start sequence. */
const LIGHT_INTERVAL = 0.85;
const GRID_HOLD = 1.6;
/** Once the leader finishes, everyone else has this long to cross. */
const FINISH_WINDOW = 25;

export class RaceDirector {
  /**
   * @param {object} opts
   * @param {import('../world/track.js').Circuit} opts.circuit
   * @param {import('./vehicle.js').Vehicle[]} opts.vehicles
   * @param {number} opts.totalLaps
   * @param {object} [opts.events]
   */
  constructor({ circuit, vehicles, totalLaps, events = {} }) {
    this.circuit = circuit;
    this.vehicles = vehicles;
    this.player = vehicles.find((v) => v.isPlayer) ?? null;
    this.totalLaps = totalLaps;
    this.events = events;

    this.state = RACE_STATE.GRID;
    this.clock = 0;
    this.stateClock = 0;
    this.raceTime = 0;
    this.lightStage = 0;
    this.finishTimer = -1;
    this.results = [];
    this.standings = [];

    this.timing = new Map();
    for (const vehicle of vehicles) {
      this.timing.set(vehicle, createTiming());
    }

    this.placeOnGrid();
  }

  // ── Grid ──

  placeOnGrid() {
    const ordered = this.#gridOrder();
    ordered.forEach((vehicle, slot) => {
      const row = Math.floor(slot / 2);
      const col = slot % 2 === 0 ? -1 : 1;
      const distance = GRID_FIRST_OFFSET + row * GRID_ROW_SPACING;
      const t = wrap01(-distance / this.circuit.length);
      const frame = this.circuit.frame(t);
      const x = frame.point.x + frame.side.x * col * GRID_LATERAL;
      const z = frame.point.z + frame.side.z * col * GRID_LATERAL;

      vehicle.reset(x, z, frame.heading);
      vehicle.trackT = t;
      vehicle.prevTrackT = t;
      vehicle.progress = t - 1;
      vehicle.position = slot + 1;
      vehicle.applyVisuals(0.016);

      const timing = this.timing.get(vehicle);
      resetTiming(timing);
    });
  }

  /** Player starts at the back — there is a race to win, not a lead to keep. */
  #gridOrder() {
    const rivals = this.vehicles.filter((v) => !v.isPlayer);
    const ordered = [...rivals];
    if (this.player) ordered.push(this.player);
    return ordered.slice(0, Math.max(GRID_SIZE, ordered.length));
  }

  restart() {
    this.state = RACE_STATE.GRID;
    this.clock = 0;
    this.stateClock = 0;
    this.raceTime = 0;
    this.lightStage = 0;
    this.finishTimer = -1;
    this.results = [];
    this.placeOnGrid();
    this.events.onLights?.(0);
  }

  get isRunning() {
    return this.state === RACE_STATE.RACING;
  }

  get inputsEnabled() {
    return this.state === RACE_STATE.RACING || this.state === RACE_STATE.FINISHED;
  }

  // ── Frame update ──

  update(dt) {
    this.clock += dt;
    this.stateClock += dt;

    switch (this.state) {
      case RACE_STATE.GRID:
        if (this.stateClock >= GRID_HOLD) this.#enter(RACE_STATE.COUNTDOWN);
        break;

      case RACE_STATE.COUNTDOWN:
        this.#updateCountdown();
        break;

      case RACE_STATE.RACING:
        this.raceTime += dt;
        this.#updateTiming(dt);
        this.#updateFinishWindow(dt);
        break;

      case RACE_STATE.FINISHED:
        this.raceTime += dt;
        break;
    }

    this.#updateStandings();
  }

  #enter(state) {
    this.state = state;
    this.stateClock = 0;
    if (state === RACE_STATE.COUNTDOWN) {
      this.lightStage = 0;
      this.events.onLights?.(0);
    }
    if (state === RACE_STATE.RACING) {
      this.raceTime = 0;
      for (const vehicle of this.vehicles) {
        const timing = this.timing.get(vehicle);
        timing.lapStart = 0;
        timing.sectorStart = 0;
        timing.sector = 0;
      }
      this.events.onStart?.();
    }
    if (state === RACE_STATE.FINISHED) {
      this.#buildResults();
      this.events.onRaceEnd?.(this.results);
    }
  }

  #updateCountdown() {
    // Five reds at 0.85 s intervals, then a pause, then green.
    const stage = Math.min(5, Math.floor(this.stateClock / LIGHT_INTERVAL) + 1);
    if (stage !== this.lightStage && this.stateClock < LIGHT_INTERVAL * 5) {
      this.lightStage = stage;
      this.events.onLights?.(stage);
      this.events.onCountdownBeep?.(stage);
    }
    if (this.stateClock >= LIGHT_INTERVAL * 5 + 0.9) {
      this.lightStage = 'go';
      this.events.onLights?.('go');
      this.#enter(RACE_STATE.RACING);
    }
  }

  #updateTiming(dt) {
    for (const vehicle of this.vehicles) {
      if (vehicle.finished) continue;
      const timing = this.timing.get(vehicle);
      const t = vehicle.trackT;
      const prev = vehicle.prevTrackT;

      // Anti-cut: the halfway marker must actually be visited.
      if (t > 0.42 && t < 0.58) vehicle.hasPassedHalf = true;

      // Sector splits.
      const sectorEdges = [1 / 3, 2 / 3];
      for (let s = 0; s < sectorEdges.length; s++) {
        const edge = sectorEdges[s];
        if (timing.sector === s && prev < edge && t >= edge && t - prev < 0.4) {
          const split = this.raceTime - timing.sectorStart;
          timing.sectors[s] = split;
          timing.sectorStart = this.raceTime;
          timing.sector = s + 1;
          if (vehicle.isPlayer) this.events.onSector?.(s, split, timing);
        }
      }

      // Lap line. The grid sits behind it, so the very first crossing
      // starts lap one rather than completing it.
      const crossed = prev > 0.9 && t < 0.1 && vehicle.speed > 0;
      if (crossed && !vehicle.started) {
        vehicle.started = true;
      } else if (crossed && vehicle.hasPassedHalf) {
        const lapTime = this.raceTime - timing.lapStart;
        timing.sectors[2] = this.raceTime - timing.sectorStart;
        timing.laps.push(lapTime);
        if (!timing.best || lapTime < timing.best) {
          timing.best = lapTime;
          timing.bestSectors = [...timing.sectors];
        }
        timing.lapStart = this.raceTime;
        timing.sectorStart = this.raceTime;
        timing.sector = 0;
        timing.sectors = [0, 0, 0];

        vehicle.lap += 1;
        vehicle.hasPassedHalf = false;

        if (vehicle.lap >= this.totalLaps) {
          vehicle.finished = true;
          vehicle.finishTime = this.raceTime;
          this.events.onFinish?.(vehicle, this.raceTime);
          if (this.finishTimer < 0) this.finishTimer = FINISH_WINDOW;
        } else {
          this.events.onLap?.(vehicle, vehicle.lap + 1, lapTime);
        }
      }

      vehicle.prevTrackT = t;
      // Cars still on the run to the line count as negative progress,
      // otherwise the standings would flip the instant they cross.
      vehicle.progress = vehicle.lap + t - (vehicle.started ? 0 : 1);
    }
  }

  #updateFinishWindow(dt) {
    if (this.finishTimer >= 0) this.finishTimer -= dt;
    const everyoneHome = this.vehicles.every((v) => v.finished);
    if (everyoneHome || (this.finishTimer >= 0 && this.finishTimer <= 0)) {
      this.#enter(RACE_STATE.FINISHED);
    }
  }

  #updateStandings() {
    const sorted = [...this.vehicles].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      return b.progress - a.progress;
    });

    const leader = sorted[0];
    this.standings = sorted.map((vehicle, index) => {
      vehicle.position = index + 1;
      const gapLaps = leader ? leader.progress - vehicle.progress : 0;
      // Convert progress gap to seconds using the car's own pace.
      const pace = Math.max(6, Math.abs(vehicle.speed));
      const gapSeconds = (gapLaps * this.circuit.length) / pace;
      return {
        vehicle,
        position: index + 1,
        gap: index === 0 ? 0 : gapSeconds,
        lapsDown: Math.floor(gapLaps),
      };
    });
  }

  #buildResults() {
    const finished = this.vehicles
      .filter((v) => v.finished)
      .sort((a, b) => a.finishTime - b.finishTime);
    const unfinished = this.vehicles
      .filter((v) => !v.finished)
      .sort((a, b) => b.progress - a.progress);

    this.results = [...finished, ...unfinished].map((vehicle, index) => {
      const timing = this.timing.get(vehicle);
      return {
        position: index + 1,
        vehicle,
        name: vehicle.name,
        car: vehicle.car,
        paint: vehicle.paint,
        isPlayer: vehicle.isPlayer,
        finished: vehicle.finished,
        time: vehicle.finished ? vehicle.finishTime : Infinity,
        bestLap: timing.best ?? Infinity,
        driftScore: Math.round(vehicle.totalDriftScore),
      };
    });
  }

  // ── Queries used by the HUD ──

  timingFor(vehicle) {
    return this.timing.get(vehicle);
  }

  /** Seconds the player is ahead of (negative) or behind (positive) the car in front. */
  playerGapAhead() {
    if (!this.player) return null;
    const index = this.standings.findIndex((s) => s.vehicle === this.player);
    if (index <= 0) return null;
    const ahead = this.standings[index - 1];
    const pace = Math.max(6, Math.abs(this.player.speed));
    return ((ahead.vehicle.progress - this.player.progress) * this.circuit.length) / pace;
  }

  /** True when the player is pointing the wrong way down the circuit. */
  isWrongWay(vehicle) {
    if (!this.isRunning || Math.abs(vehicle.speed) < 4) return false;
    const idx = this.circuit.indexAt(vehicle.trackT);
    const forwardX = Math.sin(vehicle.velHeading);
    const forwardZ = Math.cos(vehicle.velHeading);
    return forwardX * this.circuit.tx[idx] + forwardZ * this.circuit.tz[idx] < -0.35;
  }

  get countdownLabel() {
    if (this.state === RACE_STATE.GRID) return 'GET READY';
    if (this.state !== RACE_STATE.COUNTDOWN) return null;
    return this.lightStage === 'go' ? 'GO' : null;
  }
}

function createTiming() {
  return {
    laps: [],
    best: null,
    bestSectors: null,
    sectors: [0, 0, 0],
    sector: 0,
    lapStart: 0,
    sectorStart: 0,
  };
}

function resetTiming(timing) {
  timing.laps.length = 0;
  timing.best = null;
  timing.bestSectors = null;
  timing.sectors = [0, 0, 0];
  timing.sector = 0;
  timing.lapStart = 0;
  timing.sectorStart = 0;
}

/** Current lap time for the HUD. */
export function currentLapTime(director, vehicle) {
  const timing = director.timingFor(vehicle);
  if (!timing || !director.isRunning) return 0;
  return Math.max(0, director.raceTime - timing.lapStart);
}
