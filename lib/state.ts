// ═══════════════════════════════════════════════════════
//  PROFILE STATE — settings, race setup, personal records
//
//  Updates are immutable: every setter replaces the slice it touches
//  and notifies subscribers, so React can render from one source of
//  truth via useSyncExternalStore instead of keeping its own copies.
//
//  Reads are SSR-safe. The store is constructed during render on the
//  server too, where localStorage does not exist, so it falls back to
//  defaults there and hydrates on the client.
// ═══════════════════════════════════════════════════════
import { DEFAULT_LAPS, type CameraId, type DifficultyId, type QualityId } from './engine/api';

const STORAGE_KEY = 'sunset-racing.profile.v1';

export interface Settings {
  quality: QualityId;
  camera: CameraId;
  masterVolume: number;
  showMinimap: boolean;
  showGhostLine: boolean;
  /** Ambient traffic in the open world. Off is a measurable frame win. */
  traffic: boolean;
}

export interface RaceSetup {
  circuitId: string;
  carId: string;
  paintId: string;
  laps: number;
  difficulty: DifficultyId;
  /** Where free roam drops the car. */
  worldPlaceId: string;
  /**
   * The city is a pure function of this number. Change it and every
   * street, hill and skyline changes with it; nothing is stored, so
   * there is nothing to migrate.
   */
  worldSeed: number;
}

export interface LapRecord {
  time: number;
  carId: string;
  date: number;
}

export interface RaceRecord extends LapRecord {
  laps: number;
}

export interface Records {
  /** Keyed by circuit id. */
  bestLap: Record<string, LapRecord>;
  /** Keyed by `${circuitId}:${laps}` — a 3-lap best is not a 8-lap best. */
  bestRace: Record<string, RaceRecord>;
  bestDrift: number;
  races: number;
  wins: number;
  podiums: number;
}

export interface Profile {
  settings: Settings;
  setup: RaceSetup;
  records: Records;
}

export type ProfileSection = 'settings' | 'setup' | 'records';

const DEFAULT_SETTINGS: Settings = {
  quality: 'high',
  camera: 'bird',
  masterVolume: 0.8,
  showMinimap: true,
  showGhostLine: false,
  traffic: true,
};

const DEFAULT_SETUP: RaceSetup = {
  circuitId: 'sunsetRidge',
  carId: 'comet',
  paintId: 'coral',
  laps: DEFAULT_LAPS,
  difficulty: 'pro',
  worldPlaceId: 'goldcrest',
  worldSeed: 20260809,
};

const DEFAULT_RECORDS: Records = {
  bestLap: {},
  bestRace: {},
  bestDrift: 0,
  races: 0,
  wins: 0,
  podiums: 0,
};

function readStored(): Partial<Profile> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Partial<Profile>) : null;
  } catch {
    // Private mode, disabled storage, or corrupt JSON. Defaults are fine.
    return null;
  }
}

function writeStored(profile: Profile): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Persistence is a nicety here, never a requirement.
  }
}

type Listener = (section: ProfileSection, state: GameState) => void;

export class GameState {
  settings: Settings;
  setup: RaceSetup;
  records: Records;

  private listeners = new Set<Listener>();
  /** Bumped on every change so useSyncExternalStore can cache snapshots. */
  private version = 0;

  constructor() {
    const stored = readStored();
    this.settings = { ...DEFAULT_SETTINGS, ...(stored?.settings ?? {}) };
    this.setup = { ...DEFAULT_SETUP, ...(stored?.setup ?? {}) };
    this.records = {
      ...DEFAULT_RECORDS,
      ...(stored?.records ?? {}),
      bestLap: { ...(stored?.records?.bestLap ?? {}) },
      bestRace: { ...(stored?.records?.bestRace ?? {}) },
    };
  }

  subscribe = (fn: Listener | (() => void)): (() => void) => {
    const listener = fn as Listener;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = (): number => this.version;

  private emit(section: ProfileSection): void {
    this.version += 1;
    for (const fn of this.listeners) fn(section, this);
  }

  private persist(): void {
    writeStored({ settings: this.settings, setup: this.setup, records: this.records });
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.settings = { ...this.settings, ...patch };
    this.persist();
    this.emit('settings');
    return this.settings;
  }

  updateSetup(patch: Partial<RaceSetup>): RaceSetup {
    this.setup = { ...this.setup, ...patch };
    this.persist();
    this.emit('setup');
    return this.setup;
  }

  /** True when the lap beat the stored record for that circuit. */
  submitLap(circuitId: string, time: number, carId: string): boolean {
    if (!Number.isFinite(time) || time <= 0) return false;
    const prev = this.records.bestLap[circuitId];
    if (prev && prev.time <= time) return false;

    this.records = {
      ...this.records,
      bestLap: { ...this.records.bestLap, [circuitId]: { time, carId, date: Date.now() } },
    };
    this.persist();
    this.emit('records');
    return true;
  }

  submitRace(entry: {
    circuitId: string;
    carId: string;
    laps: number;
    time: number;
    position: number;
    finished: boolean;
  }): void {
    const records: Records = {
      ...this.records,
      bestRace: { ...this.records.bestRace },
      races: this.records.races + 1,
      wins: this.records.wins + (entry.position === 1 ? 1 : 0),
      podiums: this.records.podiums + (entry.position <= 3 ? 1 : 0),
    };

    if (entry.finished && Number.isFinite(entry.time) && entry.time > 0) {
      const key = `${entry.circuitId}:${entry.laps}`;
      const prev = records.bestRace[key];
      if (!prev || prev.time > entry.time) {
        records.bestRace[key] = {
          time: entry.time,
          carId: entry.carId,
          laps: entry.laps,
          date: Date.now(),
        };
      }
    }

    this.records = records;
    this.persist();
    this.emit('records');
  }

  submitDrift(score: number): boolean {
    if (score <= this.records.bestDrift) return false;
    this.records = { ...this.records, bestDrift: Math.round(score) };
    this.persist();
    this.emit('records');
    return true;
  }

  bestLapFor(circuitId: string): LapRecord | null {
    return this.records.bestLap[circuitId] ?? null;
  }

  resetRecords(): void {
    this.records = { ...DEFAULT_RECORDS, bestLap: {}, bestRace: {} };
    this.persist();
    this.emit('records');
  }
}

/**
 * One profile per browser tab. Created lazily so importing this module
 * on the server never touches storage.
 */
let singleton: GameState | null = null;

export function getGameState(): GameState {
  if (!singleton) singleton = new GameState();
  return singleton;
}
