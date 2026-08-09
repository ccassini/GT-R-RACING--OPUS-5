'use client';

// ═══════════════════════════════════════════════════════
//  HUD DRIVER — the sixty-hertz half of the HUD
//
//  Hands the Hud component a bag of refs and, once the engine is up,
//  subscribes to its frame event and writes into those nodes directly.
//  Every write is compared against a cached previous value first: a car
//  sitting at a steady 214 km/h touches the DOM zero times per frame.
//
//  The standings tower is the only part that ever creates elements, and
//  only when the running order actually changes identity — reordering
//  six rows is text updates, not a rebuild.
// ═══════════════════════════════════════════════════════
import { useEffect, useRef } from 'react';
import { BOOST } from '@/lib/engine/config.js';
import { REDLINE_FRACTION, REDLINE_RPM } from '@/lib/engine/race/revs.js';
import { formatLapTime, formatGap } from '@/lib/engine/util.js';
import { drawCircuitMap } from '@/lib/engine/trackMap.js';
import type { GameEngine } from '@/lib/engine/engine';

/** Where the needle sits at zero and at full scale. */
const DIAL_START = Math.PI * 0.74;
const DIAL_END = Math.PI * 2.26;
const DIAL_SWEEP = DIAL_END - DIAL_START;
/** Fraction of the speedometer sweep treated as its top end. */
const REDLINE = 0.78;
/** Numbered ticks around the face, with minor ticks between each pair. */
const MAJOR_TICKS = 9;
const MINOR_PER_MAJOR = 4;
/** The minimap is legible at 24 fps and costs a full redraw each time. */
const MAP_INTERVAL = 1 / 24;

export interface HudRefs {
  position: React.RefObject<HTMLSpanElement | null>;
  field: React.RefObject<HTMLSpanElement | null>;
  lap: React.RefObject<HTMLSpanElement | null>;
  lapTotal: React.RefObject<HTMLSpanElement | null>;
  current: React.RefObject<HTMLElement | null>;
  best: React.RefObject<HTMLElement | null>;
  gap: React.RefObject<HTMLElement | null>;
  tower: React.RefObject<HTMLOListElement | null>;
  tacho: React.RefObject<HTMLDivElement | null>;
  tachoDial: React.RefObject<HTMLCanvasElement | null>;
  speedo: React.RefObject<HTMLDivElement | null>;
  speed: React.RefObject<HTMLSpanElement | null>;
  gear: React.RefObject<HTMLSpanElement | null>;
  dial: React.RefObject<HTMLCanvasElement | null>;
  minimap: React.RefObject<HTMLCanvasElement | null>;
  boost: React.RefObject<HTMLSpanElement | null>;
  boostWrap: React.RefObject<HTMLDivElement | null>;
  drift: React.RefObject<HTMLSpanElement | null>;
  driftWrap: React.RefObject<HTMLDivElement | null>;
  combo: React.RefObject<HTMLSpanElement | null>;
  warning: React.RefObject<HTMLParagraphElement | null>;
}

interface TowerRow {
  li: HTMLLIElement;
  pos: HTMLSpanElement;
  name: HTMLSpanElement;
  gap: HTMLSpanElement;
}

