import { GameShell } from '@/components/game/GameShell';

/**
 * GameShell is a client component, so this prerenders to its initial
 * state — the loading screen — and the engine attaches on mount. The
 * heavy half (Three.js, world generation) is imported dynamically
 * inside useEngine and never reaches the first-load bundle.
 */
export default function GamePage() {
  return <GameShell />;
}
