import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { StageCamera } from '../dist/camera.js';

function rig(reducedMotion = false) {
  const controller = new StageCamera(new PerspectiveCamera(38, 1.5, .1, 250), reducedMotion);
  controller.frame(new Vector3(0, 1.8, 0), 20, .19);
  return controller;
}
function advance(controller, seconds, fps = 60) {
  for (let i = 0; i < seconds * fps; i++) controller.update(1 / fps);
}

test('automatic tour pans and zooms without a playback clock, with bounded continuous motion', () => {
  const controller = rig();
  const start = controller.camera.position.clone();
  let min = Infinity, max = 0;
  for (let i = 0; i < 60 * 120; i++) {
    const previous = controller.camera.position.clone();
    controller.update(1 / 60);
    assert.ok(previous.distanceTo(controller.camera.position) < .03, 'no frame jumps');
    const distance = controller.camera.position.distanceTo(controller.target);
    min = Math.min(min, distance); max = Math.max(max, distance);
  }
  assert.ok(controller.camera.position.distanceTo(start) > 1);
  assert.ok(max - min > 2, 'gradual dolly in and out');
  assert.ok(min > 19.9 && max < 22.5, 'tour stays near the fitted view');
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
  assert.ok(controller.camera.position.distanceTo(manualPosition) > 5);
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
  assert.ok(slow.camera.position.distanceTo(fast.camera.position) < .02);
  const before = fast.camera.position.clone(); fast.update(300);
  assert.ok(fast.camera.position.distanceTo(before) < .1);
});
