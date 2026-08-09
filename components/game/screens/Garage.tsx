'use client';

import { CARS, cssColor, getCarById, getPaint } from '@/lib/engine/api';
import { StatBar } from '@/components/ui/controls';
import { usePlatform, useProfile } from '@/lib/hooks/useStores';

export interface GarageProps {
  onSelect: (carId: string, paintId: string) => void;
  onConfirm: () => void;
  onBack: () => void;
}

export function Garage({ onSelect, onConfirm, onBack }: GarageProps) {
  const profile = useProfile();
  const platform = usePlatform();

  const car = getCarById(profile.setup.carId);
  const paint = getPaint(car, profile.setup.paintId);
  const locked = !platform.isCarUnlocked(car.id);

  return (
    <section className="screen screen--garage is-active" aria-label="Garage">
      <div className="garage">
        <header className="panel__head">
          <p className="eyebrow">GARAGE · {CARS.length} MACHINES</p>
          <h2 className="display">{car.name}</h2>
          <p className="blurb">{car.blurb}</p>
        </header>

        <div className="garage__body">
          <ul className="garage__list">
            {CARS.map((entry) => {
              const unlocked = platform.isCarUnlocked(entry.id);
              const selected = entry.id === car.id;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    className={`carrow${selected ? ' is-selected' : ''}${unlocked ? '' : ' is-locked'}`}
                    aria-pressed={selected}
                    onClick={() => onSelect(entry.id, entry.paints[0].id)}
                  >
                    <span
                      className="carrow__bar"
                      style={{ background: cssColor(entry.paints[0].base) }}
                    />
                    <span className="carrow__text">
                      <span className="carrow__name">{entry.name}</span>
                      <span className="carrow__class">
                        {entry.class} · {entry.maker}
                      </span>
                    </span>
                    {unlocked ? null : (
                      <span className="carrow__lock" aria-label="Not owned">
                        LOCKED
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="garage__detail">
            <div className="statbars">
              <StatBar label="TOP SPEED" value={car.stats.topSpeed} />
              <StatBar label="ACCELERATION" value={car.stats.accel} />
              <StatBar label="GRIP" value={car.stats.grip} />
              <StatBar label="HANDLING" value={car.stats.handling} />
            </div>

            <div className="paints">
              <p className="eyebrow">LIVERY</p>
              <div className="paints__row">
                {car.paints.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`swatch${option.id === paint.id ? ' is-selected' : ''}`}
                    aria-label={`Paint ${option.id}`}
                    aria-pressed={option.id === paint.id}
                    style={
                      {
                        background: cssColor(option.base),
                        '--swatch-accent': cssColor(option.accent),
                      } as React.CSSProperties
                    }
                    onClick={() => onSelect(car.id, option.id)}
                  />
                ))}
              </div>
            </div>

            {locked ? (
              <p className="hint">
                This car is not in the connected collection. Pick another, or connect a
                wallet that holds it.
              </p>
            ) : null}

            <div className="garage__actions">
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={onConfirm}
                disabled={locked}
              >
                CONFIRM CAR
              </button>
            </div>
          </div>
        </div>

        <button type="button" className="btn btn--ghost" onClick={onBack}>
          BACK
        </button>
      </div>
    </section>
  );
}
