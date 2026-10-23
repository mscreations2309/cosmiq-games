/*
 * SynthBank — builds a piano sample bank procedurally so the prototype works with no sample files.
 *
 * Physical traits modelled per note:
 *   - inharmonic partials (stiff strings): f_k = k * f0 * sqrt(1 + B k^2)
 *   - hammer strike position notches + velocity-dependent brightness
 *   - two-stage decay (fast "prompt sound", long "aftersound")
 *   - two slightly detuned unison strings → beating and stereo width
 *   - short filtered hammer noise
 *
 * Roots every 3 semitones × 3 velocity layers; the engine pitch-shifts neighbours.
 */
(function (P) {
  'use strict';

  const ROOT_STEP = 3;
  const LAYERS = [
    { lovel: 1, hivel: 50, vel: 38 },
    { lovel: 51, hivel: 95, vel: 78 },
    { lovel: 96, hivel: 127, vel: 120 },
  ];

  /*
   * Resolves as soon as the middle velocity layer exists (playable everywhere, since the engine
   * falls back to the nearest zone); the soft and hard layers keep filling in afterwards.
   * `bank.complete` resolves when everything is rendered.
   */
  async function generate(ctx, onProgress) {
    const roots = [];
    for (let r = P.MIN_NOTE; r <= P.MAX_NOTE; r += ROOT_STEP) roots.push(r);

    const bank = { name: 'Built-in modelled piano', zones: [], releaseZones: [], panSpread: 0.6 };
    const [soft, mid, hard] = LAYERS;
    await renderLayer(ctx, bank.zones, roots, mid, onProgress);
    bank.complete = (async () => {
      await renderLayer(ctx, bank.zones, roots, hard);
      await renderLayer(ctx, bank.zones, roots, soft);
    })();
    return bank;
  }

  async function renderLayer(ctx, zones, roots, layer, onProgress) {
    let done = 0;
    for (const root of roots) {
      const { left, right, sr } = renderNote(root, layer.vel, ctx.sampleRate);
      const buffer = ctx.createBuffer(2, left.length, sr); // Web Audio resamples on playback
      buffer.copyToChannel(left, 0);
      buffer.copyToChannel(right, 1);
      zones.push({
        buffer,
        root,
        lokey: Math.max(P.MIN_NOTE, root - 1),
        hikey: Math.min(P.MAX_NOTE, root + 1),
        lovel: layer.lovel,
        hivel: layer.hivel,
        tune: 0,
        gain: 0.5,
        velTrack: 0.9,
      });
      done++;
      if (onProgress) onProgress(done / roots.length);
      await new Promise(r => setTimeout(r, 0)); // keep the UI responsive
    }
  }

  function renderNote(note, velocity, maxSr) {
    const f0 = 440 * Math.pow(2, (note - 69) / 12);
    const v = velocity / 127;
    const t0 = 12 * Math.pow(2, -(note - P.MIN_NOTE) / 21); // bass rings ~12 s, top ~0.7 s

    const B = 0.00007 * Math.pow(2, (note - P.MIN_NOTE) / 12 * 0.9); // inharmonicity grows toward treble
    const tilt = 2.3 - 1.2 * v;              // harder strike → flatter spectrum
    const cutoff = 1200 + 7000 * v * v;      // and more high-frequency energy
    const strikePos = 1 / 7.3;               // hammer hits ~1/7 along the string
    const detune = 0.0003 + 0.0005 * hash(note);

    const partials = [];
    for (let k = 1; k <= 48; k++) {
      const fk = k * f0 * Math.sqrt(1 + B * k * k);
      if (fk > maxSr * 0.45) break;
      const a = Math.pow(k, -tilt)
        * (0.15 + Math.abs(Math.sin(Math.PI * k * strikePos)))
        / (1 + (fk / cutoff) * (fk / cutoff));
      if (a >= 1e-4) partials.push({ k, fk, a });
    }

    // Bass notes have no energy up high, so render them at a lower rate: far less work and RAM.
    const fTop = partials.length ? partials[partials.length - 1].fk : f0;
    const sr = Math.min(maxSr, Math.max(16000, Math.ceil(fTop / 0.45 / 1000) * 1000));
    const dur = Math.min(10, Math.max(1.2, t0 * 1.4));
    const n = Math.floor(dur * sr);
    const L = new Float32Array(n);
    const R = new Float32Array(n);

    for (const { k, fk, a } of partials) {
      const tk = t0 / (1 + fk / 900 + 0.04 * (k - 1)); // higher partials die faster
      const dFast = Math.exp(-1 / (sr * tk * 0.3));
      const dSlow = Math.exp(-1 / (sr * tk * 1.5));

      for (let s = 0; s < 2; s++) {
        const w = 2 * Math.PI * fk * (s === 0 ? 1 - detune : 1 + detune) / sr;
        const c2 = 2 * Math.cos(w);
        let y1 = Math.sin(-w), y2 = Math.sin(-2 * w); // sine oscillator by recurrence, y[0] = 0
        let eFast = 0.7 * a, eSlow = 0.3 * a;
        const gl = s === 0 ? 0.62 : 0.38, gr = 1 - gl;
        for (let i = 0; i < n; i++) {
          const y = c2 * y1 - y2;
          y2 = y1; y1 = y;
          const e = (eFast + eSlow) * y;
          L[i] += e * gl;
          R[i] += e * gr;
          eFast *= dFast;
          eSlow *= dSlow;
          if (eSlow < 1e-6 && eFast < 1e-6) break;
        }
      }
    }

    // Hammer felt noise.
    const noiseLen = Math.floor(sr * (0.004 + 0.006 * (1 - v)));
    const coef = 0.15 + 0.6 * v;
    let lp = 0, seed = note * 7919 + velocity;
    for (let i = 0; i < noiseLen; i++) {
      seed = (seed * 16807) % 2147483647;
      lp += coef * ((seed / 1073741823.5 - 1) - lp);
      const env = Math.pow(1 - i / noiseLen, 2) * (0.02 + 0.06 * v);
      L[i] += lp * env;
      R[i] += lp * env;
    }

    let peak = 1e-9;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const scale = 0.9 / peak;
    const fade = Math.floor(sr * 0.05);
    for (let i = 0; i < n; i++) {
      const tail = i > n - fade ? (n - i) / fade : 1;
      L[i] *= scale * tail;
      R[i] *= scale * tail;
    }
    return { left: L, right: R, sr };
  }

  function hash(x) {
    const s = Math.sin(x * 12.9898) * 43758.5453;
    return s - Math.floor(s);
  }

  P.SynthBank = { generate };
})(window.Piano = window.Piano || {});
