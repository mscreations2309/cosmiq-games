# COSMIQ Piano — Web Prototype

A test of the piano design before the Android (Kotlin + Oboe) module is built: keyboard layout, multi-touch, sound engine behaviour, and audio delay on COSMIQ IFPD panels.

No build step. Open `index.html` in Chrome or Edge, then tap **Tap to start**.

To run it on a panel, copy the `web-prototype` folder to the panel and open `index.html` in its browser. Alternatively, serve the folder from a PC with `python -m http.server 8080` and open `http://<pc-ip>:8080` on the panel. Note that Web MIDI only works over `localhost`/`https` or `file://`.

## What it does

| Area | Behaviour |
|---|---|
| Keyboard | 88 keys with off-centre black keys like a real piano. Shows all 88 or 61/49/37/25 keys fitted to the width, or **real size** (23.5 mm white keys, based on the panel's diagonal). A mini-map strip scrolls the view when not all keys fit. |
| Touch | Each finger is tracked separately, so several players can play at once. Sliding a finger across keys plays each one, including white keys skipped by a fast slide. Optional palm rejection. |
| Velocity | Fixed level, key position (nearer the front edge is louder), contact size, or pressure. The stats line shows what the touch frame actually reports. |
| Sound | Built-in modelled piano: stiff-string overtones, hammer strike position, fast-then-slow decay, two detuned strings, hammer noise. Three loudness layers, one recorded every 3 semitones. Or load **real samples** from an SFZ folder (e.g. the free Salamander Grand Piano). |
| Piano behaviour | 128 notes at once with voice stealing. Re-striking a key chokes its old sound. Sustain pedal (hold or latch). Damper fall time depends on register; the top keys have no dampers. Release samples play when the damper falls. Reverb with extra string resonance while the pedal is down. |
| Extras | Dual keyboards (teacher + student), note labels, record/playback, USB/Bluetooth MIDI (true velocity + CC64 pedal), computer keyboard for desktop testing, fullscreen. |
| Stats line | Notes playing, sample rate, audio delay (`baseLatency` + `outputLatency`), touch-event handling delay, and the last touch's size and pressure. |

## Using real piano samples

1. Download the Salamander Grand Piano in SFZ format and unzip it.
2. Set **Sound → Real samples (SFZ folder)**, then **Choose folder…** and pick the unzipped folder.
3. Pick the `.sfz` file, choose how many **Layers** (loudness levels) to load and the **Max length**, then click **Load**.

Browsers keep decoded audio uncompressed, so 4 layers at 8 s is a sensible limit. The status line shows how much RAM the samples use. The Android engine will read samples from storage as they play, so it can use every layer.

## What to measure on the panel

1. **Audio delay:** read `audio base + output` from the stats line, then add the touch frame's own delay. To measure the whole chain, film a finger tapping a key in slow motion and count the frames between the tap and the sound.
2. **Touch reporting:** check whether the touch size and pressure in the stats line change with how you press. If they stay fixed, use Fixed or Key-position velocity.
3. **Number of touches:** press with as many fingers as possible, with two players at once, and check for stuck notes.
4. **Many notes at once:** hold the pedal and play glissandos, then watch the notes-playing count and listen for crackling.

Browser audio usually has more delay than Oboe on Android. If this prototype feels responsive, the native version will feel better.

## Code layout (mirrors the planned Android module)

```
js/audio/PianoEngine.js   voices, sound zones, pedal, dampers, reverb  → native Oboe engine (C++)
js/audio/SynthBank.js     procedural piano sound                        → built-in fallback sound
js/audio/SfzLoader.js     SFZ parser + sample loading                   → sample loader (Kotlin)
js/NoteRouter.js          one entry point for all note sources          → note router / use-case
js/ui/KeyboardView.js     drawing + multi-touch                         → Compose Canvas keyboard
js/input/MidiInput.js     Web MIDI                                      → android.media.midi
js/Recorder.js            record / playback                             → recorder
js/main.js                wiring + settings (localStorage)              → ViewModel + DataStore + Hilt
```

`window.__engine` and `window.__router` are exposed for debugging in the browser console.
