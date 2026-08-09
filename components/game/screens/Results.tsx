'use client';

import { formatLapTime, ordinal } from '@/lib/engine/util.js';
import { cssColor } from '@/lib/engine/api';
import { shortHash } from '@/lib/chain/receipt';

export interface ResultRow {
  position: number;
  name: string;
  car: { name: string; id: string };
  paint: { base: number };
  isPlayer: boolean;
  finished: boolean;
  time: number;
  bestLap: number;
  driftScore: number;
}

export interface ResultsPayload {
  circuitName: string;
  laps: number;
  results: ResultRow[];
  playerResult: ResultRow | null;
  bestLapRecord: boolean;
  driftRecord: boolean;
}

export interface ResultsProps {
  payload: ResultsPayload;
  /** Null while the digest is still being computed. */
  receiptHash: string | null;
  onRestart: () => void;
  onBack: () => void;
}

export function Results({ payload, receiptHash, onRestart, onBack }: ResultsProps) {
  const { playerResult } = payload;

  return (
    <section className="screen screen--results is-active" aria-label="Race results">
      <div className="results">
        <header className="results__head">
          <p className="eyebrow">
            {payload.circuitName} · {payload.laps} LAPS
          </p>
          <h2 className="display display--xl">
            {playerResult ? ordinal(playerResult.position) : 'DNF'}
          </h2>
        </header>

        <div className="results__cards">
          <div className="resultcard">
            <p className="eyebrow">RACE TIME</p>
            <p className="resultcard__value numeric">
              {playerResult?.finished ? formatLapTime(playerResult.time) : 'DNF'}
            </p>
          </div>

          <div className={`resultcard${payload.bestLapRecord ? ' resultcard--record' : ''}`}>
            <p className="eyebrow">{payload.bestLapRecord ? 'NEW BEST LAP' : 'BEST LAP'}</p>
            <p className="resultcard__value numeric">
              {playerResult && Number.isFinite(playerResult.bestLap)
                ? formatLapTime(playerResult.bestLap)
                : '—'}
            </p>
          </div>

          <div className={`resultcard${payload.driftRecord ? ' resultcard--record' : ''}`}>
            <p className="eyebrow">{payload.driftRecord ? 'NEW BEST DRIFT' : 'DRIFT'}</p>
            <p className="resultcard__value numeric">
              {(playerResult?.driftScore ?? 0).toLocaleString('en-US')}
            </p>
          </div>
        </div>

        <ol className="ranking">
          {payload.results.map((row) => (
            <li key={`${row.position}-${row.name}`} className={`rankrow${row.isPlayer ? ' is-player' : ''}`}>
              <span className="rankrow__pos numeric">{row.position}</span>
              <span className="rankrow__chip" style={{ background: cssColor(row.paint.base) }} />
              <span className="rankrow__name">
                <span className="rankrow__driver">{row.name}</span>
                <span className="rankrow__car">{row.car.name}</span>
              </span>
              <span className="rankrow__time numeric">
                {row.finished ? formatLapTime(row.time) : 'DNF'}
              </span>
              <span className="rankrow__best numeric">
                {Number.isFinite(row.bestLap) ? formatLapTime(row.bestLap) : '—'}
              </span>
            </li>
          ))}
        </ol>

        {/* The digest is what an attestation would carry. Showing it here
            makes the record something the player can actually check
            rather than a claim the game makes about itself. */}
        <p className="receipt">
          <span className="eyebrow">RACE RECEIPT</span>
          <code className="receipt__hash">{receiptHash ? shortHash(receiptHash) : 'hashing…'}</code>
        </p>

        <div className="results__actions">
          <button type="button" className="btn btn--primary" onClick={onRestart}>
            RACE AGAIN
          </button>
          <button type="button" className="btn btn--ghost" onClick={onBack}>
            MAIN MENU
          </button>
        </div>
      </div>
    </section>
  );
}
