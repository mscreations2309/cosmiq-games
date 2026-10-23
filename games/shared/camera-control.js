/*
 * Camera control — hand tracking (MediaPipe Hand Landmarker) turned into pointer events.
 *
 * Every tracked hand becomes one "finger" on the screen:
 *   - the cursor sits between the thumb tip and index tip (mirrored, like a mirror)
 *   - pinch thumb + index together  → pointerdown   (tap / grab)
 *   - move while pinched            → pointermove   (drag / swipe / draw)
 *   - open the pinch                → pointerup + click
 * Events are real PointerEvents with pointerType 'touch', sent to the element under the cursor
 * with touch-style implicit capture, so all games (and the piano) work without changes.
 * Up to 4 hands at once (e.g. two players with both hands).
 *
 *   window.CosmiqCamera.start(baseUrl) / stop()
 */
(function () {
  'use strict';

  const MAX_HANDS = 4;
  const COLORS = ['#5aa9ff', '#ff7a59', '#5fd27a', '#f9c74f'];
  const PINCH_DOWN = 0.32;  // thumb–index distance / hand size: below = pinched
  const PINCH_UP = 0.48;    // above = released (hysteresis stops flicker)
  const EDGE = 0.12;        // camera border that maps to the screen edge (edges are hard to reach)
  const LOST_MS = 250;      // a hand missing this long is lifted
  const MATCH_DIST = 0.25;  // max normalized jump to keep the same identity between frames

  const Cam = { running: false };
  window.CosmiqCamera = Cam;

  let base = '';
  let video = null, stream = null, landmarker = null;
  let ui = null, cursorCanvas = null, cursorCtx = null, previewCanvas = null, previewCtx = null, statusEl = null;
  let raf = 0, lastVideoTime = -1, lastLandmarks = [];
  let tracks = [];
  let nextPointerId = 1001;
  const byPointerId = new Map();

  // --- start / stop --------------------------------------------------------------------------

  Cam.start = async function (baseUrl) {
    if (Cam.running) return;
    Cam.running = true;
    base = baseUrl;
    buildUi();
    setStatus('Starting camera…');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
      if (!Cam.running) return releaseStream();
      video.srcObject = stream;
      await video.play();

      setStatus('Loading hand tracking…');
      await loadScript(base + 'vendor/mediapipe/vision_bundle.js', () => window.Vision);
      const fileset = await window.Vision.FilesetResolver.forVisionTasks(base + 'vendor/mediapipe/wasm');
      landmarker = await createLandmarker(fileset);
      if (!Cam.running) return Cam.stop();
      setStatus('');
      showHelpOnce();
      raf = requestAnimationFrame(frame);
    } catch (err) {
      console.error('Camera control failed', err);
      const why = err && err.name === 'NotAllowedError' ? 'Camera permission was denied.'
        : err && err.name === 'NotFoundError' ? 'No camera was found on this device.'
        : 'Camera control could not start.';
      Cam.stop();
      alert(why + ' Switching to touch.');
      if (window.CosmiqInput) window.CosmiqInput.showChooser();
    }
  };

  Cam.stop = function () {
    Cam.running = false;
    cancelAnimationFrame(raf);
    for (const t of tracks) liftTrack(t, true);
    tracks = [];
    releaseStream();
    if (landmarker) { try { landmarker.close(); } catch (_) { /* already closed */ } landmarker = null; }
    if (ui) { ui.remove(); ui = null; }
  };

  function releaseStream() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
  }

  async function createLandmarker(fileset) {
    const opts = delegate => ({
      baseOptions: { modelAssetPath: base + 'vendor/mediapipe/hand_landmarker.task', delegate },
      runningMode: 'VIDEO',
      numHands: MAX_HANDS,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      return await window.Vision.HandLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch (e) {
      console.warn('GPU hand tracking unavailable, using CPU', e);
      return window.Vision.HandLandmarker.createFromOptions(fileset, opts('CPU'));
    }
  }

  function loadScript(src, ready) {
    if (ready()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => (ready() ? resolve() : reject(new Error('Script loaded without its global: ' + src)));
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.append(s);
    });
  }

  /** Test hook: feed MediaPipe-style landmark arrays as if the camera had seen them. */
  Cam._feed = function (hands) {
    if (Cam.running) update(hands, performance.now());
  };
  Cam._tracks = () => tracks.map(t => ({ x: t.x, y: t.y, down: t.down, pinch: t.pinch }));

  // --- per-frame tracking ------------------------------------------------------------------------

  function frame() {
    if (!Cam.running) return;
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      let result = null;
      try { result = landmarker.detectForVideo(video, now); } catch (e) { console.warn(e); }
      if (result) update(result.landmarks || [], now);
    }
    for (const t of tracks) {
      if (now - t.lastSeen > LOST_MS) liftTrack(t, true);
    }
    tracks = tracks.filter(t => now - t.lastSeen <= LOST_MS);
    draw();
  }

  function update(hands, now) {
    lastLandmarks = hands;
    const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
    const detections = hands.map(lm => {
      const px = p => ({ x: p.x * vw, y: p.y * vh });
      const thumb = px(lm[4]), index = px(lm[8]), wrist = px(lm[0]), mid = px(lm[9]);
      const size = Math.hypot(mid.x - wrist.x, mid.y - wrist.y) || 1;
      const pinch = Math.hypot(index.x - thumb.x, index.y - thumb.y) / size;
      const nx = 1 - (thumb.x + index.x) / 2 / vw; // mirror
      const ny = (thumb.y + index.y) / 2 / vh;
      return { nx, ny, pinch };
    });

    // Keep identities stable: greedy nearest match between existing tracks and detections.
    const unmatched = new Set(detections.keys());
    for (const t of tracks) {
      let best = -1, bestD = MATCH_DIST;
      for (const i of unmatched) {
        const d = Math.hypot(detections[i].nx - t.nx, detections[i].ny - t.ny);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) { unmatched.delete(best); applyDetection(t, detections[best], now); }
    }
    for (const i of unmatched) {
      if (tracks.length >= MAX_HANDS) break;
      const t = newTrack();
      tracks.push(t);
      applyDetection(t, detections[i], now);
    }
  }

  function newTrack() {
    const used = new Set(tracks.map(t => t.color));
    return {
      pointerId: 0, color: COLORS.find(c => !used.has(c)) || COLORS[0],
      nx: 0, ny: 0, x: 0, y: 0, pinch: 1, down: false, pinchFrames: 0,
      fx: oneEuro(), fy: oneEuro(), lastSeen: 0, target: null, capture: null,
    };
  }

  function applyDetection(t, d, now) {
    t.nx = d.nx; t.ny = d.ny; t.pinch = d.pinch; t.lastSeen = now;
    const W = window.innerWidth, H = window.innerHeight;
    const sx = clamp((d.nx - EDGE) / (1 - 2 * EDGE), 0, 1) * (W - 1);
    const sy = clamp((d.ny - EDGE) / (1 - 2 * EDGE), 0, 1) * (H - 1);
    t.x = t.fx(sx, now);
    t.y = t.fy(sy, now);

    if (!t.down) {
      t.pinchFrames = d.pinch < PINCH_DOWN ? t.pinchFrames + 1 : 0;
      if (t.pinchFrames >= 2) pressTrack(t);
    } else if (d.pinch > PINCH_UP) {
      liftTrack(t, false);
    } else {
      send('pointermove', t, t.capture || t.target);
    }
  }

  // --- pointer event synthesis -----------------------------------------------------------------

  function pressTrack(t) {
    t.down = true;
    t.pointerId = nextPointerId++;
    byPointerId.set(t.pointerId, t);
    t.target = hitTest(t.x, t.y);
    t.capture = null;
    if (t.target) send('pointerdown', t, t.target);
  }

  function liftTrack(t, cancelled) {
    if (!t.down) return;
    const target = t.capture || t.target;
    t.down = false;
    t.pinchFrames = 0;
    if (target) {
      send(cancelled ? 'pointercancel' : 'pointerup', t, target);
      if (t.capture) send('lostpointercapture', t, t.capture);
      if (!cancelled && t.target) {
        const under = hitTest(t.x, t.y);
        if (under && (t.target === under || t.target.contains(under))) {
          t.target.dispatchEvent(new MouseEvent('click', {
            bubbles: true, cancelable: true, composed: true, clientX: t.x, clientY: t.y, button: 0, view: window,
          }));
        }
      }
    }
    byPointerId.delete(t.pointerId);
    t.target = null;
    t.capture = null;
  }

  function send(type, t, target) {
    if (!target || !target.isConnected) return;
    const isDown = type === 'pointerdown' || type === 'pointermove';
    const init = {
      bubbles: type !== 'lostpointercapture',
      cancelable: type !== 'lostpointercapture' && type !== 'pointercancel',
      composed: true,
      pointerId: t.pointerId,
      pointerType: 'touch',
      isPrimary: t === tracks.find(o => o.down),
      clientX: t.x, clientY: t.y, screenX: t.x, screenY: t.y,
      width: 24, height: 24,
      pressure: isDown && t.down ? 0.5 : 0,
      button: type === 'pointermove' ? -1 : 0,
      buttons: isDown && t.down ? 1 : 0,
      view: window,
    };
    target.dispatchEvent(new PointerEvent(type, init));
  }

  function hitTest(x, y) {
    return document.elementFromPoint(x, y); // overlay is pointer-events: none
  }

  // Pages call setPointerCapture with our synthetic ids; emulate capture instead of throwing.
  const proto = Element.prototype;
  const realSet = proto.setPointerCapture, realRelease = proto.releasePointerCapture, realHas = proto.hasPointerCapture;
  proto.setPointerCapture = function (id) {
    const t = byPointerId.get(id);
    if (t) { t.capture = this; return; }
    return realSet.call(this, id);
  };
  proto.releasePointerCapture = function (id) {
    const t = byPointerId.get(id);
    if (t) { if (t.capture === this) t.capture = null; return; }
    return realRelease.call(this, id);
  };
  proto.hasPointerCapture = function (id) {
    const t = byPointerId.get(id);
    if (t) return t.capture === this;
    return realHas.call(this, id);
  };

  // --- overlay: cursors + camera preview ---------------------------------------------------------

  function buildUi() {
    ui = document.createElement('div');
    ui.className = 'cq-cam';
    ui.innerHTML = `
      <canvas class="cq-cursors"></canvas>
      <div class="cq-preview"><video playsinline muted></video><canvas></canvas><div class="cq-status"></div></div>`;
    const style = document.createElement('style');
    style.textContent = `
      .cq-cam, .cq-cam * { pointer-events: none !important; }
      .cq-cursors { position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 2147483100; }
      .cq-preview { position: fixed; left: 14px; bottom: 14px; width: 224px; height: 126px; z-index: 2147483050;
        border-radius: 12px; overflow: hidden; border: 2px solid #ffffff44; box-shadow: 0 6px 20px #000a; background: #000; opacity: 0.85; }
      .cq-preview video, .cq-preview canvas { position: absolute; inset: 0; width: 100%; height: 100%; transform: scaleX(-1); object-fit: cover; }
      .cq-status { position: absolute; left: 0; right: 0; bottom: 0; padding: 4px 8px; font: 600 13px "Segoe UI", sans-serif;
        color: #fff; background: #000a; text-align: center; }
      .cq-status:empty { display: none; }
      .cq-help { position: fixed; left: 50%; top: 90px; transform: translateX(-50%); z-index: 2147483100; padding: 16px 30px;
        border-radius: 18px; background: #101018ee; color: #fff; font: 600 22px "Segoe UI", sans-serif; text-align: center;
        box-shadow: 0 10px 30px #000a; transition: opacity 0.6s; }`;
    ui.append(style);
    document.body.append(ui);
    cursorCanvas = ui.querySelector('.cq-cursors');
    cursorCtx = cursorCanvas.getContext('2d');
    video = ui.querySelector('video');
    previewCanvas = ui.querySelector('.cq-preview canvas');
    previewCtx = previewCanvas.getContext('2d');
    statusEl = ui.querySelector('.cq-status');
  }

  function setStatus(text) { if (statusEl) statusEl.textContent = text; }

  function showHelpOnce() {
    try {
      if (sessionStorage.getItem('cosmiq-camera-help')) return;
      sessionStorage.setItem('cosmiq-camera-help', '1');
    } catch (_) { /* storage disabled */ }
    const help = document.createElement('div');
    help.className = 'cq-help';
    help.innerHTML = '📷 Hold up your hand — a circle follows it.<br>👌 Pinch thumb + index finger to tap. Keep pinching to drag.';
    ui.append(help);
    setTimeout(() => { help.style.opacity = '0'; }, 6000);
    setTimeout(() => help.remove(), 6800);
  }

  const HAND_LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];

  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth, H = window.innerHeight;
    if (cursorCanvas.width !== Math.round(W * dpr) || cursorCanvas.height !== Math.round(H * dpr)) {
      cursorCanvas.width = Math.round(W * dpr);
      cursorCanvas.height = Math.round(H * dpr);
    }
    const c = cursorCtx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    for (const t of tracks) {
      // Ring closes as the fingers come together, then fills when pinched.
      const closeness = clamp((PINCH_UP - t.pinch) / (PINCH_UP - PINCH_DOWN * 0.6), 0, 1);
      const r = 30;
      c.lineWidth = 5;
      c.strokeStyle = 'rgba(0,0,0,0.45)';
      c.beginPath(); c.arc(t.x, t.y, r + 2, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = t.color + '66'; // faint full ring keeps an open hand visible
      c.beginPath(); c.arc(t.x, t.y, r, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = t.color;
      c.beginPath(); c.arc(t.x, t.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (t.down ? 1 : closeness)); c.stroke();
      if (t.down) {
        c.fillStyle = t.color + 'aa';
        c.beginPath(); c.arc(t.x, t.y, r - 6, 0, Math.PI * 2); c.fill();
      }
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(t.x, t.y, 5, 0, Math.PI * 2); c.fill();
    }

    // Preview with hand skeletons (drawn unmirrored; the canvas is mirrored by CSS like the video).
    const pw = previewCanvas.clientWidth, ph = previewCanvas.clientHeight;
    if (previewCanvas.width !== pw) { previewCanvas.width = pw; previewCanvas.height = ph; }
    const p = previewCtx;
    p.clearRect(0, 0, pw, ph);
    lastLandmarks.forEach((lm, i) => {
      p.strokeStyle = COLORS[i % COLORS.length];
      p.lineWidth = 2;
      for (const [a, b] of HAND_LINKS) {
        p.beginPath();
        p.moveTo(lm[a].x * pw, lm[a].y * ph);
        p.lineTo(lm[b].x * pw, lm[b].y * ph);
        p.stroke();
      }
    });
    if (!statusEl.textContent || statusEl.dataset.auto) {
      const msg = tracks.length ? `${tracks.length} hand${tracks.length > 1 ? 's' : ''}` : 'Show your hand';
      statusEl.textContent = msg;
      statusEl.dataset.auto = '1';
    }
  }

  // --- helpers -----------------------------------------------------------------------------------

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // One Euro filter: smooths jitter when the hand is still, stays responsive when it moves fast.
  function oneEuro(minCutoff = 1.4, beta = 0.006, dCutoff = 1.0) {
    let xPrev = null, dxPrev = 0, tPrev = 0;
    const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    return (x, tMs) => {
      if (xPrev === null) { xPrev = x; tPrev = tMs; return x; }
      const dt = Math.max(1e-3, (tMs - tPrev) / 1000);
      tPrev = tMs;
      const dx = (x - xPrev) / dt;
      const aD = alpha(dCutoff, dt);
      dxPrev = aD * dx + (1 - aD) * dxPrev;
      const a = alpha(minCutoff + beta * Math.abs(dxPrev), dt);
      xPrev = a * x + (1 - a) * xPrev;
      return xPrev;
    };
  }
})();
