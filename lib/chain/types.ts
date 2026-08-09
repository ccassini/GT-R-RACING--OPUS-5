// ═══════════════════════════════════════════════════════
//  CHAIN CONTRACT — the seam between the game and any backend
//
//  The game never talks to a chain, a wallet or a server directly.
//  It asks a provider five questions and nothing else:
//
//    who is playing            → identity()
//    prove it                  → connect()      (optional)
//    what do they own          → ownedCarIds()
//    record this race          → submitResult()
//    what are the best times   → leaderboard()
//
//  LocalProvider answers all of them from localStorage and is what
//  ships today. An EVM provider implements the same interface and gets
//  handed to `new Platform(provider)` — no gameplay, rendering, UI or
//  dashboard code changes.
//
//  Deliberately outside this interface: private keys, seed phrases and
//  transaction signing. A provider may delegate those to an audited
//  wallet library, but no key material ever crosses this boundary and
//  no module in this repository should ever hold one.
// ═══════════════════════════════════════════════════════

export type IdentityKind = 'local' | 'remote';

export interface Identity {
  /** Stable handle: a chain address, a user id, or the literal 'local'. */
  id: string;
  /** What to render. For an address, the truncated form. */
  label: string;
  kind: IdentityKind;
  /** Present only when the provider is chain-backed. */
  chainId?: number;
}

export interface ProviderCapabilities {
  /** Cars are gated by on-chain ownership. */
  ownership: boolean;
  /** Results from other players are readable. */
  leaderboard: boolean;
  /** Identity can be strengthened via connect(). */
  identity: boolean;
  /** submitResult() reaches something durable rather than this browser. */
  attestation: boolean;
}

/** One entrant's line in a race receipt. Times are integer milliseconds. */
export interface ReceiptEntrant {
  position: number;
  name: string;
  carId: string;
  paintId: string;
  isPlayer: boolean;
  finished: boolean;
  totalMs: number | null;
  bestLapMs: number | null;
  lapMs: (number | null)[];
  driftScore: number;
}

/**
 * The canonical, deterministic record of one race. This is the unit an
 * on-chain integration anchors: identical races serialise byte for
 * byte, so the digest can be published as an attestation payload
 * without the chain needing to understand the game at all.
 */
export interface RaceReceipt {
  version: number;
  circuitId: string;
  laps: number;
  difficulty: string;
  identity: string;
  /** Epoch milliseconds. */
  startedAt: number;
  entrants: ReceiptEntrant[];
}

export interface SubmitOutcome {
  recorded: boolean;
  hash: string | null;
  /** Set by chain providers once the attestation lands. */
  reference?: string;
  error?: string;
}

/** A row as the dashboard wants to show it. */
export interface LeaderboardEntry {
  hash: string | null;
  identity: string;
  at: number;
  laps: number;
  difficulty: string;
  position: number | null;
  totalMs: number | null;
  bestLapMs: number | null;
  carId: string | null;
  /** Where the record lives: this browser, or something durable. */
  origin: 'local' | 'remote';
}

export interface ChainProvider {
  readonly id: string;
  readonly label: string;
  readonly capabilities: ProviderCapabilities;

  identity(): Promise<Identity>;
  /** Wallet or sign-in handshake. Absent on providers that have no notion of it. */
  connect?(): Promise<Identity>;
  disconnect?(): Promise<void>;
  /** `null` means no gating at all — every car is available. */
  ownedCarIds(): Promise<string[] | null>;
  submitResult(receipt: RaceReceipt, hash: string | null): Promise<SubmitOutcome>;
  leaderboard(circuitId: string): Promise<LeaderboardEntry[]>;
  /** Every receipt this provider can still produce, newest first. */
  history?(): Promise<StoredReceipt[]>;
}

export interface StoredReceipt {
  hash: string | null;
  receipt: RaceReceipt;
  submittedAt: number;
  outcome: SubmitOutcome;
}
