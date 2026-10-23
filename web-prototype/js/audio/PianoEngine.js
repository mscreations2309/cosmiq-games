/*
 * PianoEngine — polyphonic sample-playback engine on top of Web Audio.
 *
 * Mirrors what the Android (Oboe/C++) engine will do:
 *   - zones (sample + key range + velocity range) chosen per note-on
 *   - pitch-shifting from the nearest sampled root
 *   - re-strike, voice stealing, sustain pedal, damper release, release samples
 *   - shared reverb used for room sound and as a cheap sympathetic-resonance stand-in
 */
(function (P) {
  'use strict';

  // On an acoustic piano the top ~1.5 octaves have no dampers: they ring out after key-up.
  const NO_DAMPER_FROM = 89; // F6

  const MIN_NOTE = 21;  // A0
  const MAX_NOTE = 108; // C8

  class PianoEngine {
    constructor() {
      this.ctx = null;
      this.bank = null;
      this.voices = [];          // active voices, oldest first
      this.keysDown = new Set(); // keys physically held (decides what pedal-up releases)
      this.lastVelocity = new Map();
      this.sustain = false;
      this.maxVoices = 128;
      this.reverbAmount = 0.25;
      this.resonanceBoost = 0.12; // extra reverb send while the pedal is down
      this.volume = 0.8;
    }

    async init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      const c = this.ctx;

      this.voiceBus = c.createGain();
      this.dry = c.createGain();
      this.reverbSend = c.createGain();
      this.convolver = c.createConvolver();
      this.convolver.buffer = makeImpulse(c, 2.4);

      // Used as a safety limiter so many loud notes with pedal never clip.
      this.limiter = c.createDynamicsCompressor();
      this.limiter.threshold.value = -6;
      this.limiter.knee.value = 6;
      this.limiter.ratio.value = 12;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.15;

      this.master = c.createGain();

      this.voiceBus.connect(this.dry).connect(this.limiter);
      this.voiceBus.connect(this.reverbSend).connect(this.convolver).connect(this.limiter);
      this.limiter.connect(this.master).connect(c.destination);
      this._applyMix(0);
    }

    async resume() {
      if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume();
    }

    setBank(bank) {
      this.allNotesOff(true);
      this.bank = bank;
    }

    setVolume(v) { this.volume = v; this._applyMix(0.05); }
    setReverb(v) { this.reverbAmount = v; this._applyMix(0.05); }

    noteOn(note, velocity) {
      if (!this.ctx || !this.bank) return;
      const zone = findZone(this.bank.zones, note, velocity);
      if (!zone) return;
      const now = this.ctx.currentTime;

      this.keysDown.add(note);
      this.lastVelocity.set(note, velocity);

      // Re-striking a sounding key: the hammer hits the same strings, so the old sound is choked fast.
      for (const v of this.voices) {
        if (v.note === note && !v.ending) this._fadeOut(v, now, 0.03);
      }
      while (this._liveVoiceCount() >= this.maxVoices) this._stealVoice(now);

      const v = this._startZone(zone, note, velocity, now);
      v.attackVelocity = velocity;
    }

    noteOff(note) {
      if (!this.ctx) return;
      this.keysDown.delete(note);
      if (this.sustain) return; // pedal holds the dampers up; released on pedal-up
      this._damp(note, this.ctx.currentTime);
    }

    setSustain(on) {
      if (!this.ctx || on === this.sustain) return;
      this.sustain = on;
      this._applyMix(on ? 0.15 : 0.4);
      if (!on) {
        const now = this.ctx.currentTime;
        const notes = new Set(this.voices.filter(v => !v.released).map(v => v.note));
        for (const n of notes) if (!this.keysDown.has(n)) this._damp(n, now);
      }
    }

    allNotesOff(immediate = false) {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      this.keysDown.clear();
      for (const v of this.voices) this._fadeOut(v, now, immediate ? 0.005 : 0.08);
    }

    get activeVoices() { return this._liveVoiceCount(); }

    // --- internals -------------------------------------------------------

    _startZone(zone, note, velocity, when) {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = zone.buffer;
      src.playbackRate.value = Math.pow(2, (note - zone.root + zone.tune / 100) / 12);

      const amp = c.createGain();
      const level = velocityGain(velocity, zone.velTrack) * zone.gain;
      amp.gain.setValueAtTime(0, when);
      amp.gain.linearRampToValueAtTime(level, when + 0.002);
      src.connect(amp);

      // Synth banks are mono-imaged per note; spread them like a real keyboard (bass left, treble right).
      const spread = this.bank.panSpread || 0;
      if (spread > 0 && c.createStereoPanner) {
        const pan = c.createStereoPanner();
        pan.pan.value = spread * (note - 64.5) / 43.5;
        amp.connect(pan).connect(this.voiceBus);
      } else {
        amp.connect(this.voiceBus);
      }

      const voice = { note, src, amp, released: false, ending: false };
      src.onended = () => {
        const i = this.voices.indexOf(voice);
        if (i >= 0) this.voices.splice(i, 1);
        amp.disconnect();
      };
      src.start(when);
      this.voices.push(voice);
      return voice;
    }

    // Dampers fall on the strings of `note`.
    _damp(note, now) {
      let damped = false;
      for (const v of this.voices) {
        if (v.note !== note || v.released || v.ending) continue;
        v.released = true;
        if (note >= NO_DAMPER_FROM) continue; // no damper: let it ring
        this._fadeOut(v, now, damperTime(note), false);
        damped = true;
      }
      if (damped) this._playRelease(note, now);
    }

    _playRelease(note, now) {
      const zones = this.bank.releaseZones;
      if (!zones || !zones.length) return;
      const vel = this.lastVelocity.get(note) || 64;
      const zone = findZone(zones, note, vel);
      if (!zone) return;
      const v = this._startZone(zone, note, vel, now);
      v.released = true; // release noises are never damped again
    }

    _fadeOut(v, now, tau, ending = true) {
      const g = v.amp.gain;
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
      else { g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); }
      g.setTargetAtTime(0, now, tau);
      try { v.src.stop(now + tau * 8); } catch (_) { /* already stopped */ }
      if (ending) v.ending = true;
      v.released = true;
    }

    _liveVoiceCount() {
      let n = 0;
      for (const v of this.voices) if (!v.ending) n++;
      return n;
    }

    // Prefer stealing the oldest already-released voice; otherwise the oldest voice.
    _stealVoice(now) {
      const victim = this.voices.find(v => !v.ending && v.released) || this.voices.find(v => !v.ending);
      if (victim) this._fadeOut(victim, now, 0.01);
    }

    _applyMix(rampTime) {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const send = this.reverbAmount + (this.sustain ? this.resonanceBoost : 0);
      this.reverbSend.gain.setTargetAtTime(send, now, Math.max(rampTime, 0.001));
      this.dry.gain.setTargetAtTime(1 - this.reverbAmount * 0.4, now, 0.02);
      this.master.gain.setTargetAtTime(this.volume, now, 0.02);
    }
  }

  // SFZ-style velocity curve: track=1 → (v/127)^2, track=0 → velocity has no effect on gain.
  function velocityGain(velocity, track) {
    const t = track == null ? 1 : track;
    const x = Math.max(1, Math.min(127, velocity)) / 127;
    return (1 - t) + t * x * x;
  }

  // Bass dampers are heavier and the strings carry more energy → slower damping.
  function damperTime(note) {
    const x = (Math.min(Math.max(note, MIN_NOTE), NO_DAMPER_FROM) - MIN_NOTE) / (NO_DAMPER_FROM - MIN_NOTE);
    return 0.16 - 0.11 * x;
  }

  function findZone(zones, note, velocity) {
    let fallback = null, best = Infinity;
    for (const z of zones) {
      if (note >= z.lokey && note <= z.hikey) {
        if (velocity >= z.lovel && velocity <= z.hivel) return z;
      }
      const d = Math.abs(z.root - note) * 200 + Math.abs((z.lovel + z.hivel) / 2 - velocity);
      if (d < best) { best = d; fallback = z; }
    }
    return fallback;
  }

  // Algorithmic stereo hall impulse: early reflections + darkening exponential tail.
  function makeImpulse(ctx, seconds) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const preDelay = Math.floor(rate * 0.012);
    const ir = ctx.createBuffer(2, len, rate);
    const taps = [0.007, 0.011, 0.017, 0.023, 0.031, 0.041];
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = preDelay; i < len; i++) {
        const t = (i - preDelay) / rate;
        const coef = 0.85 - 0.7 * (i / len); // tail gets darker over time
        lp += coef * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * Math.exp(-6.9 * t / seconds) * 0.5;
      }
      for (let k = 0; k < taps.length; k++) {
        const i = preDelay + Math.floor(rate * taps[k] * (ch ? 1.13 : 1));
        if (i < len) d[i] += (ch ? -1 : 1) * 0.35 / (k + 1);
      }
    }
    return ir;
  }

  P.PianoEngine = PianoEngine;
  P.MIN_NOTE = MIN_NOTE;
  P.MAX_NOTE = MAX_NOTE;
})(window.Piano = window.Piano || {});
