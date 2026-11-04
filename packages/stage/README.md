# Band stage

`@banger/stage` renders a `.banger` score as a band of articulated plush characters with Three.js. The studio header's **Band stage** button loads it on demand. The modal shares the studio's Play and Stop transport. Closing it releases its WebGL context and leaves audio playback under the studio transport.

- `createCharacter({ color })` creates the reusable body, head and limb rig. `sockets.leftHand`, `rightHand`, `head` and `back` accept accessories. `resetPose()` restores the limb pivots and `setColor()` recolors the fleece.
- `createAccessories(rig)` chooses an outfit once per performer. Characters without backpacks wear a colored puffer jacket, open vest, or short-sleeve T-shirt. Scarves, watches, and headphones join the hat, chain, tie, and boot variations. Sleeves inherit the arm pivots and stretch, watches follow the hand socket, and headphones follow the head. Headphones leave hats off for clearance. Pass `selection` overrides or an injected `random` function for previews and tests. Dispose accessories before disposing the rig.
- `PerformanceScore.sample({ program, state, fill })` uses the engine's note scheduler for arrangement, patterns, groove, probability, loop conditions and fills. It returns independent onset, velocity, pitch and sustain data for each track. Supply the audible score through `BangerPlayer.performance` so edits queued for the next bar do not animate early.
- `createStage(element, { readPerformance })` owns the scene, camera, rig instances and animation loop. Call `dispose()` when the view is removed. `resetCamera()` smoothly fits the whole band without changing the camera mode. A slow pan and zoom starts on opening, even before playback. `setManualCamera(true)` hands control to the listener at the current viewpoint; `setManualCamera(false)` resumes the tour. Manual mode supports drag to orbit, right-drag or two-finger drag to pan, scroll or pinch to zoom, and zoom buttons through `zoomCamera(factor)`. Still mode and the system reduced-motion preference pause the tour.

Drum tracks play percussion, bass and pluck tracks play a bass guitar, keys/organ/bell tracks play keyboards, and lead/pad tracks dance. Each track keeps its own character even while muted or silent. The character is a procedural interpretation of the supplied front-view reference, using a skinned hood and body, articulated limbs and fleece fibers. It is not a scanned asset.

The stage blends each performer's displayed pose toward its current score pose with time-based damping. Position and scale interpolate linearly, while rotations use quaternion slerp. A fixed target settles 95% in about 165 ms, including when another note interrupts the movement. Drumsticks attach after blending so they stay in the hands. Score sampling, key presses and audio timing remain immediate. New performers and still mode use the target pose directly; long frame gaps have a bounded blend step.

Run `pnpm --filter @banger/stage test` for rig and score tests. After `pnpm fullbuild`, run `pnpm --filter @banger/desktop exec electron scripts/smoke-stage.mjs` for the interactive modal check. Add `--keep-open` to leave the final window open.

## Recorded vocals

`PerformanceSnapshot` accepts optional `vocals` alongside the compiled `.banger`
program. Pass `{ words, positionMs, playing }`, where `words` contains ElevenLabs
`{ word, startMs, endMs }` timestamps from the selected recording. Omitting vocals
keeps the instrumental band. Providing vocals adds a pink singer Muse and a
microphone at the front of the stage. Empty timings keep its mouth closed.

Vocal Studio and Library use the recording's media clock for both the band and
singer. They play the saved recording, with no synthesized beat layered over it.
Word times are absolute milliseconds, including after seeking; they never loop
with the beat. Word envelopes animate the mouth and dancing, with a closed mouth
in gaps, on pause and at the end. Still mode stops both animations.

Native library songs store the selected recording's `audioMetadata` in the
matching `.lyrics.json` file. Browser bundles retain the same document in
`files['lyrics.json']`. This includes `wordsTimestamps` and `waveformVisual` as
well as the lyric plan, so existing library files need no migration. A later lyric
draft does not replace the recorded word timings.
