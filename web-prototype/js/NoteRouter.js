/*
 * NoteRouter — single entry point for every note source (touch, MIDI, computer keys, playback).
 * Keeps per-key hold counts so two fingers / two players on the same key behave correctly,
 * forwards to the engine, and notifies listeners (keyboard views, recorder, pedal button).
 */
(function (P) {
  'use strict';

  class NoteRouter {
    constructor(engine) {
      this.engine = engine;
      this.holds = new Map();      // note -> number of active holders
      this.lastSource = new Map(); // note -> source of most recent press (for key colour)
      this.sustain = false;
      this.guide = new Set();      // keys to highlight as "press next" (song teacher)
      this.listeners = new Set();
    }

    setGuide(notes) {
      this.guide = new Set(notes);
      this._emit({ type: 'guide' });
    }

    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

    noteOn(note, velocity, source) {
      if (note < P.MIN_NOTE || note > P.MAX_NOTE) return;
      velocity = Math.max(1, Math.min(127, Math.round(velocity)));
      this.holds.set(note, (this.holds.get(note) || 0) + 1);
      this.lastSource.set(note, source);
      this.engine.noteOn(note, velocity); // every press re-strikes, like a real key
      this._emit({ type: 'on', note, velocity, source });
    }

    noteOff(note, source) {
      const n = this.holds.get(note) || 0;
      if (n <= 0) return;
      if (n === 1) {
        this.holds.delete(note);
        this.engine.noteOff(note);
      } else {
        this.holds.set(note, n - 1);
      }
      this._emit({ type: 'off', note, source });
    }

    setSustain(on, source) {
      if (on === this.sustain) return;
      this.sustain = on;
      this.engine.setSustain(on);
      this._emit({ type: 'sustain', on, source });
    }

    isDown(note) { return this.holds.has(note); }
    sourceOf(note) { return this.lastSource.get(note); }

    panic() {
      this.holds.clear();
      this.sustain = false;
      this.engine.setSustain(false);
      this.engine.allNotesOff();
      this._emit({ type: 'panic' });
    }

    _emit(e) {
      e.time = performance.now();
      for (const fn of this.listeners) fn(e);
    }
  }

  P.NoteRouter = NoteRouter;
})(window.Piano = window.Piano || {});
