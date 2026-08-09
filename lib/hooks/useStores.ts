'use client';

// ═══════════════════════════════════════════════════════
//  STORE HOOKS
//
//  The profile and the platform are plain observable objects that long
//  predate React and are also read by the engine. useSyncExternalStore
//  is exactly the right adapter for that: no context provider, no
//  duplicated state, and no tearing when the engine mutates a record
//  mid-render.
//
//  Both stores expose a monotonic version number as their snapshot.
//  Returning the object itself would be a new reference only when the
//  slice changed, which is subtler than it looks — a counter is
//  obviously correct and cheap to compare.
// ═══════════════════════════════════════════════════════
import { useCallback, useSyncExternalStore } from 'react';
import { getGameState, type GameState } from '../state';
import { getPlatform, type Platform } from '../chain/platform';

/** Server snapshot: constant, so SSR renders the default profile once. */
const SERVER_VERSION = () => 0;

export function useProfile(): GameState {
  const state = getGameState();
  useSyncExternalStore(state.subscribe, state.getVersion, SERVER_VERSION);
  return state;
}

export function usePlatform(): Platform {
  const platform = getPlatform();
  useSyncExternalStore(platform.subscribe, platform.getVersion, SERVER_VERSION);
  return platform;
}

/**
 * Guards anything that must not render until the client has hydrated —
 * localStorage-backed values, mainly. Without it, records read as zero
 * on the server and React reports a hydration mismatch on every load.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    useCallback(() => () => {}, []),
    () => true,
    () => false,
  );
}
