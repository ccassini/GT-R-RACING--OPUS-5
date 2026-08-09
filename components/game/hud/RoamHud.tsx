'use client';

// ═══════════════════════════════════════════════════════
//  ROAM HUD — a driving instrument, not a race instrument
//
//  There is no position, no lap and no gap out here, so none of that is
//  on screen. What replaces it is the only question free roam actually
//  raises: where am I? Hence a district name in the corner, a compass,
//  a kilometre grid reference and a map that agrees with the road.
//
//  React declares this once. useRoamHud writes into it from the frame
//  event. See the header of that file for why.
// ═══════════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react';
import type { GameEngine } from '@/lib/engine/engine';
import { useEngineEvent } from '../useEngine';
import { useRoamHud } from './useRoamHud';
import type { RaceMessage } from './Hud';

export interface RoamHudProps {
  engine: GameEngine | null;
  visible: boolean;
}

export function RoamHud({ engine, visible }: RoamHudProps) {
  const refs = useRoamHud(engine, visible);
  const [message, setMessage] = useState<RaceMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEngineEvent<RaceMessage>(engine, 'message', (payload) => {
    clearTimeout(timer.current);
    if (!payload.text) {
      setMessage(null);
      return;
    }
    setMessage(payload);
    timer.current = setTimeout(() => setMessage(null), payload.duration * 1000);
  });

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="roamhud" hidden={!visible} aria-live="off">
      <div className="roamhud__place">
        <p className="roamhud__district" ref={refs.district}>
          —
        </p>
        <p className="roamhud__label" ref={refs.districtLabel} />
        <p className="roamhud__landmark" ref={refs.place} hidden />
      </div>

      <div className="roamhud__centre">
        {message ? (
          <>
            <p className="bigmsg" data-tone={message.tone || undefined}>
              {message.text}
            </p>
            {message.sub ? <p className="submsg">{message.sub}</p> : null}
          </>
        ) : null}
        <p className="roamhud__status" ref={refs.status} hidden />
      </div>

      <div className="roamhud__map">
        <canvas
          className="roamhud__minimap"
          width={220}
          height={220}
          ref={refs.minimap}
          role="img"
          aria-label="Local map"
        />
        <div className="roamhud__bearing">
          <span className="roamhud__compass" ref={refs.compass}>
            N
          </span>
          <span className="numeric roamhud__coords" ref={refs.coords}>
            +0.0 · +0.0
          </span>
        </div>
      </div>

      <div className="roamhud__drive">
        <div className="roamspeed">
          <span className="roamspeed__value numeric" ref={refs.speed}>
            0
          </span>
          <span className="roamspeed__unit">KM/H</span>
          <span className="roamspeed__gear numeric" ref={refs.gear}>
            N
          </span>
        </div>

        <div className="roamboost" ref={refs.boost} data-state="charging">
          <span className="roamboost__label">NITRO</span>
          <span className="roamboost__track" />
        </div>

        <dl className="roamtrip">
          <div>
            <dt>TRIP</dt>
            <dd className="numeric" ref={refs.distance}>
              0.0 km
            </dd>
          </div>
          <div>
            <dt>TOP</dt>
            <dd className="numeric">
              <span ref={refs.best}>0</span> km/h
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
