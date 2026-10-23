/*
 * IFPD game toolkit — shared by every game page. Plain script (works from file://), exposes window.IFPD.
 *
 *   IFPD.setupPage({ title, onRestart })      → { stage, extra }   top bar (Home, Restart, Sound, Fullscreen)
 *   IFPD.fitCanvas(canvas, onResize)          → { ctx, width, height }   hi-DPI canvas that tracks its parent size
 *   IFPD.loop(update(dt), render())           → { pause(), resume(), stop(), paused }   fixed 120 Hz update
 *   IFPD.pointers(el, { down, move, up }, { palmReject = true })   multi-touch tracking in element-local CSS px
 *   IFPD.sfx.play(name, { volume, pitch, pan })   realistic synthesized sound effects (see SOUNDS)
 *   IFPD.overlay.show({ title, text, buttons: [{ label, kind, onClick }] }) / hide()
 *   IFPD.toast(text, ms)   IFPD.confetti(ms)
 *   IFPD.best.get(key) / submit(key, value, higherIsBetter = true) → true if new record
 *   IFPD.texture.wood|felt|paper|ice(w, h, opts) → cached offscreen canvas
 *   IFPD.draw.roundRect(ctx, x, y, w, h, r) / ball(ctx, x, y, r, color, light) / shadow(ctx, x, y, rx, ry, alpha)
 *   IFPD.util.clamp / lerp / rand / randInt / shuffle / dist
 */
