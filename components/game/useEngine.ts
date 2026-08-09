'use client';

// ═══════════════════════════════════════════════════════
//  ENGINE LIFECYCLE
//
//  One WebGL context for the life of the page. The engine module is
//  imported dynamically so Three.js and eight thousand lines of world
//  generation stay out of the first-load bundle entirely — the menu
//  paints before any of it arrives.
//
//  Strict Mode double-invokes effects in development. The guard here is
//  a generation counter rather than a ref flag: if the effect is torn
//  down while boot() is still awaiting a frame, the resolved engine is
//  disposed immediately instead of being left running headless.
// ═══════════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react';
import { getGameState } from '@/lib/state';
import { getPlatform } from '@/lib/chain/platform';
import type { GameEngine } from '@/lib/engine/engine';

export interface BootProgress {
  fraction: number;
  status: string;
}

export interface EngineHandle {
  engine: GameEngine | null;
  progress: BootProgress;
  error: string | null;
}

export function useEngine(canvasRef: React.RefObject<HTMLCanvasElement | null>): EngineHandle {
  const [engine, setEngine] = useState<GameEngine | null>(null);
  const [progress, setProgress] = useState<BootProgress>({
    fraction: 0.02,
    status: 'Building the circuit…',
  });
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const mine = ++generation.current;
    let created: GameEngine | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const { GameEngine: Engine } = await import('@/lib/engine/engine');
        if (cancelled || generation.current !== mine) return;

        created = new Engine({
          canvas,
          state: getGameState(),
          platform: getPlatform(),
        });

        await created.boot((fraction: number, status: string) => {
          if (!cancelled) setProgress({ fraction, status });
        });

        if (cancelled || generation.current !== mine) {
          created.dispose();
          return;
        }
        setEngine(created);
      } catch (cause) {
        if (cancelled) return;
        console.error('Failed to start GT-R Racing', cause);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      cancelled = true;
      created?.dispose();
      setEngine(null);
    };
  }, [canvasRef]);

  return { engine, progress, error };
}

/**
 * Subscribe to a discrete engine event for the lifetime of a component.
 * The handler is held in a ref so a re-render never re-subscribes —
 * `frame` fires sixty times a second and churning listeners there would
 * be its own performance problem.
 */
export function useEngineEvent<T>(
  engine: GameEngine | null,
  event: string,
  handler: (payload: T) => void,
): void {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!engine) return;
    return engine.events.on(event, (payload: T) => ref.current(payload));
  }, [engine, event]);
}
