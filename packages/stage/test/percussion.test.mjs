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
  const snapshot = () => [rig.body.position.y, rig.head.rotation.x, rig.leftArm.rotation.x, rig.rightArm.rotation.x, ...instrument.children.flatMap(child => [...child.position.toArray(), ...child.quaternion.toArray(), ...child.scale.toArray()])];
  rig.resetPose(); animatePercussion(rig, rest, instrument); const initial = snapshot();
  rig.resetPose(); animatePercussion(rig, { ...rest, beat: 100, age: Infinity, energy: 1, index: 3, midi: 84 }, instrument);
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
test('silent bars keep sticks ready, and attacks rebound above the drum', () => {
  const rig = createCharacter(), instrument = createPercussion(rig);
  const sticks = instrument.children.filter(child => child.name === 'drumstick');
  const pose = (beat, energy, age) => {
    rig.resetPose(); animatePercussion(rig, { ...rest, playing: true, beat, energy, age }, instrument);
    return { arm: rig.leftArm.rotation.x, stickY: sticks[0].position.y };
  };
  const idle = pose(.25, 0, Infinity), laterIdle = pose(1.5, 0, Infinity);
  assert.ok(Math.abs(idle.arm - laterIdle.arm) > .03, 'drummer rolls the wrists while waiting');
  const hit = pose(0, 1, 0), rebound = pose(.28, 1, .14);
  assert.ok(hit.arm - rebound.arm > .8, 'stick stroke reads as a full arm movement');
  assert.ok(rebound.stickY - hit.stickY > .25, 'stick visibly clears the drum after impact');
  assert.deepEqual(pose(.25, 0, Infinity), idle, 'seeking restores the idle pose');
  rig.dispose();
});
