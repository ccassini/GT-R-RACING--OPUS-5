// ═══════════════════════════════════════════════════════
//  AUDIO — one context, one mixer, two buses (sfx + engine)
//
//  Browsers will not start an AudioContext without a gesture, so
//  everything here is created lazily on the first real interaction
//  and the rest of the game just calls into a no-op until then.
// ═══════════════════════════════════════════════════════
import { createEngineVoice } from './engine.js';
import { createAISound } from './rivals.js';

export class Audio {
  constructor({ masterVolume = 0.8 } = {}) {
    this.ready = false;
    this.ctx = null;
    this.masterVolume = masterVolume;
    this.pendingCar = null;
  }

  /** Safe to call before the context exists; applied on start(). */
  setPlayerCar(car) {
    this.pendingCar = car;
    if (this.ready) this.engine.setCar(car);
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  start() {
    if (this.ready) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.masterVolume;
    this.master.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);

    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = 0.85;
    this.engineBus.connect(this.master);

    const noiseLength = 2 * ctx.sampleRate;
    this.noiseBuffer = ctx.createBuffer(1, noiseLength, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseLength; i++) data[i] = Math.random() * 2 - 1;

    this.engine = createEngineVoice(ctx, this.engineBus, this.noiseBuffer);
    if (this.pendingCar) this.engine.setCar(this.pendingCar);
    this.rivals = createAISound(ctx, this.engineBus, this.noiseBuffer);

    this.ready = true;
  }

  setMasterVolume(value) {
    this.masterVolume = value;
    if (this.master) this.master.gain.value = value;
  }

  addRival() {
    return this.ready ? this.rivals.addCar() : -1;
  }

  resetEngines() {
    if (!this.ready) return;
    this.engine.reset();
    this.rivals.reset();
  }

  // ── One-shots ──

  #tone({ freq, endFreq, duration, type = 'sine', gain = 0.2, delay = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), start + duration);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(gain, start + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(env);
    env.connect(this.sfxBus);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  #noiseBurst({ duration = 0.3, gain = 0.2, lowpass = 1200, sweepTo = null, delay = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const start = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(lowpass, start);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, start + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, start);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    src.connect(filter);
    filter.connect(env);
    env.connect(this.sfxBus);
    src.start(start);
    src.stop(start + duration + 0.02);
  }

  uiHover() { this.#tone({ freq: 620, duration: 0.05, type: 'triangle', gain: 0.05 }); }
  uiSelect() { this.#tone({ freq: 880, endFreq: 1320, duration: 0.12, type: 'square', gain: 0.08 }); }
  uiBack() { this.#tone({ freq: 460, endFreq: 260, duration: 0.13, type: 'square', gain: 0.07 }); }

  countdownBeep(stage) {
    this.#tone({ freq: 440 + stage * 40, duration: 0.16, type: 'square', gain: 0.14 });
  }

  goSignal() {
    this.#tone({ freq: 880, duration: 0.4, type: 'square', gain: 0.16 });
    this.#tone({ freq: 1320, duration: 0.5, type: 'square', gain: 0.1, delay: 0.05 });
  }

  lapChime() {
    this.#tone({ freq: 1046, duration: 0.18, type: 'triangle', gain: 0.12 });
    this.#tone({ freq: 1568, duration: 0.24, type: 'triangle', gain: 0.1, delay: 0.1 });
  }

  recordChime() {
    for (let i = 0; i < 3; i++) {
      this.#tone({ freq: 880 * (1 + i * 0.26), duration: 0.22, type: 'triangle', gain: 0.11, delay: i * 0.09 });
    }
  }

  boostFire() {
    this.#noiseBurst({ duration: 0.55, gain: 0.24, lowpass: 400, sweepTo: 5200 });
    this.#tone({ freq: 180, endFreq: 900, duration: 0.4, type: 'sawtooth', gain: 0.08 });
  }

  impact(strength) {
    this.#noiseBurst({ duration: 0.16 + strength * 0.16, gain: 0.12 + strength * 0.25, lowpass: 2600, sweepTo: 220 });
  }

  finishFanfare() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((freq, i) => {
      this.#tone({ freq, duration: 0.45, type: 'square', gain: 0.11, delay: i * 0.11 });
    });
  }
}
