import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Raycaster, Vector3 } from 'three';
import { createCharacter } from '../dist/character.js';
import { createAccessories } from '../dist/accessories.js';

const draws = values => {
  values = [...values, 0, .9, .9];
  let index = 0;
  return () => {
    assert.ok(index < values.length, 'outfits sample randomness only during creation');
    return values[index++];
  };
};

// Cast inward from outside the outfit. Its visible surface must cover the plush
// with room for the fibers, including between the cardinal axes of each mesh.
function assertCovered(group, point, clearance, label) {
  // Avoid rays lying exactly on the sphere's shared azimuth seam.
  const direction = new Vector3(point.x, 0, point.z).normalize().applyAxisAngle(new Vector3(0, 1, 0), .013).transformDirection(group.matrixWorld);
  const world = group.localToWorld(point.clone());
  const ray = new Raycaster(world.clone().addScaledVector(direction, 2), direction.negate());
  const hit = ray.intersectObject(group, true)[0];
  assert.ok(hit && hit.distance < 2 - clearance, `${label}: plush protrudes at ${point.toArray()}`);
}

test('all hat crowns cover the hood and fleece above their openings, including a tilted head', () => {
  for (const [hat, draw] of [['beanie', .3], ['cap', .6], ['bucket', .9]]) {
    const rig = createCharacter();
    const accessories = createAccessories(rig, { random: draws([draw, 0, .9, .9, 0]) });
    const group = rig.sockets.head.getObjectByName(`accessory-${hat}`);
    const hood = rig.root.getObjectByName('hood-and-body');
    for (const tilt of [0, .35]) {
      rig.head.rotation.set(tilt, tilt / 2, -tilt);
      rig.root.updateMatrixWorld(true); hood.skeleton.update();
      let checked = 0;
      for (let index = 0; index < hood.geometry.getAttribute('position').count; index++) {
        const point = group.worldToLocal(hood.localToWorld(hood.getVertexPosition(index, new Vector3())));
        if (point.y < .025 || Math.hypot(point.x, point.z) < .02) continue;
        assertCovered(group, point, .02, hat); checked++;
      }
      assert.ok(checked > 100, 'sample the entire crown circumference');
    }
    accessories.dispose(); rig.dispose();
  }
});

test('boots cover the broad feet and fleece through leg poses without sinking their soles', () => {
  const rig = createCharacter();
  const accessories = createAccessories(rig, { random: draws([0, 0, .9, 0, 0]) });
  rig.root.updateMatrixWorld(true);
  const left = rig.leftLeg.getObjectByName('accessory-left-boot');
  const right = rig.rightLeg.getObjectByName('accessory-right-boot');
  const leftBounds = new Box3().setFromObject(left), rightBounds = new Box3().setFromObject(right);
  assert.ok(Math.abs(leftBounds.min.y) < .001, 'sole rests at floor height');
  assert.ok(leftBounds.max.x < rightBounds.min.x, 'shoes leave space between the feet');
  for (const [leg, boot] of [[rig.leftLeg, left], [rig.rightLeg, right]]) {
    const foot = leg.children.find(node => node.isMesh);
    for (const tilt of [0, .65]) {
      leg.rotation.set(tilt, .1, -.1);
      rig.root.updateMatrixWorld(true);
      let checked = 0;
      for (let index = 0; index < foot.geometry.getAttribute('position').count; index++) {
        const point = boot.worldToLocal(foot.localToWorld(new Vector3().fromBufferAttribute(foot.geometry.getAttribute('position'), index)));
        if (point.y > -.13 || point.y < -.55 || Math.hypot(point.x, point.z) < .02) continue;
        assertCovered(boot, point, .018, leg.name); checked++;
      }
      assert.ok(checked > 500, 'sample toe, heel and both sides');
    }
  }
  accessories.dispose(); rig.dispose();
});

test('outfits are selected once per load with injectable randomness and at least one wearable', () => {
  const rig = createCharacter();
  const accessories = createAccessories(rig, { random: draws([0, 0, .9, .9, 0]) });
  assert.equal(accessories.selection.hat, 'none');
  assert.equal(accessories.selection.top, 'jacket');
  assert.equal(accessories.selection.neck, 'none');
  assert.equal(accessories.selection.backpack, false);
  assert.equal(accessories.selection.boots, false);
  assert.ok(Object.isFrozen(accessories.selection));
  rig.head.rotation.x = .4;
  rig.resetPose();
  assert.ok(rig.body.getObjectByName('accessory-jacket'));
  accessories.dispose(); rig.dispose();
});

