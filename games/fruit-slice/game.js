/*
 * Fruit Slice — every finger is a blade. Classic / Arcade / 2 players (split screen).
 * World units: each play field is 1000 units tall; width = field px / U (U = px per unit).
 */
(function () {
  'use strict';

  const { util, draw } = IFPD;
  const { clamp, rand, randInt, lerp } = util;
  const TAU = Math.PI * 2;

  const G = 1500;                 // gravity, units/s^2
  const TRAIL_LIFE = 150;         // ms a blade trail point lives
  const SLICE_SPEED = 0.38;       // min blade speed in field-heights per second
  const STAIN_LIFE = 9;           // s
  const MAX_STAINS = 26;
  const COMBO_GAP = 280;          // ms without a slice that ends a swipe's combo
  const ARCADE_TIME = 60;
  const FONT = '"Segoe UI", Roboto, system-ui, sans-serif';

  const MODES = {
    classic: { label: 'Classic', fields: 1, lives: 3, desc: 'Miss 3 fruits or hit a bomb and it is over.' },
    arcade: { label: 'Arcade', fields: 1, lives: 0, desc: '60 seconds. Bombs cost 10 points and freeze your blade.' },
    duo: { label: '2 Players', fields: 2, lives: 3, desc: 'Left vs right. Each side has its own fruit and 3 lives.' },
  };

  // ---------------------------------------------------------------------------
  // Fruit catalogue: whole-fruit painter, cross-section painter, juice colour.
  // Painters draw centred at (0,0) for radius R (in sprite pixels).
  // ---------------------------------------------------------------------------

  function radial(ctx, x0, y0, r0, x1, y1, r1, stops) {
    const g = ctx.createRadialGradient(x0, y0, r0, x1, y1, r1);
    for (const [o, c] of stops) g.addColorStop(o, c);
    return g;
  }

  // Lighting shared by all fruits: soft key light top-left, rim darkening, specular glint.
  function lightUp(ctx, R, pathFn, gloss) {
    ctx.save();
    pathFn();
    ctx.clip();
    ctx.fillStyle = radial(ctx, -0.38 * R, -0.42 * R, 0.05 * R, 0, 0, 1.12 * R, [
      [0, `rgba(255,255,255,${0.32 * gloss + 0.08})`], [0.35, 'rgba(255,255,255,0.04)'],
      [0.7, 'rgba(0,0,0,0.02)'], [1, 'rgba(0,0,0,0.55)']]);
    ctx.fillRect(-1.3 * R, -1.3 * R, 2.6 * R, 2.6 * R);
    // bounce light from below
    ctx.fillStyle = radial(ctx, 0.25 * R, 0.85 * R, 0, 0.25 * R, 0.85 * R, 0.7 * R, [[0, 'rgba(255,230,190,0.16)'], [1, 'rgba(255,230,190,0)']]);
    ctx.fillRect(-1.3 * R, -1.3 * R, 2.6 * R, 2.6 * R);
    ctx.restore();
    if (gloss > 0) {
      ctx.save();
      ctx.translate(-0.36 * R, -0.42 * R);
      ctx.rotate(-0.6);
      ctx.fillStyle = radial(ctx, 0, 0, 0, 0, 0, 0.26 * R, [[0, `rgba(255,255,255,${0.75 * gloss})`], [1, 'rgba(255,255,255,0)']]);
      ctx.scale(1, 0.55);
      ctx.beginPath(); ctx.arc(0, 0, 0.26 * R, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  function pores(ctx, R, n, light, dark, size) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * R;
      ctx.fillStyle = Math.random() < 0.5 ? light : dark;
      ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, size * rand(0.5, 1.2), 0, TAU); ctx.fill();
    }
  }

  function wedges(ctx, R, n, fill, sep, sepW) {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, a0 + 0.02, a1 - 0.02); ctx.closePath(); ctx.fill();
      // juice sacs
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = R * 0.012;
      for (let k = 0; k < 7; k++) {
        const a = lerp(a0 + 0.08, a1 - 0.08, Math.random()), d0 = rand(0.25, 0.6) * R;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * d0, Math.sin(a) * d0);
        ctx.lineTo(Math.cos(a) * (d0 + R * 0.3), Math.sin(a) * (d0 + R * 0.3)); ctx.stroke();
      }
    }
    ctx.strokeStyle = sep;
    ctx.lineWidth = sepW;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); ctx.stroke();
    }
    ctx.fillStyle = sep;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.12, 0, TAU); ctx.fill();
  }

  function seed(ctx, x, y, ang, len, wid, color) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(0, 0, len, wid, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.ellipse(-len * 0.3, -wid * 0.3, len * 0.35, wid * 0.3, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  const FRUITS = {
    watermelon: {
      r: 84, juice: '#e3233a', stain: '#c2102a', points: 1,
      path(ctx, R) { ctx.beginPath(); ctx.ellipse(0, 0, R, R * 0.84, 0, 0, TAU); },
      whole(ctx, R) {
        const path = () => this.path(ctx, R);
        path();
        ctx.fillStyle = radial(ctx, -0.3 * R, -0.3 * R, 0, 0, 0, R, [[0, '#6fb24e'], [0.6, '#3f8a2c'], [1, '#1f5418']]);
        ctx.fill();
        ctx.save(); path(); ctx.clip();
        ctx.strokeStyle = '#173f12';
        ctx.lineCap = 'round';
        for (let k = -4; k <= 4; k++) {
          ctx.lineWidth = R * rand(0.09, 0.13);
          ctx.beginPath();
          for (let i = 0; i <= 40; i++) {
            const x = -R + (2 * R * i) / 40;
            const env = Math.sqrt(Math.max(0, 1 - (x / R) ** 2));
            const y = (k / 4.4) * R * 0.84 * env + Math.sin(i * 1.7 + k) * R * 0.025;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        pores(ctx, R, 120, 'rgba(200,240,160,0.12)', 'rgba(0,30,0,0.12)', R * 0.02);
        ctx.restore();
        lightUp(ctx, R, path, 0.55);
      },
      cross(ctx, R) {
        ctx.fillStyle = '#1d5a1a'; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
        ctx.fillStyle = radial(ctx, 0, 0, R * 0.75, 0, 0, R * 0.93, [[0, '#ffd0c8'], [0.5, '#f2f7dc'], [1, '#cfe6a8']]);
        ctx.beginPath(); ctx.arc(0, 0, R * 0.93, 0, TAU); ctx.fill();
        ctx.fillStyle = radial(ctx, -0.1 * R, -0.1 * R, 0, 0, 0, R * 0.8, [[0, '#ff6b78'], [0.7, '#ee2a43'], [1, '#d8203c']]);
        ctx.beginPath(); ctx.arc(0, 0, R * 0.8, 0, TAU); ctx.fill();
        pores(ctx, R * 0.75, 160, 'rgba(255,190,200,0.35)', 'rgba(150,0,20,0.15)', R * 0.018);
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU + rand(-0.1, 0.1), d = R * rand(0.42, 0.56);
          seed(ctx, Math.cos(a) * d, Math.sin(a) * d, a, R * 0.065, R * 0.035, '#1b120c');
        }
      },
    },
    orange: {
      r: 62, juice: '#ffa21c', stain: '#f08a00', points: 1,
      path(ctx, R) { ctx.beginPath(); ctx.arc(0, 0, R * 0.95, 0, TAU); },
      whole(ctx, R) {
        const path = () => this.path(ctx, R);
        path();
        ctx.fillStyle = radial(ctx, -0.3 * R, -0.35 * R, 0, 0, 0, R, [[0, '#ffc25a'], [0.55, '#f58c12'], [1, '#b85200']]);
        ctx.fill();
        ctx.save(); path(); ctx.clip();
        pores(ctx, R, 380, 'rgba(255,220,150,0.22)', 'rgba(140,60,0,0.2)', R * 0.018);
        ctx.restore();
        ctx.fillStyle = '#6a7a1c';
        ctx.beginPath(); ctx.arc(R * 0.05, -R * 0.88, R * 0.07, 0, TAU); ctx.fill();
        ctx.fillStyle = '#3f5410';
        ctx.beginPath(); ctx.arc(R * 0.05, -R * 0.88, R * 0.035, 0, TAU); ctx.fill();
        lightUp(ctx, R, path, 0.6);
      },
      cross(ctx, R) {
        ctx.fillStyle = '#f08414'; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff1d2'; ctx.beginPath(); ctx.arc(0, 0, R * 0.9, 0, TAU); ctx.fill();
        ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R * 0.84, 0, TAU); ctx.clip();
        wedges(ctx, R * 0.84, 10, radial(ctx, 0, 0, 0, 0, 0, R * 0.84, [[0, '#ffc860'], [1, '#ff9a1a']]), '#fff0d0', R * 0.035);
        ctx.restore();
      },
    },
    apple: {
      r: 60, juice: '#f2e39a', stain: '#d9c46a', points: 1,
      path(ctx, R) {
        ctx.beginPath();
        ctx.moveTo(0, -0.68 * R);
        ctx.bezierCurveTo(0.38 * R, -1.02 * R, 1.02 * R, -0.86 * R, 0.96 * R, -0.08 * R);
        ctx.bezierCurveTo(0.92 * R, 0.62 * R, 0.48 * R, 0.98 * R, 0.16 * R, 0.9 * R);
        ctx.quadraticCurveTo(0, 0.84 * R, -0.16 * R, 0.9 * R);
        ctx.bezierCurveTo(-0.48 * R, 0.98 * R, -0.92 * R, 0.62 * R, -0.96 * R, -0.08 * R);
        ctx.bezierCurveTo(-1.02 * R, -0.86 * R, -0.38 * R, -1.02 * R, 0, -0.68 * R);
        ctx.closePath();
      },
      whole(ctx, R) {
        const path = () => this.path(ctx, R);
        path();
        ctx.fillStyle = radial(ctx, -0.3 * R, -0.3 * R, 0, 0, 0, R, [[0, '#ff5a5e'], [0.55, '#d0182a'], [1, '#6a0612']]);
        ctx.fill();
        ctx.save(); path(); ctx.clip();
        ctx.strokeStyle = 'rgba(255,215,90,0.22)';
        for (let i = 0; i < 40; i++) {
          const a = rand(-1.3, 1.3);
          ctx.lineWidth = R * rand(0.01, 0.03);
          ctx.beginPath();
          ctx.moveTo(Math.sin(a) * R * 0.2, -0.6 * R);
          ctx.quadraticCurveTo(Math.sin(a) * R * 1.1, 0, Math.sin(a) * R * 0.5, 0.9 * R);
          ctx.stroke();
        }
        pores(ctx, R, 90, 'rgba(255,240,180,0.35)', 'rgba(255,240,180,0.2)', R * 0.012);
        ctx.restore();
        lightUp(ctx, R, path, 0.85);
        // stem + leaf
        ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = R * 0.07; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, -0.66 * R); ctx.quadraticCurveTo(0.02 * R, -0.95 * R, 0.14 * R, -1.08 * R); ctx.stroke();
        ctx.save(); ctx.translate(0.12 * R, -0.86 * R); ctx.rotate(-0.5);
        ctx.fillStyle = radial(ctx, 0.15 * R, -0.05 * R, 0, 0.2 * R, 0, 0.4 * R, [[0, '#8bd04a'], [1, '#2f7a1c']]);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(0.22 * R, -0.2 * R, 0.48 * R, 0); ctx.quadraticCurveTo(0.22 * R, 0.16 * R, 0, 0); ctx.fill();
        ctx.strokeStyle = 'rgba(20,60,10,0.6)'; ctx.lineWidth = R * 0.015;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0.44 * R, 0); ctx.stroke();
        ctx.restore();
      },
      cross(ctx, R) {
        ctx.fillStyle = '#b4101e'; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
        ctx.fillStyle = radial(ctx, 0, 0, R * 0.1, 0, 0, R * 0.96, [[0, '#f6e8b0'], [0.5, '#fbf4d6'], [1, '#f1e4ad']]);
        ctx.beginPath(); ctx.arc(0, 0, R * 0.95, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(200,170,90,0.6)'; ctx.lineWidth = R * 0.025;
        ctx.beginPath();
        for (let i = 0; i <= 10; i++) {
          const a = (i / 10) * TAU - Math.PI / 2, d = i % 2 ? R * 0.14 : R * 0.36;
          if (i === 0) ctx.moveTo(Math.cos(a) * d, Math.sin(a) * d); else ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d);
        }
        ctx.closePath(); ctx.stroke();
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU - Math.PI / 2;
          seed(ctx, Math.cos(a) * R * 0.22, Math.sin(a) * R * 0.22, a, R * 0.08, R * 0.045, '#4a2a12');
        }
      },
    },
    lemon: {
      r: 56, juice: '#f7e54e', stain: '#e8cf20', points: 1,
      path(ctx, R) {
        ctx.beginPath();
        ctx.moveTo(-1.0 * R, 0);
        ctx.bezierCurveTo(-0.9 * R, -0.85 * R, 0.9 * R, -0.85 * R, 1.0 * R, 0);
        ctx.bezierCurveTo(0.9 * R, 0.85 * R, -0.9 * R, 0.85 * R, -1.0 * R, 0);
        ctx.closePath();
      },
      whole(ctx, R) {
        const path = () => this.path(ctx, R);
        path();
        ctx.fillStyle = radial(ctx, -0.3 * R, -0.3 * R, 0, 0, 0, R, [[0, '#fff48a'], [0.55, '#f4cf16'], [1, '#a88400']]);
        ctx.fill();
        ctx.save(); path(); ctx.clip();
        pores(ctx, R, 320, 'rgba(255,255,200,0.25)', 'rgba(150,110,0,0.18)', R * 0.016);
        ctx.restore();
        ctx.fillStyle = '#c9a80c';
        ctx.beginPath(); ctx.ellipse(-0.98 * R, 0, 0.1 * R, 0.08 * R, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(0.98 * R, 0, 0.1 * R, 0.08 * R, 0, 0, TAU); ctx.fill();
        lightUp(ctx, R, path, 0.6);
      },
      cross(ctx, R) {
        ctx.fillStyle = '#f2cc1a'; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fffbe2'; ctx.beginPath(); ctx.arc(0, 0, R * 0.9, 0, TAU); ctx.fill();
        ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R * 0.84, 0, TAU); ctx.clip();
        wedges(ctx, R * 0.84, 9, radial(ctx, 0, 0, 0, 0, 0, R * 0.84, [[0, '#fff3a0'], [1, '#f6e050']]), '#fffbe6', R * 0.035);
        ctx.restore();
      },
    },
    kiwi: {
      r: 56, juice: '#9fd24a', stain: '#78b02a', points: 1,
      path(ctx, R) { ctx.beginPath(); ctx.ellipse(0, 0, R, R * 0.8, 0, 0, TAU); },
      whole(ctx, R) {
        const path = () => this.path(ctx, R);
        path();
        ctx.fillStyle = radial(ctx, -0.3 * R, -0.3 * R, 0, 0, 0, R, [[0, '#ad8a56'], [0.6, '#7d5a2e'], [1, '#3e2a12']]);
        ctx.fill();
        ctx.save(); path(); ctx.clip();
        ctx.lineCap = 'round';
        for (let i = 0; i < 700; i++) {
          const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * R, x = Math.cos(a) * d, y = Math.sin(a) * d * 0.8;
          const ang = a + rand(-0.8, 0.8);
          ctx.strokeStyle = Math.random() < 0.5 ? 'rgba(210,180,120,0.35)' : 'rgba(40,25,8,0.3)';
          ctx.lineWidth = R * 0.012;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * R * 0.05, y + Math.sin(ang) * R * 0.05); ctx.stroke();
        }
        ctx.restore();
        lightUp(ctx, R, path, 0.2);
      },
      cross(ctx, R) {
        ctx.fillStyle = '#6b4a24'; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
        ctx.fillStyle = radial(ctx, 0, 0, R * 0.2, 0, 0, R * 0.95, [[0, '#e4f29a'], [0.45, '#a6d24c'], [1, '#5f9e26']]);
        ctx.beginPath(); ctx.arc(0, 0, R * 0.95, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(240,255,200,0.35)'; ctx.lineWidth = R * 0.012;
        for (let i = 0; i < 60; i++) {
          const a = (i / 60) * TAU;
          ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * 0.24, Math.sin(a) * R * 0.24); ctx.lineTo(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9); ctx.stroke();
        }
        for (let i = 0; i < 46; i++) {
          const a = (i / 46) * TAU + rand(-0.05, 0.05), d = R * rand(0.32, 0.46);
          seed(ctx, Math.cos(a) * d, Math.sin(a) * d, a, R * 0.045, R * 0.022, '#140d06');
        }
        ctx.fillStyle = radial(ctx, 0, 0, 0, 0, 0, R * 0.26, [[0, '#ffffee'], [1, '#e6efb8']]);
        ctx.beginPath(); ctx.ellipse(0, 0, R * 0.26, R * 0.18, 0, 0, TAU); ctx.fill();
      },
    },
    coconut: {
      r: 68, juice: '#f4f3ea', stain: '#d6d2c0', points: 1,
      path(ctx, R) { ctx.beginPath(); ctx.ellipse(0, 0, R * 0.95, R * 0.9, 0, 0, TAU); },
      whole(ctx, R) {
        const path = () => this.path(ctx, R);
        path();
        ctx.fillStyle = radial(ctx, -0.3 * R, -0.3 * R, 0, 0, 0, R, [[0, '#8f6236'], [0.6, '#5e3a1a'], [1, '#2a170a']]);
        ctx.fill();
        ctx.save(); path(); ctx.clip();
        ctx.lineCap = 'round';
        for (let i = 0; i < 260; i++) {
          const x = rand(-R, R), y = rand(-R, R), ang = rand(-0.5, 0.5) + Math.PI / 2 + x / R * 0.6;
          const l = R * rand(0.15, 0.4);
          ctx.strokeStyle = Math.random() < 0.55 ? 'rgba(180,130,80,0.3)' : 'rgba(25,12,4,0.35)';
          ctx.lineWidth = R * rand(0.008, 0.022);
          ctx.beginPath(); ctx.moveTo(x, y);
          ctx.quadraticCurveTo(x + Math.cos(ang) * l * 0.5 + rand(-4, 4), y + Math.sin(ang) * l * 0.5, x + Math.cos(ang) * l, y + Math.sin(ang) * l);
          ctx.stroke();
        }
        ctx.fillStyle = '#1c0f06';
        for (const [ex, ey] of [[-0.14, -0.5], [0.14, -0.5], [0, -0.32]]) {
          ctx.beginPath(); ctx.ellipse(ex * R, ey * R, R * 0.07, R * 0.06, 0, 0, TAU); ctx.fill();
        }
        ctx.restore();
        lightUp(ctx, R, path, 0.15);
      },
      cross(ctx, R) {
        ctx.fillStyle = '#3e2410'; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
        ctx.fillStyle = '#6a4220'; ctx.beginPath(); ctx.arc(0, 0, R * 0.9, 0, TAU); ctx.fill();
        ctx.fillStyle = radial(ctx, 0, 0, R * 0.55, 0, 0, R * 0.86, [[0, '#ffffff'], [1, '#f1ece0']]);
        ctx.beginPath(); ctx.arc(0, 0, R * 0.86, 0, TAU); ctx.fill();
        ctx.fillStyle = radial(ctx, -R * 0.15, -R * 0.15, 0, 0, 0, R * 0.62, [[0, 'rgba(235,245,250,1)'], [1, 'rgba(205,220,228,1)']]);
        ctx.beginPath(); ctx.arc(0, 0, R * 0.62, 0, TAU); ctx.fill();
      },
    },
    strawberry: {
      r: 52, juice: '#e0172f', stain: '#b80c22', points: 1,
      path(ctx, R) {
        ctx.beginPath();
        ctx.moveTo(0, 0.98 * R);
        ctx.bezierCurveTo(-0.62 * R, 0.78 * R, -1.02 * R, 0.05 * R, -0.88 * R, -0.45 * R);
        ctx.bezierCurveTo(-0.74 * R, -0.86 * R, 0.74 * R, -0.86 * R, 0.88 * R, -0.45 * R);
        ctx.bezierCurveTo(1.02 * R, 0.05 * R, 0.62 * R, 0.78 * R, 0, 0.98 * R);
        ctx.closePath();
      },
      whole(ctx, R) {
        const path = () => this.path(ctx, R);
        path();
        ctx.fillStyle = radial(ctx, -0.3 * R, -0.3 * R, 0, 0, 0, R, [[0, '#ff6464'], [0.55, '#dc1424'], [1, '#76000e']]);
        ctx.fill();
        ctx.save(); path(); ctx.clip();
        for (let row = 0; row < 9; row++) {
          for (let c = 0; c < 9; c++) {
            const x = (c - 4) * R * 0.22 + (row % 2) * R * 0.11, y = -0.55 * R + row * R * 0.18;
            ctx.fillStyle = 'rgba(90,0,10,0.35)';
            ctx.beginPath(); ctx.ellipse(x, y + R * 0.01, R * 0.045, R * 0.06, 0, 0, TAU); ctx.fill();
            ctx.fillStyle = '#f3d45a';
            ctx.beginPath(); ctx.ellipse(x, y, R * 0.025, R * 0.04, 0, 0, TAU); ctx.fill();
          }
        }
        ctx.restore();
        lightUp(ctx, R, path, 0.9);
        // sepals
        ctx.save(); ctx.translate(0, -0.7 * R);
        for (let i = 0; i < 7; i++) {
          const a = -Math.PI / 2 + (i - 3) * 0.42;
          ctx.save(); ctx.rotate(a + Math.PI / 2);
          ctx.fillStyle = i % 2 ? '#2f8a2a' : '#3fa236';
          ctx.beginPath(); ctx.moveTo(-R * 0.08, 0); ctx.quadraticCurveTo(0, R * 0.42, R * 0.08, 0); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = '#2a6a1c';
        ctx.beginPath(); ctx.ellipse(0, -0.02 * R, R * 0.12, R * 0.07, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#3f7a20'; ctx.lineWidth = R * 0.06; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, -0.04 * R); ctx.lineTo(0.05 * R, -0.25 * R); ctx.stroke();
        ctx.restore();
      },
      cross(ctx, R) {
        ctx.fillStyle = '#cf1022'; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
        ctx.fillStyle = radial(ctx, 0, 0, 0, 0, 0, R * 0.9, [[0, '#ffe6e2'], [0.45, '#ff9aa0'], [1, '#ec3446']]);
        ctx.beginPath(); ctx.arc(0, 0, R * 0.9, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = R * 0.02;
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * TAU;
          ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * 0.2, Math.sin(a) * R * 0.2); ctx.lineTo(Math.cos(a) * R * 0.85, Math.sin(a) * R * 0.85); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,245,240,0.9)';
        ctx.beginPath(); ctx.ellipse(0, 0, R * 0.16, R * 0.3, 0, 0, TAU); ctx.fill();
      },
    },
  };
  const FRUIT_KEYS = Object.keys(FRUITS);

  const BOMB = {
    r: 58,
    path(ctx, R) { ctx.beginPath(); ctx.arc(0, 0, R * 0.9, 0, TAU); },
    fuseTip: { x: 0.66, y: -1.3 },
    whole(ctx, R) {
      // red danger aura is drawn live; sprite is the metal body
      ctx.fillStyle = radial(ctx, -0.35 * R, -0.4 * R, 0.02 * R, 0, 0, 0.9 * R, [[0, '#a4a8b8'], [0.22, '#454a5a'], [0.75, '#16181f'], [1, '#06070a']]);
      ctx.beginPath(); ctx.arc(0, 0, R * 0.9, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = R * 0.03;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.86, 3.4, 4.6); ctx.stroke();
      // cap
      ctx.save(); ctx.rotate(0.55);
      const cg = ctx.createLinearGradient(-0.22 * R, 0, 0.22 * R, 0);
      cg.addColorStop(0, '#3a3a42'); cg.addColorStop(0.35, '#d0d0da'); cg.addColorStop(1, '#2a2a30');
      ctx.fillStyle = cg;
      ctx.fillRect(-0.24 * R, -1.04 * R, 0.48 * R, 0.26 * R);
      ctx.fillStyle = '#8a8a96';
      ctx.beginPath(); ctx.ellipse(0, -1.04 * R, 0.24 * R, 0.07 * R, 0, 0, TAU); ctx.fill();
      ctx.restore();
      // fuse
      ctx.strokeStyle = '#e0c088'; ctx.lineWidth = R * 0.11; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0.5 * R, -0.9 * R); ctx.quadraticCurveTo(0.42 * R, -1.22 * R, 0.66 * R, -1.3 * R); ctx.stroke();
      ctx.strokeStyle = 'rgba(80,50,20,0.6)'; ctx.lineWidth = R * 0.02;
      for (let i = 0; i < 4; i++) {
        const y = -0.9 * R - i * 0.07 * R;
        ctx.beginPath(); ctx.moveTo(0.45 * R, y); ctx.lineTo(0.55 * R, y - 0.04 * R); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.ellipse(-0.35 * R, -0.42 * R, 0.2 * R, 0.1 * R, -0.7, 0, TAU); ctx.fill();
    },
  };

  // ---------------------------------------------------------------------------
  // Sprite cache (rebuilt when the pixel scale changes)
  // ---------------------------------------------------------------------------

  const sprites = { scale: 0, whole: {}, cross: {}, bomb: null, shadow: null };

  function makeSprite(rUnits, scale, paint, pad = 1.35) {
    const R = rUnits * scale;
    const size = Math.ceil(R * 2 * pad);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    x.translate(size / 2, size / 2);
    paint(x, R);
    c.units = size / scale; // drawn size in world units
    return c;
  }

  function ensureSprites(scale) {
    if (Math.abs(sprites.scale - scale) < 0.01) return;
    sprites.scale = scale;
    for (const k of FRUIT_KEYS) {
      const f = FRUITS[k];
      sprites.whole[k] = makeSprite(f.r, scale, (c, R) => f.whole(c, R));
      sprites.cross[k] = makeSprite(f.r, scale, (c, R) => f.cross(c, R), 1.02);
    }
    sprites.bomb = makeSprite(BOMB.r, scale, (c, R) => BOMB.whole(c, R), 1.55);
    sprites.shadow = makeSprite(60, scale, (c, R) => {
      c.fillStyle = radial(c, 0, 0, 0, 0, 0, R, [[0, 'rgba(0,0,0,0.42)'], [0.55, 'rgba(0,0,0,0.25)'], [1, 'rgba(0,0,0,0)']]);
      c.beginPath(); c.arc(0, 0, R, 0, TAU); c.fill();
    }, 1.0);
  }

  function blit(ctx, spr, sizeMul = 1) {
    const s = spr.units * sizeMul;
    ctx.drawImage(spr, -s / 2, -s / 2, s, s);
  }

  // ---------------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------------

  const canvas = document.getElementById('game');
  IFPD.setupPage({ title: 'Fruit Slice', onRestart: () => restart() });
  let W = 0, H = 0, U = 1;
  let bg = null;
  let view = null;

  let mode = null;        // 'classic' | 'arcade' | 'duo'
  let state = 'menu';     // 'menu' | 'play' | 'exploding' | 'over'
  let fields = [];
  let timeLeft = 0;
  let explodeT = 0;
  let globalFlash = 0;
  let autoSpawn = true;   // tests can switch off random waves
  const blades = new Map();
  const fadingBlades = [];

  function makeField(idx) {
    return {
      idx, x0: 0, wPx: 1, fw: 1000,
      fruits: [], halves: [], drops: [], sparks: [], stains: [], popups: [], blasts: [], misses: [], queue: [],
      score: 0, lives: 3, lostAnim: [0, 0, 0], out: false, freeze: 0, spawnT: 1.2, elapsed: 0,
      shake: 0, flash: 0, bump: 0, demo: false,
    };
  }

  function layout() {
    if (!view || !W || !H) return;
    U = H / 1000;
    ensureSprites(U * view.dpr);
    bg = null;
    const n = fields.length || 1;
    fields.forEach((f, i) => {
      const wPx = W / n;
      const fw = wPx / U;
      const k = fw / f.fw;
      if (Math.abs(k - 1) > 1e-6) {
        for (const list of [f.fruits, f.halves, f.drops, f.sparks, f.stains, f.popups, f.blasts, f.misses]) {
          for (const o of list) { o.x *= k; if (o.vx !== undefined) o.vx *= k; }
        }
      }
      f.x0 = i * wPx; f.wPx = wPx; f.fw = fw;
    });
    // trails are in pixels; drop them so nothing jumps
    blades.forEach(b => { b.pts.length = 0; });
    fadingBlades.length = 0;
  }

  function newFields(count, demo) {
    fields = [];
    for (let i = 0; i < count; i++) {
      const f = makeField(i);
      f.demo = !!demo;
      f.fw = (W / count) / U || 1000;
      fields.push(f);
    }
    layout();
  }

  function start(m) {
    mode = m;
    state = 'play';
    autoSpawn = true;
    IFPD.overlay.hide();
    newFields(MODES[m].fields, false);
    for (const f of fields) { f.lives = MODES[m].lives; f.spawnT = 0.8; }
    timeLeft = ARCADE_TIME;
    explodeT = 0; globalFlash = 0;
    blades.clear(); fadingBlades.length = 0;
    loop.resume();
    IFPD.sfx.play('whoosh', { volume: 0.8 });
  }

  function restart() {
    if (mode) start(mode); else showMenu();
  }

  function bestKey(m) { return 'fruit-slice-' + m; }

  function showMenu() {
    state = 'menu';
    newFields(1, true);
    const b = m => { const v = IFPD.best.get(bestKey(m)); return v == null ? '' : `  (best ${v})`; };
    IFPD.overlay.show({
      title: 'Fruit Slice',
      text: 'Swipe across the fruit with your finger — every finger is a blade!\nSlice 3 or more in one swipe for a combo. Never slice the bombs.\n\n' +
        'Classic: miss 3 fruits or hit a bomb and the game ends.\nArcade: 60 seconds, bombs cost 10 points.\n2 Players: left half vs right half.',
      buttons: [
        { label: 'Classic' + b('classic'), kind: 'primary', onClick: () => start('classic') },
        { label: 'Arcade' + b('arcade'), kind: 'good', onClick: () => start('arcade') },
        { label: '2 Players' + b('duo'), kind: 'bad', onClick: () => start('duo') },
      ],
    });
  }

  function endGame() {
    if (state === 'over') return;
    state = 'over';
    for (const b of blades.values()) finishCombo(b);
    let title, text;
    let record = false;
    if (mode === 'duo') {
      const [a, b] = fields;
      const top = Math.max(a.score, b.score);
      record = IFPD.best.submit(bestKey('duo'), top);
      if (a.score === b.score) title = "It's a tie!";
      else title = (a.score > b.score ? 'Player 1' : 'Player 2') + ' wins!';
      text = `Player 1: ${a.score}     Player 2: ${b.score}` + (record ? '\nNew record for 2 players!' : `\nBest: ${IFPD.best.get(bestKey('duo'))}`);
      IFPD.sfx.play('win');
      IFPD.confetti(2600);
    } else {
      const s = fields[0].score;
      record = s > 0 && IFPD.best.submit(bestKey(mode), s);
      title = mode === 'arcade' ? "Time's up!" : 'Game over';
      text = `Score: ${s}\n` + (record ? 'New best score!' : `Best: ${IFPD.best.get(bestKey(mode)) ?? 0}`);
      IFPD.sfx.play(record ? 'win' : 'lose');
      if (record) IFPD.confetti(2600);
    }
    setTimeout(() => {
      if (state !== 'over') return;
      IFPD.overlay.show({
        title, text,
        buttons: [
          { label: 'Play again', kind: 'good', onClick: () => start(mode) },
          { label: 'Change mode', kind: 'primary', onClick: () => showMenu() },
        ],
      });
    }, 600);
  }

  // ---------------------------------------------------------------------------
  // Spawning
  // ---------------------------------------------------------------------------

  function launch(f, kind, opts = {}) {
    const isBomb = kind === 'bomb';
    const def = isBomb ? BOMB : FRUITS[kind];
    const r = def.r;
    const x = opts.x ?? rand(0.14, 0.86) * f.fw;
    const y = opts.y ?? 1000 + r + 10;
    const apex = opts.apex ?? rand(120, 360);
    const vy = opts.vy ?? -Math.sqrt(2 * G * Math.max(50, y - apex));
    const T = 2 * -vy / G;
    const tx = clamp(x + rand(-0.32, 0.32) * f.fw, 0.12 * f.fw, 0.88 * f.fw);
    const fruit = {
      kind, bomb: isBomb, r, x, y, vx: opts.vx ?? (tx - x) / T, vy,
      rot: isBomb ? rand(-0.4, 0.4) : rand(0, TAU), spin: isBomb ? rand(-0.6, 0.6) : rand(-3, 3), age: 0,
    };
    f.fruits.push(fruit);
    if (!f.demo) IFPD.sfx.play('whoosh', { volume: 0.35, pitch: rand(0.8, 1.2), pan: panOf(f, x) });
    return fruit;
  }

  function spawnWave(f) {
    const arcade = mode === 'arcade' && !f.demo;
    const d = clamp(f.elapsed / (arcade ? 50 : 110), 0, 1);
    const count = randInt(arcade ? 2 : 1, 2 + Math.round(d * 3.5));
    const salvo = count > 2 && Math.random() < 0.35 + d * 0.3;
    let bombChance = 0;
    if (!f.demo) {
      if (mode === 'arcade') bombChance = f.elapsed > 3 ? 0.13 : 0;
      else bombChance = f.elapsed > 6 ? 0.06 + 0.12 * d : 0;
    }
    let bombs = 0;
    const maxBombs = d > 0.6 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      let kind = FRUIT_KEYS[randInt(0, FRUIT_KEYS.length - 1)];
      if (i > 0 && bombs < maxBombs && Math.random() < bombChance * (count > 1 ? 1.4 : 0)) { kind = 'bomb'; bombs++; }
      f.queue.push({ delay: salvo ? i * rand(0.14, 0.22) : rand(0, 0.15), kind });
    }
    f.spawnT = lerp(arcade ? 1.7 : 2.5, arcade ? 1.0 : 1.2, d) + count * 0.1 + (f.demo ? 0.8 : 0);
  }

  // ---------------------------------------------------------------------------
  // Slicing
  // ---------------------------------------------------------------------------

  function segCircle(ax, ay, bx, by, cx, cy, r) {
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy) / L2 : 0;
    t = clamp(t, 0, 1);
    const px = ax + dx * t - cx, py = ay + dy * t - cy;
    return px * px + py * py <= r * r;
  }

  function panOf(f, x) { return clamp(((f.x0 + x * U) / W) * 2 - 1, -1, 1) * 0.8; }

  function fieldAt(px) {
    if (fields.length < 2) return fields[0];
    return fields[clamp(Math.floor(px / (W / fields.length)), 0, fields.length - 1)];
  }

  function bladeMove(b, x, y) {
    const now = performance.now();
    const last = b.pts[b.pts.length - 1];
    b.pts.push({ x, y, t: now });
    if (!last) return;
    const seg = Math.hypot(x - last.x, y - last.y);
    if (seg < 0.5) return;
    const dtMs = Math.max(4, now - last.t);
    const speed = (seg / dtMs) * 1000 / H; // field heights per second
    b.speed = speed;
    if (state !== 'play' || speed < SLICE_SPEED) return;
    const f = b.field;
    if (!f || f.out || f.freeze > 0) return;
    const ax = (last.x - f.x0) / U, ay = last.y / U, bx = (x - f.x0) / U, by = y / U;
    const ang = Math.atan2(by - ay, bx - ax);
    for (let i = f.fruits.length - 1; i >= 0; i--) {
      const fr = f.fruits[i];
      if (segCircle(ax, ay, bx, by, fr.x, fr.y, fr.r * 0.95)) {
        f.fruits.splice(i, 1);
        if (fr.bomb) { bombHit(f, fr); if (state !== 'play') return; }
        else sliceFruit(f, fr, ang, b, speed);
      }
    }
  }

  function sliceFruit(f, fr, ang, b, speed) {
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    const sep = rand(160, 260);
    const push = clamp(speed, 0.5, 3) * 60;
    for (const side of [-1, 1]) {
      f.halves.push({
        kind: fr.kind, r: fr.r, x: fr.x, y: fr.y,
        vx: fr.vx * 0.6 + nx * sep * side + Math.cos(ang) * push,
        vy: Math.min(fr.vy * 0.6, 200) + ny * sep * side + Math.sin(ang) * push - 120,
        cut: ang + (side > 0 ? Math.PI : 0),
        skin: fr.rot - ang - (side > 0 ? Math.PI : 0),
        spin: side * rand(2.5, 6) + fr.spin * 0.3, age: 0,
      });
    }
    const def = FRUITS[fr.kind];
    for (let i = 0; i < 22; i++) {
      const a = ang + rand(-0.9, 0.9) + (Math.random() < 0.5 ? 0 : Math.PI) * (Math.random() < 0.3 ? 1 : 0);
      const v = rand(150, 700);
      f.drops.push({ x: fr.x + rand(-0.4, 0.4) * fr.r, y: fr.y + rand(-0.4, 0.4) * fr.r, vx: Math.cos(a) * v + fr.vx * 0.3, vy: Math.sin(a) * v - 150, r: rand(3, 9), life: rand(0.5, 1.1), age: 0, color: def.juice });
    }
    addStain(f, fr, ang, def.stain);
    f.score += def.points;
    f.bump = 1;
    b.combo++;
    b.comboX += fr.x; b.comboY += fr.y;
    b.lastSlice = performance.now();
    const pan = panOf(f, fr.x);
    IFPD.sfx.play('slice', { volume: 0.9, pitch: rand(0.9, 1.15), pan });
    IFPD.sfx.play('squish', { volume: 0.7, pitch: rand(0.85, 1.2), pan });
  }

  function finishCombo(b) {
    const f = b.field;
    if (b.combo >= 3 && f && state === 'play') {
      const bonus = b.combo;
      f.score += bonus;
      f.bump = 1.4;
      const x = b.comboX / b.combo, y = b.comboY / b.combo;
      f.popups.push({ x: clamp(x, 160, f.fw - 160), y: clamp(y, 200, 820), text: `${b.combo} fruit combo!`, sub: `+${bonus}`, color: '#ffd84a', age: 0, life: 1.6, size: 64 });
      IFPD.sfx.play('ding', { volume: 0.7, pitch: 0.9 + b.combo * 0.06, pan: panOf(f, x) });
    }
    b.combo = 0; b.comboX = 0; b.comboY = 0;
  }

  function addStain(f, fr, ang, color) {
    const scale = U * view.dpr;
    const R = fr.r * scale;
    const size = Math.ceil(R * 4.2);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    x.translate(size / 2, size / 2);
    x.fillStyle = color;
    x.globalAlpha = 0.5;
    for (let i = 0; i < 7; i++) { // central blob
      x.beginPath(); x.arc(rand(-0.35, 0.35) * R, rand(-0.35, 0.35) * R, R * rand(0.35, 0.6), 0, TAU); x.fill();
    }
    x.globalAlpha = 0.65;
    for (let i = 0; i < 26; i++) { // splatter thrown along the swipe
      const a = ang + (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.7, 0.7);
      const d = R * rand(0.6, 1.9);
      x.beginPath(); x.arc(Math.cos(a) * d, Math.sin(a) * d, R * rand(0.03, 0.12), 0, TAU); x.fill();
    }
    x.globalAlpha = 0.45; // drips running down the wall
    for (let i = 0; i < 4; i++) {
      const dx = rand(-0.45, 0.45) * R, len = R * rand(0.5, 1.6), w = R * rand(0.05, 0.1);
      x.fillRect(dx - w / 2, 0, w, len);
      x.beginPath(); x.arc(dx, len, w * 0.9, 0, TAU); x.fill();
    }
    c.units = size / scale;
    f.stains.push({ x: fr.x, y: fr.y, rot: 0, spr: c, age: 0 });
    if (f.stains.length > MAX_STAINS) f.stains.shift();
  }

  function bombHit(f, fr) {
    f.blasts.push({ x: fr.x, y: fr.y, age: 0 });
    for (let i = 0; i < 40; i++) {
      const a = rand(0, TAU), v = rand(200, 1100);
      f.sparks.push({ x: fr.x, y: fr.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.4, 1.0), age: 0, hot: true });
    }
    const pan = panOf(f, fr.x);
    IFPD.sfx.play('thud', { volume: 1.6, pitch: 0.7, pan });
    IFPD.sfx.play('whack', { volume: 1.2, pitch: 0.5, pan });
    f.shake = 1;
    if (mode === 'classic') {
      state = 'exploding';
      explodeT = 0;
      globalFlash = 1;
      for (const b of blades.values()) { b.combo = 0; }
    } else if (mode === 'arcade') {
      f.score = Math.max(0, f.score - 10);
      f.freeze = 1.5;
      f.flash = 0.8;
      f.popups.push({ x: clamp(fr.x, 140, f.fw - 140), y: clamp(fr.y, 200, 800), text: '−10', sub: 'Bomb!', color: '#ff5a4a', age: 0, life: 1.4, size: 90 });
      IFPD.sfx.play('buzzer', { volume: 0.5, pan });
    } else {
      f.freeze = 1.2;
      f.flash = 0.8;
      loseLife(f, fr.x, true);
    }
  }

  function loseLife(f, x, isBomb) {
    if (f.out || f.lives <= 0) return;
    const lostIdx = MODES[mode].lives - f.lives;
    f.lives--;
    if (lostIdx >= 0 && lostIdx < 3) f.lostAnim[lostIdx] = 1;
    if (!isBomb) {
      f.misses.push({ x: clamp(x, 60, f.fw - 60), age: 0 });
      IFPD.sfx.play('wrong', { volume: 0.6, pan: panOf(f, x) });
    }
    if (f.lives <= 0) {
      if (mode === 'classic') endGame();
      else {
        f.out = true;
        IFPD.sfx.play('lose', { volume: 0.7, pan: panOf(f, f.fw / 2) });
        if (fields.every(o => o.out)) endGame();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  IFPD.pointers(canvas, {
    down(p) {
      if (state !== 'play') return false;
      const b = { id: p.id, field: fieldAt(p.x), pts: [{ x: p.x, y: p.y, t: performance.now() }], combo: 0, comboX: 0, comboY: 0, lastSlice: 0, speed: 0 };
      blades.set(p.id, b);
      return true;
    },
    move(p, e) {
      const b = blades.get(p.id);
      if (!b) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (evs.length > 1) {
        const r = canvas.getBoundingClientRect();
        for (const ce of evs) bladeMove(b, ce.clientX - r.left, ce.clientY - r.top);
      } else bladeMove(b, p.x, p.y);
    },
    up(p) {
      const b = blades.get(p.id);
      if (!b) return;
      blades.delete(p.id);
      finishCombo(b);
      fadingBlades.push(b);
    },
  });

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  function updateField(f, dt, physicsOn) {
    f.bump = Math.max(0, f.bump - dt * 4);
    f.shake = Math.max(0, f.shake - dt * 2.2);
    f.flash = Math.max(0, f.flash - dt * 2);
    f.freeze = Math.max(0, f.freeze - dt);
    for (let i = 0; i < 3; i++) f.lostAnim[i] = Math.max(0, f.lostAnim[i] - dt * 1.5);
    for (const s of f.stains) s.age += dt;
    while (f.stains.length && f.stains[0].age > STAIN_LIFE) f.stains.shift();
    for (let i = f.popups.length - 1; i >= 0; i--) if ((f.popups[i].age += dt) > f.popups[i].life) f.popups.splice(i, 1);
    for (let i = f.misses.length - 1; i >= 0; i--) if ((f.misses[i].age += dt) > 1.6) f.misses.splice(i, 1);
    for (let i = f.blasts.length - 1; i >= 0; i--) if ((f.blasts[i].age += dt) > 1.2) f.blasts.splice(i, 1);
    for (let i = f.sparks.length - 1; i >= 0; i--) {
      const s = f.sparks[i];
      s.age += dt;
      if (s.age > s.life) { f.sparks.splice(i, 1); continue; }
      s.vy += (s.hot ? 500 : 200) * dt; s.vx *= 1 - dt * 1.5;
      s.x += s.vx * dt; s.y += s.vy * dt;
    }
    if (!physicsOn) return;

    f.elapsed += dt;
    if (!f.out && autoSpawn) {
      f.spawnT -= dt;
      if (f.spawnT <= 0 && f.queue.length === 0) spawnWave(f);
    }
    for (let i = f.queue.length - 1; i >= 0; i--) {
      const q = f.queue[i];
      if ((q.delay -= dt) <= 0) { f.queue.splice(i, 1); if (!f.out) launch(f, q.kind); }
    }
    for (let i = f.fruits.length - 1; i >= 0; i--) {
      const fr = f.fruits[i];
      fr.age += dt;
      fr.vy += G * dt;
      fr.x += fr.vx * dt; fr.y += fr.vy * dt;
      fr.rot += fr.spin * dt;
      if (fr.bomb && Math.random() < dt * 50) {
        const c = Math.cos(fr.rot), s = Math.sin(fr.rot);
        const tx = BOMB.fuseTip.x * fr.r, ty = BOMB.fuseTip.y * fr.r;
        const a = rand(0, TAU), v = rand(60, 260);
        f.sparks.push({ x: fr.x + tx * c - ty * s, y: fr.y + tx * s + ty * c, vx: Math.cos(a) * v + fr.vx, vy: Math.sin(a) * v + fr.vy * 0.9, life: rand(0.15, 0.35), age: 0 });
      }
      if (fr.vy > 0 && fr.y > 1000 + fr.r + 30) {
        f.fruits.splice(i, 1);
        if (!fr.bomb && !f.demo && state === 'play' && MODES[mode].lives > 0) loseLife(f, fr.x, false);
      }
    }
    for (let i = f.halves.length - 1; i >= 0; i--) {
      const h = f.halves[i];
      h.age += dt;
      h.vy += G * dt;
      h.vx *= 1 - dt * 0.3;
      h.x += h.vx * dt; h.y += h.vy * dt;
      h.cut += h.spin * dt;
      if (h.y > 1000 + h.r * 2 || h.age > 6) f.halves.splice(i, 1);
    }
    for (let i = f.drops.length - 1; i >= 0; i--) {
      const d = f.drops[i];
      d.age += dt;
      if (d.age > d.life) { f.drops.splice(i, 1); continue; }
      d.vy += G * 0.8 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt;
    }
  }

  function update(dt) {
    if (state === 'play' || state === 'menu') {
      for (const f of fields) updateField(f, dt, true);
      if (state === 'play' && mode === 'arcade') {
        const before = Math.ceil(timeLeft);
        timeLeft -= dt;
        if (Math.ceil(timeLeft) !== before && timeLeft <= 5 && timeLeft > 0) IFPD.sfx.play('tick', { volume: 1.5 });
        if (timeLeft <= 0) { timeLeft = 0; endGame(); }
      }
      if (state === 'play') {
        const now = performance.now();
        for (const b of blades.values()) if (b.combo && now - b.lastSlice > COMBO_GAP) finishCombo(b);
      }
    } else if (state === 'exploding') {
      explodeT += dt;
      for (const f of fields) updateField(f, dt, false);
      if (explodeT > 1.6) endGame();
    } else {
      for (const f of fields) updateField(f, dt, true);
    }
    globalFlash = Math.max(0, globalFlash - dt * 0.9);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  function buildBackground() {
    const c = document.createElement('canvas');
    const dpr = view.dpr;
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    const wood = IFPD.texture.wood(W, H, { base: '#93653b', dark: '#4a2c14', vertical: true, planks: Math.max(4, Math.round(W / 190)) });
    x.drawImage(wood, 0, 0, W, H);
    // plank seams with depth
    const n = Math.max(4, Math.round(W / 190));
    for (let i = 1; i < n; i++) {
      const sx = (i * W) / n;
      x.fillStyle = 'rgba(0,0,0,0.45)'; x.fillRect(sx - 1.5, 0, 3, H);
      x.fillStyle = 'rgba(255,220,170,0.12)'; x.fillRect(sx + 1.5, 0, 1.5, H);
    }
    // warm overhead light + vignette
    let g = x.createRadialGradient(W / 2, -H * 0.1, 0, W / 2, -H * 0.1, H * 1.1);
    g.addColorStop(0, 'rgba(255,214,150,0.28)');
    g.addColorStop(1, 'rgba(255,214,150,0)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    g = x.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.45, Math.hypot(W, H) * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(10,4,0,0.7)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    return c;
  }

  function drawFruit(ctx, fr) {
    const spr = fr.bomb ? sprites.bomb : sprites.whole[fr.kind];
    if (fr.bomb) {
      const pulse = 0.5 + 0.5 * Math.sin(fr.age * 10);
      ctx.fillStyle = radial(ctx, fr.x, fr.y, fr.r * 0.6, fr.x, fr.y, fr.r * 1.7, [[0, `rgba(255,40,20,${0.35 + 0.25 * pulse})`], [1, 'rgba(255,40,20,0)']]);
      ctx.beginPath(); ctx.arc(fr.x, fr.y, fr.r * 1.7, 0, TAU); ctx.fill();
    }
    ctx.save();
    ctx.translate(fr.x, fr.y);
    ctx.rotate(fr.rot);
    blit(ctx, spr);
    ctx.restore();
  }

  function drawHalf(ctx, h) {
    const def = FRUITS[h.kind];
    const R = h.r;
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.cut);
    ctx.beginPath(); ctx.rect(-R * 1.6, -R * 1.6, R * 3.2, R * 1.6); ctx.clip();
    ctx.save(); ctx.rotate(h.skin); blit(ctx, sprites.whole[h.kind]); ctx.restore();
    // cut face seen in perspective
    ctx.save();
    ctx.scale(1, 0.56);
    ctx.drawImage(sprites.cross[h.kind], -sprites.cross[h.kind].units / 2, -sprites.cross[h.kind].units / 2, sprites.cross[h.kind].units, sprites.cross[h.kind].units);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.arc(0, 0, R, Math.PI, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.99, Math.PI, TAU); ctx.stroke();
    ctx.restore();
    // wet glint along the cut edge
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(-R * 0.9, -1.5); ctx.lineTo(R * 0.9, -1.5); ctx.stroke();
    ctx.restore();
    void def;
  }

  function drawShadow(ctx, x, y, r, alpha) {
    ctx.globalAlpha = alpha;
    ctx.save();
    ctx.translate(x + r * 0.22, y + r * 0.34);
    ctx.scale(1.05, 0.95);
    blit(ctx, sprites.shadow, r / 60 * 1.15);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function text(ctx, str, x, y, size, color, align = 'center', weight = 800) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.14;
    ctx.strokeStyle = 'rgba(30,12,0,0.85)';
    ctx.strokeText(str, x, y + size * 0.04);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function drawCross(ctx, x, y, s, lost, anim) {
    ctx.save();
    ctx.translate(x, y);
    const k = 1 + anim * 0.6;
    ctx.scale(k, k);
    ctx.lineCap = 'round';
    ctx.lineWidth = s * 0.34;
    ctx.strokeStyle = lost ? '#5a0a06' : 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.moveTo(-s / 2, -s / 2 + 3); ctx.lineTo(s / 2, s / 2 + 3); ctx.moveTo(s / 2, -s / 2 + 3); ctx.lineTo(-s / 2, s / 2 + 3); ctx.stroke();
    ctx.lineWidth = s * 0.24;
    ctx.strokeStyle = lost ? '#ff3b2a' : 'rgba(255,240,220,0.35)';
    ctx.beginPath(); ctx.moveTo(-s / 2, -s / 2); ctx.lineTo(s / 2, s / 2); ctx.moveTo(s / 2, -s / 2); ctx.lineTo(-s / 2, s / 2); ctx.stroke();
    ctx.restore();
  }

  function drawHUD(ctx, f) {
    if (f.demo) return;
    const duo = mode === 'duo';
    const pad = 40;
    // score with fruit icon
    ctx.save();
    ctx.translate(pad + 44, 78);
    ctx.rotate(-0.3);
    blit(ctx, sprites.whole.watermelon, 0.55);
    ctx.restore();
    const s = 84 * (1 + f.bump * 0.15);
    text(ctx, String(f.score), pad + 100, 80, s, '#ffe08a', 'left', 900);
    if (duo) {
      text(ctx, f.idx === 0 ? 'PLAYER 1' : 'PLAYER 2', f.fw / 2, 50, 40, f.idx === 0 ? '#8fd0ff' : '#ffa08a', 'center', 800);
    } else {
      const best = IFPD.best.get(bestKey(mode));
      text(ctx, 'Best ' + Math.max(best ?? 0, 0), pad + 6, 150, 34, '#f3e2c0', 'left', 700);
    }
    if (mode === 'arcade') {
      const t = Math.ceil(timeLeft);
      const urgent = timeLeft <= 10;
      const pulse = urgent ? 1 + 0.08 * Math.sin(performance.now() / 80) : 1;
      text(ctx, `0:${String(t).padStart(2, '0')}`.replace('0:60', '1:00'), f.fw - pad, 80, 80 * pulse, urgent ? '#ff6a50' : '#ffffff', 'right', 900);
    } else if (MODES[mode].lives > 0) {
      for (let i = 0; i < 3; i++) {
        const lost = i < MODES[mode].lives - f.lives;
        drawCross(ctx, f.fw - pad - 24 - (2 - i) * 72, 80, 46, lost, f.lostAnim[i]);
      }
    }
    if (f.freeze > 0 && !f.out) {
      text(ctx, 'Blade frozen!', f.fw / 2, 190, 46, '#9fe0ff', 'center', 800);
    }
  }

  function render() {
    const ctx = view.ctx;
    const dpr = view.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!bg) bg = buildBackground();
    ctx.drawImage(bg, 0, 0, W, H);

    for (const f of fields) {
      ctx.save();
      ctx.beginPath(); ctx.rect(f.x0, 0, f.wPx, H); ctx.clip();
      let sx = 0, sy = 0;
      if (f.shake > 0) { sx = rand(-1, 1) * f.shake * 14; sy = rand(-1, 1) * f.shake * 14; }
      ctx.translate(f.x0 + sx, sy);
      ctx.scale(U, U);

      if (fields.length === 2) { // player tint along the top of each half
        const tg = ctx.createLinearGradient(0, 0, 0, 260);
        tg.addColorStop(0, f.idx === 0 ? 'rgba(80,160,255,0.22)' : 'rgba(255,110,80,0.22)');
        tg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = tg; ctx.fillRect(0, 0, f.fw, 260);
      }
      // juice stains on the planks
      for (const s of f.stains) {
        const a = s.age < 0.15 ? s.age / 0.15 : 1 - Math.pow(s.age / STAIN_LIFE, 2);
        ctx.globalAlpha = clamp(a, 0, 1) * 0.85;
        ctx.save(); ctx.translate(s.x, s.y); blit(ctx, s.spr); ctx.restore();
      }
      ctx.globalAlpha = 1;
      // missed-fruit markers at the bottom edge
      for (const m of f.misses) {
        ctx.globalAlpha = clamp(1.6 - m.age, 0, 1);
        drawCross(ctx, m.x, 950 - m.age * 30, 50, true, 0);
      }
      ctx.globalAlpha = 1;

      // shadows first (cast on the wall behind)
      for (const h of f.halves) drawShadow(ctx, h.x, h.y, h.r * 0.8, 0.6);
      for (const fr of f.fruits) drawShadow(ctx, fr.x, fr.y, fr.r, 0.8);
      for (const h of f.halves) drawHalf(ctx, h);
      for (const fr of f.fruits) drawFruit(ctx, fr);

      // juice droplets
      for (const d of f.drops) {
        const a = 1 - d.age / d.life;
        ctx.globalAlpha = clamp(a * 1.4, 0, 1);
        ctx.fillStyle = d.color;
        const sp = Math.hypot(d.vx, d.vy), st = clamp(sp / 400, 1, 2.5);
        ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(Math.atan2(d.vy, d.vx));
        ctx.beginPath(); ctx.ellipse(0, 0, d.r * st, d.r, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath(); ctx.arc(-d.r * 0.2, -d.r * 0.3, d.r * 0.3, 0, TAU); ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;

      // explosions + sparks (additive light)
      ctx.globalCompositeOperation = 'lighter';
      for (const b of f.blasts) {
        const t = b.age / 1.2, R = 80 + t * 600;
        ctx.fillStyle = radial(ctx, b.x, b.y, 0, b.x, b.y, R, [[0, `rgba(255,255,230,${0.9 * (1 - t)})`], [0.3, `rgba(255,170,60,${0.6 * (1 - t)})`], [1, 'rgba(255,60,0,0)']]);
        ctx.beginPath(); ctx.arc(b.x, b.y, R, 0, TAU); ctx.fill();
        ctx.strokeStyle = `rgba(255,240,200,${0.7 * (1 - t)})`;
        ctx.lineWidth = 10 * (1 - t);
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU + b.x;
          ctx.beginPath(); ctx.moveTo(b.x + Math.cos(a) * R * 0.2, b.y + Math.sin(a) * R * 0.2); ctx.lineTo(b.x + Math.cos(a) * R * 0.9, b.y + Math.sin(a) * R * 0.9); ctx.stroke();
        }
      }
      for (const s of f.sparks) {
        const a = 1 - s.age / s.life;
        ctx.fillStyle = s.hot ? `rgba(255,${150 + 100 * a | 0},60,${a})` : `rgba(255,230,140,${a})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, (s.hot ? 7 : 4) * (0.4 + a), 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // popups
      for (const p of f.popups) {
        const t = p.age / p.life;
        const k = t < 0.15 ? 0.5 + (t / 0.15) * 0.7 : 1.2 - Math.min(0.2, (t - 0.15) * 1.2);
        ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
        text(ctx, p.text, p.x, p.y - t * 80, p.size * k, p.color, 'center', 900);
        if (p.sub) text(ctx, p.sub, p.x, p.y - t * 80 + p.size * 0.95 * k, p.size * 0.8 * k, '#ffffff', 'center', 900);
      }
      ctx.globalAlpha = 1;

      if (f.flash > 0) {
        ctx.fillStyle = `rgba(255,240,220,${f.flash * 0.45})`;
        ctx.fillRect(0, 0, f.fw, 1000);
      }
      if (f.freeze > 0) {
        ctx.fillStyle = `rgba(140,200,255,${Math.min(0.22, f.freeze * 0.2)})`;
        ctx.fillRect(0, 0, f.fw, 1000);
      }
      drawHUD(ctx, f);
      if (f.out) {
        ctx.fillStyle = 'rgba(10,4,0,0.55)';
        ctx.fillRect(0, 0, f.fw, 1000);
        text(ctx, 'OUT', f.fw / 2, 440, 150, '#ff6a50', 'center', 900);
        text(ctx, `Score ${f.score}`, f.fw / 2, 570, 64, '#ffe08a', 'center', 800);
      }
      ctx.restore();
    }

    // split-screen divider
    if (fields.length === 2) {
      const x = W / 2;
      const g = ctx.createLinearGradient(x - 14, 0, x + 14, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.4, 'rgba(0,0,0,0.6)'); g.addColorStop(0.5, 'rgba(255,220,170,0.35)'); g.addColorStop(0.6, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 14, 0, 28, H);
    }

    drawBlades(ctx);

    if (globalFlash > 0) {
      ctx.fillStyle = `rgba(255,250,235,${Math.min(1, globalFlash * 1.2)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawBlade(ctx, b, now) {
    const pts = b.pts;
    while (pts.length && now - pts[0].t > TRAIL_LIFE) pts.shift();
    if (pts.length < 2) return;
    const n = pts.length;
    const maxW = Math.max(8, H * 0.016);
    const frozen = b.field && b.field.freeze > 0;
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < n; i++) {
        const age = 1 - (now - pts[i].t) / TRAIL_LIFE;
        const taper = i / (n - 1);
        const w = maxW * taper * clamp(age, 0, 1);
        if (w < 0.3) continue;
        ctx.lineWidth = pass === 0 ? w * 3 : w;
        ctx.strokeStyle = pass === 0 ? (frozen ? 'rgba(120,160,255,0.22)' : 'rgba(150,215,255,0.28)') : (frozen ? 'rgba(170,200,255,0.7)' : 'rgba(255,255,255,0.95)');
        ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawBlades(ctx) {
    const now = performance.now();
    for (const b of blades.values()) drawBlade(ctx, b, now);
    for (let i = fadingBlades.length - 1; i >= 0; i--) {
      drawBlade(ctx, fadingBlades[i], now);
      if (fadingBlades[i].pts.length < 2) fadingBlades.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------------------

  view = IFPD.fitCanvas(canvas, (w, h) => { W = w; H = h; layout(); });
  layout();
  const loop = IFPD.loop(update, render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state !== 'over') loop.resume(); });

  // Debug / test hook
  window.__game = {
    get state() { return state; }, get mode() { return mode; }, get fields() { return fields; },
    get blades() { return blades; }, get timeLeft() { return timeLeft; }, set timeLeft(v) { timeLeft = v; },
    get U() { return U; },
    start, restart, showMenu,
    setAutoSpawn(v) { autoSpawn = v; },
    launch(fi, kind, opts) { return launch(fields[fi], kind, opts); },
    clear() { for (const f of fields) { f.fruits.length = 0; f.queue.length = 0; } },
  };

  showMenu();
})();
