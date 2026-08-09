'use client';

import {
  CIRCUITS,
  DIFFICULTIES,
  DIFFICULTY_IDS,
  LAP_OPTIONS,
  getCircuitById,
  type DifficultyId,
} from '@/lib/engine/api';
import { formatLapTime } from '@/lib/engine/util.js';
import { OptionSet } from '@/components/ui/controls';
import { CircuitMap } from '../CircuitMap';
import { useHydrated, useProfile } from '@/lib/hooks/useStores';

export interface SetupProps {
  onCircuitChange: (circuitId: string) => void;
  onStart: () => void;
  onBack: () => void;
}

export function Setup({ onCircuitChange, onStart, onBack }: SetupProps) {
  const profile = useProfile();
  const hydrated = useHydrated();

  const circuit = getCircuitById(profile.setup.circuitId);
  const best = profile.bestLapFor(profile.setup.circuitId);

  return (
    <section className="screen screen--setup is-active" aria-label="Race setup">
      <div className="setup">
        <header className="panel__head">
          <p className="eyebrow">RACE SETUP</p>
          <h2 className="display">{circuit.name}</h2>
          <p className="blurb">{circuit.blurb}</p>
        </header>

        <div className="setup__body">
          <div className="setup__scroll">
            <ul className="setup__circuits">
              {CIRCUITS.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className={`trackcard${entry.id === circuit.id ? ' is-selected' : ''}`}
                    aria-pressed={entry.id === circuit.id}
                    onClick={() => onCircuitChange(entry.id)}
                  >
                    <span className="trackcard__top">
                      <span className="trackcard__name">{entry.name}</span>
                      <span className="trackcard__grade">{entry.environment}</span>
                    </span>
                    <span className="trackcard__meta">{entry.location}</span>
                    <span className="trackcard__blurb">{entry.blurb}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <aside className="setup__side">
            <div className="mapcard">
              <CircuitMap circuitId={circuit.id} />
              <p className="mapcard__meta">
                <span className="mapcard__length">{circuit.location}</span>
                <span className="numeric">
                  BEST {hydrated && best ? formatLapTime(best.time) : '—'}
                </span>
              </p>
            </div>

            <OptionSet
              legend="LAPS"
              value={profile.setup.laps}
              options={LAP_OPTIONS.map((laps) => ({ value: laps, label: String(laps) }))}
              onChange={(laps) => profile.updateSetup({ laps })}
            />

            <OptionSet
              legend="DIFFICULTY"
              value={profile.setup.difficulty}
              options={DIFFICULTY_IDS.map((id) => ({
                value: id,
                label: DIFFICULTIES[id].label,
              }))}
              onChange={(difficulty: DifficultyId) => profile.updateSetup({ difficulty })}
            />

            <p className="hint">{DIFFICULTIES[profile.setup.difficulty].blurb}</p>

            <button type="button" className="btn btn--primary btn--block" onClick={onStart}>
              START RACE
            </button>
          </aside>
        </div>

        <button type="button" className="btn btn--ghost" onClick={onBack}>
          BACK
        </button>
      </div>
    </section>
  );
}
