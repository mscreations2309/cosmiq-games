/*
 * Recorder — captures note/pedal events from the router and plays them back through it.
 */
(function (P) {
  'use strict';

  class Recorder {
    constructor(router, onChange) {
      this.router = router;
      this.onChange = onChange || (() => {});
      this.events = [];
      this.recording = false;
      this.playing = false;
      this.timers = [];
      this.playbackHeld = new Set();
      router.subscribe(e => this._capture(e));
    }

    get hasTake() { return this.events.length > 0; }

    startRecording() {
      this.stop();
      this.events = [];
      this.startTime = performance.now();
      this.recording = true;
      this.onChange();
    }

    play() {
      if (!this.hasTake) return;
      this.stop();
      this.playing = true;
      for (const e of this.events) {
        this.timers.push(setTimeout(() => this._replay(e), e.t));
      }
      const end = this.events[this.events.length - 1].t + 50;
      this.timers.push(setTimeout(() => this.stop(), end));
      this.onChange();
    }

    stop() {
      this.recording = false;
      if (this.playing) {
        this.timers.forEach(clearTimeout);
        this.timers = [];
        for (const n of this.playbackHeld) this.router.noteOff(n, 'playback');
        this.playbackHeld.clear();
        if (this.router.sustain) this.router.setSustain(false, 'playback');
        this.playing = false;
      }
      this.onChange();
    }

    _capture(e) {
      if (!this.recording || e.source === 'playback' || e.type === 'panic') return;
      this.events.push({ ...e, t: e.time - this.startTime });
    }

    _replay(e) {
      if (e.type === 'on') { this.playbackHeld.add(e.note); this.router.noteOn(e.note, e.velocity, 'playback'); }
      else if (e.type === 'off') { this.playbackHeld.delete(e.note); this.router.noteOff(e.note, 'playback'); }
      else if (e.type === 'sustain') this.router.setSustain(e.on, 'playback');
    }
  }

  P.Recorder = Recorder;
})(window.Piano = window.Piano || {});
