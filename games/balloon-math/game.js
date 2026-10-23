/*
 * Balloon Pop Maths — pop the balloon carrying the right answer.
 * 1 player or 2 teams (split screen). World units: each field is 1000 units tall.
 */
(function () {
  'use strict';

  const { util } = IFPD;
  const { clamp, rand, randInt, shuffle } = util;
  const TAU = Math.PI * 2;
  const FONT = '"Segoe UI", Roboto, system-ui, sans-serif';

  const ROUND_TIME = 90;
  const HUD_BOTTOM = 225;           // balloons below this line are "reachable"
  const BRX = 70, BRY = 88;         // balloon radii (units)
  const ROPE_N = 9, ROPE_SEG = 17;
  const COLORS = ['#e53935', '#1e88e5', '#43a047', '#f9c623', '#fb8c00', '#8e24aa', '#ec407a', '#00acc1'];

  const LEVELS = {
    add: { label: 'Addition', hint: 'up to 20' },
    sub: { label: 'Subtraction', hint: 'up to 20' },
    mul: { label: 'Multiplication', hint: 'tables to 10' },
    div: { label: 'Division', hint: 'exact' },
    mix: { label: 'Mixed', hint: 'all four' },
  };
  const TEAMS = [
    { name: 'Team Blue', color: '#2f80ed', light: '#9cc8ff' },
    { name: 'Team Orange', color: '#f2711c', light: '#ffc08a' },
  ];

  // ---------------------------------------------------------------------------
  // Questions + plausible distractors
  // ---------------------------------------------------------------------------

  function makeQuestion(level, prevText) {
    for (let tries = 0; tries < 20; tries++) {
      const op = level === 'mix' ? ['add', 'sub', 'mul', 'div'][randInt(0, 3)] : level;
      let a, b, ans, sym;
      if (op === 'add') { a = randInt(1, 18); b = randInt(1, 20 - a); ans = a + b; sym = '+'; }
      else if (op === 'sub') { a = randInt(3, 20); b = randInt(1, a); ans = a - b; sym = '−'; }
      else if (op === 'mul') { a = randInt(2, 10); b = randInt(Math.random() < 0.15 ? 1 : 2, 10); if (Math.random() < 0.5) [a, b] = [b, a]; ans = a * b; sym = '×'; }
      else { b = randInt(2, 10); ans = randInt(1, 10); a = b * ans; sym = '÷'; }
      const text = `${a} ${sym} ${b} = ?`;
      if (text === prevText) continue;
      return { op, a, b, ans, text, distractors: distractorsFor(op, a, b, ans) };
    }
    return makeQuestion('add', '');
  }

  function distractorsFor(op, a, b, ans) {
    let near = [], far = [];
    const rev = n => (n >= 10 ? Number(String(n).split('').reverse().join('')) : -1);
    if (op === 'add') {
      near = [ans - 1, ans + 1, ans - 2, ans + 2];
      far = [Math.abs(a - b), ans + 10, ans - 10, ans + 3, ans - 3, rev(ans), a * b <= 30 ? a * b : -1];
    } else if (op === 'sub') {
      near = [ans - 1, ans + 1, ans + 2, ans - 2];
      far = [a + b <= 30 ? a + b : -1, ans + 10, ans + 3, a, b, rev(ans)];
    } else if (op === 'mul') {
      near = [a * (b + 1), a * (b - 1), (a + 1) * b, (a - 1) * b, ans + 1, ans - 1];
      far = [a + b, ans + 10, ans - 10, rev(ans), ans + 2];
    } else {
      near = [ans - 1, ans + 1, ans + 2, ans - 2];
      far = [b, a - b, ans + 3, ans * 2 !== a ? ans * 2 : -1, a / b + 10];
    }
    const out = [];
    const add = v => { if (Number.isInteger(v) && v >= 0 && v !== ans && !out.includes(v)) out.push(v); };
    shuffle(near).forEach(add);
    for (let k = 3; out.length < 4; k++) add(ans + k); // tiny answers: stay close
    shuffle(far).forEach(add);
    for (let k = 3; out.length < 12; k++) { add(ans + k); add(ans - k); }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Sprites: balloon bodies per colour, clouds
  // ---------------------------------------------------------------------------

  function hexRgb(h) { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
  function mix(h, t, to = 255) { const [r, g, b] = hexRgb(h); const m = c => Math.round(c + (to - c) * t); return `rgb(${m(r)},${m(g)},${m(b)})`; }
  function rgba(h, a) { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; }

  function balloonPath(ctx, rx, ry) {
    ctx.beginPath();
    ctx.moveTo(0, -ry);
    ctx.bezierCurveTo(rx * 0.95, -ry, rx * 1.08, -ry * 0.15, rx * 0.78, ry * 0.42);
    ctx.bezierCurveTo(rx * 0.55, ry * 0.78, rx * 0.18, ry * 0.97, 0, ry);
    ctx.bezierCurveTo(-rx * 0.18, ry * 0.97, -rx * 0.55, ry * 0.78, -rx * 0.78, ry * 0.42);
    ctx.bezierCurveTo(-rx * 1.08, -ry * 0.15, -rx * 0.95, -ry, 0, -ry);
    ctx.closePath();
  }

  const sprites = { scale: 0, balloon: {}, clouds: [] };

  function makeBalloonSprite(color, scale) {
    const rx = BRX * scale, ry = BRY * scale;
    const w = Math.ceil(rx * 2.4), h = Math.ceil(ry * 2.5);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.translate(w / 2, ry * 1.12);
    // body: translucent latex lit from the top-left, light glowing through the lower half
    balloonPath(x, rx, ry);
    const g = x.createRadialGradient(-rx * 0.35, -ry * 0.45, rx * 0.05, 0, ry * 0.05, ry * 1.08);
    g.addColorStop(0, mix(color, 0.55));
    g.addColorStop(0.35, mix(color, 0.08));
    g.addColorStop(0.75, mix(color, 0.25, 0));
    g.addColorStop(1, mix(color, 0.55, 0));
    x.fillStyle = g;
    x.globalAlpha = 0.94;
    x.fill();
    x.globalAlpha = 1;
    x.save();
    balloonPath(x, rx, ry); x.clip();
    const tg = x.createRadialGradient(rx * 0.15, ry * 0.55, 0, rx * 0.15, ry * 0.55, rx * 0.9);
    tg.addColorStop(0, mix(color, 0.35).replace('rgb', 'rgba').replace(')', ',0.55)'));
    tg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = tg;
    x.fillRect(-rx * 1.5, -ry * 1.5, rx * 3, ry * 3);
    // rim light on the right edge
    x.strokeStyle = 'rgba(255,255,255,0.18)';
    x.lineWidth = rx * 0.06;
    x.beginPath(); x.ellipse(0, -ry * 0.05, rx * 0.9, ry * 0.92, 0, -0.6, 0.9); x.stroke();
    x.restore();
    // specular highlights
    x.save();
    x.translate(-rx * 0.4, -ry * 0.5); x.rotate(-0.55);
    let s = x.createRadialGradient(0, 0, 0, 0, 0, rx * 0.32);
    s.addColorStop(0, 'rgba(255,255,255,0.95)'); s.addColorStop(0.5, 'rgba(255,255,255,0.35)'); s.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = s; x.scale(1, 0.55);
    x.beginPath(); x.arc(0, 0, rx * 0.32, 0, TAU); x.fill();
    x.restore();
    x.fillStyle = 'rgba(255,255,255,0.55)';
    x.beginPath(); x.ellipse(-rx * 0.12, -ry * 0.72, rx * 0.06, ry * 0.035, -0.3, 0, TAU); x.fill();
    // knot
    x.fillStyle = mix(color, 0.3, 0);
    x.beginPath();
    x.moveTo(-rx * 0.1, ry * 1.1); x.quadraticCurveTo(0, ry * 0.92, rx * 0.1, ry * 1.1);
    x.quadraticCurveTo(0, ry * 1.05, -rx * 0.1, ry * 1.1); x.fill();
    x.beginPath(); x.ellipse(0, ry * 1.0, rx * 0.07, ry * 0.045, 0, 0, TAU); x.fill();
    c.ox = (w / 2) / scale; c.oy = (ry * 1.12) / scale; c.uw = w / scale; c.uh = h / scale;
    return c;
  }

  function makeCloud(scale, seed) {
    const w = 640, h = 280;
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * scale); c.height = Math.ceil(h * scale);
    const x = c.getContext('2d');
    x.scale(scale, scale);
    const puffs = [];
    const n = 7 + (seed % 3);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      puffs.push({ x: 150 + t * 340 + rand(-15, 15), y: 180 - Math.sin(t * Math.PI) * rand(35, 70), r: 42 + Math.sin(t * Math.PI) * rand(25, 48) });
    }
    puffs.push({ x: 320, y: 190, r: 78 });
    // shadowed underside
    for (const p of puffs) {
      const g = x.createRadialGradient(p.x, p.y + p.r * 0.3, 0, p.x, p.y + p.r * 0.3, p.r * 1.1);
      g.addColorStop(0, 'rgba(176,196,222,0.55)'); g.addColorStop(1, 'rgba(176,196,222,0)');
      x.fillStyle = g; x.beginPath(); x.arc(p.x, p.y + p.r * 0.3, p.r * 1.1, 0, TAU); x.fill();
    }
    for (const p of puffs) {
      const g = x.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.4, 0, p.x, p.y, p.r);
      g.addColorStop(0, 'rgba(255,255,255,0.98)'); g.addColorStop(0.7, 'rgba(248,251,255,0.85)'); g.addColorStop(1, 'rgba(235,242,252,0)');
      x.fillStyle = g; x.beginPath(); x.arc(p.x, p.y, p.r, 0, TAU); x.fill();
    }
    c.uw = w; c.uh = h;
    return c;
  }

  function ensureSprites(scale) {
    if (Math.abs(sprites.scale - scale) < 0.01) return;
    sprites.scale = scale;
    for (const col of COLORS) sprites.balloon[col] = makeBalloonSprite(col, scale);
    sprites.clouds = [0, 1, 2, 3].map(i => makeCloud(scale, i));
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const canvas = document.getElementById('game');
  IFPD.setupPage({ title: 'Balloon Pop Maths', onRestart: () => restart() });
  let view = null, W = 0, H = 0, U = 1, bg = null;

  let level = 'add';
  let teams = false;
  let state = 'menu';         // 'menu' | 'play' | 'over'
  let timeLeft = ROUND_TIME;
  let fields = [];
  let clouds = [];
  let simTime = 0;
  let nextId = 1;

  function makeField(idx) {
    return {
      idx, x0: 0, wPx: 1, fw: 1000,
      q: null, balloons: [], shreds: [], ropes: [], popups: [],
      score: 0, streak: 0, bestStreak: 0, correct: 0, wrong: 0,
      spawnT: 0, pending: [], flash: 0, flashColor: '#3ddc84', shake: 0, qAnim: 0, recentWrong: [],
    };
  }

  function targetCount(f) { return teams ? clamp(Math.round(f.fw / 215), 4, 6) : clamp(Math.round(f.fw / 245), 5, 8); }

  function layout() {
    if (!view || !W || !H) return;
    U = H / 1000;
    ensureSprites(U * view.dpr);
    bg = null;
    const n = fields.length || 1;
    fields.forEach((f, i) => {
      const wPx = W / n, fw = wPx / U, k = fw / f.fw;
      if (Math.abs(k - 1) > 1e-6) {
        for (const b of f.balloons) { b.x *= k; b.baseX *= k; resetRope(b); }
        for (const s of f.shreds) s.x *= k;
        for (const r of f.ropes) for (const p of r.pts) { p.x *= k; p.px *= k; }
        for (const p of f.popups) p.x *= k;
      }
      f.x0 = i * wPx; f.wPx = wPx; f.fw = fw;
    });
    if (!clouds.length) {
      for (let i = 0; i < 6; i++) clouds.push({ x: rand(0, 1), y: rand(0.08, 0.6), s: rand(0.6, 1.25), v: rand(0.004, 0.012), k: i % 4, a: rand(0.75, 1) });
    }
  }

  function start(lv, tm) {
    level = lv; teams = tm;
    state = 'play';
    timeLeft = ROUND_TIME;
    IFPD.overlay.hide();
    hideMenu();
    fields = teams ? [makeField(0), makeField(1)] : [makeField(0)];
    for (const f of fields) f.fw = (W / fields.length) / U;
    layout();
    for (const f of fields) newQuestion(f, true);
    IFPD.sfx.play('whoosh');
    loop.resume();
  }

  function restart() {
    if (state === 'menu') return;
    start(level, teams);
  }

  // ---------------------------------------------------------------------------
  // Balloons
  // ---------------------------------------------------------------------------

  function interactive(b) { return b.state === 'float'; }

  function pickX(f) {
    let best = f.fw / 2, bestScore = -1;
    const lo = BRX + 24, hi = f.fw - BRX - 24;
    for (let i = 0; i < 12; i++) {
      const x = rand(lo, hi);
      let d = 1e9;
      for (const b of f.balloons) {
        if (b.state === 'leaving') continue;
        const dy = Math.max(0, b.y - 600) / 400; // only care about balloons low on screen
        if (b.y < 600) continue;
        d = Math.min(d, Math.abs(b.x - x) + (1 - dy) * 80);
      }
      for (const p of f.pending) if (p.x !== undefined) d = Math.min(d, Math.abs(p.x - x));
      if (d > bestScore) { bestScore = d; best = x; }
    }
    return best;
  }

  function spawnBalloon(f, value, delayIdx = 0, rush = false) {
    const x = pickX(f);
    const used = new Set(f.balloons.filter(b => b.state !== 'leaving').map(b => b.color));
    const free = COLORS.filter(c => !used.has(c));
    const color = (free.length ? free : COLORS)[randInt(0, (free.length ? free : COLORS).length - 1)];
    const b = {
      id: nextId++, value, color, x, baseX: x, y: 1000 + BRY + 40 + delayIdx * 120,
      vy: rush ? -rand(360, 430) : -rand(80, 100), speed: rand(68, 95) * (teams ? 1 : 1),
      phase: rand(0, TAU), swayF: rand(0.5, 0.9), swayA: rand(12, 26), tilt: 0,
      state: 'float', t: 0, scale: 1, alpha: 1, wobble: 0, dvx: 0, dvy: 0,
      rope: [],
    };
    resetRope(b);
    f.balloons.push(b);
    return b;
  }

  function resetRope(b) {
    b.rope = [];
    for (let i = 0; i < ROPE_N; i++) {
      const y = b.y + BRY + 8 + i * ROPE_SEG;
      b.rope.push({ x: b.x, y, px: b.x, py: y });
    }
  }

  function onScreenValues(f) {
    return new Set(f.balloons.filter(interactive).map(b => b.value));
  }

  function chooseValue(f) {
    const q = f.q;
    const shown = onScreenValues(f);
    for (const p of f.pending) shown.add(p.value);
    // the right answer must always be reachable
    const reachable = f.balloons.some(b => interactive(b) && b.value === q.ans && b.y > HUD_BOTTOM + 200);
    const queued = f.pending.some(p => p.value === q.ans);
    if (!reachable && !queued) return q.ans;
    const options = q.distractors.filter(v => !shown.has(v));
    const fresh = options.filter(v => !f.recentWrong.includes(v));
    const pool = (fresh.length ? fresh : options).slice(0, 7);
    if (!pool.length) return null;
    return pool[randInt(0, pool.length - 1)];
  }

  function newQuestion(f, first) {
    f.q = makeQuestion(level, f.q && f.q.text);
    f.qAnim = 1;
    f.recentWrong = [];
    // everything still on screen drifts away; a fresh bunch rushes in
    for (const b of f.balloons) if (b.state === 'float') { b.state = 'leaving'; b.t = 0; }
    const n = targetCount(f);
    const values = [f.q.ans];
    const pool = f.q.distractors.slice(0, 8);
    while (values.length < n && pool.length) values.push(pool.splice(randInt(0, Math.min(4, pool.length - 1)), 1)[0]);
    shuffle(values);
    f.pending = [];
    values.forEach((v, i) => f.pending.push({ value: v, delay: (first ? 0.15 : 0.35) + i * 0.16, rush: true, idx: i }));
    f.spawnT = 2.5;
  }

  function popBalloon(f, b) {
    const pan = panOf(f, b.x);
    if (b.value === f.q.ans) {
      f.streak++; f.correct++;
      f.bestStreak = Math.max(f.bestStreak, f.streak);
      const bonus = f.streak >= 2 ? Math.min(10, (f.streak - 1) * 2) : 0;
      f.score += 10 + bonus;
      f.flash = 1; f.flashColor = '#3ddc84';
      burst(f, b);
      f.balloons.splice(f.balloons.indexOf(b), 1);
      f.popups.push({ x: b.x, y: b.y, text: '+' + (10 + bonus), sub: bonus ? `Streak ×${f.streak}!` : '', color: '#ffffff', age: 0, life: 1.3 });
      IFPD.sfx.play('pop', { volume: 1, pitch: rand(0.9, 1.1), pan });
      IFPD.sfx.play('correct', { volume: 0.7, pan, pitch: 1 + Math.min(f.streak, 6) * 0.03 });
      newQuestion(f, false);
    } else {
      f.streak = 0; f.wrong++;
      f.score = Math.max(0, f.score - 3);
      f.flash = 1; f.flashColor = '#ff5a4a'; f.shake = 1;
      b.state = 'wrong'; b.t = 0;
      f.recentWrong.push(b.value);
      f.popups.push({ x: b.x, y: b.y - BRY, text: '−3', sub: '', color: '#ff6b5a', age: 0, life: 1.1 });
      IFPD.sfx.play('wrong', { volume: 0.8, pan });
      IFPD.sfx.play('whoosh', { volume: 0.5, pitch: 2.2, pan });
    }
  }

  function burst(f, b) {
    for (let i = 0; i < 18; i++) {
      const a = rand(0, TAU), v = rand(250, 750);
      f.shreds.push({
        x: b.x + Math.cos(a) * BRX * 0.6, y: b.y + Math.sin(a) * BRY * 0.6,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, rot: rand(0, TAU), vr: rand(-14, 14),
        w: rand(14, 30), h: rand(8, 18), color: b.color, age: 0, life: rand(0.8, 1.4), ring: false,
      });
    }
    f.shreds.push({ x: b.x, y: b.y, ring: true, age: 0, life: 0.35 });
    // the string is let go and flutters down
    f.ropes.push({ pts: b.rope.map(p => ({ ...p })), age: 0, life: 1.6 });
  }

  function panOf(f, x) { return clamp(((f.x0 + x * U) / W) * 2 - 1, -1, 1) * 0.8; }

  function stepRope(pts, ax, ay, dt, free) {
    const g = 900, damp = 0.985;
    for (let i = free ? 0 : 1; i < pts.length; i++) {
      const p = pts[i];
      const vx = (p.x - p.px) * damp, vy = (p.y - p.py) * damp;
      p.px = p.x; p.py = p.y;
      p.x += vx; p.y += vy + g * dt * dt;
    }
    if (!free) { pts[0].x = ax; pts[0].y = ay; pts[0].px = ax; pts[0].py = ay; }
    for (let it = 0; it < 4; it++) {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        const diff = (d - ROPE_SEG) / d;
        if (i === 1 && !free) { b.x -= dx * diff; b.y -= dy * diff; }
        else { a.x += dx * diff * 0.5; a.y += dy * diff * 0.5; b.x -= dx * diff * 0.5; b.y -= dy * diff * 0.5; }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  function updateField(f, dt) {
    f.flash = Math.max(0, f.flash - dt * 2.2);
    f.shake = Math.max(0, f.shake - dt * 3);
    f.qAnim = Math.max(0, f.qAnim - dt * 3);

    if (state === 'play') {
      for (let i = f.pending.length - 1; i >= 0; i--) {
        const p = f.pending[i];
        if ((p.delay -= dt) <= 0) {
          f.pending.splice(i, 1);
          // keep the screen free of duplicate values
          if (!(p.value !== f.q.ans && onScreenValues(f).has(p.value))) spawnBalloon(f, p.value, 0, p.rush);
        }
      }
      f.spawnT -= dt;
      const live = f.balloons.filter(interactive).length + f.pending.length;
      const needAnswer = !f.balloons.some(b => interactive(b) && b.value === f.q.ans && b.y > HUD_BOTTOM + 200) && !f.pending.some(p => p.value === f.q.ans);
      if (needAnswer || (live < targetCount(f) && f.spawnT <= 0)) {
        const v = chooseValue(f);
        if (v !== null) { spawnBalloon(f, v, 0, needAnswer); f.spawnT = rand(0.7, 1.2); }
      }
    }

    // balloons
    const list = f.balloons;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      b.t += dt;
      if (b.state === 'float') {
        b.vy += (-b.speed - b.vy) * Math.min(1, dt * 1.6);
        b.y += b.vy * dt;
        const sway = Math.sin(simTime * b.swayF + b.phase) * b.swayA;
        // soft separation so numbers never sit on top of each other
        for (const o of list) {
          if (o === b || o.state === 'leaving') continue;
          const dx = b.x - o.x, dy = (b.y - o.y) * 0.8, d = Math.hypot(dx, dy);
          if (d < BRX * 2.3 && d > 0.01) { const push = (BRX * 2.3 - d) * 2.2 * dt; b.baseX += (dx / d) * push; b.y += (dy / d) * push * 0.3; }
        }
        b.baseX = clamp(b.baseX, BRX + 10, f.fw - BRX - 10);
        const nx = b.baseX + sway;
        b.tilt = clamp((nx - b.x) / Math.max(dt, 1e-4) * 0.0025, -0.18, 0.18);
        b.x = nx;
        if (b.y < -BRY * 1.5 - ROPE_N * ROPE_SEG) list.splice(i, 1);
      } else if (b.state === 'leaving') {
        b.vy -= 900 * dt;
        b.y += b.vy * dt;
        b.alpha = Math.max(0, 1 - b.t / 0.7);
        if (b.alpha <= 0 || b.y < -300) list.splice(i, 1);
      } else if (b.state === 'wrong') {
        // shake "no", then deflate and zip around erratically
        if (b.t < 0.35) {
          b.wobble = Math.sin(b.t * 50) * (1 - b.t / 0.35);
          b.x = b.baseX + b.wobble * 14;
        } else {
          const k = (b.t - 0.35) / 1.1;
          if (Math.random() < dt * 12) { const a = rand(0, TAU); b.dvx = Math.cos(a) * 520; b.dvy = Math.sin(a) * 520 - 200; }
          b.x += b.dvx * dt; b.y += b.dvy * dt;
          b.tilt += rand(-1, 1) * dt * 20;
          b.scale = Math.max(0.15, 1 - k * 0.85);
          b.alpha = clamp(1.3 - k, 0, 1);
          if (k >= 1) list.splice(i, 1);
        }
      }
      if (list[i] === b) stepRope(b.rope, b.x - Math.sin(b.tilt) * (BRY + 6) * b.scale, b.y + Math.cos(b.tilt) * (BRY + 6) * b.scale, dt, false);
    }

    for (let i = f.shreds.length - 1; i >= 0; i--) {
      const s = f.shreds[i];
      s.age += dt;
      if (s.age > s.life) { f.shreds.splice(i, 1); continue; }
      if (s.ring) continue;
      s.vx *= 1 - dt * 2.5; s.vy = s.vy * (1 - dt * 2.5) + 900 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.rot += s.vr * dt;
    }
    for (let i = f.ropes.length - 1; i >= 0; i--) {
      const r = f.ropes[i];
      r.age += dt;
      if (r.age > r.life) { f.ropes.splice(i, 1); continue; }
      stepRope(r.pts, 0, 0, dt, true);
    }
    for (let i = f.popups.length - 1; i >= 0; i--) if ((f.popups[i].age += dt) > f.popups[i].life) f.popups.splice(i, 1);
  }

  function update(dt) {
    simTime += dt;
    for (const c of clouds) { c.x += c.v * dt; if (c.x > 1.25) { c.x = -0.3; c.y = rand(0.08, 0.6); } }
    if (state === 'play') {
      const before = Math.ceil(timeLeft);
      timeLeft -= dt;
      if (Math.ceil(timeLeft) !== before && timeLeft <= 10 && timeLeft > 0) IFPD.sfx.play('tick', { volume: 1.6 });
      if (timeLeft <= 0) { timeLeft = 0; endRound(); }
    }
    for (const f of fields) updateField(f, dt);
  }

  function bestKey() { return 'balloon-math-' + level; }

  function endRound() {
    state = 'over';
    IFPD.sfx.play('buzzer', { volume: 0.6 });
    for (const f of fields) for (const b of f.balloons) if (b.state === 'float') { b.state = 'leaving'; b.t = 0; }
    let title, text;
    if (teams) {
      const [a, b] = fields;
      title = a.score === b.score ? "It's a tie!" : (a.score > b.score ? TEAMS[0].name : TEAMS[1].name) + ' wins!';
      text = `${TEAMS[0].name}: ${a.score} points (${a.correct} right)\n${TEAMS[1].name}: ${b.score} points (${b.correct} right)`;
      setTimeout(() => { IFPD.sfx.play('win'); IFPD.confetti(2800); }, 400);
    } else {
      const f = fields[0];
      const record = f.score > 0 && IFPD.best.submit(bestKey(), f.score);
      title = "Time's up!";
      text = `Score: ${f.score}\n${f.correct} right, ${f.wrong} wrong · best streak ${f.bestStreak}\n` +
        (record ? `New best for ${LEVELS[level].label}!` : `Best for ${LEVELS[level].label}: ${IFPD.best.get(bestKey()) ?? 0}`);
      setTimeout(() => { IFPD.sfx.play(record ? 'win' : 'goal'); if (record) IFPD.confetti(2800); }, 400);
    }
    setTimeout(() => {
      if (state !== 'over') return;
      IFPD.overlay.show({
        title, text,
        buttons: [
          { label: 'Play again', kind: 'good', onClick: () => start(level, teams) },
          { label: 'Change level', kind: 'primary', onClick: () => showMenu() },
        ],
      });
    }, 900);
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  function balloonHit(b, x, y) {
    const s = b.scale;
    const dx = (x - b.x) / (BRX * 1.18 * s), dy = (y - b.y) / (BRY * 1.15 * s);
    return dx * dx + dy * dy <= 1;
  }

  IFPD.pointers(canvas, {
    down(p) {
      if (state !== 'play') return false;
      const f = fields.length > 1 ? fields[clamp(Math.floor(p.x / (W / fields.length)), 0, fields.length - 1)] : fields[0];
      const x = (p.x - f.x0) / U, y = p.y / U;
      for (let i = f.balloons.length - 1; i >= 0; i--) {
        const b = f.balloons[i];
        if (interactive(b) && balloonHit(b, x, y)) { popBalloon(f, b); return false; }
      }
      IFPD.sfx.play('tap', { volume: 0.4, pan: panOf(f, x) });
      return false;
    },
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  function buildBackground() {
    const c = document.createElement('canvas');
    const dpr = view.dpr;
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    let g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2f7fd0'); g.addColorStop(0.55, '#7fc0ef'); g.addColorStop(1, '#d6eefb');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // sun glow
    const sx = W * 0.86, sy = H * 0.1;
    g = x.createRadialGradient(sx, sy, 0, sx, sy, H * 0.8);
    g.addColorStop(0, 'rgba(255,250,225,0.95)'); g.addColorStop(0.06, 'rgba(255,244,200,0.85)'); g.addColorStop(0.12, 'rgba(255,236,180,0.35)');
    g.addColorStop(0.4, 'rgba(255,230,170,0.12)'); g.addColorStop(1, 'rgba(255,230,170,0)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // distant hills
    const hill = (base, amp, color1, color2, seed) => {
      x.beginPath(); x.moveTo(0, H);
      for (let i = 0; i <= 60; i++) {
        const px = (i / 60) * W;
        const py = H * base - Math.sin(i * 0.21 + seed) * H * amp - Math.sin(i * 0.53 + seed * 2) * H * amp * 0.4;
        x.lineTo(px, py);
      }
      x.lineTo(W, H); x.closePath();
      const hg = x.createLinearGradient(0, H * (base - amp * 1.4), 0, H);
      hg.addColorStop(0, color1); hg.addColorStop(1, color2);
      x.fillStyle = hg; x.fill();
    };
    hill(0.9, 0.035, '#8fb9c9', '#a9cbd6', 1.3);
    hill(0.95, 0.03, '#6fae5a', '#4f8f3f', 4.1);
    hill(0.99, 0.02, '#5b9e45', '#3f7d30', 2.2);
    // haze at the horizon
    g = x.createLinearGradient(0, H * 0.8, 0, H);
    g.addColorStop(0, 'rgba(230,244,255,0)'); g.addColorStop(1, 'rgba(230,244,255,0.25)');
    x.fillStyle = g; x.fillRect(0, H * 0.8, W, H * 0.2);
    return c;
  }

  function txt(ctx, s, x, y, size, fill, { align = 'center', weight = 800, stroke = 'rgba(0,0,0,0.55)', sw = 0.14 } = {}) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    if (stroke) { ctx.lineWidth = size * sw; ctx.strokeStyle = stroke; ctx.strokeText(s, x, y); }
    ctx.fillStyle = fill; ctx.fillText(s, x, y);
  }

  function roundRect(ctx, x, y, w, h, r) { IFPD.draw.roundRect(ctx, x, y, w, h, r); }

  function drawRope(ctx, pts, alpha, curl) {
    if (pts.length < 2) return;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(250,250,250,0.9)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    // curly ribbon: small sideways wiggle that grows towards the end
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      const off = Math.sin(i * 2.1 + curl) * (3 + i * 0.9);
      ctx.quadraticCurveTo(mx - (dy / d) * off, my + (dx / d) * off, b.x, b.y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(80,80,90,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawBalloon(ctx, b) {
    const spr = sprites.balloon[b.color];
    drawRope(ctx, b.rope, b.alpha, b.phase);
    ctx.save();
    ctx.globalAlpha = b.alpha;
    ctx.translate(b.x, b.y);
    ctx.rotate(b.tilt);
    let sx = b.scale, sy = b.scale;
    if (b.state === 'wrong' && b.t < 0.35) { sx *= 1 + b.wobble * 0.08; sy *= 1 - b.wobble * 0.08; }
    if (b.state === 'wrong' && b.t >= 0.35) sy *= 0.85 + 0.15 * Math.sin(b.t * 30); // wrinkly flutter
    ctx.scale(sx, sy);
    ctx.drawImage(spr, -spr.ox, -spr.oy, spr.uw, spr.uh);
    if (b.state !== 'wrong' || b.t < 0.6) {
      const s = String(b.value);
      const size = s.length >= 3 ? 60 : 76;
      ctx.font = `900 ${size}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.lineWidth = size * 0.16; ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.strokeText(s, 0, -4);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(s, 0, -6);
    }
    ctx.restore();
  }

  function drawHUD(ctx, f) {
    const fw = f.fw;
    const pad = 24;
    const sx = f.shake ? Math.sin(simTime * 70) * 10 * f.shake : 0;
    // question board
    const sideW = teams ? 170 : 220;
    const qw = Math.min(fw - 2 * sideW - 4 * pad, 820), qh = 170;
    const qx = fw / 2 - qw / 2 + sx, qy = 22;
    ctx.save();
    ctx.shadowColor = 'rgba(0,30,70,0.35)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
    roundRect(ctx, qx, qy, qw, qh, 32);
    const g = ctx.createLinearGradient(0, qy, 0, qy + qh);
    g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#e6eef7');
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();
    if (f.flash > 0) {
      roundRect(ctx, qx, qy, qw, qh, 32);
      ctx.fillStyle = rgba(f.flashColor, f.flash * 0.45); ctx.fill();
    }
    roundRect(ctx, qx + 3, qy + 3, qw - 6, qh - 6, 29);
    ctx.lineWidth = 6; ctx.strokeStyle = teams ? rgba(TEAMS[f.idx].color, 0.85) : 'rgba(47,128,237,0.35)'; ctx.stroke();
    if (f.q) {
      const k = 1 + f.qAnim * 0.25;
      let size = 118;
      ctx.font = `900 ${size}px ${FONT}`;
      const tw = ctx.measureText(f.q.text).width;
      if (tw > qw - 60) size *= (qw - 60) / tw;
      ctx.save();
      ctx.translate(qx + qw / 2, qy + qh / 2 + 4);
      ctx.scale(k, k);
      txt(ctx, f.q.text, 0, 0, size, '#1d2a3a', { stroke: null });
      ctx.restore();
    }
    // score box (left) and timer / streak (right)
    const box = (x, label, value, color) => {
      ctx.save();
      ctx.shadowColor = 'rgba(0,30,70,0.3)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 5;
      roundRect(ctx, x, qy + 8, sideW, qh - 16, 24);
      ctx.fillStyle = 'rgba(16,40,72,0.78)'; ctx.fill();
      ctx.restore();
      txt(ctx, label, x + sideW / 2, qy + 42, 28, 'rgba(220,235,255,0.85)', { weight: 700, stroke: null });
      txt(ctx, value, x + sideW / 2, qy + 108, 68, color, { weight: 900, stroke: null });
    };
    box(pad, teams ? TEAMS[f.idx].name.replace('Team ', '') : 'SCORE', String(f.score), teams ? TEAMS[f.idx].light : '#ffe08a');
    const t = Math.ceil(timeLeft);
    const tStr = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    box(fw - pad - sideW, 'TIME', tStr, timeLeft <= 10 ? '#ff8a7a' : '#ffffff');
    // streak flames under the question
    if (f.streak >= 2) {
      txt(ctx, `Streak ×${f.streak}`, fw / 2, qy + qh + 34, 40, '#fff3b0', { weight: 800, stroke: 'rgba(120,60,0,0.6)' });
    }
  }

  function render() {
    const ctx = view.ctx;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    if (!bg) bg = buildBackground();
    ctx.drawImage(bg, 0, 0, W, H);
    // clouds drifting across the whole sky
    ctx.save();
    ctx.scale(U, U);
    const totalW = W / U;
    for (const c of clouds) {
      const spr = sprites.clouds[c.k];
      ctx.globalAlpha = c.a;
      ctx.drawImage(spr, c.x * totalW, c.y * 1000, spr.uw * c.s, spr.uh * c.s);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    for (const f of fields) {
      ctx.save();
      ctx.beginPath(); ctx.rect(f.x0, 0, f.wPx, H); ctx.clip();
      ctx.translate(f.x0, 0);
      ctx.scale(U, U);
      if (teams) {
        const tg = ctx.createLinearGradient(0, 0, 0, 1000);
        tg.addColorStop(0, rgba(TEAMS[f.idx].color, 0.0)); tg.addColorStop(1, rgba(TEAMS[f.idx].color, 0.12));
        ctx.fillStyle = tg; ctx.fillRect(0, 0, f.fw, 1000);
      }
      for (const r of f.ropes) drawRope(ctx, r.pts, 1 - r.age / r.life, 0);
      // soft shadows of balloons on the sky are not physical; use a subtle drop glow instead
      for (const b of f.balloons) drawBalloon(ctx, b);
      for (const s of f.shreds) {
        const a = 1 - s.age / s.life;
        if (s.ring) {
          ctx.strokeStyle = `rgba(255,255,255,${a * 0.9})`;
          ctx.lineWidth = 8 * a;
          ctx.beginPath(); ctx.arc(s.x, s.y, 40 + (1 - a) * 140, 0, TAU); ctx.stroke();
          continue;
        }
        ctx.save();
        ctx.globalAlpha = Math.min(1, a * 2);
        ctx.translate(s.x, s.y); ctx.rotate(s.rot);
        ctx.scale(1, Math.abs(Math.cos(s.rot * 1.7)) * 0.8 + 0.2);
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.moveTo(-s.w / 2, -s.h / 2); ctx.lineTo(s.w / 2, -s.h * 0.3); ctx.lineTo(s.w * 0.3, s.h / 2); ctx.lineTo(-s.w * 0.4, s.h * 0.35);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(-s.w * 0.3, -s.h * 0.35, s.w * 0.3, s.h * 0.2);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      for (const p of f.popups) {
        const t = p.age / p.life;
        ctx.globalAlpha = t > 0.6 ? (1 - t) / 0.4 : 1;
        const k = t < 0.12 ? 0.6 + t / 0.12 * 0.5 : 1.1;
        txt(ctx, p.text, p.x, p.y - t * 120, 80 * k, p.color, { weight: 900, stroke: 'rgba(0,0,0,0.5)' });
        if (p.sub) txt(ctx, p.sub, p.x, p.y - t * 120 + 70, 44, '#fff3b0', { weight: 800, stroke: 'rgba(0,0,0,0.5)' });
      }
      ctx.globalAlpha = 1;
      drawHUD(ctx, f);
      ctx.restore();
    }
    if (fields.length === 2) {
      const x = W / 2;
      const g = ctx.createLinearGradient(x - 6, 0, x + 6, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 6, 0, 12, H);
    }
  }

  // ---------------------------------------------------------------------------
  // Start menu (local option-group overlay)
  // ---------------------------------------------------------------------------

  let menuEl = null;
  function hideMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }

  function showMenu() {
    state = 'menu';
    IFPD.overlay.hide();
    hideMenu();
    fields = [];
    const o = document.createElement('div');
    o.className = 'ifpd-overlay';
    o.innerHTML = `<div class="ifpd-card">
      <h2>Balloon Pop Maths</h2>
      <p>Pop the balloon with the right answer! Wrong pops cost 3 points.\n90 seconds — answer in a row for a streak bonus.</p>
      <div class="mm-group"><h3>Level</h3><div class="mm-opts" data-g="level"></div></div>
      <div class="mm-group"><h3>Players</h3><div class="mm-opts" data-g="teams"></div></div>
      <div class="mm-best"></div>
      <div class="ifpd-buttons"><button class="ifpd-btn good mm-start">▶ Start</button></div></div>`;
    const sel = { level, teams };
    const bestLine = o.querySelector('.mm-best');
    const refresh = () => {
      o.querySelectorAll('.mm-opt').forEach(b => b.classList.toggle('on', String(sel[b.dataset.g]) === b.dataset.v));
      const best = IFPD.best.get('balloon-math-' + sel.level);
      bestLine.textContent = sel.teams ? 'Two teams play side by side — left vs right.' : `Best score (${LEVELS[sel.level].label}): ${best ?? '—'}`;
    };
    const addOpt = (g, v, label) => {
      const b = document.createElement('button');
      b.className = 'ifpd-btn mm-opt';
      b.dataset.g = g; b.dataset.v = String(v);
      b.textContent = label;
      b.addEventListener('click', () => { sel[g] = v; IFPD.sfx.play('click'); refresh(); });
      o.querySelector(`[data-g=${g}]`).append(b);
    };
    for (const k of Object.keys(LEVELS)) addOpt('level', k, LEVELS[k].label);
    addOpt('teams', false, '1 Player');
    addOpt('teams', true, '2 Teams');
    o.querySelector('.mm-start').addEventListener('click', () => { IFPD.sfx.play('pop'); start(sel.level, sel.teams); });
    refresh();
    (IFPD.stage || document.body).append(o);
    menuEl = o;
  }

  // ---------------------------------------------------------------------------

  view = IFPD.fitCanvas(canvas, (w, h) => { W = w; H = h; layout(); });
  W = view.width; H = view.height;
  layout();
  const loop = IFPD.loop(update, render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loop.resume(); });

  window.__game = {
    get state() { return state; }, get fields() { return fields; }, get level() { return level; }, get teams() { return teams; },
    get timeLeft() { return timeLeft; }, set timeLeft(v) { timeLeft = v; }, get U() { return U; },
    start, restart, showMenu, makeQuestion, distractorsFor,
  };

  showMenu();
})();
