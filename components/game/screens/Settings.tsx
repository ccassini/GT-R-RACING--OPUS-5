'use client';

import {
  CAMERA_ORDER,
  QUALITY,
  QUALITY_IDS,
  type CameraId,
  type QualityId,
} from '@/lib/engine/api';
import { OptionSet, Slider, Toggle } from '@/components/ui/controls';
import { useProfile } from '@/lib/hooks/useStores';

const QUALITY_HINTS: Record<QualityId, string> = {
  low: 'Faster',
  medium: 'Balanced',
  high: 'Best look',
};

const CAMERA_HINTS: Record<CameraId, string> = {
  bird: 'High aerial',
  top: 'Straight down',
  chase: 'Behind car',
};

export interface SettingsProps {
  onQualityChange: (quality: QualityId) => void;
  onCameraChange: (camera: CameraId) => void;
  onVolumeChange: (value: number) => void;
  onGhostLineChange: (on: boolean) => void;
  onResetRecords: () => void;
  onBack: () => void;
}

export function Settings({
  onQualityChange,
  onCameraChange,
  onVolumeChange,
  onGhostLineChange,
  onResetRecords,
  onBack,
}: SettingsProps) {
  const profile = useProfile();
  const { settings } = profile;

  return (
    <section className="screen screen--settings is-active" aria-label="Settings">
      <div className="settings">
        <header className="settings__head">
          <p className="eyebrow">SETTINGS</p>
          <h2 className="display">PREFERENCES</h2>
        </header>

        <div className="settings__body">
          <section className="settings__section" aria-labelledby="settings-display">
            <h3 id="settings-display" className="settings__label">
              Display
            </h3>
            <div className="settings__fields settings__fields--choices">
              <OptionSet
                legend="QUALITY"
                layout="segment"
                value={settings.quality}
                options={QUALITY_IDS.map((id) => ({
                  value: id,
                  label: QUALITY[id].label,
                  hint: QUALITY_HINTS[id],
                }))}
                onChange={onQualityChange}
              />
              <OptionSet
                legend="CAMERA"
                layout="segment"
                value={settings.camera}
                options={CAMERA_ORDER.map((id) => ({
                  value: id,
                  label: id.toUpperCase(),
                  hint: CAMERA_HINTS[id],
                }))}
                onChange={onCameraChange}
              />
            </div>
          </section>

          <section className="settings__section" aria-labelledby="settings-audio">
            <h3 id="settings-audio" className="settings__label">
              Audio
            </h3>
            <div className="settings__fields">
              <Slider
                label="MASTER VOLUME"
                value={settings.masterVolume}
                onChange={onVolumeChange}
              />
            </div>
          </section>

          <section className="settings__section" aria-labelledby="settings-aids">
            <h3 id="settings-aids" className="settings__label">
              Driving aids
            </h3>
            <div className="settings__fields">
              <Toggle
                label="Minimap"
                checked={settings.showMinimap}
                onChange={(showMinimap) => profile.updateSettings({ showMinimap })}
              />
              <Toggle
                label="Racing line"
                hint="Shown only while you are behind the wheel."
                checked={settings.showGhostLine}
                onChange={onGhostLineChange}
              />
            </div>
          </section>

          <p className="settings__note hint">
            Changing quality rebuilds the world, which takes a moment and returns you to the
            menu.
          </p>
        </div>

        <div className="settings__actions">
          <button type="button" className="btn btn--ghost" onClick={onResetRecords}>
            RESET RECORDS
          </button>
          <button type="button" className="btn btn--ghost" onClick={onBack}>
            BACK
          </button>
        </div>
      </div>
    </section>
  );
}
