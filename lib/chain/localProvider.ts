// ═══════════════════════════════════════════════════════
//  LOCAL PROVIDER — everything on this machine, nothing gated
//
//  The default backend. It keeps full receipts, not just summaries,
//  because the dashboard's verify button needs the original document
//  to re-derive a digest from. A chain provider would keep the same
//  documents in whatever off-chain store it anchors against.
// ═══════════════════════════════════════════════════════
import type {
  ChainProvider,
  Identity,
  LeaderboardEntry,
  ProviderCapabilities,
  RaceReceipt,
  StoredReceipt,
  SubmitOutcome,
} from './types';

const STORAGE_KEY = 'sunset-racing.chain.local.v2';
/** A local cache, not an archive. Oldest receipts fall off the end. */
const MAX_RECEIPTS = 60;

interface LocalStore {
  receipts: StoredReceipt[];
}

const EMPTY: LocalStore = { receipts: [] };

export class LocalProvider implements ChainProvider {
  readonly id = 'local';
  readonly label = 'LOCAL STORAGE';
  readonly capabilities: ProviderCapabilities = {
    ownership: false,
    leaderboard: true,
    identity: false,
    attestation: false,
  };

  async identity(): Promise<Identity> {
    return { id: 'local', label: 'LOCAL PLAYER', kind: 'local' };
  }

  /** No ownership model here, so every car is available. */
  async ownedCarIds(): Promise<string[] | null> {
    return null;
  }

  async submitResult(receipt: RaceReceipt, hash: string | null): Promise<SubmitOutcome> {
    const outcome: SubmitOutcome = { recorded: true, hash };
    const store = this.read();

    const next: LocalStore = {
      receipts: [{ hash, receipt, submittedAt: Date.now(), outcome }, ...store.receipts].slice(
        0,
        MAX_RECEIPTS,
      ),
    };

    this.write(next);
    return outcome;
  }

  async leaderboard(circuitId: string): Promise<LeaderboardEntry[]> {
    return this.read()
      .receipts.filter((stored) => stored.receipt.circuitId === circuitId)
      .map((stored) => toEntry(stored))
      .sort(byBestLap);
  }

  async history(): Promise<StoredReceipt[]> {
    return this.read().receipts;
  }

  // ── Storage ──────────────────────────────────────────

  private read(): LocalStore {
    if (typeof window === 'undefined') return EMPTY;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as LocalStore).receipts)) {
        return parsed as LocalStore;
      }
    } catch {
      // Corrupt or unavailable storage — start clean rather than throw.
    }
    return EMPTY;
  }

  private write(store: LocalStore): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Persistence is a nicety here, never a requirement.
    }
  }
}

function toEntry(stored: StoredReceipt): LeaderboardEntry {
  const { receipt } = stored;
  const player = receipt.entrants.find((entrant) => entrant.isPlayer);
  return {
    hash: stored.hash,
    identity: receipt.identity,
    at: receipt.startedAt,
    laps: receipt.laps,
    difficulty: receipt.difficulty,
    position: player?.position ?? null,
    totalMs: player?.totalMs ?? null,
    bestLapMs: player?.bestLapMs ?? null,
    carId: player?.carId ?? null,
    origin: 'local',
  };
}

/** Unset laps sort last rather than first. */
const byBestLap = (a: LeaderboardEntry, b: LeaderboardEntry): number =>
  (a.bestLapMs ?? Number.POSITIVE_INFINITY) - (b.bestLapMs ?? Number.POSITIVE_INFINITY);
