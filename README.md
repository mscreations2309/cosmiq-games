# COSMIQ Classroom Games

Touch and camera-controlled games and a full 88-key piano, built for classroom interactive flat panels (IFPD).

**Play online:** https://<username>.github.io/cosmiq-games/

## What's inside

| Folder | Contents |
|---|---|
| `games/` | 12 games (Air Hockey, Table Tennis, Whack-a-Mole, Fruit Slice, Balloon Maths, Memory Match, Tic-Tac-Toe, Connect Four, Jigsaw, Quiz Show, Draw & Guess, Maze Runner) and the home page |
| `web-prototype/` | 88-key piano with built-in piano sound, songs to play or learn (Twinkle Twinkle Little Star and more), recording and MIDI |
| `games/shared/` | Shared toolkit, the Touch / Camera chooser, and hand tracking (MediaPipe, bundled for offline use) |
| `android-app/` | Android WebView app that bundles everything for offline use on the panel |
| `Start COSMIQ Games.bat` | Runs the games from this folder on a Windows PC |

## Controls

On launch, choose **Touch** or **Camera**.

- **Touch:** play with your fingers.
- **Camera:** hold up a hand, then pinch your thumb and index finger to tap, and keep pinching to drag.

Camera mode needs a secure page. That means this GitHub Pages site, the Android app, or `http://localhost`.

## Running

- **Online:** open the address above in Chrome or Edge on any device.
- **Windows PC:** double-click `Start COSMIQ Games.bat`.
- **Android / IFPD (offline):** build with `cd android-app && gradlew assembleDebug`, then install `app/build/outputs/apk/debug/app-debug.apk`.

## Third-party

Hand tracking uses MediaPipe Tasks Vision and the Hand Landmarker model by Google, under the Apache License 2.0. See `games/shared/vendor/mediapipe/NOTICE.txt`.
