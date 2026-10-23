/* Whack-a-Mole — 1 player or 2 players side by side, for large multi-touch panels. */
(function () {
  'use strict';

  const U = IFPD.util;
  const ROUND = 60;
  const FONT = '"Segoe UI", Roboto, system-ui, sans-serif';
  const PCOL = ['#3d8bfd', '#ff8a3d'];
  const POINTS = { normal: 10, golden: 50, hedgehog: -20 };

  const S = {
    phase: 'menu',          // menu | countdown | play | over
    players: 1, started: false,
    timeLeft: ROUND, count: 0, lastTick: 0,
    fields: [],
    particles: [], popups: [], swings: [],
    time: 0, cols: 3, rows: 3,
  };

  // ---- page ----
  const { extra } = IFPD.setupPage({ title: 'Whack-a-Mole', onRestart: restart });
  const modeBtn = document.createElement('button');
  modeBtn.className = 'ifpd-btn';
  modeBtn.textContent = 'Modes';
  modeBtn.addEventListener('click', showMenu);
  extra.append(modeBtn);

  const canvas = document.getElementById('game');
  const L = { w: 1, h: 1, hud: 80 };
  let bgCanvas = null;
  const view = IFPD.fitCanvas(canvas, (w, h) => { L.w = w; L.h = h; layout(); bgCanvas = null; });

  // seeded RNG so both players in 2-player mode get the same mole sequence
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function mkField(idx, seed) {
    const holes = [];
    for (let r = 0; r < S.rows; r++) for (let c = 0; c < S.cols; c++) holes.push({ r, c, cx: 0, cy: 0, rx: 10, ry: 4, mr: 8, state: 'idle', type: 'normal', t: 0, dur: 1, h: 0, peek: false, cool: 0, blink: 1 + Math.random() * 3, look: 0 });
    return { idx, rect: { x: 0, y: 0, w: 1, h: 1 }, holes, score: 0, combo: 0, bestCombo: 0, hits: 0, rand: rng(seed), spawnT: 0.6 };
  }

  function chooseGrid(players) {
    const w = L.w / players, h = L.h - L.hud;
    S.rows = 3;
    S.cols = U.clamp(Math.round((w / h) * 3 * 0.62), 3, 5);
  }

  function layout() {
    L.hud = U.clamp(L.h * 0.1, 56, 110);
    const n = S.fields.length || 1;
    S.fields.forEach((f, i) => {
      const fw = L.w / n;
      f.rect = { x: i * fw, y: L.hud, w: fw, h: L.h - L.hud };
      const cw = f.rect.w / S.cols, ch = f.rect.h / S.rows;
      for (const ho of f.holes) {
        const persp = 0.86 + 0.07 * ho.r;   // rows further away look smaller
        ho.rx = Math.min(cw * 0.34, ch * 0.42) * persp;
        ho.ry = ho.rx * 0.36;
        ho.mr = ho.rx * 0.7;
        ho.cx = f.rect.x + cw * (ho.c + 0.5) + (ho.r % 2 ? cw * 0.06 : -cw * 0.06) * (S.cols > 3 ? 1 : 0);
        ho.cy = f.rect.y + ch * (ho.r + 0.5) + ch * 0.15;
      }
    });
  }

  // ---- input ----
  IFPD.pointers(canvas, {
    down(p) {
      if (S.phase === 'menu' || S.phase === 'over') return false;
      const f = S.fields.find(f => p.x >= f.rect.x && p.x < f.rect.x + f.rect.w);
      S.swings.push({ x: p.x, y: p.y, t: 0, flip: f && f.idx === 1 ? -1 : 1, hit: false });
      if (!f || S.phase !== 'play') { IFPD.sfx.play('whoosh', { volume: 0.3, pitch: 1.6 }); return false; }
      let best = null, bd = Infinity;
      for (const ho of f.holes) {
        if (ho.h < 0.08 || ho.state === 'idle' || ho.state === 'hit' || ho.state === 'gone') continue;
        const { x: mx, y: my } = moleCenter(ho);
        // visible part only: above the front rim of the hole
        if (p.y > ho.cy + ho.ry * 0.45) continue;
        const dx = (p.x - mx) / (ho.mr * 1.18), dy = (p.y - my) / (ho.mr * 1.35);
        const d = dx * dx + dy * dy;
        if (d <= 1 && d < bd) { bd = d; best = ho; }
      }
      const panX = U.clamp(p.x / L.w * 2 - 1, -1, 1) * 0.8;
      if (best) { whack(f, best, p.x, p.y, panX); S.swings[S.swings.length - 1].hit = true; }
      else IFPD.sfx.play('thud', { volume: 0.35, pitch: 1.6, pan: panX });
      return false;
    },
  });

  function moleCenter(ho) {
    const e = 1 - (1 - ho.h) * (1 - ho.h);
    return { x: ho.cx, y: ho.cy + ho.mr * 0.9 - e * ho.mr * 2.05 };
  }

  function whack(f, ho, x, y, pan) {
    ho.state = 'hit';
    ho.t = 0.85;
    const base = POINTS[ho.type];
    let bonus = 0;
    if (ho.type === 'hedgehog') {
      f.combo = 0;
      IFPD.sfx.play('wrong', { volume: 0.8, pan });
      IFPD.sfx.play('squish', { volume: 0.6, pitch: 1.4, pan });
      popup(x, y - 30, '−20 Ouch!', '#ff5a4d', 1.15);
    } else {
      f.combo++;
      f.hits++;
      f.bestCombo = Math.max(f.bestCombo, f.combo);
      if (f.combo >= 3) bonus = Math.min(f.combo - 2, 5) * 2;
      IFPD.sfx.play('whack', { volume: 1, pitch: U.rand(0.9, 1.1), pan });
      IFPD.sfx.play('squish', { volume: 0.4, pitch: U.rand(1.1, 1.3), pan });
      if (ho.type === 'golden') {
        IFPD.sfx.play('ding', { volume: 0.7, pan });
        popup(x, y - 30, '+50', '#ffd23f', 1.5);
        for (let i = 0; i < 22; i++) particle(x, y, '#ffe680', 'spark');
      } else popup(x, y - 30, bonus ? `+${10 + bonus}` : '+10', bonus ? '#7dff9a' : '#ffffff', 1.1);
      if (f.combo === 3 || f.combo % 5 === 0) {
        popup(x, y + 45, `Combo ×${f.combo}!`, '#7dff9a', 0.85);
        IFPD.sfx.play('correct', { volume: 0.45, pan });
      }
    }
    f.score = Math.max(0, f.score + base + bonus);
    for (let i = 0; i < 16; i++) particle(ho.cx + U.rand(-ho.rx, ho.rx) * 0.8, ho.cy, Math.random() < 0.5 ? '#6b4423' : '#8a5a32', 'dirt');
    for (let i = 0; i < 6; i++) particle(ho.cx + U.rand(-ho.rx, ho.rx), ho.cy, '#4f9a3a', 'grass');
  }

  function particle(x, y, color, kind) {
    S.particles.push({ x, y, vx: U.rand(-260, 260), vy: U.rand(-520, -160), life: kind === 'spark' ? 0.8 : 0.7, max: 0.8, color, kind, r: kind === 'spark' ? U.rand(3, 6) : U.rand(3, 8), a: U.rand(0, 6) });
  }
  function popup(x, y, text, color, scale) {
    const f = S.fields.find(f => x >= f.rect.x && x < f.rect.x + f.rect.w) || { rect: { x: 0, w: L.w } };
    S.popups.push({ x, y, text, color, scale, t: 0, fx: f.rect.x, fw: f.rect.w });
  }

  // ---- flow ----
  function showMenu() {
    S.phase = 'menu';
    const b1 = IFPD.best.get('whack-1p'), b2 = IFPD.best.get('whack-2p');
    IFPD.overlay.show({
      title: 'Whack-a-Mole',
      text: 'Hit the moles as they pop up! 60 seconds.\nMole +10 · Golden mole +50 · Don\'t hit the hedgehog −20\nHit in a row for combo bonus.' +
        (b1 != null || b2 != null ? `\nBest: 1 player ${b1 ?? '—'} · 2 players ${b2 ?? '—'}` : ''),
      buttons: [
        { label: '1 Player', kind: 'good', onClick: () => startRound(1) },
        { label: '2 Players (left vs right)', kind: 'primary', onClick: () => startRound(2) },
      ],
    });
  }
  function restart() { if (!S.started) showMenu(); else startRound(S.players); }

  function startRound(players) {
    IFPD.overlay.hide();
    S.started = true;
    S.players = players;
    chooseGrid(players);
    const seed = (Math.random() * 1e9) | 0;
    S.fields = [];
    for (let i = 0; i < players; i++) S.fields.push(mkField(i, seed));
    S.particles.length = 0; S.popups.length = 0; S.swings.length = 0;
    S.timeLeft = ROUND;
    S.count = 3.0;
    S.lastTick = 4;
    S.phase = 'countdown';
    layout();
    bgCanvas = null;
  }

  function endRound() {
    S.phase = 'over';
    for (const f of S.fields) for (const ho of f.holes) if (ho.state !== 'idle' && ho.state !== 'hit') ho.state = 'sink';
    IFPD.sfx.play('buzzer', { volume: 0.6 });
    let title, text;
    if (S.players === 1) {
      const f = S.fields[0];
      const rec = IFPD.best.submit('whack-1p', f.score);
      title = rec ? 'New record!' : 'Time\'s up!';
      text = `Score ${f.score}\nMoles hit ${f.hits} · Best combo ${f.bestCombo}\nBest score ${IFPD.best.get('whack-1p')}`;
      if (rec) { IFPD.confetti(3000); IFPD.sfx.play('win'); }
    } else {
      const [a, b] = S.fields;
      const rec = IFPD.best.submit('whack-2p', Math.max(a.score, b.score));
      title = a.score === b.score ? 'It\'s a draw!' : (a.score > b.score ? 'Player 1 wins!' : 'Player 2 wins!');
      text = `Player 1: ${a.score}   ·   Player 2: ${b.score}\nBest combos ${a.bestCombo} / ${b.bestCombo}\n` + (rec ? 'New 2-player record!' : `2-player best ${IFPD.best.get('whack-2p')}`);
      IFPD.confetti(3000);
      IFPD.sfx.play('win');
    }
    setTimeout(() => {
      if (S.phase !== 'over') return;
      IFPD.overlay.show({
        title, text,
        buttons: [
          { label: 'Play again', kind: 'good', onClick: () => startRound(S.players) },
          { label: 'Change mode', kind: 'primary', onClick: showMenu },
        ],
      });
    }, 900);
  }

  // ---- update ----
  function update(dt) {
    S.time += dt;
    updateFx(dt);
    if (S.phase === 'countdown') {
      S.count -= dt;
      const c = Math.ceil(S.count);
      if (c < S.lastTick && c > 0) { S.lastTick = c; IFPD.sfx.play('tick', { volume: 3, pitch: 0.5 }); }
      if (S.count <= 0) { S.phase = 'play'; IFPD.sfx.play('ding', { volume: 0.6 }); S.lastTick = 11; }
      return;
    }
    for (const f of S.fields) updateHoles(f, dt);
    if (S.phase !== 'play') return;
    S.timeLeft -= dt;
    const sec = Math.ceil(S.timeLeft);
    if (sec <= 10 && sec < S.lastTick && sec > 0) { S.lastTick = sec; IFPD.sfx.play('tick', { volume: 4, pitch: sec <= 3 ? 0.7 : 0.5 }); }
    if (S.timeLeft <= 0) { S.timeLeft = 0; endRound(); return; }
    const prog = 1 - S.timeLeft / ROUND;
    for (const f of S.fields) {
      f.spawnT -= dt;
      const active = f.holes.filter(h => h.state !== 'idle').length;
      const maxActive = 2 + Math.floor(prog * 3.2) + (S.cols > 3 ? 1 : 0);
      if (f.spawnT <= 0) {
        f.spawnT = U.lerp(0.95, 0.36, prog) * (0.7 + f.rand() * 0.6);
        if (active < maxActive) spawn(f, prog);
      }
    }
  }

  function spawn(f, prog) {
    const r = f.rand();
    let i = Math.floor(f.rand() * f.holes.length);
    for (let k = 0; k < f.holes.length; k++) {
      const ho = f.holes[(i + k) % f.holes.length];
      if (ho.state !== 'idle' || ho.cool > 0) continue;
      ho.type = r < 0.06 ? 'golden' : r < 0.2 ? 'hedgehog' : 'normal';
      ho.state = 'rise';
      ho.h = 0;
      ho.peek = f.rand() < 0.3;
      ho.dur = U.lerp(1.35, 0.72, prog) * (ho.type === 'golden' ? 0.55 : ho.type === 'hedgehog' ? 1.25 : 1) * (0.85 + f.rand() * 0.3);
      ho.look = 0; ho.blink = 0.5 + f.rand() * 2;
      IFPD.sfx.play('flip', { volume: 0.25, pitch: 0.7, pan: U.clamp(ho.cx / L.w * 2 - 1, -1, 1) * 0.8 });
      return;
    }
  }

  function updateHoles(f, dt) {
    for (const ho of f.holes) {
      ho.blink -= dt;
      if (ho.blink < -0.12) ho.blink = 1.5 + Math.random() * 2.5;
      switch (ho.state) {
        case 'idle': if (ho.cool > 0) ho.cool -= dt; break;
        case 'rise':
          ho.h = Math.min(1, ho.h + dt / (ho.type === 'golden' ? 0.11 : 0.17));
          if (ho.peek && ho.h >= 0.42) { ho.h = 0.42; ho.state = 'peekHold'; ho.t = 0.35; }
          else if (ho.h >= 1) { ho.state = 'up'; ho.t = ho.dur; }
          break;
        case 'peekHold':
          ho.t -= dt; ho.look = Math.sin(ho.t * 18) * 0.6;
          if (ho.t <= 0) { ho.peek = false; ho.state = 'rise'; ho.look = 0; }
          break;
        case 'up':
          ho.t -= dt;
          ho.look = Math.sin((ho.dur - ho.t) * 3) * 0.5;
          if (ho.t <= 0) ho.state = 'sink';
          break;
        case 'sink':
          ho.h = Math.max(0, ho.h - dt / 0.18);
          if (ho.h <= 0) {
            ho.state = 'idle'; ho.cool = 0.3;
            if (ho.type !== 'hedgehog' && S.phase === 'play' && f.combo >= 3) popupCenter(f, 'Combo lost', '#ffb3a8');
            if (ho.type !== 'hedgehog') f.combo = 0;
          }
          break;
        case 'hit':
          ho.t -= dt;
          if (ho.t <= 0) ho.state = 'gone';
          break;
        case 'gone':
          ho.h = Math.max(0, ho.h - dt / 0.22);
          if (ho.h <= 0) { ho.state = 'idle'; ho.cool = 0.35; }
          break;
      }
    }
  }
  function popupCenter(f, text, color) { popup(f.rect.x + f.rect.w / 2, f.rect.y + f.rect.h * 0.08 + 30, text, color, 0.8); }

  function updateFx(dt) {
    for (const p of S.particles) {
      p.life -= dt; p.vy += 1500 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.a += dt * 8;
      if (p.kind === 'spark') { p.vy -= 1300 * dt; p.vx *= 0.97; p.vy *= 0.97; }
    }
    S.particles = S.particles.filter(p => p.life > 0);
    for (const p of S.popups) p.t += dt;
    S.popups = S.popups.filter(p => p.t < 1.1);
    for (const s of S.swings) s.t += dt;
    S.swings = S.swings.filter(s => s.t < 0.42);
  }

  // ---- rendering: static field (grass + holes) ----
  function buildBg() {
    const { width: w, height: h, dpr } = view;
    const c = document.createElement('canvas');
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const R = rng(1234);
    // grass base with lighting toward the back (top)
    const gg = g.createLinearGradient(0, 0, 0, h);
    gg.addColorStop(0, '#5fae45'); gg.addColorStop(0.5, '#4a9a36'); gg.addColorStop(1, '#357a27');
    g.fillStyle = gg; g.fillRect(0, 0, w, h);
    // mottled patches
    for (let i = 0; i < (w * h) / 9000; i++) {
      const x = R() * w, y = R() * h, r = 30 + R() * 90;
      const pg = g.createRadialGradient(x, y, 0, x, y, r);
      const light = R() < 0.5;
      pg.addColorStop(0, light ? 'rgba(170,220,90,0.16)' : 'rgba(20,60,15,0.16)');
      pg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = pg; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
    }
    // grass blades
    const tones = ['#2f6e22', '#3d8a2c', '#56a83c', '#6fc04d', '#83cf5c', '#2a5f1e'];
    g.lineCap = 'round';
    const n = Math.min(60000, (w * h) / 45);
    for (let i = 0; i < n; i++) {
      const x = R() * w, y = R() * h;
      const len = 6 + R() * 12 * (0.6 + y / h * 0.6);
      const lean = (R() - 0.5) * 6;
      g.strokeStyle = tones[(R() * tones.length) | 0];
      g.globalAlpha = 0.55 + R() * 0.45;
      g.lineWidth = 1 + R() * 1.6;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + lean * 0.3, y - len * 0.6, x + lean, y - len); g.stroke();
    }
    g.globalAlpha = 1;
    // a few tiny flowers / clover
    for (let i = 0; i < (w * h) / 40000; i++) {
      const x = R() * w, y = R() * h;
      g.fillStyle = R() < 0.6 ? 'rgba(255,255,255,0.85)' : 'rgba(255,230,90,0.9)';
      for (let k = 0; k < 5; k++) { const a = k * 1.256; g.beginPath(); g.arc(x + Math.cos(a) * 3, y + Math.sin(a) * 3, 2.4, 0, 6.283); g.fill(); }
      g.fillStyle = '#e8b830'; g.beginPath(); g.arc(x, y, 1.8, 0, 6.283); g.fill();
    }
    // field divider for two players: a little wooden fence
    if (S.fields.length === 2) {
      const x = w / 2;
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x - 2, L.hud, 14, h - L.hud);
      const wood = IFPD.texture.wood(16, h, { base: '#9a6a3c', dark: '#5e3a1e', vertical: true, planks: 1 });
      g.drawImage(wood, x - 8, L.hud, 16, h - L.hud);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x - 8, L.hud, 3, h - L.hud);
    }
    // holes (mound + pit)
    for (const f of S.fields) for (const ho of f.holes) drawHoleBack(g, ho);
    // vignette
    const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
    bgCanvas = c;
  }

  let dirtPat = null;
  function dirtPattern(g) {
    if (dirtPat) return dirtPat;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const d = c.getContext('2d');
    d.fillStyle = '#7a4f2c'; d.fillRect(0, 0, 64, 64);
    const R = rng(77);
    for (let i = 0; i < 260; i++) {
      d.fillStyle = ['#5a3820', '#946240', '#6b4425', '#a7754d', '#4a2e18'][(R() * 5) | 0];
      d.globalAlpha = 0.6;
      d.beginPath(); d.arc(R() * 64, R() * 64, 0.8 + R() * 2.2, 0, 6.283); d.fill();
    }
    dirtPat = g.createPattern(c, 'repeat');
    return dirtPat;
  }

  function drawHoleBack(g, ho) {
    const { cx, cy, rx, ry } = ho;
    // mound shadow
    IFPD.draw.shadow(g, cx + rx * 0.08, cy + ry * 0.7, rx * 1.45, ry * 2.1, 0.35);
    // dirt mound
    g.fillStyle = dirtPattern(g);
    g.beginPath(); g.ellipse(cx, cy + ry * 0.15, rx * 1.3, ry * 1.85, 0, 0, Math.PI * 2); g.fill();
    const mg = g.createRadialGradient(cx - rx * 0.3, cy - ry * 1.2, rx * 0.2, cx, cy, rx * 1.35);
    mg.addColorStop(0, 'rgba(255,220,170,0.25)'); mg.addColorStop(0.6, 'rgba(0,0,0,0)'); mg.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = mg;
    g.beginPath(); g.ellipse(cx, cy + ry * 0.15, rx * 1.3, ry * 1.85, 0, 0, Math.PI * 2); g.fill();
    // pit
    const pg = g.createRadialGradient(cx, cy + ry * 0.35, ry * 0.2, cx, cy, rx);
    pg.addColorStop(0, '#050302'); pg.addColorStop(0.7, '#1c120a'); pg.addColorStop(1, '#3a2614');
    g.fillStyle = pg;
    g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
    // inner back wall lit slightly
    g.strokeStyle = 'rgba(160,110,70,0.5)'; g.lineWidth = Math.max(1.5, ry * 0.12);
    g.beginPath(); g.ellipse(cx, cy + ry * 0.05, rx * 0.96, ry * 0.9, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
  }

  function drawHoleFront(g, ho) {
    const { cx, cy, rx, ry } = ho;
    // the near lip of the hole, drawn over the bottom of the mole
    g.fillStyle = dirtPattern(g);
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI, false);
    g.ellipse(cx, cy + ry * 0.15, rx * 1.3, ry * 1.85, 0, Math.PI, 0, true);
    g.closePath();
    g.fill();
    const lg = g.createLinearGradient(0, cy, 0, cy + ry * 2);
    lg.addColorStop(0, 'rgba(255,215,160,0.28)'); lg.addColorStop(1, 'rgba(0,0,0,0.3)');
    g.fillStyle = lg; g.fill();
    // loose clumps on the rim
    g.fillStyle = 'rgba(70,42,20,0.9)';
    for (let k = 0; k < 6; k++) {
      const a = Math.PI * (0.12 + k * 0.15);
      g.beginPath(); g.arc(cx + Math.cos(a) * rx * 1.08, cy + Math.sin(a) * ry * 1.25, ry * 0.18, 0, 6.283); g.fill();
    }
  }

  // ---- mole sprites (cached per type and size) ----
  const spriteCache = new Map();
  function sprite(type, mr) {
    const key = type + ':' + Math.round(mr) + ':' + view.dpr;
    if (spriteCache.has(key)) return spriteCache.get(key);
    const W = mr * 2.8, H = mr * 3.6, dpr = view.dpr;
    const c = document.createElement('canvas');
    c.width = Math.ceil(W * dpr); c.height = Math.ceil(H * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.translate(W / 2, mr * 1.25); // origin = head centre
    const R = rng(type.length * 99 + Math.round(mr));
    const pal = type === 'golden'
      ? { light: '#ffe58a', mid: '#e3a92b', dark: '#8c5a0a', fur: '#fff1b0', belly: '#fff3c4' }
      : type === 'hedgehog'
        ? { light: '#d9c2a0', mid: '#a88760', dark: '#5f4630', fur: '#efe0c8', belly: '#f3e6cf' }
        : { light: '#9a6a48', mid: '#6b452b', dark: '#2e1c10', fur: '#b98a62', belly: '#d9b48f' };

    const body = () => {
      g.beginPath();
      g.moveTo(-mr, 0);
      g.bezierCurveTo(-mr, -mr * 1.35, mr, -mr * 1.35, mr, 0);
      g.lineTo(mr * 1.08, mr * 2.3);
      g.lineTo(-mr * 1.08, mr * 2.3);
      g.closePath();
    };
    if (type === 'hedgehog') {
      // spines around the back and head
      for (let i = 0; i < 70; i++) {
        const a = Math.PI * (1.0 + R() * 1.0) + (R() - 0.5) * 0.3;
        const r0 = mr * (0.7 + R() * 0.25), len = mr * (0.45 + R() * 0.35);
        const x0 = Math.cos(a) * r0, y0 = Math.sin(a) * r0 * 1.05 + mr * 0.15;
        const x1 = Math.cos(a) * (r0 + len), y1 = Math.sin(a) * (r0 + len) * 1.05 + mr * 0.15;
        const nx = -Math.sin(a) * mr * 0.07, ny = Math.cos(a) * mr * 0.07;
        g.fillStyle = R() < 0.5 ? '#3a2a1c' : '#5b4630';
        g.beginPath(); g.moveTo(x0 + nx, y0 + ny); g.lineTo(x1, y1); g.lineTo(x0 - nx, y0 - ny); g.fill();
        g.strokeStyle = 'rgba(240,230,210,0.6)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo((x0 + x1) / 2 + (x1 - x0) * 0.25, (y0 + y1) / 2 + (y1 - y0) * 0.25); g.lineTo(x1, y1); g.stroke();
      }
      for (const sx of [-1, 1]) for (let i = 0; i < 16; i++) {
        const y0 = mr * (0.1 + i * 0.13), x0 = sx * mr * 0.95;
        g.fillStyle = i % 2 ? '#3a2a1c' : '#5b4630';
        g.beginPath(); g.moveTo(x0, y0 - mr * 0.08); g.lineTo(x0 + sx * mr * 0.4, y0 - mr * 0.15); g.lineTo(x0, y0 + mr * 0.08); g.fill();
      }
    }
    // body fill
    body();
    const bg = g.createRadialGradient(-mr * 0.35, -mr * 0.55, mr * 0.15, 0, mr * 0.3, mr * 2.2);
    bg.addColorStop(0, pal.light); bg.addColorStop(0.45, pal.mid); bg.addColorStop(1, pal.dark);
    g.fillStyle = bg; g.fill();
    // fur strokes
    g.save(); body(); g.clip();
    g.lineCap = 'round';
    for (let i = 0; i < 420; i++) {
      const x = (R() * 2 - 1) * mr * 1.1, y = -mr * 1.05 + R() * mr * 3.3;
      const len = mr * (0.06 + R() * 0.1), a = Math.atan2(y + mr * 0.3, x) * 0.25 + Math.PI / 2 + (R() - 0.5) * 0.6;
      g.strokeStyle = R() < 0.5 ? pal.fur : pal.dark;
      g.globalAlpha = 0.18 + R() * 0.25;
      g.lineWidth = 1 + R() * 1.2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
    }
    g.globalAlpha = 1;
    // rim light on the left and core shadow on the right
    const rl = g.createLinearGradient(-mr * 1.1, 0, mr * 1.1, 0);
    rl.addColorStop(0, 'rgba(255,255,255,0.18)'); rl.addColorStop(0.3, 'rgba(255,255,255,0)'); rl.addColorStop(0.75, 'rgba(0,0,0,0)'); rl.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = rl; g.fillRect(-mr * 1.2, -mr * 1.2, mr * 2.4, mr * 3.6);
    g.restore();
    // belly / face patch
    const fg = g.createRadialGradient(0, mr * 0.45, mr * 0.1, 0, mr * 0.6, mr * 0.95);
    fg.addColorStop(0, pal.belly); fg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fg;
    g.beginPath(); g.ellipse(0, mr * 0.65, mr * 0.75, mr * 1.0, 0, 0, Math.PI * 2); g.fill();
    // ears
    if (type !== 'hedgehog') for (const sx of [-1, 1]) {
      g.fillStyle = pal.dark;
      g.beginPath(); g.ellipse(sx * mr * 0.72, -mr * 0.72, mr * 0.2, mr * 0.16, sx * 0.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#d98b8b';
      g.beginPath(); g.ellipse(sx * mr * 0.72, -mr * 0.71, mr * 0.11, mr * 0.08, sx * 0.5, 0, Math.PI * 2); g.fill();
    }
    // snout
    const sg = g.createRadialGradient(-mr * 0.1, mr * 0.12, mr * 0.05, 0, mr * 0.25, mr * 0.45);
    sg.addColorStop(0, type === 'hedgehog' ? '#fff5e6' : '#f1c7a8'); sg.addColorStop(1, type === 'hedgehog' ? '#d8c0a0' : '#b98563');
    g.fillStyle = sg;
    g.beginPath(); g.ellipse(0, mr * 0.28, mr * 0.42, mr * 0.3, 0, 0, Math.PI * 2); g.fill();
    // nose
    IFPD.draw.ball(g, 0, mr * 0.12, mr * 0.15, type === 'hedgehog' ? '#1b1b1f' : '#e86a8a', 0.6);
    // mouth + teeth
    g.strokeStyle = 'rgba(60,30,20,0.8)'; g.lineWidth = Math.max(1.5, mr * 0.04);
    g.beginPath(); g.moveTo(0, mr * 0.27); g.lineTo(0, mr * 0.36); g.stroke();
    g.beginPath(); g.arc(-mr * 0.1, mr * 0.36, mr * 0.1, 0.1, Math.PI - 0.2); g.stroke();
    g.beginPath(); g.arc(mr * 0.1, mr * 0.36, mr * 0.1, 0.2, Math.PI - 0.1); g.stroke();
    if (type !== 'hedgehog') {
      g.fillStyle = '#fffdf5'; g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1;
      g.fillRect(-mr * 0.09, mr * 0.4, mr * 0.085, mr * 0.13); g.strokeRect(-mr * 0.09, mr * 0.4, mr * 0.085, mr * 0.13);
      g.fillRect(mr * 0.005, mr * 0.4, mr * 0.085, mr * 0.13); g.strokeRect(mr * 0.005, mr * 0.4, mr * 0.085, mr * 0.13);
    }
    // whiskers
    g.strokeStyle = 'rgba(30,20,10,0.55)'; g.lineWidth = 1.2;
    for (const sx of [-1, 1]) for (let k = -1; k <= 1; k++) {
      g.beginPath(); g.moveTo(sx * mr * 0.3, mr * 0.25 + k * mr * 0.05);
      g.quadraticCurveTo(sx * mr * 0.6, mr * 0.18 + k * mr * 0.1, sx * mr * 0.85, mr * 0.15 + k * mr * 0.16); g.stroke();
    }
    // cheeks
    g.fillStyle = 'rgba(255,120,120,0.25)';
    for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(sx * mr * 0.5, mr * 0.3, mr * 0.14, mr * 0.09, 0, 0, 6.283); g.fill(); }
    if (type === 'golden') {
      // shine streak
      g.save(); body(); g.clip();
      const sh = g.createLinearGradient(-mr, -mr, mr, mr);
      sh.addColorStop(0.3, 'rgba(255,255,255,0)'); sh.addColorStop(0.42, 'rgba(255,255,255,0.45)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)');
      g.fillStyle = sh; g.fillRect(-mr * 1.2, -mr * 1.2, mr * 2.4, mr * 3.6);
      g.restore();
    }
    const out = { c, W, H, ox: W / 2, oy: mr * 1.25 };
    spriteCache.set(key, out);
    if (spriteCache.size > 60) spriteCache.delete(spriteCache.keys().next().value);
    return out;
  }

  function drawMole(g, ho) {
    if (ho.state === 'idle' || ho.h <= 0) return;
    const { cx, cy, rx, ry, mr } = ho;
    const { x, y } = moleCenter(ho);
    const sp = sprite(ho.type, mr);
    const hit = ho.state === 'hit' || ho.state === 'gone';
    g.save();
    // clip: everything above the pit's centre line + the pit itself
    g.beginPath();
    g.rect(cx - rx * 2, cy - mr * 4, rx * 4, mr * 4);
    g.ellipse(cx, cy, rx * 0.99, ry * 0.99, 0, 0, Math.PI * 2);
    g.clip();
    // squash when hit
    const sq = hit ? 1 - 0.12 * Math.max(0, Math.min(1, (ho.t - 0.6) / 0.25)) : 1;
    g.translate(x, y + mr * 2.3);
    g.scale(1 + (1 - sq) * 0.8, sq);
    g.translate(-x, -(y + mr * 2.3));
    g.drawImage(sp.c, x - sp.ox, y - sp.oy, sp.W, sp.H);
    // eyes
    const ex = mr * 0.33, ey = -mr * 0.12, er = mr * 0.14;
    const lk = ho.look * mr * 0.05;
    for (const sx of [-1, 1]) {
      const px = x + sx * ex, py = y + ey;
      if (hit && ho.type !== 'hedgehog') {
        // dizzy spiral eyes
        g.strokeStyle = '#1a1a1a'; g.lineWidth = Math.max(1.5, er * 0.28);
        g.beginPath();
        for (let a = 0; a < Math.PI * 4; a += 0.3) {
          const rr = er * 1.1 * a / (Math.PI * 4);
          const aa = a + S.time * 10 * sx;
          const qx = px + Math.cos(aa) * rr, qy = py + Math.sin(aa) * rr;
          if (a === 0) g.moveTo(qx, qy); else g.lineTo(qx, qy);
        }
        g.stroke();
      } else if (hit) {
        // hedgehog: angry X eyes
        g.strokeStyle = '#1a1a1a'; g.lineWidth = Math.max(2, er * 0.35);
        g.beginPath(); g.moveTo(px - er, py - er); g.lineTo(px + er, py + er); g.moveTo(px + er, py - er); g.lineTo(px - er, py + er); g.stroke();
      } else if (ho.blink < 0) {
        g.strokeStyle = '#1a1a1a'; g.lineWidth = Math.max(1.5, er * 0.3);
        g.beginPath(); g.arc(px, py, er * 0.8, 0.2, Math.PI - 0.2); g.stroke();
      } else {
        g.fillStyle = '#fff';
        g.beginPath(); g.ellipse(px, py, er * 1.05, er * 1.25, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#111';
        g.beginPath(); g.ellipse(px + lk, py + er * 0.15, er * 0.72, er * 0.9, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(px + lk - er * 0.25, py - er * 0.2, er * 0.25, 0, Math.PI * 2); g.fill();
      }
    }
    if (ho.type === 'hedgehog' && !hit) {
      // eyebrows: looks a bit grumpy so kids learn to avoid it
      g.strokeStyle = '#3a2a1c'; g.lineWidth = Math.max(2, mr * 0.06);
      for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(x + sx * mr * 0.48, y - mr * 0.38); g.lineTo(x + sx * mr * 0.18, y - mr * 0.3); g.stroke(); }
    }
    g.restore();

    drawHoleFront(g, ho);
    // paws gripping the rim
    if (ho.h > 0.75 && ho.type !== 'hedgehog') {
      for (const sx of [-1, 1]) {
        const px = cx + sx * mr * 0.62, py = cy + ry * 0.1;
        IFPD.draw.ball(g, px, py, mr * 0.2, ho.type === 'golden' ? '#ffd27a' : '#e9a6a0', 0.4);
        g.strokeStyle = 'rgba(80,40,30,0.5)'; g.lineWidth = 1.2;
        for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(px + k * mr * 0.07, py + mr * 0.05); g.lineTo(px + k * mr * 0.08, py + mr * 0.17); g.stroke(); }
      }
    }
    // stars circling the stunned head
    if (hit && ho.type !== 'hedgehog') {
      for (let i = 0; i < 4; i++) {
        const a = S.time * 5 + i * Math.PI / 2;
        const sx = x + Math.cos(a) * mr * 0.95, sy = y - mr * 0.95 + Math.sin(a) * mr * 0.28;
        star(g, sx, sy, mr * 0.17, Math.sin(a) > 0 ? '#fff38a' : '#ffd23f');
      }
    }
    if (hit && ho.type === 'hedgehog') {
      g.fillStyle = 'rgba(255,60,40,0.85)';
      g.font = `900 ${Math.round(mr * 0.7)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('!!', x + mr * 0.9, y - mr * 0.9);
    }
    if (ho.type === 'golden' && !hit) {
      for (let i = 0; i < 3; i++) {
        const a = S.time * 2.5 + i * 2.1;
        star(g, x + Math.cos(a) * mr * 1.1, y - mr * 0.3 + Math.sin(a * 1.3) * mr * 0.6, mr * 0.09 * (1 + Math.sin(S.time * 9 + i)), '#fffbe0');
      }
    }
  }

  function star(g, x, y, r, col) {
    g.fillStyle = col;
    g.strokeStyle = 'rgba(120,80,0,0.6)'; g.lineWidth = 1.2;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
      if (i === 0) g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath(); g.fill(); g.stroke();
  }

  function drawMallet(g, s) {
    const size = U.clamp(L.h * 0.11, 60, 130);
    // swing: raised (angle -1.1) → strike at t=0.07 → hold → fade
    const k = Math.min(1, s.t / 0.07);
    const ang = (-1.1 + 1.1 * k * k) * s.flip;
    const alpha = s.t < 0.25 ? 1 : Math.max(0, 1 - (s.t - 0.25) / 0.17);
    g.save();
    g.globalAlpha = alpha;
    if (k >= 1 && s.t < 0.2) {
      // impact ring
      const rr = size * (0.4 + (s.t - 0.07) * 5);
      g.strokeStyle = `rgba(255,255,255,${0.7 * (1 - (s.t - 0.07) / 0.13)})`;
      g.lineWidth = 5;
      g.beginPath(); g.ellipse(s.x, s.y + size * 0.1, rr, rr * 0.45, 0, 0, Math.PI * 2); g.stroke();
    }
    // pivot = player's hand, below and to the side of the strike point
    const px = s.x + size * 1.6 * s.flip, py = s.y + size * 1.2;
    g.translate(px, py);
    g.rotate(ang);
    const dx = s.x - px, dy = s.y - py;
    const len = Math.hypot(dx, dy), a0 = Math.atan2(dy, dx);
    g.rotate(a0);
    // handle
    const hg = g.createLinearGradient(0, -size * 0.09, 0, size * 0.09);
    hg.addColorStop(0, '#e2b67c'); hg.addColorStop(0.5, '#b07a45'); hg.addColorStop(1, '#6e4626');
    g.fillStyle = hg;
    IFPD.draw.roundRect(g, -size * 0.15, -size * 0.085, len, size * 0.17, size * 0.08); g.fill();
    g.fillStyle = '#4a2c16';
    IFPD.draw.roundRect(g, -size * 0.2, -size * 0.11, size * 0.45, size * 0.22, size * 0.1); g.fill();
    // head (wooden barrel with red bands)
    const hw = size * 0.62, hh = size * 0.95;
    const wg = g.createLinearGradient(len - hw / 2, 0, len + hw / 2, 0);
    wg.addColorStop(0, '#6e4626'); wg.addColorStop(0.35, '#d9a066'); wg.addColorStop(0.7, '#a86c3a'); wg.addColorStop(1, '#5a361a');
    g.fillStyle = wg;
    IFPD.draw.roundRect(g, len - hw / 2, -hh / 2, hw, hh, size * 0.12); g.fill();
    g.fillStyle = '#c0392b';
    g.fillRect(len - hw / 2, -hh / 2 + hh * 0.12, hw, hh * 0.1);
    g.fillRect(len - hw / 2, hh / 2 - hh * 0.22, hw, hh * 0.1);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(len - hw * 0.2, -hh / 2 + 4, hw * 0.12, hh - 8);
    g.restore();
  }

  function drawHud(g) {
    const n = S.fields.length;
    if (!n) return;
    const hh = L.hud;
    const bg = g.createLinearGradient(0, 0, 0, hh);
    bg.addColorStop(0, '#2b2e38'); bg.addColorStop(1, '#17181e');
    g.fillStyle = bg; g.fillRect(0, 0, L.w, hh);
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, hh - 3, L.w, 3);
    const tl = Math.ceil(S.timeLeft);
    const urgent = S.phase === 'play' && tl <= 10;
    S.fields.forEach((f, i) => {
      const x0 = f.rect.x, w = f.rect.w, cy = hh / 2;
      g.textBaseline = 'middle';
      // name / score
      g.textAlign = 'left';
      g.font = `700 ${Math.round(hh * 0.3)}px ${FONT}`;
      g.fillStyle = n === 2 ? PCOL[i] : '#9aa0ad';
      g.fillText(n === 2 ? `PLAYER ${i + 1}` : 'SCORE', x0 + hh * 0.3, cy - hh * 0.22);
      g.font = `800 ${Math.round(hh * 0.62)}px ${FONT}`;
      g.fillStyle = '#ffffff';
      g.fillText(String(f.score), x0 + hh * 0.3, cy + hh * 0.17);
      // timer (centre of each field)
      g.textAlign = 'center';
      const pulse = urgent ? 1 + 0.08 * Math.sin(S.time * 12) : 1;
      g.font = `800 ${Math.round(hh * 0.62 * pulse)}px ${FONT}`;
      g.fillStyle = urgent ? '#ff5a4d' : '#ffe08a';
      g.fillText(`0:${String(Math.max(0, tl)).padStart(2, '0')}`, x0 + w / 2, cy);
      // combo / best
      g.textAlign = 'right';
      g.font = `700 ${Math.round(hh * 0.3)}px ${FONT}`;
      g.fillStyle = f.combo >= 3 ? '#7dff9a' : '#9aa0ad';
      g.fillText(`COMBO ×${f.combo}`, x0 + w - hh * 0.3, cy - hh * 0.2);
      const best = IFPD.best.get(n === 2 ? 'whack-2p' : 'whack-1p');
      g.fillStyle = '#9aa0ad';
      g.fillText(`BEST ${best ?? '—'}`, x0 + w - hh * 0.3, cy + hh * 0.2);
      if (i === 1) { g.fillStyle = '#000'; g.fillRect(x0 - 2, 0, 4, hh); }
    });
  }

  function render() {
    const g = view.ctx;
    if (!bgCanvas || bgCanvas.width !== Math.round(view.width * view.dpr) || bgCanvas.height !== Math.round(view.height * view.dpr)) {
      if (!S.fields.length) { S.players = 1; chooseGrid(1); S.fields = [mkField(0, 1)]; layout(); }
      buildBg();
    }
    g.drawImage(bgCanvas, 0, 0, view.width, view.height);
    for (const f of S.fields) {
      for (let r = 0; r < S.rows; r++) for (const ho of f.holes) if (ho.r === r) {
        if (ho.state === 'idle' || ho.h <= 0) continue;
        drawMole(g, ho);
      }
    }
    // particles
    for (const p of S.particles) {
      const a = Math.max(0, p.life / p.max);
      g.globalAlpha = a;
      if (p.kind === 'spark') star(g, p.x, p.y, p.r * 1.6, p.color);
      else if (p.kind === 'grass') { g.strokeStyle = p.color; g.lineWidth = 3; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + Math.cos(p.a) * 9, p.y + Math.sin(p.a) * 9); g.stroke(); }
      else { g.fillStyle = p.color; g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill(); }
    }
    g.globalAlpha = 1;
    for (const s of S.swings) drawMallet(g, s);
    // popups
    for (const p of S.popups) {
      const k = p.t / 1.1;
      const sz = Math.round(U.clamp(L.h * 0.055, 30, 64) * p.scale * (k < 0.15 ? 0.6 + k / 0.15 * 0.4 : 1));
      g.globalAlpha = 1 - Math.max(0, (k - 0.6) / 0.4);
      g.font = `900 ${sz}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = Math.max(4, sz * 0.14); g.strokeStyle = 'rgba(0,0,0,0.65)';
      const tw = g.measureText(p.text).width / 2 + 10;
      const px = U.clamp(p.x, p.fx + tw, Math.max(p.fx + tw, p.fx + p.fw - tw)), py = Math.max(L.hud + sz * 0.6, p.y - k * 90);
      g.strokeText(p.text, px, py);
      g.fillStyle = p.color; g.fillText(p.text, px, py);
    }
    g.globalAlpha = 1;
    drawHud(g);
    // countdown
    if (S.phase === 'countdown') {
      const c = Math.ceil(S.count), fr = S.count - Math.floor(S.count);
      for (const f of S.fields) {
        const sz = Math.min(f.rect.w, f.rect.h) * (0.3 + 0.1 * fr);
        g.globalAlpha = 0.4 + 0.6 * fr;
        g.font = `900 ${Math.round(sz)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = sz * 0.06; g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.strokeText(String(c), f.rect.x + f.rect.w / 2, f.rect.y + f.rect.h / 2);
        g.fillStyle = '#fff'; g.fillText(String(c), f.rect.x + f.rect.w / 2, f.rect.y + f.rect.h / 2);
      }
      g.globalAlpha = 1;
    }
    if (S.phase === 'play' && S.timeLeft > ROUND - 0.8) {
      g.globalAlpha = (S.timeLeft - (ROUND - 0.8)) / 0.8;
      for (const f of S.fields) {
        const sz = Math.min(f.rect.w, f.rect.h) * 0.25;
        g.font = `900 ${Math.round(sz)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = sz * 0.06; g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.strokeText('GO!', f.rect.x + f.rect.w / 2, f.rect.y + f.rect.h / 2);
        g.fillStyle = '#ffe08a'; g.fillText('GO!', f.rect.x + f.rect.w / 2, f.rect.y + f.rect.h / 2);
      }
      g.globalAlpha = 1;
    }
  }

  const loop = IFPD.loop(update, render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && loop.paused) loop.resume(); });

  window.__game = { S, L, startRound, showMenu, moleCenter };
  layout();
  showMenu();
})();
