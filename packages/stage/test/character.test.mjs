import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { createCharacter } from '../dist/character.js';

test('plush proportions, face direction and accessory attachment points', () => {
  const rig = createCharacter();
  const bounds = new Box3().setFromObject(rig.root);
  assert.ok(bounds.min.y >= -.025 && bounds.min.y <= .01);
  assert.ok(bounds.max.y > 2.6 && bounds.max.y < 2.8);
  assert.ok(bounds.max.x - bounds.min.x > 1.9);
  const face = rig.root.getObjectByName('face');
  assert.ok(face.getWorldPosition(new Vector3()).z > .4);
  face.geometry.computeBoundingBox();
  const faceSize = face.geometry.boundingBox.getSize(new Vector3());
  assert.ok(faceSize.x > 1 && faceSize.y > .75, 'the broad face fills the hood');
  assert.ok(faceSize.z > .15, 'face wraps into the sides of the hood');
  for (const node of Object.values(rig.sockets)) assert.ok(node.parent);
  rig.root.updateMatrixWorld(true);
  const hand = rig.sockets.rightHand.getWorldPosition(new Vector3());
  rig.rightArm.rotation.x = -1;
  rig.root.updateMatrixWorld(true);
  assert.ok(rig.sockets.rightHand.getWorldPosition(new Vector3()).z > hand.z + .5);
  rig.dispose();
});

test('reset returns animated joints to rest without moving the stage placement', () => {
  const rig = createCharacter();
  rig.root.position.set(4, 0, -2);
  const position = rig.body.position.clone();
  rig.body.position.y += 1;
  rig.head.rotation.z = .5;
  rig.leftLeg.scale.setScalar(2);
  rig.resetPose();
  assert.deepEqual(rig.body.position.toArray(), position.toArray());
  assert.ok(Math.abs(rig.head.rotation.z) < 1e-10);
  assert.deepEqual(rig.leftLeg.scale.toArray(), [1, 1, 1]);
  assert.deepEqual(rig.root.position.toArray(), [4, 0, -2]);
  rig.dispose();
});

test('color variants preserve the shared face and all geometry is finite', () => {
  const rig = createCharacter({ color: '#bbccdd' });
  const faceColor = rig.root.getObjectByName('face').material.color.getHex();
  rig.setColor('#99bb88');
  assert.equal(rig.root.getObjectByName('face').material.color.getHex(), faceColor);
  rig.root.traverse(node => {
    if (!node.isMesh) return;
    for (const value of node.geometry.getAttribute('position').array) assert.ok(Number.isFinite(value));
  });
  let textureDisposals = 0;
  rig.root.getObjectByName('hood-and-body').material.map.addEventListener('dispose', () => textureDisposals++);
  rig.dispose();
  rig.dispose();
  assert.equal(textureDisposals, 1);
});


test('continuous hood skin follows the head pivot without moving the lower torso', () => {
  const rig = createCharacter();
  const shell = rig.root.getObjectByName('hood-and-body');
  const positions = shell.geometry.getAttribute('position');
  let top = 0, bottom = 0;
  for (let i = 1; i < positions.count; i++) {
    if (positions.getY(i) > positions.getY(top)) top = i;
    if (positions.getY(i) < positions.getY(bottom)) bottom = i;
  }
  rig.root.updateMatrixWorld(true); shell.skeleton.update();
  const oldTop = shell.getVertexPosition(top, new Vector3());
  const oldBottom = shell.getVertexPosition(bottom, new Vector3());
  rig.head.rotation.z = .3;
  rig.root.updateMatrixWorld(true); shell.skeleton.update();
  assert.ok(shell.getVertexPosition(top, new Vector3()).distanceTo(oldTop) > .2);
  assert.ok(shell.getVertexPosition(bottom, new Vector3()).distanceTo(oldBottom) < 1e-6);
  rig.dispose();
});
