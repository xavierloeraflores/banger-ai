import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { StageCamera } from '../dist/camera.js';

function randomGenerator(seed = 14) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
function rig(reducedMotion = false, random = randomGenerator()) {
  const controller = new StageCamera(new PerspectiveCamera(38, 1.5, .1, 250), reducedMotion, random);
  controller.frame(new Vector3(0, 1.8, 0), 20, .19, [new Vector3(-3, 1.6, 2), new Vector3(3, 2.7, -3)]);
  return controller;
}
function advance(controller, seconds, fps = 60) {
  for (let i = 0; i < seconds * fps; i++) controller.update(1 / fps);
}

test('automatic shots cut at varied 2–10 second intervals and move within each shot', () => {
  const controller = rig();
  const seen = new Set([controller.shotName]);
  const durations = [];
  let lastCut = 0, movingFrames = 0;
  for (let i = 1; i <= 60 * 120; i++) {
    const previous = controller.camera.position.clone();
    const shot = controller.shotName;
    controller.update(1 / 60);
    const travel = previous.distanceTo(controller.camera.position);
    if (shot !== controller.shotName) {
      durations.push(i / 60 - lastCut);
      lastCut = i / 60;
      assert.ok(travel > 1, 'shot change is a hard cut');
      assert.ok(controller.camera.position.distanceTo(controller.input.position) < 1e-10);
      seen.add(controller.shotName);
    } else {
      assert.ok(travel < .15, 'continuous motion within a shot');
      if (travel > .001) movingFrames++;
    }
  }
  assert.deepEqual([...seen].sort(), ['close', 'orbit', 'overhead', 'wide']);
  assert.ok(durations.every(duration => duration >= 2 - 1 / 60 && duration <= 10 + 1 / 60));
  assert.ok(Math.max(...durations) - Math.min(...durations) > 4, 'intervals vary');
  assert.ok(movingFrames > 600);
});

test('close-ups and orbits focus on a performer; overhead shots look down on the stage', () => {
  const controller = rig();
  const subjects = [new Vector3(-3, 1.6, 2), new Vector3(3, 2.7, -3)];
  const seen = new Set();
  for (let i = 0; i < 60 * 40; i++) {
    controller.update(1 / 60);
    const offset = controller.input.position.clone().sub(controller.target);
    if (['close', 'orbit'].includes(controller.shotName)) {
      assert.ok(subjects.some(subject => subject.distanceTo(controller.target) < 1e-10));
      assert.ok(offset.length() < 8, 'closer than the fitted wide shot');
      assert.ok(offset.z > 0, 'stays in front of the subject');
    }
    if (controller.shotName === 'overhead') assert.ok(offset.y / offset.length() > .8);
    seen.add(controller.shotName);
  }
  assert.equal(seen.size, 4);
});

test('manual takeover preserves the visible pose and stops automatic travel', () => {
  const controller = rig(); advance(controller, 6);
  const position = controller.camera.position.clone();
  const rotation = controller.camera.quaternion.clone();
  controller.setManual(true); advance(controller, 5);
  assert.ok(controller.camera.position.distanceTo(position) < 1e-10);
  assert.ok(controller.camera.quaternion.angleTo(rotation) < 1e-7);
  controller.zoom(.5, 4, 140);
  assert.deepEqual(controller.camera.position, position, 'zoom starts without a jump');
  advance(controller, 2);
  assert.ok(controller.camera.position.distanceTo(controller.target) < 12);
  const manualPosition = controller.camera.position.clone();
  controller.setManual(false);
  assert.deepEqual(controller.camera.position, manualPosition, 'resuming auto does not snap');
  advance(controller, 5);
  assert.ok(controller.camera.position.distanceTo(manualPosition) > 1);
});

test('manual zoom is bounded and ignored in auto; reset retains the selected mode', () => {
  const controller = rig(); const start = controller.input.position.clone();
  controller.zoom(.1, 4, 140); assert.deepEqual(controller.input.position, start);
  controller.setManual(true);
  controller.zoom(.001, 4, 140); assert.ok(Math.abs(controller.input.position.distanceTo(controller.target) - 4) < 1e-10);
  controller.zoom(1000, 4, 140); assert.ok(Math.abs(controller.input.position.distanceTo(controller.target) - 140) < 1e-10);
  controller.reset(); advance(controller, 3);
  assert.equal(controller.manual, true);
  assert.ok(Math.abs(controller.camera.position.distanceTo(controller.target) - 20) < 1e-8);
});

test('still mode freezes the tour and remains manually usable', () => {
  const controller = rig(true); const start = controller.camera.position.clone();
  advance(controller, 60); assert.deepEqual(controller.camera.position, start);
  controller.setManual(true); controller.zoom(.8, 4, 140); controller.update(1 / 60);
  assert.ok(Math.abs(controller.camera.position.distanceTo(controller.target) - 16) < 1e-10);
});

test('tour speed is stable across frame rates and caps background gaps', () => {
  const slow = rig(), fast = rig(); advance(slow, 10, 30); advance(fast, 10, 120);
  assert.equal(slow.shotName, fast.shotName);
  assert.ok(slow.camera.position.distanceTo(fast.camera.position) < .03);
  const before = fast.camera.position.clone(); fast.update(300);
  assert.ok(fast.camera.position.distanceTo(before) < .1);
});

test('minimum and maximum intervals, empty casts and resized casts remain usable', () => {
  for (const random of [() => 0, () => .999999]) {
    const controller = rig(false, random);
    const interval = random() === 0 ? 2 : 10;
    advance(controller, interval - .1);
    assert.equal(controller.shotName, 'wide');
    advance(controller, .1);
    assert.notEqual(controller.shotName, 'wide');
    controller.camera.aspect = .5;
    controller.frame(new Vector3(0, 1.8, 0), 30, .32, [new Vector3(0, 1.6, 2)]);
    advance(controller, 12);
    assert.ok(controller.camera.position.toArray().every(Number.isFinite));
    controller.frame(new Vector3(0, 1.8, 0), 10, .19);
    advance(controller, 30);
    assert.ok(controller.camera.position.toArray().every(Number.isFinite));
  }
});
