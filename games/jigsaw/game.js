/* Jigsaw Puzzle for classroom IFPD — procedural pictures or your own photo, multi-touch dragging. */
(function () {
  'use strict';
  const { util, draw, sfx } = IFPD;
  const canvas = document.getElementById('game');
  const PAD = 0.36;      // sprite padding around a cell (tabs reach ~0.34)
  const SNAP = 0.3;      // snap distance (cell units)
  const SIZES = [12, 24, 48, 96];

  // ===================================================================================
  // Seeded random + painting helpers
  // ===================================================================================
  function mulberry(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function lin(ctx, x0, y0, x1, y1, stops) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const [o, c] of stops) g.addColorStop(o, c);
    return g;
  }
  function rad(ctx, x, y, r0, r1, stops) {
    const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
    for (const [o, c] of stops) g.addColorStop(o, c);
    return g;
  }
  // fractal ridge line across the width
  function ridge(R, W, base, amp, rough, n) {
    const pts = new Array(n + 1).fill(0);
    pts[0] = R() * amp; pts[n] = R() * amp;
    (function sub(a, b, h) {
      if (b - a < 2) return;
      const m = (a + b) >> 1;
      pts[m] = (pts[a] + pts[b]) / 2 + (R() - 0.5) * h;
      sub(a, m, h * rough); sub(m, b, h * rough);
    })(0, n, amp);
    return pts.map((v, i) => [(i / n) * W, base - Math.abs(v)]);
  }
  function polyFill(ctx, pts, bottom, style) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], bottom);
    for (const p of pts) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(pts[pts.length - 1][0], bottom);
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
  }
  function cloud(ctx, R, x, y, w, lit, shade) {
    const puffs = 7 + Math.floor(R() * 5);
    ctx.save();
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < puffs; i++) {
        const px = x + (i / (puffs - 1) - 0.5) * w, pr = w * (0.12 + R() * 0.1) * (1 - Math.abs(i / (puffs - 1) - 0.5) * 0.9);
        const py = y - pr * 0.4 - R() * pr * 0.4;
        ctx.fillStyle = pass ? rad(ctx, px - pr * 0.3, py - pr * 0.4, 0, pr * 1.2, [[0, lit], [1, shade]]) : 'rgba(0,0,0,0.05)';
        ctx.beginPath(); ctx.arc(px + (pass ? 0 : 4), py + (pass ? 0 : 6), pr, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }
  function tree(ctx, R, x, y, s, greens) {
    ctx.fillStyle = '#5a3b22';
    ctx.fillRect(x - s * 0.08, y - s * 0.6, s * 0.16, s * 0.6);
    for (let i = 0; i < 9; i++) {
      const a = R() * Math.PI * 2, d = R() * s * 0.35;
      const px = x + Math.cos(a) * d, py = y - s * 0.95 + Math.sin(a) * d * 0.8, pr = s * (0.25 + R() * 0.15);
      ctx.fillStyle = rad(ctx, px - pr * 0.4, py - pr * 0.4, 0, pr, [[0, greens[0]], [1, greens[1]]]);
      ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
    }
  }
  function pine(ctx, x, y, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x - h * 0.03, y - h * 0.15, h * 0.06, h * 0.15);
    for (let k = 0; k < 4; k++) {
      const ty = y - h * 0.12 - k * h * 0.22, w = h * (0.32 - k * 0.06);
      ctx.beginPath(); ctx.moveTo(x - w, ty); ctx.lineTo(x, ty - h * 0.38); ctx.lineTo(x + w, ty); ctx.closePath(); ctx.fill();
    }
  }
  function fish(ctx, x, y, len, dir, body, fin, stripes) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    const h = len * 0.42;
    // tail
    ctx.fillStyle = fin;
    ctx.beginPath(); ctx.moveTo(-len * 0.42, 0); ctx.lineTo(-len * 0.68, -h * 0.55); ctx.quadraticCurveTo(-len * 0.58, 0, -len * 0.68, h * 0.55); ctx.closePath(); ctx.fill();
    // dorsal fin
    ctx.beginPath(); ctx.moveTo(-len * 0.2, -h * 0.4); ctx.quadraticCurveTo(0, -h * 0.95, len * 0.15, -h * 0.42); ctx.fill();
    // body
    ctx.fillStyle = lin(ctx, 0, -h / 2, 0, h / 2, [[0, draw.shade(body, 0.25)], [0.6, body], [1, draw.shade(body, -0.35)]]);
    ctx.beginPath();
    ctx.moveTo(len * 0.5, 0);
    ctx.bezierCurveTo(len * 0.35, -h * 0.65, -len * 0.3, -h * 0.6, -len * 0.45, 0);
    ctx.bezierCurveTo(-len * 0.3, h * 0.6, len * 0.35, h * 0.65, len * 0.5, 0);
    ctx.fill();
    if (stripes) {
      ctx.save(); ctx.clip();
      for (const sx of stripes) {
        ctx.fillStyle = '#111';
        ctx.fillRect(len * sx - len * 0.07, -h, len * 0.14, h * 2);
        ctx.fillStyle = '#fafafa';
        ctx.fillRect(len * sx - len * 0.05, -h, len * 0.1, h * 2);
      }
      ctx.restore();
    }
    // eye + gill
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(len * 0.3, -h * 0.1, len * 0.06, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(len * 0.31, -h * 0.1, len * 0.035, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = len * 0.02;
    ctx.beginPath(); ctx.arc(len * 0.12, 0, h * 0.4, -0.9, 0.9); ctx.stroke();
    ctx.restore();
  }

  // ===================================================================================
  // The four built-in scenes (1500 × 1000)
  // ===================================================================================
  function paintLake(ctx, W, H, R) {
    const hz = H * 0.57;
    ctx.fillStyle = lin(ctx, 0, 0, 0, hz, [[0, '#1b1546'], [0.3, '#4f2a78'], [0.58, '#c94f6d'], [0.82, '#ff944f'], [1, '#ffd27c']]);
    ctx.fillRect(0, 0, W, hz);
    for (let i = 0; i < 70; i++) { ctx.fillStyle = `rgba(255,255,255,${R() * 0.6})`; ctx.fillRect(R() * W, R() * hz * 0.3, 2, 2); }
    const sx = W * 0.63, sy = hz - H * 0.12;
    ctx.fillStyle = rad(ctx, sx, sy, 0, W * 0.5, [[0, 'rgba(255,235,170,0.95)'], [0.12, 'rgba(255,190,110,0.5)'], [0.45, 'rgba(255,120,90,0.12)'], [1, 'rgba(255,120,90,0)']]);
    ctx.fillRect(0, 0, W, hz);
    ctx.fillStyle = '#fff4cf';
    ctx.beginPath(); ctx.arc(sx, sy, H * 0.055, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 9; i++) {
      const cx = R() * W, cy = H * (0.06 + R() * 0.3), w = W * (0.12 + R() * 0.2), h = H * (0.012 + R() * 0.02);
      ctx.fillStyle = lin(ctx, 0, cy - h, 0, cy + h, [[0, 'rgba(90,50,120,0.75)'], [0.6, 'rgba(230,110,120,0.85)'], [1, 'rgba(255,190,120,0.9)']]);
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(cx + (R() - 0.5) * w * 0.5, cy + (R() - 0.5) * h, w * (0.3 + R() * 0.3), h * (0.8 + R() * 0.6), 0, 0, Math.PI * 2); ctx.fill(); }
    }
    const ranges = [
      { peak: H * 0.26, amp: H * 0.24, col: ['#b98ac4', '#7d5c9e'], snow: true, dip: 0.75 },
      { peak: H * 0.15, amp: H * 0.15, col: ['#7d5590', '#4a3670'], snow: true, dip: 0.6 },
      { peak: H * 0.06, amp: H * 0.07, col: ['#3d2f5c', '#231d3d'], snow: false, dip: 0.2 },
    ];
    for (const rg of ranges) {
      const pts = ridge(R, W, hz - rg.peak + rg.amp * 0.5, rg.amp, 0.55, 64);
      for (const p of pts) {
        const f = 1 - rg.dip * Math.exp(-Math.pow((p[0] - sx) / (W * 0.13), 2)); // valley where the sun sets
        p[1] = Math.min(hz - (hz - p[1]) * f, hz - 4);
      }
      polyFill(ctx, pts, hz + 2, lin(ctx, 0, hz - rg.peak - rg.amp * 0.4, 0, hz, [[0, rg.col[0]], [1, rg.col[1]]]));
      // rim light on the slopes facing the sun
      ctx.save();
      ctx.beginPath(); ctx.moveTo(0, hz); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.lineTo(W, hz); ctx.closePath(); ctx.clip();
      ctx.fillStyle = rad(ctx, sx, sy, 0, W * 0.4, [[0, 'rgba(255,170,120,0.35)'], [1, 'rgba(255,170,120,0)']]);
      ctx.fillRect(0, 0, W, hz);
      ctx.restore();
      if (rg.snow) {
        ctx.save();
        ctx.beginPath(); ctx.moveTo(0, hz); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.lineTo(W, hz); ctx.closePath(); ctx.clip();
        const top = Math.min(...pts.map(p => p[1]));
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (const p of pts) ctx.lineTo(p[0], p[1]);
        for (let i = pts.length - 1; i >= 0; i--) {
          const p = pts[i], depth = Math.max(0, (top + rg.amp * 0.3 - p[1])) * (0.45 + R() * 0.4);
          ctx.lineTo(p[0], p[1] + depth);
        }
        ctx.closePath();
        ctx.fillStyle = lin(ctx, 0, top, 0, top + rg.amp * 0.5, [[0, '#fff1f4'], [1, '#e2b9d6']]);
        ctx.fill();
        ctx.restore();
      }
    }
    // pine shoreline
    for (let x = -10; x < W + 20; x += 6 + R() * 12) {
      const h = H * (0.04 + R() * 0.07) * (x < W * 0.35 || x > W * 0.8 ? 1.4 : 0.8);
      pine(ctx, x, hz + 3, h, R() < 0.5 ? '#14211f' : '#1b2a24');
    }
    // reflection
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = Math.ceil(hz);
    tmp.getContext('2d').drawImage(ctx.canvas, 0, 0, W, hz, 0, 0, W, hz);
    ctx.save();
    ctx.translate(0, hz * 2);
    ctx.scale(1, -1);
    ctx.globalAlpha = 0.6;
    for (let y = 0; y < hz; y += 3) {
      const off = Math.sin(y * 0.15) * 3 * (1 - y / hz);
      ctx.drawImage(tmp, 0, y, W, 3, off, y, W, 3);
    }
    ctx.restore();
    ctx.fillStyle = lin(ctx, 0, hz, 0, H, [[0, 'rgba(60,40,110,0.35)'], [1, 'rgba(15,15,45,0.85)']]);
    ctx.fillRect(0, hz, W, H - hz);
    // sun glitter
    for (let i = 0; i < 160; i++) {
      const t = R(), y = hz + 4 + Math.pow(t, 1.6) * (H - hz);
      const spread = 20 + (y - hz) * 0.45, x = sx + (R() - 0.5) * spread * 2;
      ctx.fillStyle = `rgba(255,${190 + R() * 60 | 0},120,${0.25 + R() * 0.5})`;
      ctx.fillRect(x, y, 10 + R() * 40 * (y - hz) / (H - hz) + 6, 2 + (y - hz) / 140);
    }
    for (let i = 0; i < 220; i++) {
      const y = hz + Math.pow(R(), 1.4) * (H - hz);
      ctx.fillStyle = `rgba(255,220,255,${0.05 + R() * 0.12})`;
      ctx.fillRect(R() * W, y, 20 + R() * 80, 1.5);
    }
    // dock
    ctx.save();
    const d0 = [W * 0.02, H], d1 = [W * 0.28, H], d2 = [W * 0.24, H * 0.72], d3 = [W * 0.17, H * 0.72];
    for (let k = 0; k < 6; k++) {
      const t = k / 5, px = util.lerp(d0[0] + 20, d3[0] + 6, t), py = util.lerp(H, d3[1], t);
      const pw = util.lerp(26, 9, t);
      ctx.fillStyle = '#2a1b12';
      ctx.fillRect(px - pw / 2, py - 4, pw, util.lerp(90, 30, t));
      ctx.fillRect(px - pw / 2 + util.lerp(d1[0] - d0[0] - 40, d2[0] - d3[0] - 12, t), py - 4, pw, util.lerp(90, 30, t));
    }
    ctx.beginPath(); ctx.moveTo(...d0); ctx.lineTo(...d1); ctx.lineTo(...d2); ctx.lineTo(...d3); ctx.closePath();
    ctx.fillStyle = lin(ctx, 0, H * 0.72, 0, H, [[0, '#7a5235'], [1, '#a8754a']]);
    ctx.fill();
    ctx.clip();
    for (let k = 0; k < 26; k++) {
      const t = Math.pow(k / 26, 0.8), y = util.lerp(H, H * 0.72, t);
      ctx.strokeStyle = 'rgba(40,20,10,0.6)'; ctx.lineWidth = util.lerp(3, 1, t);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W * 0.3, y); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,200,150,0.25)';
      ctx.beginPath(); ctx.moveTo(0, y + 2); ctx.lineTo(W * 0.3, y + 2); ctx.stroke();
    }
    ctx.restore();
    // rowboat
    ctx.save();
    ctx.translate(W * 0.42, H * 0.86);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(0, 18, 150, 16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-150, -20); ctx.quadraticCurveTo(-120, 30, -40, 32); ctx.lineTo(110, 30); ctx.quadraticCurveTo(150, 10, 160, -24); ctx.closePath();
    ctx.fillStyle = lin(ctx, 0, -20, 0, 32, [[0, '#d0453a'], [1, '#7a1d18']]); ctx.fill();
    ctx.fillStyle = '#f2ebe0'; ctx.fillRect(-140, -18, 296, 7);
    ctx.fillStyle = '#5c3a22';
    ctx.beginPath(); ctx.ellipse(5, -22, 148, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8a5a34'; ctx.fillRect(-30, -30, 18, 10); ctx.fillRect(40, -30, 18, 10);
    ctx.strokeStyle = '#c99a62'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(-60, -26); ctx.lineTo(-170, 30); ctx.stroke();
    ctx.restore();
    // reeds
    for (let i = 0; i < 40; i++) {
      const x = W * (0.82 + R() * 0.2), h = H * (0.12 + R() * 0.16), bend = (R() - 0.3) * 40;
      ctx.strokeStyle = R() < 0.5 ? '#2f4a22' : '#3d5e2a'; ctx.lineWidth = 3 + R() * 3;
      ctx.beginPath(); ctx.moveTo(x, H); ctx.quadraticCurveTo(x + bend * 0.3, H - h * 0.6, x + bend, H - h); ctx.stroke();
      if (R() < 0.4) { ctx.fillStyle = '#5b3a1f'; ctx.beginPath(); ctx.ellipse(x + bend, H - h + 14, 7, 22, bend / 200, 0, Math.PI * 2); ctx.fill(); }
    }
    // birds
    ctx.strokeStyle = '#2a1840'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const bx = W * (0.25 + R() * 0.3), by = H * (0.12 + R() * 0.15), s = 10 + R() * 12;
      ctx.beginPath(); ctx.moveTo(bx - s, by - s * 0.3); ctx.quadraticCurveTo(bx - s * 0.4, by - s * 0.6, bx, by); ctx.quadraticCurveTo(bx + s * 0.4, by - s * 0.6, bx + s, by - s * 0.3); ctx.stroke();
    }
  }

  function paintReef(ctx, W, H, R) {
    ctx.fillStyle = lin(ctx, 0, 0, 0, H, [[0, '#5fd6f2'], [0.3, '#1f97d4'], [0.7, '#0e5596'], [1, '#08305e']]);
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 8; i++) {
      const x = W * (0.1 + R() * 0.9), w = 40 + R() * 90, sk = -200 - R() * 200;
      ctx.fillStyle = lin(ctx, 0, 0, 0, H * 0.8, [[0, 'rgba(255,255,255,0.16)'], [1, 'rgba(255,255,255,0)']]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + w, 0); ctx.lineTo(x + w * 2.5 + sk, H * 0.8); ctx.lineTo(x + sk, H * 0.8); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
    for (let i = 0; i < 30; i++) {
      const y = R() * H * 0.08, x = R() * W;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 30, y + 8, x + 60 + R() * 40, y); ctx.stroke();
    }
    // distant reef
    ctx.fillStyle = 'rgba(20,90,140,0.55)';
    for (let i = 0; i < 14; i++) { ctx.beginPath(); ctx.ellipse(R() * W, H * 0.66, 60 + R() * 140, 30 + R() * 70, 0, 0, Math.PI * 2); ctx.fill(); }
    // sand
    const sand = ridge(R, W, H * 0.78, H * 0.06, 0.5, 32);
    polyFill(ctx, sand, H, lin(ctx, 0, H * 0.7, 0, H, [[0, '#f2deaa'], [1, '#c39b5f']]));
    ctx.strokeStyle = 'rgba(140,100,50,0.25)'; ctx.lineWidth = 3;
    for (let i = 0; i < 40; i++) {
      const x = R() * W, y = H * (0.8 + R() * 0.2);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 40, y - 8, x + 80 + R() * 40, y); ctx.stroke();
    }
    for (let i = 0; i < 80; i++) { ctx.fillStyle = `rgba(${90 + R() * 80 | 0},${80 + R() * 60 | 0},70,0.6)`; ctx.beginPath(); ctx.ellipse(R() * W, H * (0.8 + R() * 0.2), 3 + R() * 6, 2 + R() * 4, 0, 0, Math.PI * 2); ctx.fill(); }
    // rocks
    for (const [rx, rw] of [[W * 0.05, 260], [W * 0.88, 300], [W * 0.5, 200]]) {
      ctx.fillStyle = rad(ctx, rx - rw * 0.2, H * 0.74, 10, rw, [[0, '#7c6f8f'], [1, '#3b3450']]);
      ctx.beginPath(); ctx.ellipse(rx, H * 0.84, rw, rw * 0.45, 0, Math.PI, 0); ctx.fill();
    }
    // seagrass
    for (let i = 0; i < 26; i++) {
      const x = R() * W, h = H * (0.2 + R() * 0.3), sway = (R() - 0.5) * 80;
      ctx.strokeStyle = R() < 0.5 ? '#2e8b57' : '#4caf50'; ctx.lineWidth = 6 + R() * 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, H * 0.86); ctx.bezierCurveTo(x + sway, H * 0.86 - h * 0.3, x - sway, H * 0.86 - h * 0.6, x + sway * 0.5, H * 0.86 - h); ctx.stroke();
    }
    // branching coral
    function branch(x, y, len, ang, w, col, depth) {
      const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
      ctx.strokeStyle = col; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
      if (depth <= 0) { ctx.fillStyle = draw.shade(col, 0.4); ctx.beginPath(); ctx.arc(x2, y2, w * 0.6, 0, Math.PI * 2); ctx.fill(); return; }
      const n = 2 + (R() < 0.3 ? 1 : 0);
      for (let k = 0; k < n; k++) branch(x2, y2, len * (0.65 + R() * 0.2), ang + (R() - 0.5) * 1.1, w * 0.72, col, depth - 1);
    }
    ctx.lineCap = 'round';
    branch(W * 0.17, H * 0.84, 90, -Math.PI / 2, 22, '#ff6f91', 5);
    branch(W * 0.72, H * 0.86, 80, -Math.PI / 2 - 0.2, 20, '#ff9a3c', 5);
    branch(W * 0.93, H * 0.84, 70, -Math.PI / 2 + 0.2, 18, '#c86bfa', 4);
    // fan coral
    ctx.save();
    ctx.translate(W * 0.37, H * 0.84);
    ctx.strokeStyle = '#a23bd1'; ctx.lineWidth = 3;
    for (let k = 0; k < 26; k++) {
      const a = -Math.PI * (0.15 + 0.7 * k / 25);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(Math.cos(a) * 120, Math.sin(a) * 140 - 30, Math.cos(a) * 230, Math.sin(a) * 230); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(210,120,255,0.6)'; ctx.lineWidth = 2;
    for (let rr = 60; rr < 230; rr += 26) { ctx.beginPath(); ctx.arc(0, 0, rr, -Math.PI * 0.85, -Math.PI * 0.15); ctx.stroke(); }
    ctx.restore();
    // brain coral
    for (const [bx, br] of [[W * 0.55, 95], [W * 0.08, 70]]) {
      const by = H * 0.87;
      ctx.fillStyle = rad(ctx, bx - br * 0.3, by - br * 0.6, 5, br * 1.2, [[0, '#f1c46b'], [1, '#a36a22']]);
      ctx.beginPath(); ctx.ellipse(bx, by, br * 1.2, br, 0, Math.PI, 0); ctx.fill();
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(110,60,15,0.6)'; ctx.lineWidth = 3;
      for (let k = 0; k < 14; k++) {
        ctx.beginPath();
        let x = bx - br * 1.2 + R() * br * 2.4, y = by - R() * br;
        ctx.moveTo(x, y);
        for (let s = 0; s < 8; s++) { x += (R() - 0.5) * 30; y += (R() - 0.5) * 20; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      ctx.restore();
    }
    // tube sponges
    for (let k = 0; k < 4; k++) {
      const tx = W * 0.8 + k * 26, th = 90 + R() * 90, ty = H * 0.86;
      ctx.fillStyle = lin(ctx, tx - 14, 0, tx + 14, 0, [[0, '#ffd166'], [0.5, '#ffb703'], [1, '#c77d00']]);
      ctx.fillRect(tx - 13, ty - th, 26, th);
      ctx.fillStyle = '#6b3a00';
      ctx.beginPath(); ctx.ellipse(tx, ty - th, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
    }
    // anemone with clownfish
    const ax = W * 0.27, ay = H * 0.83;
    for (let k = 0; k < 40; k++) {
      const a = -Math.PI * (0.1 + 0.8 * R()), l = 50 + R() * 50;
      ctx.strokeStyle = '#b5e48c'; ctx.lineWidth = 7;
      const ex = ax + Math.cos(a) * l, ey = ay + Math.sin(a) * l;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(ax + Math.cos(a) * l * 0.5 + 15, ay + Math.sin(a) * l * 0.5, ex, ey); ctx.stroke();
      ctx.fillStyle = '#ff8fab'; ctx.beginPath(); ctx.arc(ex, ey, 5, 0, Math.PI * 2); ctx.fill();
    }
    fish(ctx, W * 0.3, H * 0.66, 90, 1, '#ff7b00', '#ff7b00', [0.28, 0.0, -0.3]);
    fish(ctx, W * 0.22, H * 0.7, 70, -1, '#ff7b00', '#ff7b00', [0.28, 0.0, -0.3]);
    // big fish
    fish(ctx, W * 0.62, H * 0.38, 170, -1, '#1f4fd1', '#ffd60a', null);
    fish(ctx, W * 0.82, H * 0.5, 120, -1, '#ffd60a', '#ffcc00', null);
    fish(ctx, W * 0.45, H * 0.56, 110, 1, '#ff4d6d', '#ffb3c1', null);
    fish(ctx, W * 0.12, H * 0.42, 130, 1, '#7b2cbf', '#ffd60a', null);
    // school of silver fish
    for (let i = 0; i < 26; i++) fish(ctx, W * (0.62 + R() * 0.3) , H * (0.12 + R() * 0.16), 34 + R() * 10, -1, '#c9d6df', '#9fb3c8', null);
    // turtle
    ctx.save();
    ctx.translate(W * 0.36, H * 0.24);
    ctx.rotate(-0.15);
    ctx.fillStyle = '#7a9a52';
    ctx.beginPath(); ctx.ellipse(-70, 40, 50, 18, 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-60, -45, 55, 18, -0.7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(70, 50, 30, 12, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(115, -5, 32, 22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(128, -12, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rad(ctx, -10, -20, 5, 110, [[0, '#8d6b3b'], [1, '#4a3518']]);
    ctx.beginPath(); ctx.ellipse(0, 0, 100, 65, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(240,210,150,0.5)'; ctx.lineWidth = 3;
    for (const [hx, hy] of [[0, 0], [-50, -20], [50, -20], [-50, 25], [50, 25], [0, -42], [0, 42]]) {
      ctx.beginPath();
      for (let k = 0; k <= 6; k++) { const a = k * Math.PI / 3; ctx.lineTo(hx + Math.cos(a) * 24, hy + Math.sin(a) * 20); }
      ctx.stroke();
    }
    ctx.restore();
    // starfish
    for (const [stx, sty, col] of [[W * 0.62, H * 0.93, '#ff6b35'], [W * 0.04, H * 0.95, '#e63946']]) {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? 14 : 40; ctx.lineTo(stx + Math.cos(a) * rr, sty + Math.sin(a) * rr * 0.7); }
      ctx.fill();
      ctx.fillStyle = 'rgba(255,230,200,0.7)';
      for (let k = 0; k < 10; k++) { ctx.beginPath(); ctx.arc(stx + (R() - 0.5) * 40, sty + (R() - 0.5) * 20, 2, 0, Math.PI * 2); ctx.fill(); }
    }
    // bubbles
    for (let i = 0; i < 40; i++) {
      const bx = W * (0.25 + R() * 0.1) + (i % 3) * 300, by = R() * H * 0.7, br = 3 + R() * 10;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(bx - br * 0.35, by - br * 0.35, br * 0.25, 0, Math.PI * 2); ctx.fill();
    }
  }

  function paintFarm(ctx, W, H, R) {
    const hz = H * 0.48;
    ctx.fillStyle = lin(ctx, 0, 0, 0, hz, [[0, '#3f97e0'], [0.7, '#9fd3f5'], [1, '#d9f0ff']]);
    ctx.fillRect(0, 0, W, hz + 40);
    ctx.fillStyle = rad(ctx, W * 0.86, H * 0.12, 0, H * 0.4, [[0, 'rgba(255,255,220,1)'], [0.15, 'rgba(255,245,180,0.8)'], [1, 'rgba(255,245,180,0)']]);
    ctx.fillRect(0, 0, W, hz);
    ctx.fillStyle = '#fffbe0'; ctx.beginPath(); ctx.arc(W * 0.86, H * 0.12, H * 0.055, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 6; i++) cloud(ctx, R, W * (0.05 + R() * 0.7), H * (0.08 + R() * 0.2), W * (0.12 + R() * 0.1), '#ffffff', '#c9d8e6');
    // far hills
    let pts = ridge(R, W, hz, H * 0.08, 0.5, 32);
    polyFill(ctx, pts, H, lin(ctx, 0, hz - H * 0.1, 0, hz + 20, [[0, '#86b49a'], [1, '#6e9e7c']]));
    // patchwork field hills
    const fieldCols = ['#e8c95a', '#7cb342', '#9b6b43', '#a5d36a', '#d4a43a', '#5d9e3a'];
    for (let layer = 0; layer < 2; layer++) {
      const base = hz + H * (0.06 + layer * 0.08);
      pts = ridge(R, W, base, H * 0.06, 0.45, 32);
      ctx.save();
      ctx.beginPath(); ctx.moveTo(0, H); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.lineTo(W, H); ctx.closePath(); ctx.clip();
      let x = -50;
      while (x < W) {
        const w = 120 + R() * 220, col = fieldCols[Math.floor(R() * fieldCols.length)], skew = (R() - 0.5) * 120;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(x, base - H * 0.1); ctx.lineTo(x + w, base - H * 0.1); ctx.lineTo(x + w + skew, H); ctx.lineTo(x + skew, H); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 2;
        for (let k = 0; k < w; k += 14) { ctx.beginPath(); ctx.moveTo(x + k, base - H * 0.1); ctx.lineTo(x + k + skew * 1.4, H); ctx.stroke(); }
        x += w;
      }
      ctx.fillStyle = lin(ctx, 0, base - H * 0.08, 0, base + H * 0.2, [[0, 'rgba(255,255,255,0.12)'], [1, 'rgba(0,0,0,0)']]);
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      for (let k = 0; k < 6; k++) { const tx = R() * W; tree(ctx, R, tx, pts[Math.round(tx / W * 32)][1] + 6, 30 + layer * 14, ['#4f8f3a', '#2c5a22']); }
    }
    // pasture
    const pasture = ridge(R, W, H * 0.66, H * 0.03, 0.4, 32);
    polyFill(ctx, pasture, H, lin(ctx, 0, H * 0.62, 0, H, [[0, '#7fc04f'], [1, '#3f8a2a']]));
    // path
    ctx.fillStyle = '#d8c08e';
    ctx.beginPath(); ctx.moveTo(W * 0.42, H); ctx.bezierCurveTo(W * 0.48, H * 0.85, W * 0.62, H * 0.78, W * 0.6, H * 0.66);
    ctx.lineTo(W * 0.63, H * 0.66); ctx.bezierCurveTo(W * 0.68, H * 0.8, W * 0.6, H * 0.88, W * 0.58, H); ctx.fill();
    // barn
    const bx = W * 0.52, by = H * 0.66, bw = W * 0.17, bh = H * 0.2;
    ctx.fillStyle = lin(ctx, bx - bw * 0.5, 0, bx, 0, [[0, '#7a1712'], [1, '#9b2119']]);
    ctx.beginPath(); ctx.moveTo(bx - bw * 0.55, by - bh * 0.05); ctx.lineTo(bx, by); ctx.lineTo(bx, by - bh); ctx.lineTo(bx - bw * 0.55, by - bh * 0.95); ctx.fill();
    // gambrel roof seen from the side: lower steep face + upper face, ridge running back from the front apex
    const back = -bw * 0.55, sag = bh * 0.05;
    const eave = [bx, by - bh], brk = [bx + bw * 0.14, by - bh * 1.35], apex = [bx + bw * 0.5, by - bh * 1.62];
    ctx.fillStyle = '#3f444c';
    ctx.beginPath(); ctx.moveTo(eave[0] + back, eave[1] + sag); ctx.lineTo(...eave); ctx.lineTo(...brk); ctx.lineTo(brk[0] + back, brk[1] + sag); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5a606a';
    ctx.beginPath(); ctx.moveTo(brk[0] + back, brk[1] + sag); ctx.lineTo(...brk); ctx.lineTo(...apex); ctx.lineTo(apex[0] + back, apex[1] + sag); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2;
    for (let k = 1; k < 8; k++) { const t = k / 8; ctx.beginPath(); ctx.moveTo(eave[0] + back * t, eave[1] + sag * t); ctx.lineTo(apex[0] + back * t, apex[1] + sag * t); ctx.stroke(); }
    // gable front
    ctx.fillStyle = lin(ctx, 0, by - bh * 1.6, 0, by, [[0, '#c62d22'], [1, '#a1231b']]);
    ctx.beginPath();
    ctx.moveTo(bx, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by - bh);
    ctx.lineTo(bx + bw * 0.86, by - bh * 1.35); ctx.lineTo(bx + bw * 0.5, by - bh * 1.62); ctx.lineTo(bx + bw * 0.14, by - bh * 1.35); ctx.lineTo(bx, by - bh);
    ctx.closePath(); ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(60,0,0,0.35)'; ctx.lineWidth = 2;
    for (let x = bx + 10; x < bx + bw; x += 12) { ctx.beginPath(); ctx.moveTo(x, by - bh * 1.6); ctx.lineTo(x, by); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = '#f4f1ea'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(bx, by - bh); ctx.lineTo(bx + bw * 0.14, by - bh * 1.35); ctx.lineTo(bx + bw * 0.5, by - bh * 1.62); ctx.lineTo(bx + bw * 0.86, by - bh * 1.35); ctx.lineTo(bx + bw, by - bh); ctx.stroke();
    const dw = bw * 0.42, dh = bh * 0.68, dx = bx + bw / 2 - dw / 2, dy = by - dh;
    ctx.fillStyle = '#8f1d16'; ctx.fillRect(dx, dy, dw, dh);
    ctx.strokeRect(dx, dy, dw, dh);
    ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(dx + dw, dy + dh); ctx.moveTo(dx + dw, dy); ctx.lineTo(dx, dy + dh); ctx.moveTo(dx + dw / 2, dy); ctx.lineTo(dx + dw / 2, dy + dh); ctx.stroke();
    ctx.fillStyle = '#3a2412'; ctx.fillRect(bx + bw * 0.4, by - bh * 1.3, bw * 0.2, bh * 0.25);
    ctx.strokeRect(bx + bw * 0.4, by - bh * 1.3, bw * 0.2, bh * 0.25);
    // silo
    const sx = bx + bw * 1.18, sw = bw * 0.32, sh = bh * 2.1;
    ctx.fillStyle = lin(ctx, sx - sw / 2, 0, sx + sw / 2, 0, [[0, '#8d969e'], [0.35, '#e1e6ea'], [1, '#6c757d']]);
    ctx.fillRect(sx - sw / 2, by - sh, sw, sh);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 2;
    for (let y = by - sh + 20; y < by; y += 22) { ctx.beginPath(); ctx.moveTo(sx - sw / 2, y); ctx.lineTo(sx + sw / 2, y); ctx.stroke(); }
    ctx.fillStyle = lin(ctx, sx - sw / 2, 0, sx + sw / 2, 0, [[0, '#7a1712'], [0.4, '#d23a2e'], [1, '#6b130f']]);
    ctx.beginPath(); ctx.ellipse(sx, by - sh, sw / 2, sw * 0.45, 0, Math.PI, 0); ctx.fill();
    // big trees near the barn
    tree(ctx, R, W * 0.33, H * 0.7, 120, ['#5ea83f', '#2d5f1f']);
    tree(ctx, R, W * 0.9, H * 0.68, 140, ['#62ad43', '#2b5a1d']);
    // animals
    function cow(x, y, s, dir) {
      ctx.save(); ctx.translate(x, y); ctx.scale(dir * s, s);
      ctx.fillStyle = '#222';
      for (const lx of [-30, -18, 18, 30]) ctx.fillRect(lx - 4, 10, 8, 30);
      ctx.fillStyle = '#fafafa'; ctx.beginPath(); ctx.ellipse(0, 0, 45, 24, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#222'; ctx.beginPath(); ctx.ellipse(-12, -6, 14, 10, 0.4, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(20, 8, 10, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fafafa'; ctx.beginPath(); ctx.ellipse(52, -14, 16, 13, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f2a6a6'; ctx.beginPath(); ctx.ellipse(62, -6, 9, 7, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(52, -18, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#222'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-45, -4); ctx.quadraticCurveTo(-55, 10, -50, 24); ctx.stroke();
      ctx.restore();
    }
    function sheep(x, y, s) {
      ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
      ctx.fillStyle = '#333'; for (const lx of [-14, -5, 8, 16]) ctx.fillRect(lx - 3, 8, 6, 20);
      for (let k = 0; k < 10; k++) { ctx.fillStyle = k % 2 ? '#f7f4ec' : '#e6e1d4'; ctx.beginPath(); ctx.arc(-20 + (k % 5) * 10, -6 + Math.floor(k / 5) * 12, 11, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = '#2b2b2b'; ctx.beginPath(); ctx.ellipse(30, -4, 9, 12, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    function chicken(x, y, s) {
      ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(0, 0, 14, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(10, -10, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e63946'; ctx.beginPath(); ctx.arc(10, -18, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f4a261'; ctx.beginPath(); ctx.moveTo(16, -10); ctx.lineTo(23, -8); ctx.lineTo(16, -6); ctx.fill();
      ctx.strokeStyle = '#f4a261'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-3, 10); ctx.lineTo(-3, 18); ctx.moveTo(4, 10); ctx.lineTo(4, 18); ctx.stroke();
      ctx.restore();
    }
    cow(W * 0.15, H * 0.76, 1.2, 1);
    cow(W * 0.3, H * 0.84, 1.5, -1);
    sheep(W * 0.75, H * 0.8, 1.6); sheep(W * 0.83, H * 0.86, 1.8); sheep(W * 0.7, H * 0.88, 1.7);
    chicken(W * 0.47, H * 0.74, 1.3); chicken(W * 0.5, H * 0.78, 1.2); chicken(W * 0.66, H * 0.72, 1.1);
    // fence
    const fy = H * 0.92;
    ctx.fillStyle = '#fbfaf5';
    for (let x = 10; x < W; x += 90) {
      ctx.fillStyle = lin(ctx, x, 0, x + 14, 0, [[0, '#ffffff'], [1, '#c9c4b8']]);
      ctx.fillRect(x, fy - 90, 16, 110);
    }
    for (const ry of [fy - 72, fy - 30]) {
      ctx.fillStyle = lin(ctx, 0, ry, 0, ry + 14, [[0, '#ffffff'], [1, '#c9c4b8']]);
      ctx.fillRect(0, ry, W, 14);
    }
    // foreground grass + flowers
    for (let i = 0; i < 400; i++) {
      const x = R() * W, y = H * (0.9 + R() * 0.1), h = 10 + R() * 25;
      ctx.strokeStyle = R() < 0.5 ? '#3c8a28' : '#5aae3a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y + 10); ctx.lineTo(x + (R() - 0.5) * 10, y - h); ctx.stroke();
    }
    const fl = ['#ffd60a', '#ff4d6d', '#ffffff', '#c77dff'];
    for (let i = 0; i < 60; i++) { ctx.fillStyle = fl[i % 4]; ctx.beginPath(); ctx.arc(R() * W, H * (0.9 + R() * 0.1), 4 + R() * 3, 0, Math.PI * 2); ctx.fill(); }
  }

  function paintCity(ctx, W, H, R) {
    const hz = H * 0.7;
    ctx.fillStyle = lin(ctx, 0, 0, 0, hz, [[0, '#040714'], [0.45, '#121a45'], [0.8, '#3a2a68'], [1, '#8a4a7a']]);
    ctx.fillRect(0, 0, W, hz);
    for (let i = 0; i < 260; i++) {
      const a = R();
      ctx.fillStyle = `rgba(255,255,${200 + R() * 55 | 0},${a * 0.9})`;
      const s = a > 0.92 ? 3 : 1.6;
      ctx.fillRect(R() * W, R() * hz * 0.6, s, s);
    }
    // moon
    const mx = W * 0.14, my = H * 0.15;
    ctx.fillStyle = rad(ctx, mx, my, 0, 220, [[0, 'rgba(255,250,220,0.5)'], [1, 'rgba(255,250,220,0)']]);
    ctx.fillRect(mx - 220, my - 220, 440, 440);
    ctx.fillStyle = rad(ctx, mx - 15, my - 15, 5, 62, [[0, '#fffbe8'], [1, '#d9d2b8']]);
    ctx.beginPath(); ctx.arc(mx, my, 60, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(150,140,110,0.35)';
    for (const [cx, cy, cr] of [[-20, -10, 12], [15, 15, 9], [20, -22, 7], [-5, 25, 6]]) { ctx.beginPath(); ctx.arc(mx + cx, my + cy, cr, 0, Math.PI * 2); ctx.fill(); }
    // fireworks
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const [fx, fy, col] of [[W * 0.7, H * 0.16, [255, 90, 160]], [W * 0.86, H * 0.28, [120, 220, 255]], [W * 0.45, H * 0.1, [255, 210, 90]]]) {
      ctx.fillStyle = rad(ctx, fx, fy, 0, 150, [[0, `rgba(${col},0.35)`], [1, `rgba(${col},0)`]]);
      ctx.fillRect(fx - 150, fy - 150, 300, 300);
      for (let k = 0; k < 40; k++) {
        const a = (k / 40) * Math.PI * 2, len = 70 + R() * 50;
        for (let d = 0.3; d <= 1; d += 0.12) {
          ctx.fillStyle = `rgba(${col},${d})`;
          ctx.beginPath(); ctx.arc(fx + Math.cos(a) * len * d, fy + Math.sin(a) * len * d + d * d * 12, 1.5 + d * 1.5, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    ctx.restore();
    // far skyline
    for (let x = 0; x < W;) {
      const w = 30 + R() * 60, h = H * (0.08 + R() * 0.2);
      ctx.fillStyle = '#1f2550';
      ctx.fillRect(x, hz - h, w + 1, h);
      for (let wy = hz - h + 8; wy < hz - 6; wy += 12) for (let wx = x + 5; wx < x + w - 5; wx += 9) if (R() < 0.15) { ctx.fillStyle = 'rgba(255,220,150,0.5)'; ctx.fillRect(wx, wy, 3, 4); }
      x += w;
    }
    // main skyline
    const lit = ['#ffd66b', '#fff2b0', '#ffe08a', '#9fe3ff', '#ffb86b'];
    for (let x = -20; x < W;) {
      const w = 70 + R() * 110, center = 1 - Math.abs((x + w / 2) / W - 0.55) * 1.2;
      const h = H * (0.15 + R() * 0.25 + center * 0.2);
      const top = hz - h, style = R();
      const base = ['#262c55', '#2c2448', '#1e2a4a', '#30305a'][Math.floor(R() * 4)];
      if (style < 0.25) {
        // glass tower
        ctx.fillStyle = lin(ctx, x, 0, x + w, 0, [[0, '#1d4f7a'], [0.4, '#3e8fb8'], [0.6, '#24597f'], [1, '#132f4d']]);
        ctx.fillRect(x, top, w, h);
        ctx.strokeStyle = 'rgba(160,230,255,0.3)'; ctx.lineWidth = 1;
        for (let y = top + 8; y < hz; y += 9) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke(); }
        for (let y = top + 8; y < hz; y += 9) if (R() < 0.3) { ctx.fillStyle = 'rgba(255,240,180,0.7)'; ctx.fillRect(x + R() * (w - 20), y - 6, 20, 5); }
      } else {
        ctx.fillStyle = lin(ctx, x, 0, x + w, 0, [[0, draw.shade(base, 0.12)], [1, draw.shade(base, -0.3)]]);
        ctx.fillRect(x, top, w, h);
        const ww = 6 + Math.floor(R() * 4), wh = 8 + Math.floor(R() * 4), gx = ww + 5, gy = wh + 7;
        for (let y = top + 10; y < hz - wh; y += gy) for (let wx = x + 7; wx < x + w - ww - 4; wx += gx) {
          if (R() < 0.48) { ctx.fillStyle = lit[Math.floor(R() * lit.length)]; ctx.globalAlpha = 0.6 + R() * 0.4; }
          else { ctx.fillStyle = '#141833'; ctx.globalAlpha = 1; }
          ctx.fillRect(wx, y, ww, wh);
        }
        ctx.globalAlpha = 1;
      }
      // roof styles
      ctx.fillStyle = draw.shade(base, -0.2);
      if (style > 0.8) {
        ctx.beginPath(); ctx.moveTo(x + w * 0.2, top); ctx.lineTo(x + w / 2, top - h * 0.25); ctx.lineTo(x + w * 0.8, top); ctx.fill();
        ctx.fillRect(x + w / 2 - 2, top - h * 0.38, 4, h * 0.14);
        ctx.fillStyle = 'rgba(255,60,60,0.9)'; ctx.beginPath(); ctx.arc(x + w / 2, top - h * 0.38, 4, 0, Math.PI * 2); ctx.fill();
      } else if (style > 0.6) {
        ctx.fillRect(x + w * 0.15, top - 24, w * 0.7, 24);
        ctx.fillRect(x + w * 0.3, top - 44, w * 0.4, 20);
      } else if (style > 0.45) {
        ctx.fillRect(x + w * 0.45, top - 60, 4, 60);
        ctx.fillStyle = 'rgba(255,60,60,0.9)'; ctx.beginPath(); ctx.arc(x + w * 0.45 + 2, top - 60, 4, 0, Math.PI * 2); ctx.fill();
      }
      x += w + R() * 6;
    }
    // water with reflections
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = Math.ceil(hz);
    tmp.getContext('2d').drawImage(ctx.canvas, 0, 0, W, hz, 0, 0, W, hz);
    ctx.fillStyle = '#060a1c';
    ctx.fillRect(0, hz, W, H - hz);
    ctx.save();
    ctx.translate(0, hz * 2);
    ctx.scale(1, -1);
    ctx.globalAlpha = 0.5;
    for (let y = hz - (H - hz); y < hz; y += 4) {
      const off = (R() - 0.5) * 6 + Math.sin(y * 0.3) * 3;
      ctx.drawImage(tmp, 0, y, W, 4, off, y, W, 4);
    }
    ctx.restore();
    ctx.fillStyle = lin(ctx, 0, hz, 0, H, [[0, 'rgba(10,15,40,0.3)'], [1, 'rgba(3,5,15,0.85)']]);
    ctx.fillRect(0, hz, W, H - hz);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 160; i++) ctx.fillRect(R() * W, hz + R() * (H - hz), 20 + R() * 60, 1.5);
    // bridge
    const deckY = hz + H * 0.02;
    ctx.fillStyle = '#10142c';
    ctx.fillRect(W * 0.52, deckY, W * 0.5, 14);
    for (const tx of [W * 0.64, W * 0.9]) {
      ctx.fillStyle = '#1a1f3d';
      ctx.fillRect(tx - 10, deckY - H * 0.24, 20, H * 0.26 + 30);
      ctx.fillStyle = 'rgba(255,80,80,0.9)'; ctx.beginPath(); ctx.arc(tx, deckY - H * 0.24, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(200,220,255,0.7)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(W * 0.52, deckY - 10); ctx.quadraticCurveTo(W * 0.58, deckY - 20, W * 0.64, deckY - H * 0.24);
    ctx.quadraticCurveTo(W * 0.77, deckY, W * 0.9, deckY - H * 0.24); ctx.quadraticCurveTo(W * 0.96, deckY - 30, W, deckY - 40); ctx.stroke();
    ctx.lineWidth = 1;
    for (let x = W * 0.66; x < W * 0.89; x += 16) {
      const t = (x - W * 0.64) / (W * 0.26), cy = deckY - H * 0.24 + (1 - Math.pow(1 - Math.abs(t * 2 - 1), 1) ) * 0 + H * 0.24 * (1 - Math.pow(2 * t - 1, 2));
      ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x, deckY); ctx.stroke();
    }
    for (let x = W * 0.53; x < W; x += 22) {
      ctx.fillStyle = 'rgba(255,230,150,0.95)'; ctx.beginPath(); ctx.arc(x, deckY - 2, 3, 0, Math.PI * 2); ctx.fill();
    }
    // quay with railings and lamps
    const qy = H * 0.9;
    ctx.fillStyle = lin(ctx, 0, qy, 0, H, [[0, '#2a2d45'], [0.15, '#15172a'], [1, '#0b0c18']]);
    ctx.fillRect(0, qy, W, H - qy);
    ctx.strokeStyle = '#3a3e5c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, qy - 22); ctx.lineTo(W, qy - 22); ctx.stroke();
    for (let x = 10; x < W; x += 30) { ctx.beginPath(); ctx.moveTo(x, qy - 22); ctx.lineTo(x, qy); ctx.stroke(); }
    for (let x = 60; x < W; x += 180) {
      ctx.fillStyle = '#2c3050'; ctx.fillRect(x - 3, qy - 80, 6, 80);
      ctx.fillStyle = rad(ctx, x, qy - 84, 0, 46, [[0, 'rgba(255,225,150,1)'], [0.25, 'rgba(255,210,130,0.6)'], [1, 'rgba(255,210,130,0)']]);
      ctx.fillRect(x - 46, qy - 130, 92, 92);
      ctx.fillStyle = 'rgba(255,215,140,0.12)';
      ctx.beginPath(); ctx.ellipse(x, qy + 6, 40, 6, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  const PICS = [
    { id: 'lake', name: 'Mountain Lake', paint: paintLake, seed: 11 },
    { id: 'reef', name: 'Coral Reef', paint: paintReef, seed: 7 },
    { id: 'farm', name: 'Farm', paint: paintFarm, seed: 23 },
    { id: 'city', name: 'City at Night', paint: paintCity, seed: 5 },
  ];
  const picCache = {};
  function getPicture(def) {
    if (!picCache[def.id]) {
      const c = document.createElement('canvas');
      c.width = 1500; c.height = 1000;
      const ctx = c.getContext('2d');
      def.paint(ctx, 1500, 1000, mulberry(def.seed));
      // subtle painterly grain so neighbouring pieces differ
      const img = ctx.getImageData(0, 0, 1500, 1000), d = img.data, R = mulberry(def.seed + 99);
      for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
      ctx.putImageData(img, 0, 0);
      picCache[def.id] = c;
    }
    return picCache[def.id];
  }

  // ===================================================================================
  // Puzzle construction
  // ===================================================================================
  function chooseGrid(n, aspect) {
    let best = null;
    for (let r = 1; r <= n; r++) {
      if (n % r) continue;
      const c = n / r, err = Math.abs(Math.log(c / r / aspect));
      if (!best || err < best.err) best = { cols: c, rows: r, err };
    }
    return best;
  }

  function edgePoints(x0, y0, x1, y1, R) {
    const dx = x1 - x0, dy = y1 - y0, nx = -dy, ny = dx;
    const flip = R() < 0.5 ? -1 : 1, t = 0.1 * (0.9 + R() * 0.2), j = 0.04;
    const rj = () => (R() * 2 - 1) * j;
    const a = rj(), b = rj(), c = rj(), d = rj(), e = rj();
    const P = (l, w) => [x0 + dx * l + nx * w * flip, y0 + dy * l + ny * w * flip];
    return [P(0, 0), P(0.2, a), P(0.5 + b + d, -t + c), P(0.5 - t + b, t + c), P(0.5 - 2 * t + b - d, 3 * t + c),
      P(0.5 + 2 * t + b - d, 3 * t + c), P(0.5 + t + b, t + c), P(0.5 + b + d, -t + c), P(0.8, e), P(1, 0)];
  }

  function buildPieces(cols, rows) {
    const R = Math.random;
    const hE = [], vE = [];
    for (let r = 1; r < rows; r++) { hE[r] = []; for (let c = 0; c < cols; c++) hE[r][c] = edgePoints(c, r, c + 1, r, R); }
    for (let r = 0; r < rows; r++) { vE[r] = []; for (let c = 1; c < cols; c++) vE[r][c] = edgePoints(c, r, c, r + 1, R); }
    const pieces = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const path = new Path2D();
      const add = (pts, rev) => {
        const p = rev ? pts.slice().reverse() : pts;
        for (let k = 0; k < 3; k++) path.bezierCurveTo(p[1 + k * 3][0] - c, p[1 + k * 3][1] - r, p[2 + k * 3][0] - c, p[2 + k * 3][1] - r, p[3 + k * 3][0] - c, p[3 + k * 3][1] - r);
      };
      path.moveTo(0, 0);
      if (r === 0) path.lineTo(1, 0); else add(hE[r][c], false);
      if (c === cols - 1) path.lineTo(1, 1); else add(vE[r][c + 1], false);
      if (r === rows - 1) path.lineTo(0, 1); else add(hE[r + 1][c], true);
      if (c === 0) path.lineTo(0, 0); else add(vE[r][c], true);
      path.closePath();
      pieces.push({ id: pieces.length, c, r, path, x: 0, y: 0, placed: false, held: null, sprite: null, shadow: null, flash: 0, snapAnim: null });
    }
    return pieces;
  }

  // ===================================================================================
  // State, page chrome
  // ===================================================================================
  const S = {
    phase: 'menu', pic: null, picDef: null, n: 24, cols: 6, rows: 4, k: 1,
    pieces: [], placed: 0, time: 0, ghost: false, spriteScale: 0, lastResize: 0, doneT: 0,
  };
  const page = IFPD.setupPage({ title: 'Jigsaw Puzzle', onRestart: restart });
  const ghostBtn = document.createElement('button');
  ghostBtn.className = 'ifpd-btn';
  ghostBtn.innerHTML = '👻 Ghost <kbd class="kb-hint">G</kbd>';
  ghostBtn.title = 'Show a faint picture on the board';
  function toggleGhost() {
    S.ghost = !S.ghost;
    ghostBtn.classList.toggle('jig-on', S.ghost);
    sfx.play('click');
  }
  ghostBtn.addEventListener('click', toggleGhost);
  const statusEl = document.createElement('span');
  statusEl.className = 'jig-status';
  page.extra.append(statusEl, ghostBtn);
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  document.body.append(fileInput);

  let L = null;
  const view = IFPD.fitCanvas(canvas, () => { L = null; S.lastResize = performance.now(); });
  const hitCtx = document.createElement('canvas').getContext('2d');

  // ===================================================================================
  // Layout (board units: 1 unit = one cell width; y units scaled by k)
  // ===================================================================================
  function layout() {
    const W = view.width, H = view.height;
    const { cols, rows, k } = S;
    const land = W >= H;
    const fw = land ? 0.6 : 0.88, fh = land ? 0.7 : 0.55;
    const s = Math.max(8, Math.min(W * fw / cols, H * fh / (rows * k)));
    const tw = cols * s, th = rows * s * k;
    L = { W, H, s, sy: s * k, tw, th, ox: Math.round((W - tw) / 2), oy: Math.round((H - th) / 2) };
    L.bg = makeBackground();
    if (S.pieces.length) keepOnScreen(true);
  }
  const toUnits = (x, y) => [(x - L.ox) / L.s, (y - L.oy) / L.sy];

  function bounds() {
    // allowed range for a piece's top-left (units) so the whole cell stays visible
    const m = 0.08;
    return { x0: -L.ox / L.s + m, x1: (L.W - L.ox) / L.s - 1 - m, y0: -L.oy / L.sy + m, y1: (L.H - L.oy) / L.sy - 1 - m };
  }

  function keepOnScreen(rescatter) {
    const b = bounds();
    const out = [];
    for (const p of S.pieces) {
      if (p.placed) continue;
      if (p.x < b.x0 || p.x > b.x1 || p.y < b.y0 || p.y > b.y1) {
        if (rescatter && p.held === null) out.push(p);
        else { p.x = util.clamp(p.x, b.x0, b.x1); p.y = util.clamp(p.y, b.y0, b.y1); }
      }
    }
    if (out.length) scatter(out);
  }

  function scatter(list) {
    const b = bounds();
    const others = S.pieces.filter(p => !list.includes(p) && !p.placed).map(p => [p.x + 0.5, p.y + 0.5]);
    const inTarget = (x, y) => x > -0.35 && x < S.cols + 0.35 && y > -0.35 && y < S.rows + 0.35;
    for (const p of list) {
      let best = null, bestD = -1;
      for (let t = 0; t < 40; t++) {
        const x = util.rand(b.x0, b.x1), y = util.rand(b.y0, b.y1);
        let d = inTarget(x + 0.5, y + 0.5) ? -100 : 0;
        let md = 1e9;
        for (const o of others) md = Math.min(md, Math.hypot(o[0] - x - 0.5, (o[1] - y - 0.5) * S.k));
        d += Math.min(md, 3);
        if (d > bestD) { bestD = d; best = [x, y]; }
      }
      p.x = best[0]; p.y = best[1];
      others.push([p.x + 0.5, p.y + 0.5]);
    }
  }

  function makeBackground() {
    const { W, H, ox, oy, tw, th, s } = L;
    const c = document.createElement('canvas');
    c.width = Math.round(W * view.dpr); c.height = Math.round(H * view.dpr);
    const ctx = c.getContext('2d');
    ctx.scale(view.dpr, view.dpr);
    ctx.drawImage(IFPD.texture.wood(W, H, { base: '#8c5b34', dark: '#4e2d16', planks: Math.max(4, Math.round(H / 160)) }), 0, 0, W, H);
    ctx.fillStyle = rad(ctx, W / 2, H / 2, Math.min(W, H) * 0.2, Math.max(W, H) * 0.75, [[0, 'rgba(255,235,200,0.1)'], [1, 'rgba(0,0,0,0.5)']]);
    ctx.fillRect(0, 0, W, H);
    // puzzle board (cardboard tray)
    const m = Math.max(10, s * 0.3);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#2f4a3c';
    draw.roundRect(ctx, ox - m, oy - m, tw + m * 2, th + m * 2, 14);
    ctx.fill();
    ctx.restore();
    ctx.save();
    draw.roundRect(ctx, ox - m, oy - m, tw + m * 2, th + m * 2, 14);
    ctx.clip();
    ctx.drawImage(IFPD.texture.felt(Math.round(tw + m * 2), Math.round(th + m * 2), { color: '#2f5a45' }), ox - m, oy - m, tw + m * 2, th + m * 2);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2;
    draw.roundRect(ctx, ox - m + 1, oy - m + 1, tw + m * 2 - 2, th + m * 2 - 2, 13);
    ctx.stroke();
    // inset target area
    ctx.fillStyle = '#21382c';
    ctx.fillRect(ox, oy, tw, th);
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, tw, th); ctx.clip();
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetX = 4; ctx.shadowOffsetY = 5;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 10;
    ctx.strokeRect(ox - 5, oy - 5, tw + 10, th + 10);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(ox, oy + th + 1); ctx.lineTo(ox + tw + 1, oy + th + 1); ctx.lineTo(ox + tw + 1, oy); ctx.stroke();
    return c;
  }

  // ===================================================================================
  // Piece sprites
  // ===================================================================================
  function buildSprites() {
    const { s, sy } = L, dpr = view.dpr;
    const pw = (1 + 2 * PAD) * s, ph = (1 + 2 * PAD) * sy;
    const blur = Math.max(2, s * 0.05), sp = Math.ceil(blur * 2);
    const pic = S.pic, cwPx = pic.width / S.cols, chPx = pic.height / S.rows;
    for (const p of S.pieces) {
      const c = p.sprite && p.sprite.width === Math.ceil(pw * dpr) ? p.sprite : document.createElement('canvas');
      c.width = Math.ceil(pw * dpr); c.height = Math.ceil(ph * dpr);
      const ctx = c.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.setTransform(s * dpr, 0, 0, sy * dpr, PAD * s * dpr, PAD * sy * dpr);
      ctx.save();
      ctx.clip(p.path);
      const sx0 = Math.max(0, p.c - PAD), sy0 = Math.max(0, p.r - PAD);
      const sx1 = Math.min(S.cols, p.c + 1 + PAD), sy1 = Math.min(S.rows, p.r + 1 + PAD);
      ctx.drawImage(pic, sx0 * cwPx, sy0 * chPx, (sx1 - sx0) * cwPx, (sy1 - sy0) * chPx, sx0 - p.c, sy0 - p.r, sx1 - sx0, sy1 - sy0);
      // bevel: light on the upper-left inner edge, dark on the lower-right
      const lw = Math.max(1.5, s * 0.045);
      ctx.lineWidth = lw / s;
      ctx.translate(lw * 0.45 / s, lw * 0.45 / sy);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.stroke(p.path);
      ctx.translate(-lw * 0.9 / s, -lw * 0.9 / sy);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.stroke(p.path);
      ctx.restore();
      ctx.lineWidth = 1 / s;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.stroke(p.path);
      p.sprite = c;
      // soft shadow silhouette
      const sh = p.shadow && p.shadow.width === Math.ceil((pw + sp * 2) * dpr) ? p.shadow : document.createElement('canvas');
      sh.width = Math.ceil((pw + sp * 2) * dpr); sh.height = Math.ceil((ph + sp * 2) * dpr);
      const sctx = sh.getContext('2d');
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.clearRect(0, 0, sh.width, sh.height);
      sctx.filter = `blur(${blur * dpr}px)`;
      sctx.setTransform(s * dpr, 0, 0, sy * dpr, (PAD * s + sp) * dpr, (PAD * sy + sp) * dpr);
      sctx.fillStyle = '#000';
      sctx.fill(p.path);
      sctx.filter = 'none';
      p.shadow = sh;
      p.shadowPad = sp;
    }
    S.spriteScale = s;
    S.spriteK = sy;
  }

  // ===================================================================================
  // Game flow
  // ===================================================================================
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
    return IFPD.overlay.el;
  }

  const fmt = sec => { sec = Math.floor(sec); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
  const bestKey = (id, n) => `jigsaw-${id}-${n}`;

  function showPictureMenu() {
    S.phase = 'menu';
    const el = overlay({
      title: '🧩 Jigsaw Puzzle',
      text: 'Choose a picture:',
      buttons: PICS.map(d => ({ label: d.name, kind: 'secondary', onClick: () => choosePicture(d) }))
        .concat([{ label: '📷 Your own picture', kind: 'good', onClick: pickFile }]),
    });
    const btns = el.querySelectorAll('.ifpd-buttons button');
    PICS.forEach((d, i) => {
      const th = document.createElement('canvas');
      th.width = 300; th.height = 200;
      const tctx = th.getContext('2d');
      tctx.fillStyle = '#1b1c22';
      tctx.fillRect(0, 0, 300, 200);
      btns[i].classList.add('jig-pic-btn');
      btns[i].prepend(th);
      // paint lazily, one picture per task, so the menu appears at once on slow panels
      setTimeout(() => { if (th.isConnected) tctx.drawImage(getPicture(d), 0, 0, 300, 200); }, 40 + i * 30);
    });
  }

  function choosePicture(def) {
    S.picDef = def;
    S.pic = getPicture(def);
    showSizeMenu();
  }

  function pickFile() {
    showPictureMenu();          // stays visible if the student cancels the file dialog
    fileInput.value = '';
    fileInput.click();
  }

  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 1600, sc = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * sc)); c.height = Math.max(1, Math.round(img.height * sc));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        S.picDef = { id: 'custom', name: 'Your picture' };
        S.pic = c;
        sfx.play('correct');
        showSizeMenu();
      };
      img.onerror = () => { sfx.play('wrong'); IFPD.toast("Sorry, that picture couldn't be opened", 2200); };
      img.src = reader.result;
    };
    reader.onerror = () => { sfx.play('wrong'); IFPD.toast("Sorry, that picture couldn't be opened", 2200); };
    reader.readAsDataURL(f);
  });

  function showSizeMenu() {
    const id = S.picDef.id;
    overlay({
      title: S.picDef.name,
      text: 'How many pieces?',
      buttons: SIZES.map(n => {
        const b = IFPD.best.get(bestKey(id, n));
        return { label: `${n} pieces${b != null ? '  (best ' + fmt(b) + ')' : ''}`, kind: n <= 24 ? 'good' : 'primary', onClick: () => startPuzzle(n) };
      }).concat([{ label: '← Back', kind: 'secondary', onClick: showPictureMenu }]),
    });
  }

  function startPuzzle(n) {
    const pic = S.pic;
    const g = chooseGrid(n, pic.width / pic.height);
    S.n = n; S.cols = g.cols; S.rows = g.rows;
    S.k = (pic.height / g.rows) / (pic.width / g.cols);
    S.pieces = buildPieces(S.cols, S.rows);
    S.placed = 0;
    S.time = 0;
    S.phase = 'play';
    S.doneT = 0;
    held.clear();
    layout();
    buildSprites();
    util.shuffle(S.pieces);
    scatter(S.pieces);
    sfx.play('whoosh');
    updateStatus(true);
    syncKeys();
  }

  function restart() {
    sfx.play('click');
    for (const p of S.pieces) p.held = null;
    held.clear();
    showPictureMenu();
  }

  function complete() {
    S.phase = 'done';
    S.doneT = 0;
    syncKeys();
    const key = bestKey(S.picDef.id, S.n), t = Math.floor(S.time);
    const record = IFPD.best.submit(key, t, false);
    sfx.play('win');
    IFPD.confetti(3000);
    const round = S.pieces;
    setTimeout(() => {
      if (S.pieces !== round || S.phase !== 'done') return;
      overlay({
        title: '🎉 Puzzle complete!',
        text: `${S.n} pieces in ${fmt(t)}` + (record ? '\n⭐ New best time!' : `\nBest time: ${fmt(IFPD.best.get(key))}`),
        buttons: [
          { label: '▶ Play again', kind: 'good', onClick: () => startPuzzle(S.n) },
          { label: 'New puzzle', kind: 'secondary', onClick: showPictureMenu },
        ],
      });
    }, 1800);
  }

  let lastStatus = '';
  function updateStatus(force) {
    const txt = S.pieces.length ? `⏱ ${fmt(S.time)}   🧩 ${S.placed}/${S.pieces.length}` : '';
    if (force || txt !== lastStatus) { statusEl.textContent = txt; lastStatus = txt; }
  }

  // ===================================================================================
  // Input — every pointer can carry its own piece
  // ===================================================================================
  const held = new Map(); // pointerId -> piece

  function pieceAt(x, y) {
    const [u, v] = toUnits(x, y);
    for (let i = S.pieces.length - 1; i >= 0; i--) {
      const p = S.pieces[i];
      if (p.placed || p.held !== null) continue;
      const lx = u - p.x, ly = v - p.y;
      if (lx < -PAD || lx > 1 + PAD || ly < -PAD || ly > 1 + PAD) continue;
      if (hitCtx.isPointInPath(p.path, lx, ly)) return p;
    }
    // forgiving fallback for fingers: nearest free piece centre within ~0.6 cell
    let best = null, bd = 0.6;
    for (let i = S.pieces.length - 1; i >= 0; i--) {
      const p = S.pieces[i];
      if (p.placed || p.held !== null) continue;
      const d = Math.hypot(u - p.x - 0.5, (v - p.y - 0.5) * S.k);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  IFPD.pointers(canvas, {
    down(pt) {
      if (S.phase !== 'play' || !L || IFPD.overlay.visible) return false;
      const p = pieceAt(pt.x, pt.y);
      if (!p) return false;
      const [u, v] = toUnits(pt.x, pt.y);
      p.held = pt.id;
      p.snapAnim = null;
      pt.data.piece = p;
      pt.data.gx = p.gx = u - p.x; pt.data.gy = p.gy = v - p.y;
      held.set(pt.id, p);
      S.pieces.splice(S.pieces.indexOf(p), 1);
      S.pieces.push(p);
      sfx.play('tap', { volume: 0.7, pitch: 0.7, pan: (pt.x / L.W) * 2 - 1 });
      return true;
    },
    move(pt) {
      const p = pt.data.piece;
      if (!p || p.held !== pt.id) return;
      const [u, v] = toUnits(pt.x, pt.y);
      const b = bounds();
      p.x = util.clamp(u - pt.data.gx, b.x0, b.x1);
      p.y = util.clamp(v - pt.data.gy, b.y0, b.y1);
    },
    up(pt) {
      const p = pt.data.piece;
      held.delete(pt.id);
      if (!p || p.held !== pt.id) return;
      p.held = null;
      if (S.phase !== 'play') return;
      const pan = (pt.x / L.W) * 2 - 1;
      if (Math.hypot(p.x - p.c, (p.y - p.r) * S.k) < SNAP) {
        p.placed = true;
        p.snapAnim = { fx: p.x, fy: p.y, t: 0 };
        p.x = p.c; p.y = p.r;
        p.flash = 1;
        S.placed++;
        // placed pieces go to the bottom of the stack
        S.pieces.splice(S.pieces.indexOf(p), 1);
        S.pieces.unshift(p);
        sfx.play('snap', { pan });
        sfx.play('place', { volume: 0.6, pan, pitch: 1.2 });
        updateStatus();
        if (S.placed === S.pieces.length) complete();
      } else {
        sfx.play('place', { volume: 0.35, pitch: 0.8, pan });
      }
    },
  });

  // ===================================================================================
  // Keyboard — a virtual finger (arrows + Space) drags pieces through the same pointer code above
  // ===================================================================================
  const KB = window.CosmiqInput && CosmiqInput.keys;
  let kbState = '';
  function syncKeys() {
    if (!KB) return;
    const playing = S.phase === 'play' && !IFPD.overlay.visible;
    KB.cursor(playing);
    const st = playing ? 'play' : 'menu';
    if (st === kbState) return;
    kbState = st;
    if (playing) {
      KB.help('Jigsaw', [['← ↑ → ↓', 'Move the hand (W A S D too)'], ['Shift', 'Hold to move slowly'],
        ['Space', 'Hold to pick up & drag, let go to drop'], ['G', 'Ghost picture on / off']]);
    } else {
      KB.help('Jigsaw', [['← → ↑ ↓', 'Choose'], ['Enter', 'Select'], ['Tab', 'Next button']]);
    }
  }
  if (KB) {
    // overlays come and go inside the stage: the cursor is only on while solving
    new MutationObserver(syncKeys).observe(page.stage, { childList: true });
    CosmiqInput.onChange(() => { kbState = ''; syncKeys(); });
    KB.on(e => {
      if (e.type !== 'keydown' || e.code !== 'KeyG') return;
      if (S.phase !== 'play' || IFPD.overlay.visible) return;
      e.preventDefault();
      if (!e.repeat) toggleGhost();
    });
  }

  // ===================================================================================
  // Loop
  // ===================================================================================
  function update(dt) {
    if (S.phase === 'play' && !IFPD.overlay.visible) S.time += dt;
    if (S.phase === 'done') S.doneT += dt;
    for (const p of S.pieces) {
      if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 1.6);
      if (p.snapAnim) { p.snapAnim.t += dt / 0.12; if (p.snapAnim.t >= 1) p.snapAnim = null; }
    }
    updateStatus();
  }

  function drawPiece(ctx, p, lifted) {
    const { s, sy, ox, oy } = L;
    let x = p.x, y = p.y;
    if (p.snapAnim) { const t = 1 - Math.pow(1 - p.snapAnim.t, 3); x = util.lerp(p.snapAnim.fx, p.c, t); y = util.lerp(p.snapAnim.fy, p.r, t); }
    const pw = (1 + 2 * PAD) * s, ph = (1 + 2 * PAD) * sy;
    let X = ox + (x - PAD) * s, Y = oy + (y - PAD) * sy;
    const sp = p.shadowPad * (s / S.spriteScale);
    if (!p.placed) {
      const off = lifted ? s * 0.12 : s * 0.035;
      ctx.globalAlpha = lifted ? 0.4 : 0.55;
      ctx.drawImage(p.shadow, X - sp + off, Y - sp + off * 1.3, pw + sp * 2, ph + sp * 2);
      ctx.globalAlpha = 1;
    }
    if (lifted) {
      const g = 1.05;
      X -= pw * (g - 1) / 2 + s * 0.04; Y -= ph * (g - 1) / 2 + s * 0.06;
      ctx.drawImage(p.sprite, X, Y, pw * g, ph * g);
    } else ctx.drawImage(p.sprite, X, Y, pw, ph);
    if (p.flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = p.flash * 0.45;
      ctx.drawImage(p.sprite, X, Y, pw, ph);
      ctx.restore();
    }
  }

  function render() {
    if (!L || L.W !== view.width || L.H !== view.height) layout();
    const ctx = view.ctx;
    if (S.pieces.length && S.spriteScale !== L.s && performance.now() - S.lastResize > 180) buildSprites();
    ctx.drawImage(L.bg, 0, 0, L.W, L.H);
    if (!S.pieces.length) return;
    if (S.ghost || S.phase === 'done') {
      ctx.globalAlpha = S.phase === 'done' ? Math.min(1, S.doneT * 0.8) : 0.22;
      ctx.drawImage(S.pic, L.ox, L.oy, L.tw, L.th);
      ctx.globalAlpha = 1;
    }
    for (const p of S.pieces) if (p.held === null && !(S.phase === 'done' && S.doneT > 1.2)) drawPiece(ctx, p, false);
    for (const p of S.pieces) if (p.held !== null) drawPiece(ctx, p, true);
  }

  IFPD.loop(update, render);
  layout();
  showPictureMenu();
  syncKeys();

  // debug hook for automated tests
  window.__game = {
    S, get L() { return L; }, PICS, getPicture,
    client(ux, uy) { const r = canvas.getBoundingClientRect(); return { x: r.left + L.ox + ux * L.s, y: r.top + L.oy + uy * L.sy }; },
    pieceClient(p) { return this.client(p.x + 0.5, p.y + 0.5); },
    slotClient(p) { return this.client(p.c + 0.5, p.r + 0.5); },
    offscreen() {
      return S.pieces.filter(p => { const a = this.client(p.x, p.y), b = this.client(p.x + 1, p.y + 1), r = canvas.getBoundingClientRect(); return a.x < r.left || a.y < r.top || b.x > r.right || b.y > r.bottom; }).length;
    },
  };
})();
