'use client';

// ═══════════════════════════════════════════════════════
//  GAME SHELL — one canvas, one engine, many screens
//
//  Menu, garage, setup and the race are *not* Next routes. Building a
//  circuit means a spline, a dense sample table, several square
//  kilometres of ribbon geometry and a dozen procedural textures; a
//  route change would tear all of it down and rebuild it, so a click on
//  "garage" would cost the same as a cold boot.
//
//  So the whole game is one route with an internal screen state, and
//  the WebGL context outlives every transition. The dashboard, which
//  needs none of that, is a separate route tree that never mounts this
//  component at all.
// ═══════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from 'react';
import { getCircuitById, type CameraId, type QualityId } from '@/lib/engine/api';
import { buildRaceReceipt, hashReceipt } from '@/lib/chain/receipt';
import { getPlatform } from '@/lib/chain/platform';
import { useProfile } from '@/lib/hooks/useStores';
import { useEngine, useEngineEvent } from './useEngine';
import { Hud } from './hud/Hud';
import { Loading } from './screens/Loading';
import { Menu } from './screens/Menu';
import { Garage } from './screens/Garage';
import { Setup } from './screens/Setup';
import { Settings } from './screens/Settings';
import { Pause } from './screens/Pause';
import { Results, type ResultsPayload } from './screens/Results';
import { World } from './screens/World';
import { RoamPause } from './screens/RoamPause';
import { RoamHud } from './hud/RoamHud';

export type Screen =
  | 'menu' | 'garage' | 'setup' | 'settings' | 'race' | 'pause' | 'results'
  | 'world' | 'worldloading' | 'roam' | 'roampause';

/** What the pause panel shows about a drive that is currently frozen. */
interface RoamSnapshot {
  x: number;
  z: number;
  heading: number;
  districtName: string;
  distance: number;
  topSpeedKmh: number;
}

const EMPTY_ROAM: RoamSnapshot = {
  x: 0, z: 0, heading: 0, districtName: '—', distance: 0, topSpeedKmh: 0,
};

/** What the engine hands over when a race ends, before hashing. */
interface RaceEndPayload extends ResultsPayload {
  circuitId: string;
  difficulty: string;
  startedAt: number;
  timingFor: (vehicle: unknown) => { laps: number[] } | undefined;
}