export function useHudDriver(engine: GameEngine | null, visible: boolean): HudRefs {
  const refs: HudRefs = {
    position: useRef<HTMLSpanElement>(null),
    field: useRef<HTMLSpanElement>(null),
    lap: useRef<HTMLSpanElement>(null),
    lapTotal: useRef<HTMLSpanElement>(null),
    current: useRef<HTMLElement>(null),
    best: useRef<HTMLElement>(null),
    gap: useRef<HTMLElement>(null),
    tower: useRef<HTMLOListElement>(null),
    tacho: useRef<HTMLDivElement>(null),
    tachoDial: useRef<HTMLCanvasElement>(null),
    speedo: useRef<HTMLDivElement>(null),
    speed: useRef<HTMLSpanElement>(null),
    gear: useRef<HTMLSpanElement>(null),
    dial: useRef<HTMLCanvasElement>(null),
    minimap: useRef<HTMLCanvasElement>(null),
    boost: useRef<HTMLSpanElement>(null),
    boostWrap: useRef<HTMLDivElement>(null),
    drift: useRef<HTMLSpanElement>(null),
    driftWrap: useRef<HTMLDivElement>(null),
    combo: useRef<HTMLSpanElement>(null),
    warning: useRef<HTMLParagraphElement>(null),
  };

  useEffect(() => {
    if (!engine || !visible) return;

    const dialCtx = refs.dial.current?.getContext('2d') ?? null;
    const tachoCtx = refs.tachoDial.current?.getContext('2d') ?? null;
    const mapCtx = refs.minimap.current?.getContext('2d') ?? null;

    const cache = new Map<string, unknown>();
    const towerRows: TowerRow[] = [];
    let towerKey = '';
    let mapTimer = 0;
    // Both needles have weight: they lag the reading a little and
    // settle, which is most of what separates an instrument from a bar
    // chart. The rev needle is the quicker of the two — an engine picks
    // up faster than a car does.
    let needle = 0;
    let revNeedle = 0;

    const setText = (node: Element | null, key: string, value: string) => {
      if (!node || cache.get(key) === value) return;
      cache.set(key, value);
      node.textContent = value;
    };

    const setFlag = (node: Element | null, key: string, cls: string, on: boolean) => {
      if (!node || cache.get(key) === on) return;
      cache.set(key, on);
      node.classList.toggle(cls, on);
    };

    const unsubscribe = engine.events.on('frame', (t: Telemetry) => {
      if (!t.active) return;

      setText(refs.position.current, 'position', String(t.position));
      setFlag(refs.position.current, 'lead', 'is-lead', t.position === 1);
      setText(refs.field.current, 'field', `/${t.fieldSize}`);
      setText(refs.lap.current, 'lap', String(t.lap));
      setText(refs.lapTotal.current, 'lapTotal', `/${t.totalLaps}`);

      setText(refs.current.current, 'current', formatLapTime(t.currentLap));
      setText(refs.best.current, 'best', t.bestLap ? formatLapTime(t.bestLap) : '--:--.---');
      setFlag(refs.best.current, 'hasBest', 'is-best', !!t.bestLap);
      setText(refs.gap.current, 'gap', t.gapAhead === null ? 'LEAD' : formatGap(t.gapAhead));

      setText(refs.speed.current, 'speed', String(t.displaySpeed));
      setFlag(refs.speed.current, 'redline', 'is-redline', t.redline);
      setText(refs.gear.current, 'gear', t.gear);
      setFlag(refs.speedo.current, 'speedoRedline', 'is-redline', t.redline);
      setFlag(refs.tacho.current, 'tachoRedline', 'is-redline', t.rpmFrac > REDLINE_FRACTION);

      needle += (t.speedFraction - needle) * Math.min(1, 14 * t.dt);
      if (dialCtx) drawDial(dialCtx, t, needle);

      // Snap rather than damp across a shift: a rev needle drops off a
      // cliff when the clutch goes in, it does not glide down.
      const revJump = Math.abs(t.rpmFrac - revNeedle) > 0.25;
      revNeedle = revJump ? t.rpmFrac : revNeedle + (t.rpmFrac - revNeedle) * Math.min(1, 20 * t.dt);
      if (tachoCtx) drawTacho(tachoCtx, revNeedle);

      if (refs.boost.current) {
        refs.boost.current.style.transform = `scaleX(${t.boostFraction})`;
      }
      setFlag(refs.boostWrap.current, 'boostReady', 'is-ready', t.boostReady);
      setFlag(refs.boostWrap.current, 'boostFiring', 'is-firing', t.boostFiring);

      setText(refs.drift.current, 'drift', t.driftScore.toLocaleString('en-US'));
      setText(refs.combo.current, 'combo', t.driftActive ? `x${t.driftCombo}` : '');
      setFlag(refs.driftWrap.current, 'driftActive', 'is-active', t.driftActive);

      if (refs.warning.current && cache.get('wrongWay') !== t.wrongWay) {
        cache.set('wrongWay', t.wrongWay);
        refs.warning.current.hidden = !t.wrongWay;
      }

      towerKey = syncTower(refs.tower.current, towerRows, towerKey, t.standings);

      const map = refs.minimap.current;
      if (map && mapCtx) {
        if (map.hidden === t.showMinimap) map.hidden = !t.showMinimap;
        mapTimer -= t.dt;
        if (t.showMinimap && mapTimer <= 0) {
          mapTimer = MAP_INTERVAL;
          drawMinimap(mapCtx, t);
        }
      }
    });

    return unsubscribe;
    // The ref bag is stable for the component's lifetime; re-running on
    // it would tear the subscription down every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, visible]);

  return refs;
}

// ── Telemetry shape, as the engine fills it ────────────

interface StandingEntry {
  position: number;
  gap: number;
  vehicle: {
    name: string;
    isPlayer: boolean;
    finished: boolean;
    x: number;
    z: number;
    heading: number;
    paint: { base: number };
  };
}

interface Telemetry {
  active: boolean;
  position: number;
  fieldSize: number;
  lap: number;
  totalLaps: number;
  currentLap: number;
  bestLap: number;
  gapAhead: number | null;
  displaySpeed: number;
  speedFraction: number;
  topSpeedKmh: number;
  gear: string;
  rpm: number;
  rpmFrac: number;
  redline: boolean;
  boostFraction: number;
  boostReady: boolean;
  boostFiring: boolean;
  driftScore: number;
  driftCombo: number;
  driftActive: boolean;
  wrongWay: boolean;
  showMinimap: boolean;
  standings: StandingEntry[];
  circuit: unknown;
  dt: number;
}

const swatch = (packed: number) => `#${packed.toString(16).padStart(6, '0')}`;

// ── Speed dial ─────────────────────────────────────────

/**
 * An instrument rather than a progress arc.
 *
 * What makes a gauge read as a gauge is the things around the needle: a
 * graduated scale with numbers you can judge a position against, a red
 * zone that is visible before you reach it, and a needle with a
 * counterweight tail so the eye can tell at a glance which end is
 * pointing where. The old one had none of those — it was a stroked arc
 * with a line across it.
 */
function drawDial(ctx: CanvasRenderingContext2D, t: Telemetry, needleFrac: number): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const r = w * 0.4;
  const { boostFraction, redline, topSpeedKmh } = t;

  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = 'butt';

  // ── Face, so the scale has something to sit on ──
  const face = ctx.createRadialGradient(cx, cy - r * 0.3, r * 0.08, cx, cy, r * 1.12);
  face.addColorStop(0, 'rgba(22,26,34,0.78)');
  face.addColorStop(1, 'rgba(8,10,14,0.9)');
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.12, 0, Math.PI * 2);
  ctx.fillStyle = face;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.11, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(242,237,227,0.18)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // ── Scale track, with the red zone laid under it ──
  ctx.beginPath();
  ctx.arc(cx, cy, r, DIAL_START, DIAL_END);
  ctx.strokeStyle = 'rgba(242,237,227,0.1)';
  ctx.lineWidth = 9;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r, DIAL_START + DIAL_SWEEP * REDLINE, DIAL_END);
  ctx.strokeStyle = 'rgba(255,77,46,0.5)';
  ctx.lineWidth = 9;
  ctx.stroke();

  if (needleFrac > 0.004) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, DIAL_START, DIAL_START + DIAL_SWEEP * needleFrac);
    ctx.strokeStyle = redline ? '#ff4d2e' : '#f2ede3';
    ctx.lineWidth = 9;
    ctx.stroke();
  }

  // ── Nitro on an inner ring, so both gauges read in one glance ──
  ctx.beginPath();
  ctx.arc(cx, cy, r - 15, DIAL_START, DIAL_START + DIAL_SWEEP * boostFraction);
  ctx.strokeStyle =
    boostFraction >= BOOST.minToFire / BOOST.capacity ? '#35e0a1' : 'rgba(53,224,161,0.35)';
  ctx.lineWidth = 4;
  ctx.stroke();

  // ── Graduations ──
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const totalMinor = (MAJOR_TICKS - 1) * MINOR_PER_MAJOR;

  for (let i = 0; i <= totalMinor; i++) {
    const step = i / totalMinor;
    const angle = DIAL_START + DIAL_SWEEP * step;
    const isMajor = i % MINOR_PER_MAJOR === 0;
    const isRed = step >= REDLINE - 0.0001;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const inner = isMajor ? r - 18 : r - 12;

    ctx.beginPath();
    ctx.lineWidth = isMajor ? 2.4 : 1.1;
    ctx.strokeStyle = isRed
      ? 'rgba(255,110,80,0.95)'
      : `rgba(242,237,227,${isMajor ? 0.78 : 0.38})`;
    ctx.moveTo(cx + cos * inner, cy + sin * inner);
    ctx.lineTo(cx + cos * (r - 6), cy + sin * (r - 6));
    ctx.stroke();

    if (!isMajor) continue;

    // Numbers, rounded to something a driver would actually read.
    const value = Math.round((topSpeedKmh * step) / 10) * 10;
    ctx.font = '700 14px "Barlow Condensed", sans-serif';
    ctx.fillStyle = isRed ? 'rgba(255,120,90,0.95)' : 'rgba(242,237,227,0.72)';
    ctx.fillText(String(value), cx + cos * (r - 33), cy + sin * (r - 33));
  }

  drawNeedle(ctx, cx, cy, r, needleFrac, redline);
}

