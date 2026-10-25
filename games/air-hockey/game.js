/* Air Hockey — 2 players or vs computer, for large multi-touch panels. */
(function () {
  'use strict';

  const U = IFPD.util;

  // ---- world (table) units: playfield is W x H, origin top-left of the ice ----
  const W = 2000, H = 1000, RAIL = 74;
  const PR = 36;            // puck radius
  const MR = 62;            // mallet radius
  const GOAL_W = 300;       // goal opening (30% of table height)
  const GY0 = (H - GOAL_W) / 2, GY1 = (H + GOAL_W) / 2;
  const WIN_SCORE = 7;
  const PUCK_MAX = 5200;    // units / s
  const MALLET_MAX = 7500;  // human mallet follow speed cap
  const MALLET_HIT_CAP = 4600; // mallet velocity used for impulse is capped
  const FOLLOW_TAU = 0.022; // human mallet smoothing time constant (s)
  const KEY_SPEED = 3000;   // keyboard mallet top speed (units / s)
  const KEY_ACCEL = 16000;  // keyboard mallet acceleration toward the held direction
  const KEY_BRAKE = 20000;  // deceleration once the keys are released
  const E_WALL = 0.88, E_MALLET = 0.8;
  const FRICTION = 0.2;     // exponential decay per second (air table: very low)
  const COLORS = ['#1f6fe0', '#e0362b'];
  const FONT = '"Segoe UI", Roboto, system-ui, sans-serif';

  const AI_LEVELS = {
    easy: { label: 'Easy', speed: 1300, accel: 8000, react: 0.26, err: 120, aim: 260, strike: 0.6 },
    medium: { label: 'Medium', speed: 2100, accel: 13000, react: 0.15, err: 65, aim: 140, strike: 0.85 },
    hard: { label: 'Hard', speed: 4000, accel: 30000, react: 0.05, err: 14, aim: 70, strike: 1 },
  };

  // Rail segments (puck collides with these; segment endpoints act as rounded goal posts).
  const SEGS = [
    [0, 0, W, 0], [0, H, W, H],
    [0, 0, 0, GY0], [0, GY1, 0, H],
    [W, 0, W, GY0], [W, GY1, W, H],
    [0, GY0, -RAIL - 60, GY0], [0, GY1, -RAIL - 60, GY1],
    [W, GY0, W + RAIL + 60, GY0], [W, GY1, W + RAIL + 60, GY1],
  ];

  // ---- state ----
  const S = {
    phase: 'menu',          // menu | play | goal | over
    ai: null,               // null (2 players) or level key
    score: [0, 0],
    puck: { x: W / 2, y: H / 2, vx: 0, vy: 0, visible: true, trail: [] },
    mallets: [mkMallet(0), mkMallet(1)],
    goalTimer: 0, goalBy: -1, flash: 0, still: 0, time: 0, hint: 0, msg: '', msgT: 0,
    sndCool: 0,
  };
  const aiState = { timer: 0, tx: W - 200, ty: H / 2, errY: 0 };

  function mkMallet(side) {
    const x = side === 0 ? 220 : W - 220;
    return { side, x, y: H / 2, vx: 0, vy: 0, tx: x, ty: H / 2, owner: null, fingerX: 0, fingerY: 0,
      keys: false, kvx: 0, kvy: 0 }; // keys: driven by the keyboard (last input — key or finger move — wins)
  }
  function xMin(side) { return side === 0 ? MR : W / 2 + MR; }
  function xMax(side) { return side === 0 ? W / 2 - MR : W - MR; }

  // ---- page ----
  const { extra } = IFPD.setupPage({ title: 'Air Hockey', onRestart: restart });
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
    L.sbH = U.clamp(h * 0.085, 46, 96);
    const availW = w - 24, availH = h - L.sbH - 18;
    L.sc = Math.max(0.05, Math.min(availW / (W + 2 * RAIL + 40), availH / (H + 2 * RAIL + 30)));
    L.ox = (w - W * L.sc) / 2;
    L.oy = L.sbH + 6 + (availH - (H + 2 * RAIL) * L.sc) / 2 + RAIL * L.sc;
    staticCanvas = null; // rebuilt lazily at the new size
  }
  layout(view.width, view.height);

  const toWorld = (x, y) => ({ x: (x - L.ox) / L.sc, y: (y - L.oy) / L.sc });

  // ---- input ----
  IFPD.pointers(canvas, {
    down(p) {
      if (S.phase !== 'play' && S.phase !== 'goal') return false;
      const w = toWorld(p.x, p.y);
      const side = w.x < W / 2 ? 0 : 1;
      if (side === 1 && S.ai) return false;
      const m = S.mallets[side];
      if (m.owner !== null) return false; // half already controlled: ignore extra touches
      m.owner = p.id;
      m.keys = false;
      m.fingerX = p.x; m.fingerY = p.y;
      p.data.side = side;
      IFPD.sfx.play('click', { volume: 0.5, pan: side ? 0.6 : -0.6 });
      return true;
    },
    move(p) {
      const m = S.mallets[p.data.side];
      if (m && m.owner === p.id) { m.fingerX = p.x; m.fingerY = p.y; m.keys = false; }
    },
    up(p) {
      const m = S.mallets[p.data.side];
      if (m && m.owner === p.id) m.owner = null;
    },
  });

  // ---- keyboard: P1 W A S D, P2 arrows (vs computer the human may use either) ----
  const KEY_DIRS = { // code -> [player, dx, dy]
    KeyW: [0, 0, -1], KeyS: [0, 0, 1], KeyA: [0, -1, 0], KeyD: [0, 1, 0],
    ArrowUp: [1, 0, -1], ArrowDown: [1, 0, 1], ArrowLeft: [1, -1, 0], ArrowRight: [1, 1, 0],
  };
  const held = new Set();
  const keySide = code => (S.ai ? 0 : KEY_DIRS[code][0]);
  const playing = () => S.phase === 'play' || S.phase === 'goal';
  CosmiqInput.keys.on(e => {
    if (e.type === 'keyup') { held.delete(e.code); return; }
    if (!playing() || IFPD.overlay.visible) return;
    if (e.code === 'Escape' && !e.repeat) { showMenu(); e.preventDefault(); return; }
    if (!KEY_DIRS[e.code]) return;
    e.preventDefault();
    held.add(e.code);
    S.mallets[keySide(e.code)].keys = true;
  });
  window.addEventListener('blur', () => held.clear());

  function keyDir(side) {
    let dx = 0, dy = 0;
    for (const c of held) {
      if (keySide(c) !== side) continue;
      dx += KEY_DIRS[c][1]; dy += KEY_DIRS[c][2];
    }
    const d = Math.hypot(dx, dy);
    return d ? { x: dx / d, y: dy / d } : null;
  }

  function showKeyHelp() {
    if (!playing()) {
      CosmiqInput.keys.help('Air Hockey', [['Tab ← →', 'Choose'], ['Enter', 'Start']]);
    } else if (S.ai) {
      CosmiqInput.keys.help('Air Hockey', [['W A S D', 'Move your mallet'], ['↑ ← ↓ →', 'Arrow keys work too'], ['Esc', 'Modes menu']]);
    } else {
      CosmiqInput.keys.help('Air Hockey', [['W A S D', 'Blue mallet (left)'], ['↑ ← ↓ →', 'Red mallet (right)'], ['Esc', 'Modes menu']]);
    }
  }

  // ---- game flow ----
  function showMenu() {
    S.phase = 'menu';
    releaseAll();
    showKeyHelp();
    IFPD.overlay.show({
      title: 'Air Hockey',
      text: 'First to 7 goals wins.\nTouch your half of the table to grab your mallet\n(keyboard: W A S D and arrow keys).',
      buttons: [
        { label: '2 Players', kind: 'good', onClick: () => startMatch(null) },
        { label: 'vs Computer · Easy', kind: 'primary', onClick: () => startMatch('easy') },
        { label: 'Medium', kind: 'primary', onClick: () => startMatch('medium') },
        { label: 'Hard', kind: 'bad', onClick: () => startMatch('hard') },
      ],
    });
  }

  function releaseAll() {
    held.clear();
    for (const m of S.mallets) { m.owner = null; m.keys = false; m.kvx = m.kvy = 0; }
  }

  function startMatch(ai) {
    IFPD.overlay.hide();
    S.started = true;
    S.ai = ai;
    S.score = [0, 0];
    S.mallets = [mkMallet(0), mkMallet(1)];
    S.flash = 0; S.goalBy = -1; S.still = 0; S.hint = 4;
    aiState.timer = 0; aiState.tx = W - 200; aiState.ty = H / 2;
    placePuck(Math.random() < 0.5 ? 0 : 1);
    S.phase = 'play';
    held.clear();
    showKeyHelp();
    IFPD.sfx.play('whoosh', { volume: 0.6 });
  }

  function restart() {
    if (!S.started) { showMenu(); return; }
    startMatch(S.ai);
  }

  function placePuck(side) {
    const p = S.puck;
    const x = side === 0 ? W * 0.25 : W * 0.75;
    let y = H / 2;
    const m = S.mallets[side];
    if (Math.hypot(m.x - x, m.y - y) < PR + MR + 10) y = m.y > H / 2 ? H / 2 - 220 : H / 2 + 220;
    Object.assign(p, { x, y, vx: 0, vy: 0, visible: true });
    p.trail.length = 0;
    S.still = 0;
  }

  function goal(scorer) {
    S.score[scorer]++;
    S.phase = 'goal';
    S.goalBy = scorer;
    S.goalTimer = 1.05;
    S.flash = 1;
    S.puck.visible = false;
    S.puck.vx = S.puck.vy = 0;
    const pan = scorer === 0 ? 0.8 : -0.8; // puck went into the opposite end
    IFPD.sfx.play('drop', { volume: 0.9, pan });
    IFPD.sfx.play('goal', { volume: 0.9, pan: pan * 0.5 });
  }

  function finish() {
    S.phase = 'over';
    S.started = true;
    releaseAll();
    showKeyHelp();
    const winner = S.score[0] > S.score[1] ? 0 : 1;
    const names = playerNames();
    let text = `${names[0]} ${S.score[0]} : ${S.score[1]} ${names[1]}`;
    if (S.ai) {
      if (winner === 0) {
        const margin = S.score[0] - S.score[1];
        const rec = IFPD.best.submit('air-hockey-' + S.ai, margin);
        text += `\nWin margin ${margin}` + (rec ? ' — new best!' : `  (best ${IFPD.best.get('air-hockey-' + S.ai)})`);
      } else {
        const b = IFPD.best.get('air-hockey-' + S.ai);
        text += b != null ? `\nBest win margin vs ${AI_LEVELS[S.ai].label}: ${b}` : '\nBeat the computer to set a record!';
      }
    }
    const humanWon = !S.ai || winner === 0;
    IFPD.sfx.play(humanWon ? 'win' : 'lose');
    if (humanWon) IFPD.confetti(3000);
    setTimeout(() => {
      if (S.phase !== 'over') return;
      IFPD.overlay.show({
        title: S.ai ? (winner === 0 ? 'You win!' : 'Computer wins') : `${names[winner]} wins!`,
        text,
        buttons: [
          { label: 'Play again', kind: 'good', onClick: () => startMatch(S.ai) },
          { label: 'Change mode', kind: 'primary', onClick: showMenu },
        ],
      });
    }, 700);
  }

  function playerNames() {
    return S.ai ? ['YOU', 'CPU ' + AI_LEVELS[S.ai].label.toUpperCase()] : ['BLUE', 'RED'];
  }

  // ---- physics ----
  function update(dt) {
    S.time += dt;
    if (S.flash > 0) S.flash = Math.max(0, S.flash - dt * 1.4);
    if (S.hint > 0) S.hint -= dt;
    if (S.msgT > 0) S.msgT -= dt;
    if (S.sndCool > 0) S.sndCool -= dt;
    if (S.phase === 'menu' || S.phase === 'over') {
      for (const m of S.mallets) { m.vx = m.vy = 0; }
      return;
    }

    // targets
    for (const m of S.mallets) {
      if (m.side === 1 && S.ai) continue;
      if (m.keys) continue;
      if (m.owner !== null) {
        const w = toWorld(m.fingerX, m.fingerY);
        m.tx = U.clamp(w.x, xMin(m.side), xMax(m.side));
        m.ty = U.clamp(w.y, MR, H - MR);
      } else { m.tx = m.x; m.ty = m.y; }
    }
    if (S.ai) aiThink(dt);

    const p = S.puck;
    const ps = Math.hypot(p.vx, p.vy);
    const n = U.clamp(Math.ceil((ps + MALLET_MAX) * dt / (PR * 0.45)), 1, 16);
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      for (const m of S.mallets) moveMallet(m, h);
      if (!p.visible) continue;
      p.x += p.vx * h; p.y += p.vy * h;
      for (const m of S.mallets) collideMallet(p, m);
      collideWalls(p);
      for (const m of S.mallets) separateMallet(p, m);
      if (p.x < -PR) { goal(1); break; }
      if (p.x > W + PR) { goal(0); break; }
    }

    if (p.visible) {
      const f = Math.exp(-FRICTION * dt);
      p.vx *= f; p.vy *= f;
      // Safety net: never let the puck escape the table (e.g. NaN or squeezed through).
      if (!isFinite(p.x) || !isFinite(p.y) || p.y < -PR || p.y > H + PR || p.x < -RAIL * 3 || p.x > W + RAIL * 3) placePuck(p.x > W / 2 ? 1 : 0);
      p.trail.push(p.x, p.y);
      if (p.trail.length > 24) p.trail.splice(0, 2);
      // stalled puck (corner / nobody can or does reach it)
      if (S.phase === 'play' && Math.hypot(p.vx, p.vy) < 30) {
        S.still += dt;
        if (S.still > 4) {
          placePuck(p.x < W / 2 ? 0 : 1);
          IFPD.sfx.play('whoosh', { volume: 0.5, pan: pan(p.x) });
          S.msg = 'Puck re-placed'; S.msgT = 1.6;
        }
      } else S.still = 0;
    } else p.trail.length = 0;

    if (S.phase === 'goal') {
      S.goalTimer -= dt;
      if (S.goalTimer <= 0) {
        if (S.score[S.goalBy] >= WIN_SCORE) finish();
        else { placePuck(1 - S.goalBy); S.phase = 'play'; IFPD.sfx.play('place', { pan: pan(S.puck.x) }); }
      }
    }
  }

  function moveMallet(m, h) {
    const ox = m.x, oy = m.y;
    if (m.side === 1 && S.ai) {
      const lv = AI_LEVELS[S.ai];
      let dx = m.tx - m.x, dy = m.ty - m.y;
      const d = Math.hypot(dx, dy);
      let dvx = 0, dvy = 0;
      if (d > 4) {
        const sp = Math.min(lv.speed, d / 0.09);
        dvx = dx / d * sp; dvy = dy / d * sp;
      }
      let ax = dvx - m.vx, ay = dvy - m.vy;
      const a = Math.hypot(ax, ay), amax = lv.accel * h;
      if (a > amax) { ax *= amax / a; ay *= amax / a; }
      const vx = m.vx + ax, vy = m.vy + ay;
      m.x += vx * h; m.y += vy * h;
    } else if (m.keys) {
      // Keyboard: accelerate toward the held direction up to KEY_SPEED, brake when released.
      // The mallet then really moves, so its velocity carries into the puck like a flick.
      const dir = keyDir(m.side);
      const tvx = dir ? dir.x * KEY_SPEED : 0, tvy = dir ? dir.y * KEY_SPEED : 0;
      let ax = tvx - m.kvx, ay = tvy - m.kvy;
      const a = Math.hypot(ax, ay), amax = (dir ? KEY_ACCEL : KEY_BRAKE) * h;
      if (a > amax) { ax *= amax / a; ay *= amax / a; }
      m.kvx += ax; m.kvy += ay;
      m.x += m.kvx * h; m.y += m.kvy * h;
      if (m.x < xMin(m.side) || m.x > xMax(m.side)) m.kvx = 0;
      if (m.y < MR || m.y > H - MR) m.kvy = 0;
    } else if (m.owner !== null) {
      const dx = m.tx - m.x, dy = m.ty - m.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.01) {
        const step = Math.min(d, Math.min(MALLET_MAX, d / FOLLOW_TAU) * h);
        m.x += dx / d * step; m.y += dy / d * step;
      }
    }
    m.x = U.clamp(m.x, xMin(m.side), xMax(m.side));
    m.y = U.clamp(m.y, MR, H - MR);
    m.vx = (m.x - ox) / h; m.vy = (m.y - oy) / h;
  }

  function capPuck(p) {
    const s = Math.hypot(p.vx, p.vy);
    if (s > PUCK_MAX) { p.vx *= PUCK_MAX / s; p.vy *= PUCK_MAX / s; }
  }

  function collideMallet(p, m) {
    let dx = p.x - m.x, dy = p.y - m.y;
    let d = Math.hypot(dx, dy);
    const min = PR + MR;
    if (d >= min) return;
    if (d < 1e-6) { dx = m.side === 0 ? 1 : -1; dy = 0; d = 1; }
    const nx = dx / d, ny = dy / d;
    p.x = m.x + nx * min; p.y = m.y + ny * min;
    let mvx = m.vx, mvy = m.vy;
    const ms = Math.hypot(mvx, mvy);
    if (ms > MALLET_HIT_CAP) { mvx *= MALLET_HIT_CAP / ms; mvy *= MALLET_HIT_CAP / ms; }
    const vn = (p.vx - mvx) * nx + (p.vy - mvy) * ny;
    if (vn < 0) {
      p.vx -= (1 + E_MALLET) * vn * nx;
      p.vy -= (1 + E_MALLET) * vn * ny;
      capPuck(p);
      if (-vn > 60) IFPD.sfx.play('hit', { volume: U.clamp(-vn / 2600, 0.15, 1), pitch: U.rand(0.95, 1.05), pan: pan(p.x) });
    }
  }

  function collideWalls(p) {
    for (const s of SEGS) {
      const [x1, y1, x2, y2] = s;
      const ex = x2 - x1, ey = y2 - y1;
      const t = U.clamp(((p.x - x1) * ex + (p.y - y1) * ey) / (ex * ex + ey * ey), 0, 1);
      const qx = x1 + ex * t, qy = y1 + ey * t;
      let dx = p.x - qx, dy = p.y - qy;
      let d = Math.hypot(dx, dy);
      if (d >= PR) continue;
      if (d < 1e-6) { // centre exactly on the rail line: push toward the table centre
        dx = W / 2 - p.x; dy = H / 2 - p.y; d = Math.hypot(dx, dy) || 1;
      }
      const nx = dx / d, ny = dy / d;
      p.x = qx + nx * PR; p.y = qy + ny * PR;
      const vn = p.vx * nx + p.vy * ny;
      if (vn < 0) {
        p.vx -= (1 + E_WALL) * vn * nx;
        p.vy -= (1 + E_WALL) * vn * ny;
        const post = t === 0 || t === 1;
        if (-vn > 90 && S.sndCool <= 0) {
          IFPD.sfx.play(post ? 'hit' : 'wall', { volume: U.clamp(-vn / 3000, 0.12, 0.9), pitch: post ? 1.4 : U.rand(0.95, 1.05), pan: pan(p.x) });
          S.sndCool = 0.03;
        }
      }
    }
  }

  // If the puck is jammed against a rail, the mallet cannot pass through it.
  function separateMallet(p, m) {
    const dx = m.x - p.x, dy = m.y - p.y;
    const d = Math.hypot(dx, dy), min = PR + MR - 0.5;
    if (d >= min || d < 1e-6) return;
    m.x = p.x + dx / d * min; m.y = p.y + dy / d * min;
    m.x = U.clamp(m.x, xMin(m.side), xMax(m.side));
    m.y = U.clamp(m.y, MR, H - MR);
  }

  const pan = x => U.clamp((x / W) * 2 - 1, -1, 1) * 0.85;

  // ---- computer player (right side, defends x = W, attacks x = 0) ----
  function predictY(p, xT) {
    if (p.vx <= 1) return null;
    const t = (xT - p.x) / p.vx;
    if (t < 0 || t > 3) return null;
    const lo = PR, span = H - 2 * PR;
    let k = (p.y + p.vy * t - lo) % (2 * span);
    if (k < 0) k += 2 * span;
    return lo + (k > span ? 2 * span - k : k);
  }

  function aiThink(dt) {
    const lv = AI_LEVELS[S.ai];
    const m = S.mallets[1], p = S.puck;
    aiState.timer -= dt;
    if (aiState.timer > 0) { m.tx = aiState.tx; m.ty = aiState.ty; return; }
    aiState.timer = lv.react * U.rand(0.8, 1.2);
    let tx, ty;
    const defX = W - MR - 90;
    if (!p.visible || S.phase !== 'play') {
      tx = W - 260; ty = H / 2;
    } else if (p.x > W / 2 - PR && !(p.vx > 1400 && p.x < W - 380)) {
      // Puck on our side and not screaming toward us: go and hit it.
      if (p.x > m.x - MR * 0.2) {
        // Puck is between us and our own goal: circle around it without pushing it in.
        const sideY = m.y < p.y ? -1 : 1;
        tx = Math.min(W - MR, p.x + PR + MR + 20);
        ty = p.y + sideY * (PR + MR + 25);
        if (Math.abs(m.y - p.y) > PR + MR && m.x > p.x - 10) ty = p.y + sideY * (PR + MR) * 0.6;
      } else {
        // Choose an aim point: straight at the goal or a bank shot off a side rail.
        let aimY = H / 2 + U.rand(-lv.aim, lv.aim);
        if (S.ai === 'hard' && Math.random() < 0.3) aimY = Math.random() < 0.5 ? -H / 2 : H * 1.5;
        let dx = -20 - p.x, dy = aimY - p.y;
        const d = Math.hypot(dx, dy); dx /= d; dy /= d;
        const ax = p.x - dx * (PR + MR + 30), ay = p.y - dy * (PR + MR + 30);
        const behind = (m.x - p.x) * -dx + (m.y - p.y) * -dy; // projection behind the puck
        const off = Math.hypot(m.x - ax, m.y - ay);
        if (off > 55 && behind < (PR + MR) * 0.8) { tx = ax; ty = ay; }
        else { tx = p.x + dx * 160 * lv.strike; ty = p.y + dy * 160 * lv.strike; }
      }
    } else if (p.vx > 50) {
      // Incoming: block on the defence line where the puck is predicted to cross.
      const py = predictY(p, defX);
      aiState.errY = U.rand(-lv.err, lv.err);
      ty = U.clamp((py == null ? p.y : py) + aiState.errY, GY0 - 70, GY1 + 70);
      tx = defX;
    } else {
      tx = W - 270;
      ty = U.lerp(H / 2, p.y, 0.45);
    }
    aiState.tx = U.clamp(tx, xMin(1), xMax(1));
    aiState.ty = U.clamp(ty, MR, H - MR);
    m.tx = aiState.tx; m.ty = aiState.ty;
  }

  // ---- rendering ----
  function buildStatic() {
    const { width: w, height: h, dpr } = view;
    const c = document.createElement('canvas');
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    // room
    const bg = g.createRadialGradient(w / 2, h * 0.55, h * 0.1, w / 2, h * 0.55, Math.max(w, h) * 0.75);
    bg.addColorStop(0, '#3a3d48'); bg.addColorStop(1, '#101116');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);

    const sc = L.sc;
    g.save();
    g.translate(L.ox, L.oy);
    g.scale(sc, sc);

    // cabinet shadow + body
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.65)'; g.shadowBlur = 60 * sc * 2; g.shadowOffsetY = 26 * sc * 2;
    g.fillStyle = '#16181f';
    IFPD.draw.roundRect(g, -RAIL - 14, -RAIL - 14, W + 2 * RAIL + 28, H + 2 * RAIL + 28, 70);
    g.fill();
    g.restore();

    // rails (glossy coloured aluminium with depth)
    const railCol = '#1d3f8a';
    const rg = g.createLinearGradient(0, -RAIL, 0, H + RAIL);
    rg.addColorStop(0, IFPD.draw.shade(railCol, 0.35));
    rg.addColorStop(0.08, railCol);
    rg.addColorStop(0.92, IFPD.draw.shade(railCol, -0.35));
    rg.addColorStop(1, IFPD.draw.shade(railCol, -0.6));
    g.fillStyle = rg;
    IFPD.draw.roundRect(g, -RAIL, -RAIL, W + 2 * RAIL, H + 2 * RAIL, 56);
    g.fill();
    // rail top highlight and chrome edge
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 3;
    IFPD.draw.roundRect(g, -RAIL + 4, -RAIL + 4, W + 2 * RAIL - 8, H + 2 * RAIL - 8, 52); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2;
    IFPD.draw.roundRect(g, -RAIL, -RAIL, W + 2 * RAIL, H + 2 * RAIL, 56); g.stroke();
    // decorative rail stripes per side colour
    for (const side of [0, 1]) {
      g.fillStyle = side ? 'rgba(224,54,43,0.85)' : 'rgba(31,111,224,0.9)';
      const x0 = side ? W / 2 + 40 : 60, x1 = side ? W - 60 : W / 2 - 40;
      g.fillRect(x0, -RAIL * 0.55, x1 - x0, 10);
      g.fillRect(x0, H + RAIL * 0.55 - 10, x1 - x0, 10);
    }
    // goal slots
    for (const side of [0, 1]) {
      const x = side ? W : -RAIL;
      const sg = g.createLinearGradient(side ? W : 0, 0, side ? W + RAIL : -RAIL, 0);
      sg.addColorStop(0, '#2a2c33'); sg.addColorStop(1, '#030305');
      g.fillStyle = sg;
      g.fillRect(x, GY0, RAIL, GOAL_W);
      g.fillStyle = 'rgba(255,255,255,0.15)';
      g.fillRect(x, GY0, RAIL, 3);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(x, GY1 - 3, RAIL, 3);
    }

    // playfield
    const ice = IFPD.texture.ice(W * sc, H * sc);
    g.drawImage(ice, 0, 0, W, H);

    // inner rail lip shadow on the ice
    const lip = 22;
    const edge = (x0, y0, x1, y1) => { const gg = g.createLinearGradient(x0, y0, x1, y1); gg.addColorStop(0, 'rgba(20,30,60,0.28)'); gg.addColorStop(1, 'rgba(20,30,60,0)'); return gg; };
    g.fillStyle = edge(0, 0, 0, lip); g.fillRect(0, 0, W, lip);
    g.fillStyle = edge(0, H, 0, H - lip * 0.6); g.fillRect(0, H - lip * 0.6, W, lip * 0.6);
    g.fillStyle = edge(0, 0, lip, 0); g.fillRect(0, 0, lip, H);
    g.fillStyle = edge(W, 0, W - lip, 0); g.fillRect(W - lip, 0, lip, H);

    // markings (clipped to the ice)
    g.save();
    g.beginPath(); g.rect(0, 0, W, H); g.clip();
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(214,40,40,0.85)';
    g.lineWidth = 12;
    g.beginPath(); g.moveTo(W / 2, 6); g.lineTo(W / 2, H - 6); g.stroke();
    g.lineWidth = 7;
    g.beginPath(); g.arc(W / 2, H / 2, 150, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(214,40,40,0.85)';
    g.beginPath(); g.arc(W / 2, H / 2, 16, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(30,90,200,0.75)';
    g.lineWidth = 7;
    for (const side of [0, 1]) {
      const gx = side ? W : 0;
      g.beginPath(); g.arc(gx, H / 2, 230, side ? Math.PI / 2 : -Math.PI / 2, side ? Math.PI * 1.5 : Math.PI / 2); g.stroke();
      g.fillStyle = 'rgba(30,90,200,0.10)';
      g.beginPath(); g.arc(gx, H / 2, 230, 0, Math.PI * 2); g.fill();
      // face-off spots
      g.strokeStyle = 'rgba(30,90,200,0.6)'; g.lineWidth = 5;
      g.beginPath(); g.arc(side ? W * 0.75 : W * 0.25, H / 2, 70, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 7; g.strokeStyle = 'rgba(30,90,200,0.75)';
      // quarter lines
      g.globalAlpha = 0.5;
      g.beginPath(); g.moveTo(side ? W - 520 : 520, 6); g.lineTo(side ? W - 520 : 520, H - 6); g.stroke();
      g.globalAlpha = 1;
    }
    g.restore();

    // air holes
    const step = 40;
    for (let y = step / 2; y < H; y += step) {
      for (let x = step / 2; x < W; x += step) {
        g.fillStyle = 'rgba(255,255,255,0.9)';
        g.beginPath(); g.arc(x + 1.2, y + 1.2, 3.4, 0, 6.283); g.fill();
        g.fillStyle = 'rgba(40,50,70,0.55)';
        g.beginPath(); g.arc(x, y, 3.2, 0, 6.283); g.fill();
      }
    }

    // ceiling-light reflections (gloss)
    for (const lx of [W * 0.27, W * 0.73]) {
      const gl = g.createRadialGradient(lx, H * 0.35, 10, lx, H * 0.35, 420);
      gl.addColorStop(0, 'rgba(255,255,255,0.35)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gl;
      g.beginPath(); g.ellipse(lx, H * 0.35, 420, 200, 0, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    staticCanvas = c;
  }

  function drawMallet(g, m) {
    const col = COLORS[m.side];
    const x = m.x, y = m.y;
    IFPD.draw.shadow(g, x + 16, y + 22, MR * 1.25, MR * 1.1, 0.4);
    // base disc
    const bg = g.createRadialGradient(x - MR * 0.3, y - MR * 0.35, MR * 0.1, x, y, MR);
    bg.addColorStop(0, IFPD.draw.shade(col, 0.35));
    bg.addColorStop(0.7, col);
    bg.addColorStop(1, IFPD.draw.shade(col, -0.5));
    g.fillStyle = bg;
    g.beginPath(); g.arc(x, y, MR, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2.5; g.stroke();
    // recessed inner ring
    const ig = g.createRadialGradient(x + MR * 0.15, y + MR * 0.2, MR * 0.1, x, y, MR * 0.74);
    ig.addColorStop(0, IFPD.draw.shade(col, -0.1));
    ig.addColorStop(1, IFPD.draw.shade(col, -0.45));
    g.fillStyle = ig;
    g.beginPath(); g.arc(x, y, MR * 0.74, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, MR * 0.74, Math.PI * 0.1, Math.PI * 0.9); g.stroke();
    // handle stem shadow and knob (raised, so drawn offset toward the viewer's light)
    IFPD.draw.shadow(g, x + 8, y + 10, MR * 0.5, MR * 0.45, 0.45);
    g.fillStyle = IFPD.draw.shade(col, -0.25);
    g.beginPath(); g.arc(x - 3, y - 5, MR * 0.36, 0, Math.PI * 2); g.fill();
    IFPD.draw.ball(g, x - 6, y - 12, MR * 0.42, col, 0.6);
    // grab highlight when held
    if (m.owner !== null || (m.keys && (m.kvx || m.kvy))) {
      g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 5;
      g.beginPath(); g.arc(x, y, MR + 9, 0, Math.PI * 2); g.stroke();
    }
  }

  function drawPuck(g, p) {
    const tr = p.trail, sp = Math.hypot(p.vx, p.vy);
    if (sp > 500 && tr.length >= 4) {
      const n = tr.length / 2;
      for (let i = 0; i < n - 1; i++) {
        const a = (i / n) * 0.12 * Math.min(1, (sp - 500) / 1500);
        g.fillStyle = `rgba(30,30,40,${a})`;
        g.beginPath(); g.arc(tr[i * 2], tr[i * 2 + 1], PR * (0.6 + 0.4 * i / n), 0, Math.PI * 2); g.fill();
      }
    }
    IFPD.draw.shadow(g, p.x + 8, p.y + 11, PR * 1.25, PR * 1.15, 0.45);
    const pg = g.createRadialGradient(p.x - PR * 0.35, p.y - PR * 0.4, 2, p.x, p.y, PR);
    pg.addColorStop(0, '#5a5e6a'); pg.addColorStop(0.6, '#24262d'); pg.addColorStop(1, '#0b0c10');
    g.fillStyle = pg;
    g.beginPath(); g.arc(p.x, p.y, PR, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 2.5;
    g.beginPath(); g.arc(p.x, p.y, PR * 0.68, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 3;
    g.beginPath(); g.arc(p.x, p.y, PR - 2, Math.PI * 1.05, Math.PI * 1.6); g.stroke();
    g.fillStyle = '#ffcc33';
    g.beginPath(); g.arc(p.x, p.y, PR * 0.18, 0, Math.PI * 2); g.fill();
  }

  function drawScoreboard(g) {
    const names = playerNames();
    const h = L.sbH - 8, cw = Math.min(L.w - 24, h * 9.5), x = (L.w - cw) / 2, y = 4;
    const pg = g.createLinearGradient(0, y, 0, y + h);
    pg.addColorStop(0, '#2b2e38'); pg.addColorStop(1, '#14151b');
    g.fillStyle = pg;
    IFPD.draw.roundRect(g, x, y, cw, h, h * 0.25); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 2; g.stroke();
    g.textBaseline = 'middle';
    const cy = y + h / 2;
    const big = Math.round(h * 0.82), small = Math.round(h * 0.36);
    // digits
    for (const side of [0, 1]) {
      const dx = L.w / 2 + (side ? 1 : -1) * h * 1.5;
      g.fillStyle = '#05060a';
      IFPD.draw.roundRect(g, dx - h * 0.6, y + h * 0.08, h * 1.2, h * 0.84, 8); g.fill();
      g.font = `700 ${big}px ${FONT}`;
      g.textAlign = 'center';
      g.shadowColor = COLORS[side]; g.shadowBlur = 18;
      g.fillStyle = side ? '#ff6b5e' : '#6aa8ff';
      g.fillText(String(S.score[side]), dx, cy + h * 0.04);
      g.shadowBlur = 0;
      g.font = `700 ${small}px ${FONT}`;
      g.textAlign = side ? 'left' : 'right';
      g.fillStyle = side ? '#ff8a7f' : '#8fbcff';
      g.fillText(names[side], dx + (side ? 1 : -1) * h * 0.9, cy);
    }
    g.textAlign = 'center';
    g.fillStyle = '#9aa0ad';
    g.font = `700 ${Math.round(h * 0.22)}px ${FONT}`;
    g.fillText('FIRST', L.w / 2, cy - h * 0.15);
    g.fillText('TO 7', L.w / 2, cy + h * 0.17);
  }

  function render() {
    const g = view.ctx;
    if (!staticCanvas || staticCanvas.width !== Math.round(view.width * view.dpr) || staticCanvas.height !== Math.round(view.height * view.dpr)) buildStatic();
    g.drawImage(staticCanvas, 0, 0, view.width, view.height);

    g.save();
    g.translate(L.ox, L.oy);
    g.scale(L.sc, L.sc);
    // hint text for players
    if (S.phase === 'play' && S.hint > 0) {
      g.globalAlpha = Math.min(1, S.hint) * 0.75;
      g.fillStyle = '#20325a';
      g.font = `600 44px ${FONT}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const kb = CosmiqInput.mode === 'keyboard';
      g.fillText(kb ? (S.ai ? 'W A S D or arrow keys' : 'W A S D to move') : 'Touch here to grab your mallet', W * 0.25, H * 0.15);
      if (!S.ai) g.fillText(kb ? 'Arrow keys to move' : 'Touch here to grab your mallet', W * 0.75, H * 0.15);
      g.globalAlpha = 1;
    }
    // goal flash on the conceding end
    if (S.flash > 0 && S.goalBy >= 0) {
      const gx = S.goalBy === 0 ? W : 0;
      const fg = g.createRadialGradient(gx, H / 2, 20, gx, H / 2, 900);
      fg.addColorStop(0, S.goalBy === 0 ? `rgba(60,140,255,${0.55 * S.flash})` : `rgba(255,70,50,${0.55 * S.flash})`);
      fg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = fg;
      g.fillRect(0, 0, W, H);
    }
    // clip to the ice plus the goal slots so the puck vanishes under the cabinet
    g.save();
    g.beginPath();
    g.rect(0, 0, W, H);
    g.rect(-RAIL, GY0, RAIL, GOAL_W);
    g.rect(W, GY0, RAIL, GOAL_W);
    g.clip();
    if (S.puck.visible && S.phase !== 'menu') drawPuck(g, S.puck);
    g.restore();
    for (const m of S.mallets) drawMallet(g, m);
    if (S.msgT > 0) {
      g.globalAlpha = Math.min(1, S.msgT * 2);
      g.font = `700 54px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      const tw = g.measureText(S.msg).width + 70;
      g.fillStyle = 'rgba(15,20,35,0.8)';
      IFPD.draw.roundRect(g, W / 2 - tw / 2, 60, tw, 90, 45); g.fill();
      g.fillStyle = '#fff'; g.fillText(S.msg, W / 2, 106);
      g.globalAlpha = 1;
    }

    if (S.phase === 'goal' && S.flash > 0) {
      g.globalAlpha = Math.min(1, S.flash * 1.6);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `800 ${200 + (1 - S.flash) * 60}px ${FONT}`;
      g.lineWidth = 12; g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.strokeText('GOAL!', W / 2, H / 2);
      g.fillStyle = S.goalBy === 0 ? '#1f5fd0' : '#d0302a';
      g.fillText('GOAL!', W / 2, H / 2);
      g.globalAlpha = 1;
    }
    g.restore();
    drawScoreboard(g);
  }

  const loop = IFPD.loop(update, render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && loop.paused) loop.resume(); });

  // debug hook for automated tests
  window.__game = { S, W, H, PR, MR, GY0, GY1, L, toWorld, startMatch, showMenu,
    toScreen: (x, y) => ({ x: L.ox + x * L.sc, y: L.oy + y * L.sc }) };

  showMenu();
})();
