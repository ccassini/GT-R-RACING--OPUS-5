'use client';

// ═══════════════════════════════════════════════════════
//  ROAM PAUSE — pause, and the map, in one panel
//
//  Pausing in an open world is almost always "where am I and where do
//  I go next", so the map is the screen rather than something behind
//  another click. Places are travel targets: the city is a function of
//  a seed, so crossing forty kilometres costs a re-stream of the ring
//  around the destination and nothing else.
// ═══════════════════════════════════════════════════════
import { PLACES, WORLD } from '@/lib/engine/api';
import { useProfile } from '@/lib/hooks/useStores';
import { CityMap } from '../CityMap';

export interface RoamPauseProps {
  position: { x: number; z: number; heading: number };
  districtName: string;
  distanceKm: number;
  topSpeedKmh: number;
  onResume: () => void;
  onTravel: (placeId: string) => void;
  onRespawn: () => void;
  onQuit: () => void;
}

export function RoamPause({
  position,
  districtName,
  distanceKm,
  topSpeedKmh,
  onResume,
  onTravel,
  onRespawn,
  onQuit,
}: RoamPauseProps) {
  const profile = useProfile();

  return (
    <section className="screen screen--roampause is-active" aria-label="Paused">
      <div className="roampause">
        <header className="panel__head">
          <p className="eyebrow">PAUSED · {districtName}</p>
          <h2 className="display">MARMARA</h2>
        </header>

        <div className="roampause__body">
          <div className="citymap citymap--large">
            <CityMap
              seed={profile.setup.worldSeed}
              centreX={0}
              centreZ={-9000}
              span={WORLD.size}
              aspect={1.25}
              samples={200}
              relief
              labels
              places={PLACES}
              player={position}
              ariaLabel="World map"
            />
            <p className="citymap__meta">
              <span>{WORLD.size / 1000} KM ACROSS · {WORLD.areaKm2.toLocaleString('en-US')} km²</span>
              <span className="numeric">
                {(position.x / 1000).toFixed(1)} · {(position.z / 1000).toFixed(1)}
              </span>
            </p>
          </div>

          <aside className="roampause__side">
            <dl className="worldfacts worldfacts--stack">
              <div>
                <dt>TRIP</dt>
                <dd className="numeric">{distanceKm.toFixed(1)} km</dd>
              </div>
              <div>
                <dt>TOP SPEED</dt>
                <dd className="numeric">{topSpeedKmh} km/h</dd>
              </div>
            </dl>

            <p className="eyebrow">TRAVEL TO</p>
            <ul className="roampause__places">
              {PLACES.map((place) => (
                <li key={place.id}>
                  <button
                    type="button"
                    className="travelrow"
                    onClick={() => onTravel(place.id)}
                  >
                    <span className="travelrow__name">{place.name}</span>
                    <span className="travelrow__meta">{place.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        </div>

        {/* Pinned to the panel, not to the column beside the map. A map
            this size pushes anything below it off a short screen, and
            the way out of the city is not something to go looking for. */}
        <footer className="roampause__actions">
          <button type="button" className="btn btn--primary" onClick={onResume}>
            RESUME
          </button>
          <button type="button" className="btn btn--ghost" onClick={onRespawn}>
            BACK ON THE ROAD
          </button>
          <button type="button" className="btn btn--ghost" onClick={onQuit}>
            LEAVE THE CITY <kbd>ESC</kbd>
          </button>
        </footer>
      </div>
    </section>
  );
}
