// ═══════════════════════════════════════════════════════
//  TYPED ENGINE SURFACE
//
//  The simulation stays plain JavaScript. It is numeric, hot, and
//  rewriting eight thousand lines of it into TypeScript would buy
//  nothing the profiler cares about.
//
//  What does need types is the surface React and the chain layer
//  touch, because that is where a wrong field name becomes a blank
//  panel rather than a crash. This module is that surface: it declares
//  the shapes and re-exports the engine's catalogues with them applied.
//  UI code imports from here, never from the .js modules directly.
// ═══════════════════════════════════════════════════════
import {
  QUALITY as RAW_QUALITY,
  DIFFICULTIES as RAW_DIFFICULTIES,
  CAMERA_ORDER as RAW_CAMERA_ORDER,
  LAP_OPTIONS as RAW_LAP_OPTIONS,
  DEFAULT_LAPS as RAW_DEFAULT_LAPS,
  PHYS as RAW_PHYS,
} from './config.js';
import {
  CARS as RAW_CARS,
  getCarById as rawGetCarById,
  getPaint as rawGetPaint,
} from './cars/catalog.js';
// circuits.js, not track.js: the catalogue is pure data, while the
// Circuit class drags in Three.js. Importing the latter here put half a
// megabyte into the first-load bundle so the menu could print a name.
import { CIRCUITS as RAW_CIRCUITS, getCircuitById as rawGetCircuitById } from './world/circuits.js';
// cityConfig.js is the same kind of module: pure data, no Three.js, so a
// menu can print district names and world dimensions without paying for
// the renderer.
import {
  BRIDGES as RAW_BRIDGES,
  DISTRICTS as RAW_DISTRICTS,
  PLACES as RAW_PLACES,
  MOTORWAY_GRID as RAW_MOTORWAY_GRID,
  SUPERBLOCK as RAW_SUPERBLOCK,
  WORLD_HALF as RAW_WORLD_HALF,
  WORLD_SIZE as RAW_WORLD_SIZE,
  getPlaceById as rawGetPlaceById,
} from './world/city/cityConfig.js';

export type QualityId = 'low' | 'medium' | 'high';
export type DifficultyId = 'rookie' | 'pro' | 'ace';
/**
 * The cameras a player can choose for a race. Free roam adds a fourth,
 * `roam`, but it is never stored in settings — it is selected by
 * entering the open world and cycled only while you are in it.
 */
export type CameraId = 'bird' | 'top' | 'chase';

export interface QualityTier {
  id: QualityId;
  label: string;
  pixelRatio: number;
  shadowMapSize: number;
  shadowRadius: number;
  postFx: boolean;
  bloom: boolean;
  maxTireMarks: number;
}

export interface DifficultyTier {
  id: DifficultyId;
  label: string;
  blurb: string;
  aiSpeed: number;
  aiSkill: number;
}

export interface CarStats {
  topSpeed: number;
  accel: number;
  grip: number;
  handling: number;
}

export interface CarPaint {
  id: string;
  /** Packed 0xRRGGBB — the engine speaks Three.js, not CSS. */
  base: number;
  accent: number;
  trim: number;
}

export interface Car {
  id: string;
  name: string;
  maker: string;
  class: string;
  number: number;
  blurb: string;
  stats: CarStats;
  paints: CarPaint[];
}

export interface CircuitSpec {
  id: string;
  name: string;
  location: string;
  blurb: string;
  environment: string;
}

export interface WorldPlace {
  id: string;
  name: string;
  label: string;
  blurb: string;
  /** Null for places pinned to the strait, whose x follows the channel. */
  x: number | null;
  z: number;
  district: string;
  radius: number;
  bridgeId?: string;
}

export interface WorldDistrict {
  id: string;
  name: string;
  label: string;
  ground: number;
  height: readonly number[];
}

export interface WorldBridge {
  id: string;
  name: string;
  label: string;
  z: number;
  deckHeight: number;
  towerHeight: number;
}

/** Free-roam telemetry, written in place by the engine every frame. */
export interface RoamTelemetry {
  x: number;
  z: number;
  heading: number;
  districtId: string;
  districtName: string;
  districtLabel: string;
  placeName: string | null;
  bridgeName: string | null;
  distance: number;
  topSpeedKmh: number;
  elapsed: number;
  chunks: number;
  streaming: boolean;
  offRoad: boolean;
}

export const WORLD = {
  size: RAW_WORLD_SIZE as number,
  half: RAW_WORLD_HALF as number,
  motorwayGrid: RAW_MOTORWAY_GRID as number,
  superblock: RAW_SUPERBLOCK as number,
  /** Square kilometres, for the one line in the menu that says so. */
  areaKm2: ((RAW_WORLD_SIZE as number) / 1000) ** 2,
} as const;

export const PLACES = RAW_PLACES as WorldPlace[];
export const DISTRICTS = RAW_DISTRICTS as Record<string, WorldDistrict>;
export const BRIDGES = RAW_BRIDGES as WorldBridge[];
export const getPlaceById = rawGetPlaceById as (id: string) => WorldPlace;

export const QUALITY = RAW_QUALITY as Record<QualityId, QualityTier>;
export const DIFFICULTIES = RAW_DIFFICULTIES as Record<DifficultyId, DifficultyTier>;
export const CAMERA_ORDER = RAW_CAMERA_ORDER as readonly CameraId[];
export const LAP_OPTIONS = RAW_LAP_OPTIONS as readonly number[];
export const DEFAULT_LAPS = RAW_DEFAULT_LAPS as number;
export const PHYS = RAW_PHYS as { speedToKmh: number; maxSpeed: number };

export const CARS = RAW_CARS as Car[];
export const CIRCUITS = RAW_CIRCUITS as CircuitSpec[];

export const getCarById = rawGetCarById as (id: string) => Car;
export const getPaint = rawGetPaint as (car: Car, paintId: string) => CarPaint;
export const getCircuitById = rawGetCircuitById as (id: string) => CircuitSpec;

/** `0x1f6fe0` → `#1f6fe0`. The UI needs CSS, the engine stores numbers. */
export const cssColor = (packed: number): string => `#${packed.toString(16).padStart(6, '0')}`;

export const QUALITY_IDS = Object.keys(QUALITY) as QualityId[];
export const DIFFICULTY_IDS = Object.keys(DIFFICULTIES) as DifficultyId[];
