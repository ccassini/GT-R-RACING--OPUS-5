'use client';

// ═══════════════════════════════════════════════════════
//  HUD — React renders it once, the engine drives it every frame
//
//  This is the one place in the app where React deliberately gets out
//  of the way. Speed, lap time, gap and eight other fields change sixty
//  times a second; routing that through setState would mean sixty
//  reconciliations and sixty commits per second to update text nodes
//  that React would have to diff its way back to anyway.
//
//  So React owns the structure — it declares the elements, the classes
//  and the accessibility, exactly once — and useHudDriver writes into
//  those nodes from the engine's frame event. Every write is guarded by
//  a cached previous value, so a steady 200 km/h touches the DOM zero
//  times.
//
//  Discrete state (the race message, whether the HUD is on screen at
//  all) stays in React, because it changes a few times per race.
// ═══════════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react';
import type { GameEngine } from '@/lib/engine/engine';
import { useEngineEvent } from '../useEngine';
import { useHudDriver } from './useHudDriver';

export interface RaceMessage {
  text: string;
  sub: string;
  tone: string;
  duration: number;
}

export interface HudProps {
  engine: GameEngine | null;
  visible: boolean;
}

export function Hud({ engine, visible }: HudProps) {
  const refs = useHudDriver(engine, visible);
  const [message, setMessage] = useState<RaceMessage | null>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEngineEvent<RaceMessage>(engine, 'message', (payload) => {
    clearTimeout(messageTimer.current);
    if (!payload.text) {
      setMessage(null);
      return;
    }
    setMessage(payload);
    messageTimer.current = setTimeout(() => setMessage(null), payload.duration * 1000);
  });

  useEffect(() => () => clearTimeout(messageTimer.current), []);

  return (
    <div className="hud" data-hud hidden={!visible} aria-live="off">
      <div className="hud__topleft">
        <div className="pos">
          <span className="pos__value" ref={refs.position}>
            1
          </span>
          <span className="pos__total" ref={refs.field}>
            /6
          </span>
        </div>
        <div className="lap">
          <span className="hud__label">LAP</span>
          <span ref={refs.lap}>1</span>
          <span ref={refs.lapTotal}>/3</span>
        </div>
      </div>

      <div className="hud__topcenter">
        <dl className="timing">
          <div>
            <dt className="hud__label">CURRENT</dt>
            <dd className="numeric" ref={refs.current}>
              --:--.---
            </dd>
          </div>
          <div>
            <dt className="hud__label">BEST</dt>
            <dd className="numeric" ref={refs.best}>
              --:--.---
            </dd>
          </div>
          <div>
            <dt className="hud__label">GAP</dt>
            <dd className="numeric" ref={refs.gap}>
              LEAD
            </dd>
          </div>
        </dl>
      </div>

      <div className="hud__topright">
        <ol className="tower" ref={refs.tower} />
      </div>

      <div className="hud__center">
        {message ? (
          <>
            <p className="bigmsg" data-tone={message.tone || undefined}>
              {message.text}
            </p>
            {message.sub ? <p className="submsg">{message.sub}</p> : null}
          </>
        ) : null}
        <p className="hud__warning" ref={refs.warning} hidden>
          WRONG WAY
        </p>
      </div>

      <div className="hud__bottomleft">
        {/* Road speed large, revs beside it. The gear sits on the big
            dial because that is where the eye already is. */}
        <div className="speedo" ref={refs.speedo}>
          <canvas className="speedo__dial" width={340} height={340} ref={refs.dial} />
          <div className="speedo__readout">
            <span className="speedo__value numeric" ref={refs.speed}>
              0
            </span>
            <span className="speedo__unit">KM/H</span>
          </div>
          <span className="speedo__gear numeric" ref={refs.gear}>
            N
          </span>
        </div>

        <div className="tacho" ref={refs.tacho}>
          <canvas
            className="tacho__dial"
            width={300}
            height={300}
            ref={refs.tachoDial}
            role="img"
            aria-label="Rev counter"
          />
          <span className="tacho__unit">×1000 RPM</span>
        </div>

        <div className="gauges">
          <div className="drift" ref={refs.driftWrap}>
            <span className="hud__label">DRIFT</span>
            <span className="drift__score numeric" ref={refs.drift}>
              0
            </span>
            <span className="drift__combo" ref={refs.combo} />
          </div>
          <div className="boost" ref={refs.boostWrap}>
            <span className="hud__label">NITRO</span>
            <span className="boost__track">
              <span className="boost__fill" ref={refs.boost} />
            </span>
          </div>
        </div>
      </div>

      <div className="hud__bottomright">
        <canvas className="minimap" width={220} height={220} ref={refs.minimap} />
      </div>
    </div>
  );
}
