import assert from 'node:assert/strict';
import test from 'node:test';
import { createCharacter } from '../dist/character.js';
import { createPercussion, animatePercussion } from '../dist/percussion.js';
const rest = { beat: 0, playing: false, active: false, energy: 0, age: Infinity, duration: 0, midi: 60, index: 0 };
test('drummer follows alternating note strikes and velocity', () => {
  const rig = createCharacter(), instrument = createPercussion(rig);
  const pose = (index, energy) => {
    rig.resetPose(); animatePercussion(rig, { ...rest, playing: true, active: true, age: 0, energy, index }, instrument);
    return [rig.leftArm.rotation.x, rig.rightArm.rotation.x];
  };
  const left = pose(0, 1), right = pose(1, 1), soft = pose(0, .2);
  assert.ok(left[0] > left[1]); assert.ok(right[1] > right[0]);
  assert.ok(left[0] > soft[0]);
  rig.dispose();
});
test('stopped drummer is stationary regardless of song position', () => {
  const rig = createCharacter(), instrument = createPercussion(rig);
  const snapshot = () => [rig.body.position.y, rig.head.rotation.x, rig.leftArm.rotation.x, rig.rightArm.rotation.x, ...instrument.children.flatMap(child => child.position.toArray())];
  rig.resetPose(); animatePercussion(rig, rest, instrument); const initial = snapshot();
  rig.resetPose(); animatePercussion(rig, { ...rest, beat: 100, age: Infinity, energy: 1 }, instrument);
  assert.deepEqual(snapshot(), initial);
  rig.dispose();
});
test('percussion poses and sticks remain finite through rests and repeated notes', () => {
  const rig = createCharacter(), instrument = createPercussion(rig);
  for (const age of [0, .01, .08, .18, 2, Infinity]) {
    rig.resetPose(); animatePercussion(rig, { ...rest, playing: true, energy: .8, age }, instrument);
    for (const group of [rig.root, instrument]) group.traverse(node => {
      assert.ok([...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray()].every(Number.isFinite));
    });
  }
  assert.equal(rig.sockets.leftHand.children.length, 0, 'props stay owned by instrument');
  rig.dispose();
});
