/*
 * Memory Match — find the pairs. 1 player (moves + time) or 2–4 players taking turns.
 */
(function () {
  'use strict';

  const { util } = IFPD;
  const { clamp, shuffle } = util;
  const TAU = Math.PI * 2;
  const FONT = '"Segoe UI", Roboto, system-ui, sans-serif';
  const EMOJI_FONT = '"Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", sans-serif';

  const FLIP_TIME = 0.32;       // s for a half-turn
  const MISMATCH_SHOW = 0.9;    // s both cards stay visible before flipping back
  const ASPECT = 0.74;          // preferred card width / height
  const MAX_ASPECT = 0.95;      // squarest card allowed

  const GRIDS = { '4x3': [4, 3], '4x4': [4, 4], '6x4': [6, 4], '6x5': [6, 5] };
  const PLAYER_COLORS = ['#3d8bfd', '#f25c54', '#f7b32b', '#9b5de5'];

  const THEMES = {
    animals: {
      label: 'Animals', items: [
        ['🐶', 'Dog'], ['🐱', 'Cat'], ['🦁', 'Lion'], ['🐯', 'Tiger'], ['🐼', 'Panda'], ['🐨', 'Koala'], ['🐸', 'Frog'], ['🐵', 'Monkey'],
        ['🐘', 'Elephant'], ['🦒', 'Giraffe'], ['🦓', 'Zebra'], ['🐰', 'Rabbit'], ['🦊', 'Fox'], ['🐻', 'Bear'], ['🐷', 'Pig'], ['🐮', 'Cow'], ['🐧', 'Penguin'], ['🦉', 'Owl']],
    },
    fruits: {
      label: 'Fruits', items: [
        ['🍎', 'Apple'], ['🍌', 'Banana'], ['🍇', 'Grapes'], ['🍓', 'Strawberry'], ['🍊', 'Orange'], ['🍉', 'Watermelon'], ['🍍', 'Pineapple'], ['🥝', 'Kiwi'],
        ['🍒', 'Cherries'], ['🍑', 'Peach'], ['🍐', 'Pear'], ['🥭', 'Mango'], ['🍋', 'Lemon'], ['🥥', 'Coconut'], ['🍈', 'Melon']],
    },
    vehicles: {
      label: 'Vehicles', items: [
        ['🚗', 'Car'], ['🚌', 'Bus'], ['🚓', 'Police car'], ['🚑', 'Ambulance'], ['🚒', 'Fire engine'], ['🚜', 'Tractor'], ['🚲', 'Bicycle'], ['🏍️', 'Motorbike'],
        ['✈️', 'Aeroplane'], ['🚁', 'Helicopter'], ['🚀', 'Rocket'], ['🚂', 'Train'], ['⛵', 'Sailboat'], ['🚢', 'Ship'], ['🚕', 'Taxi'], ['🛺', 'Auto rickshaw']],
    },
    shapes: {
      label: 'Shapes & Colours', items: [
        ['circle', 'Red Circle', '#e53935'], ['square', 'Blue Square', '#1e6fd9'], ['triangle', 'Green Triangle', '#2e9d44'], ['star', 'Yellow Star', '#f6c71c'],
        ['heart', 'Purple Heart', '#8e3ab8'], ['diamond', 'Orange Diamond', '#f57c00'], ['hexagon', 'Pink Hexagon', '#ec5c9a'], ['oval', 'Brown Oval', '#8d5a33'],
        ['cross', 'Black Cross', '#26262b'], ['moon', 'Grey Moon', '#8a8f98'], ['pentagon', 'Teal Pentagon', '#0f9b9b'], ['rectangle', 'Sky Blue Rectangle', '#4fb6ec'],
        ['arrow', 'Lime Arrow', '#8bc34a'], ['semicircle', 'Gold Semicircle', '#d4a017'], ['trapezium', 'Maroon Trapezium', '#8b1e3f']],
    },
  };

  // ---------------------------------------------------------------------------

  const canvas = document.getElementById('game');
  IFPD.setupPage({ title: 'Memory Match', onRestart: () => restart() });
  let view = null, W = 0, H = 0;

  const cfg = { grid: '4x4', theme: 'animals', players: 1 };
  let state = 'menu';            // 'menu' | 'deal' | 'play' | 'won'
  let cards = [];
  let open = [];                 // face-up, unresolved cards (max 2)
  let busy = false;              // true while a pair is being judged
  let resolveAt = 0, flipBackAt = 0;
  let simTime = 0, startTime = 0, elapsed = 0, timing = false;
  let moves = 0, pairsFound = 0;
  let players = [];
  let current = 0;
  let banner = null;             // { text, color, t }
  let L = null;                  // layout
  let sprites = { key: '', faces: new Map(), back: null, shadow: null, glow: null };
  let bg = null;

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  function computeLayout() {
    const [cols, rows] = GRIDS[cfg.grid];
    const hud = clamp(H * 0.11, 60, 116);
    const m = clamp(Math.min(W, H) * 0.025, 10, 30);
    const g = 0.09;
    const availW = W - 2 * m, availH = H - hud - 2 * m;
    // classic playing-card shape when it fits; squarer cards when the height is the limit
    let cw = 0, aspect = ASPECT;
    for (let a = ASPECT; a <= MAX_ASPECT + 1e-6; a += 0.01) {
      const w = Math.min(availW / (cols + (cols - 1) * g), availH / (rows / a + (rows - 1) * g));
      if (w > cw * 1.004) { cw = w; aspect = a; }
    }
    cw = Math.max(20, cw);
    const ch = cw / aspect, gap = cw * g;
    const gw = cols * cw + (cols - 1) * gap, gh = rows * ch + (rows - 1) * gap;
    const x0 = (W - gw) / 2, y0 = hud + m + (availH - gh) / 2;
    L = { cols, rows, cw, ch, gap, x0, y0, hud, m };
    buildSprites();
  }

  function slot(i) {
    const c = i % L.cols, r = Math.floor(i / L.cols);
    return { x: L.x0 + c * (L.cw + L.gap) + L.cw / 2, y: L.y0 + r * (L.ch + L.gap) + L.ch / 2 };
  }

  // ---------------------------------------------------------------------------
  // Sprites (rebuilt when the card size or theme changes)
  // ---------------------------------------------------------------------------

  function rr(ctx, x, y, w, h, r) { IFPD.draw.roundRect(ctx, x, y, w, h, r); }

  function newCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  function buildSprites() {
    if (!L || !view) return;
    const dpr = view.dpr;
    const key = `${Math.round(L.cw * dpr)}x${Math.round(L.ch * dpr)}:${cfg.theme}:${dpr}`;
    if (sprites.key === key) return;
    sprites.key = key;
    const w = L.cw * dpr, h = L.ch * dpr, r = w * 0.08;
    sprites.faces = new Map();
    sprites.back = makeBack(w, h, r);
    // soft shadow + glow sprites (blurred once, reused every frame)
    const pad = w * 0.35;
    sprites.shadow = newCanvas(w + pad * 2, h + pad * 2);
    let x = sprites.shadow.getContext('2d');
    x.shadowColor = 'rgba(0,0,0,0.75)'; x.shadowBlur = w * 0.12; x.shadowOffsetX = 0; x.shadowOffsetY = 0;
    x.fillStyle = '#000'; rr(x, pad, pad, w, h, r); x.fill();
    sprites.shadow.pad = pad / dpr;
    sprites.glow = newCanvas(w + pad * 2, h + pad * 2);
    x = sprites.glow.getContext('2d');
    x.shadowColor = 'rgba(255,215,90,1)'; x.shadowBlur = w * 0.18;
    x.strokeStyle = 'rgba(255,230,140,1)'; x.lineWidth = w * 0.05; rr(x, pad, pad, w, h, r); x.stroke();
    x.stroke();
    sprites.glow.pad = pad / dpr;
  }

  function makeBack(w, h, r) {
    const c = newCanvas(w, h);
    const x = c.getContext('2d');
    rr(x, 0, 0, w, h, r); x.save(); x.clip();
    // white printed border then a deep blue field with a gold lattice
    x.fillStyle = '#f7f3ea'; x.fillRect(0, 0, w, h);
    const b = w * 0.07;
    rr(x, b, b, w - 2 * b, h - 2 * b, r * 0.6);
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#1d4f9a'); g.addColorStop(1, '#122f63');
    x.fillStyle = g; x.fill();
    x.save(); rr(x, b, b, w - 2 * b, h - 2 * b, r * 0.6); x.clip();
    x.strokeStyle = 'rgba(255,214,120,0.38)'; x.lineWidth = Math.max(1, w * 0.012);
    const s = w * 0.13;
    for (let i = -h; i < w + h; i += s) {
      x.beginPath(); x.moveTo(i, 0); x.lineTo(i + h, h); x.stroke();
      x.beginPath(); x.moveTo(i + h, 0); x.lineTo(i, h); x.stroke();
    }
    x.fillStyle = 'rgba(255,214,120,0.5)';
    for (let i = -h; i < w + h; i += s) for (let j = 0; j < h; j += s) { x.beginPath(); x.arc(i + j % (2 * s), j, w * 0.012, 0, TAU); x.fill(); }
    x.restore();
    // central medallion
    const cx = w / 2, cy = h / 2, R = w * 0.22;
    x.fillStyle = '#f7f3ea';
    x.beginPath(); x.arc(cx, cy, R * 1.12, 0, TAU); x.fill();
    const mg = x.createRadialGradient(cx - R * 0.3, cy - R * 0.3, 0, cx, cy, R);
    mg.addColorStop(0, '#ffd77a'); mg.addColorStop(1, '#c48a1a');
    x.fillStyle = mg; x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.fill();
    x.fillStyle = '#1a3f7d';
    starPath(x, cx, cy, R * 0.72, R * 0.3, 5); x.fill();
    // inner border line
    x.strokeStyle = 'rgba(255,214,120,0.8)'; x.lineWidth = Math.max(1, w * 0.012);
    rr(x, b * 1.5, b * 1.5, w - 3 * b, h - 3 * b, r * 0.45); x.stroke();
    // satin sheen
    const sh = x.createLinearGradient(0, 0, w, h);
    sh.addColorStop(0, 'rgba(255,255,255,0.22)'); sh.addColorStop(0.45, 'rgba(255,255,255,0.03)'); sh.addColorStop(1, 'rgba(0,0,0,0.12)');
    x.fillStyle = sh; x.fillRect(0, 0, w, h);
    x.restore();
    x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 1; rr(x, 0.5, 0.5, w - 1, h - 1, r); x.stroke();
    return c;
  }

  function starPath(x, cx, cy, R, r, n) {
    x.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / n, d = i % 2 ? r : R;
      if (i === 0) x.moveTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d); else x.lineTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
    }
    x.closePath();
  }

  function shapePath(x, kind, cx, cy, s) {
    x.beginPath();
    const poly = (n, rot = -Math.PI / 2, rx = s, ry = s) => {
      for (let i = 0; i < n; i++) { const a = rot + (i * TAU) / n; if (i === 0) x.moveTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry); else x.lineTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry); }
      x.closePath();
    };
    switch (kind) {
      case 'circle': x.arc(cx, cy, s, 0, TAU); break;
      case 'square': x.rect(cx - s * 0.85, cy - s * 0.85, s * 1.7, s * 1.7); break;
      case 'triangle': x.moveTo(cx, cy - s); x.lineTo(cx + s * 1.05, cy + s * 0.8); x.lineTo(cx - s * 1.05, cy + s * 0.8); x.closePath(); break;
      case 'star': starPath(x, cx, cy + s * 0.08, s * 1.08, s * 0.45, 5); break;
      case 'heart':
        x.moveTo(cx, cy + s * 0.95);
        x.bezierCurveTo(cx - s * 1.5, cy - s * 0.05, cx - s * 0.75, cy - s * 1.15, cx, cy - s * 0.45);
        x.bezierCurveTo(cx + s * 0.75, cy - s * 1.15, cx + s * 1.5, cy - s * 0.05, cx, cy + s * 0.95);
        x.closePath(); break;
      case 'diamond': poly(4, -Math.PI / 2, s * 0.75, s * 1.05); break;
      case 'hexagon': poly(6, 0); break;
      case 'pentagon': poly(5); break;
      case 'oval': x.ellipse(cx, cy, s * 1.1, s * 0.7, 0, 0, TAU); break;
      case 'rectangle': x.rect(cx - s * 1.15, cy - s * 0.6, s * 2.3, s * 1.2); break;
      case 'cross': {
        const a = s * 0.34;
        x.moveTo(cx - a, cy - s); x.lineTo(cx + a, cy - s); x.lineTo(cx + a, cy - a); x.lineTo(cx + s, cy - a); x.lineTo(cx + s, cy + a); x.lineTo(cx + a, cy + a);
        x.lineTo(cx + a, cy + s); x.lineTo(cx - a, cy + s); x.lineTo(cx - a, cy + a); x.lineTo(cx - s, cy + a); x.lineTo(cx - s, cy - a); x.lineTo(cx - a, cy - a); x.closePath(); break;
      }
      case 'moon':
        x.arc(cx, cy, s, Math.PI * 0.3, Math.PI * 1.7, false);
        x.arc(cx + s * 0.55, cy - s * 0.0, s * 0.82, Math.PI * 1.62, Math.PI * 0.38, true);
        x.closePath(); break;
      case 'arrow':
        x.moveTo(cx - s, cy - s * 0.32); x.lineTo(cx + s * 0.2, cy - s * 0.32); x.lineTo(cx + s * 0.2, cy - s * 0.8); x.lineTo(cx + s * 1.1, cy);
        x.lineTo(cx + s * 0.2, cy + s * 0.8); x.lineTo(cx + s * 0.2, cy + s * 0.32); x.lineTo(cx - s, cy + s * 0.32); x.closePath(); break;
      case 'semicircle': x.arc(cx, cy + s * 0.45, s * 1.1, Math.PI, TAU); x.closePath(); break;
      case 'trapezium': x.moveTo(cx - s * 0.6, cy - s * 0.65); x.lineTo(cx + s * 0.6, cy - s * 0.65); x.lineTo(cx + s * 1.15, cy + s * 0.65); x.lineTo(cx - s * 1.15, cy + s * 0.65); x.closePath(); break;
    }
  }

  function faceSprite(item) {
    const k = item[1];
    if (sprites.faces.has(k)) return sprites.faces.get(k);
    const dpr = view.dpr;
    const w = L.cw * dpr, h = L.ch * dpr, r = w * 0.08;
    const c = newCanvas(w, h);
    const x = c.getContext('2d');
    rr(x, 0, 0, w, h, r); x.save(); x.clip();
    x.drawImage(IFPD.texture.paper(256, 340), 0, 0, w, h);
    const v = x.createRadialGradient(w / 2, h * 0.4, w * 0.2, w / 2, h / 2, h * 0.75);
    v.addColorStop(0, 'rgba(255,255,255,0.25)'); v.addColorStop(1, 'rgba(120,100,60,0.18)');
    x.fillStyle = v; x.fillRect(0, 0, w, h);
    x.restore();
    x.strokeStyle = 'rgba(150,130,90,0.55)'; x.lineWidth = Math.max(1, w * 0.012);
    rr(x, w * 0.05, w * 0.05, w - w * 0.1, h - w * 0.1, r * 0.6); x.stroke();
    const cy = h * 0.43;
    if (cfg.theme === 'shapes') {
      const s = w * 0.3;
      x.save();
      x.shadowColor = 'rgba(0,0,0,0.3)'; x.shadowBlur = w * 0.04; x.shadowOffsetY = w * 0.02;
      shapePath(x, item[0], w / 2, cy, s);
      const g = x.createLinearGradient(0, cy - s, 0, cy + s);
      g.addColorStop(0, IFPD.draw.shade(item[2], 0.25)); g.addColorStop(1, IFPD.draw.shade(item[2], -0.2));
      x.fillStyle = g; x.fill();
      x.restore();
      shapePath(x, item[0], w / 2, cy, s);
      x.lineWidth = Math.max(1, w * 0.012); x.strokeStyle = IFPD.draw.shade(item[2], -0.45); x.stroke();
    } else {
      const fs = w * 0.56;
      x.font = `${fs}px ${EMOJI_FONT}`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.save();
      x.shadowColor = 'rgba(0,0,0,0.25)'; x.shadowBlur = w * 0.03; x.shadowOffsetY = w * 0.015;
      x.fillText(item[0], w / 2, cy + fs * 0.04);
      x.restore();
    }
    // name label
    let ls = h * 0.105;
    x.font = `700 ${ls}px ${FONT}`;
    const tw = x.measureText(item[1]).width;
    if (tw > w * 0.86) { ls *= (w * 0.86) / tw; x.font = `700 ${ls}px ${FONT}`; }
    x.fillStyle = '#3b3326'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(item[1], w / 2, h * 0.84);
    x.strokeStyle = 'rgba(0,0,0,0.2)'; x.lineWidth = 1; rr(x, 0.5, 0.5, w - 1, h - 1, r); x.stroke();
    sprites.faces.set(k, c);
    return c;
  }

  // ---------------------------------------------------------------------------
  // Game flow
  // ---------------------------------------------------------------------------

  function deal() {
    const [cols, rows] = GRIDS[cfg.grid];
    const pairs = (cols * rows) / 2;
    const items = shuffle(THEMES[cfg.theme].items.slice()).slice(0, pairs);
    const deck = shuffle(items.concat(items).map((it, i) => ({ item: it, key: it[1] })));
    cards = deck.map((d, i) => ({
      i, item: d.item, key: d.key, state: 'down', flip: 0, target: 0,
      dealT: -i * 0.035, matchedT: -1, owner: -1, lift: 0, shake: 0,
    }));
    open = []; busy = false; resolveAt = 0; flipBackAt = 0; moves = 0; pairsFound = 0; elapsed = 0; timing = false;
    players = Array.from({ length: cfg.players }, (_, i) => ({ name: 'Player ' + (i + 1), color: PLAYER_COLORS[i], score: 0 }));
    current = 0;
    banner = cfg.players > 1 ? { text: players[0].name + ' starts', color: players[0].color, t: 0 } : null;
    state = 'deal';
    computeLayout();
    sprites.key = ''; buildSprites();
    IFPD.sfx.play('whoosh');
  }

  function start(c) {
    Object.assign(cfg, c);
    hideMenu();
    IFPD.overlay.hide();
    deal();
    loop.resume();
  }

  function restart() { if (state !== 'menu') start({}); }

  function tryFlip(c) {
    if (state !== 'play') return false;
    if (busy || open.length >= 2) { IFPD.sfx.play('tick', { volume: 0.8 }); return false; }
    if (c.state !== 'down' || c.flip > 0.05) return false;
    c.state = 'up'; c.target = 1;
    open.push(c);
    if (!timing) { timing = true; startTime = simTime; }
    IFPD.sfx.play('flip', { pitch: 0.9 + Math.random() * 0.2, pan: panOf(c) });
    if (open.length === 2) {
      busy = true;
      moves++;
      resolveAt = simTime + FLIP_TIME + 0.08;
      flipBackAt = 0;
    }
    return true;
  }

  function panOf(c) { const p = slot(c.i); return ((p.x / W) * 2 - 1) * 0.7; }

  function resolvePair() {
    const [a, b] = open;
    if (a.key === b.key) {
      a.state = b.state = 'matched';
      a.matchedT = b.matchedT = 0;
      a.owner = b.owner = cfg.players > 1 ? current : 0;
      pairsFound++;
      if (cfg.players > 1) players[current].score++;
      IFPD.sfx.play('correct', { volume: 0.8, pan: (panOf(a) + panOf(b)) / 2 });
      setTimeout(() => IFPD.sfx.play('ding', { volume: 0.4, pitch: 1 + pairsFound * 0.03 }), 120);
      open = []; busy = false;
      if (cfg.players > 1 && pairsFound < cards.length / 2) banner = { text: players[current].name + ' — go again!', color: players[current].color, t: 0 };
      if (pairsFound === cards.length / 2) win();
    } else {
      a.shake = b.shake = 1;
      IFPD.sfx.play('wrong', { volume: 0.45 });
      flipBackAt = simTime + MISMATCH_SHOW;
    }
  }

  function flipBack() {
    for (const c of open) { c.state = 'down'; c.target = 0; }
    IFPD.sfx.play('flip', { pitch: 0.8 });
    open = []; busy = false; flipBackAt = 0;
    if (cfg.players > 1) {
      current = (current + 1) % players.length;
      banner = { text: players[current].name + "'s turn", color: players[current].color, t: 0 };
      IFPD.sfx.play('whoosh', { volume: 0.5 });
    }
  }

  function fmtTime(s) { s = Math.floor(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

  function win() {
    state = 'won';
    timing = false;
    let title, text, record = false;
    if (cfg.players === 1) {
      const t = Math.floor(elapsed);
      const rm = IFPD.best.submit(`memory-match-${cfg.grid}-moves`, moves, false);
      const rt = IFPD.best.submit(`memory-match-${cfg.grid}-time`, t, false);
      record = rm || rt;
      title = 'All pairs found!';
      text = `${moves} moves · ${fmtTime(t)}\n` +
        `Best (${cfg.grid.replace('x', '×')}): ${IFPD.best.get(`memory-match-${cfg.grid}-moves`)} moves · ${fmtTime(IFPD.best.get(`memory-match-${cfg.grid}-time`))}` +
        (rm && rt ? '\nNew records for moves and time!' : rm ? '\nNew record for fewest moves!' : rt ? '\nNew record for fastest time!' : '');
    } else {
      const top = Math.max(...players.map(p => p.score));
      const winners = players.filter(p => p.score === top);
      title = winners.length === 1 ? `${winners[0].name} wins!` : 'It\'s a tie!';
      text = (winners.length > 1 ? `Tied: ${winners.map(p => p.name).join(' & ')}\n` : '') + players.map(p => `${p.name}: ${p.score} pair${p.score === 1 ? '' : 's'}`).join('\n');
      record = true;
    }
    setTimeout(() => { IFPD.sfx.play('win'); if (record) IFPD.confetti(3000); }, 500);
    setTimeout(() => {
      if (state !== 'won') return;
      IFPD.overlay.show({
        title, text,
        buttons: [
          { label: 'Play again', kind: 'good', onClick: () => start({}) },
          { label: 'Change game', kind: 'primary', onClick: () => showMenu() },
        ],
      });
    }, 1400);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  function update(dt) {
    simTime += dt;
    if (timing) elapsed = simTime - startTime;
    if (banner) { banner.t += dt; if (banner.t > 1.6) banner = null; }
    let dealing = false;
    for (const c of cards) {
      if (c.dealT < 1) { c.dealT = Math.min(1, c.dealT + dt / 0.45); dealing = true; if (c.dealT > 0 && c.dealT - dt / 0.45 <= 0) IFPD.sfx.play('snap', { volume: 0.35, pitch: 0.9 + Math.random() * 0.3 }); }
      const step = dt / FLIP_TIME;
      if (c.flip < c.target) c.flip = Math.min(c.target, c.flip + step);
      else if (c.flip > c.target) c.flip = Math.max(c.target, c.flip - step);
      const wantLift = c.state === 'up' ? 0.6 : 0;
      c.lift += (wantLift - c.lift) * Math.min(1, dt * 10);
      if (c.matchedT >= 0) c.matchedT += dt;
      c.shake = Math.max(0, c.shake - dt * 2.5);
    }
    if (state === 'deal' && !dealing) state = 'play';
    if (busy && resolveAt && simTime >= resolveAt && open.length === 2 && !flipBackAt) { resolveAt = 0; resolvePair(); }
    if (busy && flipBackAt && simTime >= flipBackAt) flipBack();
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  function cardAt(x, y) {
    if (!L) return null;
    for (const c of cards) {
      const p = slot(c.i);
      if (Math.abs(x - p.x) <= L.cw / 2 + L.gap * 0.3 && Math.abs(y - p.y) <= L.ch / 2 + L.gap * 0.3) return c;
    }
    return null;
  }

  IFPD.pointers(canvas, {
    down(p) {
      const c = cardAt(p.x, p.y);
      if (c) tryFlip(c);
      return false;
    },
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  function buildBackground() {
    const c = newCanvas(W * view.dpr, H * view.dpr);
    const x = c.getContext('2d');
    x.scale(view.dpr, view.dpr);
    x.drawImage(IFPD.texture.felt(Math.min(W, 1920), Math.min(H, 1200), { color: '#1d6b3a' }), 0, 0, W, H);
    // overhead lamp pool + dark table edges
    let g = x.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.hypot(W, H) * 0.6);
    g.addColorStop(0, 'rgba(255,248,210,0.12)'); g.addColorStop(0.55, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // wooden table rail along the top behind the HUD
    const hud = L ? L.hud : 90;
    x.drawImage(IFPD.texture.wood(Math.min(W, 2400), 160, { base: '#6b4224', dark: '#3a210f', planks: 1 }), 0, 0, W, hud);
    g = x.createLinearGradient(0, 0, 0, hud);
    g.addColorStop(0, 'rgba(255,220,170,0.18)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
    x.fillStyle = g; x.fillRect(0, 0, W, hud);
    g = x.createLinearGradient(0, hud, 0, hud + 22);
    g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, hud, W, 22);
    return c;
  }

  function drawCard(ctx, c) {
    const p = slot(c.i);
    let x = p.x, y = p.y;
    // dealing: slide from a deck at the bottom centre
    let dealK = 1;
    if (c.dealT < 1) {
      if (c.dealT <= 0) return;
      const t = c.dealT, e = 1 - Math.pow(1 - t, 3);
      const dx = W / 2, dy = H + L.ch;
      x = dx + (p.x - dx) * e; y = dy + (p.y - dy) * e;
      dealK = 0.85 + 0.15 * e;
    }
    if (c.shake > 0) x += Math.sin(c.shake * 40) * c.shake * L.cw * 0.05;
    const ang = c.flip * Math.PI;
    const kx = Math.max(0.02, Math.abs(Math.cos(ang)));
    const flipLift = Math.sin(ang);
    const settled = c.matchedT > 1.4;
    const lift = settled ? 0 : Math.max(c.lift * 0.6, flipLift) + (c.dealT < 1 ? 0.6 * (1 - c.dealT) : 0);
    const s = (1 + lift * 0.08) * dealK * (settled ? 0.97 : 1);
    const w = L.cw, h = L.ch;
    // shadow
    const sh = sprites.shadow;
    const so = 3 + lift * w * 0.12;
    ctx.globalAlpha = settled ? 0.35 : 0.5 - lift * 0.12;
    ctx.save();
    ctx.translate(x + so * 0.5, y + so);
    ctx.scale(kx * s * (1 + lift * 0.05), s * (1 + lift * 0.05));
    ctx.drawImage(sh, -w / 2 - sh.pad, -h / 2 - sh.pad, w + sh.pad * 2, h + sh.pad * 2);
    ctx.restore();
    ctx.globalAlpha = 1;
    // matched glow
    if (c.matchedT >= 0 && c.matchedT < 1.6) {
      const t = c.matchedT;
      ctx.globalAlpha = Math.sin(Math.min(1, t / 1.6) * Math.PI) * (0.75 + 0.25 * Math.sin(t * 12));
      const gl = sprites.glow;
      ctx.save(); ctx.translate(x, y - lift * 6); ctx.scale(s * 1.03, s * 1.03);
      ctx.drawImage(gl, -w / 2 - gl.pad, -h / 2 - gl.pad, w + gl.pad * 2, h + gl.pad * 2);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    ctx.save();
    ctx.translate(x, y - lift * 6);
    ctx.scale(kx * s, s);
    const showFace = c.flip > 0.5;
    const img = showFace ? faceSprite(c.item) : sprites.back;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    // shading as the card turns edge-on, plus a moving sheen
    const r = w * 0.08;
    if (kx < 0.999) {
      rr(ctx, -w / 2, -h / 2, w, h, r);
      ctx.fillStyle = `rgba(0,0,0,${(1 - kx) * 0.45})`; ctx.fill();
    }
    if (flipLift > 0.05) {
      rr(ctx, -w / 2, -h / 2, w, h, r);
      const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      const pos = clamp(c.flip, 0, 1);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(clamp(pos - 0.15, 0, 1), 'rgba(255,255,255,0)');
      g.addColorStop(pos, `rgba(255,255,255,${0.35 * flipLift})`);
      g.addColorStop(clamp(pos + 0.15, 0, 1), 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fill();
    }
    // settled matched pairs keep a coloured frame (owner colour in multiplayer)
    if (c.matchedT >= 0) {
      const col = cfg.players > 1 ? players[c.owner].color : '#3ddc84';
      ctx.globalAlpha = clamp((c.matchedT - 0.6) / 0.6, 0, 1);
      ctx.lineWidth = w * 0.045;
      ctx.strokeStyle = col;
      rr(ctx, -w / 2 + ctx.lineWidth / 2, -h / 2 + ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth, r * 0.9);
      ctx.stroke();
      // tick badge
      const br = w * 0.1;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(w / 2 - br * 1.3, -h / 2 + br * 1.3, br, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = br * 0.3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(w / 2 - br * 1.75, -h / 2 + br * 1.3); ctx.lineTo(w / 2 - br * 1.4, -h / 2 + br * 1.65); ctx.lineTo(w / 2 - br * 0.85, -h / 2 + br * 0.95); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function txt(ctx, s, x, y, size, color, align = 'center', weight = 700) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillText(s, x + size * 0.03, y + size * 0.05);
    ctx.fillStyle = color; ctx.fillText(s, x, y);
  }

  function drawHUD(ctx) {
    const hud = L.hud, cy = hud / 2, fs = hud * 0.36;
    if (cfg.players === 1) {
      const cells = [
        ['MOVES', String(moves)],
        ['TIME', fmtTime(elapsed)],
        ['PAIRS', `${pairsFound} / ${cards.length / 2}`],
      ];
      const bm = IFPD.best.get(`memory-match-${cfg.grid}-moves`), bt = IFPD.best.get(`memory-match-${cfg.grid}-time`);
      cells.push(['BEST', bm == null ? '—' : `${bm} · ${fmtTime(bt)}`]);
      const cw = Math.min(W / cells.length, 380);
      const x0 = W / 2 - (cw * cells.length) / 2;
      cells.forEach(([k, v], i) => {
        const x = x0 + cw * (i + 0.5);
        txt(ctx, k, x, cy - fs * 0.62, fs * 0.5, 'rgba(255,236,200,0.75)', 'center', 700);
        txt(ctx, v, x, cy + fs * 0.35, fs, '#fff6e0', 'center', 800);
      });
    } else {
      const n = players.length;
      const cw = Math.min((W - 40) / n, 420), chh = hud * 0.72;
      const x0 = W / 2 - (cw * n) / 2;
      players.forEach((p, i) => {
        const x = x0 + cw * i + 10, y = (hud - chh) / 2, w = cw - 20;
        const on = i === current && state !== 'won';
        ctx.save();
        if (on) { ctx.shadowColor = p.color; ctx.shadowBlur = 24; }
        rr(ctx, x, y, w, chh, chh * 0.3);
        ctx.fillStyle = on ? IFPD.draw.shade(p.color, -0.15) : 'rgba(20,14,8,0.55)';
        ctx.fill();
        ctx.restore();
        rr(ctx, x, y, w, chh, chh * 0.3);
        ctx.lineWidth = on ? 4 : 2; ctx.strokeStyle = on ? '#fff' : p.color; ctx.stroke();
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(x + chh * 0.5, y + chh / 2, chh * 0.24, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        txt(ctx, p.name, x + chh * 0.9, y + chh / 2, fs * 0.72, '#fff', 'left', 700);
        txt(ctx, String(p.score), x + w - chh * 0.35, y + chh / 2, fs * 1.1, '#fff', 'right', 900);
      });
    }
  }

  function render() {
    const ctx = view.ctx;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    if (!L) computeLayout();
    if (!bg) bg = buildBackground();
    ctx.drawImage(bg, 0, 0, W, H);
    if (state === 'menu') return;
    drawHUD(ctx);
    // draw lifted cards last so they sit above their neighbours
    const order = cards.slice().sort((a, b) => (a.lift + Math.sin(a.flip * Math.PI) + (a.dealT < 1 ? 2 : 0)) - (b.lift + Math.sin(b.flip * Math.PI) + (b.dealT < 1 ? 2 : 0)));
    for (const c of order) drawCard(ctx, c);
    if (banner) {
      const t = banner.t, a = t < 0.2 ? t / 0.2 : t > 1.2 ? Math.max(0, (1.6 - t) / 0.4) : 1;
      const fs = clamp(Math.min(W, H) * 0.075, 34, 80);
      ctx.globalAlpha = a;
      ctx.font = `800 ${fs}px ${FONT}`;
      const tw = ctx.measureText(banner.text).width;
      const bw = tw + fs * 1.4, bh = fs * 1.6;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 8;
      rr(ctx, W / 2 - bw / 2, H / 2 - bh / 2, bw, bh, bh / 2);
      ctx.fillStyle = IFPD.draw.shade(banner.color, -0.2); ctx.fill();
      ctx.restore();
      rr(ctx, W / 2 - bw / 2, H / 2 - bh / 2, bw, bh, bh / 2);
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.stroke();
      txt(ctx, banner.text, W / 2, H / 2 + 2, fs, '#fff', 'center', 800);
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------------------
  // Menu
  // ---------------------------------------------------------------------------

  let menuEl = null;
  function hideMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }

  function showMenu() {
    state = 'menu';
    cards = []; open = []; busy = false; banner = null;
    IFPD.overlay.hide();
    hideMenu();
    const o = document.createElement('div');
    o.className = 'ifpd-overlay';
    o.innerHTML = `<div class="ifpd-card">
      <h2>Memory Match</h2>
      <p>Turn over two cards. Find all the matching pairs!</p>
      <div class="mm-group"><h3>Cards</h3><div class="mm-opts" data-g="grid"></div></div>
      <div class="mm-group"><h3>Theme</h3><div class="mm-opts" data-g="theme"></div></div>
      <div class="mm-group"><h3>Players</h3><div class="mm-opts" data-g="players"></div></div>
      <div class="mm-best"></div>
      <div class="ifpd-buttons"><button class="ifpd-btn good mm-start">▶ Start</button></div></div>`;
    const sel = { ...cfg };
    const bestLine = o.querySelector('.mm-best');
    const refresh = () => {
      o.querySelectorAll('.mm-opt').forEach(b => b.classList.toggle('on', String(sel[b.dataset.g]) === b.dataset.v));
      if (sel.players > 1) bestLine.textContent = 'Take turns — a match earns another go.';
      else {
        const bm = IFPD.best.get(`memory-match-${sel.grid}-moves`), bt = IFPD.best.get(`memory-match-${sel.grid}-time`);
        bestLine.textContent = bm == null ? 'No best score yet for this size.' : `Best: ${bm} moves · ${fmtTime(bt)}`;
      }
    };
    const addOpt = (g, v, label) => {
      const b = document.createElement('button');
      b.className = 'ifpd-btn mm-opt';
      b.dataset.g = g; b.dataset.v = String(v);
      b.textContent = label;
      b.addEventListener('click', () => { sel[g] = v; IFPD.sfx.play('click'); refresh(); });
      o.querySelector(`[data-g=${g}]`).append(b);
    };
    for (const k of Object.keys(GRIDS)) addOpt('grid', k, `${k.replace('x', ' × ')} (${GRIDS[k][0] * GRIDS[k][1] / 2} pairs)`);
    for (const k of Object.keys(THEMES)) addOpt('theme', k, THEMES[k].label);
    for (let n = 1; n <= 4; n++) addOpt('players', n, n === 1 ? '1 Player' : `${n} Players`);
    o.querySelector('.mm-start').addEventListener('click', () => { IFPD.sfx.play('flip'); start(sel); });
    refresh();
    (IFPD.stage || document.body).append(o);
    menuEl = o;
  }

  // ---------------------------------------------------------------------------

  view = IFPD.fitCanvas(canvas, (w, h) => { W = w; H = h; if (view) { computeLayout(); bg = null; } });
  W = view.width; H = view.height;
  computeLayout();
  const loop = IFPD.loop(update, render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loop.resume(); });

  window.__game = {
    get state() { return state; }, get cards() { return cards; }, get open() { return open; }, get busy() { return busy; },
    get moves() { return moves; }, get pairsFound() { return pairsFound; }, get players() { return players; }, get current() { return current; },
    get cfg() { return cfg; }, get elapsed() { return elapsed; },
    center(i) { const p = slot(i); return [p.x, p.y]; },
    start, showMenu,
  };

  showMenu();
})();
