/* Tic-Tac-Toe for classroom IFPD — marker on paper, 2 players or vs computer. */
(function () {
  'use strict';
  const { util, draw, sfx } = IFPD;
  const canvas = document.getElementById('game');
  const HAND = '"Segoe Print", "Bradley Hand", "Comic Sans MS", "Chalkboard SE", "Marker Felt", cursive';
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  const INK = { X: '#1c4fb0', O: '#c8202a' };
  const G0 = 0.15, G1 = 0.89, CS = (G1 - G0) / 3; // grid area on the sheet (unit coords)
  const SHEET_ANGLE = -0.014, NOTE_ANGLE = 0.035;

  const S = {
    mode: null, level: 'medium',
    board: Array(9).fill(null), turn: 'X', starter: 'X',
    scores: { X: 0, O: 0, D: 0 },
    phase: 'menu',          // menu | play | ending | over
    strokes: [], old: null, // current sheet strokes; previous sheet sliding away
    timers: [], after: null, round: 0, win: null, thinking: false, time: 0,
    cursor: 4, kbUsed: false, // keyboard highlight (cell index) and whether keys have been used
  };

  IFPD.setupPage({ title: 'Tic-Tac-Toe', onRestart: restart });
  let L = null, bg = null, sheetImg = null;
  const view = IFPD.fitCanvas(canvas, () => { L = null; });

  // ---------------------------------------------------------------- layout & static art
  function layout() {
    const W = view.width, H = view.height;
    const land = W >= H * 1.2;
    let sheet, note;
    if (land) {
      const s = Math.min(H * 0.9, W * 0.94 / 1.62);
      const nw = s * 0.54, gap = s * 0.08, total = s + gap + nw;
      const x0 = (W - total) / 2, y0 = (H - s) / 2;
      sheet = { x: x0, y: y0, s };
      note = { x: x0 + s + gap, y: y0 + s * 0.03, w: nw, h: nw };
    } else {
      const s = Math.min(W * 0.92, H * 0.94 / 1.42);
      const nh = s * 0.34, gap = s * 0.06, total = s + gap + nh;
      const y0 = (H - total) / 2;
      note = { x: (W - s * 0.9) / 2, y: y0, w: s * 0.9, h: nh };
      sheet = { x: (W - s) / 2, y: y0 + nh + gap, s };
    }
    L = { W, H, land, sheet, note };
    bg = makeBackground(W, H);
    sheetImg = makeSheet(sheet.s);
  }

  function makeBackground(W, H) {
    const c = document.createElement('canvas');
    c.width = Math.round(W * view.dpr); c.height = Math.round(H * view.dpr);
    const ctx = c.getContext('2d');
    ctx.scale(view.dpr, view.dpr);
    ctx.drawImage(IFPD.texture.wood(W, H, { base: '#875632', dark: '#4b2b14', planks: Math.max(3, Math.round(H / 200)) }), 0, 0, W, H);
    // warm desk-lamp lighting
    const g = ctx.createRadialGradient(W * 0.45, H * 0.35, Math.min(W, H) * 0.1, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
    g.addColorStop(0, 'rgba(255,230,180,0.18)');
    g.addColorStop(0.6, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // a pencil and an eraser lying on the desk
    const sh = L.sheet, n = L.note;
    if (L.land) {
      drawPencil(ctx, n.x + n.w * 0.05, n.y + n.h + sh.s * 0.2, sh.s * 0.5, -0.28);
      drawEraser(ctx, n.x + n.w * 0.62, n.y + n.h + sh.s * 0.33, sh.s * 0.13, 0.35);
    }
    return c;
  }

  function drawPencil(ctx, x, y, len, ang) {
    const w = len * 0.075;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    draw.shadow(ctx, len * 0.5, w * 0.9, len * 0.55, w * 0.9, 0.35);
    // body (hexagonal look: three bands)
    const body = len * 0.74;
    const bands = [['#f7c531', '#ffe27a'], ['#e9b11d', '#f7c531'], ['#c48d0c', '#dba21a']];
    for (let i = 0; i < 3; i++) {
      const gy = -w / 2 + (i * w) / 3;
      const g = ctx.createLinearGradient(0, gy, 0, gy + w / 3);
      g.addColorStop(0, bands[i][1]); g.addColorStop(1, bands[i][0]);
      ctx.fillStyle = g;
      ctx.fillRect(len * 0.12, gy, body, w / 3 + 0.5);
    }
    // ferrule + eraser
    const fx = len * 0.04;
    let g = ctx.createLinearGradient(0, -w / 2, 0, w / 2);
    g.addColorStop(0, '#f1f1f1'); g.addColorStop(0.4, '#a9a9a9'); g.addColorStop(1, '#5f5f5f');
    ctx.fillStyle = g;
    ctx.fillRect(fx, -w / 2 - 1, len * 0.085, w + 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(fx + i * len * 0.02, -w / 2); ctx.lineTo(fx + i * len * 0.02, w / 2); ctx.stroke(); }
    g = ctx.createLinearGradient(0, -w / 2, 0, w / 2);
    g.addColorStop(0, '#f6a3a3'); g.addColorStop(1, '#b85a5a');
    ctx.fillStyle = g;
    draw.roundRect(ctx, 0, -w / 2 + 1, fx + 2, w - 2, w * 0.25);
    ctx.fill();
    // sharpened wood cone + graphite
    const cx = len * 0.12 + body;
    g = ctx.createLinearGradient(0, -w / 2, 0, w / 2);
    g.addColorStop(0, '#f3d3a6'); g.addColorStop(1, '#b98e5c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx, -w / 2); ctx.lineTo(len, 0); ctx.lineTo(cx, w / 2);
    ctx.quadraticCurveTo(cx + w * 0.2, w / 4, cx, 0); ctx.quadraticCurveTo(cx + w * 0.2, -w / 4, cx, -w / 2);
    ctx.fill();
    ctx.fillStyle = '#2b2b2b';
    ctx.beginPath();
    ctx.moveTo(len - (len - cx) * 0.32, -w * 0.16); ctx.lineTo(len, 0); ctx.lineTo(len - (len - cx) * 0.32, w * 0.16);
    ctx.fill();
    ctx.restore();
  }

  function drawEraser(ctx, x, y, s, ang) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    draw.shadow(ctx, 4, s * 0.3, s * 0.65, s * 0.4, 0.4);
    const h = s * 0.42;
    let g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#d9d5cc');
    ctx.fillStyle = g;
    draw.roundRect(ctx, -s / 2, -h / 2, s, h, h * 0.18);
    ctx.fill();
    g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, '#4a7bd4'); g.addColorStop(1, '#264f9a');
    ctx.fillStyle = g;
    ctx.fillRect(-s * 0.18, -h / 2, s * 0.62, h);
    ctx.restore();
  }

  let grain = null;
  function grainPattern(ctx) {
    if (!grain) {
      const c = document.createElement('canvas');
      c.width = c.height = 96;
      const g = c.getContext('2d');
      const img = g.createImageData(96, 96);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 40 + Math.random() * 50;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = Math.random() < 0.72 ? 150 + Math.random() * 105 : Math.random() * 60;
      }
      g.putImageData(img, 0, 0);
      grain = c;
    }
    return ctx.createPattern(grain, 'repeat');
  }

  function makeSheet(s) {
    const pad = Math.ceil(s * 0.06);
    const c = document.createElement('canvas');
    c.width = Math.round((s + pad * 2) * view.dpr); c.height = c.width;
    const ctx = c.getContext('2d');
    ctx.scale(view.dpr, view.dpr);
    ctx.translate(pad, pad);
    // soft drop shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = s * 0.035;
    ctx.shadowOffsetX = s * 0.008; ctx.shadowOffsetY = s * 0.016;
    ctx.fillStyle = '#f7f4ec';
    ctx.fillRect(0, 0, s, s);
    ctx.restore();
    ctx.drawImage(IFPD.texture.paper(s, s, { color: '#f9f6ee' }), 0, 0, s, s);
    // ruled lines + margin
    ctx.lineWidth = Math.max(1, s * 0.0016);
    ctx.strokeStyle = 'rgba(80,140,210,0.28)';
    for (let y = 0.1; y < 0.98; y += 0.042) {
      ctx.beginPath(); ctx.moveTo(0, y * s); ctx.lineTo(s, y * s); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(220,70,70,0.4)';
    ctx.beginPath(); ctx.moveTo(s * 0.105, 0); ctx.lineTo(s * 0.105, s); ctx.stroke();
    // punched holes
    for (const hy of [0.18, 0.5, 0.82]) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(s * 0.045, hy * s, s * 0.018, 0, 7); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = s * 0.004;
      ctx.beginPath(); ctx.arc(s * 0.045, hy * s, s * 0.019, Math.PI * 0.9, Math.PI * 2.1); ctx.stroke();
    }
    // light falloff + gentle page curl at the bottom right
    let g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, 'rgba(255,255,255,0.10)');
    g.addColorStop(0.75, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(60,40,10,0.13)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    g = ctx.createLinearGradient(s, s, s * 0.88, s * 0.88);
    g.addColorStop(0, 'rgba(0,0,0,0.14)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(s, s * 0.8); ctx.lineTo(s, s); ctx.lineTo(s * 0.8, s); ctx.fill();
    return { c, pad };
  }

  // ---------------------------------------------------------------- strokes
  function makeStroke(pts, opts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1] || 1;
    return Object.assign({ pts, cum: cum.map(v => v / total), t: -(opts.delay || 0), dur: 0.3, kind: 'marker', width: 0.02, color: '#222', squeaks: 0 }, opts);
  }

  function wobblyLine(x0, y0, x1, y1, amp) {
    const n = 30, pts = [];
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
    const p1 = util.rand(0, 6), p2 = util.rand(0, 6), bow = util.rand(-1, 1) * amp * 1.4;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const o = Math.sin(t * Math.PI) * bow + Math.sin(t * 6 + p1) * amp * 0.35 + Math.sin(t * 15 + p2) * amp * 0.12;
      pts.push([x0 + dx * t + nx * o, y0 + dy * t + ny * o]);
    }
    return pts;
  }

  const cellCenter = i => [G0 + CS * (i % 3 + 0.5), G0 + CS * (Math.floor(i / 3) + 0.5)];

  function gridStrokes() {
    const out = [], j = () => util.rand(-0.012, 0.012);
    const a = G0 - 0.02, b = G1 + 0.02;
    for (let k = 1; k <= 2; k++) {
      const p = G0 + CS * k;
      out.push(makeStroke(wobblyLine(p + j(), a + j(), p + j(), b + j(), 0.006), { kind: 'pencil', width: 0.0105, color: '#3a3a3e', dur: 0.32, delay: (k - 1) * 0.3 }));
    }
    for (let k = 1; k <= 2; k++) {
      const p = G0 + CS * k;
      out.push(makeStroke(wobblyLine(a + j(), p + j(), b + j(), p + j(), 0.006), { kind: 'pencil', width: 0.0105, color: '#3a3a3e', dur: 0.32, delay: 0.6 + (k - 1) * 0.3 }));
    }
    return out;
  }

  function markStrokes(i, who) {
    const [cx, cy] = cellCenter(i), r = CS * 0.31, j = () => util.rand(-0.012, 0.012);
    if (who === 'X') {
      return [
        makeStroke(wobblyLine(cx - r + j(), cy - r + j(), cx + r + j(), cy + r + j(), 0.008), { color: INK.X, width: 0.024, dur: 0.17 }),
        makeStroke(wobblyLine(cx + r + j(), cy - r + j(), cx - r + j(), cy + r + j(), 0.008), { color: INK.X, width: 0.024, dur: 0.17, delay: 0.22 }),
      ];
    }
    const pts = [], start = -Math.PI / 2 - util.rand(0.2, 0.6), sweep = Math.PI * 2 + util.rand(0.25, 0.5);
    const rx = r * util.rand(0.95, 1.08), ry = r * util.rand(0.95, 1.08), ph = util.rand(0, 6), tilt = util.rand(-0.3, 0.3);
    for (let k = 0; k <= 48; k++) {
      const t = k / 48, a = start - sweep * t;
      const wob = 1 + 0.05 * Math.sin(a * 3 + ph) - 0.07 * t;
      const ex = Math.cos(a) * rx * wob, ey = Math.sin(a) * ry * wob;
      pts.push([cx + ex * Math.cos(tilt) - ey * Math.sin(tilt), cy + ex * Math.sin(tilt) + ey * Math.cos(tilt)]);
    }
    return [makeStroke(pts, { color: INK.O, width: 0.024, dur: 0.42 })];
  }

  function winStroke(line, who) {
    const [ax, ay] = cellCenter(line[0]), [bx, by] = cellCenter(line[2]);
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy), ext = CS * 0.42;
    const ux = dx / len, uy = dy / len;
    return makeStroke(wobblyLine(ax - ux * ext, ay - uy * ext, bx + ux * ext, by + uy * ext, 0.01),
      { color: who === 'X' ? '#0d2f75' : '#7d0f15', width: 0.03, dur: 0.45, delay: 0.15 });
  }

  function strokePath(ctx, st, s, prog) {
    const { pts, cum } = st;
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * s, pts[0][1] * s);
    for (let i = 1; i < pts.length; i++) {
      if (cum[i] <= prog) { ctx.lineTo(pts[i][0] * s, pts[i][1] * s); continue; }
      const f = (prog - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      ctx.lineTo(util.lerp(pts[i - 1][0], pts[i][0], f) * s, util.lerp(pts[i - 1][1], pts[i][1], f) * s);
      break;
    }
  }

  const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  function drawStroke(ctx, st, s) {
    const raw = util.clamp(st.t / st.dur, 0, 1);
    if (raw <= 0) return;
    const prog = ease(raw);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    strokePath(ctx, st, s, prog);
    if (st.kind === 'pencil') {
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = st.color;
      ctx.lineWidth = st.width * s * 0.7;
      ctx.stroke();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = grainPattern(ctx);
      ctx.lineWidth = st.width * s;
      ctx.stroke();
    } else {
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = st.color;
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = st.width * s * 1.25;   // slight bleed into the paper
      ctx.stroke();
      ctx.globalAlpha = 0.88;
      ctx.lineWidth = st.width * s;
      ctx.stroke();
      ctx.globalAlpha = 0.3;                 // darker wet core
      ctx.strokeStyle = draw.shade(st.color, -0.45);
      ctx.lineWidth = st.width * s * 0.38;
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.16;                // felt-tip streaks
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = st.width * s * 0.12;
      ctx.translate(st.width * s * 0.2, -st.width * s * 0.2);
      ctx.stroke();
      ctx.translate(-st.width * s * 0.2, st.width * s * 0.2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  const busy = () => S.strokes.some(st => st.t < st.dur);

  // ---------------------------------------------------------------- game logic
  const other = p => (p === 'X' ? 'O' : 'X');
  const isCpu = p => S.mode === 'cpu' && p === 'O';

  function winnerOf(b) {
    for (const ln of LINES) if (b[ln[0]] && b[ln[0]] === b[ln[1]] && b[ln[0]] === b[ln[2]]) return { who: b[ln[0]], line: ln };
    return null;
  }

  function minimax(b, player, me, depth) {
    const w = winnerOf(b);
    if (w) return w.who === me ? 10 - depth : depth - 10;
    if (b.every(Boolean)) return 0;
    let best = player === me ? -Infinity : Infinity;
    for (let i = 0; i < 9; i++) {
      if (b[i]) continue;
      b[i] = player;
      const sc = minimax(b, other(player), me, depth + 1);
      b[i] = null;
      best = player === me ? Math.max(best, sc) : Math.min(best, sc);
    }
    return best;
  }

  function findLineMove(b, who) {
    for (const ln of LINES) {
      const cells = ln.map(i => b[i]);
      if (cells.filter(c => c === who).length === 2 && cells.includes(null)) return ln[cells.indexOf(null)];
    }
    return -1;
  }

  function aiMove(board, me, level) {
    const b = board.slice();
    const empty = [];
    for (let i = 0; i < 9; i++) if (!b[i]) empty.push(i);
    if (!empty.length) return -1;
    const random = () => empty[util.randInt(0, empty.length - 1)];
    if (level === 'easy' && Math.random() < 0.75) return random();
    if (level === 'easy' || level === 'medium') {
      let m = findLineMove(b, me);
      if (m < 0) m = findLineMove(b, other(me));
      if (m >= 0) return m;
      if (!b[4] && Math.random() < 0.6) return 4;
      return random();
    }
    let best = -Infinity, moves = [];
    for (const i of empty) {
      b[i] = me;
      const sc = minimax(b, other(me), me, 1);
      b[i] = null;
      if (sc > best) { best = sc; moves = [i]; } else if (sc === best) moves.push(i);
    }
    return moves[util.randInt(0, moves.length - 1)];
  }

  function later(sec, fn) {
    const round = S.round;
    S.timers.push({ t: sec, fn: () => { if (round === S.round) fn(); } });
  }
  function whenIdle(fn) {
    const round = S.round;
    S.after = () => { if (round === S.round) fn(); };
  }

  let ovlToken = 0;
  function overlay(opts) {
    const token = ++ovlToken;
    IFPD.overlay.show({
      title: opts.title, text: opts.text,
      buttons: opts.buttons.map(b => ({
        label: b.label, kind: b.kind,
        onClick: () => { if (token !== ovlToken) return; ovlToken++; sfx.play('click'); b.onClick(); },
      })),
    });
  }

  function showMenu() {
    S.phase = 'menu';
    showKeyHelp();
    overlay({
      title: 'Tic-Tac-Toe',
      text: 'Get three in a row to win.\nChoose how you want to play:',
      buttons: [
        { label: '👥 2 Players', onClick: () => start('2p') },
        { label: '🤖 vs Computer', kind: 'good', onClick: chooseLevel },
      ],
    });
  }

  function chooseLevel() {
    overlay({
      title: 'vs Computer',
      text: 'You play X, the computer plays O.\nPick a difficulty:',
      buttons: [
        { label: '😊 Easy', kind: 'good', onClick: () => start('cpu', 'easy') },
        { label: '🙂 Medium', onClick: () => start('cpu', 'medium') },
        { label: '🧠 Impossible', kind: 'bad', onClick: () => start('cpu', 'impossible') },
        { label: '← Back', kind: 'secondary', onClick: showMenu },
      ],
    });
  }

  function start(mode, level) {
    S.mode = mode;
    S.level = level || null;
    S.scores = { X: 0, O: 0, D: 0 };
    S.starter = 'O'; // newRound flips it, so X starts the first round
    newRound();
    showKeyHelp();
  }

  function newRound() {
    S.round++;
    S.timers = [];
    S.after = null;
    S.thinking = false;
    if (S.strokes.length) S.old = { strokes: S.strokes, t: 0, dir: Math.random() < 0.5 ? -1 : 1 };
    S.starter = other(S.starter);
    S.turn = S.starter;
    S.board = Array(9).fill(null);
    S.win = null;
    S.strokes = gridStrokes();
    S.phase = 'play';
    S.cursor = 4;
    if (S.old) sfx.play('whoosh', { volume: 0.8 });
    whenIdle(nextTurn);
  }

  function nextTurn() {
    if (S.phase !== 'play') return;
    if (isCpu(S.turn)) {
      S.thinking = true;
      later(util.rand(0.45, 0.85), () => {
        S.thinking = false;
        const m = aiMove(S.board, S.turn, S.level);
        if (m >= 0) place(m);
      });
    }
  }

  function canHumanPlay() {
    return S.phase === 'play' && !busy() && !S.thinking && !isCpu(S.turn) && !IFPD.overlay.visible;
  }

  function place(i) {
    if (S.phase !== 'play' || S.board[i]) return false;
    const who = S.turn;
    S.board[i] = who;
    const [cx] = cellCenter(i);
    sfx.play('tap', { volume: 0.5, pan: (cx - 0.5) * 1.2 });
    for (const st of markStrokes(i, who)) S.strokes.push(st);
    const w = winnerOf(S.board);
    if (w) {
      S.phase = 'ending';
      S.win = w;
      whenIdle(() => {
        S.strokes.push(winStroke(w.line, w.who));
        whenIdle(() => later(0.7, () => endRound(w.who)));
      });
    } else if (S.board.every(Boolean)) {
      S.phase = 'ending';
      whenIdle(() => later(0.5, () => endRound(null)));
    } else {
      S.turn = other(who);
      whenIdle(nextTurn);
    }
    return true;
  }

  function nameOf(p) {
    if (S.mode === 'cpu') return p === 'X' ? 'You' : 'Computer';
    return p === 'X' ? 'Player X' : 'Player O';
  }

  function endRound(who) {
    S.phase = 'over';
    let title;
    if (who) {
      S.scores[who]++;
      title = S.mode === 'cpu' ? (who === 'X' ? '🎉 You win!' : '🤖 Computer wins!') : `🎉 ${who} wins!`;
      if (S.mode === 'cpu' && who === 'O') sfx.play('lose'); else { sfx.play('win'); IFPD.confetti(2200); }
    } else {
      S.scores.D++;
      title = "🤝 It's a draw!";
      sfx.play('ding', { pitch: 0.8 });
    }
    const sc = S.scores;
    overlay({
      title,
      text: `${nameOf('X')}: ${sc.X}  ·  ${nameOf('O')}: ${sc.O}  ·  Draws: ${sc.D}\n${nameOf(other(S.starter))} start${S.mode === 'cpu' && other(S.starter) === 'X' ? '' : 's'} the next round.`,
      buttons: [
        { label: '▶ Play again', kind: 'good', onClick: newRound },
        { label: 'Change mode', kind: 'secondary', onClick: () => { S.round++; showMenu(); } },
      ],
    });
  }

  function restart() {
    sfx.play('click');
    S.round++;
    S.timers = [];
    S.after = null;
    S.thinking = false;
    showMenu();
  }

  // ---------------------------------------------------------------- input
  function toSheet(x, y) {
    const sh = L.sheet, c = sh.s / 2;
    const dx = x - (sh.x + c), dy = y - (sh.y + c);
    const cs = Math.cos(-SHEET_ANGLE), sn = Math.sin(-SHEET_ANGLE);
    return [(dx * cs - dy * sn) / sh.s + 0.5, (dx * sn + dy * cs) / sh.s + 0.5];
  }
  function fromSheet(u, v) {
    const sh = L.sheet, c = sh.s / 2;
    const dx = (u - 0.5) * sh.s, dy = (v - 0.5) * sh.s;
    const cs = Math.cos(SHEET_ANGLE), sn = Math.sin(SHEET_ANGLE);
    return [sh.x + c + dx * cs - dy * sn, sh.y + c + dx * sn + dy * cs];
  }

  IFPD.pointers(canvas, {
    down(p) {
      if (!L) layout();
      const [u, v] = toSheet(p.x, p.y);
      const tol = CS * 0.12;
      if (u < G0 - tol || u > G1 + tol || v < G0 - tol || v > G1 + tol) return false;
      const col = util.clamp(Math.floor((u - G0) / CS), 0, 2), row = util.clamp(Math.floor((v - G0) / CS), 0, 2);
      const i = row * 3 + col;
      if (!canHumanPlay() || S.board[i]) {
        sfx.play('tick', { volume: 0.6 });
        return false;
      }
      place(i);
      return false;
    },
  });

  // ---------------------------------------------------------------- keyboard
  // 1–9 = squares in reading order (1 2 3 = top row); the numpad maps the way the squares look
  // (Numpad7 = top-left). Arrows move a highlight, Enter / Space place on it.
  const NUMPAD = { Numpad7: 0, Numpad8: 1, Numpad9: 2, Numpad4: 3, Numpad5: 4, Numpad6: 5, Numpad1: 6, Numpad2: 7, Numpad3: 8 };
  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const kbMode = () => !!window.CosmiqInput && CosmiqInput.mode === 'keyboard';

  function showKeyHelp() {
    if (!window.CosmiqInput) return;
    if (S.phase === 'menu') CosmiqInput.keys.help('Tic-Tac-Toe', [['Tab ← →', 'Choose'], ['Enter', 'Select']]);
    else CosmiqInput.keys.help('Tic-Tac-Toe', [['1 – 9', 'Pick a square (1 2 3 = top row)'], ['Numpad', '7 8 9 = top row, like the board'],
      ['← ↑ → ↓', 'Move the highlight'], ['Enter Space', 'Place your mark']]);
  }

  // Enter / Space on a top-bar button the player tabbed to should press it; a button that only
  // kept focus after a mouse click must not swallow game keys.
  function keyForButton(e) {
    const b = e.target && e.target.closest && e.target.closest('button, a[href]');
    if (!b) return false;
    if (b.matches(':focus-visible')) return true;
    b.blur();
    return false;
  }

  function keyPlace(i) {
    if (!canHumanPlay() || S.board[i]) { sfx.play('tick', { volume: 0.6 }); return; }
    place(i);
  }

  if (window.CosmiqInput) CosmiqInput.keys.on(e => {
    if (e.type !== 'keydown' || S.phase !== 'play' || IFPD.overlay.visible) return;
    let cell = -1;
    if (/^Digit[1-9]$/.test(e.code)) cell = Number(e.code[5]) - 1;
    else if (e.code in NUMPAD) cell = NUMPAD[e.code];
    if (cell >= 0) {
      e.preventDefault();
      if (e.repeat) return;
      S.cursor = cell;
      keyPlace(cell);
    } else if (ARROWS[e.key]) {
      e.preventDefault();
      const [dx, dy] = ARROWS[e.key];
      if (S.kbUsed || kbMode()) S.cursor = (S.cursor % 3 + dx + 3) % 3 + ((Math.floor(S.cursor / 3) + dy + 3) % 3) * 3;
      S.kbUsed = true;
      sfx.play('tick', { volume: 0.35 });
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (keyForButton(e)) return;
      e.preventDefault();
      if (e.repeat) return;
      S.kbUsed = true;
      keyPlace(S.cursor);
    }
  });

  // Small key digits in the empty squares (keyboard mode) and the highlight square.
  function drawKeyHints(ctx) {
    const showDigits = kbMode(), showCursor = S.kbUsed || kbMode();
    if (S.phase !== 'play' || (!showDigits && !showCursor)) return;
    const sh = L.sheet, s = sh.s;
    ctx.save();
    ctx.translate(sh.x + s / 2, sh.y + s / 2);
    ctx.rotate(SHEET_ANGLE);
    ctx.translate(-s / 2, -s / 2);
    if (showDigits) {
      ctx.font = `bold ${s * CS * 0.2}px ${HAND}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(60,60,70,0.42)';
      for (let i = 0; i < 9; i++) {
        if (S.board[i]) continue;
        const [cx, cy] = cellCenter(i);
        ctx.fillText(String(i + 1), (cx - CS * 0.27) * s, (cy - CS * 0.25) * s);
      }
    }
    if (showCursor) {
      const [cx, cy] = cellCenter(S.cursor), h = CS * 0.43;
      const mine = canHumanPlay() || (S.mode === '2p' && !busy());
      ctx.globalAlpha = mine ? 0.75 + 0.2 * Math.sin(S.time * 5) : 0.3;
      ctx.strokeStyle = INK[S.mode === 'cpu' ? 'X' : S.turn];
      ctx.lineWidth = s * 0.008;
      ctx.setLineDash([s * 0.02, s * 0.014]);
      draw.roundRect(ctx, (cx - h) * s, (cy - h) * s, h * 2 * s, h * 2 * s, s * 0.02);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- loop
  let squeakCd = 0;
  function update(dt) {
    S.time += dt;
    squeakCd -= dt;
    for (const st of S.strokes) {
      if (st.t >= st.dur) continue;
      const before = st.t;
      st.t += dt;
      if (before <= 0 && st.t > 0) {
        if (st.kind === 'pencil') sfx.play('chalk', { volume: 0.9, pitch: 0.45 });
        else sfx.play('chalk', { volume: 1.6, pitch: util.rand(0.55, 0.7) });
      } else if (st.kind === 'marker' && st.t > 0 && squeakCd <= 0) {
        squeakCd = 0.07;
        sfx.play('chalk', { volume: 1.1, pitch: util.rand(0.5, 0.75) });
      }
    }
    if (S.old) {
      S.old.t += dt;
      if (S.old.t > 0.8) S.old = null;
    }
    for (let k = S.timers.length - 1; k >= 0; k--) {
      const tm = S.timers[k];
      tm.t -= dt;
      if (tm.t <= 0) { S.timers.splice(k, 1); tm.fn(); }
    }
    if (S.after && !busy()) { const fn = S.after; S.after = null; fn(); }
  }

  function drawSheet(ctx, strokes, offX, offY, ang) {
    const sh = L.sheet, s = sh.s;
    ctx.save();
    ctx.translate(sh.x + s / 2 + offX, sh.y + s / 2 + offY);
    ctx.rotate(SHEET_ANGLE + ang);
    ctx.translate(-s / 2, -s / 2);
    ctx.drawImage(sheetImg.c, -sheetImg.pad, -sheetImg.pad, s + sheetImg.pad * 2, s + sheetImg.pad * 2);
    for (const st of strokes) drawStroke(ctx, st, s);
    ctx.restore();
  }

  function drawMiniMark(ctx, who, x, y, r) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 0.32;
    ctx.strokeStyle = INK[who];
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    if (who === 'X') {
      ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
    } else {
      ctx.ellipse(x, y, r * 1.05, r, 0, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawNote(ctx) {
    const n = L.note;
    ctx.save();
    ctx.translate(n.x + n.w / 2, n.y + n.h / 2);
    ctx.rotate(L.land ? NOTE_ANGLE : -NOTE_ANGLE * 0.4);
    ctx.translate(-n.w / 2, -n.h / 2);
    // shadow + yellow pad with a slight curl at the bottom
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = n.h * 0.06;
    ctx.shadowOffsetY = n.h * 0.03;
    ctx.fillStyle = '#f7dc5a';
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(n.w, 0); ctx.lineTo(n.w, n.h * 0.97);
    ctx.quadraticCurveTo(n.w * 0.5, n.h * 1.015, 0, n.h); ctx.closePath();
    ctx.fill();
    ctx.restore();
    let g = ctx.createLinearGradient(0, 0, 0, n.h);
    g.addColorStop(0, 'rgba(255,240,150,0.6)');
    g.addColorStop(0.12, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(160,110,0,0.18)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = 'rgba(200,160,0,0.18)';
    ctx.fillRect(0, 0, n.w, n.h * 0.1); // glue strip

    const sc = S.scores, ink = '#2a2a33';
    ctx.fillStyle = ink;
    ctx.textBaseline = 'middle';
    const playing = S.phase === 'play';
    let status = '';
    if (S.phase === 'menu') status = 'Choose a mode';
    else if (S.phase === 'play') {
      if (S.thinking) status = 'Thinking' + '.'.repeat(1 + Math.floor(S.time * 3) % 3);
      else status = S.mode === 'cpu' ? (S.turn === 'X' ? 'Your turn!' : 'Computer…') : `${S.turn}'s turn!`;
    } else if (S.win) status = `${S.win.who} wins!`;
    else if (S.phase !== 'menu') status = S.board.every(Boolean) ? 'Draw!' : '';

    const rows = [['X', nameOf('X'), sc.X], ['O', nameOf('O'), sc.O], [null, 'Draws', sc.D]];
    if (n.w > n.h * 1.5) {
      // wide note (portrait screens): three columns + status
      const fs = n.h * 0.2;
      ctx.font = `bold ${fs}px ${HAND}`;
      ctx.textAlign = 'center';
      rows.forEach((r, k) => {
        const cx = n.w * (0.18 + k * 0.32), cy = n.h * 0.36;
        if (r[0]) drawMiniMark(ctx, r[0], cx - fs * 0.8, cy, fs * 0.32);
        else { ctx.font = `${fs * 0.62}px ${HAND}`; ctx.textAlign = 'right'; ctx.fillText('Draws', cx + fs * 0.05, cy); ctx.font = `bold ${fs}px ${HAND}`; ctx.textAlign = 'center'; }
        ctx.fillText(String(r[2]), cx + fs * 0.6, cy);
        if (playing && r[0] === S.turn) underline(ctx, cx - fs * 1.6, cy + fs * 0.6, fs * 2.6);
      });
      ctx.font = `${fs * 0.85}px ${HAND}`;
      ctx.fillText(status, n.w / 2, n.h * 0.75);
    } else {
      const fs = n.w * 0.105;
      ctx.textAlign = 'center';
      ctx.font = `bold ${fs * 1.05}px ${HAND}`;
      ctx.fillText('Score', n.w / 2, n.h * 0.13);
      ctx.textAlign = 'left';
      rows.forEach((r, k) => {
        const cy = n.h * (0.31 + k * 0.155);
        ctx.font = `${fs * (r[0] ? 0.8 : 0.72)}px ${HAND}`;
        if (r[0]) drawMiniMark(ctx, r[0], n.w * 0.13, cy, fs * 0.3);
        ctx.fillText(r[1], n.w * 0.24, cy);
        ctx.font = `bold ${fs}px ${HAND}`;
        ctx.textAlign = 'right';
        ctx.fillText(String(r[2]), n.w * 0.9, cy);
        ctx.textAlign = 'left';
        if (playing && r[0] === S.turn) underline(ctx, n.w * 0.06, cy + fs * 0.55, n.w * 0.86);
      });
      ctx.strokeStyle = 'rgba(40,40,50,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(n.w * 0.08, n.h * 0.745); ctx.lineTo(n.w * 0.92, n.h * 0.735); ctx.stroke();
      ctx.textAlign = 'center';
      let sfs = fs * 0.78;
      ctx.font = `bold ${sfs}px ${HAND}`;
      const tw = ctx.measureText(status).width;
      if (tw > n.w * 0.86) { sfs *= n.w * 0.86 / tw; ctx.font = `bold ${sfs}px ${HAND}`; }
      ctx.fillText(status, n.w / 2, n.h * 0.83);
      if (S.mode) {
        ctx.font = `${fs * 0.5}px ${HAND}`;
        ctx.globalAlpha = 0.7;
        ctx.fillText(S.mode === 'cpu' ? `vs Computer · ${S.level[0].toUpperCase() + S.level.slice(1)}` : '2 Players', n.w / 2, n.h * 0.935);
        ctx.globalAlpha = 1;
      }
    }
    // a strip of tape holding the note
    ctx.translate(n.w / 2, 0);
    ctx.rotate(-0.06);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(-n.w * 0.17, -n.h * 0.045, n.w * 0.34, n.h * 0.09);
    ctx.restore();
  }

  function underline(ctx, x, y, w) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.strokeStyle = 'rgba(255,90,140,0.55)';
    ctx.lineWidth = Math.max(4, w * 0.045);
    ctx.lineCap = 'round';
    const wig = Math.sin(S.time * 4) * 2;
    ctx.beginPath(); ctx.moveTo(x, y + wig * 0.3); ctx.quadraticCurveTo(x + w / 2, y + 4 + wig, x + w, y - 2); ctx.stroke();
    ctx.restore();
  }

  function render() {
    if (!L || L.W !== view.width || L.H !== view.height) layout();
    const ctx = view.ctx;
    ctx.drawImage(bg, 0, 0, L.W, L.H);
    drawSheet(ctx, S.strokes, 0, 0, 0);
    drawKeyHints(ctx);
    if (S.old) {
      const k = Math.pow(S.old.t / 0.8, 2);
      drawSheet(ctx, S.old.strokes, S.old.dir * k * L.W * 0.9, -k * L.H * 0.25, S.old.dir * k * 0.5);
    }
    drawNote(ctx);
  }

  IFPD.loop(update, render);
  layout();
  showMenu();

  // ---------------------------------------------------------------- debug hook for automated tests
  window.__game = {
    S, aiMove, winnerOf, busy,
    canPlay: canHumanPlay,
    cellClient(i) {
      const [u, v] = cellCenter(i);
      const [x, y] = fromSheet(u, v);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + x, y: r.top + y };
    },
  };
})();
