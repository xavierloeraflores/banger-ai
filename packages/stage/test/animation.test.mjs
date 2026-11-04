import assert from 'node:assert/strict';
import test from 'node:test';
import { Group, Vector3 } from 'three';
import { createCharacter } from '../dist/character.js';
import { createInstrument, animatePerformer, PerformerAnimator } from '../dist/animation.js';
import { PoseSmoother } from '../dist/pose.js';

const note = { beat: 0, playing: true, active: true, energy: 1, age: 0, duration: 1, midi: 63, index: 0 };
const nodes = rig => [rig.body, rig.head, rig.leftArm, rig.rightArm, rig.leftLeg, rig.rightLeg];
const pose = rig => nodes(rig).flatMap(node => [...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray()]);
const close = (a, b, epsilon = 1e-9) => assert.ok(a.every((value, i) => Math.abs(value - b[i]) < epsilon));

test('keyboard register jumps travel through intermediate hand positions and settle', () => {
  const rig = createCharacter(), instrument = createInstrument('keys', rig);
  const animator = new PerformerAnimator('keys', rig, instrument);
  const hand = () => rig.sockets.leftHand.getWorldPosition(new Vector3());
  animator.update(note, 0);
  const start = hand();
  const next = { ...note, midi: 69 };
  rig.resetPose(); animatePerformer('keys', rig, next, instrument);
  const target = hand();
  assert.ok(start.distanceTo(target) > .5, 'fixture crosses the keyboard register');
  animator.update(next, 1 / 60);
  const intermediate = hand();
  assert.ok(intermediate.distanceTo(start) > .01, 'hand starts moving');
  assert.ok(intermediate.distanceTo(start) < start.distanceTo(target) * .4, 'first frame cannot snap across the keyboard');
  assert.ok(intermediate.distanceTo(target) > .2);
  for (let i = 0; i < 30; i++) animator.update(next, 1 / 60);
  assert.ok(hand().distanceTo(target) < .001, 'hand reaches the requested key');
  rig.dispose();
});

test('all roles blend from the displayed pose during interruptions, stops and seeks', () => {
  for (const role of ['keys', 'bass', 'drums', 'dance']) {
    const rig = createCharacter(), instrument = createInstrument(role, rig);
    const animator = new PerformerAnimator(role, rig, instrument);
    animator.update(note, 0);
    for (const motion of [
      { ...note, midi: 69, index: 3, beat: 1 },
      { ...note, midi: 45, index: 2, beat: 1.1 },
      { ...note, playing: false, energy: 0 },
      { ...note, beat: 100, age: .12 },
      { ...note, beat: 0 },
    ]) {
      const previous = pose(rig);
      animator.update(motion, 0);
      close(pose(rig), previous);
      animator.update(motion, 1 / 60);
      assert.ok(pose(rig).every(Number.isFinite));
      assert.ok(pose(rig).some((value, i) => Math.abs(value - previous[i]) > 1e-5));
    }
    const stopped = { ...note, playing: false, energy: 0 };
    for (let i = 0; i < 60; i++) animator.update(stopped, 1 / 60);
    const settled = pose(rig);
    rig.resetPose(); animatePerformer(role, rig, stopped, instrument);
    close(settled, pose(rig), 1e-7);
    rig.dispose();
  }
});

test('damping is frame-rate independent, uses shortest rotations and caps resume jumps', () => {
  function sample(hz) {
    const node = new Group(), smoother = new PoseSmoother([node]);
    node.rotation.y = Math.PI - .1;
    smoother.update(0);
    for (let i = 0; i < hz / 5; i++) {
      node.position.x = 1;
      node.rotation.set(0, -Math.PI + .1, 0);
      node.scale.setScalar(1.13);
      smoother.update(1 / hz);
    }
    assert.ok(node.quaternion.y > .99, 'rotation follows the short arc across the angle wrap');
    return [...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray()];
  }
  // Three.js uses normalized lerp for nearly identical quaternions.
  close(sample(30), sample(60), 1e-6); close(sample(60), sample(120), 1e-6);
  const node = new Group(), smoother = new PoseSmoother([node]);
  smoother.update(0);
  for (const delta of [0, -1, NaN, Infinity]) {
    node.position.x = 1; smoother.update(delta);
    assert.equal(node.position.x, 0);
  }
  node.position.x = 1; smoother.update(10);
  assert.ok(node.position.x > .5 && node.position.x < .65, 'long frame advances a bounded step');
});

test('first pose and still mode are immediate, with independent performer histories', () => {
  const rigs = [createCharacter(), createCharacter()];
  const instruments = rigs.map(rig => createInstrument('keys', rig));
  const animators = rigs.map((rig, i) => new PerformerAnimator('keys', rig, instruments[i]));
  animators[0].update(note, 0);
  animators[0].update({ ...note, midi: 69 }, 1 / 60);
  const displayed = pose(rigs[0]);
  animators[1].update({ ...note, midi: 45 }, 0);
  close(pose(rigs[0]), displayed);
  for (let i = 0; i < 2; i++) {
    const stopped = { ...note, playing: false, energy: 0 };
    animators[i].update(stopped);
    const still = pose(rigs[i]);
    rigs[i].resetPose(); animatePerformer('keys', rigs[i], stopped, instruments[i]);
    close(still, pose(rigs[i]));
    rigs[i].dispose();
  }
});

test('drumsticks stay attached to blended hands even when switching to the cymbal', () => {
  const rig = createCharacter(), instrument = createInstrument('drums', rig);
  const animator = new PerformerAnimator('drums', rig, instrument);
  const anchor = new Group(); anchor.position.set(3, 1, -2); anchor.rotation.y = .4;
  anchor.add(rig.root, instrument);
  animator.update(note, 0);
  const sticks = instrument.children.filter(child => child.name === 'drumstick');
  const hands = [rig.sockets.leftHand, rig.sockets.rightHand];
  for (let frame = 0; frame < 30; frame++) {
    animator.update({ ...note, index: frame % 4, age: .08, beat: frame / 10 }, 1 / 60);
    anchor.updateWorldMatrix(true, true);
    sticks.forEach((stick, i) => {
      const base = stick.localToWorld(new Vector3(0, -.5, 0));
      assert.ok(base.distanceTo(hands[i].getWorldPosition(new Vector3())) < 1e-9);
    });
  }
  rig.dispose();
});
