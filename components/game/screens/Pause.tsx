export interface PauseProps {
  circuitName: string;
  onResume: () => void;
  onRestart: () => void;
  onSettings: () => void;
  onQuit: () => void;
}

export function Pause({ circuitName, onResume, onRestart, onSettings, onQuit }: PauseProps) {
  return (
    <section className="screen screen--pause is-active" aria-label="Paused">
      <div className="pause">
        <header className="panel__head">
          <p className="eyebrow">{circuitName}</p>
          <h2 className="display display--lg">PAUSED</h2>
        </header>

        <div className="pause__actions">
          <button type="button" className="btn btn--primary" onClick={onResume}>
            RESUME
          </button>
          <button type="button" className="btn btn--ghost" onClick={onSettings}>
            SETTINGS
          </button>
          <button type="button" className="btn btn--ghost" onClick={onRestart}>
            RESTART
          </button>
          <button type="button" className="btn btn--ghost" onClick={onQuit}>
            QUIT TO MENU
          </button>
        </div>

        <p className="hint">
          <kbd>ESC</kbd> resume · <kbd>R</kbd> restart · <kbd>C</kbd> camera
        </p>
      </div>
    </section>
  );
}
