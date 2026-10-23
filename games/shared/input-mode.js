/*
 * Input mode chooser — loaded first on every page (home, all games, piano).
 *
 * On launch it asks "Touch or Camera?" before anything else can be used. The answer is kept in
 * sessionStorage, so it is asked once per launch (browser tab / app start), not on every game.
 * Camera mode loads camera-control.js, which turns tracked hands into pointer events, so every
 * game works unchanged. A small button lets players switch mode at any time.
 *
 *   window.CosmiqInput.mode            'touch' | 'camera' | null (not chosen yet)
 *   window.CosmiqInput.showChooser()
 */
(function () {
  'use strict';

  const KEY = 'cosmiq-input-mode';
  const BASE = document.currentScript.src.replace(/[^/]*$/, ''); // …/games/shared/
  const Input = { mode: null, base: BASE };
  window.CosmiqInput = Input;

  injectStyles();

  // Camera input needs a secure page that can fetch files (the app, or a localhost server).
  function cameraBlocker() {
    if (location.protocol === 'file:') return 'Open the games with the COSMIQ Games app or "Start COSMIQ Games.bat" to use the camera.';
    if (!window.isSecureContext) return 'The camera only works in the COSMIQ Games app, or on this PC at http://localhost.';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return 'This browser cannot use the camera.';
    return null;
  }

  function apply(mode) {
    Input.mode = mode;
    document.documentElement.dataset.inputMode = mode;
    updateSwitch();
    if (mode === 'camera') startCamera();
    else if (window.CosmiqCamera) window.CosmiqCamera.stop();
  }

  function choose(mode) {
    try { sessionStorage.setItem(KEY, mode); } catch (_) { /* storage disabled */ }
    apply(mode);
  }

  let cameraScript = null;
  function startCamera() {
    if (window.CosmiqCamera) { window.CosmiqCamera.start(BASE); return; }
    if (cameraScript) return;
    cameraScript = document.createElement('script');
    cameraScript.src = BASE + 'camera-control.js';
    cameraScript.onload = () => { if (Input.mode === 'camera') window.CosmiqCamera.start(BASE); };
    cameraScript.onerror = () => {
      cameraScript = null;
      alert('Camera control could not be loaded. Switching to touch.');
      choose('touch');
    };
    document.head.append(cameraScript);
  }

  // --- chooser -----------------------------------------------------------------------------------

  let chooser = null;
  Input.showChooser = function () {
    if (chooser) return;
    const blocked = cameraBlocker();
    chooser = document.createElement('div');
    chooser.className = 'cq-chooser';
    chooser.innerHTML = `
      <div class="cq-box">
        <h1>How do you want to play?</h1>
        <p class="cq-sub">You can change this later with the input button.</p>
        <div class="cq-options">
          <button class="cq-opt" data-mode="touch">
            <span class="cq-ico">✋</span>
            <b>Touch</b>
            <span>Touch the screen with your fingers.</span>
          </button>
          <button class="cq-opt" data-mode="camera">
            <span class="cq-ico">📷</span>
            <b>Camera</b>
            <span>Wave your hand in front of the camera.<br>Pinch thumb + finger to tap and drag.</span>
            <em class="cq-warn"></em>
          </button>
        </div>
      </div>`;
    const cam = chooser.querySelector('[data-mode=camera]');
    if (blocked) {
      cam.disabled = true;
      cam.querySelector('.cq-warn').textContent = blocked;
    }
    chooser.addEventListener('click', e => {
      const b = e.target.closest('.cq-opt');
      if (!b || b.disabled) return;
      chooser.remove();
      chooser = null;
      choose(b.dataset.mode);
    });
    // Nothing underneath may be used until a mode is chosen.
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'keydown']) {
      chooser.addEventListener(ev, e => e.stopPropagation());
    }
    document.body.append(chooser);
  };

  // --- switch button (in the game top bar when there is one, otherwise floating) ---------------

  let switchBtn = null;
  function updateSwitch() {
    if (!switchBtn) return;
    switchBtn.textContent = Input.mode === 'camera' ? '📷 Camera' : '✋ Touch';
    switchBtn.title = 'Change input: touch or camera';
  }

  function mountSwitch() {
    switchBtn = document.createElement('button');
    switchBtn.addEventListener('click', () => Input.showChooser());
    const place = () => {
      const bar = document.querySelector('.ifpd-bar');
      if (bar) {
        switchBtn.className = 'ifpd-btn cq-switch-bar';
        const restart = bar.querySelector('[data-act=restart]');
        bar.insertBefore(switchBtn, restart || null);
        return true;
      }
      return false;
    };
    if (!place()) {
      // Game pages build their bar right after load; wait briefly before floating the button.
      const mo = new MutationObserver(() => { if (place()) mo.disconnect(); });
      mo.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        mo.disconnect();
        if (!switchBtn.isConnected) {
          switchBtn.className = 'cq-switch-float';
          document.body.append(switchBtn);
        }
      }, 800);
    }
    updateSwitch();
  }

  function init() {
    mountSwitch();
    let saved = null;
    try { saved = sessionStorage.getItem(KEY); } catch (_) { /* storage disabled */ }
    if (saved === 'camera' && cameraBlocker()) saved = null;
    if (saved === 'touch' || saved === 'camera') apply(saved);
    else Input.showChooser();
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);

  function injectStyles() {
    const css = `
      .cq-chooser { position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center;
        background: radial-gradient(ellipse at 50% 0%, #2d3a5c, #0d0d12 70%); color: #f1efe9;
        font: 18px/1.4 "Segoe UI", system-ui, Roboto, sans-serif; touch-action: none; user-select: none; }
      .cq-box { text-align: center; padding: 24px; }
      .cq-box h1 { margin: 0 0 6px; font-size: 48px; }
      .cq-sub { margin: 0 0 36px; color: #a9a7b3; font-size: 20px; }
      .cq-options { display: flex; gap: 40px; justify-content: center; flex-wrap: wrap; }
      .cq-opt { width: 380px; min-height: 330px; padding: 28px; border-radius: 28px; border: 2px solid #ffffff22;
        display: flex; flex-direction: column; align-items: center; gap: 10px; cursor: pointer; color: inherit;
        font: inherit; background: linear-gradient(160deg, #3d8bfd, #1d4f9e);
        box-shadow: 0 18px 40px #0008, inset 0 1px 0 #ffffff40; touch-action: manipulation; }
      .cq-opt[data-mode=camera] { background: linear-gradient(160deg, #36b37e, #17603f); }
      .cq-opt:active { transform: scale(0.97); }
      .cq-opt:disabled { filter: grayscale(0.8); opacity: 0.6; cursor: not-allowed; }
      .cq-opt b { font-size: 40px; }
      .cq-opt span { font-size: 19px; opacity: 0.95; }
      .cq-ico { font-size: 96px !important; line-height: 1; filter: drop-shadow(0 6px 10px #0006); }
      .cq-warn { font-size: 16px; font-style: normal; color: #ffe08a; }
      .cq-switch-float { position: fixed; right: 14px; bottom: 14px; z-index: 2147482000; min-height: 48px;
        padding: 8px 18px; border-radius: 999px; border: 1px solid #ffffff33; background: #1c1c22e6; color: #fff;
        font: 600 17px "Segoe UI", system-ui, sans-serif; box-shadow: 0 4px 14px #0007; touch-action: manipulation; }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
  }
})();