export function GameShell() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { engine, progress, error } = useEngine(canvasRef);
  const profile = useProfile();

  const [screen, setScreen] = useState<Screen>('menu');
  /** Where Settings should return when BACK/ESC — menu attract vs mid-race pause. */
  const [settingsOrigin, setSettingsOrigin] = useState<'menu' | 'pause'>('menu');
  const [results, setResults] = useState<ResultsPayload | null>(null);
  const [receiptHash, setReceiptHash] = useState<string | null>(null);
  const [roam, setRoam] = useState<RoamSnapshot>(EMPTY_ROAM);
  const [loading, setLoading] = useState({ fraction: 0, status: '' });

  const booted = engine !== null;

  // ── Engine events ────────────────────────────────────

  useEngineEvent<RaceEndPayload>(engine, 'results', (payload) => {
    setResults(payload);
    setReceiptHash(null);
    setScreen('results');
    void recordRace(payload);
  });

  // Building the city reports progress the same way booting does.
  useEngineEvent<{ fraction: number; status: string }>(engine, 'progress', setLoading);

  // ── Actions ──────────────────────────────────────────

  const startRace = useCallback(() => {
    if (!engine) return;
    setResults(null);
    engine.startRace();
    setScreen('race');
  }, [engine]);

  const toMenu = useCallback(() => {
    engine?.enterAttract();
    setScreen('menu');
  }, [engine]);

  const openGarage = useCallback(() => {
    engine?.enterGarage();
    setScreen('garage');
  }, [engine]);

  const navigate = useCallback(
    (next: Screen) => {
      if (next === 'garage') {
        openGarage();
        return;
      }
      // Setup and settings sit over the attract race, so the scene has
      // to be back in attract mode before they open.
      if (screen === 'garage') engine?.enterAttract();
      if (next === 'settings') setSettingsOrigin('menu');
      setScreen(next);
    },
    [engine, openGarage, screen],
  );

  const openSettingsFromPause = useCallback(() => {
    setSettingsOrigin('pause');
    setScreen('settings');
  }, []);

  const leaveSettings = useCallback(() => {
    if (settingsOrigin === 'pause') {
      setScreen('pause');
      return;
    }
    toMenu();
  }, [settingsOrigin, toMenu]);

  const selectCar = useCallback(
    (carId: string, paintId: string) => {
      profile.updateSetup({ carId, paintId });
      engine?.buildShowcase();
    },
    [engine, profile],
  );

  const changeCircuit = useCallback(
    (circuitId: string) => {
      profile.updateSetup({ circuitId });
      engine?.reloadWorld(circuitId);
    },
    [engine, profile],
  );

  const changeQuality = useCallback(
    (quality: QualityId) => {
      profile.updateSettings({ quality });
      engine?.applyQuality();
      // Quality rebuild tears down the race world — always land on the menu.
      setSettingsOrigin('menu');
      setScreen('menu');
    },
    [engine, profile],
  );

  const changeCamera = useCallback(
    (camera: CameraId) => {
      profile.updateSettings({ camera });
      engine?.setCamera(camera);
    },
    [engine, profile],
  );

  const changeVolume = useCallback(
    (value: number) => {
      profile.updateSettings({ masterVolume: value });
      engine?.audio.setMasterVolume(value);
    },
    [engine, profile],
  );

  const changeGhostLine = useCallback(
    (showGhostLine: boolean) => {
      profile.updateSettings({ showGhostLine });
      engine?.setGhostLine(showGhostLine);
    },
    [engine, profile],
  );

  const setPaused = useCallback(
    (paused: boolean) => {
      engine?.setPaused(paused);
      setScreen(paused ? 'pause' : 'race');
    },
    [engine],
  );

  const quitToMenu = useCallback(() => {
    engine?.setPaused(false);
    toMenu();
  }, [engine, toMenu]);

  // ── Open world ───────────────────────────────────────

  const enterWorld = useCallback(
    async (placeId: string) => {
      if (!engine) return;
      setLoading({ fraction: 0.02, status: 'Opening the city…' });
      setScreen('worldloading');
      await engine.enterWorld({ placeId });
      setScreen('roam');
    },
    [engine],
  );

  const pauseRoam = useCallback(() => {
    if (!engine) return;
    // The engine reuses one telemetry object every frame, so the pause
    // panel has to take a copy rather than hold on to it.
    const live = engine.telemetry.roam;
    setRoam({
      x: live.x,
      z: live.z,
      heading: live.heading,
      districtName: live.districtName || '—',
      distance: live.distance,
      topSpeedKmh: live.topSpeedKmh,
    });
    engine.setPaused(true);
    setScreen('roampause');
  }, [engine]);

  const resumeRoam = useCallback(() => {
    engine?.setPaused(false);
    setScreen('roam');
  }, [engine]);

  const travelTo = useCallback(
    async (placeId: string) => {
      if (!engine) return;
      setLoading({ fraction: 0.1, status: 'Crossing the city…' });
      setScreen('worldloading');
      await engine.travelTo(placeId);
      engine.setPaused(false);
      setScreen('roam');
    },
    [engine],
  );

  const leaveWorld = useCallback(() => {
    if (!engine) return;
    engine.setPaused(false);
    engine.exitWorld();
    setScreen('menu');
  }, [engine]);

  // ── Keyboard: the discrete keys React owns ───────────

  useEffect(() => {
    if (!engine) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const racing = screen === 'race' || screen === 'pause';
      const roaming = screen === 'roam' || screen === 'roampause';

      if (event.code === 'Escape') {
        // Settings opened mid-race: ESC backs out to pause, not resume.
        if (screen === 'settings' && settingsOrigin === 'pause') {
          event.preventDefault();
          setScreen('pause');
          return;
        }
        if (racing || roaming) {
          event.preventDefault();
          // A race pauses and unpauses on the same key, because there is
          // one thing to go back to. Free roam has two: escape once for
          // the map, again to leave the city — so the key always means
          // "back" rather than "toggle".
          if (racing) setPaused(screen === 'race');
          else if (screen === 'roam') pauseRoam();
          else leaveWorld();
          return;
        }
      }

      if (screen === 'roam') {
        if (event.code === 'KeyC') engine.cycleCamera();
        if (event.code === 'KeyR') engine.respawnInWorld();
        // In a city the map is the thing you reach for, so it gets its
        // own key rather than living two clicks inside the pause panel.
        if (event.code === 'KeyM') pauseRoam();
        return;
      }
      if (!racing) return;

      if (event.code === 'KeyC') engine.cycleCamera();
      if (event.code === 'KeyR') startRace();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [engine, screen, settingsOrigin, setPaused, startRace, pauseRoam, leaveWorld]);

  const circuitName = getCircuitById(profile.setup.circuitId).name;

  return (
    <>
      <canvas id="scene" ref={canvasRef} />

      <div className="app">
        {!booted ? (
          <Loading fraction={progress.fraction} status={progress.status} error={error} />
        ) : null}

        {booted && screen === 'menu' ? (
          <Menu onNavigate={navigate} onQuickRace={startRace} />
        ) : null}

        {booted && screen === 'garage' ? (
          <Garage
            onSelect={selectCar}
            onConfirm={() => navigate('setup')}
            onBack={toMenu}
          />
        ) : null}

        {booted && screen === 'setup' ? (
          <Setup onCircuitChange={changeCircuit} onStart={startRace} onBack={toMenu} />
        ) : null}

        {booted && screen === 'settings' ? (
          <Settings
            onQualityChange={changeQuality}
            onCameraChange={changeCamera}
            onVolumeChange={changeVolume}
            onGhostLineChange={changeGhostLine}
            onResetRecords={() => profile.resetRecords()}
            onBack={leaveSettings}
          />
        ) : null}

        {booted && screen === 'pause' ? (
          <Pause
            circuitName={circuitName}
            onResume={() => setPaused(false)}
            onRestart={startRace}
            onSettings={openSettingsFromPause}
            onQuit={quitToMenu}
          />
        ) : null}

        {booted && screen === 'results' && results ? (
          <Results
            payload={results}
            receiptHash={receiptHash}
            onRestart={startRace}
            onBack={toMenu}
          />
        ) : null}

        {booted && screen === 'world' ? (
          <World onDrive={(placeId) => void enterWorld(placeId)} onBack={toMenu} />
        ) : null}

        {booted && screen === 'worldloading' ? (
          <Loading fraction={loading.fraction} status={loading.status} error={null} />
        ) : null}

        {booted && screen === 'roampause' ? (
          <RoamPause
            position={roam}
            districtName={roam.districtName}
            distanceKm={roam.distance / 1000}
            topSpeedKmh={roam.topSpeedKmh}
            onResume={resumeRoam}
            onTravel={(placeId) => void travelTo(placeId)}
            onRespawn={() => {
              engine?.respawnInWorld();
              resumeRoam();
            }}
            onQuit={leaveWorld}
          />
        ) : null}

        <Hud engine={engine} visible={screen === 'race'} />
        <RoamHud engine={engine} visible={screen === 'roam'} />
      </div>
    </>
  );

  /**
   * Build the canonical receipt, hash it, hand it to the provider.
   * Fire and forget on purpose: the results screen is already up and
   * must never wait on a backend to finish rendering.
   */
  async function recordRace(payload: RaceEndPayload): Promise<void> {
    const platform = getPlatform();
    const receipt = buildRaceReceipt({
      circuitId: payload.circuitId,
      laps: payload.laps,
      difficulty: payload.difficulty,
      identity: platform.identity.id,
      startedAt: payload.startedAt,
      results: payload.results as never,
      timingFor: payload.timingFor,
    });

    const hash = await hashReceipt(receipt);
    setReceiptHash(hash);
    await platform.submitResult(receipt, hash);
  }
}
