/* Connect Four for classroom IFPD — moulded plastic board, 2 players or vs computer (alpha-beta AI in a worker). */
(function () {
  'use strict';
  const { util, draw, sfx } = IFPD;
  const canvas = document.getElementById('game');
  const COLS = 7, ROWS = 6;
  const M = 0.34;              // frame border (cell units)
  const PREVIEW_Y = -1.5;      // preview disc row (display rows from top)
  const GRAV = 95;             // rows / s^2
  const RED = 1, YEL = 2;
  const COLOR = { 1: '#d8232a', 2: '#f6c516' };
  const CNAME = { 1: 'Red', 2: 'Yellow' };

  // =====================================================================================
  // AI engine: self-contained so it can run inside a Blob worker (or on the main thread).
  // Board: Int8Array(42), index r*7+c with r = 0 at the BOTTOM. 0 empty, 1 red, 2 yellow.
  // =====================================================================================
  function C4Engine() {
    const W = 7, H = 6, N = 42, WIN = 1000000;
    const ORDER = [3, 2, 4, 1, 5, 0, 6];
    const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
    const win = [];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      for (const [dr, dc] of DIRS) {
        const er = r + dr * 3, ec = c + dc * 3;
        if (er < 0 || er >= H || ec < 0 || ec >= W) continue;
        for (let k = 0; k < 4; k++) win.push((r + dr * k) * W + c + dc * k);
      }
    }
    const WINS = Int16Array.from(win), NW = WINS.length / 4;
    const Z1 = new Int32Array(N * 3), Z2 = new Int32Array(N * 3);
    for (let i = 0; i < N * 3; i++) { Z1[i] = (Math.random() * 4294967296) | 0; Z2[i] = (Math.random() * 4294967296) | 0; }
    const TT_SIZE = 1 << 19, TT_MASK = TT_SIZE - 1;
    const ttK = new Int32Array(TT_SIZE), ttS = new Int32Array(TT_SIZE), ttD = new Int8Array(TT_SIZE);
    const ttF = new Int8Array(TT_SIZE), ttB = new Int8Array(TT_SIZE), ttU = new Uint8Array(TT_SIZE);

    let cells = new Int8Array(N), heights = new Int8Array(W), h1 = 0, h2 = 0, count = 0;
    let nodes = 0, deadline = 0, timedOut = false, first = 1;

    function winsAt(r, c, p) {
      for (let d = 0; d < 4; d++) {
        const dr = DIRS[d][0], dc = DIRS[d][1];
        let n = 1;
        for (let k = 1; k < 4; k++) {
          const rr = r + dr * k, cc = c + dc * k;
          if (rr < 0 || rr >= H || cc < 0 || cc >= W || cells[rr * W + cc] !== p) break;
          n++;
        }
        for (let k = 1; k < 4; k++) {
          const rr = r - dr * k, cc = c - dc * k;
          if (rr < 0 || rr >= H || cc < 0 || cc >= W || cells[rr * W + cc] !== p) break;
          n++;
        }
        if (n >= 4) return true;
      }
      return false;
    }
    function play(c, p) {
      const i = heights[c]++ * W + c;
      cells[i] = p; h1 ^= Z1[i * 3 + p]; h2 ^= Z2[i * 3 + p]; count++;
    }
    function undo(c) {
      const i = --heights[c] * W + c, p = cells[i];
      cells[i] = 0; h1 ^= Z1[i * 3 + p]; h2 ^= Z2[i * 3 + p]; count--;
    }
    function threat(i, who) {
      const r = (i / W) | 0;
      let v = 45;
      if ((who === first) === (r % 2 === 0)) v += 25; // odd (1-based) rows favour the first player, even rows the second
      if (r > 0 && cells[i - W] === 0) v += 10;        // not yet blockable: a lasting threat
      return v;
    }
    function evaluate(p) {
      const o = 3 - p;
      let s = 0;
      for (let w = 0; w < NW; w++) {
        let mine = 0, theirs = 0, empty = -1;
        for (let k = 0; k < 4; k++) {
          const idx = WINS[w * 4 + k], v = cells[idx];
          if (v === p) mine++; else if (v === o) theirs++; else empty = idx;
        }
        if (mine && theirs) continue;
        if (mine === 3) s += threat(empty, p);
        else if (mine === 2) s += 5;
        else if (theirs === 3) s -= threat(empty, o);
        else if (theirs === 2) s -= 5;
      }
      for (let r = 0; r < H; r++) {
        const v = cells[r * W + 3];
        if (v === p) s += 7; else if (v === o) s -= 7;
      }
      return s;
    }
    function negamax(depth, alpha, beta, p, ply) {
      if ((++nodes & 2047) === 0 && performance.now() > deadline) timedOut = true;
      if (timedOut) return 0;
      for (let c = 0; c < W; c++) if (heights[c] < H && winsAt(heights[c], c, p)) return WIN - ply;
      if (count >= N - 1) return 0;
      const o = 3 - p;
      let forced = -1, threats = 0;
      for (let c = 0; c < W; c++) if (heights[c] < H && winsAt(heights[c], c, o)) { threats++; forced = c; }
      if (threats >= 2) return -(WIN - ply - 1);
      if (depth <= 0) return evaluate(p);
      const slot = h1 & TT_MASK;
      let ttBest = -1;
      if (ttU[slot] && ttK[slot] === h2) {
        ttBest = ttB[slot];
        if (ttD[slot] >= depth) {
          const sc = ttS[slot], f = ttF[slot];
          if (f === 0 || (f === 1 && sc >= beta) || (f === 2 && sc <= alpha)) return sc;
        }
      }
      const a0 = alpha;
      let best = -Infinity, bestC = -1;
      for (let k = -1; k < W; k++) {
        let c;
        if (forced >= 0) { if (k > -1) break; c = forced; } else if (k === -1) { if (ttBest < 0) continue; c = ttBest; } else { c = ORDER[k]; if (c === ttBest) continue; }
        if (heights[c] >= H) continue;
        play(c, p);
        // after a forced block, don't burn depth (cheap extension that sharpens tactics)
        const sc = -negamax(forced >= 0 ? depth : depth - 1, -beta, -alpha, o, ply + 1);
        undo(c);
        if (timedOut) return 0;
        if (sc > best) { best = sc; bestC = c; }
        if (sc > alpha) alpha = sc;
        if (alpha >= beta) break;
      }
      ttU[slot] = 1; ttK[slot] = h2; ttS[slot] = best; ttD[slot] = depth; ttB[slot] = bestC;
      ttF[slot] = best <= a0 ? 2 : best >= beta ? 1 : 0;
      return best;
    }
    function load(arr) {
      cells = Int8Array.from(arr); heights = new Int8Array(W); h1 = 0; h2 = 0; count = 0;
      for (let c = 0; c < W; c++) {
        for (let r = 0; r < H; r++) {
          const p = cells[r * W + c];
          if (!p) break;
          heights[c] = r + 1; count++;
          h1 ^= Z1[(r * W + c) * 3 + p]; h2 ^= Z2[(r * W + c) * 3 + p];
        }
      }
    }
    // args: { cells, player, first, level: 'easy'|'medium'|'hard', timeMs }
    function search(args) {
      load(args.cells);
      first = args.first || 1;
      const p = args.player, o = 3 - p, t0 = performance.now();
      ttU.fill(0);
      nodes = 0; timedOut = false;
      const valid = ORDER.filter(c => heights[c] < H);
      if (!valid.length) return { col: -1 };
      for (const c of valid) if (winsAt(heights[c], c, p)) return { col: c, reason: 'win', ms: 0 };
      const blocks = valid.filter(c => winsAt(heights[c], c, o));
      if (blocks.length && (args.level !== 'easy' || Math.random() < 0.85)) return { col: blocks[0], reason: 'block', ms: 0 };
      if (args.level === 'easy' || args.level === 'medium') {
        const easy = args.level === 'easy';
        if (easy && Math.random() < 0.3) return { col: valid[Math.floor(Math.random() * valid.length)], reason: 'random' };
        deadline = t0 + 5000;
        const depth = easy ? 2 : 5;
        let best = -Infinity, col = valid[0];
        for (const c of valid) {
          play(c, p);
          let s = -negamax(depth - 1, -WIN * 2, WIN * 2, o, 1);
          undo(c);
          if (Math.abs(s) < WIN - 100) s += (Math.random() - 0.5) * (easy ? 120 : 30);
          if (s > best) { best = s; col = c; }
        }
        return { col, reason: args.level, ms: performance.now() - t0 };
      }
      deadline = t0 + (args.timeMs || 700);
      let bestCol = valid[0], bestScore = 0, depthDone = 0, order = valid.slice();
      for (let d = 1; d <= N - count; d++) {
        let alpha = -WIN * 2, curBest = -1, curScore = -Infinity;
        for (const c of order) {
          play(c, p);
          const s = -negamax(d - 1, -WIN * 2, -alpha, o, 1);
          undo(c);
          if (timedOut) break;
          if (s > curScore) { curScore = s; curBest = c; }
          if (s > alpha) alpha = s;
        }
        if (timedOut) break;
        bestCol = curBest; bestScore = curScore; depthDone = d;
        order = [curBest].concat(order.filter(c => c !== curBest));
        if (Math.abs(curScore) > WIN - 1000) break; // solved (forced win or loss)
      }
      return { col: bestCol, score: bestScore, depth: depthDone, nodes, ms: performance.now() - t0, reason: 'hard' };
    }
    return { search };
  }

  // Run the engine in a Blob worker so animation stays smooth; fall back to the main thread.
  const Engine = (function () {
    let worker = null, local = null, nextId = 1;
    const pending = new Map();
    const runLocal = (args, cb) => setTimeout(() => { local = local || C4Engine(); cb(local.search(args)); }, 20);
    try {
      const src = 'const engine = (' + C4Engine.toString() + ')();\n' +
        'self.onmessage = function (e) { self.postMessage({ id: e.data.id, r: engine.search(e.data.args) }); };';
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      worker.onmessage = e => {
        const job = pending.get(e.data.id);
        if (job) { pending.delete(e.data.id); job.cb(e.data.r); }
      };
      worker.onerror = e => {
        if (e && e.preventDefault) e.preventDefault();
        worker = null;
        for (const job of pending.values()) runLocal(job.args, job.cb);
        pending.clear();
      };
    } catch (_) { worker = null; }
    return {
      get usingWorker() { return !!worker; },
      run(args, cb) {
        if (!worker) return runLocal(args, cb);
        const id = nextId++;
        pending.set(id, { args, cb });
        worker.postMessage({ id, args });
      },
      sync(args) { local = local || C4Engine(); return local.search(args); },
    };
  })();

  // =====================================================================================
  // Game state
  // =====================================================================================
  const S = {
    mode: null, level: null, phase: 'menu',        // menu | play | ending | over
    cells: new Int8Array(42), heights: new Int8Array(7),
    turn: RED, starter: YEL, scores: { 1: 0, 2: 0, D: 0 }, round: 0,
    discs: [], ghosts: [], moves: [], falling: null, result: null, win: null,
    aim: -1, previewX: 3, previewShow: 0, aiThinking: false, aiAim: -1,
    timers: [], time: 0, winT: 0,
  };
  let owner = null;

  const page = IFPD.setupPage({ title: 'Connect Four', onRestart: restart });
  const undoBtn = document.createElement('button');
  undoBtn.className = 'ifpd-btn';
  undoBtn.textContent = '↶ Undo';
  undoBtn.hidden = true;
  undoBtn.addEventListener('click', undoMove);
  page.extra.append(undoBtn);

  let L = null;
  const view = IFPD.fitCanvas(canvas, () => { L = null; });
  const isCpu = p => S.mode === 'cpu' && p === YEL;
  const nameOf = p => (S.mode === 'cpu' ? (p === RED ? 'You' : 'Computer') : CNAME[p]);

  // =====================================================================================
  // Layout & cached art
  // =====================================================================================
  function layout() {
    const W = view.width, H = view.height;
    const land = W >= H * 1.25;
    let c;
    if (land) c = Math.min(H * 0.95 / 9.1, W * 0.96 / (7.9 + 6.2));
    else c = Math.min(W * 0.96 / 9.4, H * 0.95 / (9.1 + 2.3));
    c = Math.max(20, c);
    const fw = COLS * c + 2 * M * c, fh = ROWS * c + 2 * M * c;
    const contentH = land ? 9.1 * c : (9.1 + 2.3) * c;
    const top = (H - contentH) / 2 + 1.25 * c;
    const fx = (W - fw) / 2, fy = top;
    const L2 = { W, H, land, c, fx, fy, fw, fh, R: c * 0.43 };
    if (land) {
      const pw = Math.min(3.0 * c, (W - fw) / 2 - 1.0 * c), ph = 3.6 * c;
      const py = fy + fh / 2 - ph / 2;
      L2.panels = { 1: { x: (fx - 0.55 * c) / 2 - pw / 2, y: py, w: pw, h: ph }, 2: { x: W - (fx - 0.55 * c) / 2 - pw / 2, y: py, w: pw, h: ph } };
      L2.info = { x: W / 2, y: fy + fh + 0.95 * c };
    } else {
      const pw = Math.min(3.6 * c, W / 2 - 0.4 * c), ph = 1.9 * c, py = fy + fh + 1.25 * c;
      L2.panels = { 1: { x: W / 2 - pw - 0.2 * c, y: py, w: pw, h: ph }, 2: { x: W / 2 + 0.2 * c, y: py, w: pw, h: ph } };
      L2.info = { x: W / 2, y: py + ph + 0.3 * c };
    }
    L = L2;
    L.bg = makeBackground();
    L.board = makeBoard();
    L.sprite = { 1: makeDisc(COLOR[1], L.R), 2: makeDisc(COLOR[2], L.R) };
  }

  const colX = col => L.fx + M * L.c + (col + 0.5) * L.c;
  const rowY = y => L.fy + M * L.c + (y + 0.5) * L.c; // y = display row from top (can be fractional / negative)

  function offscreen(w, h) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * view.dpr)); cv.height = Math.max(1, Math.round(h * view.dpr));
    const ctx = cv.getContext('2d');
    ctx.scale(view.dpr, view.dpr);
    return { cv, ctx };
  }

  function makeBackground() {
    const { W, H, c, fx, fy, fw, fh } = L;
    const { cv, ctx } = offscreen(W, H);
    ctx.drawImage(IFPD.texture.wood(W, H, { base: '#9a6a3f', dark: '#5a361a', planks: Math.max(4, Math.round(H / 170)) }), 0, 0, W, H);
    // a back wall gradient behind the board — the space seen through the holes
    let g = ctx.createRadialGradient(W / 2, fy + fh * 0.4, c, W / 2, fy + fh * 0.5, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(255,236,200,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // the board's shadow behind it (seen through the holes) and on the table under the feet
    ctx.save();
    ctx.filter = `blur(${Math.round(c * 0.25)}px)`;
    ctx.fillStyle = 'rgba(10,6,2,0.4)';
    ctx.fillRect(fx + c * 0.25, fy + c * 0.35, fw - c * 0.1, fh - c * 0.1);
    ctx.restore();
    draw.shadow(ctx, W / 2, fy + fh + 0.55 * c, fw * 0.62, c * 0.35, 0.5);
    return cv;
  }

  function makeDisc(color, R) {
    const pad = 2, size = R * 2 + pad * 2;
    const { cv, ctx } = offscreen(size, size);
    const x = size / 2, y = size / 2;
    // body
    let g = ctx.createRadialGradient(x - R * 0.35, y - R * 0.4, R * 0.1, x, y, R);
    g.addColorStop(0, draw.shade(color, 0.35));
    g.addColorStop(0.6, color);
    g.addColorStop(1, draw.shade(color, -0.42));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    // ridged rim
    const ridges = 44;
    for (let i = 0; i < ridges; i++) {
      const a = (i / ridges) * Math.PI * 2;
      const lit = Math.cos(a + Math.PI * 0.75); // lighter toward the top-left
      ctx.strokeStyle = i % 2 ? `rgba(0,0,0,${0.16 + 0.08 * -lit})` : `rgba(255,255,255,${0.1 + 0.12 * Math.max(0, lit)})`;
      ctx.lineWidth = Math.max(1, R * 0.05);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * R * 0.83, y + Math.sin(a) * R * 0.83);
      ctx.lineTo(x + Math.cos(a) * R * 0.98, y + Math.sin(a) * R * 0.98);
      ctx.stroke();
    }
    // recessed face (lit from the opposite side)
    g = ctx.createLinearGradient(x - R, y - R, x + R, y + R);
    g.addColorStop(0, draw.shade(color, -0.3));
    g.addColorStop(1, draw.shade(color, 0.3));
    ctx.strokeStyle = g;
    ctx.lineWidth = R * 0.06;
    ctx.beginPath(); ctx.arc(x, y, R * 0.78, 0, Math.PI * 2); ctx.stroke();
    g = ctx.createRadialGradient(x + R * 0.2, y + R * 0.25, R * 0.05, x, y, R * 0.76);
    g.addColorStop(0, draw.shade(color, 0.12));
    g.addColorStop(1, draw.shade(color, -0.12));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R * 0.75, 0, Math.PI * 2); ctx.fill();
    // embossed inner ring
    g = ctx.createLinearGradient(x - R, y - R, x + R, y + R);
    g.addColorStop(0, draw.shade(color, 0.4));
    g.addColorStop(1, draw.shade(color, -0.35));
    ctx.strokeStyle = g;
    ctx.lineWidth = R * 0.05;
    ctx.beginPath(); ctx.arc(x, y, R * 0.48, 0, Math.PI * 2); ctx.stroke();
    // gloss
    g = ctx.createRadialGradient(x - R * 0.4, y - R * 0.45, 0, x - R * 0.4, y - R * 0.45, R * 0.6);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, R - 0.5, 0, Math.PI * 2); ctx.stroke();
    return { cv, size };
  }

  function makeBoard() {
    const { c, fx, fy, fw, fh, W, H } = L;
    const { cv, ctx } = offscreen(W, H);
    const blue = '#1f5ed6', dark = '#123a8c';
    // stands (behind the frame edges)
    for (const side of [-1, 1]) {
      const lx = side < 0 ? fx - 0.3 * c : fx + fw - 0.25 * c, lw = 0.55 * c;
      const top = fy + 0.2 * c, bottom = fy + fh + 0.55 * c;
      let g = ctx.createLinearGradient(lx, 0, lx + lw, 0);
      g.addColorStop(0, draw.shade(blue, 0.15)); g.addColorStop(0.45, blue); g.addColorStop(1, draw.shade(blue, -0.45));
      ctx.fillStyle = g;
      draw.roundRect(ctx, lx, top, lw, bottom - top, lw * 0.35);
      ctx.fill();
      // foot
      const fwid = 1.5 * c, cx = lx + lw / 2;
      g = ctx.createLinearGradient(0, bottom - 0.45 * c, 0, bottom);
      g.addColorStop(0, draw.shade(blue, 0.1)); g.addColorStop(1, draw.shade(blue, -0.5));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx - lw * 0.6, bottom - 0.5 * c);
      ctx.lineTo(cx + lw * 0.6, bottom - 0.5 * c);
      ctx.quadraticCurveTo(cx + fwid * 0.45, bottom - 0.2 * c, cx + fwid / 2, bottom);
      ctx.lineTo(cx - fwid / 2, bottom);
      ctx.quadraticCurveTo(cx - fwid * 0.45, bottom - 0.2 * c, cx - lw * 0.6, bottom - 0.5 * c);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(cx - fwid * 0.42, bottom - 0.12 * c, fwid * 0.84, 0.04 * c);
    }
    // frame body
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = c * 0.3;
    ctx.shadowOffsetY = c * 0.12;
    let g = ctx.createLinearGradient(0, fy, 0, fy + fh);
    g.addColorStop(0, '#3577ea'); g.addColorStop(0.5, blue); g.addColorStop(1, '#1749b0');
    ctx.fillStyle = g;
    draw.roundRect(ctx, fx, fy, fw, fh, c * 0.22);
    ctx.fill();
    ctx.restore();
    // holes
    const r = c * 0.385;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.beginPath();
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
      ctx.moveTo(colX(col) + r, rowY(row));
      ctx.arc(colX(col), rowY(row), r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();
    // bevels around each hole: inner wall (dark at the top-left, lit at the bottom-right) + raised lip
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
      const x = colX(col), y = rowY(row);
      g = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
      g.addColorStop(0, 'rgba(0,10,40,0.75)'); g.addColorStop(0.5, 'rgba(0,10,40,0.25)'); g.addColorStop(1, 'rgba(190,215,255,0.7)');
      ctx.strokeStyle = g;
      ctx.lineWidth = c * 0.07;
      ctx.beginPath(); ctx.arc(x, y, r + c * 0.03, 0, Math.PI * 2); ctx.stroke();
      g = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
      g.addColorStop(0, 'rgba(170,205,255,0.75)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,15,60,0.55)');
      ctx.strokeStyle = g;
      ctx.lineWidth = c * 0.045;
      ctx.beginPath(); ctx.arc(x, y, r + c * 0.085, 0, Math.PI * 2); ctx.stroke();
    }
    // moulded frame edges
    ctx.save();
    draw.roundRect(ctx, fx, fy, fw, fh, c * 0.22);
    ctx.clip();
    ctx.lineWidth = c * 0.12;
    g = ctx.createLinearGradient(0, fy, 0, fy + fh);
    g.addColorStop(0, 'rgba(200,225,255,0.75)'); g.addColorStop(0.08, 'rgba(255,255,255,0.05)');
    g.addColorStop(0.92, 'rgba(0,0,0,0.05)'); g.addColorStop(1, 'rgba(0,10,50,0.7)');
    ctx.strokeStyle = g;
    draw.roundRect(ctx, fx, fy, fw, fh, c * 0.22);
    ctx.stroke();
    // inner recessed panel line
    ctx.lineWidth = Math.max(1, c * 0.02);
    ctx.strokeStyle = 'rgba(0,15,60,0.45)';
    draw.roundRect(ctx, fx + M * c * 0.55, fy + M * c * 0.55, fw - M * c * 1.1, fh - M * c * 1.1, c * 0.14);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(170,205,255,0.35)';
    draw.roundRect(ctx, fx + M * c * 0.55 + 1.5, fy + M * c * 0.55 + 1.5, fw - M * c * 1.1, fh - M * c * 1.1, c * 0.14);
    ctx.stroke();
    // slots along the top
    for (let col = 0; col < COLS; col++) {
      const x = colX(col);
      ctx.fillStyle = 'rgba(0,10,40,0.7)';
      draw.roundRect(ctx, x - r * 0.95, fy + c * 0.035, r * 1.9, c * 0.07, c * 0.03);
      ctx.fill();
    }
    // plastic sheen
    g = ctx.createLinearGradient(fx, fy, fx + fw, fy + fh);
    g.addColorStop(0, 'rgba(255,255,255,0.14)');
    g.addColorStop(0.35, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(fx, fy, fw, fh);
    ctx.restore();
    return cv;
  }

  // =====================================================================================
  // Game flow
  // =====================================================================================
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
    updateUndo();
    showKeyHelp();
    overlay({
      title: 'Connect Four',
      text: 'Drop discs to get four in a row —\nacross, down or diagonally.',
      buttons: [
        { label: '👥 2 Players', onClick: () => start('2p') },
        { label: '🤖 vs Computer', kind: 'good', onClick: chooseLevel },
      ],
    });
  }

  function chooseLevel() {
    overlay({
      title: 'vs Computer',
      text: 'You play Red, the computer plays Yellow.\nPick a difficulty:',
      buttons: [
        { label: '😊 Easy', kind: 'good', onClick: () => start('cpu', 'easy') },
        { label: '🙂 Medium', onClick: () => start('cpu', 'medium') },
        { label: '🧠 Hard', kind: 'bad', onClick: () => start('cpu', 'hard') },
        { label: '← Back', kind: 'secondary', onClick: showMenu },
      ],
    });
  }

  function start(mode, level) {
    S.mode = mode;
    S.level = level || null;
    S.scores = { 1: 0, 2: 0, D: 0 };
    S.starter = YEL; // flipped by newRound → Red starts round 1
    newRound();
    showKeyHelp();
  }

  function clearFlow() {
    S.round++;
    S.timers = [];
    S.aiThinking = false;
    S.aiAim = -1;
    S.aim = -1;
    owner = null;
  }

  function newRound() {
    clearFlow();
    // old discs fall out of the bottom (the release slider)
    for (const d of S.discs) S.ghosts.push({ col: d.col, y: d.y, vy: util.rand(0, 2), p: d.p, down: true });
    if (S.discs.length) sfx.play('whoosh', { volume: 0.9 });
    S.cells = new Int8Array(42);
    S.heights = new Int8Array(7);
    S.discs = [];
    S.moves = [];
    S.falling = null;
    S.result = null;
    S.win = null;
    S.starter = 3 - S.starter;
    S.turn = S.starter;
    S.phase = 'play';
    updateUndo();
    later(0.25, nextTurn);
  }

  function later(sec, fn) {
    const round = S.round;
    S.timers.push({ t: sec, fn: () => { if (round === S.round) fn(); } });
  }

  function nextTurn() {
    if (S.phase !== 'play') return;
    if (isCpu(S.turn)) requestAi();
  }

  function requestAi() {
    S.aiThinking = true;
    const round = S.round, t0 = performance.now();
    Engine.run({ cells: Array.from(S.cells), player: S.turn, first: S.starter, level: S.level, timeMs: 700 }, res => {
      if (round !== S.round || S.phase !== 'play') return;
      const wait = Math.max(0, 0.55 - (performance.now() - t0) / 1000);
      later(wait, () => {
        let col = res.col;
        if (col < 0 || S.heights[col] >= ROWS) col = [3, 2, 4, 1, 5, 0, 6].find(c => S.heights[c] < ROWS);
        S.aiAim = col;
        S.lastAi = res;
        S.previewShow = Math.max(S.previewShow, 0.01);
        const dist = Math.abs(S.previewX - col);
        later(0.25 + dist * 0.07, () => { S.aiThinking = false; S.aiAim = -1; drop(col); });
      });
    });
  }

  function canHumanPlay() {
    return S.phase === 'play' && !S.falling && !S.aiThinking && !isCpu(S.turn) && !IFPD.overlay.visible;
  }

  function lineThrough(r, c, p) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
      const line = [[r, c]];
      for (const s of [1, -1]) {
        for (let k = 1; k < 7; k++) {
          const rr = r + dr * k * s, cc = c + dc * k * s;
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || S.cells[rr * 7 + cc] !== p) break;
          line.push([rr, cc]);
        }
      }
      if (line.length >= 4) return line;
    }
    return null;
  }

  function drop(col) {
    if (S.phase !== 'play' || S.falling || S.heights[col] >= ROWS) return false;
    const p = S.turn, r = S.heights[col]++;
    S.cells[r * 7 + col] = p;
    S.moves.push({ col, r, p });
    const d = { col, r, p, y: PREVIEW_Y, vy: 0, target: ROWS - 1 - r, bounces: 0 };
    S.discs.push(d);
    S.falling = d;
    const line = lineThrough(r, col, p);
    S.result = line ? { winner: p, line } : (S.moves.length === 42 ? { winner: 0 } : null);
    sfx.play('click', { volume: 0.8, pan: (col - 3) / 4 });
    updateUndo();
    return true;
  }

  function landed() {
    S.falling = null;
    if (S.result) {
      S.phase = 'ending';
      updateUndo();
      const res = S.result;
      if (res.winner) {
        S.win = res.line; S.winT = 0;
        if (isCpu(res.winner)) sfx.play('lose'); else { sfx.play('win'); IFPD.confetti(2500); }
      } else sfx.play('ding', { pitch: 0.8 });
      later(res.winner ? 1.6 : 0.8, () => endRound(res.winner));
      return;
    }
    S.turn = 3 - S.turn;
    updateUndo();
    nextTurn();
  }

  function endRound(winner) {
    S.phase = 'over';
    let title;
    if (winner) {
      S.scores[winner]++;
      title = S.mode === 'cpu' ? (winner === RED ? '🎉 You win!' : '🤖 Computer wins!') : `🎉 ${CNAME[winner]} wins!`;
    } else {
      S.scores.D++;
      title = "🤝 It's a draw!";
    }
    const sc = S.scores, next = 3 - S.starter;
    overlay({
      title,
      text: `${nameOf(RED)}: ${sc[1]}  ·  ${nameOf(YEL)}: ${sc[2]}  ·  Draws: ${sc.D}\n${nameOf(next)} ${next === RED && S.mode === 'cpu' ? 'go' : 'goes'} first next round.`,
      buttons: [
        { label: '▶ Play again', kind: 'good', onClick: newRound },
        { label: 'Change mode', kind: 'secondary', onClick: () => { clearFlow(); showMenu(); } },
      ],
    });
  }

  function undoMove() {
    if (S.mode !== '2p' || S.phase !== 'play' || S.falling || !S.moves.length) { sfx.play('tick'); return; }
    const m = S.moves.pop();
    S.cells[m.r * 7 + m.col] = 0;
    S.heights[m.col]--;
    const idx = S.discs.findIndex(d => d.col === m.col && d.r === m.r);
    const d = S.discs.splice(idx, 1)[0];
    S.ghosts.push({ col: d.col, y: d.y, vy: -14, p: d.p, down: false });
    S.turn = m.p;
    S.aim = -1;
    owner = null;
    sfx.play('flip', { pan: (m.col - 3) / 4 });
    updateUndo();
  }

  function updateUndo() {
    undoBtn.hidden = S.mode !== '2p' || S.phase === 'menu';
    undoBtn.disabled = !(S.phase === 'play' && !S.falling && S.moves.length > 0);
  }

  function restart() {
    sfx.play('click');
    clearFlow();
    showMenu();
  }

  // =====================================================================================
  // Input — one pointer at a time owns the aiming disc
  // =====================================================================================
  function colAt(x, y, loose) {
    if (!L) return -1;
    const { c, fx, fy, fh } = L;
    const left = fx + M * c, col = Math.floor((x - left) / c);
    if (x < left - c * 0.25 || x > left + COLS * c + c * 0.25) return -1;
    if (!loose && (y < fy - 2.2 * c || y > fy + fh + 0.3 * c)) return -1;
    return util.clamp(col, 0, COLS - 1);
  }

  IFPD.pointers(canvas, {
    down(p) {
      const col = colAt(p.x, p.y, false);
      if (col < 0) return false;
      if (owner !== null) return false;               // another student is already aiming
      if (!canHumanPlay()) { sfx.play('tick', { volume: 0.5 }); return false; }
      owner = p.id;
      if (S.previewShow < 0.05) S.previewX = col;
      S.aim = col;
      sfx.play('tick', { pan: (col - 3) / 4 });
      return true;
    },
    move(p) {
      if (p.id !== owner) return;
      const col = colAt(p.x, p.y, true);
      if (col !== S.aim) {
        S.aim = col;
        if (col >= 0) sfx.play('tick', { volume: 0.7, pan: (col - 3) / 4 });
      }
    },
    up(p) {
      if (p.id !== owner) return;
      owner = null;
      const col = S.aim;
      S.aim = -1;
      if (col < 0 || !canHumanPlay()) return;
      if (S.heights[col] >= ROWS) {
        sfx.play('wrong', { volume: 0.6 });
        IFPD.toast('That column is full', 1200);
        return;
      }
      drop(col);
    },
  });

  // =====================================================================================
  // Keyboard — 1–7 drop straight into a column; ← → move the hovering disc, ↓ / Enter / Space
  // drop it; Backspace or U = Undo (2 players). Same locks as touch.
  // =====================================================================================
  const kbMode = () => !!window.CosmiqInput && CosmiqInput.mode === 'keyboard';

  function showKeyHelp() {
    if (!window.CosmiqInput) return;
    if (S.phase === 'menu') { CosmiqInput.keys.help('Connect Four', [['Tab ← →', 'Choose'], ['Enter', 'Select']]); return; }
    const rows = [['1 – 7', 'Drop into that column'], ['← →', 'Move the disc'], ['↓ Enter Space', 'Drop it']];
    if (S.mode === '2p') rows.push(['Backspace U', 'Undo']);
    CosmiqInput.keys.help('Connect Four', rows);
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

  function keyDrop(col) {
    if (owner !== null || !canHumanPlay()) { sfx.play('tick', { volume: 0.5 }); return; }
    S.previewX = col;
    if (S.heights[col] >= ROWS) {
      S.aim = col;
      sfx.play('wrong', { volume: 0.6 });
      IFPD.toast('That column is full', 1200);
      return;
    }
    S.aim = -1;
    drop(col);
  }

  if (window.CosmiqInput) CosmiqInput.keys.on(e => {
    if (e.type !== 'keydown' || S.phase !== 'play' || IFPD.overlay.visible) return;
    const k = e.key, cur = S.aim >= 0 ? S.aim : util.clamp(Math.round(S.previewX), 0, COLS - 1);
    if (/^(Digit|Numpad)[1-7]$/.test(e.code)) {
      e.preventDefault();
      if (!e.repeat) keyDrop(Number(e.code.slice(-1)) - 1);
    } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      if (owner !== null || !canHumanPlay()) return;
      const col = util.clamp(cur + (k === 'ArrowLeft' ? -1 : 1), 0, COLS - 1);
      if (S.previewShow < 0.05) S.previewX = cur;
      S.aim = col;
      sfx.play('tick', { volume: col === cur ? 0.3 : 0.7, pan: (col - 3) / 4 });
    } else if (k === 'ArrowDown' || k === 'Enter' || k === ' ') {
      if (k !== 'ArrowDown' && keyForButton(e)) return;
      e.preventDefault();
      if (!e.repeat) keyDrop(cur);
    } else if (e.code === 'Backspace' || e.code === 'KeyU') {
      e.preventDefault();
      if (!e.repeat && S.mode === '2p') undoMove();
    }
  });

  // Column numbers in key caps along the top of the frame (keyboard mode).
  function drawColumnKeys(ctx) {
    if (!kbMode() || S.phase !== 'play') return;
    const { c, fy } = L, w = c * 0.42, h = c * 0.34;
    const sel = canHumanPlay() ? (S.aim >= 0 ? S.aim : Math.round(S.previewX)) : -1;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${c * 0.25}px "Segoe UI", system-ui, Roboto, sans-serif`;
    for (let col = 0; col < COLS; col++) {
      const x = colX(col), y = fy + c * 0.05, on = col === sel;
      ctx.fillStyle = on ? '#ffd27a' : 'rgba(10,20,50,0.82)';
      draw.roundRect(ctx, x - w / 2, y - h / 2, w, h, c * 0.07);
      ctx.fill();
      ctx.lineWidth = Math.max(1, c * 0.02);
      ctx.strokeStyle = on ? '#fff6d8' : 'rgba(200,220,255,0.55)';
      ctx.stroke();
      ctx.fillStyle = on ? '#1b1c22' : '#f3f1ea';
      ctx.fillText(String(col + 1), x, y + c * 0.01);
    }
    ctx.restore();
  }

  // =====================================================================================
  // Update & render
  // =====================================================================================
  function update(dt) {
    S.time += dt;
    S.winT += dt;
    for (let k = S.timers.length - 1; k >= 0; k--) {
      const tm = S.timers[k];
      tm.t -= dt;
      if (tm.t <= 0) { S.timers.splice(k, 1); tm.fn(); }
    }
    const d = S.falling;
    if (d) {
      d.vy += GRAV * dt;
      d.y += d.vy * dt;
      if (d.y >= d.target) {
        d.y = d.target;
        const v = d.vy;
        const pan = (d.col - 3) / 4;
        if (d.bounces === 0) {
          const vol = util.clamp(v / 25, 0.45, 1);
          sfx.play('drop', { volume: vol, pan, pitch: 1 + d.target * 0.03 });
          sfx.play('hit', { volume: vol * 0.6, pan, pitch: 1.3 });
        } else if (v > 3) sfx.play('tap', { volume: 0.4, pan });
        d.bounces++;
        d.vy = -v * 0.28;
        if (d.vy > -2 || d.bounces > 2) { d.vy = 0; landed(); }
      }
    }
    for (let k = S.ghosts.length - 1; k >= 0; k--) {
      const g = S.ghosts[k];
      if (g.down) { g.vy += GRAV * dt; g.y += g.vy * dt; if (g.y > ROWS + 3) S.ghosts.splice(k, 1); }
      else { g.vy -= 10 * dt; g.y += g.vy * dt; if (g.y < PREVIEW_Y - 2) S.ghosts.splice(k, 1); }
    }
    // aiming disc
    const target = S.aiAim >= 0 ? S.aiAim : S.aim;
    if (target >= 0) S.previewX += (target - S.previewX) * Math.min(1, dt * 18);
    const show = S.phase === 'play' && !S.falling && (target >= 0 || !isCpu(S.turn) || S.aiThinking) ? 1 : 0;
    S.previewShow += (show - S.previewShow) * Math.min(1, dt * 12);
  }

  function discAt(ctx, p, x, y, alpha) {
    const sp = L.sprite[p];
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    ctx.drawImage(sp.cv, x - sp.size / 2, y - sp.size / 2, sp.size, sp.size);
    ctx.globalAlpha = 1;
  }

  function render() {
    if (!L || L.W !== view.width || L.H !== view.height) layout();
    const ctx = view.ctx, { c } = L;
    ctx.drawImage(L.bg, 0, 0, L.W, L.H);
    // discs live behind the frame
    for (const g of S.ghosts) {
      if (!g.down) { discAt(ctx, g.p, colX(g.col), rowY(g.y)); continue; }
      ctx.save();                     // released discs drop out through the bottom of the frame
      ctx.beginPath(); ctx.rect(0, 0, L.W, L.fy + L.fh - c * 0.1); ctx.clip();
      discAt(ctx, g.p, colX(g.col), rowY(g.y));
      ctx.restore();
    }
    for (const d of S.discs) discAt(ctx, d.p, colX(d.col), rowY(d.y));
    ctx.drawImage(L.board, 0, 0, L.W, L.H);
    // win highlight
    if (S.win) {
      const pulse = 0.5 + 0.5 * Math.sin(S.winT * 7);
      const inLine = new Set(S.win.map(([r, cc]) => r * 7 + cc));
      for (const d of S.discs) {
        if (inLine.has(d.r * 7 + d.col)) continue;
        ctx.fillStyle = `rgba(0,0,20,${Math.min(0.45, S.winT * 0.6)})`;
        ctx.beginPath(); ctx.arc(colX(d.col), rowY(d.y), c * 0.39, 0, Math.PI * 2); ctx.fill();
      }
      ctx.save();
      ctx.shadowColor = '#fff6c0';
      ctx.shadowBlur = c * 0.3;
      ctx.lineWidth = c * (0.07 + 0.03 * pulse);
      ctx.strokeStyle = `rgba(255,250,215,${0.75 + 0.25 * pulse})`;
      for (const [r, cc] of S.win) {
        ctx.beginPath(); ctx.arc(colX(cc), rowY(ROWS - 1 - r), c * 0.36, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
    // aiming disc above the board
    if (S.previewShow > 0.02) {
      const x = colX(util.clamp(S.previewX, 0, COLS - 1)), bob = Math.sin(S.time * 3) * c * 0.04;
      const aiming = S.aim >= 0 || S.aiAim >= 0;
      const y = rowY(PREVIEW_Y) + bob;
      draw.shadow(ctx, x + c * 0.05, L.fy - c * 0.02, L.R * 0.9, c * 0.08, 0.35 * S.previewShow);
      discAt(ctx, S.turn, x, y, S.previewShow * (aiming ? 1 : 0.55));
      if (aiming && S.aim >= 0 && S.heights[S.aim] >= ROWS) {
        ctx.strokeStyle = 'rgba(255,60,60,0.9)';
        ctx.lineWidth = c * 0.08;
        ctx.beginPath(); ctx.moveTo(x - L.R * 0.6, y - L.R * 0.6); ctx.lineTo(x + L.R * 0.6, y + L.R * 0.6); ctx.stroke();
      } else if (aiming) {
        // faint guide showing where it will land
        const row = ROWS - 1 - S.heights[Math.round(S.previewX)];
        if (row >= 0) {
          ctx.strokeStyle = 'rgba(255,255,255,0.55)';
          ctx.setLineDash([c * 0.1, c * 0.08]);
          ctx.lineWidth = c * 0.04;
          ctx.beginPath(); ctx.arc(colX(Math.round(S.previewX)), rowY(row), c * 0.3, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
    drawColumnKeys(ctx);
    drawPanels(ctx);
  }

  function drawPanels(ctx) {
    const { c } = L;
    for (const p of [RED, YEL]) {
      const b = L.panels[p], active = S.phase === 'play' && S.turn === p;
      ctx.save();
      ctx.shadowColor = active ? COLOR[p] : 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = active ? c * (0.35 + 0.12 * Math.sin(S.time * 5)) : c * 0.25;
      ctx.shadowOffsetY = active ? 0 : c * 0.08;
      const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      g.addColorStop(0, '#2e2f38'); g.addColorStop(1, '#1b1c22');
      ctx.fillStyle = g;
      draw.roundRect(ctx, b.x, b.y, b.w, b.h, c * 0.2);
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = active ? c * 0.05 : 1.5;
      ctx.strokeStyle = active ? COLOR[p] : 'rgba(255,255,255,0.12)';
      draw.roundRect(ctx, b.x, b.y, b.w, b.h, c * 0.2);
      ctx.stroke();
      ctx.fillStyle = '#f3f1ea';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const font = (wt, px) => `${wt} ${px}px "Segoe UI", system-ui, Roboto, sans-serif`;
      let status = '';
      if (active) {
        if (isCpu(p)) status = 'Thinking' + '.'.repeat(1 + Math.floor(S.time * 3) % 3);
        else status = S.mode === 'cpu' ? 'Your turn!' : 'Your turn!';
      } else if (S.phase !== 'play' && S.win && S.result && S.result.winner === p) status = 'Winner!';
      if (L.land) {
        discAt(ctx, p, b.x + b.w / 2, b.y + c * 0.75);
        ctx.font = font(700, c * 0.38);
        ctx.fillText(fitText(ctx, nameOf(p), b.w * 0.9), b.x + b.w / 2, b.y + c * 1.55);
        ctx.font = font(800, c * 0.95);
        ctx.fillText(String(S.scores[p]), b.x + b.w / 2, b.y + c * 2.35);
        ctx.font = font(600, c * 0.3);
        ctx.fillStyle = active ? draw.shade(COLOR[p], 0.35) : '#f3d36b';
        ctx.fillText(status, b.x + b.w / 2, b.y + c * 3.15);
      } else {
        discAt(ctx, p, b.x + c * 0.7, b.y + b.h / 2);
        ctx.textAlign = 'left';
        ctx.font = font(700, c * 0.32);
        ctx.fillText(fitText(ctx, nameOf(p), b.w - c * 2.45), b.x + c * 1.3, b.y + b.h * 0.33);
        ctx.font = font(600, c * 0.28);
        ctx.fillStyle = active ? draw.shade(COLOR[p], 0.35) : '#f3d36b';
        ctx.fillText(status, b.x + c * 1.3, b.y + b.h * 0.7);
        ctx.fillStyle = '#f3f1ea';
        ctx.textAlign = 'right';
        ctx.font = font(800, c * 0.8);
        ctx.fillText(String(S.scores[p]), b.x + b.w - c * 0.3, b.y + b.h / 2);
      }
    }
    if (S.mode) {
      ctx.textAlign = 'center';
      ctx.font = `600 ${c * 0.3}px "Segoe UI", system-ui, Roboto, sans-serif`;
      ctx.fillStyle = 'rgba(255,245,225,0.85)';
      ctx.shadowColor = 'rgba(0,0,0,0.7)';
      ctx.shadowBlur = 6;
      const lvl = S.level ? ` · ${S.level[0].toUpperCase()}${S.level.slice(1)}` : '';
      ctx.fillText(`${S.mode === 'cpu' ? 'vs Computer' + lvl : '2 Players'}  ·  Draws: ${S.scores.D}`, L.info.x, L.info.y);
      ctx.shadowBlur = 0;
    }
  }

  function fitText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

  IFPD.loop(update, render);
  layout();
  showMenu();

  // debug hook for automated tests
  window.__game = {
    S, Engine, get L() { return L; },
    canPlay: canHumanPlay,
    colClient(col, y) {
      const r = canvas.getBoundingClientRect();
      return { x: r.left + colX(col), y: r.top + (y === undefined ? rowY(2) : rowY(y)) };
    },
  };
})();
