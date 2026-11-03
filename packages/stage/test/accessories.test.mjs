import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createCharacter } from '../dist/character.js';
import { createAccessories } from '../dist/accessories.js';

const draws = values => {
  let index = 0;
  return () => {
    assert.ok(index < values.length, 'outfits sample randomness only during creation');
    return values[index++];
  };
};

test('outfits are selected once per load with injectable randomness and at least one wearable', () => {
  const rig = createCharacter();
  const accessories = createAccessories(rig, { random: draws([0, 0, .9, .9, 0]) });
  assert.equal(accessories.selection.hat, 'beanie');
  assert.equal(accessories.selection.neck, 'none');
  assert.equal(accessories.selection.backpack, false);
  assert.equal(accessories.selection.boots, false);
  assert.ok(Object.isFrozen(accessories.selection));
  rig.head.rotation.x = .4;
  rig.resetPose();
  assert.ok(rig.sockets.head.getObjectByName('accessory-beanie'));
  accessories.dispose(); rig.dispose();
});

test('each hat and neck variant builds finite geometry without changing the rig', () => {
  const rig = createCharacter();
  for (const [hat, hatDraw] of [['beanie', .3], ['cap', .6], ['bucket', .9]]) {
    for (const [neck, neckDraw] of [['chain', .5], ['tie', .9]]) {
      const accessories = createAccessories(rig, { random: draws([hatDraw, neckDraw, 0, 0, .5]) });
      assert.equal(accessories.selection.hat, hat);
      assert.equal(accessories.selection.neck, neck);
      assert.ok(rig.sockets.head.getObjectByName(`accessory-${hat}`));
      assert.ok(rig.body.getObjectByName(`accessory-${neck}`));
      assert.ok(rig.sockets.back.getObjectByName('accessory-backpack'));
      assert.ok(rig.leftLeg.getObjectByName('accessory-left-boot'));
      assert.ok(rig.rightLeg.getObjectByName('accessory-right-boot'));
      rig.root.traverse(node => {
        if (!node.isMesh) return;
        for (const value of node.geometry.getAttribute('position').array) assert.ok(Number.isFinite(value));
      });
      accessories.dispose();
      assert.ok(rig.root.getObjectByName('hood-and-body'));
      assert.equal(rig.root.getObjectByName('accessory-backpack'), undefined);
    }
  }
  rig.dispose();
});

test('head, body and leg wearables follow their animated joints and release their own resources once', () => {
  const rig = createCharacter();
  const accessories = createAccessories(rig, { random: draws([.6, .5, 0, 0, 0]) });
  const hat = rig.sockets.head.getObjectByName('accessory-cap');
  const boot = rig.leftLeg.getObjectByName('accessory-left-boot');
  rig.root.updateMatrixWorld(true);
  const beforeHat = hat.getWorldPosition(new Vector3());
  const beforeBoot = boot.children[0].getWorldPosition(new Vector3());
  rig.head.rotation.z = .5;
  rig.leftLeg.rotation.x = .8;
  rig.root.updateMatrixWorld(true);
  assert.ok(hat.getWorldPosition(new Vector3()).distanceTo(beforeHat) > .2);
  assert.ok(boot.children[0].getWorldPosition(new Vector3()).distanceTo(beforeBoot) > .2);
  const geometries = new Set(), materials = new Set();
  rig.root.traverse(node => {
    if (!node.name.startsWith('accessory-')) return;
    node.traverse(child => {
      if (!child.isMesh) return;
      geometries.add(child.geometry); materials.add(child.material);
    });
  });
  let geometryDisposals = 0, materialDisposals = 0, bodyDisposals = 0;
  geometries.forEach(item => item.addEventListener('dispose', () => geometryDisposals++));
  materials.forEach(item => item.addEventListener('dispose', () => materialDisposals++));
  rig.root.getObjectByName('hood-and-body').geometry.addEventListener('dispose', () => bodyDisposals++);
  accessories.dispose(); accessories.dispose();
  assert.equal(geometryDisposals, geometries.size);
  assert.equal(materialDisposals, materials.size);
  assert.equal(bodyDisposals, 0);
  assert.equal(hat.parent, null);
  assert.equal(boot.parent, null);
  rig.dispose();
});
