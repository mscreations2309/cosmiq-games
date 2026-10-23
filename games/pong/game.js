/* Table Tennis — realistic top-down Pong for large multi-touch panels. */
(function () {
  'use strict';

  const U = IFPD.util;

  // ---- world units (≈ mm). Table occupies (0,0)-(TL,TW); x runs left→right between the players ----
  const TL = 2740, TW = 1525;
  const BR = 30;              // ball radius (exaggerated for visibility)
  const PH = 135;             // paddle half-length used for hit detection
  const G = 2000;             // gravity on the fake height axis
  const E_TABLE = 0.82, FLOOR = 760, NET_H = 152;
  const BASE_SPEED = 2300, SPEED_STEP = 70, MAX_SPEED = 4300, SPIN_MAX = 900, SERVE_SPEED = 1700;
  const BAND = [[-440, -110], [TL + 110, TL + 440]];
  const YMIN = -210, YMAX = TW + 210;
  const VIEW = { x0: -560, x1: TL + 560, y0: -250, y1: TW + 250 };
  const COLORS = ['#2d7ff9', '#f2542d'];
  const FONT = '"Segoe UI", Roboto, system-ui, sans-serif';
  const AI_LEVELS = {
    easy: { label: 'Easy', speed: 1150, accel: 6000, react: 0.3, err: 230, aim: 0.15 },
    medium: { label: 'Medium', speed: 1750, accel: 11000, react: 0.18, err: 185, aim: 0.45 },
    hard: { label: 'Hard', speed: 2600, accel: 20000, react: 0.08, err: 75, aim: 0.8 },
  };

  const S = {
    phase: 'menu',            // menu | serve | rally | dead | over
    ai: null, bestOf: 1, started: false,
    score: [0, 0], games: [0, 0], firstServer: 0, gameFirst: 0, server: 0,
    rally: 0, serveT: 0, deadT: 0, msg: '', msgT: 0, pendingGameEnd: false,
    ball: mkBall(),
    paddles: [mkPaddle(0), mkPaddle(1)],
    time: 0,
  };
  const ai = { timer: 0, ty: TW / 2, tx: TL + 250, aimO: null, serveAt: 0 };

  function mkBall() {
    return { x: -100, y: TW / 2, z: 120, vx: 0, vy: 0, vz: 0, spin: 0, decay: false, lastHitter: -1, bounced: -1, serveStage: 0, live: false, held: true, rot: 0, trail: [] };
  }
  function mkPaddle(side) {
    const x = side === 0 ? -260 : TL + 260;
    return { side, x, y: TW / 2, vx: 0, vy: 0, tx: x, ty: TW / 2, owner: null, fx: 0, fy: 0, swing: 0 };
  }
  const dirOf = s => (s === 0 ? 1 : -1);

  // ---- page ----
  const { extra } = IFPD.setupPage({ title: 'Table Tennis', onRestart: restart });
  const modeBtn = document.createElement('button');
  modeBtn.className = 'ifpd-btn';
  modeBtn.textContent = 'Modes';
  modeBtn.addEventListener('click', showMenu);
  extra.append(modeBtn);

  const canvas = document.getElementById('game');
  const L = { sc: 1, ox: 0, oy: 0, sbH: 60, w: 1, h: 1 };
  let staticCanvas = null;
  const view = IFPD.fitCanvas(canvas, layout);
  function layout(w, h) {
    L.w = w; L.h = h;
    L.sbH = U.clamp(h * 0.09, 50, 100);
    const availH = h - L.sbH - 6;
    L.sc = Math.max(0.05, Math.min(w / (VIEW.x1 - VIEW.x0), availH / (VIEW.y1 - VIEW.y0)));
    L.ox = w / 2 - (TL / 2) * L.sc;
    L.oy = L.sbH + 6 + availH / 2 - (TW / 2) * L.sc;
    staticCanvas = null;
  }
  layout(view.width, view.height);
  const toWorld = (x, y) => ({ x: (x - L.ox) / L.sc, y: (y - L.oy) / L.sc });

  // ---- input: the first finger landing in a half owns that half's paddle ----
  IFPD.pointers(canvas, {
    down(p) {
      if (S.phase === 'menu' || S.phase === 'over') return false;
      const w = toWorld(p.x, p.y);
      const side = w.x < TL / 2 ? 0 : 1;
      if (side === 1 && S.ai) return false;
      const pd = S.paddles[side];
      if (pd.owner !== null) return false;
      pd.owner = p.id; pd.fx = p.x; pd.fy = p.y; pd.heldT = 0;
      p.data.side = side;
      return true;
    },
    move(p) { const pd = S.paddles[p.data.side]; if (pd && pd.owner === p.id) { pd.fx = p.x; pd.fy = p.y; } },
    up(p) { const pd = S.paddles[p.data.side]; if (pd && pd.owner === p.id) pd.owner = null; },
  });

  // ---- flow ----
  function showMenu() {
    S.phase = 'menu';
    releaseAll();
    IFPD.overlay.show({
      title: 'Table Tennis',
      text: 'Move your paddle with one finger in your half.\nFlick toward the table to serve. Games to 11, win by 2.',
      buttons: [
        { label: '2 Players', kind: 'good', onClick: () => chooseLength(null) },
        { label: 'vs Computer · Easy', kind: 'primary', onClick: () => chooseLength('easy') },
        { label: 'Medium', kind: 'primary', onClick: () => chooseLength('medium') },
        { label: 'Hard', kind: 'bad', onClick: () => chooseLength('hard') },
      ],
    });
  }
  function chooseLength(aiLevel) {
    IFPD.overlay.show({
      title: aiLevel ? 'vs Computer · ' + AI_LEVELS[aiLevel].label : '2 Players',
      text: 'How long is the match?',
      buttons: [
        { label: 'One game to 11', kind: 'good', onClick: () => startMatch(aiLevel, 1) },
        { label: 'Best of 3 games', kind: 'primary', onClick: () => startMatch(aiLevel, 3) },
        { label: 'Back', kind: '', onClick: showMenu },
      ],
    });
  }
  function releaseAll() { for (const p of S.paddles) p.owner = null; }

  function startMatch(aiLevel, bestOf) {
    IFPD.overlay.hide();
    S.started = true;
    S.ai = aiLevel; S.bestOf = bestOf;
    S.games = [0, 0];
    S.paddles = [mkPaddle(0), mkPaddle(1)];
    S.firstServer = Math.random() < 0.5 ? 0 : 1;
    startGame(S.firstServer);
    IFPD.sfx.play('whoosh', { volume: 0.5 });
  }
  function startGame(first) {
    S.score = [0, 0];
    S.gameFirst = first;
    S.pendingGameEnd = false;
    beginServe();
    const n = playerNames();
    say(`${n[S.server]} serves`, 2);
  }
  function restart() { if (!S.started) showMenu(); else startMatch(S.ai, S.bestOf); }

  function serverFor() {
    const [a, b] = S.score, pts = a + b;
    if (a >= 10 && b >= 10) return (S.gameFirst + pts) % 2;
    return (S.gameFirst + Math.floor(pts / 2)) % 2;
  }
  function beginServe() {
    S.server = serverFor();
    S.phase = 'serve';
    S.serveT = 0;
    S.rally = 0;
    const b = S.ball = mkBall();
    b.held = true;
    ai.serveAt = U.rand(0.9, 1.5);
  }
  function say(t, sec = 1.4) { S.msg = t; S.msgT = sec; }
  function playerNames() { return S.ai ? ['YOU', 'CPU'] : ['BLUE', 'ORANGE']; }

  function pointTo(w) {
    const b = S.ball;
    if (!b.live) return;
    b.live = false;
    S.score[w]++;
    S.phase = 'dead';
    S.deadT = 1.4;
    if (S.rally >= 2 && IFPD.best.submit('pong-rally', S.rally)) say(`New best rally: ${S.rally}!`, 1.8);
    const names = playerNames();
    IFPD.sfx.play(S.ai && w === 1 ? 'wrong' : 'ding', { volume: 0.6, pan: w ? 0.6 : -0.6 });
    const [a, c] = S.score;
    if ((a >= 11 || c >= 11) && Math.abs(a - c) >= 2) {
      S.games[w]++;
      S.pendingGameEnd = true;
      S.deadT = 1.6;
      const need = Math.ceil(S.bestOf / 2);
      say(S.games[w] >= need ? `${names[w]} ${S.ai && w === 0 ? 'win' : 'wins'}!` : `Game to ${names[w]}`, 2);
      return;
    }
    if (S.msgT <= 0 || !/best rally/.test(S.msg)) {
      if (a >= 10 && c >= 10 && a === c) say('Deuce', 1.4);
      else if ((a >= 10 || c >= 10) && a !== c) say(`Point ${names[w]} · ${a > c ? names[0] : names[1]} game point`, 1.6);
      else say(`Point ${names[w]}`, 1.2);
    }
  }

  function afterDead() {
    if (S.pendingGameEnd) {
      const need = Math.ceil(S.bestOf / 2);
      const w = S.games[0] >= need ? 0 : S.games[1] >= need ? 1 : -1;
      if (w >= 0) { finish(w); return; }
      startGame(1 - S.gameFirst);
      return;
    }
    const prevServer = S.server;
    beginServe();
    if (prevServer !== S.server) say(`${playerNames()[S.server]} to serve`, 1.3);
  }

  function finish(w) {
    S.phase = 'over';
    releaseAll();
    const names = playerNames();
    const human = !S.ai || w === 0;
    IFPD.sfx.play(human ? 'win' : 'lose');
    if (human) IFPD.confetti(3000);
    const best = IFPD.best.get('pong-rally');
    let text = S.bestOf > 1 ? `Games ${S.games[0]} – ${S.games[1]}\nLast game ${S.score[0]} – ${S.score[1]}` : `Final score ${S.score[0]} – ${S.score[1]}`;
    if (best != null) text += `\nLongest rally ever: ${best} hits`;
    setTimeout(() => {
      if (S.phase !== 'over') return;
      IFPD.overlay.show({
        title: S.ai ? (w === 0 ? 'You win!' : 'Computer wins') : `${names[w]} wins!`,
        text,
        buttons: [
          { label: 'Play again', kind: 'good', onClick: () => startMatch(S.ai, S.bestOf) },
          { label: 'Change mode', kind: 'primary', onClick: showMenu },
        ],
      });
    }, 600);
  }

  // ---- ball physics ----
  const overTable = b => b.x >= 0 && b.x <= TL && b.y >= 0 && b.y <= TW;

  function setTrajectory(b, xb, yt, speed, spin) {
    const t = Math.max(0.15, Math.abs(xb - b.x) / speed);
    b.vx = Math.sign(xb - b.x) * speed;
    b.z = Math.max(b.z, 40);
    b.vz = (0.5 * G * t * t - b.z) / t;
    b.spin = spin;
    b.vy = (yt - b.y - 0.5 * spin * t * t) / t;
    b.decay = false;
  }

  // Integrates the ball for dt. Returns 'table', 'floor' or null.
  function flight(b, dt) {
    const pz = b.z;
    b.x += b.vx * dt;
    b.y += b.vy * dt + 0.5 * b.spin * dt * dt;
    b.vy += b.spin * dt;
    if (b.decay) b.spin *= Math.exp(-1.6 * dt);
    b.z += b.vz * dt - 0.5 * G * dt * dt;
    b.vz -= G * dt;
    b.rot += (Math.abs(b.vx) * 0.004 + b.spin * 0.01) * dt;
    if (b.vz < 0 && pz >= 0 && b.z <= 0 && overTable(b)) { b.z = 0; return 'table'; }
    if (b.vz < 0 && b.z <= -FLOOR) { b.z = -FLOOR; b.vz = -b.vz * 0.5; b.vx *= 0.7; b.vy *= 0.7; b.spin = 0; return 'floor'; }
    return null;
  }

  // Table bounce rules. real=false is used by the AI prediction (no randomness, no scoring).
  function tableBounce(b, real) {
    const side = b.x < TL / 2 ? 0 : 1;
    if (b.serveStage === 1 && side === b.lastHitter) {
      if (!real) return 'stop';
      b.serveStage = 2;
      b.bounced = side;
      const xb2 = side === 0 ? TL * U.rand(0.7, 0.86) : TL * (1 - U.rand(0.7, 0.86));
      const yt2 = U.clamp(TW / 2 + U.rand(-0.36, 0.36) * TW, 120, TW - 120);
      const t2 = Math.abs(xb2 - b.x) / Math.abs(b.vx);
      b.z = 0; b.vz = 0.5 * G * t2;
      b.vy = (yt2 - b.y - 0.5 * b.spin * t2 * t2) / t2;
      return 'ok';
    }
    if (side === b.lastHitter || b.bounced === side) {
      // own side after a return, or second bounce on receiver side
      if (real) pointTo(side === b.lastHitter ? 1 - b.lastHitter : b.lastHitter);
      b.vz = -b.vz * E_TABLE; b.z = 0;
      return 'point';
    }
    b.bounced = side;
    b.vz = -b.vz * E_TABLE; b.z = 0;
    b.vy += b.spin * 0.12;
    b.decay = true;
    return 'ok';
  }

  function hit(s) {
    const b = S.ball, p = S.paddles[s];
    const dir = dirOf(s);
    S.rally++;
    const fwd = Math.max(0, p.vx * dir);
    const speed = Math.min(MAX_SPEED, BASE_SPEED + S.rally * SPEED_STEP + Math.min(500, fwd * 0.25));
    const o = U.clamp((b.y - p.y) / PH, -1, 1);
    const yt = U.clamp(TW / 2 + o * TW * 0.4 + (b.y - TW / 2) * 0.22, 90, TW - 90);
    const xb = s === 0 ? TL * U.rand(0.63, 0.86) : TL * (1 - U.rand(0.63, 0.86));
    const spin = U.clamp(p.vy * 0.5, -SPIN_MAX, SPIN_MAX);
    b.x = p.x + dir * 2;
    setTrajectory(b, xb, yt, speed, spin);
    b.lastHitter = s; b.bounced = -1; b.serveStage = 0;
    p.swing = 1;
    IFPD.sfx.play('hit', { volume: U.clamp(0.45 + speed / MAX_SPEED * 0.55, 0.3, 1), pitch: 1.35 + Math.abs(o) * 0.1, pan: pan(b.x) });
    if (Math.abs(spin) > SPIN_MAX * 0.5) IFPD.sfx.play('whoosh', { volume: 0.25, pitch: 1.6, pan: pan(b.x) });
  }

  function serve(s) {
    const b = S.ball, p = S.paddles[s];
    const dir = dirOf(s);
    b.held = false; b.live = true;
    b.x = p.x + dir * 70;
    b.y = p.y;
    b.z = Math.max(140, b.z);
    const xb1 = s === 0 ? TL * 0.2 : TL * 0.8;
    const yt = U.clamp(p.y + U.rand(-120, 120), 140, TW - 140);
    const spin = U.clamp(p.vy * 0.3, -SPIN_MAX * 0.5, SPIN_MAX * 0.5);
    setTrajectory(b, xb1, yt, SERVE_SPEED, spin);
    b.lastHitter = s; b.bounced = -1; b.serveStage = 1;
    S.phase = 'rally';
    S.rally = 0;
    p.swing = 1;
    IFPD.sfx.play('hit', { volume: 0.6, pitch: 1.4, pan: pan(b.x) });
  }

  const pan = x => U.clamp((x / TL) * 2 - 1, -1, 1) * 0.85;

  // ---- update ----
  function update(dt) {
    S.time += dt;
    if (S.msgT > 0) S.msgT -= dt;
    for (const p of S.paddles) if (p.swing > 0) p.swing = Math.max(0, p.swing - dt * 4);
    if (S.phase === 'menu' || S.phase === 'over') return;

    for (const p of S.paddles) {
      if (p.side === 1 && S.ai) continue;
      if (p.owner !== null) {
        p.heldT = (p.heldT || 0) + dt;
        const w = toWorld(p.fx, p.fy);
        p.tx = U.clamp(w.x, BAND[p.side][0], BAND[p.side][1]);
        p.ty = U.clamp(w.y, YMIN, YMAX);
      } else { p.tx = p.x; p.ty = p.y; }
    }
    if (S.ai) aiThink(dt);

    const b = S.ball;
    const n = 3, h = dt / n;
    for (let i = 0; i < n; i++) {
      const prevRel = S.paddles.map(p => (b.x - p.x) * dirOf(p.side));
      for (const p of S.paddles) movePaddle(p, h);
      if (b.held) {
        const p = S.paddles[S.server];
        b.x = p.x + dirOf(S.server) * 70;
        b.y = p.y;
        b.z = 140 + Math.abs(Math.sin(S.serveT * 3.2)) * 260;
        continue;
      }
      const ev = flight(b, h);
      if (ev === 'table') {
        const r = tableBounce(b, true);
        IFPD.sfx.play('snap', { volume: 0.7, pitch: 1.1, pan: pan(b.x) });
        if (r === 'point') { /* scored inside tableBounce */ }
      } else if (ev === 'floor') {
        IFPD.sfx.play('tick', { volume: 1.2, pitch: 0.5, pan: pan(b.x) });
        if (b.live) decideMiss();
      }
      if (b.live && (b.x < VIEW.x0 || b.x > VIEW.x1 || b.y < VIEW.y0 - 200 || b.y > VIEW.y1 + 200)) decideMiss();
      // paddle contact: the ball centre crosses the paddle plane within reach
      if (b.live) {
        for (const p of S.paddles) {
          if (b.lastHitter === p.side || b.bounced !== p.side) continue;
          const rel = (b.x - p.x) * dirOf(p.side);
          if (prevRel[p.side] > 0 && rel <= 0 && Math.abs(b.y - p.y) <= PH + BR && b.z > -FLOOR * 0.6) { hit(p.side); break; }
        }
      }
    }

    if (b.held || b.live) { b.trail.push(b.x, b.y, b.z); if (b.trail.length > 30) b.trail.splice(0, 3); }

    if (S.phase === 'serve') {
      S.serveT += dt;
      const sp = S.paddles[S.server];
      const human = !(S.ai && S.server === 1);
      if (human) {
        if (sp.vx * dirOf(S.server) > 1100 && sp.owner !== null && sp.heldT > 0.25) serve(S.server);
        else if (S.serveT > 6) serve(S.server); // auto-serve so the game never stalls
      } else if (S.serveT > ai.serveAt) serve(1);
    } else if (S.phase === 'dead') {
      S.deadT -= dt;
      if (S.deadT <= 0) afterDead();
    }
  }

  function decideMiss() {
    const b = S.ball;
    const recv = 1 - b.lastHitter;
    pointTo(b.bounced === recv ? b.lastHitter : recv);
  }

  function movePaddle(p, h) {
    const ox = p.x, oy = p.y;
    if (p.side === 1 && S.ai) {
      const lv = AI_LEVELS[S.ai];
      const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
      let dvx = 0, dvy = 0;
      if (d > 3) { const sp = Math.min(lv.speed, d / 0.08); dvx = dx / d * sp; dvy = dy / d * sp; }
      let ax = dvx - p.vx, ay = dvy - p.vy;
      const a = Math.hypot(ax, ay), am = lv.accel * h;
      if (a > am) { ax *= am / a; ay *= am / a; }
      p.x += (p.vx + ax) * h; p.y += (p.vy + ay) * h;
    } else if (p.owner !== null) {
      const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
      if (d > 0.01) { const st = Math.min(d, Math.min(9000, d / 0.02) * h); p.x += dx / d * st; p.y += dy / d * st; }
    }
    p.x = U.clamp(p.x, BAND[p.side][0], BAND[p.side][1]);
    p.y = U.clamp(p.y, YMIN, YMAX);
    p.vx = (p.x - ox) / h; p.vy = (p.y - oy) / h;
  }

  // ---- computer (right paddle) ----
  function predictAt(xPlane) {
    const b = S.ball;
    if (!b.live || b.lastHitter !== 0) return null;
    const c = { ...b, trail: null };
    for (let t = 0; t < 4; t += 1 / 120) {
      if (c.x >= xPlane) return c.y;
      const ev = flight(c, 1 / 120);
      if (ev === 'table') { if (tableBounce(c, false) !== 'ok') return null; }
      else if (ev === 'floor') return null;
    }
    return null;
  }
  function aiThink(dt) {
    const lv = AI_LEVELS[S.ai], p = S.paddles[1], b = S.ball;
    ai.timer -= dt;
    if (ai.timer > 0) { p.tx = ai.tx; p.ty = ai.ty; return; }
    ai.timer = lv.react * U.rand(0.8, 1.25);
    if (S.phase === 'serve' && S.server === 1) {
      ai.tx = TL + 330; ai.ty = TW / 2 + Math.sin(S.time) * 200;
    } else if (S.phase === 'rally' && b.lastHitter === 0) {
      const xp = TL + 230;
      const py = predictAt(xp);
      if (py != null) {
        if (ai.aimO === null) ai.aimO = U.rand(-lv.aim, lv.aim) * PH * 0.8 + U.rand(-lv.err, lv.err);
        ai.ty = py - ai.aimO;
        ai.tx = xp;
      } else if (b.serveStage === 1) { ai.ty = U.lerp(TW / 2, b.y, 0.5); ai.tx = xp; }
    } else {
      ai.aimO = null;
      ai.tx = TL + 260; ai.ty = U.lerp(TW / 2, b.y, 0.3);
    }
    if (b.lastHitter === 1) ai.aimO = null;
    ai.ty = U.clamp(ai.ty, YMIN, YMAX);
    p.tx = ai.tx; p.ty = ai.ty;
  }

  // ---- rendering ----
  function buildStatic() {
    const { width: w, height: h, dpr } = view;
    const c = document.createElement('canvas');
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // sports-hall wooden floor
    g.drawImage(IFPD.texture.wood(w, h, { base: '#b5814c', dark: '#6e4626', vertical: true, planks: Math.max(6, Math.round(w / 110)) }), 0, 0, w, h);
    const vg = g.createRadialGradient(w / 2, h * 0.55, h * 0.2, w / 2, h * 0.55, Math.max(w, h) * 0.7);
    vg.addColorStop(0, 'rgba(255,240,210,0.10)'); vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);

    const sc = L.sc;
    g.save();
    g.translate(L.ox, L.oy); g.scale(sc, sc);
    // court surround: red rubber sports mat around the table
    g.fillStyle = 'rgba(120,30,25,0.55)';
    IFPD.draw.roundRect(g, -520, -230, TL + 1040, TW + 460, 40); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 6;
    IFPD.draw.roundRect(g, -520, -230, TL + 1040, TW + 460, 40); g.stroke();
    // table shadow on the floor and legs
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 80 * sc * 2; g.shadowOffsetX = 50 * sc * 2; g.shadowOffsetY = 70 * sc * 2;
    g.fillStyle = '#0d1a2e';
    g.fillRect(0, 0, TL, TW + 30);
    g.restore();
    // front edge (table thickness) for depth
    g.fillStyle = '#0c1d3a';
    g.fillRect(0, TW, TL, 30);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(0, TW, TL, 3);
    // top surface
    g.drawImage(IFPD.texture.felt(TL * sc, TW * sc, { color: '#1c4f8f' }), 0, 0, TL, TW);
    const tg = g.createLinearGradient(0, 0, TL, TW);
    tg.addColorStop(0, 'rgba(255,255,255,0.10)'); tg.addColorStop(0.5, 'rgba(255,255,255,0)'); tg.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = tg; g.fillRect(0, 0, TL, TW);
    // lines
    g.strokeStyle = '#f4f4f0';
    g.lineWidth = 26;
    g.strokeRect(13, 13, TL - 26, TW - 26);
    g.lineWidth = 8;
    g.beginPath(); g.moveTo(26, TW / 2); g.lineTo(TL - 26, TW / 2); g.stroke();
    // net shadow (light from the top-left)
    const ns = g.createLinearGradient(TL / 2, 0, TL / 2 + 90, 0);
    ns.addColorStop(0, 'rgba(0,0,0,0.45)'); ns.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = ns;
    g.fillRect(TL / 2, 0, 90, TW + 40);
    // net mesh
    const nx = TL / 2 - 9;
    g.fillStyle = 'rgba(20,25,35,0.85)';
    g.fillRect(nx, -152, 18, TW + 304);
    g.strokeStyle = 'rgba(200,210,230,0.35)'; g.lineWidth = 1.5;
    for (let y = -152; y < TW + 152; y += 14) { g.beginPath(); g.moveTo(nx, y); g.lineTo(nx + 18, y + 14); g.stroke(); }
    g.fillStyle = '#f7f7f2';
    g.fillRect(nx + 4, -152, 10, TW + 304);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(nx + 11, -152, 3, TW + 304);
    // net posts / clamps
    for (const py of [-170, TW + 150]) {
      const pg = g.createLinearGradient(nx - 20, 0, nx + 40, 0);
      pg.addColorStop(0, '#9aa3b0'); pg.addColorStop(0.5, '#e6eaf0'); pg.addColorStop(1, '#4b525d');
      g.fillStyle = pg;
      IFPD.draw.roundRect(g, nx - 16, py, 50, 22, 6); g.fill();
      g.fillStyle = '#1b1e24';
      IFPD.draw.roundRect(g, nx - 10, py < 0 ? py + 18 : py - 40, 38, 44, 6); g.fill();
    }
    g.restore();
    staticCanvas = c;
  }

  function drawPaddle(g, p) {
    const dir = dirOf(p.side);
    const col = COLORS[p.side];
    // player glow under the paddle
    const gl = g.createRadialGradient(p.x, p.y, 20, p.x, p.y, 210);
    gl.addColorStop(0, IFPD.draw.shade(col, 0).replace('rgb', 'rgba').replace(')', ',0.55)'));
    gl.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gl;
    g.beginPath(); g.arc(p.x, p.y, 210, 0, Math.PI * 2); g.fill();

    const tilt = p.swing * 0.35 * dir;
    // shadow on the floor
    IFPD.draw.shadow(g, p.x + 60, p.y + 80, 110, 150, 0.4);
    g.save();
    g.translate(p.x, p.y);
    g.rotate(tilt);
    // handle (points away from the table)
    const hx = -dir * 60;
    const hg = g.createLinearGradient(0, -22, 0, 22);
    hg.addColorStop(0, '#e9c38d'); hg.addColorStop(0.5, '#c8925a'); hg.addColorStop(1, '#8a5a32');
    g.fillStyle = hg;
    g.beginPath();
    g.moveTo(hx, -20); g.lineTo(hx - dir * 120, -24); g.quadraticCurveTo(hx - dir * 150, 0, hx - dir * 120, 24); g.lineTo(hx, 20); g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(60,35,15,0.6)'; g.lineWidth = 3; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(Math.min(hx, hx - dir * 115), -14, 115, 6);
    // blade seen at an angle: back rubber (black), wooden edge, front rubber (red) facing the table
    g.fillStyle = '#16171a';
    g.beginPath(); g.ellipse(-dir * 12, 0, 58, 128, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c99a62';
    g.beginPath(); g.ellipse(-dir * 4, 0, 58, 130, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#7a5130'; g.lineWidth = 3; g.stroke();
    const rg = g.createRadialGradient(dir * 10 - 14, -50, 8, dir * 6, 0, 135);
    rg.addColorStop(0, '#ff6a5a'); rg.addColorStop(0.6, '#d3231b'); rg.addColorStop(1, '#8d120d');
    g.fillStyle = rg;
    g.beginPath(); g.ellipse(dir * 6, 0, 52, 122, 0, 0, Math.PI * 2); g.fill();
    // pimple texture hint
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let yy = -100; yy <= 100; yy += 18) for (let xx = -36; xx <= 36; xx += 18) {
      if ((xx * xx) / (48 * 48) + (yy * yy) / (116 * 116) < 1) { g.beginPath(); g.arc(dir * 6 + xx, yy, 2.4, 0, 6.28); g.fill(); }
    }
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.beginPath(); g.ellipse(dir * 6 - 14, -55, 16, 40, -0.2, 0, Math.PI * 2); g.fill();
    g.restore();
    if (p.owner !== null) {
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 6;
      g.beginPath(); g.ellipse(p.x, p.y, 90, 160, 0, 0, Math.PI * 2); g.stroke();
    }
  }

  function drawBall(g, b) {
    const ground = overTable(b) && b.z >= -5 ? 0 : -FLOOR;
    const hgt = Math.max(0, b.z - ground);
    // shadow
    const sa = U.clamp(0.5 - hgt / 2400, 0.12, 0.5);
    IFPD.draw.shadow(g, b.x + hgt * 0.22, b.y + hgt * 0.3, BR * (1.1 + hgt / 1500), BR * (0.9 + hgt / 1600), sa);
    const r = BR * U.clamp(1 + b.z / 1100, 0.45, 1.6);
    // motion trail
    const tr = b.trail, n = tr.length / 3;
    for (let i = 0; i < n - 1; i++) {
      const t = i / n;
      g.fillStyle = `rgba(255,200,120,${t * 0.18})`;
      g.beginPath(); g.arc(tr[i * 3], tr[i * 3 + 1], r * (0.5 + 0.5 * t), 0, Math.PI * 2); g.fill();
    }
    IFPD.draw.ball(g, b.x, b.y, r, '#ff8c1a', 0.7);
    // spinning logo stripe
    g.save();
    g.beginPath(); g.arc(b.x, b.y, r, 0, Math.PI * 2); g.clip();
    g.strokeStyle = 'rgba(150,60,0,0.35)'; g.lineWidth = r * 0.16;
    const a = b.rot * 6;
    g.beginPath(); g.ellipse(b.x, b.y, r * 0.85, r * Math.abs(Math.cos(a)) * 0.85, a * 0.3, 0, Math.PI); g.stroke();
    g.restore();
  }

  function drawScoreboard(g) {
    const names = playerNames();
    const h = L.sbH - 8, y = 4;
    const cw = Math.min(L.w - 16, h * 13), x = (L.w - cw) / 2;
    const pg = g.createLinearGradient(0, y, 0, y + h);
    pg.addColorStop(0, '#2b2e38'); pg.addColorStop(1, '#14151b');
    g.fillStyle = pg;
    IFPD.draw.roundRect(g, x, y, cw, h, h * 0.25); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 2; g.stroke();
    g.textBaseline = 'middle';
    const cy = y + h / 2;
    for (const s of [0, 1]) {
      const sg = s ? 1 : -1;
      const dx = L.w / 2 + sg * h * 1.15;
      g.fillStyle = '#05060a';
      IFPD.draw.roundRect(g, dx - h * 0.62, y + h * 0.08, h * 1.24, h * 0.84, 8); g.fill();
      g.font = `700 ${Math.round(h * 0.78)}px ${FONT}`;
      g.textAlign = 'center';
      g.shadowColor = COLORS[s]; g.shadowBlur = 16;
      g.fillStyle = s ? '#ff9a6e' : '#7fb2ff';
      g.fillText(String(S.score[s]), dx, cy + h * 0.04);
      g.shadowBlur = 0;
      // games won (pips)
      if (S.bestOf > 1) {
        for (let i = 0; i < 2; i++) {
          g.fillStyle = i < S.games[s] ? '#ffd23f' : 'rgba(255,255,255,0.15)';
          g.beginPath(); g.arc(dx + sg * h * (0.85 + i * 0.3), cy + h * 0.24, h * 0.1, 0, Math.PI * 2); g.fill();
        }
      }
      // name and serve indicator
      g.font = `700 ${Math.round(h * 0.36)}px ${FONT}`;
      g.textAlign = s ? 'left' : 'right';
      g.fillStyle = s ? '#ffb08f' : '#9cc3ff';
      const nx = dx + sg * h * (S.bestOf > 1 ? 1.55 : 0.9);
      g.fillText(names[s], nx, cy - (S.bestOf > 1 ? 0 : 0));
      const tw = g.measureText(names[s]).width;
      if (S.server === s && S.phase !== 'menu' && S.phase !== 'over') {
        const bx = nx + sg * (tw + h * 0.35);
        IFPD.draw.ball(g, bx, cy, h * 0.16, '#ff8c1a', 0.7);
        g.font = `600 ${Math.round(h * 0.2)}px ${FONT}`;
        g.fillStyle = '#ffd9a8';
        g.textAlign = 'center';
        g.fillText('SERVE', bx, cy + h * 0.33);
      }
    }
    g.textAlign = 'center';
    g.fillStyle = '#9aa0ad';
    g.font = `700 ${Math.round(h * 0.2)}px ${FONT}`;
    g.fillText(S.bestOf > 1 ? `GAME ${S.games[0] + S.games[1] + (S.phase === 'over' ? 0 : 1)}` : 'TO 11', L.w / 2, cy - h * 0.16);
    g.fillText(`RALLY ${S.rally}`, L.w / 2, cy + h * 0.16);
    // best rally on the far right of the panel
    const best = IFPD.best.get('pong-rally');
    if (best != null && cw > h * 12) {
      g.textAlign = 'right';
      g.font = `600 ${Math.round(h * 0.24)}px ${FONT}`;
      g.fillStyle = '#7d8290';
      g.fillText(`Best rally ${best}`, x + cw - h * 0.3, cy);
    }
  }

  function render() {
    const g = view.ctx;
    if (!staticCanvas || staticCanvas.width !== Math.round(view.width * view.dpr) || staticCanvas.height !== Math.round(view.height * view.dpr)) buildStatic();
    g.drawImage(staticCanvas, 0, 0, view.width, view.height);
    g.save();
    g.translate(L.ox, L.oy); g.scale(L.sc, L.sc);
    const b = S.ball;
    // serve hint
    if (S.phase === 'serve' && !(S.ai && S.server === 1)) {
      const s = S.server, x = s === 0 ? TL * 0.22 : TL * 0.78;
      g.globalAlpha = 0.75 + 0.25 * Math.sin(S.time * 5);
      g.fillStyle = '#ffffff';
      g.font = `700 92px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(s === 0 ? 'Flick right to serve  ➜' : '⬅  Flick left to serve', x, TW * 0.25);
      g.font = `600 60px ${FONT}`;
      g.fillText(`auto-serve in ${Math.max(0, Math.ceil(6 - S.serveT))}`, x, TW * 0.25 + 95);
      g.globalAlpha = 1;
    }
    const lowBall = b.z < 0 && !b.held;
    if (lowBall) drawBall(g, b);
    for (const p of S.paddles) drawPaddle(g, p);
    if (!lowBall && S.phase !== 'menu') drawBall(g, b);
    if (S.msgT > 0 && S.msg) {
      g.globalAlpha = Math.min(1, S.msgT * 2.5);
      g.font = `800 96px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      const tw = g.measureText(S.msg).width + 100;
      g.fillStyle = 'rgba(10,15,30,0.78)';
      IFPD.draw.roundRect(g, TL / 2 - tw / 2, TW * 0.5 - 85, tw, 170, 50); g.fill();
      g.fillStyle = '#fff';
      g.fillText(S.msg, TL / 2, TW * 0.5 + 4);
      g.globalAlpha = 1;
    }
    g.restore();
    drawScoreboard(g);
  }

  const loop = IFPD.loop(update, render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && loop.paused) loop.resume(); });

  window.__game = { S, ai, TL, TW, PH, L, pointTo, toWorld, startMatch, showMenu, serve, toScreen: (x, y) => ({ x: L.ox + x * L.sc, y: L.oy + y * L.sc }) };
  showMenu();
})();
