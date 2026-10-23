/* Draw & Guess — team Pictionary on a realistic whiteboard / chalkboard. */
(function () {
  'use strict';

  const { util } = IFPD;
  const WORDS = window.PICTIONARY_WORDS || { easy: {}, medium: {}, hard: {} };
  const CATEGORIES = Object.keys(WORDS.easy);
  const LW = 1600, LH = 1000;                  // logical board size (strokes are stored in these units)
  const SIZES = [7, 15, 30];                    // marker widths (logical)
  const ERASER_SIZES = [40, 80, 150];
  const MAX_SKIPS = 2;
  const PALETTES = {
    white: ['#1b1b1f', '#1f4fd1', '#d62828', '#1f9d3a', '#f77f00', '#7b2cbf', '#8d5524'],
    chalk: ['#f5f5ef', '#ffe066', '#ff8fab', '#8ecae6', '#95d5b2', '#ffb26b', '#d0b3ff'],
  };
  const COLOR_NAMES = {
    white: ['Black', 'Blue', 'Red', 'Green', 'Orange', 'Purple', 'Brown'],
    chalk: ['White', 'Yellow', 'Pink', 'Light blue', 'Light green', 'Orange', 'Lilac'],
  };
  const TEAM_COLORS = ['#e53935', '#1e7be0', '#2e9e48', '#f2b705', '#8e44ad', '#f57c1f', '#e8508f', '#11a3a3'];
  const DEFAULT_TEAMS = [
    { name: 'Red Team', color: '#e53935' }, { name: 'Blue Team', color: '#1e7be0' },
    { name: 'Green Team', color: '#2e9e48' }, { name: 'Yellow Team', color: '#f2b705' },
  ];
  const POINTS_GUESS = 1, POINTS_DRAW = 1;

  const h = (tag, props, ...kids) => {
    const el = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };
  const sfx = (n, o) => IFPD.sfx.play(n, o);
  const loadJSON = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (_) { return d; } };

  // ---------------------------------------------------------------- settings & state
  const settings = Object.assign({
    teams: DEFAULT_TEAMS.slice(0, 2).map(t => ({ ...t })),
    time: 90, difficulty: 'easy', categories: CATEGORIES.slice(), rounds: 2, board: 'white',
  }, loadJSON('pc-settings', {}));
  if (!Array.isArray(settings.teams) || settings.teams.length < 2) settings.teams = DEFAULT_TEAMS.slice(0, 2).map(t => ({ ...t }));
  settings.teams = settings.teams.slice(0, 4);
  settings.categories = (settings.categories || []).filter(c => CATEGORIES.includes(c));
  if (!settings.categories.length) settings.categories = CATEGORIES.slice();
  if (!WORDS[settings.difficulty]) settings.difficulty = 'easy';
  if (![60, 90, 120].includes(settings.time)) settings.time = 90;
  if (!PALETTES[settings.board]) settings.board = 'white';
  const saveSettings = () => localStorage.setItem('pc-settings', JSON.stringify(settings));

  const G = {
    phase: 'setup',      // setup | ready | drawing | reveal | end
    teams: [],           // { name, color, score }
    turn: 0, totalTurns: 0,
    word: null, skips: MAX_SKIPS, deck: [],
    time: 0, result: null,
    board: settings.board,
    tool: 'pen', color: 0, size: 1,
    strokes: [],          // committed strokes (and {clear:true} markers) in order
    live: new Map(),      // pointerId -> stroke in progress
  };

  // ---------------------------------------------------------------- page
  const page = IFPD.setupPage({ title: 'Draw & Guess', onRestart: () => confirmRestart() });
  const stage = page.stage;
  const toolsEl = document.getElementById('tools');
  const panelEl = document.getElementById('panel');
  const banner = document.getElementById('banner');
  const canvas = document.getElementById('game');
  page.extra.append(h('button', { class: 'ifpd-btn', text: '⚙ Setup', onclick: () => { sfx('click'); showSetup(); } }));

  let layoutDirty = true, dirty = true;
  const view = IFPD.fitCanvas(canvas, () => { layoutDirty = true; dirty = true; });
  const ctx = view.ctx;
  const ro = new ResizeObserver(() => sizeColumns());
  ro.observe(stage);

  function sizeColumns() {
    const W = stage.clientWidth, H = stage.clientHeight;
    const tw = W < 1500 ? 108 : 122;
    const pw = Math.round(util.clamp(W * 0.2, 290, 400));
    const layout = stage.querySelector('.pc-layout');
    layout.style.setProperty('--toolw', tw + 'px');
    layout.style.setProperty('--panelw', pw + 'px');
    layout.style.setProperty('--penh', Math.round(util.clamp(H / 17, 34, 54)) + 'px');
    layout.style.setProperty('--toolbh', (H < 800 ? 46 : 58) + 'px');
  }
  sizeColumns();

  // ---------------------------------------------------------------- board geometry & layers
  const B = { x: 0, y: 0, w: 0, h: 0, k: 1, F: 0 }; // writing surface rect (CSS px) and scale
  let bgLayer = document.createElement('canvas');
  let glossLayer = document.createElement('canvas');
  let inkLayer = document.createElement('canvas');
  let inkCtx = inkLayer.getContext('2d');
  const chalkPatterns = new Map();

  function computeLayout() {
    layoutDirty = false;
    const W = view.width, H = view.height;
    const pad = util.clamp(Math.min(W, H) * 0.03, 10, 30);
    const availW = W - 2 * pad, availH = H - 2 * pad;
    // surface + frame (frame ≈ 2.4% of width, tray below)
    let sw = availW / 1.06, sh = sw * LH / LW;
    if (sh * 1.12 > availH) { sh = availH / 1.12; sw = sh * LW / LH; }
    B.F = Math.max(10, sw * 0.022);
    B.w = Math.floor(sw); B.h = Math.floor(sh);
    B.x = Math.round((W - B.w) / 2);
    B.y = Math.round((H - B.h - B.F * 1.6) / 2);
    B.k = B.w / LW;
    renderBackground();
    renderInk();
  }

  function renderBackground() {
    const { dpr } = view, W = view.width, H = view.height;
    for (const c of [bgLayer, glossLayer]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const c = bgLayer.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { x, y, w, h: hh, F } = B;
    const chalk = G.board === 'chalk';
    // wall shadow
    c.save();
    c.filter = `blur(${Math.round(F)}px)`;
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(x - F + F * 0.4, y - F + F * 0.8, w + 2 * F, hh + 2 * F);
    c.restore();
    // frame
    if (chalk) {
      const tex = IFPD.texture.wood(Math.ceil(w + 2 * F), Math.ceil(hh + 2 * F), { base: '#8a5a32', dark: '#4e2f16', planks: 1 });
      c.save();
      IFPD.draw.roundRect(c, x - F, y - F, w + 2 * F, hh + 2 * F, F * 0.4);
      c.clip();
      c.drawImage(tex, x - F, y - F);
      const g = c.createLinearGradient(0, y - F, 0, y + hh + F);
      g.addColorStop(0, 'rgba(255,230,190,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0.3)');
      c.fillStyle = g;
      c.fillRect(x - F, y - F, w + 2 * F, hh + 2 * F);
      c.restore();
    } else {
      const g = c.createLinearGradient(0, y - F, 0, y + hh + F);
      g.addColorStop(0, '#f4f6f8'); g.addColorStop(0.08, '#c3c9cf'); g.addColorStop(0.5, '#9aa2aa'); g.addColorStop(0.92, '#c9cfd5'); g.addColorStop(1, '#7c838a');
      c.fillStyle = g;
      IFPD.draw.roundRect(c, x - F, y - F, w + 2 * F, hh + 2 * F, F * 0.35);
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.7)';
      c.lineWidth = 1.5;
      IFPD.draw.roundRect(c, x - F + 1.5, y - F + 1.5, w + 2 * F - 3, hh + 2 * F - 3, F * 0.35);
      c.stroke();
      // moulded plastic corner caps
      for (const [cx, cy] of [[x - F, y - F], [x + w + F, y - F], [x - F, y + hh + F], [x + w + F, y + hh + F]]) {
        const cg = c.createRadialGradient(cx - F * 0.2, cy - F * 0.25, 0, cx, cy, F * 0.75);
        cg.addColorStop(0, '#8a9198'); cg.addColorStop(1, '#3d4248');
        c.fillStyle = cg;
        c.beginPath(); c.arc(cx, cy, F * 0.62, 0, Math.PI * 2); c.fill();
      }
    }
    // writing surface
    if (chalk) {
      c.fillStyle = '#2b3a33';
      c.fillRect(x, y, w, hh);
      const tex = IFPD.texture.felt(Math.ceil(w), Math.ceil(hh), { color: '#2d3c34' });
      c.globalAlpha = 0.9;
      c.drawImage(tex, x, y);
      c.globalAlpha = 1;
      // old erased chalk clouds
      const rnd = mulberry(7);
      for (let i = 0; i < 26; i++) {
        const cx = x + rnd() * w, cy = y + rnd() * hh, r = (0.05 + rnd() * 0.18) * w;
        const g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(255,255,255,${0.025 + rnd() * 0.035})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.beginPath(); c.ellipse(cx, cy, r, r * (0.3 + rnd() * 0.4), rnd() * 3, 0, Math.PI * 2); c.fill();
      }
    } else {
      const tex = IFPD.texture.ice(Math.ceil(w), Math.ceil(hh), { color: '#f6f8f7' });
      c.drawImage(tex, x, y);
      // faint ghosting of old marker
      const rnd = mulberry(3);
      c.strokeStyle = 'rgba(60,80,120,0.022)';
      c.lineCap = 'round';
      for (let i = 0; i < 9; i++) {
        c.lineWidth = 4 + rnd() * 8;
        c.beginPath();
        let px = x + rnd() * w, py = y + rnd() * hh;
        c.moveTo(px, py);
        for (let j = 0; j < 4; j++) { px += (rnd() - 0.5) * w * 0.2; py += (rnd() - 0.5) * hh * 0.15; c.lineTo(px, py); }
        c.stroke();
      }
    }
    // inner shadow at the frame edge
    c.save();
    c.beginPath(); c.rect(x, y, w, hh); c.clip();
    c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = F * 0.7; c.shadowOffsetY = F * 0.15;
    c.lineWidth = F; c.strokeStyle = '#000';
    c.strokeRect(x - F / 2, y - F / 2, w + F, hh + F);
    c.restore();
    // tray
    const ty = y + hh + F * 0.6, th = F * 1.2;
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = F * 0.6; c.shadowOffsetY = F * 0.3;
    const tg = c.createLinearGradient(0, ty, 0, ty + th);
    if (chalk) { tg.addColorStop(0, '#a87346'); tg.addColorStop(1, '#5a3a1c'); } else { tg.addColorStop(0, '#dfe3e7'); tg.addColorStop(0.5, '#a9b0b7'); tg.addColorStop(1, '#6f767d'); }
    c.fillStyle = tg;
    IFPD.draw.roundRect(c, x - F * 0.2, ty, w + F * 0.4, th, F * 0.3);
    c.fill();
    c.restore();
    if (chalk) { // chalk dust in the tray
      c.fillStyle = 'rgba(255,255,255,0.25)';
      const rnd = mulberry(11);
      for (let i = 0; i < 160; i++) c.fillRect(x + rnd() * w, ty + rnd() * th * 0.4, 1.5, 1.5);
    }

    // gloss layer (drawn over the ink): soft window reflection + sheen
    const gc = glossLayer.getContext('2d');
    gc.setTransform(dpr, 0, 0, dpr, 0, 0);
    gc.clearRect(0, 0, W, H);
    gc.save();
    gc.beginPath(); gc.rect(x, y, w, hh); gc.clip();
    if (!chalk) {
      let g = gc.createLinearGradient(x, y, x + w, y + hh);
      g.addColorStop(0, 'rgba(255,255,255,0.0)');
      g.addColorStop(0.18, 'rgba(255,255,255,0.20)');
      g.addColorStop(0.26, 'rgba(255,255,255,0.02)');
      g.addColorStop(0.62, 'rgba(255,255,255,0.0)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.12)');
      g.addColorStop(0.76, 'rgba(255,255,255,0.0)');
      gc.fillStyle = g;
      gc.fillRect(x, y, w, hh);
      g = gc.createRadialGradient(x + w * 0.82, y + hh * 0.12, 0, x + w * 0.82, y + hh * 0.12, w * 0.25);
      g.addColorStop(0, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      gc.fillStyle = g;
      gc.fillRect(x, y, w, hh);
      g = gc.createLinearGradient(0, y + hh * 0.75, 0, y + hh);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.06)');
      gc.fillStyle = g;
      gc.fillRect(x, y, w, hh);
    } else {
      const g = gc.createRadialGradient(x + w / 2, y + hh / 2, w * 0.2, x + w / 2, y + hh / 2, w * 0.7);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.25)');
      gc.fillStyle = g;
      gc.fillRect(x, y, w, hh);
    }
    gc.restore();
  }

  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function chalkPattern(c, color) {
    if (chalkPatterns.has(color)) return chalkPatterns.get(color);
    const t = document.createElement('canvas');
    t.width = t.height = 96;
    const tc = t.getContext('2d');
    tc.fillStyle = color;
    tc.fillRect(0, 0, 96, 96);
    const img = tc.getImageData(0, 0, 96, 96), d = img.data;
    const rnd = mulberry(color.length * 97 + parseInt(color.slice(1), 16));
    for (let i = 0; i < d.length; i += 4) {
      const r = rnd();
      d[i + 3] = r < 0.16 ? 0 : r < 0.35 ? 120 : 235;
    }
    tc.putImageData(img, 0, 0);
    const p = c.createPattern(t, 'repeat');
    chalkPatterns.set(color, p);
    return p;
  }

  // ---------------------------------------------------------------- stroke rendering
  function tracePath(c, pts) {
    c.beginPath();
    if (pts.length === 1) { c.moveTo(pts[0].x, pts[0].y); c.lineTo(pts[0].x + 0.01, pts[0].y); return; }
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
      c.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const l = pts[pts.length - 1];
    c.lineTo(l.x, l.y);
  }

  // c is already transformed to logical units
  function drawStroke(c, s) {
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    tracePath(c, s.pts);
    if (s.tool === 'eraser') {
      c.globalCompositeOperation = 'destination-out';
      c.strokeStyle = '#000';
      c.lineWidth = s.size;
      c.stroke();
    } else {
      const color = PALETTES[G.board][s.ci];
      if (G.board === 'chalk') {
        const p = chalkPattern(c, color);
        c.strokeStyle = p;
        c.globalAlpha = 0.55;
        c.lineWidth = s.size * 1.15;
        c.stroke();
        c.globalAlpha = 0.9;
        c.lineWidth = s.size * 0.8;
        c.stroke();
      } else {
        c.strokeStyle = color;
        c.globalAlpha = 0.3;          // soft, slightly translucent marker edge
        c.lineWidth = s.size * 1.3;
        c.stroke();
        c.globalAlpha = 0.92;
        c.lineWidth = s.size;
        c.stroke();
      }
    }
    c.restore();
  }

  function renderInk() {
    const { dpr } = view;
    inkLayer.width = Math.max(1, Math.round(B.w * dpr));
    inkLayer.height = Math.max(1, Math.round(B.h * dpr));
    inkCtx = inkLayer.getContext('2d');
    inkCtx.setTransform(B.k * dpr, 0, 0, B.k * dpr, 0, 0);
    for (const s of G.strokes) {
      if (s.clear) inkCtx.clearRect(0, 0, LW, LH);
      else drawStroke(inkCtx, s);
    }
    dirty = true;
  }

  function render() {
    if (layoutDirty) computeLayout();
    if (!dirty) return;
    dirty = false;
    const W = view.width, H = view.height;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bgLayer, 0, 0, W, H);
    ctx.drawImage(inkLayer, B.x, B.y, B.w, B.h);
    if (G.live.size) {
      ctx.save();
      ctx.beginPath(); ctx.rect(B.x, B.y, B.w, B.h); ctx.clip();
      ctx.translate(B.x, B.y);
      ctx.scale(B.k, B.k);
      for (const s of G.live.values()) if (s.tool !== 'eraser') drawStroke(ctx, s);
      ctx.restore();
    }
    ctx.drawImage(glossLayer, 0, 0, W, H);
    // eraser cursor(s)
    for (const s of G.live.values()) {
      if (s.tool !== 'eraser') continue;
      const p = s.pts[s.pts.length - 1];
      ctx.strokeStyle = G.board === 'chalk' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(B.x + p.x * B.k, B.y + p.y * B.k, (s.size / 2) * B.k, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // ---------------------------------------------------------------- drawing input
  const toLogical = (x, y) => ({ x: util.clamp((x - B.x) / B.k, 0, LW), y: util.clamp((y - B.y) / B.k, 0, LH) });
  let lastSound = 0;

  IFPD.pointers(canvas, {
    down(p) {
      if (G.phase !== 'drawing') {
        if (G.phase === 'ready') IFPD.toast('Press ▶ Start to begin drawing');
        sfx('click', { volume: 0.4 });
        return false;
      }
      const inside = p.x >= B.x - B.F && p.x <= B.x + B.w + B.F && p.y >= B.y - B.F && p.y <= B.y + B.h + B.F;
      if (!inside) return false;
      const pt = toLogical(p.x, p.y);
      const s = G.tool === 'eraser'
        ? { tool: 'eraser', size: ERASER_SIZES[G.size], pts: [pt] }
        : { tool: 'pen', ci: G.color, size: SIZES[G.size], pts: [pt] };
      G.live.set(p.id, s);
      if (s.tool === 'eraser') eraseSegment(s, pt, pt);
      dirty = true;
    },
    move(p, e) {
      const s = G.live.get(p.id);
      if (!s) return;
      const rect = canvas.getBoundingClientRect();
      let evs = e && e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (!evs.length) evs = [{ clientX: p.x + rect.left, clientY: p.y + rect.top }];
      let moved = 0;
      for (const ev of evs) {
        const pt = toLogical(ev.clientX - rect.left, ev.clientY - rect.top);
        const last = s.pts[s.pts.length - 1];
        const d = Math.hypot(pt.x - last.x, pt.y - last.y);
        if (d < 1.5) continue;
        s.pts.push(pt);
        moved += d;
        if (s.tool === 'eraser') eraseSegment(s, last, pt);
      }
      if (moved > 0) {
        dirty = true;
        const now = performance.now();
        if (now - lastSound > 90 && moved > 6) {
          lastSound = now;
          if (G.board === 'chalk') sfx('chalk', { volume: 1.2, pitch: util.rand(0.8, 1.2) });
          else sfx('chalk', { volume: s.tool === 'eraser' ? 0.6 : 0.8, pitch: s.tool === 'eraser' ? 0.25 : util.rand(0.45, 0.6) });
        }
      }
    },
    up(p) {
      const s = G.live.get(p.id);
      if (!s) return;
      G.live.delete(p.id);
      commitStroke(s);
    },
  });

  function eraseSegment(s, a, b) {
    inkCtx.save();
    inkCtx.globalCompositeOperation = 'destination-out';
    inkCtx.lineCap = 'round';
    inkCtx.lineWidth = s.size;
    inkCtx.beginPath();
    inkCtx.moveTo(a.x, a.y);
    inkCtx.lineTo(b.x + (a === b ? 0.01 : 0), b.y);
    inkCtx.stroke();
    inkCtx.restore();
  }

  function commitStroke(s) {
    G.strokes.push(s);
    if (s.tool !== 'eraser') drawStroke(inkCtx, s);
    else { // replace the segment-wise erase with the exact smoothed path so undo/redraw match
      renderInk();
    }
    if (s.tool !== 'eraser' && s.pts.length < 3) sfx('tap', { volume: 0.4 });
    dirty = true;
  }

  function undo() {
    if (!G.strokes.length) { sfx('click', { volume: 0.4 }); return; }
    G.strokes.pop();
    renderInk();
    sfx('whoosh', { volume: 0.5, pitch: 1.4 });
  }

  function clearBoard(record = true) {
    for (const s of G.live.values()) if (s.tool !== 'eraser') G.strokes.push(s);
    G.live.clear();
    if (record) {
      if (G.strokes.length && !G.strokes[G.strokes.length - 1].clear) G.strokes.push({ clear: true });
    } else G.strokes = [];
    renderInk();
  }

  // ---------------------------------------------------------------- toolbar
  function buildTools() {
    toolsEl.textContent = '';
    const pal = PALETTES[G.board];
    pal.forEach((c, i) => {
      const pen = h('button', {
        class: 'pc-pen' + (G.board === 'chalk' ? ' chalk' : '') + (G.tool === 'pen' && G.color === i ? ' on' : ''),
        title: COLOR_NAMES[G.board][i],
        style: { '--pc': c, '--pcl': IFPD.draw.shade(c, 0.45), '--pcd': IFPD.draw.shade(c, -0.4) },
        onclick: () => { G.tool = 'pen'; G.color = i; sfx('click'); buildTools(); },
      }, h('span', { class: 'body' }), h('span', { class: 'band' }), h('span', { class: 'cap' }));
      toolsEl.append(pen);
    });
    toolsEl.append(h('div', { class: 'sep' }));
    const sizes = h('div', { class: 'pc-sizes' });
    [8, 14, 22].forEach((px, i) => sizes.append(h('button', {
      class: 'pc-size' + (G.size === i ? ' on' : ''), title: ['Thin', 'Medium', 'Thick'][i],
      onclick: () => { G.size = i; sfx('click'); buildTools(); },
    }, h('i', { style: { width: px + 'px', height: px + 'px' } }))));
    toolsEl.append(sizes);
    toolsEl.append(h('button', { class: 'pc-tool' + (G.tool === 'eraser' ? ' on' : ''), title: 'Eraser', onclick: () => { G.tool = 'eraser'; sfx('click'); buildTools(); } }, h('span', { class: 'pc-eraser' })));
    toolsEl.append(h('button', { class: 'pc-tool', onclick: () => undo() }, h('big', { text: '↶' }), 'Undo'));
    toolsEl.append(h('button', { class: 'pc-tool', onclick: () => { if (!G.strokes.length || G.strokes[G.strokes.length - 1].clear) return; clearBoard(true); sfx('whoosh'); } }, h('big', { text: '🧽' }), 'Clear'));
    toolsEl.append(h('div', { class: 'sep' }));
    toolsEl.append(h('button', {
      class: 'pc-tool', title: 'Switch board',
      onclick: () => {
        G.board = G.board === 'white' ? 'chalk' : 'white';
        settings.board = G.board; saveSettings();
        sfx('flip'); buildTools(); layoutDirty = true; dirty = true;
      },
    }, h('big', { text: G.board === 'white' ? '⬛' : '⬜' }), G.board === 'white' ? 'Chalk board' : 'White board'));
  }

  // ---------------------------------------------------------------- word deck
  function buildDeck() {
    const pool = [];
    const diff = WORDS[settings.difficulty] || WORDS.easy;
    for (const cat of settings.categories) for (const w of diff[cat] || []) pool.push({ w, cat });
    if (!pool.length) for (const cat of Object.keys(diff)) for (const w of diff[cat]) pool.push({ w, cat });
    G.deck = util.shuffle(pool);
    G.deckPos = 0;
  }
  function nextWord() {
    if (G.deckPos >= G.deck.length) { util.shuffle(G.deck); G.deckPos = 0; }
    return G.deck[G.deckPos++];
  }

  // ---------------------------------------------------------------- panel
  const ui = {};
  function teamOf(turn) { return turn % G.teams.length; }
  function chipStyle(t) { return { background: `linear-gradient(${IFPD.draw.shade(t.color, 0.15)}, ${IFPD.draw.shade(t.color, -0.25)})` }; }

  function buildPanel() {
    panelEl.textContent = '';
    if (G.phase === 'setup') return;
    const ti = teamOf(G.turn), team = G.teams[ti];
    const round = Math.floor(G.turn / G.teams.length) + 1, rounds = G.totalTurns / G.teams.length;
    panelEl.append(h('div', { class: 'pc-turn' },
      h('div', { class: 'round', text: `Round ${Math.min(round, rounds)} of ${rounds}` }),
      h('div', { class: 'team', style: chipStyle(team), text: `✏️ ${team.name}` })));

    const C = 2 * Math.PI * 52;
    const clock = h('div', { class: 'pc-clock' });
    clock.innerHTML = `<svg viewBox="0 0 120 120"><circle class="face" cx="60" cy="60" r="58"/><circle class="bg" cx="60" cy="60" r="48" fill="none" stroke-width="12"/><circle class="fg" cx="60" cy="60" r="48" fill="none" stroke-width="12" stroke-dasharray="${(2 * Math.PI * 48).toFixed(2)}"/></svg><div class="num"></div>`;
    panelEl.append(clock);
    ui.clock = { el: clock, fg: clock.querySelector('.fg'), num: clock.querySelector('.num'), C: 2 * Math.PI * 48, shown: '' };
    void C;

    if (G.phase === 'ready' || G.phase === 'drawing') {
      const peek = h('div', { class: 'pc-peek' }, 'Drawer: press & HOLD to see your word');
      const show = e => {
        if (IFPD.isPalm(e)) return;
        e.preventDefault();
        try { peek.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ }
        peek.classList.add('show');
        peek.textContent = '';
        peek.append(h('div', null, h('span', { class: 'cat', text: G.word.cat }), h('span', { class: 'w', text: G.word.w })));
        sfx('flip');
      };
      const hide = () => {
        if (!peek.classList.contains('show')) return;
        peek.classList.remove('show');
        peek.textContent = 'Drawer: press & HOLD to see your word';
      };
      peek.addEventListener('pointerdown', show);
      peek.addEventListener('pointerup', hide);
      peek.addEventListener('pointercancel', hide);
      peek.addEventListener('lostpointercapture', hide);
      panelEl.append(peek);
      ui.peek = peek;
    }
    if (G.phase === 'ready') {
      panelEl.append(h('button', {
        class: 'ifpd-btn', disabled: G.skips <= 0, text: `⤼ Skip word (${G.skips} left)`,
        onclick: () => {
          if (G.skips <= 0 || G.phase !== 'ready') return;
          G.skips--; G.word = nextWord(); sfx('whoosh'); buildPanel();
          IFPD.toast('New word — hold the card to see it');
        },
      }));
      panelEl.append(h('button', { class: 'ifpd-btn good big', text: '▶ Start drawing', onclick: () => startDrawing() }));
    }
    if (G.phase === 'drawing') {
      const box = h('div', { class: 'pc-guess' }, h('div', { class: 'lbl', text: 'Guessed! by…' }));
      G.teams.forEach((t, i) => box.append(h('button', { class: 'ifpd-btn', style: chipStyle(t), text: `✓ ${t.name}`, onclick: () => guessed(i) })));
      box.append(h('button', { class: 'ifpd-btn', text: '⏹ Nobody — reveal word', onclick: () => endTurn(null, 'giveup') }));
      panelEl.append(box);
    }
    const scores = h('div', { class: 'pc-scores' });
    ui.scores = G.teams.map((t, i) => {
      const s = h('span', { class: 's', text: String(t.score) });
      scores.append(h('div', { class: 'pc-score' + (i === ti ? ' cur' : '') }, h('span', { class: 'dot', style: { background: t.color } }), h('span', { class: 'n', text: t.name }), s));
      return s;
    });
    panelEl.append(scores);
    updateClock(true);
  }

  function updateClock(force) {
    if (!ui.clock) return;
    const total = settings.time;
    const t = G.phase === 'drawing' ? Math.max(0, G.time) : G.phase === 'ready' ? total : Math.max(0, G.time);
    const label = String(Math.ceil(t));
    if (!force && label === ui.clock.shown) return;
    ui.clock.shown = label;
    ui.clock.num.textContent = label;
    ui.clock.fg.setAttribute('stroke-dashoffset', (ui.clock.C * (1 - t / total)).toFixed(2));
    ui.clock.el.classList.toggle('warn', t <= 20 && t > 10);
    ui.clock.el.classList.toggle('danger', t <= 10 && G.phase === 'drawing');
  }

  function showBanner(html, color) {
    banner.hidden = false;
    banner.textContent = '';
    banner.append(html);
    banner.style.setProperty('--tc', color || '#ffd34d');
    banner.style.setProperty('--tg', color ? color + '66' : 'rgba(255,211,77,0.3)');
    banner.style.animation = 'none';
    void banner.offsetWidth;
    banner.style.animation = '';
  }
  function hideBanner() { banner.hidden = true; banner.textContent = ''; }

  function bump(i) {
    const el = ui.scores && ui.scores[i];
    if (!el) return;
    el.textContent = String(G.teams[i].score);
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }

  // ---------------------------------------------------------------- game flow
  function startGame() {
    IFPD.overlay.hide();
    closeSetup();
    G.teams = settings.teams.map((t, i) => ({ name: (t.name || '').trim() || `Team ${i + 1}`, color: t.color, score: 0 }));
    G.turn = 0;
    G.totalTurns = settings.rounds * G.teams.length;
    G.board = settings.board;
    buildDeck();
    buildTools();
    layoutDirty = true;
    beginTurn();
  }

  function beginTurn() {
    G.phase = 'ready';
    G.word = nextWord();
    G.skips = MAX_SKIPS;
    G.time = settings.time;
    G.result = null;
    G.live.clear();
    G.strokes = [];
    renderInk();
    const t = G.teams[teamOf(G.turn)];
    showBanner(h('div', null,
      h('h2', { text: `${t.name}` }),
      h('p', { text: 'Drawer, come up to the board!' }),
      h('p', { text: 'Hold the red card to see your word secretly, then press ▶ Start.' })), t.color);
    buildPanel();
    sfx('ding');
  }

  function startDrawing() {
    if (G.phase !== 'ready') return;
    G.phase = 'drawing';
    G.time = settings.time;
    hideBanner();
    buildPanel();
    sfx('whoosh');
    sfx('tap');
  }

  function guessed(i) {
    if (G.phase !== 'drawing') return;
    endTurn(i, 'guessed');
  }

  function endTurn(guesser, reason) {
    if (G.phase !== 'drawing') return;
    for (const s of G.live.values()) G.strokes.push(s);
    G.live.clear();
    renderInk();
    G.phase = 'reveal';
    const di = teamOf(G.turn), drawer = G.teams[di];
    G.result = { guesser, reason };
    const lines = [];
    if (guesser != null) {
      G.teams[guesser].score += POINTS_GUESS;
      drawer.score += POINTS_DRAW;
      lines.push(guesser === di ? `${drawer.name} guessed their own drawing: +${POINTS_GUESS + POINTS_DRAW}` : `${G.teams[guesser].name} +${POINTS_GUESS} for guessing · ${drawer.name} +${POINTS_DRAW} for drawing`);
      sfx('correct');
      setTimeout(() => sfx('win', { volume: 0.6 }), 250);
      IFPD.confetti(1600);
    } else if (reason === 'timeout') {
      lines.push("Time's up — no points this turn.");
      sfx('buzzer');
    } else {
      lines.push('Nobody guessed it this time.');
      sfx('lose', { volume: 0.7 });
    }
    const last = G.turn + 1 >= G.totalTurns;
    showBanner(h('div', null,
      h('h2', { text: guesser != null ? '🎉 Guessed it!' : reason === 'timeout' ? "⏰ Time's up!" : 'The word was…' }),
      h('div', { class: 'word', text: G.word.w }),
      h('p', { text: lines.join('\n') }),
      h('button', { class: 'ifpd-btn primary', text: last ? '🏆 See the winner' : '▶ Next team', onclick: () => nextTurn() })),
      guesser != null ? G.teams[guesser].color : null);
    buildPanel();
    if (guesser != null) { bump(guesser); bump(di); }
  }

  function nextTurn() {
    if (G.phase !== 'reveal') return;
    sfx('tap');
    G.turn++;
    if (G.turn >= G.totalTurns) return endGame();
    beginTurn();
  }

  function endGame() {
    G.phase = 'end';
    hideBanner();
    buildPanel();
    const best = Math.max(...G.teams.map(t => t.score));
    const winners = G.teams.filter(t => t.score === best);
    const ranking = G.teams.slice().sort((a, b) => b.score - a.score)
      .map(t => `${1 + G.teams.filter(o => o.score > t.score).length}. ${t.name} — ${t.score} point${t.score === 1 ? '' : 's'}`).join('\n');
    sfx('win');
    IFPD.confetti(4000);
    setTimeout(() => IFPD.confetti(3000), 1300);
    IFPD.overlay.show({
      title: winners.length === 1 ? `🏆 ${winners[0].name} wins!` : `🤝 It's a tie: ${winners.map(w => w.name).join(' & ')}!`,
      text: ranking,
      buttons: [
        { label: '▶ Play again', kind: 'primary', onClick: () => startGame() },
        { label: '⚙ Setup', kind: 'plain', onClick: () => showSetup() },
      ],
    });
  }

  function confirmRestart() {
    if (G.phase === 'setup') { sfx('click'); return; }
    sfx('click');
    IFPD.overlay.show({
      title: 'Restart the game?',
      text: 'Scores go back to 0 and the first team draws again.',
      buttons: [
        { label: '↻ Restart', kind: 'bad', onClick: () => startGame() },
        { label: 'Cancel', kind: 'plain' },
      ],
    });
  }

  // ---------------------------------------------------------------- timer
  const loop = IFPD.loop(dt => {
    if (G.phase !== 'drawing' || IFPD.overlay.visible || setupEl) return; // paused under any overlay
    const before = Math.ceil(G.time);
    G.time -= dt;
    const after = Math.ceil(G.time);
    if (after !== before && after <= 10 && after > 0) sfx('tick', { volume: 5, pitch: after <= 3 ? 0.8 : 0.6 });
    if (G.time <= 0) { G.time = 0; endTurn(null, 'timeout'); }
  }, () => { updateClock(false); render(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { loop.resume(); dirty = true; } });

  // ---------------------------------------------------------------- setup
  let setupEl = null;
  function closeSetup() { if (setupEl) { setupEl.remove(); setupEl = null; } }

  function showSetup() {
    IFPD.overlay.hide();
    closeSetup();
    const card = h('div', { class: 'ifpd-card pc-setup' });
    const o = h('div', { class: 'ifpd-overlay' }, card);
    card.append(h('h2', { text: '🎨 Draw & Guess' }));
    card.append(h('p', { text: 'One drawer from a team draws the secret word. The class guesses aloud.\nThe teacher taps who guessed it: +1 for the guessing team, +1 for the drawing team.' }));
    const grid = h('div', { class: 'grid' });
    card.append(grid);

    // teams column
    const teamsCol = h('div');
    grid.append(teamsCol);
    const teamBox = h('div');
    teamsCol.append(h('div', { class: 'row' }, h('label', { text: 'Teams' }), teamBox));
    const addBtn = h('button', { class: 'ifpd-btn', text: '＋ Add team', onclick: () => {
      if (settings.teams.length >= 4) return;
      const free = DEFAULT_TEAMS.find(d => !settings.teams.some(t => t.color === d.color)) || DEFAULT_TEAMS[0];
      settings.teams.push({ ...free }); sfx('pop'); drawTeams();
    } });
    teamsCol.append(addBtn);
    function drawTeams() {
      teamBox.textContent = '';
      settings.teams.forEach((t, i) => {
        const sw = h('div', { class: 'sw' });
        for (const c of TEAM_COLORS) sw.append(h('button', {
          class: 'pc-swatch' + (t.color === c ? ' on' : ''), style: { background: c },
          onclick: () => { const other = settings.teams.find(x => x !== t && x.color === c); if (other) other.color = t.color; t.color = c; sfx('click'); drawTeams(); },
        }));
        teamBox.append(h('div', { class: 'pc-team-row' },
          h('div', { class: 'badge', style: { background: t.color }, text: String(i + 1) }),
          h('input', { value: t.name, maxLength: 18, placeholder: `Team ${i + 1}`, oninput: e => { t.name = e.target.value; } }),
          settings.teams.length > 2 ? h('button', { class: 'ifpd-btn x', text: '✕', onclick: () => { settings.teams.splice(i, 1); sfx('click'); drawTeams(); } }) : null,
          sw));
      });
      addBtn.hidden = settings.teams.length >= 4;
    }
    drawTeams();

    // options column
    const opts = h('div');
    grid.append(opts);
    const seg = (label, key, items, after) => {
      const box = h('div', { class: 'pc-seg' });
      for (const [v, text] of items) {
        box.append(h('button', {
          class: 'ifpd-btn' + (settings[key] === v ? ' on' : ''), text,
          onclick: e => { settings[key] = v; box.querySelectorAll('.ifpd-btn').forEach(b => b.classList.toggle('on', b === e.currentTarget)); sfx('click'); if (after) after(); },
        }));
      }
      opts.append(h('div', { class: 'row' }, h('label', { text: label }), box));
    };
    const countEl = h('div', { class: 'count' });
    const updateCount = () => {
      const diff = WORDS[settings.difficulty];
      const n = settings.categories.reduce((a, c) => a + (diff[c] || []).length, 0);
      countEl.textContent = `${n} words available`;
    };
    seg('Round time', 'time', [[60, '60 s'], [90, '90 s'], [120, '120 s']]);
    seg('Word difficulty', 'difficulty', [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], updateCount);
    const cats = h('div', { class: 'pc-seg' });
    for (const c of CATEGORIES) {
      cats.append(h('button', {
        class: 'ifpd-btn' + (settings.categories.includes(c) ? ' on' : ''), text: c,
        onclick: e => {
          const on = settings.categories.includes(c);
          if (on && settings.categories.length === 1) { IFPD.toast('Keep at least one category'); return; }
          settings.categories = on ? settings.categories.filter(x => x !== c) : settings.categories.concat(c);
          e.currentTarget.classList.toggle('on', !on);
          sfx('click'); updateCount();
        },
      }));
    }
    opts.append(h('div', { class: 'row' }, h('label', { text: 'Categories' }), cats, countEl));
    updateCount();
    seg('Rounds (every team draws once per round)', 'rounds', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']]);
    seg('Board', 'board', [['white', '⬜ Whiteboard'], ['chalk', '⬛ Chalkboard']]);

    card.append(h('div', { class: 'ifpd-buttons' },
      h('button', { class: 'ifpd-btn primary', text: '▶ Start game', onclick: () => {
        settings.teams.forEach((t, i) => { t.name = (t.name || '').trim() || `Team ${i + 1}`; });
        saveSettings(); sfx('tap'); startGame();
      } }),
      G.phase !== 'setup' && G.phase !== 'end' ? h('button', { class: 'ifpd-btn plain', text: 'Back to game', onclick: () => { sfx('click'); closeSetup(); } }) : null));
    stage.append(o);
    setupEl = o;
  }

  // ---------------------------------------------------------------- boot
  buildTools();
  showSetup();

  window.__game = {
    G, settings, LW, LH, B, PALETTES, WORDS,
    startGame, startDrawing, guessed, endTurn, nextTurn, undo, clearBoard, showSetup,
    // page (viewport) coordinates of a logical board point — for automated tests
    toPage(x, y) { const r = canvas.getBoundingClientRect(); return { x: r.left + B.x + x * B.k, y: r.top + B.y + y * B.k }; },
    inkPixel(x, y) { // RGBA of the ink layer at a logical point
      const d = inkCtx.getImageData(Math.round(x * B.k * view.dpr), Math.round(y * B.k * view.dpr), 1, 1).data;
      return Array.from(d);
    },
  };
})();
