'use client';

// ═══════════════════════════════════════════════════════
//  OPEN WORLD — pick a shore and go
//
//  There is no route, no lap and no rival out here, so the only real
//  decision this screen has to carry is where the car starts. The rest
//  of it exists to make the scale believable before the player has seen
//  any of it: the area, the crossings, the fact that the map on the
//  right is the actual city and not a picture of one.
// ═══════════════════════════════════════════════════════
import { useState } from 'react';
import { BRIDGES, PLACES, WORLD, getCarById } from '@/lib/engine/api';
import { useProfile } from '@/lib/hooks/useStores';
import { CityMap } from '../CityMap';

export interface WorldProps {
  onDrive: (placeId: string) => void;
  onBack: () => void;
}

export function World({ onDrive, onBack }: WorldProps) {
  const profile = useProfile();
  const [placeId, setPlaceId] = useState(profile.setup.worldPlaceId);
  const place = PLACES.find((entry) => entry.id === placeId) ?? PLACES[0];
  const car = getCarById(profile.setup.carId);

  const select = (id: string) => {
    setPlaceId(id);
    profile.updateSetup({ worldPlaceId: id });
  };

  return (
    <section className="screen screen--world is-active" aria-label="Open world">
      <div className="world">
        <header className="panel__head">
          <p className="eyebrow">OPEN WORLD · NO LAPS, NO RIVALS</p>
          <h2 className="display">MARMARA</h2>
          <p className="blurb">
            A metropolis of {WORLD.areaKm2.toLocaleString('en-US')} km² split by a
            strait, crossed by three bridges, and generated street by street as you
            reach it. Nothing is loaded from a file — drive far enough in any
            direction and the city is still there.
          </p>
        </header>

        <div className="world__body">
          <div className="world__scroll">
            <ul className="world__places">
              {PLACES.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className={`placecard${entry.id === place.id ? ' is-selected' : ''}`}
                    aria-pressed={entry.id === place.id}
                    onClick={() => select(entry.id)}
                  >
                    <span className="placecard__top">
                      <span className="placecard__name">{entry.name}</span>
                      <span className="placecard__grade">
                        {entry.bridgeId ? 'CROSSING' : entry.district.toUpperCase()}
                      </span>
                    </span>
                    <span className="placecard__meta">{entry.label}</span>
                    <span className="placecard__blurb">{entry.blurb}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <aside className="world__side">
            <div className="citymap">
              <CityMap
                seed={profile.setup.worldSeed}
                centreX={0}
                centreZ={-9000}
                span={WORLD.size}
                aspect={1.15}
                samples={168}
                relief
                labels
                places={PLACES}
              />
              <p className="citymap__meta">
                <span>{WORLD.size / 1000} KM ACROSS</span>
                <span className="numeric">SEED {profile.setup.worldSeed}</span>
              </p>
            </div>

            <dl className="worldfacts">
              <div>
                <dt>AREA</dt>
                <dd className="numeric">{WORLD.areaKm2.toLocaleString('en-US')} km²</dd>
              </div>
              <div>
                <dt>CROSSINGS</dt>
                <dd className="numeric">{BRIDGES.length}</dd>
              </div>
              <div>
                <dt>CAR</dt>
                <dd>{car.name}</dd>
              </div>
            </dl>

            <p className="hint">
              Ambient traffic is {profile.settings.traffic ? 'on' : 'off'} — change it in
              settings. <kbd>M</kbd> opens the map, <kbd>R</kbd> puts you back on the
              road, <kbd>C</kbd> cycles the camera, <kbd>ESC</kbd> leaves.
            </p>
          </aside>
        </div>

        <footer className="world__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onDrive(place.id)}
          >
            DRIVE — {place.name}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onBack}>
            BACK
          </button>
        </footer>
      </div>
    </section>
  );
}
