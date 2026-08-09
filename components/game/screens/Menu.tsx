'use client';

import { formatLapTime } from '@/lib/engine/util.js';
import { getCarById, getCircuitById, QUALITY, WORLD, type DifficultyId } from '@/lib/engine/api';
import { DIFFICULTIES } from '@/lib/engine/api';
import { useHydrated, useProfile } from '@/lib/hooks/useStores';
import type { Screen } from '../GameShell';

export interface MenuProps {
  onNavigate: (screen: Screen) => void;
  onQuickRace: () => void;
}

export function Menu({ onNavigate, onQuickRace }: MenuProps) {
  const profile = useProfile();
  const hydrated = useHydrated();

  const car = getCarById(profile.setup.carId);
  const circuit = getCircuitById(profile.setup.circuitId);
  const difficulty = DIFFICULTIES[profile.setup.difficulty as DifficultyId];
  const best = profile.bestLapFor(profile.setup.circuitId);

  // Records live in localStorage, so they are absent during the server
  // render. Showing placeholders until hydration keeps the markup
  // identical on both passes instead of tripping a mismatch.
  const records = hydrated ? profile.records : null;

  return (
    <section className="screen screen--menu is-active" aria-label="Main menu">
      <div className="menu">
        <header className="menu__head">
          <p className="eyebrow">SEASON 01</p>
          <h1 className="menu__title">
            <span>GT-R</span>
            <span className="menu__title-alt">RACING</span>
          </h1>
        </header>

        <nav className="menu__nav" aria-label="Primary">
          <button type="button" className="navitem" onClick={onQuickRace}>
            <span className="navitem__index">01</span>
            <span className="navitem__label">QUICK RACE</span>
            <span className="navitem__meta">
              {profile.setup.laps} LAPS · {difficulty?.label ?? '—'}
            </span>
          </button>

          <button
            type="button"
            className="navitem navitem--feature"
            onClick={() => onNavigate('world')}
          >
            <span className="navitem__index">02</span>
            <span className="navitem__label">OPEN WORLD</span>
            <span className="navitem__meta">
              MARMARA · {WORLD.areaKm2.toLocaleString('en-US')} km²
            </span>
          </button>

          <button type="button" className="navitem" onClick={() => onNavigate('garage')}>
            <span className="navitem__index">03</span>
            <span className="navitem__label">GARAGE</span>
            <span className="navitem__meta">{car.name}</span>
          </button>

          <button type="button" className="navitem" onClick={() => onNavigate('setup')}>
            <span className="navitem__index">04</span>
            <span className="navitem__label">RACE SETUP</span>
            <span className="navitem__meta">{circuit.name}</span>
          </button>

          <button type="button" className="navitem" onClick={() => onNavigate('settings')}>
            <span className="navitem__index">05</span>
            <span className="navitem__label">SETTINGS</span>
            <span className="navitem__meta">{QUALITY[profile.settings.quality].label}</span>
          </button>
        </nav>

        <footer className="menu__foot">
          <dl className="statstrip">
            <div>
              <dt>RACES</dt>
              <dd>{records?.races ?? '—'}</dd>
            </div>
            <div>
              <dt>WINS</dt>
              <dd>{records?.wins ?? '—'}</dd>
            </div>
            <div>
              <dt>PODIUMS</dt>
              <dd>{records?.podiums ?? '—'}</dd>
            </div>
            <div>
              <dt>BEST LAP HERE</dt>
              <dd>{hydrated && best ? formatLapTime(best.time) : '—'}</dd>
            </div>
            <div>
              <dt>BEST DRIFT</dt>
              <dd>{records ? records.bestDrift.toLocaleString('en-US') : '—'}</dd>
            </div>
          </dl>

          <p className="menu__hint">
            <kbd>W A S D</kbd> drive · <kbd>SPACE</kbd> handbrake · <kbd>SHIFT</kbd> nitro ·{' '}
            <kbd>C</kbd> camera · <kbd>ESC</kbd> pause
          </p>
        </footer>
      </div>
    </section>
  );
}
