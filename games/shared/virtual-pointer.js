/*
 * Virtual pointers — lets camera hands and the keyboard cursor act like fingers on the screen.
 *
 * Sends real PointerEvents (pointerType 'touch') to the element under the point, with touch-style
 * implicit capture, plus a click on release, so every game works without changes. Pages that call
 * setPointerCapture() with these ids get emulated capture instead of an exception.
 *
 *   const id = CosmiqPointer.down(x, y)   CosmiqPointer.move(id, x, y)   CosmiqPointer.up(id, cancelled)
 */
(function () {
  'use strict';
  if (window.CosmiqPointer) return;

  const active = new Map(); // pointerId -> { x, y, target, capture }
  let nextId = 1001;

  function primaryId() { return active.keys().next().value; }

  // What a virtual finger touches: the top element, skipping the "⌨ Keys" help card so it never
  // swallows a tap meant for the game underneath.
  const SKIP = '.cq-help-card';
  function hit(x, y) {
    for (const el of document.elementsFromPoint(x, y)) if (!el.closest(SKIP)) return el;
    return null;
  }

  function send(type, id, p, target) {
    if (!target || !target.isConnected) return;
    const pressed = type === 'pointerdown' || type === 'pointermove';
    target.dispatchEvent(new PointerEvent(type, {
      bubbles: type !== 'lostpointercapture',
      cancelable: type !== 'lostpointercapture' && type !== 'pointercancel',
      composed: true,
      pointerId: id,
      pointerType: 'touch',
      isPrimary: id === primaryId(),
      clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y,
      width: 24, height: 24,
      pressure: pressed ? 0.5 : 0,
      button: type === 'pointermove' ? -1 : 0,
      buttons: pressed ? 1 : 0,
      view: window,
    }));
  }

  const VP = {
    down(x, y) {
      const id = nextId++;
      const p = { x, y, target: hit(x, y), capture: null };
      active.set(id, p);
      send('pointerdown', id, p, p.target);
      return id;
    },
    move(id, x, y) {
      const p = active.get(id);
      if (!p) return;
      p.x = x; p.y = y;
      send('pointermove', id, p, p.capture || p.target);
    },
    up(id, cancelled = false) {
      const p = active.get(id);
      if (!p) return;
      const target = p.capture || p.target;
      send(cancelled ? 'pointercancel' : 'pointerup', id, p, target);
      if (p.capture) send('lostpointercapture', id, p, p.capture);
      if (!cancelled && p.target && p.target.isConnected) {
        const under = hit(p.x, p.y);
        if (under && (p.target === under || p.target.contains(under))) {
          p.target.dispatchEvent(new MouseEvent('click', {
            bubbles: true, cancelable: true, composed: true, clientX: p.x, clientY: p.y, button: 0, view: window,
          }));
        }
      }
      active.delete(id);
    },
    isActive: id => active.has(id),
  };

  // Emulated pointer capture for our synthetic ids.
  const proto = Element.prototype;
  const realSet = proto.setPointerCapture, realRelease = proto.releasePointerCapture, realHas = proto.hasPointerCapture;
  proto.setPointerCapture = function (id) {
    const p = active.get(id);
    if (p) { p.capture = this; return; }
    return realSet.call(this, id);
  };
  proto.releasePointerCapture = function (id) {
    const p = active.get(id);
    if (p) { if (p.capture === this) p.capture = null; return; }
    return realRelease.call(this, id);
  };
  proto.hasPointerCapture = function (id) {
    const p = active.get(id);
    if (p) return p.capture === this;
    return realHas.call(this, id);
  };

  window.CosmiqPointer = VP;
})();
