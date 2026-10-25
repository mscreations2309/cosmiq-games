/*
 * Guitar — realistic acoustic guitar for touch panels (and camera mode via the shared input layer).
 *
 *  - Sound: Karplus–Strong plucked-string synthesis (rendered once per note), pick-position comb,
 *    register-dependent sustain, then an acoustic body EQ + small room reverb. One voice per string,
 *    like a real guitar: re-plucking a string replaces its previous sound.
 *  - Play: tap a string on the neck = that fret; swipe across the strings over the body = strum;
 *    chord pads set a chord shape (and strum it). Songs: demo play or learn the chord changes.
 */
(function () {
  'use strict';

  const { clamp, lerp } = IFPD.util;

  // --- music data ----------------------------------------------------------------------------

  const TUNING = [40, 45, 50, 55, 59, 64];            // E2 A2 D3 G3 B3 E4 (low E drawn on top)
  const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];
  const CHORDS = {                                      // fret per string, low E → high e; -1 = not played
    C: [-1, 3, 2, 0, 1, 0], G: [3, 2, 0, 0, 0, 3], D: [-1, -1, 0, 2, 3, 2],
    Am: [-1, 0, 2, 2, 1, 0], Em: [0, 2, 2, 0, 0, 0], E: [0, 2, 2, 1, 0, 0],
    A: [-1, 0, 2, 2, 2, 0], F: [-1, -1, 3, 2, 1, 1], Dm: [-1, -1, 0, 2, 3, 1],
  };
  const CHORD_LABEL = { C: 'C major', G: 'G major', D: 'D major', Am: 'A minor', Em: 'E minor', E: 'E major', A: 'A major', F: 'F major', Dm: 'D minor' };
  const PAD_ORDER = ['C', 'G', 'D', 'Am', 'Em', 'E', 'A', 'F', 'Dm'];

  // Song lines: [chord, beats, lyric]
  const TWINKLE_A = [['C', 4, 'Twinkle twinkle'], ['F', 2, 'little'], ['C', 2, 'star,']];
  const TWINKLE_B = [['F', 2, 'how I'], ['C', 2, 'wonder'], ['G', 2, 'what you'], ['C', 2, 'are.']];
  const SONGS = [
    {
      title: 'Twinkle Twinkle Little Star', bpm: 100,
      lines: [TWINKLE_A, TWINKLE_B,
        [['C', 2, 'Up a-'], ['F', 2, 'bove the'], ['C', 2, 'world so'], ['G', 2, 'high,']],
        [['C', 2, 'Like a'], ['F', 2, 'diamond'], ['C', 2, 'in the'], ['G', 2, 'sky.']],
        TWINKLE_A, TWINKLE_B],
    },
    {
      title: 'Happy Birthday', bpm: 120,
      lines: [
        [['C', 3, 'Happy birthday'], ['G', 3, 'to you,']],
        [['G', 3, 'Happy birthday'], ['C', 3, 'to you,']],
        [['C', 3, 'Happy birthday'], ['F', 3, 'dear student,']],
        [['C', 3, 'Happy birthday'], ['G', 2, 'to'], ['C', 3, 'you!']],
      ],
    },
  ];

  // --- sound ---------------------------------------------------------------------------------

  const audio = {
    ctx: null, input: null, voices: [null, null, null, null, null, null], cache: new Map(),

    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      const c = this.ctx = new AC({ latencyHint: 'interactive' });
      // Acoustic body: low air/top resonances, a little presence, softened string fizz.
      const eq = [
        ['peaking', 105, 5, 1.3], ['peaking', 210, 3, 1.5], ['peaking', 2800, 2, 1.0], ['highshelf', 7000, -6, 0.7],
      ].map(([type, f, gain, q]) => {
        const b = c.createBiquadFilter();
        b.type = type; b.frequency.value = f; b.gain.value = gain; b.Q.value = q;
        return b;
      });
      this.input = c.createGain();
      let node = this.input;
      for (const b of eq) { node.connect(b); node = b; }
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -8; comp.ratio.value = 6;
      const verb = c.createConvolver();
      verb.buffer = roomImpulse(c, 1.3);
      const send = c.createGain();
      send.gain.value = 0.16;
      node.connect(comp);
      node.connect(send).connect(verb).connect(comp);
      comp.connect(c.destination);
    },

    get ready() { return !!this.ctx && this.ctx.state === 'running'; },

    resume() {
      this.init();
      if (this.ctx.state !== 'running') this.ctx.resume().then(updateSoundNotice, () => {});
    },

    buffer(midi, bright) {
      const key = midi * 2 + (bright ? 1 : 0);
      let buf = this.cache.get(key);
      if (!buf) {
        const data = renderString(midi, bright ? 0.82 : 0.4, this.ctx.sampleRate);
        buf = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
        buf.copyToChannel(data, 0);
        this.cache.set(key, buf);
      }
      return buf;
    },

    pluck(string, midi, velocity, when = 0) {
      if (IFPD.sfx.muted) return;
      this.init();
      if (!this.ready) {
        // First real tap: audio is waking up, so play this one pluck once it runs.
        // Without a real tap (e.g. camera input before any touch) audio stays blocked: show the notice.
        const activated = !navigator.userActivation || navigator.userActivation.isActive;
        if (activated && !this.waking) {
          this.waking = true;
          this.ctx.resume().then(() => {
            this.waking = false;
            if (this.ready) this.pluck(string, midi, velocity, when);
            updateSoundNotice();
          }, () => { this.waking = false; updateSoundNotice(); });
        } else {
          updateSoundNotice();
        }
        return;
      }
      const c = this.ctx;
      const t = Math.max(c.currentTime, c.currentTime + when);
      const prev = this.voices[string];
      if (prev) { // a new pluck stops the string's previous vibration
        prev.gain.gain.setTargetAtTime(0, t, 0.012);
        try { prev.src.stop(t + 0.1); } catch (_) { /* already stopped */ }
      }
      const src = c.createBufferSource();
      src.buffer = this.buffer(midi, velocity > 0.6);
      const gain = c.createGain();
      gain.gain.value = 0.18 + 0.62 * Math.pow(velocity, 1.4);
      const pan = c.createStereoPanner ? c.createStereoPanner() : null;
      src.connect(gain);
      if (pan) { pan.pan.value = (string - 2.5) * 0.08; gain.connect(pan).connect(this.input); } else gain.connect(this.input);
      src.start(t);
      const voice = { src, gain };
      src.onended = () => { if (this.voices[string] === voice) this.voices[string] = null; };
      this.voices[string] = voice;
    },
  };

  // Karplus–Strong with fractional delay, pick-position comb and per-note sustain.
  function renderString(midi, brightness, sr) {
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const t60 = clamp(7 * Math.pow(2, -(midi - 40) / 16), 1.1, 7);   // low strings sustain longer
    const n = Math.floor(Math.min(t60 + 0.4, 6.5) * sr);
    const out = new Float32Array(n);
    const D = sr / f - 0.5;                    // the two-point average adds half a sample of delay
    const Di = Math.floor(D), frac = D - Di;
    const g = Math.pow(10, -3 / (t60 * f));     // loop gain per period for the wanted T60
    const P = Di + 2;

    // Excitation: filtered noise burst, darker when plucked softly, with the pick-position notch.
    const exc = new Float32Array(P);
    let lp = 0;
    const coef = 0.12 + 0.8 * brightness;
    for (let i = 0; i < P; i++) {
      lp += coef * ((Math.random() * 2 - 1) - lp);
      exc[i] = lp;
    }
    const pick = Math.max(1, Math.round(P * 0.14));
    for (let i = P - 1; i >= pick; i--) exc[i] -= exc[i - pick];

    const read = i => (i < 0 ? 0 : out[i]);
    for (let i = 0; i < n; i++) {
      const a = (1 - frac) * read(i - Di) + frac * read(i - Di - 1);
      const b = (1 - frac) * read(i - Di - 1) + frac * read(i - Di - 2);
      out[i] = (i < P ? exc[i] : 0) + g * 0.5 * (a + b);
    }

    // DC block, normalise, short fade-out at the end.
    let x1 = 0, y1 = 0, peak = 1e-9;
    for (let i = 0; i < n; i++) {
      const y = out[i] - x1 + 0.995 * y1;
      x1 = out[i]; y1 = y; out[i] = y;
      peak = Math.max(peak, Math.abs(y));
    }
    const fade = Math.floor(0.2 * sr);
    for (let i = 0; i < n; i++) out[i] = (out[i] / peak) * 0.9 * (i > n - fade ? (n - i) / fade : 1);
    return out;
  }

  function roomImpulse(c, seconds) {
    const len = Math.floor(c.sampleRate * seconds);
    const ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp += 0.35 * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * Math.exp(-6.9 * i / len);
      }
    }
    return ir;
  }

  // --- page + state --------------------------------------------------------------------------

  const { stage, extra } = IFPD.setupPage({ title: 'Guitar', onRestart: () => { stopSong(); selectChord(null); } });
  const canvas = document.getElementById('game');
  let geo = null, bg = null; // must exist before fitCanvas, which calls layout() immediately
  const view = IFPD.fitCanvas(canvas, layout);
  const ctx = view.ctx;

  const S = {
    chord: null,                 // selected chord name or null (open strings)
    neck: new Map(),             // pointerId -> { string, fret } held on the neck
    vib: TUNING.map(() => ({ amp: 0, t: 0 })),
    ripples: [],
    padStrum: true,
    song: null, mode: 'idle', index: 0, items: [], timers: [], lastAdvance: 0,
    plucks: [],                  // recent pluck times (for "a strum happened" detection)
  };

  // --- geometry ------------------------------------------------------------------------------

  function layout(w, h) {
    const top = h * 0.16, bottom = h * 0.82, gh = bottom - top, cy = top + gh / 2;
    const x0 = w * 0.105, L = w * 0.83;
    const sh = { x: w * 0.705, y: cy, r: Math.min(w * 0.056, gh * 0.21) };
    const fbEnd = sh.x - sh.r - w * 0.012;
    const fretX = n => x0 + L * (1 - Math.pow(2, -n / 12));
    let maxFret = 1;
    while (fretX(maxFret + 1) < fbEnd) maxFret++;
    geo = {
      w, h, top, bottom, gh, cy, x0, L, fretX, maxFret, fbEnd, sh,
      bridgeX: x0 + L,
      halfNut: gh * 0.115, halfEnd: gh * 0.15,
      spreadNut: gh * 0.18, spreadBridge: gh * 0.34,
      strumX0: fbEnd, strumX1: x0 + L - w * 0.02,
    };
    bg = renderBackground();
  }

  function spreadAt(x) {
    const u = clamp((x - geo.x0) / geo.L, 0, 1);
    return lerp(geo.spreadNut, geo.spreadBridge, u);
  }
  function stringY(s, x) { return geo.cy + (s - 2.5) * spreadAt(x) / 5; }
  function stringWidth(s) { return lerp(4.2, 1.6, s / 5) * Math.max(0.8, geo.gh / 700); }
  function fretCenter(f) { return f <= 0 ? geo.x0 - geo.w * 0.012 : (geo.fretX(f - 1) + geo.fretX(f)) / 2; }

  function nearestString(x, y, tol) {
    const gap = spreadAt(x) / 5;
    let best = -1, bestD = gap * tol;
    for (let s = 0; s < 6; s++) {
      const d = Math.abs(y - stringY(s, x));
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  function fretAt(x) {
    if (x < geo.x0) return 0;
    for (let f = 1; f <= geo.maxFret; f++) if (x < geo.fretX(f)) return f;
    return geo.maxFret;
  }

  function region(x, y) {
    if (y < geo.top - 10 || y > geo.bottom + 10) return null;
    if (x >= geo.x0 - geo.w * 0.05 && x < geo.fbEnd) return 'neck';
    if (x >= geo.strumX0 && x <= geo.strumX1) return 'strum';
    return null;
  }

  // Fret that string s sounds at right now: a finger on the neck wins, then the chord shape.
  function currentFret(s) {
    let held = -1;
    for (const h of S.neck.values()) if (h.string === s) held = Math.max(held, h.fret);
    if (held >= 0) return held;
    if (S.chord) return CHORDS[S.chord][s];
    return 0;
  }

  // --- playing -------------------------------------------------------------------------------

  function pluck(s, velocity, when = 0, fret = currentFret(s)) {
    if (fret < 0) return; // muted string in this chord shape
    audio.pluck(s, TUNING[s] + fret, velocity, when);
    S.vib[s] = { amp: 2.5 + 6 * velocity, t: performance.now() + when * 1000, fret };
    S.plucks.push(performance.now());
    if (S.plucks.length > 12) S.plucks.shift();
    checkLearnStrum();
  }

  function strum(down = true, velocity = 0.8, gapSec = 0.014) {
    const order = down ? [0, 1, 2, 3, 4, 5] : [5, 4, 3, 2];
    let k = 0;
    for (const s of order) {
      if (currentFret(s) < 0) continue;
      pluck(s, velocity * (down ? 1 : 0.85), k * gapSec);
      k++;
    }
  }

  function selectChord(name) {
    S.chord = name;
    for (const b of padEls) b.classList.toggle('active', b.dataset.chord === (name || ''));
  }

  IFPD.pointers(canvas, {
    down(p, e) {
      audio.resume();
      const r = region(p.x, p.y);
      if (r === 'neck') {
        const s = nearestString(p.x, p.y, 0.62);
        if (s < 0) return false;
        const fret = fretAt(p.x);
        p.data = { kind: 'neck', string: s, fret };
        S.neck.set(p.id, { string: s, fret });
        pluck(s, 0.75, 0, fret);
        ripple(p.x, stringY(s, p.x));
        return true;
      }
      if (r === 'strum') {
        p.data = { kind: 'strum', t: performance.now() };
        const s = nearestString(p.x, p.y, 0.4);
        if (s >= 0) { pluck(s, 0.7); ripple(p.x, stringY(s, p.x)); }
        return true;
      }
      return false;
    },
    move(p) {
      const now = performance.now();
      if (p.data.kind === 'neck') {
        // Sliding along the neck to another fret or string re-sounds the note there.
        const s = nearestString(p.x, p.y, 0.62);
        const fret = fretAt(p.x);
        if (s >= 0 && (s !== p.data.string || fret !== p.data.fret) && region(p.x, p.y) === 'neck') {
          p.data.string = s; p.data.fret = fret;
          S.neck.set(p.id, { string: s, fret });
          pluck(s, 0.55, 0, fret);
        }
        return;
      }
      // Strum: pluck every string the finger crossed since the last event, in crossing order.
      const dt = Math.max(0.004, (now - p.data.t) / 1000);
      p.data.t = now;
      const dy = p.y - p.prevY;
      if (Math.abs(dy) < 0.5 || region(p.x, p.y) !== 'strum') return;
      const vel = clamp(Math.abs(dy) / dt / 2600, 0.35, 1);
      const crossed = [];
      for (let s = 0; s < 6; s++) {
        const ys = stringY(s, p.x);
        if ((p.prevY - ys) * (p.y - ys) <= 0 && p.prevY !== ys) crossed.push({ s, f: (ys - p.prevY) / dy });
      }
      crossed.sort((a, b) => a.f - b.f);
      for (const c of crossed) {
        pluck(c.s, vel, Math.min(0.03, c.f * dt));
        ripple(p.x, stringY(c.s, p.x));
      }
    },
    up(p) {
      if (p.data.kind === 'neck') S.neck.delete(p.id);
    },
  });

  function ripple(x, y) { S.ripples.push({ x, y, t: performance.now() }); }

  // --- chord pads ----------------------------------------------------------------------------

  const padsEl = document.getElementById('pads');
  const padEls = [];
  const PAD_KEYS = { '': 'P', C: 'Q', G: 'W', D: 'E', Am: 'R', Em: 'T', E: 'Y', A: 'U', F: 'I', Dm: 'O' };
  for (const name of ['', ...PAD_ORDER]) {
    const b = document.createElement('button');
    b.className = 'pad' + (name ? '' : ' open');
    b.dataset.chord = name;
    b.tabIndex = -1; // played with their letter keys, not Tab
    b.innerHTML = (name ? `${name}<small>${CHORD_LABEL[name]}</small>` : 'Open<small>no chord</small>') +
      `<kbd>${PAD_KEYS[name]}</kbd>`;
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      audio.resume();
      selectChord(name || null);
      if (S.padStrum) strum(true, 0.8);
    });
    padsEl.append(b);
    padEls.push(b);
  }
  selectChord(null);

  // --- keyboard ------------------------------------------------------------------------------

  const KEY_TO_CHORD = {};
  for (const [chord, letter] of Object.entries(PAD_KEYS)) KEY_TO_CHORD['Key' + letter] = chord;

  CosmiqInput.keys.on(e => {
    if (e.type !== 'keydown' || e.repeat) return;
    if (e.code in KEY_TO_CHORD) {
      e.preventDefault();
      audio.resume();
      const name = KEY_TO_CHORD[e.code];
      selectChord(name || null);
      if (S.padStrum) strum(true, 0.8);
    } else if (e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault();
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
      audio.resume();
      strum(e.code !== 'ArrowUp', 0.8);
    } else if (/^Digit[1-6]$/.test(e.code)) {
      e.preventDefault();
      audio.resume();
      const s = Number(e.code.slice(5)) - 1;
      pluck(s, 0.75);
      ripple(fretCenter(Math.max(1, currentFret(s))), stringY(s, fretCenter(Math.max(1, currentFret(s)))));
    }
  });
  CosmiqInput.keys.help('Guitar keys', [
    ['Q W E R T Y U I O', 'Chords C G D Am Em E A F Dm'],
    ['P', 'Open strings (no chord)'],
    ['Space ↓', 'Strum down'],
    ['↑', 'Strum up'],
    ['1 2 3 4 5 6', 'Pluck one string (low E → high e)'],
    ['Tab Enter', 'Song, Play, Learn, Stop buttons'],
  ], { corner: 'top-right' });

  // --- songs (demo + learn) --------------------------------------------------------------------

  const songSelect = document.createElement('select');
  songSelect.className = 'ifpd-btn';
  SONGS.forEach((s, i) => songSelect.add(new Option(s.title, String(i))));
  const mkBtn = (label, fn) => {
    const b = document.createElement('button');
    b.className = 'ifpd-btn';
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  };
  const playBtn = mkBtn('▶ Play', () => playSong(SONGS[songSelect.value]));
  const learnBtn = mkBtn('🎓 Learn', () => learnSong(SONGS[songSelect.value]));
  const stopBtn = mkBtn('■ Stop', () => stopSong());
  const padBtn = mkBtn('', () => { S.padStrum = !S.padStrum; showPadMode(); });
  const showPadMode = () => { padBtn.textContent = S.padStrum ? 'Pads strum: On' : 'Pads strum: Off'; };
  showPadMode();
  extra.append(songSelect, playBtn, learnBtn, stopBtn, padBtn);

  function flatten(song) {
    const items = [];
    song.lines.forEach((line, li) => line.forEach(([chord, beats, lyric]) => items.push({ chord, beats, lyric, line: li })));
    return items;
  }

  function playSong(song) {
    stopSong();
    audio.resume();
    S.song = song; S.items = flatten(song); S.mode = 'play'; S.index = 0;
    const beat = 60000 / song.bpm;
    let t = 500;
    S.items.forEach((it, i) => {
      S.timers.push(setTimeout(() => { S.index = i; selectChord(it.chord); renderBanner(); }, t));
      const strums = Math.max(1, Math.round(it.beats));
      for (let k = 0; k < strums; k++) {
        const at = t + k * (it.beats / strums) * beat;
        const down = k % 2 === 0;
        S.timers.push(setTimeout(() => strum(down, k === 0 ? 0.85 : 0.6), at));
      }
      t += it.beats * beat;
    });
    S.timers.push(setTimeout(() => finishSong(), t + 400));
    renderBanner();
  }

  function learnSong(song) {
    stopSong();
    audio.resume();
    S.song = song; S.items = flatten(song); S.mode = 'learn'; S.index = 0; S.lastAdvance = performance.now();
    S.plucks = [];
    renderBanner();
  }

  function stopSong() {
    S.timers.forEach(clearTimeout);
    S.timers = [];
    S.mode = 'idle';
    renderBanner();
  }

  function finishSong() {
    S.timers.forEach(clearTimeout);
    S.timers = [];
    S.mode = 'done';
    renderBanner();
    IFPD.confetti(2200);
    IFPD.sfx.play('win', { volume: 0.6 });
    S.timers.push(setTimeout(() => { if (S.mode === 'done') stopSong(); }, 3500));
  }

  // In learn mode a strum (3+ strings within a quarter second) of the right chord moves on.
  function checkLearnStrum() {
    if (S.mode !== 'learn') return;
    const now = performance.now();
    if (now - S.lastAdvance < 350) return;
    const recent = S.plucks.filter(t => now - t < 250).length;
    if (recent < 3) return;
    const want = S.items[S.index];
    if (S.chord !== want.chord) { renderBanner(`That's ${S.chord || 'no chord'} — tap the ${want.chord} pad first.`); return; }
    S.lastAdvance = now;
    S.index++;
    if (S.index >= S.items.length) finishSong();
    else renderBanner();
  }

  function renderBanner(hintOverride) {
    const banner = document.getElementById('banner');
    const title = banner.querySelector('.b-title');
    const lyrics = banner.querySelector('.b-lyrics');
    const hint = banner.querySelector('.b-hint');
    for (const b of padEls) b.classList.remove('target');
    if (S.mode === 'idle') {
      title.textContent = 'Tap a chord, then swipe across the strings over the soundhole to strum';
      lyrics.textContent = '';
      hint.textContent = 'Or tap any string on the neck to play a single note';
      return;
    }
    if (S.mode === 'done') {
      title.textContent = S.song.title;
      lyrics.textContent = '🎉 Well done!';
      hint.textContent = '';
      return;
    }
    title.textContent = (S.mode === 'learn' ? '🎓 Learning: ' : '▶ ') + S.song.title;
    const cur = S.items[S.index];
    lyrics.innerHTML = '';
    S.items.forEach((it, i) => {
      if (it.line !== cur.line) return;
      const span = document.createElement('span');
      span.className = i < S.index ? 'sung' : i === S.index ? 'now' : '';
      const ch = document.createElement('span');
      ch.className = 'chord';
      ch.textContent = it.chord;
      span.append(ch, document.createTextNode(it.lyric));
      lyrics.append(span);
    });
    if (S.mode === 'learn') {
      const pad = padEls.find(b => b.dataset.chord === cur.chord);
      if (pad) pad.classList.add('target');
      hint.textContent = hintOverride || `Tap ${cur.chord}, then strum   ·   ${S.index + 1} / ${S.items.length}`;
    } else {
      hint.textContent = '';
    }
  }
  renderBanner();

  // --- sound notice (browsers may block audio until a real tap) ---------------------------------

  const notice = document.getElementById('soundNotice');
  function updateSoundNotice() { notice.hidden = !audio.ctx || audio.ready; }
  notice.addEventListener('click', () => { audio.resume(); setTimeout(updateSoundNotice, 300); });
  document.addEventListener('pointerdown', e => { if (e.isTrusted) audio.resume(); }, { capture: true });
  audio.init();
  audio.resume();
  setTimeout(updateSoundNotice, 600);

  // --- drawing -------------------------------------------------------------------------------

  function renderBackground() {
    const { w, h } = geo;
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // same rule as IFPD.fitCanvas
    const c = document.createElement('canvas');
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Table / wall: dark walnut with a vignette.
    g.drawImage(IFPD.texture.wood(w, h, { base: '#3b2416', dark: '#1e110a', planks: 6 }), 0, 0, w, h);
    const vg = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);

    drawBody(g);
    drawNeck(g);
    drawHeadstock(g);
    return c;
  }

  function drawBody(g) {
    const { w, gh, cy, sh, bridgeX } = geo;
    const upper = { x: w * 0.665, rx: w * 0.13, ry: gh * 0.42 };
    const lower = { x: w * 0.87, rx: w * 0.17, ry: gh * 0.52 };
    const bodyPath = grow => {
      g.beginPath();
      g.ellipse(upper.x, cy, upper.rx + grow, upper.ry + grow, 0, 0, Math.PI * 2);
      g.ellipse(lower.x, cy, lower.rx + grow, lower.ry + grow, 0, 0, Math.PI * 2);
    };
    // Drop shadow, cream binding, then the sunburst top.
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 40; g.shadowOffsetY = 18;
    g.fillStyle = '#1a0d06';
    bodyPath(6); g.fill('nonzero');
    g.restore();
    g.fillStyle = '#efe2c4';
    bodyPath(5); g.fill('nonzero');
    const sb = g.createRadialGradient(sh.x + w * 0.06, cy, gh * 0.08, sh.x + w * 0.08, cy, w * 0.26);
    sb.addColorStop(0, '#f2c46b');
    sb.addColorStop(0.45, '#d4882b');
    sb.addColorStop(0.75, '#7a3b12');
    sb.addColorStop(1, '#2a1006');
    g.fillStyle = sb;
    bodyPath(0); g.fill('nonzero');
    // Fine spruce grain along the body.
    g.save();
    bodyPath(0); g.clip('nonzero');
    g.strokeStyle = 'rgba(80,40,10,0.10)';
    g.lineWidth = 1;
    for (let y = geo.top - 40; y < geo.bottom + 40; y += 3 + Math.random() * 4) {
      g.beginPath(); g.moveTo(upper.x - upper.rx, y); g.lineTo(w * 1.05, y + Math.random() * 2 - 1); g.stroke();
    }
    // Gloss highlight.
    const gl = g.createLinearGradient(0, geo.top, 0, geo.bottom);
    gl.addColorStop(0, 'rgba(255,255,255,0.18)');
    gl.addColorStop(0.35, 'rgba(255,255,255,0)');
    g.fillStyle = gl;
    g.fillRect(upper.x - upper.rx, geo.top - 60, w, gh + 120);
    g.restore();

    // Pickguard (tortoiseshell teardrop below the soundhole).
    g.save();
    const pg = g.createLinearGradient(sh.x, cy, sh.x + sh.r * 2, cy + sh.r * 2.6);
    pg.addColorStop(0, '#3a1608'); pg.addColorStop(0.5, '#6b2a0e'); pg.addColorStop(1, '#2a0f05');
    g.fillStyle = pg;
    g.beginPath();
    g.moveTo(sh.x - sh.r * 0.2, cy + sh.r * 1.15);
    g.bezierCurveTo(sh.x + sh.r * 0.4, cy + sh.r * 2.9, sh.x + sh.r * 2.6, cy + sh.r * 2.7, sh.x + sh.r * 2.1, cy + sh.r * 1.0);
    g.bezierCurveTo(sh.x + sh.r * 1.6, cy + sh.r * 0.2, sh.x + sh.r * 0.8, cy + sh.r * 0.9, sh.x - sh.r * 0.2, cy + sh.r * 1.15);
    g.fill();
    g.restore();

    // Soundhole with rosette rings.
    g.save();
    [[1.38, '#2b1408'], [1.3, '#e9dcc0'], [1.24, '#1c0b04'], [1.17, '#c8a46a'], [1.12, '#1c0b04']].forEach(([k, col]) => {
      g.fillStyle = col;
      g.beginPath(); g.arc(sh.x, sh.y, sh.r * k, 0, Math.PI * 2); g.fill();
    });
    const hole = g.createRadialGradient(sh.x - sh.r * 0.2, sh.y - sh.r * 0.2, sh.r * 0.1, sh.x, sh.y, sh.r);
    hole.addColorStop(0, '#1a0d06'); hole.addColorStop(1, '#000');
    g.fillStyle = hole;
    g.beginPath(); g.arc(sh.x, sh.y, sh.r, 0, Math.PI * 2); g.fill();
    g.restore();

    // Bridge with saddle and pins.
    const bh = geo.spreadBridge * 1.55, bw = w * 0.036;
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 10; g.shadowOffsetX = 4; g.shadowOffsetY = 4;
    const br = g.createLinearGradient(bridgeX - bw * 0.3, 0, bridgeX + bw, 0);
    br.addColorStop(0, '#2a140a'); br.addColorStop(0.5, '#4a2614'); br.addColorStop(1, '#1d0d06');
    g.fillStyle = br;
    IFPD.draw.roundRect(g, bridgeX - bw * 0.35, cy - bh / 2, bw * 1.3, bh, bw * 0.3);
    g.fill();
    g.restore();
    g.fillStyle = '#f3ecdc';
    g.fillRect(bridgeX - 2, cy - geo.spreadBridge * 0.62, 4, geo.spreadBridge * 1.24);
    for (let s = 0; s < 6; s++) {
      const y = stringY(s, bridgeX);
      IFPD.draw.ball(g, bridgeX + bw * 0.5, y, Math.max(3, bw * 0.12), '#f1e7d0', 0.4);
    }
  }

  function drawNeck(g) {
    const { x0, fbEnd, cy, halfNut, halfEnd, fretX, maxFret, w } = geo;
    // Fretboard (rosewood) as a slightly widening trapezoid.
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 18; g.shadowOffsetY = 8;
    g.beginPath();
    g.moveTo(x0, cy - halfNut); g.lineTo(fbEnd, cy - halfEnd); g.lineTo(fbEnd, cy + halfEnd); g.lineTo(x0, cy + halfNut);
    g.closePath();
    g.fillStyle = '#2b1a12';
    g.fill();
    g.restore();
    g.save();
    g.beginPath();
    g.moveTo(x0, cy - halfNut); g.lineTo(fbEnd, cy - halfEnd); g.lineTo(fbEnd, cy + halfEnd); g.lineTo(x0, cy + halfNut);
    g.closePath();
    g.clip();
    g.drawImage(IFPD.texture.wood(fbEnd - x0, halfEnd * 2 + 4, { base: '#3a2216', dark: '#160b06', planks: 1 }), x0, cy - halfEnd - 2);
    const shade = g.createLinearGradient(0, cy - halfEnd, 0, cy + halfEnd);
    shade.addColorStop(0, 'rgba(255,255,255,0.10)'); shade.addColorStop(0.5, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = shade;
    g.fillRect(x0, cy - halfEnd, fbEnd - x0, halfEnd * 2);

    // Inlay dots.
    const half = x => lerp(halfNut, halfEnd, (x - x0) / (fbEnd - x0));
    for (const f of [3, 5, 7, 9, 12, 15, 17, 19]) {
      if (f > maxFret) continue;
      const x = fretCenter(f), r = Math.max(5, half(x) * 0.13);
      const ys = f === 12 ? [cy - half(x) * 0.45, cy + half(x) * 0.45] : [cy];
      for (const y of ys) IFPD.draw.ball(g, x, y, r, '#efe6d2', 0.5);
    }
    // Frets (nickel wire with highlight).
    for (let f = 1; f <= maxFret; f++) {
      const x = fretX(f), hh = half(x);
      g.fillStyle = '#6d6d6d'; g.fillRect(x - 2, cy - hh, 4, hh * 2);
      g.fillStyle = '#e8e8e8'; g.fillRect(x - 1, cy - hh, 1.4, hh * 2);
    }
    g.restore();

    // Fret numbers under the neck.
    g.fillStyle = 'rgba(240,225,200,0.75)';
    g.font = `600 ${Math.round(Math.max(13, w * 0.0085))}px "Segoe UI", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (const f of [1, 3, 5, 7, 9, 12, 15, 17]) if (f <= maxFret) g.fillText(String(f), fretCenter(f), cy + halfEnd + 8);

    // Bone nut.
    g.fillStyle = '#efe6cf';
    g.fillRect(x0 - 6, cy - halfNut - 2, 8, halfNut * 2 + 4);
  }

  function drawHeadstock(g) {
    const { x0, cy, halfNut, w } = geo;
    const hx = w * 0.015, hw = x0 - 6 - hx;
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 16; g.shadowOffsetY = 8;
    const hg = g.createLinearGradient(0, cy - halfNut * 1.9, 0, cy + halfNut * 1.9);
    hg.addColorStop(0, '#3a1c0e'); hg.addColorStop(0.5, '#5a2d16'); hg.addColorStop(1, '#2a1209');
    g.fillStyle = hg;
    g.beginPath();
    g.moveTo(x0 - 6, cy - halfNut);
    g.lineTo(hx + hw * 0.15, cy - halfNut * 1.75);
    g.quadraticCurveTo(hx - 4, cy, hx + hw * 0.15, cy + halfNut * 1.75);
    g.lineTo(x0 - 6, cy + halfNut);
    g.closePath();
    g.fill();
    g.restore();
    // Tuning posts and pegs (3 per side).
    for (let s = 0; s < 6; s++) {
      const side = s < 3 ? -1 : 1;
      const k = s < 3 ? s : 5 - s;
      const px = hx + hw * (0.3 + k * 0.24);
      const py = cy + side * halfNut * 0.95;
      IFPD.draw.ball(g, px, cy + side * halfNut * 2.05, Math.max(7, halfNut * 0.22), '#c9b27a', 0.5);
      g.fillStyle = '#9a8a5a';
      g.fillRect(px - 3, Math.min(py, cy + side * halfNut * 1.8), 6, Math.abs(cy + side * halfNut * 1.8 - py));
      IFPD.draw.ball(g, px, py, Math.max(4, halfNut * 0.1), '#d9d9d9', 0.6);
    }
  }

  function postPos(s) {
    const { x0, cy, halfNut, w } = geo;
    const hx = w * 0.015, hw = x0 - 6 - hx;
    const side = s < 3 ? -1 : 1;
    const k = s < 3 ? s : 5 - s;
    return { x: hx + hw * (0.3 + k * 0.24), y: cy + side * halfNut * 0.95 };
  }

  function render() {
    if (!geo) return;
    const { w, h } = geo;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(bg, 0, 0, w, h);
    const now = performance.now();

    drawShapeMarkers(now);

    // Strings: headstock post → nut → (finger) → bridge. The vibrating part wobbles.
    for (let s = 0; s < 6; s++) {
      const wound = s < 3;
      const lw = stringWidth(s);
      const col = wound ? '#c8a35a' : '#dadde2';
      const post = postPos(s);
      const nutY = stringY(s, geo.x0);
      ctx.lineCap = 'round';
      ctx.strokeStyle = col; ctx.lineWidth = lw * 0.9;
      ctx.beginPath(); ctx.moveTo(post.x, post.y); ctx.lineTo(geo.x0 - 4, nutY); ctx.stroke();

      const v = S.vib[s];
      const age = (now - v.t) / 1000;
      const amp = age < 0 ? 0 : v.amp * Math.exp(-age / 1.1);
      const fret = currentFret(s);
      const startX = fret > 0 ? geo.fretX(fret) : geo.x0;
      if (fret > 0) { // the stopped part between nut and fret does not vibrate
        ctx.beginPath(); ctx.moveTo(geo.x0, nutY); ctx.lineTo(startX, stringY(s, startX)); ctx.stroke();
      }
      const steps = 48, phase = Math.sin(now * 0.09 + s * 1.7);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 3;
      ctx.strokeStyle = col; ctx.lineWidth = lw;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const x = lerp(startX, geo.bridgeX, u);
        const y = stringY(s, x) + (amp > 0.05 ? amp * Math.sin(Math.PI * u) * phase : 0);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
      if (wound) { // winding texture
        ctx.strokeStyle = 'rgba(80,60,20,0.35)'; ctx.lineWidth = lw * 0.35;
        ctx.setLineDash([1.5, 2.5]);
        ctx.beginPath(); ctx.moveTo(startX, stringY(s, startX)); ctx.lineTo(geo.bridgeX, stringY(s, geo.bridgeX)); ctx.stroke();
        ctx.setLineDash([]);
      }
      // String name just past the bridge, where nothing else is drawn.
      ctx.fillStyle = 'rgba(60,25,8,0.85)';
      ctx.font = `700 ${Math.round(Math.max(13, w * 0.009))}px "Segoe UI", sans-serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(STRING_NAMES[s], geo.bridgeX + geo.w * 0.04, stringY(s, geo.bridgeX));
    }

    // Fingers currently held on the neck.
    for (const hold of S.neck.values()) {
      const x = fretCenter(hold.fret), y = stringY(hold.string, x);
      ctx.fillStyle = 'rgba(255,170,60,0.9)';
      ctx.beginPath(); ctx.arc(x, y, Math.max(10, spreadAt(x) / 5 * 0.42), 0, Math.PI * 2); ctx.fill();
    }

    // Pluck ripples.
    S.ripples = S.ripples.filter(r => now - r.t < 450);
    for (const r of S.ripples) {
      const k = (now - r.t) / 450;
      ctx.strokeStyle = `rgba(255,230,170,${0.6 * (1 - k)})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(r.x, r.y, 8 + 40 * k, 0, Math.PI * 2); ctx.stroke();
    }

    // Strum zone hint.
    if (!S.ripples.length && S.mode !== 'play') {
      ctx.fillStyle = 'rgba(255,240,210,0.35)';
      ctx.font = `600 ${Math.round(Math.max(14, w * 0.01))}px "Segoe UI", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('↕ strum here', geo.sh.x + geo.sh.r * 1.6, geo.cy + geo.spreadBridge * 0.75);
    }
  }

  // Chord shape on the neck: green dots on fretted notes, ○ open, ✕ not played.
  function drawShapeMarkers(now) {
    if (!S.chord) return;
    const shape = CHORDS[S.chord];
    const pulse = 0.85 + 0.15 * Math.sin(now / 180);
    for (let s = 0; s < 6; s++) {
      const f = shape[s];
      const xm = geo.x0 - geo.w * 0.022;
      const ym = stringY(s, geo.x0);
      const size = Math.max(9, geo.spreadNut / 5 * 0.36);
      if (f < 0) {
        ctx.strokeStyle = '#ff6b5b'; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(xm - size * 0.6, ym - size * 0.6); ctx.lineTo(xm + size * 0.6, ym + size * 0.6);
        ctx.moveTo(xm + size * 0.6, ym - size * 0.6); ctx.lineTo(xm - size * 0.6, ym + size * 0.6);
        ctx.stroke();
      } else if (f === 0) {
        ctx.strokeStyle = '#6fe39b'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(xm, ym, size * 0.6, 0, Math.PI * 2); ctx.stroke();
      } else {
        const x = fretCenter(f), y = stringY(s, x);
        const r = Math.max(11, spreadAt(x) / 5 * 0.45) * pulse;
        ctx.save();
        ctx.shadowColor = '#2ecc71'; ctx.shadowBlur = 14;
        ctx.fillStyle = '#2ecc71';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
    // Chord name over the neck.
    ctx.fillStyle = 'rgba(111,227,155,0.95)';
    ctx.font = `800 ${Math.round(Math.max(28, geo.w * 0.024))}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(S.chord, fretCenter(2), geo.cy - geo.halfNut - 12);
  }

  IFPD.loop(() => {}, render);

  // Debug hook for automated tests.
  window.__game = {
    S, CHORDS, TUNING, audio, strum, selectChord, playSong, learnSong, stopSong, SONGS, currentFret,
    geo: () => geo, stringY, fretCenter,
    stageRect: () => canvas.getBoundingClientRect(),
  };
})();
