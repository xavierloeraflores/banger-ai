import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacter } from '../dist/character.js';
import { animateMelodic, createMelodicInstrument } from '../dist/melodic.js';
const note = { beat: 1, playing: true, active: true, energy: .8, age: .01, duration: 1, midi: 60, index: 0 };
function angles(rig) { return [rig.body, rig.head, rig.leftArm, rig.rightArm, rig.leftLeg, rig.rightLeg].flatMap(part => [part.rotation.x, part.rotation.y, part.rotation.z, part.position.y]); }
test('all melodic roles keep finite poses through note attacks, sustains and infinite rests', () => {
  for (const role of ['bass','keys','dance']) {
    const rig = createCharacter(), instrument = createMelodicInstrument(role, rig);
    for (const motion of [note, { ...note, age: .8 }, { ...note, age: Infinity, energy: 0 }, { ...note, playing: false, energy: 1 }]) {
      rig.resetPose(); animateMelodic(role, rig, motion, instrument);
      assert.ok(angles(rig).every(Number.isFinite));
    }
    assert.deepEqual(rig.root.position.toArray(), [0,0,0]);
    assert.equal(rig.sockets.leftHand.children.length, 0);
    rig.dispose();
  }
});
test('note pitch changes fretting and keyboard gestures, attacks decay', () => {
  for (const role of ['bass','keys']) {
    const rig = createCharacter(), instrument = createMelodicInstrument(role, rig);
    animateMelodic(role, rig, note, instrument); const onset = angles(rig);
    rig.resetPose(); animateMelodic(role, rig, { ...note, midi: 84 }, instrument);
    assert.notDeepEqual(angles(rig), onset);
    rig.resetPose(); animateMelodic(role, rig, { ...note, age: .7 }, instrument);
    assert.notDeepEqual(angles(rig), onset);
    rig.dispose();
  }
});
test('stopped performers stay at one resting pose regardless of the clock', () => {
  for (const role of ['bass','keys','dance']) {
    const rig = createCharacter(), instrument = createMelodicInstrument(role, rig);
    animateMelodic(role, rig, { ...note, playing: false }, instrument); const stopped = angles(rig);
    rig.resetPose(); animateMelodic(role, rig, { ...note, playing: false, beat: 23.25, midi: 90 }, instrument);
    assert.ok(angles(rig).every((value, index) => Math.abs(value - stopped[index]) < 1e-10));
    rig.dispose();
  }
});
