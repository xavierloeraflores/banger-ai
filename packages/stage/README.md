# Band stage

`@banger/stage` renders a `.banger` score as a band of articulated plush characters with Three.js. The studio header's **Band stage** button loads it on demand. The modal shares the studio's Play and Stop transport. Closing it releases its WebGL context and leaves audio playback under the studio transport.

- `createCharacter({ color })` creates the reusable body, head and limb rig. `sockets.leftHand`, `rightHand`, `head` and `back` accept accessories. `resetPose()` restores the limb pivots and `setColor()` recolors the fleece.
- `PerformanceScore.sample({ program, state, fill })` uses the engine's note scheduler for arrangement, patterns, groove, probability, loop conditions and fills. It returns independent onset, velocity, pitch and sustain data for each track. Supply the audible score through `BangerPlayer.performance` so edits queued for the next bar do not animate early.
- `createStage(element, { readPerformance })` owns the scene, camera, rig instances and animation loop. Call `dispose()` when the view is removed. `resetCamera()` smoothly fits the whole band without changing the camera mode. A slow pan and zoom starts on opening, even before playback. `setManualCamera(true)` hands control to the listener at the current viewpoint; `setManualCamera(false)` resumes the tour. Manual mode supports drag to orbit, right-drag or two-finger drag to pan, scroll or pinch to zoom, and zoom buttons through `zoomCamera(factor)`. Still mode and the system reduced-motion preference pause the tour.

Drum tracks play percussion, bass and pluck tracks play a bass guitar, keys/organ/bell tracks play keyboards, and lead/pad tracks dance. Each track keeps its own character even while muted or silent. The character is a procedural interpretation of the supplied front-view reference, using a skinned hood and body, articulated limbs and fleece fibers. It is not a scanned asset.

Run `pnpm --filter @banger/stage test` for rig and score tests. After `pnpm fullbuild`, run `pnpm --filter @banger/desktop exec electron scripts/smoke-stage.mjs` for the interactive modal check. Add `--keep-open` to leave the final window open.
