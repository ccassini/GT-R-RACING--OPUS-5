// ═══════════════════════════════════════════════════════
//  ENGINE AUDIO — American V12 muscle character
//
//  Procedural Web Audio voice: deep sub rumble, uneven firing
//  lope, mid-band growl, and a thick high-RPM roar. Tuned for
//  big American 12-cylinder feel — chest-thumping low end, not
//  a piercing redline whistle or silky European exotic.
//
//  API (unchanged): setCar / update({ speedFrac, rpmFrac, throttle, boost,
//  drifting }, dt) / reset / silence / unmute
// ═══════════════════════════════════════════════════════

const IDLE_RPM = 750;
const MAX_RPM = 7600;
const ORDER_COUNT = 5;

/**
 * Voicings keyed to the catalogue `voice` field.
 * ICE layouts share American V12 DNA; EV stays a whir.
 * `turbo` near 0 = no induction whistle (muscle NA).
 */
const CHARACTERS = {
  // Primary: big American V12 — deep, lumpy, authoritative
  v12: {
    orders: [
      { mult: 0.5, gain: 0.26, wave: 'sine' },      // sub rumble
      { mult: 1.0, gain: 0.2, wave: 'sawtooth' },   // fundamental
      { mult: 1.5, gain: 0.12, wave: 'sawtooth' },  // uneven half-order grit
      { mult: 2.0, gain: 0.06, wave: 'sawtooth' },  // body, not a scream
      { mult: 3.0, gain: 0.025, wave: 'triangle' },
    ],
    baseHz: 21,
    spread: 138,
    exhaust: 1.85,
    turbo: 0,
    growl: 1.35,
    lope: 0.92,
    brightness: 880,
    detune: 7,
  },
  // American big-block V8 cousin — even more lope, darker
  v8: {
    orders: [
      { mult: 0.5, gain: 0.28, wave: 'sine' },
      { mult: 1.0, gain: 0.19, wave: 'sawtooth' },
      { mult: 1.5, gain: 0.14, wave: 'sawtooth' },
      { mult: 2.0, gain: 0.05, wave: 'sawtooth' },
      { mult: 2.5, gain: 0.02, wave: 'triangle' },
    ],
    baseHz: 19,
    spread: 118,
    exhaust: 2.05,
    turbo: 0,
    growl: 1.45,
    lope: 1.15,
    brightness: 760,
    detune: 9,
  },
  // Flat-six voiced toward the same American muscle family
  flat6: {
    orders: [
      { mult: 0.5, gain: 0.2, wave: 'sine' },
      { mult: 1.0, gain: 0.17, wave: 'sawtooth' },
      { mult: 1.5, gain: 0.1, wave: 'sawtooth' },
      { mult: 2.0, gain: 0.05, wave: 'sawtooth' },
      { mult: 3.0, gain: 0.02, wave: 'triangle' },
    ],
    baseHz: 23,
    spread: 148,
    exhaust: 1.55,
    turbo: 0.2,
    growl: 1.15,
    lope: 0.72,
    brightness: 980,
    detune: 5,
  },
  turbo4: {
    orders: [
      { mult: 0.5, gain: 0.12, wave: 'sine' },
      { mult: 1.0, gain: 0.14, wave: 'sawtooth' },
      { mult: 2.0, gain: 0.07, wave: 'sawtooth' },
      { mult: 3.0, gain: 0.04, wave: 'triangle' },
      { mult: 4.0, gain: 0.02, wave: 'sine' },
    ],
    baseHz: 28,
    spread: 160,
    exhaust: 1.05,
    turbo: 1.2,
    growl: 0.85,
    lope: 0.45,
    brightness: 1400,
    detune: 4,
  },
  ev: {
    orders: [
      { mult: 1.0, gain: 0.04, wave: 'sine' },
      { mult: 2.0, gain: 0.06, wave: 'sine' },
      { mult: 3.0, gain: 0.08, wave: 'triangle' },
      { mult: 4.0, gain: 0.05, wave: 'sine' },
      { mult: 6.0, gain: 0.03, wave: 'triangle' },
    ],
    baseHz: 55,
    spread: 380,
    exhaust: 0.12,
    turbo: 1.6,
    growl: 0.2,
    lope: 0.05,
    brightness: 2200,
    detune: 1,
  },
};

const DEFAULT_CHARACTER = CHARACTERS.v12;

/**
 * @param {AudioContext} ctx
 * @param {AudioNode} destination
 * @param {AudioBuffer} noiseBuffer
 */