// ── Tachometer ─────────────────────────────────────────

/**
 * The rev counter. Scaled in thousands, because that is the number a
 * driver shifts on — a tachometer marked 0 to 8000 is asking you to
 * read four digits at 200 km/h.
 *
 * Shares the sweep and the needle shape with the speedometer so the two
 * read as a matched pair, but it is drawn from the rev fraction rather
 * than road speed: it climbs inside a gear and drops when one ends.
 */
function drawTacho(ctx: CanvasRenderingContext2D, frac: number): void {
  const w = ctx.canvas.width;
  const cx = w / 2;
  const cy = ctx.canvas.height / 2;
  const r = w * 0.4;
  const hot = frac > REDLINE_FRACTION;

  ctx.clearRect(0, 0, w, ctx.canvas.height);
  ctx.lineCap = 'butt';

  const face = ctx.createRadialGradient(cx, cy - r * 0.3, r * 0.08, cx, cy, r * 1.12);
  face.addColorStop(0, 'rgba(24,20,22,0.8)');
  face.addColorStop(1, 'rgba(9,8,10,0.92)');
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.12, 0, Math.PI * 2);
  ctx.fillStyle = face;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.11, 0, Math.PI * 2);
  ctx.strokeStyle = hot ? 'rgba(255,77,46,0.55)' : 'rgba(242,237,227,0.18)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r, DIAL_START, DIAL_END);
  ctx.strokeStyle = 'rgba(242,237,227,0.1)';
  ctx.lineWidth = 10;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r, DIAL_START + DIAL_SWEEP * REDLINE_FRACTION, DIAL_END);
  ctx.strokeStyle = 'rgba(255,77,46,0.55)';
  ctx.lineWidth = 10;
  ctx.stroke();

  if (frac > 0.004) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, DIAL_START, DIAL_START + DIAL_SWEEP * frac);
    ctx.strokeStyle = hot ? '#ff4d2e' : '#f5a213';
    ctx.lineWidth = 10;
    ctx.stroke();
  }

  // One numbered tick per thousand revs, four minor ticks between.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const thousands = Math.round(REDLINE_RPM / 1000);
  const totalMinor = thousands * MINOR_PER_MAJOR;

  for (let i = 0; i <= totalMinor; i++) {
    const step = i / totalMinor;
    const angle = DIAL_START + DIAL_SWEEP * step;
    const isMajor = i % MINOR_PER_MAJOR === 0;
    const isRed = step >= REDLINE_FRACTION - 0.0001;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const inner = isMajor ? r - 19 : r - 13;

    ctx.beginPath();
    ctx.lineWidth = isMajor ? 2.6 : 1.2;
    ctx.strokeStyle = isRed
      ? 'rgba(255,110,80,0.95)'
      : `rgba(242,237,227,${isMajor ? 0.8 : 0.38})`;
    ctx.moveTo(cx + cos * inner, cy + sin * inner);
    ctx.lineTo(cx + cos * (r - 6), cy + sin * (r - 6));
    ctx.stroke();

    if (!isMajor) continue;
    ctx.font = '700 17px "Barlow Condensed", sans-serif';
    ctx.fillStyle = isRed ? 'rgba(255,120,90,0.98)' : 'rgba(242,237,227,0.8)';
    ctx.fillText(String(Math.round(step * thousands)), cx + cos * (r - 36), cy + sin * (r - 36));
  }

  drawNeedle(ctx, cx, cy, r, frac, hot);
}

