// ═══════════════════════════════════════════════════════
//  PLATFORM — the one object the rest of the app talks to
//
//  Wraps whichever ChainProvider is configured, caches the answers
//  that the UI reads synchronously (identity, ownership), and makes
//  every remote call non-fatal. A backend being down must degrade the
//  dashboard, never block the results screen or the garage.
// ═══════════════════════════════════════════════════════
import { LocalProvider } from './localProvider';
import type {
  ChainProvider,
  Identity,
  LeaderboardEntry,
  ProviderCapabilities,
  RaceReceipt,
  StoredReceipt,
  SubmitOutcome,
} from './types';

const ANONYMOUS: Identity = { id: 'local', label: 'LOCAL PLAYER', kind: 'local' };

export type PlatformListener = (platform: Platform) => void;

export class Platform {
  readonly provider: ChainProvider;

  private currentIdentity: Identity = ANONYMOUS;
  private owned: string[] | null = null;
  private listeners = new Set<PlatformListener>();
  private version = 0;
  private ready = false;

  constructor(provider: ChainProvider = new LocalProvider()) {
    this.provider = provider;
  }

  get capabilities(): ProviderCapabilities {
    return this.provider.capabilities;
  }

  get identity(): Identity {
    return this.currentIdentity;
  }

  get ownedCarIds(): string[] | null {
    return this.owned;
  }

  get isReady(): boolean {
    return this.ready;
  }

  subscribe = (fn: PlatformListener | (() => void)): (() => void) => {
    const listener = fn as PlatformListener;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = (): number => this.version;

  private emit(): void {
    this.version += 1;
    for (const fn of this.listeners) fn(this);
  }

  /** Resolve identity and ownership. Safe to call more than once. */
  async init(): Promise<Identity> {
    try {
      this.currentIdentity = await this.provider.identity();
      this.owned = await this.provider.ownedCarIds();
    } catch (error) {
      console.warn('Platform init failed; running anonymous.', error);
      this.currentIdentity = ANONYMOUS;
      this.owned = null;
    }
    this.ready = true;
    this.emit();
    return this.currentIdentity;
  }

  /**
   * Ask the provider to establish a stronger identity — signing in,
   * connecting a wallet, whatever that means for it. The handshake and
   * any key material stay entirely inside the provider.
   */
  async connect(): Promise<Identity> {
    if (!this.provider.connect) return this.currentIdentity;
    this.currentIdentity = await this.provider.connect();
    this.owned = await this.provider.ownedCarIds();
    this.emit();
    return this.currentIdentity;
  }

  async disconnect(): Promise<void> {
    await this.provider.disconnect?.();
    this.currentIdentity = await this.provider.identity();
    this.owned = await this.provider.ownedCarIds();
    this.emit();
  }

  /** A null ownership list means no gating — every car is available. */
  isCarUnlocked(carId: string): boolean {
    if (!this.owned) return true;
    return this.owned.includes(carId);
  }

  /**
   * Hand a finished race to the provider. Failures are swallowed on
   * purpose: the results screen must never wait on, or break because
   * of, a backend.
   */
  async submitResult(receipt: RaceReceipt, hash: string | null): Promise<SubmitOutcome> {
    try {
      const outcome = await this.provider.submitResult(receipt, hash);
      this.emit();
      return outcome;
    } catch (error) {
      console.warn('Race result was not recorded remotely:', error);
      return { recorded: false, hash, error: String(error) };
    }
  }

  async leaderboard(circuitId: string): Promise<LeaderboardEntry[]> {
    try {
      return await this.provider.leaderboard(circuitId);
    } catch (error) {
      console.warn('Leaderboard unavailable:', error);
      return [];
    }
  }

  async history(): Promise<StoredReceipt[]> {
    try {
      return (await this.provider.history?.()) ?? [];
    } catch (error) {
      console.warn('Receipt history unavailable:', error);
      return [];
    }
  }
}

/** One platform per tab, shared by the game and the dashboard. */
let singleton: Platform | null = null;

export function getPlatform(): Platform {
  if (!singleton) singleton = new Platform(new LocalProvider());
  return singleton;
}
