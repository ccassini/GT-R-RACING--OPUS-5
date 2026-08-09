'use client';

// ═══════════════════════════════════════════════════════
//  CITY MAP — the open world, drawn from the open world
//
//  There is no map image. This component builds the same generator the
//  engine drives on and asks it the same questions, so the coastline on
//  screen is the coastline you will hit. The generator is pure
//  arithmetic over a seed — constructing one costs a handful of
//  closures — which is why a React component can afford to own an
//  entire metropolis just to draw a thumbnail of it.
//
//  Rasterising is the expensive half, so resolution is a prop: a
//  4,000-pixel wall map and a 96-pixel minimap run the same code at
//  very different budgets.
// ═══════════════════════════════════════════════════════
import { useEffect, useRef } from 'react';

export interface CityMapPlayer {
  x: number;
  z: number;
  heading: number;
}

export interface CityMapProps {
  seed: number;
  centreX: number;
  centreZ: number;
  /** World metres across the canvas width. */
  span: number;
  /** World heading that points up. PI is north-up; pass the car's heading for car-up. */
  rotation?: number;
  aspect?: number;
  /** Ground raster resolution across the width. Higher costs real time. */
  samples?: number;
  streets?: boolean;
  relief?: boolean;
  labels?: boolean;
  places?: unknown[];
  player?: CityMapPlayer | null;
  className?: string;
  ariaLabel?: string;
  onPick?: (x: number, z: number) => void;
}

export function CityMap({
  seed,
  centreX,
  centreZ,
  span,
  rotation = Math.PI,
  aspect = 1.35,
  samples = 128,
  streets = false,
  relief = false,
  labels = false,
  places = [],
  player = null,
  className = 'citymap__canvas',
  ariaLabel = 'City map',
  onPick,
}: CityMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let draw: ((width: number) => void) | null = null;

    void (async () => {
      const [{ createCityMap }, { drawCityMap }] = await Promise.all([
        import('@/lib/engine/world/city/cityMap.js'),
        import('@/lib/engine/world/city/cityCartography.js'),
      ]);
      if (cancelled) return;

      const map = createCityMap(seed);
      const ctx = canvas.getContext('2d');
      if (!ctx || cancelled) return;

      draw = (width) => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const height = width / aspect;
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        drawCityMap(ctx, map, {
          width: canvas.width,
          height: canvas.height,
          centreX,
          centreZ,
          span,
          rotation,
          samples,
          streets,
          relief,
          labels,
          places,
          player: player ?? undefined,
        });
      };

      const box = canvas.getBoundingClientRect();
      if (box.width > 0) draw(box.width);
    })();

    const observer = new ResizeObserver(([entry]) => {
      if (!draw || cancelled) return;
      if (entry.contentRect.width > 0) draw(entry.contentRect.width);
    });
    observer.observe(canvas);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [seed, centreX, centreZ, span, rotation, aspect, samples, streets, relief, labels, places, player]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', aspectRatio: String(aspect), display: 'block' }}
      role="img"
      aria-label={ariaLabel}
      onClick={
        onPick
          ? (event) => {
              const box = event.currentTarget.getBoundingClientRect();
              // Screen to world, matching the projection in the cartographer.
              const scale = box.width / span;
              const u = (event.clientX - box.left - box.width / 2) / scale;
              const v = -(event.clientY - box.top - box.height / 2) / scale;
              const cos = Math.cos(rotation);
              const sin = Math.sin(rotation);
              onPick(centreX - cos * u - sin * v, centreZ + sin * u - cos * v);
            }
          : undefined
      }
    />
  );
}