/** The pointer both dials share: tapered blade, counterweight tail. */
function drawNeedle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  frac: number,
  hot: boolean,
): void {
  const angle = DIAL_START + DIAL_SWEEP * frac;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const px = -sin;
  const py = cos;
  const tip = r - 11;
  const halfBase = 4.5;

  ctx.save();
  ctx.shadowColor = hot ? 'rgba(255,77,46,0.9)' : 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = hot ? 14 : 8;
  ctx.beginPath();
  ctx.moveTo(cx + cos * tip, cy + sin * tip);
  ctx.lineTo(cx + px * halfBase, cy + py * halfBase);
  // The counterweight tail: it is what tells the eye which end is which.
  ctx.lineTo(cx - cos * (r * 0.22), cy - sin * (r * 0.22));
  ctx.lineTo(cx - px * halfBase, cy - py * halfBase);
  ctx.closePath();
  ctx.fillStyle = hot ? '#ff4d2e' : '#f2ede3';
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, 8.5, 0, Math.PI * 2);
  ctx.fillStyle = '#0b0e13';
  ctx.fill();
  ctx.strokeStyle = hot ? '#ff4d2e' : 'rgba(242,237,227,0.85)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

// ── Minimap ────────────────────────────────────────────

function drawMinimap(ctx: CanvasRenderingContext2D, t: Telemetry): void {
  drawCircuitMap(ctx, t.circuit, {
    margin: 18,
    ribbonWidth: 8,
    lineWidth: 2,
    showSectors: true,
    plate: 'rgba(11,14,19,0.55)',
    markers: t.standings.map((entry) => ({
      x: entry.vehicle.x,
      z: entry.vehicle.z,
      heading: entry.vehicle.isPlayer ? entry.vehicle.heading : undefined,
      size: entry.vehicle.isPlayer ? 6.5 : 3.4,
      color: entry.vehicle.isPlayer ? '#f2ede3' : swatch(entry.vehicle.paint.base),
      outline: entry.vehicle.isPlayer ? '#0b0e13' : null,
    })),
  });
}

