/*
 * Songs — built-in melodies with lyrics, and a player with two modes:
 *   play(song)  : the piano plays the tune by itself, keys light up as they sound
 *   learn(song) : the next key glows green; the song advances only when that key is pressed
 *                 (by touch, camera, computer keys or MIDI)
 */
(function (P) {
  'use strict';

  // Each line: [note, beats, syllable]. Notes are scientific pitch names (C4 = middle C).
  const SONGS = [
    {
      id: 'twinkle',
      title: 'Twinkle Twinkle Little Star',
      bpm: 100,
      lines: [
        [['C4', 1, 'Twin'], ['C4', 1, 'kle'], ['G4', 1, 'twin'], ['G4', 1, 'kle'], ['A4', 1, 'lit'], ['A4', 1, 'tle'], ['G4', 2, 'star,']],
        [['F4', 1, 'how'], ['F4', 1, 'I'], ['E4', 1, 'won'], ['E4', 1, 'der'], ['D4', 1, 'what'], ['D4', 1, 'you'], ['C4', 2, 'are.']],
        [['G4', 1, 'Up'], ['G4', 1, 'a'], ['F4', 1, 'bove'], ['F4', 1, 'the'], ['E4', 1, 'world'], ['E4', 1, 'so'], ['D4', 2, 'high,']],
        [['G4', 1, 'Like'], ['G4', 1, 'a'], ['F4', 1, 'dia'], ['F4', 1, 'mond'], ['E4', 1, 'in'], ['E4', 1, 'the'], ['D4', 2, 'sky.']],
        [['C4', 1, 'Twin'], ['C4', 1, 'kle'], ['G4', 1, 'twin'], ['G4', 1, 'kle'], ['A4', 1, 'lit'], ['A4', 1, 'tle'], ['G4', 2, 'star,']],
        [['F4', 1, 'how'], ['F4', 1, 'I'], ['E4', 1, 'won'], ['E4', 1, 'der'], ['D4', 1, 'what'], ['D4', 1, 'you'], ['C4', 2, 'are.']],
      ],
    },
    {
      id: 'mary',
      title: 'Mary Had a Little Lamb',
      bpm: 110,
      lines: [
        [['E4', 1, 'Ma'], ['D4', 1, 'ry'], ['C4', 1, 'had'], ['D4', 1, 'a'], ['E4', 1, 'lit'], ['E4', 1, 'tle'], ['E4', 2, 'lamb,']],
        [['D4', 1, 'lit'], ['D4', 1, 'tle'], ['D4', 2, 'lamb,'], ['E4', 1, 'lit'], ['G4', 1, 'tle'], ['G4', 2, 'lamb.']],
        [['E4', 1, 'Ma'], ['D4', 1, 'ry'], ['C4', 1, 'had'], ['D4', 1, 'a'], ['E4', 1, 'lit'], ['E4', 1, 'tle'], ['E4', 1, 'lamb,'], ['E4', 1, 'its']],
        [['D4', 1, 'fleece'], ['D4', 1, 'was'], ['E4', 1, 'white'], ['D4', 1, 'as'], ['C4', 4, 'snow.']],
      ],
    },
    {
      id: 'birthday',
      title: 'Happy Birthday',
      bpm: 100,
      lines: [
        [['G4', 0.75, 'Hap'], ['G4', 0.25, 'py'], ['A4', 1, 'birth'], ['G4', 1, 'day'], ['C5', 1, 'to'], ['B4', 2, 'you,']],
        [['G4', 0.75, 'Hap'], ['G4', 0.25, 'py'], ['A4', 1, 'birth'], ['G4', 1, 'day'], ['D5', 1, 'to'], ['C5', 2, 'you,']],
        [['G4', 0.75, 'Hap'], ['G4', 0.25, 'py'], ['G5', 1, 'birth'], ['E5', 1, 'day'], ['C5', 1, 'dear'], ['B4', 1, 'stu'], ['A4', 2, 'dent,']],
        [['F5', 0.75, 'Hap'], ['F5', 0.25, 'py'], ['E5', 1, 'birth'], ['C5', 1, 'day'], ['D5', 1, 'to'], ['C5', 2, 'you!']],
      ],
    },
  ];

  const PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function midi(name) {
    const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
    const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
    return 12 * (Number(m[3]) + 1) + PITCH[m[1]] + acc;
  }

  // Flatten lines into one note list, remembering which line and position each note belongs to.
  function flatten(song) {
    const notes = [];
    song.lines.forEach((line, li) => line.forEach(([name, beats, lyric]) => {
      notes.push({ note: midi(name), beats, lyric, line: li });
    }));
    return notes;
  }

  class SongPlayer {
    constructor(router, onChange) {
      this.router = router;
      this.onChange = onChange || (() => {});
      this.mode = 'idle'; // 'idle' | 'play' | 'learn' | 'done'
      this.song = null;
      this.notes = [];
      this.index = 0;
      this.timers = [];
      this.held = new Set();
      this.mistake = false;
      router.subscribe(e => this._onRouter(e));
    }

    play(song) {
      this.stop();
      this._load(song, 'play');
      const beatMs = 60000 / song.bpm;
      let t = 600; // short lead-in
      this.notes.forEach((n, i) => {
        const dur = n.beats * beatMs;
        this.timers.push(setTimeout(() => {
          this.index = i;
          this.held.add(n.note);
          this.router.noteOn(n.note, 80, 'playback');
          this.onChange();
        }, t));
        this.timers.push(setTimeout(() => {
          this.held.delete(n.note);
          this.router.noteOff(n.note, 'playback');
        }, t + dur * 0.9));
        t += dur;
      });
      this.timers.push(setTimeout(() => this._finish(), t + 200));
      this.onChange();
    }

    learn(song) {
      this.stop();
      this._load(song, 'learn');
      this.router.setGuide([this.notes[0].note]);
      this.onChange();
    }

    stop() {
      this.timers.forEach(clearTimeout);
      this.timers = [];
      for (const n of this.held) this.router.noteOff(n, 'playback');
      this.held.clear();
      if (this.router.guide.size) this.router.setGuide([]);
      const wasActive = this.mode !== 'idle';
      this.mode = 'idle';
      if (wasActive) this.onChange();
    }

    get current() { return this.notes[this.index] || null; }

    _load(song, mode) {
      this.song = song;
      this.notes = flatten(song);
      this.index = 0;
      this.mistake = false;
      this.mode = mode;
    }

    _finish() {
      this.timers.forEach(clearTimeout);
      this.timers = [];
      this.router.setGuide([]);
      this.mode = 'done';
      this.onChange();
    }

    _onRouter(e) {
      if (e.type === 'panic' && this.mode !== 'idle') { this.stop(); return; }
      if (this.mode !== 'learn' || e.type !== 'on' || e.source === 'playback') return;
      const want = this.notes[this.index];
      if (!want) return;
      if (e.note === want.note) {
        this.index++;
        this.mistake = false;
        if (this.index >= this.notes.length) this._finish();
        else {
          this.router.setGuide([this.notes[this.index].note]);
          this.onChange();
        }
      } else {
        this.mistake = true;
        this.onChange();
      }
    }
  }

  P.SONGS = SONGS;
  P.SongPlayer = SongPlayer;
})(window.Piano = window.Piano || {});
