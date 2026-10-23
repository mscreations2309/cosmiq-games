/*
 * main — wires engine, router, views and controls together. Settings persist in localStorage.
 */
(function (P) {
  'use strict';

  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'cosmiq-piano-settings';

  const settings = Object.assign({
    keysVisible: '88',
    screenInches: 75,
    layout: 'single',
    labels: 'c',
    velocityMode: 'fixed',
    fixedVelocity: 90,
    palmReject: true,
    reverb: 0.25,
    volume: 0.8,
    sustainLatch: false,
  }, JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));

  const engine = new P.PianoEngine();
  const router = new P.NoteRouter(engine);
  Object.assign(window, { __engine: engine, __router: router }); // for console debugging / automated tests
  const inputSamples = [];
  let lastInput = null;
  const onInputSample = s => {
    lastInput = s;
    inputSamples.push(s.delayMs);
    if (inputSamples.length > 20) inputSamples.shift();
  };

  const keyboards = [
    new P.KeyboardView({ container: $('kb1'), router, settings, onInputSample }),
    new P.KeyboardView({ container: $('kb2'), router, settings, onInputSample }),
  ];
  keyboards[1].centerNote = 48; // second player starts an octave lower

  const relayoutAll = () => keyboards.forEach(k => k.relayout());
  const redrawAll = () => keyboards.forEach(k => k.requestRedraw());

  // --- start / sound banks -------------------------------------------------

  let synthBank = null;
  let sfzFiles = null;

  $('startBtn').addEventListener('click', async () => {
    $('startBtn').disabled = true;
    $('startProgress').hidden = false;
    $('startStatus').textContent = 'Building piano sound…';
    await engine.init();
    await engine.resume();
    engine.setVolume(settings.volume);
    engine.setReverb(settings.reverb);
    synthBank = await P.SynthBank.generate(engine.ctx, p => { $('startProgress').value = p; });
    engine.setBank(synthBank);
    $('soundStatus').textContent = synthBank.name + ' (adding soft/hard layers…)';
    $('startOverlay').classList.add('hidden');
    await synthBank.complete;
    if (engine.bank === synthBank) $('soundStatus').textContent = synthBank.name;
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') engine.resume();
    else router.panic();
  });

  $('soundSource').addEventListener('change', e => {
    const sfz = e.target.value === 'sfz';
    $('sfzControls').hidden = !sfz;
    if (!sfz && synthBank) {
      engine.setBank(synthBank);
      $('soundStatus').textContent = synthBank.name;
    }
  });

  $('sfzPickBtn').addEventListener('click', () => $('sfzFolder').click());
  $('sfzFolder').addEventListener('change', e => {
    sfzFiles = e.target.files;
    const list = P.SfzLoader.listSfzFiles(sfzFiles);
    const select = $('sfzFile');
    select.innerHTML = '';
    list.forEach((f, i) => select.add(new Option(f.name, String(i))));
    select._files = list;
    $('sfzLoadBtn').disabled = !list.length;
    $('soundStatus').textContent = list.length ? `${list.length} SFZ file(s) found` : 'No .sfz file in that folder';
  });

  $('sfzLoadBtn').addEventListener('click', async () => {
    const select = $('sfzFile');
    const sfz = select._files && select._files[Number(select.value)];
    if (!sfz) return;
    $('sfzLoadBtn').disabled = true;
    try {
      const bank = await P.SfzLoader.load(engine.ctx, sfzFiles, sfz, {
        maxLayers: Number($('sfzLayers').value),
        maxSeconds: Number($('sfzMaxSec').value),
      }, p => { $('soundStatus').textContent = `Decoding samples… ${Math.round(p * 100)}%`; });
      engine.setBank(bank);
      const bytes = [...new Set([...bank.zones, ...bank.releaseZones].map(z => z.buffer))]
        .reduce((sum, b) => sum + b.length * b.numberOfChannels * 4, 0);
      $('soundStatus').textContent =
        `${bank.name}: ${bank.zones.length} zones, ${bank.releaseZones.length} release, ~${Math.round(bytes / 1048576)} MB RAM` +
        (bank.missingCount ? ` (${bank.missingCount} samples missing)` : '');
    } catch (err) {
      console.error(err);
      $('soundStatus').textContent = 'Load failed: ' + err.message;
    } finally {
      $('sfzLoadBtn').disabled = false;
    }
  });

  // --- settings controls ---------------------------------------------------

  function bind(id, key, onChange, parse = v => v) {
    const el = $(id);
    const isCheck = el.type === 'checkbox';
    if (isCheck) el.checked = !!settings[key]; else el.value = String(settings[key]);
    el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
      settings[key] = isCheck ? el.checked : parse(el.value);
      save();
      if (onChange) onChange(settings[key]);
    });
  }

  const showInches = () => { $('inchesRow').hidden = settings.keysVisible !== 'real'; };
  const applyLayout = () => { $('kb2').hidden = settings.layout !== 'dual'; relayoutAll(); };
  const showVelocity = () => { $('velValue').textContent = settings.fixedVelocity; };

  bind('keysVisible', 'keysVisible', () => { showInches(); relayoutAll(); });
  bind('screenInches', 'screenInches', relayoutAll, Number);
  bind('layout', 'layout', applyLayout);
  bind('labels', 'labels', redrawAll);
  bind('velocityMode', 'velocityMode');
  bind('fixedVelocity', 'fixedVelocity', showVelocity, Number);
  bind('palmReject', 'palmReject');
  bind('reverb', 'reverb', v => engine.setReverb(v), Number);
  bind('volume', 'volume', v => engine.setVolume(v), Number);
  bind('sustainLatch', 'sustainLatch');
  showInches();
  showVelocity();
  applyLayout();

  $('toggleToolbar').addEventListener('click', () => {
    const hidden = document.body.classList.toggle('toolbar-hidden');
    $('toggleToolbar').textContent = hidden ? 'Show controls' : 'Hide controls';
  });
  $('fullscreenBtn').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });
  $('panicBtn').addEventListener('click', () => router.panic());

  // --- sustain pedal -------------------------------------------------------

  const pedal = $('sustainBtn');
  pedal.addEventListener('contextmenu', e => e.preventDefault());
  pedal.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (settings.sustainLatch) {
      router.setSustain(!router.sustain, 'touch');
    } else {
      pedal.setPointerCapture(e.pointerId);
      router.setSustain(true, 'touch');
    }
  });
  const pedalUp = () => { if (!settings.sustainLatch) router.setSustain(false, 'touch'); };
  pedal.addEventListener('pointerup', pedalUp);
  pedal.addEventListener('pointercancel', pedalUp);
  router.subscribe(e => {
    if (e.type === 'sustain' || e.type === 'panic') pedal.classList.toggle('on', router.sustain);
  });

  // --- computer keyboard (desktop testing) -----------------------------------

  const KEYMAP = 'awsedftgyhujkolp;';
  let baseNote = 60;
  const heldKeys = new Map(); // KeyboardEvent.code -> note
  const isFormField = t => t instanceof HTMLInputElement || t instanceof HTMLSelectElement;

  document.addEventListener('keydown', e => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isFormField(e.target)) return;
    if (e.code === 'Space') { e.preventDefault(); router.setSustain(true, 'computer'); return; }
    const k = e.key.toLowerCase();
    if (k === 'z' || k === 'x') {
      baseNote = Math.max(24, Math.min(96, baseNote + (k === 'z' ? -12 : 12)));
      return;
    }
    const i = KEYMAP.indexOf(k);
    if (i < 0) return;
    const note = baseNote + i;
    heldKeys.set(e.code, note);
    router.noteOn(note, settings.fixedVelocity, 'computer');
  });
  document.addEventListener('keyup', e => {
    if (e.code === 'Space') { router.setSustain(false, 'computer'); return; }
    const note = heldKeys.get(e.code);
    if (note == null) return;
    heldKeys.delete(e.code);
    router.noteOff(note, 'computer');
  });
  window.addEventListener('blur', () => {
    for (const note of heldKeys.values()) router.noteOff(note, 'computer');
    heldKeys.clear();
  });

  // --- MIDI + recorder -----------------------------------------------------

  const midi = new P.MidiInput(router, s => { $('midiStatus').textContent = s; });
  $('midiBtn').addEventListener('click', () => midi.enable());

  const recorder = new P.Recorder(router, () => {
    $('recBtn').disabled = recorder.recording;
    $('playBtn').disabled = recorder.recording || recorder.playing || !recorder.hasTake;
    $('stopBtn').disabled = !recorder.recording && !recorder.playing;
    $('recStatus').textContent = recorder.recording ? 'Recording…'
      : recorder.playing ? 'Playing…'
      : recorder.hasTake ? `${recorder.events.length} events recorded` : '';
  });
  $('recBtn').addEventListener('click', () => recorder.startRecording());
  $('playBtn').addEventListener('click', () => recorder.play());
  $('stopBtn').addEventListener('click', () => recorder.stop());

  // --- songs (play along / learn) --------------------------------------------

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const songSelect = $('songSelect');
  P.SONGS.forEach((s, i) => songSelect.add(new Option(s.title, String(i))));
  const selectedSong = () => P.SONGS[Number(songSelect.value)];

  const songs = new P.SongPlayer(router, renderSong);
  window.__songs = songs; // for console debugging / automated tests
  let doneTimer = 0;

  function renderSong() {
    const banner = $('songBanner');
    const active = songs.mode !== 'idle';
    $('songStopBtn').disabled = !active || songs.mode === 'done';
    if (!active) { banner.hidden = true; return; }
    banner.hidden = false;
    banner.querySelector('.song-title').textContent =
      (songs.mode === 'learn' ? '🎓 Learning: ' : '▶ ') + songs.song.title;

    const lyrics = banner.querySelector('.song-lyrics');
    const hint = banner.querySelector('.song-hint');
    if (songs.mode === 'done') {
      lyrics.textContent = '🎉 Well done!';
      hint.textContent = '';
      clearTimeout(doneTimer);
      doneTimer = setTimeout(() => { if (songs.mode === 'done') { songs.mode = 'idle'; renderSong(); } }, 4000);
      return;
    }

    const cur = songs.current;
    lyrics.innerHTML = '';
    songs.notes.forEach((n, i) => {
      if (n.line !== cur.line) return;
      const span = document.createElement('span');
      span.textContent = n.lyric + ' ';
      if (i < songs.index) span.className = 'sung';
      else if (i === songs.index) span.className = 'now';
      lyrics.append(span);
    });
    if (songs.mode === 'learn') {
      const name = NOTE_NAMES[cur.note % 12];
      hint.textContent = songs.mistake
        ? `Oops! Press the green key (${name}).`
        : `Press the green key: ${name}   ·   ${songs.index + 1} / ${songs.notes.length}`;
    } else {
      hint.textContent = '';
    }
  }

  $('songPlayBtn').addEventListener('click', () => songs.play(selectedSong()));
  $('songLearnBtn').addEventListener('click', () => songs.learn(selectedSong()));
  $('songStopBtn').addEventListener('click', () => songs.stop());

  // --- live stats (feasibility numbers for the panel) ------------------------

  setInterval(() => {
    if (!engine.ctx) return;
    const c = engine.ctx;
    const ms = v => (typeof v === 'number' && v > 0 ? (v * 1000).toFixed(1) + ' ms' : 'n/a');
    const avgInput = inputSamples.length
      ? (inputSamples.reduce((a, b) => a + b, 0) / inputSamples.length).toFixed(1) + ' ms' : '–';
    const touch = lastInput
      ? `last touch: ${lastInput.type}, ${lastInput.width.toFixed(0)}×${lastInput.height.toFixed(0)} px, pressure ${lastInput.pressure.toFixed(2)}, velocity ${Math.round(lastInput.velocity)}`
      : 'no touch yet';
    $('stats').textContent =
      `Voices ${engine.activeVoices}/${engine.maxVoices} · ${c.sampleRate} Hz · ` +
      `audio base ${ms(c.baseLatency)} + output ${ms(c.outputLatency)} · ` +
      `input handling avg ${avgInput} · ${touch}`;
  }, 300);
})(window.Piano = window.Piano || {});
