/*
 * Input mode chooser — loaded first on every page (home, all games, piano, guitar).
 *
 * On launch it asks "Touch, Camera or Keyboard?" before anything else can be used. The answer is
 * kept in sessionStorage, so it is asked once per launch (browser tab / app start), not per game.
 *   - touch:    fingers (and mouse / touchpad)
 *   - camera:   camera-control.js turns tracked hands into pointer events
 *   - keyboard: games' own keys + Tab/Enter menus + an optional keyboard cursor; a "⌨ Keys"
 *               card lists the keys of the current page. Mouse / touchpad still work.
 * A small button lets players switch mode at any time.
 *
 *   CosmiqInput.mode                       'touch' | 'camera' | 'keyboard' | null (not chosen yet)
 *   CosmiqInput.showChooser()
 *   CosmiqInput.onChange(fn)               fn(mode) after every mode change
 *   CosmiqInput.keys.on(fn)                fn(e) for keydown/keyup, skipping text fields and the chooser
 *   CosmiqInput.keys.help(title, rows)     rows: [['W A S D', 'Move player 1'], …] shown in keyboard mode
 *   CosmiqInput.keys.cursor(on)            keyboard cursor: arrows / WASD move, Space = touch & drag
 *
 * Game keys work in every mode; the mode only decides what is shown (help card, cursor, focus rings).
 */
