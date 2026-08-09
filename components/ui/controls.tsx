'use client';

// ═══════════════════════════════════════════════════════
//  CONTROLS — the small shared pieces every screen reuses
//
//  Deliberately unstyled in JSX: the class names are the ones the
//  design system already defines. A component here owns behaviour and
//  accessibility, never appearance.
// ═══════════════════════════════════════════════════════
import type { ReactNode } from 'react';

export interface StatBarProps {
  label: string;
  /** 0-100, as the catalogue stores it. */
  value: number;
  tone?: 'default' | 'accent';
}

export function StatBar({ label, value, tone = 'default' }: StatBarProps) {
  const fill = Math.min(1, Math.max(0, value / 100));
  return (
    <div className="statbar" data-tone={tone}>
      <span className="statbar__label">{label}</span>
      <span className="statbar__track">
        <span className="statbar__fill" style={{ transform: `scaleX(${fill})` }} />
      </span>
      <span className="statbar__value numeric">{value}</span>
    </div>
  );
}

export interface Option<T extends string | number> {
  value: T;
  label: string;
  hint?: string;
}

export interface OptionSetProps<T extends string | number> {
  legend: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Equal-width segmented track (settings-style). Default is free-flow chips. */
  layout?: 'chips' | 'segment';
}

export function OptionSet<T extends string | number>({
  legend,
  options,
  value,
  onChange,
  layout = 'chips',
}: OptionSetProps<T>) {
  return (
    <fieldset className={`optionset${layout === 'segment' ? ' optionset--segment' : ''}`}>
      <legend className="eyebrow">{legend}</legend>
      <div className={`chips${layout === 'segment' ? ' chips--segment' : ''}`}>
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            className={`chip${layout === 'segment' ? ' chip--segment' : ''}`}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            <span className="chip__label">{option.label}</span>
            {option.hint ? <small className="chip__hint">{option.hint}</small> : null}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}

export function Toggle({ label, checked, onChange, hint }: ToggleProps) {
  return (
    <label className={`toggle${hint ? ' toggle--hinted' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="toggle__text">
        <span className="toggle__label">{label}</span>
        {hint ? <small className="hint toggle__hint">{hint}</small> : null}
      </span>
    </label>
  );
}

export interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function Slider({ label, value, onChange, min = 0, max = 1, step = 0.05 }: SliderProps) {
  return (
    <label className="slider">
      <span className="eyebrow">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <span className="numeric">{Math.round((value / max) * 100)}</span>
    </label>
  );
}

export interface PanelHeadProps {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}

export function PanelHead({ eyebrow, title, children }: PanelHeadProps) {
  return (
    <header className="panel__head">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="display">{title}</h2>
      {children}
    </header>
  );
}