(function () {
  'use strict';

  const IFPD = {};
  const PALM_SIZE_PX = 70;

  // --- utilities -------------------------------------------------------------

  const util = {
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    lerp: (a, b, t) => a + (b - a) * t,
    rand: (a, b) => a + Math.random() * (b - a),
    randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    dist: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1),
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
  };
  IFPD.util = util;

  // --- page chrome ---------------------------------------------------------------

  IFPD.setupPage = function ({ title, onRestart, homeHref = '../index.html' }) {
    document.title = title + ' — COSMIQ Games';
    const bar = document.createElement('header');
    bar.className = 'ifpd-bar';
    bar.innerHTML = `
      <a class="ifpd-btn" href="${homeHref}" title="All games">⌂ Home</a>
      <h1></h1>
      <div class="ifpd-extra"></div>
      <button class="ifpd-btn" data-act="restart">↻ Restart</button>
      <button class="ifpd-btn" data-act="sound">🔊</button>
      <button class="ifpd-btn" data-act="fs">⛶</button>`;
    bar.querySelector('h1').textContent = title;
    document.body.prepend(bar);

    const restart = bar.querySelector('[data-act=restart]');
    if (onRestart) restart.addEventListener('click', () => onRestart());
    else restart.hidden = true;

    const soundBtn = bar.querySelector('[data-act=sound]');
    const showSound = () => { soundBtn.textContent = IFPD.sfx.muted ? '🔇' : '🔊'; };
    soundBtn.addEventListener('click', () => { IFPD.sfx.setMuted(!IFPD.sfx.muted); showSound(); });
    showSound();

    bar.querySelector('[data-act=fs]').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    });

    // Block browser gestures that fight with play on a touch panel.
    for (const ev of ['contextmenu', 'gesturestart', 'dblclick']) document.addEventListener(ev, e => e.preventDefault());
    document.addEventListener('pointerdown', () => IFPD.sfx.unlock(), { capture: true });

    let stage = document.querySelector('.ifpd-stage');
    if (!stage) {
      stage = document.createElement('main');
      stage.className = 'ifpd-stage';
      document.body.append(stage);
    }
    IFPD.stage = stage;
    return { stage, extra: bar.querySelector('.ifpd-extra') };
  };

  // --- canvas ----------------------------------------------------------------------

  IFPD.fitCanvas = function (canvas, onResize) {
    const ctx = canvas.getContext('2d');
    const view = { ctx, width: 0, height: 0, dpr: 1 };
    const apply = () => {
      const r = canvas.parentElement.getBoundingClientRect();
      const w = Math.max(1, Math.floor(r.width)), h = Math.max(1, Math.floor(r.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (w === view.width && h === view.height && dpr === view.dpr) return;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      Object.assign(view, { width: w, height: h, dpr });
      if (onResize) onResize(w, h);
    };
    new ResizeObserver(apply).observe(canvas.parentElement);
    apply();
    return view;
  };

  IFPD.loop = function (update, render) {
    const STEP = 1 / 120;
    let last = performance.now(), acc = 0, raf = 0, stopped = false;
    const ctl = { paused: false };
    const frame = now => {
      if (stopped) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!ctl.paused) {
        acc += dt;
        while (acc >= STEP) { update(STEP); acc -= STEP; }
      }
      render(ctl.paused ? 0 : acc / STEP);
    };
    ctl.pause = () => { ctl.paused = true; };
    ctl.resume = () => { ctl.paused = false; last = performance.now(); acc = 0; };
    ctl.stop = () => { stopped = true; cancelAnimationFrame(raf); };
    // Pause while hidden; resume on return only if the hide was what paused it.
    let pausedByHide = false;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (!ctl.paused) { pausedByHide = true; ctl.pause(); }
      } else if (pausedByHide) {
        pausedByHide = false;
        ctl.resume();
      }
    });
    raf = requestAnimationFrame(frame);
    return ctl;
  };

  // --- multi-touch -------------------------------------------------------------

  IFPD.isPalm = e => e.pointerType === 'touch' && Math.max(e.width || 0, e.height || 0) > PALM_SIZE_PX;

  IFPD.pointers = function (el, handlers, { palmReject = true } = {}) {
    const active = new Map();
    const local = e => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', e => {
      if (e.button > 0 && e.pointerType === 'mouse') return;
      if (palmReject && IFPD.isPalm(e)) return;
      e.preventDefault();
      const { x, y } = local(e);
      const p = { id: e.pointerId, x, y, startX: x, startY: y, prevX: x, prevY: y, t: performance.now(), data: {} };
      active.set(e.pointerId, p);
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointers */ }
      if (handlers.down && handlers.down(p, e) === false) active.delete(e.pointerId);
    });
    el.addEventListener('pointermove', e => {
      const p = active.get(e.pointerId);
      if (!p) return;
      const { x, y } = local(e);
      p.prevX = p.x; p.prevY = p.y; p.x = x; p.y = y;
      if (handlers.move) handlers.move(p, e);
    });
    const end = e => {
      const p = active.get(e.pointerId);
      if (!p) return;
      active.delete(e.pointerId);
      if (handlers.up) handlers.up(p, e);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    return active;
  };

  // --- sound effects (synthesized, no files) -------------------------------------------

  const sfx = { ctx: null, muted: localStorage.getItem('ifpd-muted') === '1' };
  let master = null, noiseBuf = null;

  sfx.unlock = function () {
    if (!sfx.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      sfx.ctx = new AC({ latencyHint: 'interactive' });
      const comp = sfx.ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.ratio.value = 8;
      master = sfx.ctx.createGain();
      master.gain.value = sfx.muted ? 0 : 0.9;
      master.connect(comp).connect(sfx.ctx.destination);
      noiseBuf = sfx.ctx.createBuffer(1, sfx.ctx.sampleRate, sfx.ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (sfx.ctx.state !== 'running') sfx.ctx.resume();
  };

  sfx.setMuted = function (m) {
    sfx.muted = m;
    localStorage.setItem('ifpd-muted', m ? '1' : '0');
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, sfx.ctx.currentTime, 0.02);
  };

  function out(pan) {
    const c = sfx.ctx;
    if (!pan || !c.createStereoPanner) return master;
    const p = c.createStereoPanner();
    p.pan.value = util.clamp(pan, -1, 1);
    p.connect(master);
    return p;
  }

  function tone(freq, dur, { type = 'sine', vol = 0.3, at = 0, glide = 0, attack = 0.003, dest } = {}) {
    const c = sfx.ctx, t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise(dur, { type = 'bandpass', freq = 1000, q = 1, vol = 0.3, at = 0, sweep = 0, attack = 0.002, dest } = {}) {
    const c = sfx.ctx, t = c.currentTime + at;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = noiseBuf;
    s.loop = true;
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    f.Q.value = q;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest || master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  // Each recipe receives (volume, pitch multiplier, destination).
  const SOUNDS = {
    tap: (v, p, d) => { noise(0.03, { freq: 3000 * p, q: 2, vol: 0.15 * v, dest: d }); tone(1600 * p, 0.04, { vol: 0.05 * v, dest: d }); },
    click: (v, p, d) => noise(0.025, { freq: 4000 * p, q: 3, vol: 0.2 * v, dest: d }),
    tick: (v, p, d) => tone(3000 * p, 0.015, { type: 'square', vol: 0.05 * v, dest: d }),
    hit: (v, p, d) => { // hard plastic knock (air-hockey mallet on puck, paddle on ball)
      noise(0.05, { freq: 1500 * p, q: 3, vol: 0.5 * v, dest: d });
      tone(700 * p, 0.07, { type: 'triangle', vol: 0.25 * v, glide: 500 * p, dest: d });
    },
    wall: (v, p, d) => { // duller rail bounce
      noise(0.07, { freq: 600 * p, q: 2, vol: 0.45 * v, dest: d });
      tone(220 * p, 0.09, { vol: 0.25 * v, glide: 150 * p, dest: d });
    },
    goal: (v, p, d) => {
      noise(0.25, { type: 'lowpass', freq: 400, vol: 0.5 * v, dest: d });
      [523, 659, 784, 1047].forEach((f, i) => tone(f * p, 0.5, { type: 'triangle', vol: 0.18 * v, at: 0.08 * i, dest: d }));
    },
    pop: (v, p, d) => { // balloon burst
      noise(0.06, { type: 'highpass', freq: 900 * p, vol: 0.7 * v, attack: 0.001, dest: d });
      tone(400 * p, 0.08, { vol: 0.25 * v, glide: 70, attack: 0.001, dest: d });
    },
    slice: (v, p, d) => noise(0.16, { freq: 1800 * p, sweep: 7000 * p, q: 1.5, vol: 0.4 * v, dest: d }),
    squish: (v, p, d) => { noise(0.12, { type: 'lowpass', freq: 900 * p, sweep: 300, vol: 0.4 * v, dest: d }); tone(180 * p, 0.12, { vol: 0.2 * v, glide: 90, dest: d }); },
    whoosh: (v, p, d) => noise(0.28, { freq: 300 * p, sweep: 1600 * p, q: 0.8, vol: 0.3 * v, attack: 0.08, dest: d }),
    correct: (v, p, d) => { tone(880 * p, 0.25, { type: 'triangle', vol: 0.25 * v, dest: d }); tone(1320 * p, 0.4, { type: 'triangle', vol: 0.25 * v, at: 0.1, dest: d }); },
    wrong: (v, p, d) => { tone(220 * p, 0.2, { type: 'sawtooth', vol: 0.12 * v, dest: d }); tone(165 * p, 0.35, { type: 'sawtooth', vol: 0.12 * v, at: 0.15, dest: d }); },
    buzzer: (v, p, d) => { tone(150 * p, 0.6, { type: 'sawtooth', vol: 0.2 * v, attack: 0.01, dest: d }); tone(152 * p, 0.6, { type: 'square', vol: 0.08 * v, attack: 0.01, dest: d }); },
    ding: (v, p, d) => { tone(1568 * p, 0.9, { vol: 0.25 * v, dest: d }); tone(3136 * p, 0.5, { vol: 0.08 * v, dest: d }); },
    win: (v, p, d) => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f * p, 0.6, { type: 'triangle', vol: 0.2 * v, at: 0.11 * i, dest: d })),
    lose: (v, p, d) => [392, 330, 262].forEach((f, i) => tone(f * p, 0.45, { type: 'triangle', vol: 0.2 * v, at: 0.22 * i, dest: d })),
    flip: (v, p, d) => noise(0.07, { freq: 2500 * p, sweep: 1200 * p, q: 1.2, vol: 0.3 * v, dest: d }),
    place: (v, p, d) => { noise(0.05, { freq: 900 * p, q: 2, vol: 0.35 * v, dest: d }); tone(300 * p, 0.06, { vol: 0.2 * v, dest: d }); },
    drop: (v, p, d) => { // disc landing in a slot
      tone(160 * p, 0.14, { vol: 0.45 * v, glide: 80 * p, dest: d });
      noise(0.08, { freq: 1200 * p, q: 2, vol: 0.3 * v, dest: d });
    },
    thud: (v, p, d) => tone(110 * p, 0.18, { vol: 0.5 * v, glide: 55 * p, dest: d }),
    whack: (v, p, d) => { tone(140 * p, 0.12, { vol: 0.5 * v, glide: 70 * p, dest: d }); noise(0.06, { freq: 700 * p, q: 1.5, vol: 0.5 * v, dest: d }); },
    snap: (v, p, d) => { noise(0.02, { freq: 2500 * p, q: 4, vol: 0.4 * v, attack: 0.001, dest: d }); tone(1200 * p, 0.03, { vol: 0.1 * v, dest: d }); },
    chalk: (v, p, d) => noise(0.08, { freq: 5000 * p, q: 0.7, vol: 0.06 * v, dest: d }),
  };

  sfx.play = function (name, { volume = 1, pitch = 1, pan = 0 } = {}) {
    if (sfx.muted || !sfx.ctx || sfx.ctx.state !== 'running' || !SOUNDS[name]) return;
    SOUNDS[name](volume, pitch, out(pan));
  };
  sfx.names = Object.keys(SOUNDS);
  IFPD.sfx = sfx;

  // --- overlay, toast, confetti ---------------------------------------------------------

  IFPD.overlay = {
    el: null,
    show({ title, text = '', buttons = [] }) {
      this.hide();
      const o = document.createElement('div');
      o.className = 'ifpd-overlay';
      o.innerHTML = '<div class="ifpd-card"><h2></h2><p></p><div class="ifpd-buttons"></div></div>';
      o.querySelector('h2').textContent = title;
      o.querySelector('p').textContent = text;
      const row = o.querySelector('.ifpd-buttons');
      let chosen = false; // two simultaneous taps must not trigger two buttons
      for (const b of buttons) {
        const btn = document.createElement('button');
        btn.className = 'ifpd-btn ' + (b.kind || 'primary');
        btn.textContent = b.label;
        btn.addEventListener('click', () => {
          if (chosen) return;
          chosen = true;
          if (this.el === o) this.hide();
          if (b.onClick) b.onClick();
        });
        row.append(btn);
      }
      (IFPD.stage || document.body).append(o);
      this.el = o;
    },
    hide() { if (this.el) { this.el.remove(); this.el = null; } },
    get visible() { return !!this.el; },
  };

  let toastTimer = 0;
  IFPD.toast = function (text, ms = 1500) {
    let t = document.querySelector('.ifpd-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'ifpd-toast';
      (IFPD.stage || document.body).append(t);
    }
    t.textContent = text;
    t.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.opacity = '0'; }, ms);
  };

  IFPD.confetti = function (ms = 2500) {
    const host = IFPD.stage || document.body;
    const c = document.createElement('canvas');
    c.className = 'ifpd-confetti';
    host.append(c);
    const r = host.getBoundingClientRect();
    c.width = r.width; c.height = r.height;
    const ctx = c.getContext('2d');
    const colors = ['#f94144', '#f9c74f', '#90be6d', '#43aa8b', '#577590', '#f3722c', '#ffffff'];
    const parts = Array.from({ length: 220 }, () => ({
      x: r.width / 2 + util.rand(-80, 80), y: r.height * 0.55,
      vx: util.rand(-650, 650), vy: util.rand(-1100, -450),
      w: util.rand(8, 16), h: util.rand(5, 10), a: util.rand(0, 6.28), va: util.rand(-10, 10),
      color: colors[util.randInt(0, colors.length - 1)],
    }));
    const start = performance.now();
    let last = start;
    const step = now => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, c.width, c.height);
      const fade = Math.max(0, 1 - (now - start - ms * 0.7) / (ms * 0.3));
      for (const p of parts) {
        p.vy += 1400 * dt; p.vx *= 0.99;
        p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.va * dt;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.a);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2 * Math.abs(Math.cos(p.a * 2)), p.w, p.h * Math.abs(Math.cos(p.a * 2)) + 1);
        ctx.restore();
      }
      if (now - start < ms) requestAnimationFrame(step); else c.remove();
    };
    requestAnimationFrame(step);
  };

  // --- best scores -------------------------------------------------------------------

  IFPD.best = {
    get(key) {
      const v = localStorage.getItem('ifpd-best-' + key);
      return v == null ? null : Number(v);
    },
    submit(key, value, higherIsBetter = true) {
      const cur = this.get(key);
      if (cur == null || (higherIsBetter ? value > cur : value < cur)) {
        localStorage.setItem('ifpd-best-' + key, String(value));
        return true;
      }
      return false;
    },
  };

  // --- procedural textures (cached) ------------------------------------------------------

  const texCache = new Map();
  function cached(key, w, h, paint) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const k = key + ':' + w + 'x' + h;
    if (texCache.has(k)) return texCache.get(k);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    paint(c.getContext('2d'), w, h);
    texCache.set(k, c);
    return c;
  }

  function speckle(ctx, w, h, amount, alpha) {
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * amount;
      d[i] += n; d[i + 1] += n; d[i + 2] += n; d[i + 3] = 255 * alpha + d[i + 3] * (1 - alpha);
    }
    ctx.putImageData(img, 0, 0);
  }

  IFPD.texture = {
    // Planks with grain lines and knots.
    wood(w, h, { base = '#8a5a32', dark = '#5e3a1e', planks = 0, vertical = false } = {}) {
      return cached(`wood${base}${dark}${planks}${vertical}`, w, h, (ctx) => {
        const L = vertical ? h : w, S = vertical ? w : h;
        ctx.save();
        if (vertical) { ctx.translate(w, 0); ctx.rotate(Math.PI / 2); }
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, L, S);
        const n = planks || Math.max(1, Math.round(S / 140));
        const ph = S / n;
        for (let p = 0; p < n; p++) {
          const y0 = p * ph;
          const tint = util.rand(-12, 12);
          ctx.fillStyle = `rgba(${tint > 0 ? 255 : 0},${tint > 0 ? 220 : 0},${tint > 0 ? 160 : 0},${Math.abs(tint) / 120})`;
          ctx.fillRect(0, y0, L, ph);
          ctx.strokeStyle = dark;
          for (let g = 0; g < ph / 3; g++) {
            const gy = y0 + util.rand(0, ph);
            ctx.globalAlpha = util.rand(0.05, 0.22);
            ctx.lineWidth = util.rand(0.5, 2);
            ctx.beginPath();
            const amp = util.rand(1, 5), freq = util.rand(0.002, 0.01), off = util.rand(0, 100);
            for (let x = 0; x <= L; x += 8) {
              const yy = gy + Math.sin(x * freq + off) * amp;
              if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
            }
            ctx.stroke();
          }
          for (let k = 0; k < L / 400; k++) { // knots
            const kx = util.rand(0, L), ky = y0 + util.rand(ph * 0.2, ph * 0.8), kr = util.rand(4, 10);
            const gr = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr * 2.5);
            gr.addColorStop(0, dark); gr.addColorStop(1, 'transparent');
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = gr;
            ctx.beginPath(); ctx.ellipse(kx, ky, kr * 2.5, kr, 0, 0, 7); ctx.fill();
          }
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = '#00000055';
          ctx.fillRect(0, y0, L, 1.5);
          ctx.globalAlpha = 1;
        }
        ctx.restore();
        speckle(ctx, w, h, 14, 0);
      });
    },
    // Fine fibrous cloth (card table, pool table).
    felt(w, h, { color = '#1f6b3a' } = {}) {
      return cached('felt' + color, w, h, (ctx) => {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, w, h);
        speckle(ctx, w, h, 22, 0);
        const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
        g.addColorStop(0, 'rgba(255,255,255,0.06)');
        g.addColorStop(1, 'rgba(0,0,0,0.35)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      });
    },
    // Off-white paper with faint fibres.
    paper(w, h, { color = '#f4f0e6' } = {}) {
      return cached('paper' + color, w, h, (ctx) => {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, w, h);
        speckle(ctx, w, h, 10, 0);
        ctx.strokeStyle = 'rgba(120,100,70,0.05)';
        for (let i = 0; i < (w * h) / 4000; i++) {
          const x = util.rand(0, w), y = util.rand(0, h), a = util.rand(0, 6.28), l = util.rand(4, 14);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
        }
      });
    },
    // Glossy white playfield (air hockey table).
    ice(w, h, { color = '#eef4fa' } = {}) {
      return cached('ice' + color, w, h, (ctx) => {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, w, h);
        speckle(ctx, w, h, 6, 0);
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, 'rgba(255,255,255,0.35)');
        g.addColorStop(0.5, 'rgba(255,255,255,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.08)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      });
    },
  };

  // --- drawing helpers -----------------------------------------------------------------

  IFPD.draw = {
    roundRect(ctx, x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    },
    // Shaded sphere / glossy disc lit from the top-left.
    ball(ctx, x, y, r, color, light = 0.55) {
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      g.addColorStop(0, shadeColor(color, light));
      g.addColorStop(0.55, color);
      g.addColorStop(1, shadeColor(color, -0.45));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.ellipse(x - r * 0.3, y - r * 0.45, r * 0.32, r * 0.18, -0.5, 0, Math.PI * 2);
      ctx.fill();
    },
    shadow(ctx, x, y, rx, ry, alpha = 0.35) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
      g.addColorStop(0, `rgba(0,0,0,${alpha})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, ry / rx);
      ctx.translate(-x, -y);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
    shade: (c, amt) => shadeColor(c, amt),
  };

  // Lighten (amt > 0) or darken (amt < 0) a #rrggbb colour.
  function shadeColor(hex, amt) {
    const v = parseInt(hex.replace('#', '').slice(0, 6), 16);
    const ch = s => {
      const c = (v >> s) & 255;
      return Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
    };
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  }

  window.IFPD = IFPD;
})();