(function () {
  'use strict';

  const KEY = 'cosmiq-input-mode';
  const BASE = document.currentScript.src.replace(/[^/]*$/, ''); // …/games/shared/
  const listeners = [];
  const Input = { mode: null, base: BASE, onChange: fn => listeners.push(fn) };
  window.CosmiqInput = Input;

  // Opened from COSMIQ Game Zone (the Android app): ?app=1 on the first page, kept for the session.
  // The app is a touch panel with its own Back / Close, so pages skip the chooser and hide Home.
  const IN_APP = (() => {
    const flag = /[?&]app=1(&|$)/.test(location.search);
    try {
      if (flag) sessionStorage.setItem('cosmiq-in-app', '1');
      return sessionStorage.getItem('cosmiq-in-app') === '1';
    } catch (_) { return flag; }
  })();
  Input.inApp = IN_APP;
  if (IN_APP) document.documentElement.classList.add('cq-in-app');

  injectStyles();

  // Camera input needs a secure page that can fetch files (the app, or a localhost server).
  function cameraBlocker() {
    if (IN_APP) return 'Camera play is off inside the COSMIQ app.';
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
    renderHelp();
    updateCursor();
    if (mode === 'keyboard') focusFirstInOverlay();
    for (const fn of listeners) { try { fn(mode); } catch (e) { console.error(e); } }
  }

  function choose(mode) {
    try { sessionStorage.setItem(KEY, mode); } catch (_) { /* storage disabled */ }
    apply(mode);
  }

  let cameraScript = null;
  function startCamera() {
    if (window.CosmiqCamera) { window.CosmiqCamera.start(BASE); return; }
    if (cameraScript) return;
    cameraScript = loadScript('camera-control.js', () => { if (Input.mode === 'camera') window.CosmiqCamera.start(BASE); }, () => {
      cameraScript = null;
      alert('Camera control could not be loaded. Switching to touch.');
      choose('touch');
    });
  }

  function loadScript(name, onload, onerror) {
    const s = document.createElement('script');
    s.src = BASE + name;
    s.onload = onload;
    s.onerror = onerror || (() => console.error('Could not load ' + name));
    document.head.append(s);
    return s;
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
            <kbd>1</kbd>
          </button>
          <button class="cq-opt" data-mode="camera">
            <span class="cq-ico">📷</span>
            <b>Camera</b>
            <span>Wave your hand in front of the camera.<br>Pinch thumb + finger to tap and drag.</span>
            <em class="cq-warn"></em>
            <kbd>2</kbd>
          </button>
          <button class="cq-opt" data-mode="keyboard">
            <span class="cq-ico">⌨️</span>
            <b>Keyboard</b>
            <span>Play with the laptop keyboard.<br>Mouse and touchpad work too.</span>
            <kbd>3</kbd>
          </button>
        </div>
      </div>`;
    const cam = chooser.querySelector('[data-mode=camera]');
    if (blocked) {
      cam.disabled = true;
      cam.querySelector('.cq-warn').textContent = blocked;
    }
    const pick = btn => {
      if (!btn || btn.disabled) return;
      chooser.remove();
      chooser = null;
      choose(btn.dataset.mode);
    };
    chooser.addEventListener('click', e => pick(e.target.closest('.cq-opt')));
    chooser.addEventListener('keydown', e => {
      const opts = [...chooser.querySelectorAll('.cq-opt:not(:disabled)')];
      const i = opts.indexOf(document.activeElement);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const next = opts[(i + (e.key === 'ArrowRight' ? 1 : opts.length - 1)) % opts.length];
        if (next) next.focus();
        e.preventDefault();
      } else if (/^[123]$/.test(e.key)) {
        pick(chooser.querySelector(`.cq-opt[data-mode=${['touch', 'camera', 'keyboard'][Number(e.key) - 1]}]`));
        e.preventDefault();
      }
    });
    // Nothing underneath may be used until a mode is chosen.
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'keydown', 'keyup']) {
      chooser.addEventListener(ev, e => e.stopPropagation());
    }
    document.body.append(chooser);
    chooser.querySelector('.cq-opt').focus({ preventScroll: true });
  };

  // Keys pressed while the chooser is open (focus may be on the page) must not reach the game.
  document.addEventListener('keydown', e => {
    if (!chooser || chooser.contains(e.target)) return;
    e.stopImmediatePropagation();
    if (/^[123]$/.test(e.key) || e.key === 'Enter' || e.key.startsWith('Arrow')) {
      chooser.querySelector('.cq-opt').focus();
      chooser.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, bubbles: false }));
    }
    e.preventDefault();
  }, true);

  // --- switch button (in the game top bar when there is one, otherwise floating) ---------------

  let switchBtn = null;
  const LABELS = { touch: '✋ Touch', camera: '📷 Camera', keyboard: '⌨️ Keyboard' };
  function updateSwitch() {
    if (!switchBtn) return;
    switchBtn.textContent = LABELS[Input.mode] || '✋ Touch';
    switchBtn.title = 'Change input: touch, camera or keyboard';
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

  // --- keyboard support ----------------------------------------------------------------------------

  const isTextField = el => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) &&
    !/^(button|checkbox|radio|range|submit|reset|color|file)$/i.test(el.type || ''));

  const keys = {};
  Input.keys = keys;

  keys.on = function (fn) {
    const handler = e => {
      if (chooser || isTextField(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      fn(e);
    };
    document.addEventListener('keydown', handler);
    document.addEventListener('keyup', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      document.removeEventListener('keyup', handler);
    };
  };

  // In keyboard mode, menus are driven with Tab / arrows / Enter: focus the first button of any
  // overlay that appears, and let arrow keys move between its buttons (without reaching the game).
  const OVERLAY_SEL = '.ifpd-overlay, [data-keyboard-menu]';
  function focusFirstInOverlay() {
    const overlays = [...document.querySelectorAll(OVERLAY_SEL)];
    const o = overlays[overlays.length - 1];
    if (!o || o.contains(document.activeElement)) return;
    // A menu can name its main button with data-keyboard-default (e.g. Start); else the first one.
    const b = o.querySelector('[data-keyboard-default]:not(:disabled)') ||
      o.querySelector('button:not(:disabled), [tabindex]:not([tabindex="-1"]), a[href]');
    if (b) b.focus({ preventScroll: true });
  }
  new MutationObserver(() => {
    if (Input.mode !== 'keyboard' || chooser) return;
    focusFirstInOverlay();
    if (cur.enabled && cur.el && cur.el.hidden === cursorActive()) updateCursor(); // menu opened/closed
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });

  document.addEventListener('keydown', e => {
    if (Input.mode !== 'keyboard' || chooser || !e.key.startsWith('Arrow')) return;
    const o = document.activeElement && document.activeElement.closest(OVERLAY_SEL);
    if (!o || isTextField(document.activeElement)) return;
    const items = [...o.querySelectorAll('button:not(:disabled), a[href]')].filter(b => b.offsetParent !== null);
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    items[(i + step + items.length) % items.length].focus();
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  // Help card: lists the current page's keys (keyboard mode only). "?" toggles it. It ignores
  // touches and clicks, so anything underneath (buzzers, pieces, keys) keeps working.
  let helpData = null, helpEl = null, helpOpen = true, helpTimer = 0;
  keys.help = function (title, rows, { corner = 'bottom-left' } = {}) {
    helpData = { title, rows, corner };
    helpOpen = true;
    renderHelp();
    clearTimeout(helpTimer);
    helpTimer = setTimeout(() => { helpOpen = false; renderHelp(); }, 9000);
  };

  function renderHelp() {
    if (!helpEl) {
      helpEl = document.createElement('div');
      helpEl.className = 'cq-help-card';
      (document.body || document.documentElement).append(helpEl);
    }
    const show = Input.mode === 'keyboard' && helpData;
    helpEl.hidden = !show;
    if (!show) return;
    // Default bottom-left (out of the way of scores/timers, which sit at the top); clear of any
    // top bar or footer bar the page has.
    const [vert, horiz] = helpData.corner.split('-');
    const bar = document.querySelector('.ifpd-bar, body > header');
    const footer = document.querySelector('body > footer');
    const visible = el => el && el.offsetParent !== null;
    helpEl.style.top = vert === 'top' ? (visible(bar) ? Math.round(bar.getBoundingClientRect().bottom) : 0) + 12 + 'px' : 'auto';
    helpEl.style.bottom = vert === 'bottom' ? (visible(footer) ? Math.round(innerHeight - footer.getBoundingClientRect().top) : 0) + 14 + 'px' : 'auto';
    helpEl.style.left = horiz === 'left' ? '14px' : 'auto';
    helpEl.style.right = horiz === 'right' ? '14px' : 'auto';
    helpEl.classList.toggle('open', helpOpen);
    // Each token is a key cap, except joining words ("then", "or", "and", "–") shown as text.
    const PLAIN = new Set(['then', 'or', 'and', '–', '—', '…']); // '/', '+', '-' can be real keys
    const caps = k => (k || '').split(' ').filter(Boolean)
      .map(x => (PLAIN.has(x) ? `<span class="cq-join">${x}</span>` : `<kbd>${x}</kbd>`)).join(' ');
    const rows = helpData.rows.map(([k, what]) => `<tr><td>${caps(k)}</td><td>${what}</td></tr>`).join('');
    helpEl.innerHTML = helpOpen
      ? `<div class="cq-help-head">⌨ ${helpData.title || 'Keys'} <span>? hide</span></div><table>${rows}</table>`
      : '<div class="cq-help-head">⌨ Keys <span>? show</span></div>';
  }
  document.addEventListener('keydown', e => {
    if (e.key === '?' && !chooser && !isTextField(e.target) && Input.mode === 'keyboard') {
      helpOpen = !helpOpen;
      clearTimeout(helpTimer);
      renderHelp();
    }
  });

  // Keyboard cursor: a virtual finger moved with arrows / WASD; Space = touch (hold to drag).
  const cur = { enabled: false, x: innerWidth / 2, y: innerHeight / 2, held: new Set(), id: null, t: 0, el: null, raf: 0, holdStart: 0 };
  const MOVE_KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1] };
  let vpScript = null;

  keys.cursor = function (on) {
    cur.enabled = !!on;
    if (on && !window.CosmiqPointer && !vpScript) vpScript = loadScript('virtual-pointer.js', () => {});
    updateCursor();
  };

  // The cursor pauses while a menu/overlay is open, so Space can't tap the game behind it.
  function overlayOpen() {
    return [...document.querySelectorAll(OVERLAY_SEL)].some(o => {
      const cs = getComputedStyle(o);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && o.getClientRects().length > 0;
    });
  }
  function cursorActive() { return cur.enabled && Input.mode === 'keyboard' && !chooser && !overlayOpen(); }

  function updateCursor() {
    if (!cur.el) {
      cur.el = document.createElement('div');
      cur.el.className = 'cq-kcursor';
      (document.body || document.documentElement).append(cur.el);
    }
    cur.el.hidden = !cursorActive();
    if (!cursorActive()) {
      if (cur.id != null && window.CosmiqPointer) window.CosmiqPointer.up(cur.id, true);
      cur.id = null;
      cur.held.clear();
    }
    placeCursor();
  }

  function placeCursor() {
    cur.el.style.transform = `translate(${cur.x - 24}px, ${cur.y - 24}px)`;
    cur.el.classList.toggle('down', cur.id != null);
  }

  function cursorFrame(now) {
    cur.raf = 0;
    if (!cursorActive() || !cur.held.size) return;
    const dt = Math.min(0.05, (now - (cur.t || now)) / 1000);
    cur.t = now;
    let dx = 0, dy = 0;
    for (const k of cur.held) { dx += MOVE_KEYS[k][0]; dy += MOVE_KEYS[k][1]; }
    const len = Math.hypot(dx, dy) || 1;
    const held = (now - cur.holdStart) / 1000;
    const speed = cur.slow ? 220 : Math.min(1500, 450 + held * 1200); // speeds up while held; Shift = fine
    cur.x = Math.max(0, Math.min(innerWidth - 1, cur.x + dx / len * speed * dt));
    cur.y = Math.max(0, Math.min(innerHeight - 1, cur.y + dy / len * speed * dt));
    placeCursor();
    if (cur.id != null) window.CosmiqPointer.move(cur.id, cur.x, cur.y);
    cur.raf = requestAnimationFrame(cursorFrame);
  }

  document.addEventListener('keydown', e => {
    if (!cursorActive() || isTextField(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    cur.slow = e.shiftKey;
    if (MOVE_KEYS[k]) {
      e.preventDefault();
      if (!cur.held.size) cur.holdStart = performance.now();
      cur.held.add(k);
      if (!cur.raf) { cur.t = 0; cur.raf = requestAnimationFrame(cursorFrame); }
    } else if (k === ' ' && !e.repeat && window.CosmiqPointer) {
      e.preventDefault();
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      if (cur.id == null) cur.id = window.CosmiqPointer.down(cur.x, cur.y);
      placeCursor();
    } else if (k === ' ') {
      e.preventDefault();
    }
  });
  document.addEventListener('keyup', e => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    cur.slow = e.shiftKey;
    cur.held.delete(k);
    if (k === ' ' && cur.id != null) {
      window.CosmiqPointer.up(cur.id);
      cur.id = null;
      placeCursor();
    }
  });
  window.addEventListener('blur', () => {
    cur.held.clear();
    if (cur.id != null && window.CosmiqPointer) { window.CosmiqPointer.up(cur.id, true); cur.id = null; }
  });

  function init() {
    mountSwitch();
    let saved = null;
    try { saved = sessionStorage.getItem(KEY); } catch (_) { /* storage disabled */ }
    if (saved === 'camera' && cameraBlocker()) saved = null;
    if (saved === 'touch' || saved === 'camera' || saved === 'keyboard') apply(saved);
    else if (IN_APP) choose('touch');
    else Input.showChooser();
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);

  function injectStyles() {
    const css = `
      @keyframes cq-in { from { opacity: 0; } to { opacity: 1; } }
      @keyframes cq-rise { from { opacity: 0; transform: translateY(40px) scale(0.92); } to { opacity: 1; transform: none; } }
      @keyframes cq-bob { 0%, 100% { transform: translateY(-6px) rotate(-4deg); } 50% { transform: translateY(6px) rotate(4deg); } }
      @keyframes cq-shine { 0% { transform: translateX(-160%) skewX(-20deg); } 60%, 100% { transform: translateX(260%) skewX(-20deg); } }
      .cq-chooser { position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center;
        background: radial-gradient(ellipse at 15% 10%, #ff7a6b40, transparent 55%),
                    radial-gradient(ellipse at 90% 90%, #8b5cf630, transparent 55%), #12151f; color: #fff4f1;
        font: 18px/1.4 Poppins, "Segoe UI", system-ui, Roboto, sans-serif; touch-action: none; user-select: none;
        animation: cq-in 0.35s ease both; }
      .cq-box { text-align: center; padding: 24px; }
      .cq-box h1 { margin: 0 0 6px; font-size: 48px; font-weight: 800; letter-spacing: 0.5px;
        background: linear-gradient(90deg, #fff4f1, #ff9a8b, #fff4f1); -webkit-background-clip: text; background-clip: text; color: transparent; }
      .cq-sub { margin: 0 0 36px; color: #afa8b8; font-size: 20px; }
      .cq-options { display: flex; gap: 32px; justify-content: center; flex-wrap: wrap; }
      .cq-opt { position: relative; overflow: hidden; width: 340px; min-height: 330px; padding: 28px; border-radius: 30px;
        border: 2px solid #ffffff30; display: flex; flex-direction: column; align-items: center; gap: 10px; cursor: pointer;
        color: inherit; font: inherit; background: linear-gradient(160deg, #ff9a8b, #ff7a6b 45%, #e8553a);
        box-shadow: 0 18px 40px #0008, 0 0 40px #ff7a6b40, inset 0 1px 0 #ffffff50; touch-action: manipulation; outline: none;
        animation: cq-rise 0.55s cubic-bezier(.2,1.3,.4,1) both; transition: transform 0.18s cubic-bezier(.2,1.6,.4,1); }
      .cq-opt::after { content: ''; position: absolute; top: 0; bottom: 0; width: 35%; left: 0;
        background: linear-gradient(90deg, transparent, #ffffff40, transparent); animation: cq-shine 4.5s ease-in-out infinite; pointer-events: none; }
      .cq-opt[data-mode=camera] { background: linear-gradient(160deg, #3fd6c6, #1a8f86); box-shadow: 0 18px 40px #0008, 0 0 40px #22c7c740, inset 0 1px 0 #ffffff50; animation-delay: 0.08s; }
      .cq-opt[data-mode=keyboard] { background: linear-gradient(160deg, #a98bff, #5b34c9); box-shadow: 0 18px 40px #0008, 0 0 40px #8b5cf640, inset 0 1px 0 #ffffff50; animation-delay: 0.16s; }
      .cq-opt:focus-visible { box-shadow: 0 0 0 5px #ffd27a, 0 18px 40px #0008; }
      .cq-opt:active { transform: scale(0.95); }
      .cq-opt:disabled { filter: grayscale(0.85); opacity: 0.5; cursor: not-allowed; }
      .cq-opt b { font-size: 40px; font-weight: 800; }
      .cq-opt span { font-size: 19px; opacity: 0.95; }
      .cq-opt kbd { position: absolute; top: 14px; right: 16px; }
      .cq-ico { display: inline-block; font-size: 96px !important; line-height: 1; filter: drop-shadow(0 6px 10px #0006);
        animation: cq-bob 2.4s ease-in-out infinite; }
      .cq-warn { font-size: 16px; font-style: normal; color: #ffe08a; }
      .cq-switch-float { position: fixed; right: 14px; bottom: 14px; z-index: 2147482000; min-height: 48px;
        padding: 8px 18px; border-radius: 999px; border: 1px solid #ffffff44; color: #fff;
        background: linear-gradient(90deg, #ff9a8b, #ff7a6b, #ff6b4a);
        font: 600 17px Poppins, "Segoe UI", system-ui, sans-serif; box-shadow: 0 6px 18px #ff7a6b55; touch-action: manipulation; }
      .cq-chooser kbd, .cq-help-card kbd { display: inline-block; min-width: 1.6em; padding: 1px 7px; border-radius: 6px;
        border: 1px solid #ffffff55; border-bottom-width: 3px; background: #ffffff18; font: 700 15px "Segoe UI", sans-serif; text-align: center; }
      html[data-input-mode=keyboard] :focus-visible { outline: 4px solid #ffd27a !important; outline-offset: 3px; }
      .cq-help-card { position: fixed; left: 14px; bottom: 14px; z-index: 2147482500; max-width: 440px; padding: 10px 14px;
        border-radius: 14px; background: #121218ee; border: 1px solid #ffffff2a; color: #eee; box-shadow: 0 8px 24px #000a;
        font: 15px/1.35 "Segoe UI", system-ui, sans-serif; user-select: none; pointer-events: none; }
      .cq-help-card[hidden] { display: none; }
      .cq-help-head { font-weight: 700; font-size: 16px; display: flex; gap: 12px; justify-content: space-between; }
      .cq-help-head span { font-weight: 400; opacity: 0.6; }
      .cq-join { opacity: 0.7; margin: 0 2px; }
      .cq-help-card table { margin-top: 6px; border-collapse: collapse; }
      .cq-help-card td { padding: 3px 8px 3px 0; vertical-align: top; }
      .cq-help-card td:first-child { white-space: nowrap; }
      .cq-kcursor { position: fixed; left: 0; top: 0; width: 48px; height: 48px; z-index: 2147483200; pointer-events: none;
        border-radius: 50%; border: 4px solid #ffd27a; box-shadow: 0 0 0 2px #0008, 0 0 16px #ffd27a88; }
      .cq-kcursor::after { content: ''; position: absolute; left: 50%; top: 50%; width: 8px; height: 8px; margin: -4px 0 0 -4px;
        border-radius: 50%; background: #fff; }
      .cq-kcursor.down { background: #ffd27a99; }
      .cq-kcursor[hidden] { display: none; }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
  }
})();
