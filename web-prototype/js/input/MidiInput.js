/*
 * MidiInput — USB/Bluetooth MIDI keyboards via Web MIDI (Chrome/Edge).
 * Gives true velocity and a real sustain pedal (CC64), which a touchscreen cannot.
 */
(function (P) {
  'use strict';

  class MidiInput {
    constructor(router, onStatus) {
      this.router = router;
      this.onStatus = onStatus || (() => {});
      this.access = null;
    }

    async enable() {
      if (!navigator.requestMIDIAccess) {
        this.onStatus('Web MIDI not supported in this browser');
        return;
      }
      try {
        this.access = await navigator.requestMIDIAccess({ sysex: false });
      } catch (e) {
        this.onStatus('MIDI permission denied');
        return;
      }
      this.access.onstatechange = () => this._attach();
      this._attach();
    }

    _attach() {
      const names = [];
      for (const input of this.access.inputs.values()) {
        input.onmidimessage = m => this._onMessage(m.data);
        if (input.state === 'connected') names.push(input.name);
      }
      this.onStatus(names.length ? 'MIDI: ' + names.join(', ') : 'MIDI: no device connected');
    }

    _onMessage(data) {
      const [status, d1, d2] = data;
      const type = status & 0xf0;
      if (type === 0x90 && d2 > 0) this.router.noteOn(d1, d2, 'midi');
      else if (type === 0x80 || (type === 0x90 && d2 === 0)) this.router.noteOff(d1, 'midi');
      else if (type === 0xb0 && d1 === 64) this.router.setSustain(d2 >= 64, 'midi');
      else if (type === 0xb0 && (d1 === 120 || d1 === 123)) this.router.panic();
    }
  }

  P.MidiInput = MidiInput;
})(window.Piano = window.Piano || {});
