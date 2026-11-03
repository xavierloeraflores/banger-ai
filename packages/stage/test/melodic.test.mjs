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
test('rests keep instrument-specific movement and the same beat reproduces the same pose', () => {
  const poses = [];
  for (const role of ['bass', 'keys', 'dance']) {
    const rig = createCharacter(), instrument = createMelodicInstrument(role, rig);
    const rest = { ...note, active: false, energy: 0, age: Infinity, beat: .25 };
    rig.resetPose(); animateMelodic(role, rig, rest, instrument); const first = angles(rig);
    rig.resetPose(); animateMelodic(role, rig, { ...rest, beat: 1.5 }, instrument);
    assert.ok(angles(rig).some((angle, i) => Math.abs(angle - first[i]) > .03), `${role} moves between notes`);
    rig.resetPose(); animateMelodic(role, rig, rest, instrument);
    assert.deepEqual(angles(rig), first, `${role} reproduces poses after a seek`);
    poses.push(first);
    rig.dispose();
  }
  assert.notDeepEqual(poses[0], poses[1]);
  assert.notDeepEqual(poses[1], poses[2]);
});
test('keyboard depresses the key under the alternating playing paw and releases on stop', async () => {
  const { Vector3 } = await import('three');
  const rig = createCharacter(), instrument = createMelodicInstrument('keys', rig);
  for (const index of [0, 1]) {
    rig.resetPose(); animateMelodic('keys', rig, { ...note, beat: 0, age: 0, energy: 1, midi: 60, index }, instrument);
    const keyboard = instrument.getObjectByName('keyboard');
    const depressed = keyboard.children.filter(key => key.name.startsWith('key-') && key.position.y < .097);
    assert.equal(depressed.length, 1);
    const paw = index === 0 ? rig.sockets.leftHand : rig.sockets.rightHand;
    rig.root.updateMatrixWorld(true); instrument.updateMatrixWorld(true);
    const handPosition = paw.getWorldPosition(new Vector3());
    const keyPosition = depressed[0].getWorldPosition(new Vector3());
    assert.ok(Math.abs(handPosition.x - keyPosition.x) < .08, 'playing paw follows the key register');
    assert.ok(handPosition.distanceTo(keyPosition) < .16, 'paw reaches the key');
  }
  rig.resetPose(); animateMelodic('keys', rig, { ...note, playing: false }, instrument);
  assert.ok(instrument.getObjectByName('keyboard').children.filter(key => key.name.startsWith('key-')).every(key => key.position.y === .097));
  rig.dispose();
});
