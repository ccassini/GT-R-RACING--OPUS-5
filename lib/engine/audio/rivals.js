// ═══════════════════════════════════════════════════════
//  AI SOUND — per-car engine with distance-based 3D pan
//  Closer = louder, farther = silent. Uses PannerNode.
//  Deeper American V12-flavoured rival mix to match player.
// ═══════════════════════════════════════════════════════

export function createAISound(ctx, master, noiseBuf) {
  const voices = [];
  const MAX_DIST = 80;
  const REF_DIST = 8;

  function makeVoice() {
    const distGain = ctx.createGain();
    distGain.gain.value = 0;

    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'linear';
    panner.maxDistance = 1;
    panner.refDistance = 1;
    panner.rolloffFactor = 0;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;
    distGain.connect(panner);
    panner.connect(master);

    // Dual-osc American rumble (lighter than player voice)
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 28;
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.24;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 14;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.14;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 550;
    lp.Q.value = 1.15;
    osc.connect(oscGain);
    oscGain.connect(lp);
    sub.connect(subGain);
    subGain.connect(lp);
    lp.connect(distGain);
    osc.start();
    sub.start();

    const nSrc = ctx.createBufferSource();
    nSrc.buffer = noiseBuf;
    nSrc.loop = true;
    const nLP = ctx.createBiquadFilter();
    nLP.type = 'lowpass';
    nLP.frequency.value = 180;
    nLP.Q.value = 1.8;
    const nGain = ctx.createGain();
    nGain.gain.value = 0.07;
    nSrc.connect(nLP);
    nLP.connect(nGain);
    nGain.connect(distGain);
    nSrc.start();

    return { osc, sub, oscGain, subGain, lp, nLP, nGain, distGain, panner, smoothRPM: 750 };
  }

  return {
    addCar() {
      const v = makeVoice();
      voices.push(v);
      return voices.length - 1;
    },

    updateCar(idx, x, y, z, speed, playerX, playerY, playerZ, playerHeading, dt) {
      if (idx >= voices.length) return;
      const v = voices[idx];
      const now = ctx.currentTime;
      const ramp = 0.05;

      const dx = x - playerX;
      const dy = y - playerY;
      const dz = z - playerZ;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const vol = dist < MAX_DIST ? Math.max(0, 1 - dist / MAX_DIST) : 0;
      const curVol = v.distGain.gain.value;
      const newVol = curVol + (vol - curVol) * Math.min(1, 8 * dt);
      v.distGain.gain.setTargetAtTime(newVol, now, 0.05);

      v.panner.positionX.setValueAtTime(x, now);
      v.panner.positionY.setValueAtTime(y, now);
      v.panner.positionZ.setValueAtTime(z, now);

      const IDLE = 750, MAX = 7200;
      const speedFrac = Math.min(Math.abs(speed) / 120, 1);
      const targetRPM = IDLE + speedFrac * (MAX - IDLE);
      v.smoothRPM += (targetRPM - v.smoothRPM) * 6 * dt;
      const rpmFrac = (v.smoothRPM - IDLE) / (MAX - IDLE);
      const baseFreq = 22 + rpmFrac * 135;

      v.osc.frequency.linearRampToValueAtTime(baseFreq, now + ramp);
      v.sub.frequency.linearRampToValueAtTime(baseFreq * 0.5, now + ramp);
      v.lp.frequency.linearRampToValueAtTime(360 + rpmFrac * 1100, now + ramp);
      v.oscGain.gain.linearRampToValueAtTime(0.18 + rpmFrac * 0.14, now + ramp);
      v.subGain.gain.linearRampToValueAtTime(0.12 + rpmFrac * 0.06, now + ramp);

      v.nLP.frequency.linearRampToValueAtTime(70 + rpmFrac * 280, now + ramp);
      v.nGain.gain.linearRampToValueAtTime(0.04 + rpmFrac * 0.07, now + ramp);
    },

    reset() {
      const now = ctx.currentTime;
      const ramp = 0.05;
      for (const v of voices) {
        v.smoothRPM = 750;
        v.osc.frequency.linearRampToValueAtTime(22, now + ramp);
        v.sub.frequency.linearRampToValueAtTime(11, now + ramp);
        v.distGain.gain.linearRampToValueAtTime(0, now + ramp);
      }
    },
  };
}
