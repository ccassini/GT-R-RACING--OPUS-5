'use client';

// ═══════════════════════════════════════════════════════
//  CIRCUIT MAP — the setup screen's card, and only that
//
//  The in-race minimap draws through the same helper but from the
//  render loop, never from React. This component is for the static
//  case: pick a circuit, see its shape.
//
//  It measures its own box rather than taking a pixel width. A fixed
//  460px canvas in a column that tops out at 340px simply hangs off the
//  side of the panel, and the aspect ratio has to survive every
//  breakpoint the setup grid goes through.
//
//  Circuits are heavy to construct — a spline plus a dense sample table
//  — so the builder is imported lazily and every load is cancellable.
//  Clicking quickly through five cards must not leave five builds in
//  flight racing to paint into the same canvas.
// ═══════════════════════════════════════════════════════
import { useEffect, useRef } from 'react';

export interface CircuitMapProps {
  circuitId: string;
  /** Width divided by height. The default suits a portrait-ish card. */
  aspect?: number;
  className?: string;
}

export function CircuitMap({
  circuitId,
  aspect = 1.55,
  className = 'mapcard__canvas',
}: CircuitMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let circuit: unknown = null;
    let draw: ((width: number, height: number) => void) | null = null;

    void (async () => {
      const [{ loadCircuit }, { drawCircuitMap }] = await Promise.all([
        import('@/lib/engine/world/track.js'),
        import('@/lib/engine/trackMap.js'),
      ]);
      if (cancelled) return;

      circuit = loadCircuit(circuitId);
      const ctx = canvas.getContext('2d');
      if (!ctx || cancelled) return;

      draw = (width, height) => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        drawCircuitMap(ctx, circuit, {
          margin: 24 * dpr,
          lineWidth: 2.6 * dpr,
          ribbonWidth: 12 * dpr,
          showSectors: true,
        });
      };

      const box = canvas.getBoundingClientRect();
      draw(box.width, box.width / aspect);
    })();

    const observer = new ResizeObserver(([entry]) => {
      if (!draw || cancelled) return;
      const width = entry.contentRect.width;
      if (width > 0) draw(width, width / aspect);
    });
    observer.observe(canvas);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [circuitId, aspect]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', aspectRatio: String(aspect), display: 'block' }}
      role="img"
      aria-label="Circuit layout"
    />
  );
}
