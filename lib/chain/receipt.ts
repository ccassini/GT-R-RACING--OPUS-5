// ═══════════════════════════════════════════════════════
//  RECEIPTS — deterministic race records and their digests
//
//  Two properties matter and both are tested by the dashboard's verify
//  button:
//
//    determinism — the same race always serialises to the same bytes,
//                  regardless of key insertion order or float
//                  formatting, so the digest is reproducible anywhere.
//    independence — verify() re-derives the hash from the stored
//                  document rather than trusting the stored hash, so a
//                  tampered receipt fails even though its hash field
//                  still "matches itself".
//
//  Nothing here touches keys, wallets or transactions. It only produces
//  the document those things would sign.
// ═══════════════════════════════════════════════════════
import type { RaceReceipt, ReceiptEntrant } from './types';

export const RECEIPT_VERSION = 1;

/**
 * Stable stringify: keys sorted, floats pinned to six decimals.
 * Float formatting is the usual source of cross-platform hash drift,
 * which is why durations are integers before they ever get here.
 */
export function canonicalise(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalise(record[k])}`).join(',')}}`;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'null';
    return String(Number.isInteger(value) ? value : Number(value.toFixed(6)));
  }

  return JSON.stringify(value ?? null);
}

const ms = (seconds: number | undefined): number | null =>
  Number.isFinite(seconds) ? Math.round((seconds as number) * 1000) : null;

/** Shape the race director hands over. Loose on purpose — it is JS. */
interface RaceResultEntry {
  position: number;
  name: string;
  car: { id: string };
  paint: { id: string };
  vehicle: unknown;
  isPlayer?: boolean;
  finished?: boolean;
  time?: number;
  bestLap?: number;
  driftScore?: number;
}

export interface BuildReceiptInput {
  circuitId: string;
  laps: number;
  difficulty: string;
  identity: string;
  startedAt: number;
  results: RaceResultEntry[];
  timingFor?: (vehicle: unknown) => { laps: number[] } | undefined;
}

export function buildRaceReceipt(input: BuildReceiptInput): RaceReceipt {
  const entrants: ReceiptEntrant[] = input.results.map((entry) => {
    const timing = input.timingFor?.(entry.vehicle);
    return {
      position: entry.position,
      name: entry.name,
      carId: entry.car.id,
      paintId: entry.paint.id,
      isPlayer: !!entry.isPlayer,
      finished: !!entry.finished,
      totalMs: ms(entry.time),
      bestLapMs: ms(entry.bestLap),
      lapMs: (timing?.laps ?? []).map(ms),
      driftScore: Math.round(entry.driftScore ?? 0),
    };
  });

  return {
    version: RECEIPT_VERSION,
    circuitId: input.circuitId,
    laps: input.laps,
    difficulty: input.difficulty,
    identity: input.identity,
    startedAt: input.startedAt,
    // Already ordered by finishing position, which is deterministic.
    entrants,
  };
}

/**
 * SHA-256 of the canonical form, lowercase hex.
 *
 * Returns null where SubtleCrypto is unavailable — an insecure origin,
 * typically. Callers must treat that as "unverified", never as a
 * failure, or the game becomes unplayable over plain http.
 */
export async function hashReceipt(receipt: RaceReceipt): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;

  const bytes = new TextEncoder().encode(canonicalise(receipt));
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type VerifyStatus = 'valid' | 'mismatch' | 'unhashed' | 'unavailable';

export interface VerifyResult {
  status: VerifyStatus;
  expected: string | null;
  actual: string | null;
}

/**
 * Re-derive the digest from the document and compare it to the one
 * recorded alongside it. This is the whole point of a canonical form:
 * anybody holding the receipt can run this and needs to trust nothing.
 */
export async function verifyReceipt(
  receipt: RaceReceipt,
  claimed: string | null,
): Promise<VerifyResult> {
  if (!globalThis.crypto?.subtle) {
    return { status: 'unavailable', expected: claimed, actual: null };
  }
  if (!claimed) {
    return { status: 'unhashed', expected: null, actual: await hashReceipt(receipt) };
  }

  const actual = await hashReceipt(receipt);
  return {
    status: actual === claimed ? 'valid' : 'mismatch',
    expected: claimed,
    actual,
  };
}

/** `a1b2c3…9f8e7d` — enough to eyeball, short enough for a table cell. */
export const shortHash = (hash: string | null | undefined): string =>
  hash ? `${hash.slice(0, 6)}…${hash.slice(-6)}` : '—';

/** `1:23.456`, the way a timing screen writes it. */
export function formatMs(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const total = value / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return minutes > 0
    ? `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`
    : seconds.toFixed(3);
}