test('each hat and neck variant builds finite geometry without changing the rig', () => {
  const rig = createCharacter();
  for (const [hat, hatDraw] of [['beanie', .3], ['cap', .6], ['bucket', .9]]) {
    for (const [neck, neckDraw] of [['chain', .3], ['tie', .6], ['scarf', .9]]) {
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


test('backpack-free performers get each clothing style and bag straps remain uncovered', () => {
  for (const [top, draw] of [['jacket', 0], ['vest', .4], ['tshirt', .8]]) {
    const rig = createCharacter();
    const outfit = createAccessories(rig, { random: draws([0, 0, .9, .9, .5, draw, .9, .9]) });
    assert.equal(outfit.selection.top, top);
    assert.ok(rig.body.getObjectByName(`accessory-${top}`));
    assert.equal(!!rig.leftArm.getObjectByName('accessory-left-sleeve'), top !== 'vest');
    outfit.dispose();
    const bag = createAccessories(rig, { random: () => .1 });
    assert.equal(bag.selection.top, 'none');
    assert.ok(rig.sockets.back.getObjectByName('accessory-backpack'));
    bag.dispose(); rig.dispose();
  }
});

test('sleeves cover the arm fleece and stay attached through playing poses on both arms', () => {
  for (const top of ['jacket', 'tshirt']) {
    const rig = createCharacter();
    const outfit = createAccessories(rig, { random: () => .9, selection: { top } });
    for (const [arm, name] of [[rig.leftArm, 'left'], [rig.rightArm, 'right']]) {
      const sleeve = arm.getObjectByName(`accessory-${name}-sleeve`);
      const plush = arm.children.find(child => child.isMesh);
      const local = sleeve.position.clone();
      rig.root.updateMatrixWorld(true);
      const before = sleeve.getWorldPosition(new Vector3());
      for (const angle of [0, -.8, 1.2]) {
        arm.rotation.set(angle, angle * .3, -angle * .5);
        arm.scale.setScalar(1.13);
        rig.root.updateMatrixWorld(true);
        let checked = 0;
        for (let i = 0; i < plush.geometry.getAttribute('position').count; i++) {
          const point = sleeve.worldToLocal(plush.localToWorld(new Vector3().fromBufferAttribute(plush.geometry.getAttribute('position'), i)));
          if (point.y < (top === 'jacket' ? -.29 : .10) || point.y > .44) continue;
          assertCovered(sleeve, point, .018, `${top} ${name}`); checked++;
        }
        assert.ok(checked > 150);
        assert.deepEqual(sleeve.position.toArray(), local.toArray());
      }
      assert.ok(sleeve.getWorldPosition(new Vector3()).distanceTo(before) > .2);
    }
    rig.resetPose(); outfit.dispose(); rig.dispose();
  }
});

test('scarves, watches and headphones follow their joints and dispose with clothing', () => {
  const rig = createCharacter();
  const outfit = createAccessories(rig, { random: () => .9, selection: { top: 'vest', neck: 'scarf', watch: true, headphones: true, hat: 'cap' } });
  assert.equal(outfit.selection.hat, 'none', 'headphones leave space over the hood');
  const scarf = rig.body.getObjectByName('accessory-scarf');
  const watch = rig.sockets.leftHand.getObjectByName('accessory-watch');
  const headphones = rig.head.getObjectByName('accessory-headphones');
  assert.ok(scarf && watch && headphones);
  rig.root.updateMatrixWorld(true);
  const before = watch.getWorldPosition(new Vector3());
  rig.leftArm.rotation.x = -1.1;
  rig.head.rotation.z = .3;
  rig.root.updateMatrixWorld(true);
  assert.ok(watch.getWorldPosition(new Vector3()).distanceTo(before) > .5);
  const geometry = new Set(), materials = new Set();
  rig.root.traverse(node => {
    if (!node.name.startsWith('accessory-')) return;
    node.traverse(child => {
      if (!child.isMesh) return;
      for (const value of child.geometry.attributes.position.array) assert.ok(Number.isFinite(value));
      geometry.add(child.geometry); materials.add(child.material);
    });
  });
  let freedGeometry = 0, freedMaterials = 0;
  geometry.forEach(item => item.addEventListener('dispose', () => freedGeometry++));
  materials.forEach(item => item.addEventListener('dispose', () => freedMaterials++));
  outfit.dispose(); outfit.dispose();
  assert.equal(freedGeometry, geometry.size);
  assert.equal(freedMaterials, materials.size);
  assert.equal(watch.parent, null);
  assert.equal(headphones.parent, null);
  assert.equal(scarf.parent, null);
  rig.dispose();
});


test('closed tops cover the torso fleece around the full circumference', () => {
  for (const top of ['jacket', 'tshirt']) {
    const rig = createCharacter();
    const outfit = createAccessories(rig, { random: () => .9, selection: { top } });
    const garment = rig.body.getObjectByName(`accessory-${top}`);
    const hood = rig.root.getObjectByName('hood-and-body');
    rig.root.updateMatrixWorld(true); hood.skeleton.update();
    let checked = 0;
    for (let i = 0; i < hood.geometry.attributes.position.count; i++) {
      const point = hood.getVertexPosition(i, new Vector3());
      if (point.y < .15 || point.y > 1.08) continue;
      assertCovered(garment, point, .018, top); checked++;
    }
    assert.ok(checked > 300);
    outfit.dispose(); rig.dispose();
  }
});
