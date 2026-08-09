export interface LoadingProps {
  fraction: number;
  status: string;
  error: string | null;
}

export function Loading({ fraction, status, error }: LoadingProps) {
  return (
    <section className="screen screen--loading is-active" aria-label="Loading">
      <div className="loader">
        <p className="loader__eyebrow">SEASON 01</p>
        <h1 className="loader__title">
          <span>GT-R</span>
          <span className="loader__title-alt">RACING</span>
        </h1>
        <div
          className="loader__bar"
          role="progressbar"
          aria-valuenow={Math.round(fraction * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span className="loader__fill" style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
        <p className="loader__status">{error ? `Could not start: ${error}` : status}</p>
      </div>
    </section>
  );
}
