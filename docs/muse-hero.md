# Muse Hero

Open a `.banger` project, apply any source edits, then choose **Band stage** in
the studio header. Click the floating **Muse Hero** button to show the game
overlay. Tap or keyboard activation also opens it. The game fills
the window and renders a transparent note highway and translucent HUD over the live Three.js band.

Choose the full band or a single track for the chart. The full song still plays
when a single track is selected. Tap **A S D F G**, or the five on-screen frets,
when a note reaches the hit line. Hold sustained notes until the tail ends.
There is no separate strum key. A three-second countdown precedes playback.

Perfect hits are within 55 ms, Great within 110 ms, and Good within 180 ms.
Ten consecutive hits increase the multiplier, up to 4×. Missing a note,
pressing an empty fret, or releasing a hold early breaks the streak. Completed
holds award bonus points. Practice autoplay plays the chart for you and is
marked as practice. Scores are local to the current run and are not saved.

The chart uses the audio engine's arrangement, groove, probability and
conditional events. Muted and non-solo tracks do not contribute notes. Nearby
notes sharing a fret merge, and overlapping holds on one fret are shortened
to keep the chart playable. Short patterns repeat for at least four bars;
longer arrangements play once. Runs finish automatically. **End run** stops
early, and **Play again** restarts from the beginning. Leaving the window ends
an active run. **Back to band** or Escape hides the game and stops game audio.
A second Escape closes the stage and returns to the studio.

The game and band share the studio audio player and one WebGL scene. Starting
a run clears any section preview. Input, notes and band animation read the
same audio clock. Hiding the overlay removes its animation frame and input
listeners while keeping the stage and camera intact. Closing the stage disposes
the WebGL scene.

After `pnpm fullbuild`, run:

```sh
pnpm --filter @banger/desktop exec electron scripts/smoke-muse-hero.mjs
```

Add `--keep-open` to leave the sample song open in Muse Hero after the checks.
Screenshots are written to `/tmp/muse-hero-desktop.png` and
`/tmp/muse-hero-mobile.png`. Chart and scoring tests run in the web suite.
