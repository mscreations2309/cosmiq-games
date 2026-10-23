/*
 * KeyboardView — canvas-rendered 88-key keyboard with multi-touch input.
 *
 *  - real-size mode (23.5 mm white keys from the panel's diagonal) or N-keys-fit-to-width
 *  - per-pointer tracking: many fingers / several players at once
 *  - glissando: sliding across keys re-strikes each key passed, including skipped white keys
 *  - optional palm rejection and several velocity strategies (touch frames rarely report pressure)
 *  - navigator strip to scroll when not all 88 keys fit
 */
(function (P) {
  'use strict';

  const BLACK_PCS = new Set([1, 3, 6, 8, 10]);
  // Black keys sit off-centre between their white neighbours, like on a real keyboard.
  const BLACK_OFFSET = { 1: -0.1, 3: 0.1, 6: -0.13, 8: 0, 10: 0.13 };
  const WHITE_COUNT = { 88: 52, 61: 36, 49: 29, 37: 22, 25: 15 };
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const SOURCE_COLOR = { touch: '#5aa9ff', midi: '#5fd27a', playback: '#ffbe4d', computer: '#b88cff' };
  const WHITE_KEY_MM = 23.5;
  const KEY_LENGTH_RATIO = 6.4;   // white key length / width (150 mm / 23.5 mm)
  const BLACK_WIDTH = 0.58;
  const BLACK_LENGTH = 0.63;
  const NAV_HEIGHT = 28;
  const PALM_SIZE_PX = 70;

  const isBlack = n => BLACK_PCS.has(n % 12);
  const WHITE_NOTES = [];
  for (let n = P.MIN_NOTE; n <= P.MAX_NOTE; n++) if (!isBlack(n)) WHITE_NOTES.push(n);
  const WHITE_INDEX = new Map(WHITE_NOTES.map((n, i) => [n, i]));
  const BLACK_NOTES = [];
  for (let n = P.MIN_NOTE; n <= P.MAX_NOTE; n++) if (isBlack(n)) BLACK_NOTES.push(n);

  class KeyboardView {
    constructor({ container, router, settings, onInputSample }) {
      this.container = container;
      this.router = router;
      this.settings = settings;
      this.onInputSample = onInputSample || (() => {});

      this.nav = document.createElement('canvas');
      this.nav.className = 'kb-nav';
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'kb-keys';
      container.append(this.nav, this.canvas);

      this.pointers = new Map(); // pointerId -> { note, velocity }
      this.scroll = 0;
      this.centerNote = 60;      // middle C starts centred
      this.redrawQueued = false;

      this._bindKeys();
      this._bindNav();
      router.subscribe(() => this.requestRedraw());
      new ResizeObserver(() => this.relayout()).observe(container);
    }

    relayout() {
      const s = this.settings;
      const viewW = this.container.clientWidth;
      if (!viewW) return;

      if (s.keysVisible === 'real') {
        const cssPxPerInch = Math.hypot(screen.width, screen.height) / s.screenInches;
        this.w = (WHITE_KEY_MM / 25.4) * cssPxPerInch;
      } else {
        this.w = viewW / WHITE_COUNT[s.keysVisible];
      }
      this.total = this.w * WHITE_NOTES.length;
      this.viewW = viewW;
      this.offsetX = Math.max(0, (viewW - this.total) / 2);
      this.showNav = this.total > viewW + 1;

      const availH = this.container.clientHeight - (this.showNav ? NAV_HEIGHT : 0);
      this.keyH = Math.max(60, Math.min(availH, this.w * KEY_LENGTH_RATIO));
      this.blackH = this.keyH * BLACK_LENGTH;

      sizeCanvas(this.canvas, viewW, this.keyH);
      this.nav.style.display = this.showNav ? 'block' : 'none';
      if (this.showNav) sizeCanvas(this.nav, viewW, NAV_HEIGHT);

      this._scrollToCenter(this.centerNote);
      this.requestRedraw();
    }

    requestRedraw() {
      if (this.redrawQueued || !this.w) return; // not laid out yet (e.g. hidden second keyboard)
      this.redrawQueued = true;
      requestAnimationFrame(() => {
        this.redrawQueued = false;
        this._drawKeys();
        if (this.showNav) this._drawNav();
      });
    }

    // --- geometry ----------------------------------------------------------

    _scrollToCenter(note) {
      const x = this._whiteX(WHITE_INDEX.get(isBlack(note) ? note - 1 : note)) + this.w / 2;
      this._setScroll(x - this.viewW / 2);
    }

    _setScroll(px) {
      this.scroll = Math.max(0, Math.min(Math.max(0, this.total - this.viewW), px));
      const mid = (this.scroll + this.viewW / 2) / this.w;
      this.centerNote = WHITE_NOTES[Math.max(0, Math.min(WHITE_NOTES.length - 1, Math.floor(mid)))];
    }

    // Keyboard-space x (before scroll) of a white key's left edge.
    _whiteX(i) { return i * this.w; }

    _blackRect(note) {
      const left = WHITE_INDEX.get(note - 1);
      const cx = (left + 1) * this.w + BLACK_OFFSET[note % 12] * this.w;
      const bw = this.w * BLACK_WIDTH;
      return { x: cx - bw / 2, w: bw };
    }

    _hit(x, y) {
      const kx = x - this.offsetX + this.scroll;
      if (kx < 0 || kx >= this.total || y < 0 || y > this.keyH) return null;
      const i = Math.floor(kx / this.w);
      if (y < this.blackH) {
        const white = WHITE_NOTES[i];
        for (const n of [white + 1, white - 1]) {
          if (n < P.MIN_NOTE || n > P.MAX_NOTE || !isBlack(n)) continue;
          const r = this._blackRect(n);
          if (kx >= r.x && kx < r.x + r.w) return n;
        }
      }
      return WHITE_NOTES[i];
    }

    // --- input -------------------------------------------------------------

    _bindKeys() {
      const c = this.canvas;
      c.addEventListener('contextmenu', e => e.preventDefault());

      c.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (this.settings.palmReject && e.pointerType === 'touch' && Math.max(e.width, e.height) > PALM_SIZE_PX) return;
        const { x, y } = local(c, e);
        const note = this._hit(x, y);
        if (note == null) return;
        c.setPointerCapture(e.pointerId);
        const velocity = this._velocity(e, note, y);
        this.pointers.set(e.pointerId, { note, velocity });
        this.router.noteOn(note, velocity, 'touch');
        this.onInputSample({
          delayMs: performance.now() - e.timeStamp,
          width: e.width, height: e.height, pressure: e.pressure, type: e.pointerType, velocity,
        });
      });

      c.addEventListener('pointermove', e => {
        const p = this.pointers.get(e.pointerId);
        if (!p) return;
        const { x, y } = local(c, e);
        const note = this._hit(x, y);
        if (note == null || note === p.note) return;
        this._glideWhites(p.note, note, p.velocity);
        this.router.noteOff(p.note, 'touch');
        this.router.noteOn(note, p.velocity, 'touch');
        p.note = note;
      });

      const end = e => {
        const p = this.pointers.get(e.pointerId);
        if (!p) return;
        this.pointers.delete(e.pointerId);
        this.router.noteOff(p.note, 'touch');
      };
      c.addEventListener('pointerup', end);
      c.addEventListener('pointercancel', end);
      c.addEventListener('lostpointercapture', end);
    }

    // A fast slide can jump over white keys between two events; a real glissando sounds them all.
    _glideWhites(from, to, velocity) {
      if (isBlack(from) || isBlack(to)) return;
      const a = WHITE_INDEX.get(from), b = WHITE_INDEX.get(to);
      const step = b > a ? 1 : -1;
      for (let i = a + step; i !== b; i += step) {
        const n = WHITE_NOTES[i];
        this.router.noteOn(n, velocity, 'touch');
        setTimeout(() => this.router.noteOff(n, 'touch'), 80);
      }
    }

    _velocity(e, note, y) {
      const s = this.settings;
      const clamp01 = v => Math.max(0, Math.min(1, v));
      switch (s.velocityMode) {
        case 'position': { // nearer the front edge = harder, like striking further down the key
          const h = isBlack(note) ? this.blackH : this.keyH;
          return 25 + clamp01(y / h) * 102;
        }
        case 'contact': {
          const size = Math.max(e.width || 0, e.height || 0);
          if (size <= 1) return s.fixedVelocity; // touch frame does not report contact size
          return 30 + clamp01((size - 8) / 40) * 97;
        }
        case 'pressure':
          if (e.pressure > 0 && e.pressure !== 0.5) return 15 + clamp01(e.pressure) * 112;
          return s.fixedVelocity; // 0.5 means "pressure not supported"
        default:
          return s.fixedVelocity;
      }
    }

    _bindNav() {
      const n = this.nav;
      const move = e => {
        const { x } = local(n, e);
        this._setScroll((x / this.viewW) * this.total - this.viewW / 2);
        this.requestRedraw();
      };
      n.addEventListener('pointerdown', e => { n.setPointerCapture(e.pointerId); move(e); });
      n.addEventListener('pointermove', e => { if (n.hasPointerCapture(e.pointerId)) move(e); });
    }

    // --- drawing -----------------------------------------------------------

    _drawKeys() {
      const ctx = this.canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.viewW, this.keyH);

      const x0 = this.offsetX - this.scroll;
      const w = this.w, h = this.keyH;
      const first = Math.max(0, Math.floor(-x0 / w));
      const last = Math.min(WHITE_NOTES.length - 1, Math.ceil((this.viewW - x0) / w));
      const r = Math.min(6, w * 0.12);

      const whiteGrad = ctx.createLinearGradient(0, 0, 0, h);
      whiteGrad.addColorStop(0, '#f2f2ef');
      whiteGrad.addColorStop(0.85, '#ffffff');
      whiteGrad.addColorStop(1, '#dcdcd8');

      for (let i = first; i <= last; i++) {
        const note = WHITE_NOTES[i];
        const x = x0 + i * w;
        const down = this.router.isDown(note);
        ctx.fillStyle = down ? SOURCE_COLOR[this.router.sourceOf(note)] || SOURCE_COLOR.touch : whiteGrad;
        roundRectBottom(ctx, x + 0.5, 0, w - 1, h - (down ? 0 : 2), r);
        ctx.fill();
        ctx.strokeStyle = '#8b8b88';
        ctx.lineWidth = 1;
        ctx.stroke();
        this._label(ctx, note, x, w, h, false, down);
      }

      for (const note of BLACK_NOTES) {
        const br = this._blackRect(note);
        const x = x0 + br.x;
        if (x + br.w < 0 || x > this.viewW) continue;
        const down = this.router.isDown(note);
        const bh = this.blackH - (down ? 0 : 3);
        if (down) {
          ctx.fillStyle = shade(SOURCE_COLOR[this.router.sourceOf(note)] || SOURCE_COLOR.touch);
        } else {
          const g = ctx.createLinearGradient(x, 0, x + br.w, 0);
          g.addColorStop(0, '#111');
          g.addColorStop(0.5, '#3a3a3a');
          g.addColorStop(1, '#111');
          ctx.fillStyle = g;
        }
        roundRectBottom(ctx, x, 0, br.w, bh, r * 0.6);
        ctx.fill();
        if (!down) { // bevel highlight at the front of the key
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.fillRect(x + br.w * 0.15, bh - bh * 0.08, br.w * 0.7, bh * 0.05);
        }
        this._label(ctx, note, x, br.w, bh, true, down);
      }

      for (const note of this.router.guide) this._drawGuide(ctx, note, x0);

      // Felt strip above the keys.
      ctx.fillStyle = '#6b1d1d';
      ctx.fillRect(Math.max(0, x0), 0, Math.min(this.viewW, x0 + this.total) - Math.max(0, x0), Math.max(2, h * 0.012));
    }

    // "Press this key next" marker used by the song teacher: green outline plus a dot with the note name.
    _drawGuide(ctx, note, x0) {
      if (note < P.MIN_NOTE || note > P.MAX_NOTE) return;
      const black = isBlack(note);
      let x, w, h;
      if (black) {
        const br = this._blackRect(note);
        x = x0 + br.x; w = br.w; h = this.blackH;
      } else {
        x = x0 + WHITE_INDEX.get(note) * this.w; w = this.w; h = this.keyH;
      }
      if (x + w < 0 || x > this.viewW) return;
      ctx.save();
      ctx.shadowColor = '#2ecc71';
      ctx.shadowBlur = 18;
      ctx.strokeStyle = '#2ecc71';
      ctx.lineWidth = Math.max(3, this.w * 0.1);
      roundRectBottom(ctx, x + 2, 2, w - 4, h - 4, Math.min(6, w * 0.12));
      ctx.stroke();
      const r = Math.max(8, this.w * 0.34);
      const cy = h - (black ? r * 1.4 : this.w * 0.95);
      ctx.fillStyle = '#2ecc71';
      ctx.beginPath();
      ctx.arc(x + w / 2, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(r * 1.05)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(NAMES[note % 12], x + w / 2, cy + 1);
      ctx.restore();
    }

    _label(ctx, note, x, w, h, black, down) {
      const mode = this.settings.labels;
      if (mode === 'off' || this.w < 16) return; // too small to read
      const pc = note % 12;
      if (mode === 'c' && pc !== 0) return;
      if (black && mode !== 'all') return;
      const text = black ? NAMES[pc] : NAMES[pc] + (Math.floor(note / 12) - 1);
      ctx.font = `${Math.max(9, w * (black ? 0.36 : 0.3))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = black ? (down ? '#000' : '#ddd') : (pc === 0 ? '#c0392b' : '#555');
      ctx.fillText(text, x + w / 2, h - w * 0.25);
    }

    _drawNav() {
      const ctx = this.nav.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = this.viewW, H = NAV_HEIGHT, mw = W / WHITE_NOTES.length;
      ctx.fillStyle = '#1b1b1f';
      ctx.fillRect(0, 0, W, H);
      WHITE_NOTES.forEach((n, i) => {
        ctx.fillStyle = this.router.isDown(n) ? SOURCE_COLOR[this.router.sourceOf(n)] : '#e8e8e8';
        ctx.fillRect(i * mw + 0.5, 2, mw - 1, H - 4);
      });
      for (const n of BLACK_NOTES) {
        const left = WHITE_INDEX.get(n - 1);
        ctx.fillStyle = this.router.isDown(n) ? SOURCE_COLOR[this.router.sourceOf(n)] : '#222';
        ctx.fillRect((left + 1) * mw - mw * 0.3, 2, mw * 0.6, (H - 4) * 0.6);
      }
      const wx = (this.scroll / this.total) * W, ww = (this.viewW / this.total) * W;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, wx, H);
      ctx.fillRect(wx + ww, 0, W - wx - ww, H);
      ctx.strokeStyle = '#5aa9ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(wx + 1, 1, ww - 2, H - 2);
    }
  }

  function sizeCanvas(c, w, h) {
    const dpr = window.devicePixelRatio || 1;
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }

  function local(el, e) {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function roundRectBottom(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.closePath();
  }

  function shade(hex) {
    const v = parseInt(hex.slice(1), 16);
    const f = c => Math.round(c * 0.6);
    return `rgb(${f(v >> 16)},${f((v >> 8) & 255)},${f(v & 255)})`;
  }

  P.KeyboardView = KeyboardView;
})(window.Piano = window.Piano || {});
