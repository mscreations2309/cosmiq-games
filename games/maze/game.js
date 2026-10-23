/* Maze Runner — drag a steel ball through a wooden labyrinth. Solo or 2-player split-screen race. */
(function () {
  'use strict';

  const { util } = IFPD;
  const SIZES = {
    easy: { label: 'Easy', cells: 40 },
    medium: { label: 'Medium', cells: 96 },
    hard: { label: 'Hard', cells: 170 },
    expert: { label: 'Expert', cells: 260 },
  };
  const MODES = { solo: '1 Player', race: '2-Player Race' };
  const BALL_R = 0.27;      // ball radius (cell units)
  const WALL_T = 0.09;      // wall half thickness (cell units)
  const SUB = 0.05;         // max movement per collision sub-step (cell units) — far below BALL_R + WALL_T, so no tunnelling
  const MAX_STEP = 1.0;     // max ball travel per 1/120 s update (cell units)
  const HINT_PENALTY = 10;  // solo: seconds added
  const RACE_FREEZE = 4;    // race: seconds the ball is frozen while the path is shown
  const HINT_SHOW = 5;      // seconds the path stays visible
  const N = 1, E = 2, S = 4, W = 8;
  const PLAYER_COLORS = ['#2f7de1', '#e0453a'];

  let settings = { mode: 'solo', size: 'medium' };
  try { Object.assign(settings, JSON.parse(localStorage.getItem('maze-settings') || '{}')); } catch (_) { /* ignore */ }
  if (!SIZES[settings.size]) settings.size = 'medium';
  if (!MODES[settings.mode]) settings.mode = 'solo';

  const game = {
    phase: 'setup',   // setup | countdown | play | done
    mode: settings.mode,
    size: settings.size,
    maze: null,
    players: [],
    countdown: 0,
    time: 0,
    winner: -1,
    regions: [],
  };

  // ---------------------------------------------------------------- page
  const page = IFPD.setupPage({ title: 'Maze Runner', onRestart: () => newGame() });
  const stage = page.stage;
  const canvas = document.getElementById('game');
  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'ifpd-btn';
  settingsBtn.textContent = '⚙ Settings';
  settingsBtn.addEventListener('click', () => { IFPD.sfx.play('click'); showSetup(); });
  page.extra.append(settingsBtn);

  let staticLayer = document.createElement('canvas');
  let staticDirty = true;
  const view = IFPD.fitCanvas(canvas, () => { staticDirty = true; layout(); });
  const ctx = view.ctx;

  // ---------------------------------------------------------------- maze generation
  function generate(cols, rows) {
    const cells = new Uint8Array(cols * rows).fill(15);
    const seen = new Uint8Array(cols * rows);
    const dirs = [[0, -1, N, S], [1, 0, E, W], [0, 1, S, N], [-1, 0, W, E]];
    const first = util.randInt(0, cols * rows - 1);
    const stack = [first];
    seen[first] = 1;
    while (stack.length) {
      const c = stack[stack.length - 1], x = c % cols, y = (c / cols) | 0;
      const opts = [];
      for (const d of dirs) {
        const nx = x + d[0], ny = y + d[1];
        if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && !seen[ny * cols + nx]) opts.push(d);
      }
      if (!opts.length) { stack.pop(); continue; }
      const d = opts[Math.floor(Math.random() * opts.length)];
      const n = (y + d[1]) * cols + x + d[0];
      cells[c] &= ~d[2];
      cells[n] &= ~d[3];
      seen[n] = 1;
      stack.push(n);
    }
    const m = { cols, rows, cells };
    // Start and goal: the two ends of (approximately) the longest path in the maze.
    const a = farthest(m, util.randInt(0, cols * rows - 1));
    const b = farthest(m, a.cell);
    m.start = { x: a.cell % cols, y: (a.cell / cols) | 0 };
    m.goal = { x: b.cell % cols, y: (b.cell / cols) | 0 };
    m.pathLength = b.dist;
    return m;
  }

  function bfs(m, from) {
    const { cols, rows, cells } = m;
    const dist = new Int32Array(cols * rows).fill(-1);
    const prev = new Int32Array(cols * rows).fill(-1);
    const q = [from];
    dist[from] = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi], x = c % cols, y = (c / cols) | 0, w = cells[c];
      const next = [];
      if (!(w & N) && y > 0) next.push(c - cols);
      if (!(w & S) && y < rows - 1) next.push(c + cols);
      if (!(w & W) && x > 0) next.push(c - 1);
      if (!(w & E) && x < cols - 1) next.push(c + 1);
      for (const n of next) if (dist[n] < 0) { dist[n] = dist[c] + 1; prev[n] = c; q.push(n); }
    }
    return { dist, prev };
  }

  function farthest(m, from) {
    const { dist } = bfs(m, from);
    let best = from;
    for (let i = 0; i < dist.length; i++) if (dist[i] > dist[best]) best = i;
    return { cell: best, dist: dist[best] };
  }

  // Shortest path (list of cells) from cell (x,y) to the goal.
  function solve(m, x, y) {
    const from = y * m.cols + x, to = m.goal.y * m.cols + m.goal.x;
    const { dist, prev } = bfs(m, from);
    if (dist[to] < 0) return null;
    const path = [];
    for (let c = to; c !== -1; c = prev[c]) path.push({ x: c % m.cols, y: (c / m.cols) | 0 });
    return path.reverse();
  }

  // ---------------------------------------------------------------- collision (cell units)
  // Each wall is a capsule (segment of radius WALL_T); the ball is pushed out so it slides along walls.
  function pushOut(p, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const t = util.clamp(((p.x - x1) * dx + (p.y - y1) * dy) / (dx * dx + dy * dy), 0, 1);
    const qx = x1 + dx * t, qy = y1 + dy * t;
    let ox = p.x - qx, oy = p.y - qy;
    const d = Math.hypot(ox, oy), R = BALL_R + WALL_T;
    if (d >= R) return false;
    if (d < 1e-6) { ox = -dy; oy = dx; } // degenerate: push perpendicular
    const len = Math.hypot(ox, oy);
    p.x = qx + (ox / len) * R;
    p.y = qy + (oy / len) * R;
    return true;
  }

  function collide(m, p) {
    let hit = false;
    for (let it = 0; it < 4; it++) {
      let moved = false;
      const cx = Math.floor(p.x), cy = Math.floor(p.y);
      for (let y = cy - 1; y <= cy + 1; y++) {
        if (y < 0 || y >= m.rows) continue;
        for (let x = cx - 1; x <= cx + 1; x++) {
          if (x < 0 || x >= m.cols) continue;
          const w = m.cells[y * m.cols + x];
          if (w & N) moved = pushOut(p, x, y, x + 1, y) || moved;
          if (w & S) moved = pushOut(p, x, y + 1, x + 1, y + 1) || moved;
          if (w & W) moved = pushOut(p, x, y, x, y + 1) || moved;
          if (w & E) moved = pushOut(p, x + 1, y, x + 1, y + 1) || moved;
        }
      }
      if (!moved) break;
      hit = true;
    }
    // Belt and braces: never leave the box.
    p.x = util.clamp(p.x, BALL_R + WALL_T, m.cols - BALL_R - WALL_T);
    p.y = util.clamp(p.y, BALL_R + WALL_T, m.rows - BALL_R - WALL_T);
    return hit;
  }

  // ---------------------------------------------------------------- game state
  function makePlayer(i) {
    const m = game.maze;
    const hud = document.createElement('div');
    hud.className = 'maze-hud';
    hud.innerHTML = '<span class="who"></span><span class="time">0:00.0</span><span class="info"></span><span class="spacer"></span><button class="ifpd-btn">💡 Show path</button>';
    const who = hud.querySelector('.who');
    if (game.mode === 'race') {
      who.textContent = 'Player ' + (i + 1);
      who.style.background = PLAYER_COLORS[i];
    } else {
      who.textContent = SIZES[game.size].label;
      who.style.background = '#6b4a2b';
    }
    const btn = hud.querySelector('button');
    btn.innerHTML = '💡 <span class="long"></span><span class="short">Path</span>';
    btn.querySelector('.long').textContent = game.mode === 'race' ? `Path (freeze ${RACE_FREEZE}s)` : `Show path (+${HINT_PENALTY}s)`;
    btn.addEventListener('click', () => showHint(i));
    stage.append(hud);
    return {
      i, hud, timeEl: hud.querySelector('.time'), infoEl: hud.querySelector('.info'), hintBtn: btn,
      x: m.start.x + 0.5, y: m.start.y + 0.5, tx: 0, ty: 0,
      holder: null, offX: 0, offY: 0, trail: [],
      finished: false, time: 0, penalty: 0, frozen: 0,
      hintPath: null, hintT: 0, ringT: 0, contact: false, lastBump: 0, hints: 0,
      lastShown: '',
    };
  }

  function clearPlayers() {
    for (const p of game.players) p.hud.remove();
    game.players = [];
  }

  function regionAvail(mode) {
    const Wd = view.width, H = view.height, n = mode === 'race' ? 2 : 1;
    const hud = util.clamp(H * 0.08, 58, 80);
    const rw = Wd / n;
    const pad = util.clamp(Math.min(rw, H) * 0.02, 8, 24);
    return { n, hud, rw, pad, availW: rw - 2 * pad, availH: H - hud - 2 * pad };
  }

  function newGame() {
    IFPD.overlay.hide();
    closeSetup();
    game.mode = settings.mode;
    game.size = settings.size;
    const a = regionAvail(game.mode);
    const frame = util.clamp(Math.min(a.availW, a.availH) * 0.035, 12, 36);
    const aspect = Math.max(0.4, (a.availW - 2 * frame) / Math.max(1, a.availH - 2 * frame));
    const target = SIZES[game.size].cells * (game.mode === 'race' ? 0.8 : 1);
    const cols = Math.max(4, Math.round(Math.sqrt(target * aspect)));
    const rows = Math.max(4, Math.round(target / cols));
    game.maze = generate(cols, rows);
    clearPlayers();
    const n = game.mode === 'race' ? 2 : 1;
    for (let i = 0; i < n; i++) game.players.push(makePlayer(i));
    game.phase = 'countdown';
    game.countdown = 3;
    game.time = 0;
    game.winner = -1;
    game.id = (game.id || 0) + 1;
    staticDirty = true;
    layout();
    updateHud(true);
    IFPD.sfx.play('whoosh');
    IFPD.sfx.play('tick', { volume: 3, pitch: 0.5 });
  }

  // ---------------------------------------------------------------- layout
  function layout() {
    game.regions = [];
    if (!game.maze) return;
    const a = regionAvail(game.mode), m = game.maze;
    for (let i = 0; i < a.n; i++) {
      const rx = i * a.rw;
      const frame = util.clamp(Math.min(a.availW, a.availH) * 0.035, 12, 36);
      const cell = Math.max(4, Math.min((a.availW - 2 * frame) / m.cols, (a.availH - 2 * frame) / m.rows));
      const mw = cell * m.cols, mh = cell * m.rows;
      const ox = rx + (a.rw - mw) / 2;
      const oy = a.hud + a.pad + (a.availH - mh) / 2;
      game.regions.push({ x: rx, w: a.rw, ox, oy, cell, frame, mw, mh });
      const p = game.players[i];
      if (p) {
        Object.assign(p.hud.style, {
          left: (ox - frame) + 'px', top: Math.max(4, oy - frame - a.hud + 4) + 'px',
          width: (mw + 2 * frame) + 'px', height: (a.hud - 8) + 'px',
        });
        p.hud.classList.toggle('narrow', mw + 2 * frame < 820);
        p.hud.classList.toggle('tiny', mw + 2 * frame < 560);
      }
    }
  }

  // ---------------------------------------------------------------- input
  const toMaze = (r, x, y) => ({ x: (x - r.ox) / r.cell, y: (y - r.oy) / r.cell });
  const grabRadius = r => Math.max(BALL_R * 2.3, 52 / r.cell);

  function regionAt(x) {
    for (let i = 0; i < game.regions.length; i++) {
      const r = game.regions[i];
      if (x >= r.x && x < r.x + r.w) return i;
    }
    return game.regions.length ? game.regions.length - 1 : -1;
  }

  function tryGrab(pl, r, ptr) {
    const f = toMaze(r, ptr.x, ptr.y);
    if (Math.hypot(f.x - pl.x, f.y - pl.y) > grabRadius(r)) return false;
    pl.holder = ptr.id;
    pl.offX = pl.x - f.x;
    pl.offY = pl.y - f.y;
    pl.tx = pl.x; pl.ty = pl.y;
    pl.trail.length = 0;
    IFPD.sfx.play('tap', { volume: 0.6, pan: panOf(pl) });
    return true;
  }

  IFPD.pointers(canvas, {
    down(ptr) {
      const i = regionAt(ptr.x);
      ptr.data.player = i;
      const pl = game.players[i], r = game.regions[i];
      if (!pl || !r) return;
      const live = game.phase === 'play' || game.phase === 'countdown'; // fingers may rest on the ball before GO
      if (!live || pl.finished) { IFPD.sfx.play('click', { volume: 0.4 }); return; }
      if (pl.holder == null && !tryGrab(pl, r, ptr)) {
        pl.ringT = 2.5; // show where the ball is
        IFPD.sfx.play('click', { volume: 0.5, pitch: 0.7 });
      }
    },
    move(ptr, e) {
      const pl = game.players[ptr.data.player], r = game.regions[ptr.data.player];
      if (!pl || !r || (game.phase !== 'play' && game.phase !== 'countdown') || pl.finished) return;
      // Chrome merges pointermoves per frame; use every intermediate sample so the trail keeps its corners.
      const rect = canvas.getBoundingClientRect();
      let samples = e && e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (!samples.length) samples = [{ clientX: ptr.x + rect.left, clientY: ptr.y + rect.top }];
      for (const ev of samples) {
        const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
        if (pl.holder === ptr.id) {
          const f = toMaze(r, sx, sy);
          pl.tx = f.x + pl.offX;
          pl.ty = f.y + pl.offY;
          pl.trail.push({ x: pl.tx, y: pl.ty });
        } else if (pl.holder == null) {
          tryGrab(pl, r, { id: ptr.id, x: sx, y: sy }); // the finger came back to the ball
        }
      }
      if (pl.trail.length > 600) pl.trail.splice(0, pl.trail.length - 600);
    },
    up(ptr) {
      const pl = game.players[ptr.data.player];
      if (pl && pl.holder === ptr.id) pl.holder = null;
    },
  });

  const panOf = pl => game.mode === 'race' ? (pl.i === 0 ? -0.6 : 0.6) : 0;

  function showHint(i) {
    const pl = game.players[i];
    if (!pl || game.phase !== 'play' || pl.finished) return;
    const path = solve(game.maze, Math.floor(pl.x), Math.floor(pl.y));
    if (!path) return;
    pl.hintPath = path;
    pl.hintT = HINT_SHOW;
    pl.hints++;
    if (game.mode === 'race') {
      pl.frozen = RACE_FREEZE;
      pl.holder = null;
      IFPD.toast(`Player ${i + 1}: path shown — frozen for ${RACE_FREEZE} s`);
    } else {
      pl.penalty += HINT_PENALTY;
      IFPD.toast(`Path shown: +${HINT_PENALTY} s penalty`);
    }
    IFPD.sfx.play('ding', { pan: panOf(pl) });
  }

  // ---------------------------------------------------------------- simulation
  // The ball follows the finger's trail point by point (so it goes round corners even when frames lag),
  // moving in tiny collision-checked sub-steps. Points it cannot reach (inside/behind a wall) are skipped.
  function moveBall(pl, r, dt) {
    const m = game.maze;
    const p = { x: pl.x, y: pl.y };
    let budget = MAX_STEP, hit = false, blocked = false, travelled = 0;
    while (pl.trail.length && budget > 1e-4) {
      const tp = pl.trail[0];
      let dx = tp.x - p.x, dy = tp.y - p.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.01) { pl.trail.shift(); continue; }
      const go = Math.min(len, budget);
      dx *= go / len; dy *= go / len;
      const steps = Math.max(1, Math.ceil(go / SUB));
      const sx = p.x, sy = p.y;
      let h = false;
      for (let s = 0; s < steps; s++) {
        p.x += dx / steps;
        p.y += dy / steps;
        if (collide(m, p)) h = true;
      }
      const moved = Math.hypot(p.x - sx, p.y - sy);
      travelled += moved;
      budget -= go;
      if (h) hit = true;
      if (go >= len - 1e-6) pl.trail.shift();          // reached (or as close as walls allow)
      else if (h && moved < go * 0.5) { pl.trail.shift(); blocked = true; } // can't get there: skip it
      if (h && moved < go * 0.5) blocked = true;
    }
    pl.x = p.x; pl.y = p.y;
    const speed = travelled / dt;
    if (hit && !pl.contact && speed > 1.5) {
      const now = performance.now();
      if (now - pl.lastBump > 110) {
        pl.lastBump = now;
        IFPD.sfx.play('wall', { volume: util.clamp(speed / 25, 0.25, 1), pitch: util.rand(0.9, 1.15), pan: panOf(pl) });
      }
    }
    pl.contact = hit;
    // Finger got too far from the ball because a wall is in the way: the ball stays; the finger must come back to it.
    const lose = Math.max(0.95, 60 / r.cell);
    const gap = Math.hypot(pl.tx - pl.x, pl.ty - pl.y);
    if (gap > lose && (blocked || (hit && !pl.trail.length))) {
      pl.holder = null;
      pl.trail.length = 0;
      pl.ringT = 2.5;
      IFPD.sfx.play('click', { volume: 0.5, pitch: 0.6, pan: panOf(pl) });
    }
  }

  function update(dt) {
    if (setupEl) return; // paused while the settings card is open
    if (game.phase === 'countdown') {
      const before = Math.ceil(game.countdown);
      game.countdown -= dt;
      const after = Math.ceil(game.countdown);
      if (game.countdown <= 0) {
        game.phase = 'play';
        IFPD.sfx.play('ding');
      } else if (after !== before) {
        IFPD.sfx.play('tick', { volume: 3, pitch: 0.5 });
      }
      return;
    }
    if (game.phase !== 'play') return;
    game.time += dt;
    const m = game.maze, arrived = [];
    for (const pl of game.players) {
      if (pl.ringT > 0) pl.ringT -= dt;
      if (pl.hintT > 0) pl.hintT -= dt;
      if (pl.finished) continue;
      pl.time += dt;
      const r = game.regions[pl.i];
      if (pl.frozen > 0) { pl.frozen -= dt; continue; }
      if (pl.holder != null && r) moveBall(pl, r, dt);
      if (Math.hypot(pl.x - (m.goal.x + 0.5), pl.y - (m.goal.y + 0.5)) < 0.3) arrived.push(pl);
    }
    if (arrived.length) finish(arrived);
    updateHud(false);
  }

  function finish(arrived) {
    const gameId = game.id;
    const later = fn => setTimeout(() => { if (game.id === gameId) fn(); }, 700); // ignore if restarted meanwhile
    for (const pl of arrived) { pl.finished = true; pl.holder = null; IFPD.sfx.play('goal', { pan: panOf(pl) }); }
    for (const o of game.players) o.holder = null;
    game.phase = 'done';
    const pl = arrived[0];
    if (game.mode === 'solo') {
      const total = pl.time + pl.penalty;
      const key = 'maze-' + game.size;
      const prev = IFPD.best.get(key);
      const record = IFPD.best.submit(key, Math.round(total * 1000), false);
      updateHud(true);
      later(() => {
        IFPD.confetti(3000);
        IFPD.sfx.play('win');
        IFPD.overlay.show({
          title: record ? '🏆 New best time!' : '⭐ You escaped!',
          text: `${SIZES[game.size].label} maze — ${fmt(total)}` +
            (pl.penalty ? `
(includes ${pl.penalty} s hint penalty)` : '') +
            (!record && prev != null ? `
Best: ${fmt(prev / 1000)}` : ''),
          buttons: [
            { label: '▶ Play again', kind: 'primary', onClick: () => newGame() },
            { label: '⚙ Settings', kind: 'plain', onClick: () => showSetup() },
          ],
        });
      });
    } else {
      // Race: first to arrive wins (both in the same 1/120 s step = tie).
      const tie = arrived.length > 1;
      game.winner = tie ? 2 : pl.i;
      updateHud(true);
      later(() => {
        IFPD.confetti(3000);
        IFPD.sfx.play('win');
        IFPD.overlay.show({
          title: tie ? '🤝 Dead heat — a tie!' : `🏁 Player ${pl.i + 1} wins!`,
          text: `Reached the star in ${fmt(pl.time)}` + (!tie && pl.hints ? ` (used ${pl.hints} hint${pl.hints > 1 ? 's' : ''})` : ''),
          buttons: [
            { label: '▶ Rematch (new maze)', kind: 'primary', onClick: () => newGame() },
            { label: '⚙ Settings', kind: 'plain', onClick: () => showSetup() },
          ],
        });
      });
    }
  }

  function fmt(sec) {
    sec = Math.max(0, sec);
    const m = Math.floor(sec / 60), s = sec - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }

  function updateHud(force) {
    for (const pl of game.players) {
      const shown = fmt(pl.time + pl.penalty);
      if (force || shown !== pl.lastShown) { pl.timeEl.textContent = shown; pl.lastShown = shown; }
      if (force) {
        let info = '';
        if (game.mode === 'solo') {
          const b = IFPD.best.get('maze-' + game.size);
          info = b != null ? 'Best ' + fmt(b / 1000) : 'No best time yet';
        } else if (game.phase === 'done') {
          info = game.winner === 2 ? '🤝 Tie!' : game.winner === pl.i ? '🏆 Winner!' : 'Finished second';
        } else {
          info = 'Same maze — race!';
        }
        pl.infoEl.textContent = info;
      }
      pl.hintBtn.disabled = game.phase !== 'play' || pl.finished;
    }
  }

  // ---------------------------------------------------------------- rendering
  let woodPattern = null;

  function renderStatic() {
    staticDirty = false;
    const { width: Wd, height: H, dpr } = view;
    staticLayer.width = Math.round(Wd * dpr);
    staticLayer.height = Math.round(H * dpr);
    const c = staticLayer.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, Wd, H);
    if (!game.maze) return;
    const m = game.maze;
    if (!woodPattern) woodPattern = c.createPattern(IFPD.texture.wood(512, 512, { base: '#d6a568', dark: '#8a5a2b' }), 'repeat');
    for (const r of game.regions) drawBox(c, m, r);
  }

  function drawBox(c, m, r) {
    const { ox, oy, cell, frame: F, mw, mh } = r;
    const bx = ox - F, by = oy - F, bw = mw + 2 * F, bh = mh + 2 * F;
    // table shadow under the box
    c.save();
    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.filter = `blur(${Math.round(F * 0.9)}px)`;
    IFPD.draw.roundRect(c, bx + F * 0.2, by + F * 0.5, bw, bh, F * 0.5);
    c.fill();
    c.restore();

    // outer frame: dark stained wood with bevel
    const frameTex = IFPD.texture.wood(Math.ceil(bw), Math.ceil(bh), { base: '#6e4524', dark: '#3e230e' });
    c.save();
    IFPD.draw.roundRect(c, bx, by, bw, bh, F * 0.45);
    c.clip();
    c.drawImage(frameTex, bx, by);
    let g = c.createLinearGradient(bx, by, bx, by + bh);
    g.addColorStop(0, 'rgba(255,230,190,0.22)');
    g.addColorStop(0.5, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    c.fillStyle = g;
    c.fillRect(bx, by, bw, bh);
    c.restore();
    c.save();
    c.lineWidth = 2;
    c.strokeStyle = 'rgba(255,225,180,0.35)';
    IFPD.draw.roundRect(c, bx + 1.5, by + 1.5, bw - 3, bh - 3, F * 0.45);
    c.stroke();
    c.restore();

    // base board (lighter wood) sunk into the frame
    const baseTex = IFPD.texture.wood(Math.ceil(mw), Math.ceil(mh), { base: '#c99a5e', dark: '#8f6233', planks: Math.max(2, Math.round(mh / 160)) });
    c.drawImage(baseTex, ox, oy);
    // inner shadow cast by the frame (light from top-left)
    c.save();
    c.beginPath();
    c.rect(ox, oy, mw, mh);
    c.clip();
    c.shadowColor = 'rgba(0,0,0,0.65)';
    c.shadowBlur = F * 0.8;
    c.shadowOffsetX = F * 0.15;
    c.shadowOffsetY = F * 0.25;
    c.lineWidth = F;
    c.strokeStyle = '#000';
    c.strokeRect(ox - F / 2, oy - F / 2, mw + F, mh + F);
    c.restore();
    // bevel line around the opening
    c.strokeStyle = 'rgba(255,220,170,0.25)';
    c.lineWidth = 1.5;
    c.strokeRect(ox - 1, oy - 1, mw + 2, mh + 2);

    // start marker: engraved ring
    const sx = ox + (m.start.x + 0.5) * cell, sy = oy + (m.start.y + 0.5) * cell;
    c.save();
    c.lineWidth = Math.max(2, cell * 0.06);
    c.strokeStyle = 'rgba(60,30,8,0.55)';
    c.beginPath(); c.arc(sx, sy, cell * 0.36, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(255,230,190,0.35)';
    c.lineWidth = 1;
    c.beginPath(); c.arc(sx + 1, sy + 1, cell * 0.36 + c.lineWidth, 0.2, 2.6); c.stroke();
    c.fillStyle = 'rgba(60,30,8,0.18)';
    c.beginPath(); c.arc(sx, sy, cell * 0.33, 0, Math.PI * 2); c.fill();
    c.restore();

    // walls: merge collinear wall edges into runs
    const runs = [];
    for (let y = 0; y <= m.rows; y++) {
      let start = -1;
      for (let x = 0; x <= m.cols; x++) {
        const has = x < m.cols && (y < m.rows ? (m.cells[y * m.cols + x] & N) : (m.cells[(y - 1) * m.cols + x] & S));
        if (has && start < 0) start = x;
        if (!has && start >= 0) { runs.push([start, y, x, y]); start = -1; }
      }
    }
    for (let x = 0; x <= m.cols; x++) {
      let start = -1;
      for (let y = 0; y <= m.rows; y++) {
        const has = y < m.rows && (x < m.cols ? (m.cells[y * m.cols + x] & W) : (m.cells[y * m.cols + x - 1] & E));
        if (has && start < 0) start = y;
        if (!has && start >= 0) { runs.push([x, start, x, y]); start = -1; }
      }
    }
    const wallPx = WALL_T * 2 * cell;
    const trace = (dx, dy) => {
      c.beginPath();
      for (const [x1, y1, x2, y2] of runs) {
        c.moveTo(ox + x1 * cell + dx, oy + y1 * cell + dy);
        c.lineTo(ox + x2 * cell + dx, oy + y2 * cell + dy);
      }
    };
    c.save();
    c.beginPath(); c.rect(ox - wallPx, oy - wallPx, mw + 2 * wallPx, mh + 2 * wallPx); c.clip();
    c.lineCap = 'square';
    // cast shadow
    c.save();
    c.filter = `blur(${Math.max(1, cell * 0.05).toFixed(1)}px)`;
    c.strokeStyle = 'rgba(25,10,0,0.5)';
    c.lineWidth = wallPx * 1.1;
    trace(cell * 0.07, cell * 0.11);
    c.stroke();
    c.restore();
    // side faces (the visible height of the wall)
    const h = Math.max(1.5, cell * 0.045);
    c.strokeStyle = '#5b3818';
    c.lineWidth = wallPx;
    for (let k = h; k > 0; k -= 1) { trace(k * 0.6, k); c.stroke(); }
    // top faces with grain
    c.strokeStyle = woodPattern;
    trace(0, 0);
    c.stroke();
    // soft top-left highlight and bottom-right edge darkening
    c.strokeStyle = 'rgba(255,238,205,0.38)';
    c.lineWidth = Math.max(1, wallPx * 0.28);
    trace(-wallPx * 0.3, -wallPx * 0.3);
    c.stroke();
    c.strokeStyle = 'rgba(70,35,10,0.35)';
    trace(wallPx * 0.33, wallPx * 0.33);
    c.stroke();
    c.restore();
  }

  function drawStar(c, x, y, R, rIn, rot) {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = rot + (i * Math.PI) / 5 - Math.PI / 2, rr = i % 2 ? rIn : R;
      c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    c.closePath();
  }

  function drawGoal(c, r, t) {
    const m = game.maze, cell = r.cell;
    const x = r.ox + (m.goal.x + 0.5) * cell, y = r.oy + (m.goal.y + 0.5) * cell;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    const glowR = cell * (0.7 + 0.15 * pulse);
    const g = c.createRadialGradient(x, y, 0, x, y, glowR);
    g.addColorStop(0, `rgba(255,236,140,${0.75 + 0.2 * pulse})`);
    g.addColorStop(0.45, 'rgba(255,190,40,0.35)');
    g.addColorStop(1, 'rgba(255,170,0,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, glowR, 0, Math.PI * 2); c.fill();
    const R = cell * 0.33, rot = Math.sin(t * 1.3) * 0.15;
    IFPD.draw.shadow(c, x + cell * 0.06, y + cell * 0.09, R, R * 0.85, 0.35);
    const sg = c.createLinearGradient(x - R, y - R, x + R, y + R);
    sg.addColorStop(0, '#fff6c2');
    sg.addColorStop(0.45, '#ffcf33');
    sg.addColorStop(1, '#c47f00');
    c.fillStyle = sg;
    drawStar(c, x, y, R, R * 0.45, rot);
    c.fill();
    c.lineWidth = Math.max(1, cell * 0.025);
    c.strokeStyle = '#8a5600';
    c.stroke();
    // sparkle
    c.fillStyle = `rgba(255,255,255,${0.5 + 0.5 * pulse})`;
    drawStar(c, x - R * 0.2, y - R * 0.3, R * 0.18, R * 0.05, t);
    c.fill();
  }

  function drawPath(c, r, pl, t) {
    if (!pl.hintPath || pl.hintT <= 0) return;
    const cell = r.cell;
    const alpha = Math.min(1, pl.hintT / 0.6);
    c.save();
    c.globalAlpha = alpha;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    pl.hintPath.forEach((p, i) => {
      const x = r.ox + (p.x + 0.5) * cell, y = r.oy + (p.y + 0.5) * cell;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    });
    c.shadowColor = 'rgba(255,200,40,0.9)';
    c.shadowBlur = cell * 0.25;
    c.strokeStyle = 'rgba(255,214,90,0.55)';
    c.lineWidth = cell * 0.16;
    c.stroke();
    c.shadowBlur = 0;
    c.setLineDash([cell * 0.12, cell * 0.22]);
    c.lineDashOffset = -t * cell * 1.6;
    c.strokeStyle = '#fff7d0';
    c.lineWidth = cell * 0.07;
    c.stroke();
    c.restore();
  }

  function drawBall(c, x, y, rad) {
    IFPD.draw.shadow(c, x + rad * 0.35, y + rad * 0.5, rad * 1.15, rad * 0.95, 0.55);
    const g = c.createRadialGradient(x - rad * 0.3, y - rad * 0.38, rad * 0.04, x, y, rad);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.15, '#e8edf2');
    g.addColorStop(0.5, '#9aa4ae');
    g.addColorStop(0.82, '#4c545d');
    g.addColorStop(1, '#22272c');
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.fill();
    c.save();
    c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.clip();
    // reflected room above / reflected wooden board below the "horizon"
    const e = c.createLinearGradient(x, y - rad, x, y + rad);
    e.addColorStop(0, 'rgba(255,255,255,0.10)');
    e.addColorStop(0.5, 'rgba(255,255,255,0)');
    e.addColorStop(0.53, 'rgba(40,25,10,0.45)');
    e.addColorStop(0.62, 'rgba(160,105,55,0.35)');
    e.addColorStop(1, 'rgba(120,75,35,0.30)');
    c.fillStyle = e;
    c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    // window reflection
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.beginPath();
    c.ellipse(x - rad * 0.32, y - rad * 0.42, rad * 0.3, rad * 0.17, -0.6, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.95)';
    c.beginPath(); c.arc(x - rad * 0.38, y - rad * 0.45, rad * 0.09, 0, Math.PI * 2); c.fill();
    c.restore();
    // rim light (bounce from the board)
    c.strokeStyle = 'rgba(255,225,190,0.35)';
    c.lineWidth = Math.max(1, rad * 0.08);
    c.beginPath(); c.arc(x, y, rad * 0.92, 0.2, 1.5); c.stroke();
    c.strokeStyle = 'rgba(0,0,0,0.5)';
    c.lineWidth = 1;
    c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.stroke();
  }

  function render() {
    const t = performance.now() / 1000;
    ctx.clearRect(0, 0, view.width, view.height);
    if (!game.maze || !game.regions.length) return;
    if (staticDirty) renderStatic();
    ctx.drawImage(staticLayer, 0, 0, view.width, view.height);
    game.regions.forEach((r, i) => {
      const pl = game.players[i];
      if (!pl) return;
      ctx.save();
      ctx.beginPath(); ctx.rect(r.ox, r.oy, r.mw, r.mh); ctx.clip();
      drawGoal(ctx, r, t);
      drawPath(ctx, r, pl, t);
      const bx = r.ox + pl.x * r.cell, by = r.oy + pl.y * r.cell, rad = BALL_R * r.cell;
      // hint ring: "put your finger on the ball"
      const showRing = game.phase === 'play' && !pl.finished && pl.holder == null && pl.frozen <= 0;
      if (showRing) {
        const ph = (t * 1.2) % 1;
        const strong = pl.ringT > 0 ? 1 : 0.45;
        ctx.strokeStyle = `rgba(120,220,255,${(1 - ph) * 0.9 * strong})`;
        ctx.lineWidth = Math.max(2, r.cell * 0.06);
        ctx.beginPath(); ctx.arc(bx, by, rad * (1.3 + ph * 1.6), 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = `rgba(120,220,255,${0.55 * strong})`;
        ctx.beginPath(); ctx.arc(bx, by, rad * 1.35, 0, Math.PI * 2); ctx.stroke();
      }
      if (pl.holder != null) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath(); ctx.arc(bx, by, rad * 1.6, 0, Math.PI * 2); ctx.fill();
      }
      drawBall(ctx, bx, by, rad);
      if (pl.frozen > 0 && game.phase === 'play') {
        ctx.strokeStyle = 'rgba(160,220,255,0.9)';
        ctx.lineWidth = Math.max(2, r.cell * 0.05);
        ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.arc(bx, by, rad * 1.5, -Math.PI / 2, -Math.PI / 2 + (pl.frozen / RACE_FREEZE) * Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();

      // countdown / finish banners
      const cx = r.ox + r.mw / 2, cy = r.oy + r.mh / 2;
      if (game.phase === 'countdown') banner(cx, cy, String(Math.ceil(game.countdown)), Math.min(r.mw, r.mh) * 0.35, 1 - (Math.ceil(game.countdown) - game.countdown));
      else if (game.phase === 'play' && game.time < 0.8) banner(cx, cy, 'GO!', Math.min(r.mw, r.mh) * 0.3, 1 - game.time / 0.8);
      else if (game.phase === 'done' && game.mode === 'race') {
        banner(cx, cy, game.winner === 2 ? 'TIE!' : game.winner === i ? 'WINNER!' : '2nd', Math.min(r.mw * 0.18, r.mh * 0.2), 1);
      }
    });
  }

  function banner(x, y, text, size, alpha) {
    ctx.save();
    ctx.globalAlpha = util.clamp(alpha, 0, 1);
    ctx.font = `900 ${Math.round(size)}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(4, size * 0.08);
    ctx.strokeStyle = 'rgba(40,20,5,0.85)';
    ctx.strokeText(text, x, y);
    const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    g.addColorStop(0, '#fff3c4');
    g.addColorStop(1, '#ffb703');
    ctx.fillStyle = g;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = size * 0.1;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // ---------------------------------------------------------------- setup screen
  let setupEl = null;
  function closeSetup() { if (setupEl) { setupEl.remove(); setupEl = null; } }

  function showSetup() {
    IFPD.overlay.hide();
    closeSetup();
    for (const pl of game.players) pl.holder = null;
    const o = document.createElement('div');
    o.className = 'ifpd-overlay';
    o.innerHTML = `<div class="ifpd-card maze-setup">
      <h2>🧭 Maze Runner</h2>
      <p>Put a finger on the steel ball and guide it to the gold star.\nThe ball can't go through walls — if you lose it, touch it again.</p>
      <div class="row"><label>Players</label><div class="seg" data-k="mode"></div></div>
      <div class="row"><label>Maze size</label><div class="seg" data-k="size"></div></div>
      <div class="best"></div>
      <div class="ifpd-buttons"><button class="ifpd-btn primary" data-act="go">▶ Start</button></div></div>`;
    const fill = (k, opts) => {
      const box = o.querySelector(`[data-k=${k}]`);
      for (const [v, label] of Object.entries(opts)) {
        const b = document.createElement('button');
        b.className = 'ifpd-btn' + (settings[k] === v ? ' on' : '');
        b.textContent = label;
        b.dataset.v = v;
        b.addEventListener('click', () => {
          settings[k] = v;
          box.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.v === v));
          IFPD.sfx.play('click');
          showBest();
        });
        box.append(b);
      }
    };
    const showBest = () => {
      const b = IFPD.best.get('maze-' + settings.size);
      o.querySelector('.best').textContent = settings.mode === 'solo'
        ? (b != null ? `Best time on ${SIZES[settings.size].label}: ${fmt(b / 1000)}` : `No best time on ${SIZES[settings.size].label} yet`)
        : 'Both players get the same maze. First to the star wins!';
    };
    fill('mode', MODES);
    fill('size', Object.fromEntries(Object.entries(SIZES).map(([k, v]) => [k, v.label])));
    showBest();
    o.querySelector('[data-act=go]').addEventListener('click', () => {
      localStorage.setItem('maze-settings', JSON.stringify(settings));
      IFPD.sfx.play('tap');
      newGame();
    });
    stage.append(o);
    setupEl = o;
  }

  // ---------------------------------------------------------------- boot
  const loop = IFPD.loop(update, render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loop.resume(); });

  // A maze is shown behind the setup card so the page never looks empty.
  game.maze = generate(12, 7);
  game.mode = 'solo';
  layout();
  showSetup();

  window.__game = {
    game, settings, solve, generate, collide, bfs, loop,
    BALL_R, WALL_T,
    newGame, showHint, showSetup,
    // page (viewport) coordinates, for automated touch tests
    regions: () => {
      const b = canvas.getBoundingClientRect();
      return game.regions.map(r => Object.assign({}, r, { ox: r.ox + b.left, oy: r.oy + b.top }));
    },
    ballScreen(i = 0) {
      const b = canvas.getBoundingClientRect(), r = game.regions[i], p = game.players[i];
      return { x: b.left + r.ox + p.x * r.cell, y: b.top + r.oy + p.y * r.cell, cell: r.cell };
    },
  };
})();