// ── Standings tower ────────────────────────────────────

/**
 * Rebuilds rows only when the field's identity changes, which in
 * practice means once per race. Overtakes are text updates.
 */
function syncTower(
  list: HTMLOListElement | null,
  rows: TowerRow[],
  currentKey: string,
  standings: StandingEntry[],
): string {
  if (!list) return currentKey;

  const key = standings.map((entry) => entry.vehicle.name).join('|');
  if (key !== currentKey || rows.length !== standings.length) {
    list.replaceChildren();
    rows.length = 0;

    for (const entry of standings) {
      const li = document.createElement('li');
      li.className = 'towerrow';

      const pos = document.createElement('span');
      pos.className = 'towerrow__pos';
      const chip = document.createElement('span');
      chip.className = 'towerrow__chip';
      chip.style.background = swatch(entry.vehicle.paint.base);
      const name = document.createElement('span');
      name.className = 'towerrow__name';
      const gap = document.createElement('span');
      gap.className = 'towerrow__gap';

      li.append(pos, chip, name, gap);
      list.append(li);
      rows.push({ li, pos, name, gap });
    }
  }

  standings.forEach((entry, i) => {
    const row = rows[i];
    if (!row) return;
    const position = String(entry.position);
    const name = entry.vehicle.name;
    const gap =
      entry.position === 1 ? 'LEAD' : entry.vehicle.finished ? 'FIN' : formatGap(entry.gap);

    if (row.pos.textContent !== position) row.pos.textContent = position;
    if (row.name.textContent !== name) row.name.textContent = name;
    if (row.gap.textContent !== gap) row.gap.textContent = gap;
    row.li.classList.toggle('is-player', entry.vehicle.isPlayer);
  });

  return key;
}