export function createEngineVoice(ctx, destination, noiseBuffer) {
  const output = ctx.createGain();
  output.gain.value = 1;
  output.connect(destination);

  // ── Block: harmonic ladder into a shared lowpass ──
  const engineGain = ctx.createGain();
  engineGain.gain.value = 0;
  const engineLP = ctx.createBiquadFilter();
  engineLP.type = 'lowpass';
  engineLP.frequency.value = 700;
  engineLP.Q.value = 1.1;
  engineGain.connect(engineLP);
  engineLP.connect(output);

  const orders = [];
  for (let i = 0; i < ORDER_COUNT; i++) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 40;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(engineGain);
    osc.start();
    orders.push({ osc, gain });
  }

  // ── Mid growl: band-passed saw for American snarl ──
  const growlOsc = ctx.createOscillator();
  growlOsc.type = 'sawtooth';
  growlOsc.frequency.value = 80;
  const growlBP = ctx.createBiquadFilter();
  growlBP.type = 'bandpass';
  growlBP.frequency.value = 520;
  growlBP.Q.value = 1.6;
  const growlGain = ctx.createGain();
  growlGain.gain.value = 0;
  growlOsc.connect(growlBP);
  growlBP.connect(growlGain);
  growlGain.connect(output);
  growlOsc.start();

  // ── Exhaust: filtered noise with a bit of mid bark ──
  const exhaustSrc = ctx.createBufferSource();
  exhaustSrc.buffer = noiseBuffer;
  exhaustSrc.loop = true;
  const exhaustLP = ctx.createBiquadFilter();
  exhaustLP.type = 'lowpass';
  exhaustLP.frequency.value = 180;
  exhaustLP.Q.value = 2.2;
  const exhaustBP = ctx.createBiquadFilter();
  exhaustBP.type = 'bandpass';
  exhaustBP.frequency.value = 280;
  exhaustBP.Q.value = 0.9;
  const exhaustGain = ctx.createGain();
  exhaustGain.gain.value = 0;
  exhaustSrc.connect(exhaustLP);
  exhaustLP.connect(exhaustBP);
  exhaustBP.connect(exhaustGain);
  exhaustGain.connect(output);
  exhaustSrc.start();

  // ── Soft induction whisper — muted for NA muscle (turbo ≈ 0) ──
  const turboOsc = ctx.createOscillator();
  turboOsc.type = 'sine';
  turboOsc.frequency.value = 900;
  const turboLP = ctx.createBiquadFilter();
  turboLP.type = 'lowpass';
  turboLP.frequency.value = 1400;
  const turboGain = ctx.createGain();
  turboGain.gain.value = 0;
  turboOsc.connect(turboLP);
  turboLP.connect(turboGain);
  turboGain.connect(output);
  turboOsc.start();

  let character = DEFAULT_CHARACTER;
  let smoothRpm = IDLE_RPM;
  let wasThrottle = false;
  let popCooldown = 0;
  let lopePhase = 0;

  function applyCharacterWaves() {
    for (let i = 0; i < ORDER_COUNT; i++) {
      orders[i].osc.type = character.orders[i].wave;
    }
  }
  applyCharacterWaves();

  function pop(strength = 1) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.2 * strength;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380 + Math.random() * 420;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 220 + Math.random() * 180;
    bp.Q.value = 1.2;
    src.connect(lp);
    lp.connect(bp);
    bp.connect(gain);
    gain.connect(output);
    src.start();
    src.stop(ctx.currentTime + 0.06 + Math.random() * 0.05);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1);
  }

  return {
    setCar(car) {
      character = CHARACTERS[car?.voice] ?? DEFAULT_CHARACTER;
      applyCharacterWaves();
    },

    /**
     * @param {object} state { speedFrac, rpmFrac, throttle, boost, drifting }
     * @param {number} dt
     */
    update(state, dt) {
      const now = ctx.currentTime;
      const ramp = 0.048;
      const throttle = state.throttle > 0.05;
      const drift = state.drifting ? 1.08 : 1;

      const targetRpm = IDLE_RPM + state.speedFrac * (MAX_RPM - IDLE_RPM);
      const rate = throttle ? 12 : 5.2;
      smoothRpm += (targetRpm - smoothRpm) * Math.min(1, rate * dt);
      smoothRpm = Math.max(IDLE_RPM, Math.min(MAX_RPM, smoothRpm));

      const rpmFrac = (smoothRpm - IDLE_RPM) / (MAX_RPM - IDLE_RPM);
      const baseFreq = character.baseHz + rpmFrac * character.spread;

      // Soft firing-rate lope (uneven cylinder character) via CPU phase —
      // avoids fighting AudioParam automation with an LFO connection.
      const firingHz = Math.max(6, baseFreq * 0.55);
      lopePhase += firingHz * dt * Math.PI * 2;
      const lopeWave = Math.sin(lopePhase) * 0.5 + Math.sin(lopePhase * 0.5) * 0.35;
      const idleLope = (1 - rpmFrac) * character.lope;
      const lopeMod = 1 + lopeWave * 0.14 * idleLope;
      const lopeGain = 1 + lopeWave * 0.1 * idleLope * (throttle ? 0.45 : 1);

      // Tach-aligned redline zone — mute piercing layers when the needle
      // hits the red arc, not just at top speed.
      const tachFrac = state.rpmFrac ?? rpmFrac;
      const redline = Math.max(0, (tachFrac - 0.78) / 0.22);

      for (let i = 0; i < ORDER_COUNT; i++) {
        const order = character.orders[i];
        const detune = 1 + ((i % 2 === 0 ? 1 : -1) * character.detune * 0.001);
        const freq = Math.max(18, baseFreq * order.mult * detune * lopeMod);
        orders[i].osc.frequency.linearRampToValueAtTime(freq, now + ramp);
        const loadScale = throttle ? 1 : 0.55 + rpmFrac * 0.2;
        // Kill upper harmonics at redline — keep only sub/fundamental rumble.
        let harmScale = 1;
        if (order.mult >= 2) {
          harmScale = Math.max(0, 1 - redline * 1.4);
        } else if (order.mult >= 1.5) {
          harmScale = Math.max(0.15, 1 - redline * 0.9);
        } else if (order.mult <= 0.5) {
          harmScale = 1 + redline * 0.12;
        }
        orders[i].gain.gain.linearRampToValueAtTime(
          order.gain * loadScale * harmScale,
          now + ramp,
        );
      }

      // Band-passed growl is the main piercing layer — mute it at redline.
      const growlFade = Math.max(0, 1 - redline * 1.15);
      const growlHz = baseFreq * 2.15;
      growlOsc.frequency.linearRampToValueAtTime(growlHz, now + ramp);
      growlBP.frequency.linearRampToValueAtTime(
        (260 + rpmFrac * 340) * (1 - redline * 0.45),
        now + ramp,
      );
      const growlLevel =
        (throttle ? 0.06 + rpmFrac * 0.1 : 0.012 + rpmFrac * 0.02) * character.growl;
      growlGain.gain.linearRampToValueAtTime(growlLevel * drift * growlFade, now + ramp);

      const load = throttle ? 0.78 + rpmFrac * 0.28 : 0.18 + rpmFrac * 0.14;
      const boostLift = state.boost ? 1.32 : 1;
      engineGain.gain.linearRampToValueAtTime(load * boostLift * drift * lopeGain, now + ramp);
      // Hard lowpass cap at redline — thick rumble only, no upper band.
      const lpOpen = 360 + rpmFrac * character.brightness * (1 - redline * 0.6);
      const lpCap = 400 + (1 - redline) * 350;
      engineLP.frequency.linearRampToValueAtTime(Math.min(lpOpen, lpCap), now + ramp);

      exhaustLP.frequency.linearRampToValueAtTime(80 + rpmFrac * 280 * (1 - redline * 0.3), now + ramp);
      exhaustBP.frequency.linearRampToValueAtTime(160 + rpmFrac * 220 * (1 - redline * 0.35), now + ramp);
      const exhaust =
        (throttle ? 0.08 + rpmFrac * 0.13 : 0.025 + rpmFrac * 0.03) *
        character.exhaust *
        (1 - redline * 0.2);
      exhaustGain.gain.linearRampToValueAtTime(exhaust * drift, now + ramp);

      // No induction/turbo whistle anywhere near redline.
      const turboAmt = Math.max(0, character.turbo);
      const turboAllowed = turboAmt > 0.05 && redline < 0.08;
      turboOsc.frequency.linearRampToValueAtTime(
        700 + rpmFrac * 900 * Math.min(1, turboAmt),
        now + ramp,
      );
      turboLP.frequency.linearRampToValueAtTime(1100 + rpmFrac * 400, now + ramp);
      const turbo =
        turboAllowed && rpmFrac > 0.55
          ? ((rpmFrac - 0.55) / 0.45) * 0.022 * turboAmt
          : 0;
      turboGain.gain.linearRampToValueAtTime(
        turbo + (state.boost && turboAllowed ? 0.03 : 0),
        now + ramp,
      );

      popCooldown -= dt;
      if (wasThrottle && !throttle && rpmFrac > 0.4 && popCooldown <= 0) {
        pop(0.85 + rpmFrac * 0.55);
        if (rpmFrac > 0.62 && Math.random() > 0.4) {
          setTimeout(() => pop(0.55 + Math.random() * 0.3), 50 + Math.random() * 100);
        }
        if (rpmFrac > 0.78 && Math.random() > 0.55) {
          setTimeout(() => pop(0.4), 140 + Math.random() * 80);
        }
        popCooldown = 0.26;
      }
      wasThrottle = throttle;
    },

    reset() {
      const now = ctx.currentTime;
      smoothRpm = IDLE_RPM;
      wasThrottle = false;
      popCooldown = 0;
      lopePhase = 0;
      engineGain.gain.linearRampToValueAtTime(0, now + 0.06);
      exhaustGain.gain.linearRampToValueAtTime(0, now + 0.06);
      turboGain.gain.linearRampToValueAtTime(0, now + 0.06);
      growlGain.gain.linearRampToValueAtTime(0, now + 0.06);
    },

    silence() {
      output.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
    },

    unmute() {
      output.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.15);
    },
  };
}
