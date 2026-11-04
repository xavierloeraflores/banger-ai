import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { createScenery } from '../dist/scenery.js';

const quiet = { kick: 0, snare: 0, chord: 0, chorus: false };
const targets = [new Vector3(-2, 1, 2), new Vector3(2, 1, -2)];
function setup(t) {
  const scenery = createScenery();
  scenery.layout(targets);
  t.after(() => {
    scenery.dispose();
    const materials = new Set();
    scenery.root.traverse(object => {
      object.geometry?.dispose();
      if (object.material) materials.add(object.material);
    });
    materials.forEach(material => material.dispose());
  });
  return scenery;
}
const lights = scenery => scenery.root.children.filter(object => object.isSpotLight);
const poses = scenery => lights(scenery).map(light => [
  light.color.toArray(), light.target.position.toArray(), light.angle, light.intensity,
]);

test('overhead and floor lights change color, aim and beam width during ordinary playback', t => {
  const scenery = setup(t);
  assert.equal(lights(scenery).filter(light => light.name.startsWith('overhead')).length, 4);
  assert.equal(lights(scenery).filter(light => light.name.startsWith('floor')).length, 2);
  scenery.update(0, quiet, targets);
  const before = poses(scenery);
  scenery.update(2, quiet, targets);
  poses(scenery).forEach((pose, index) => {
    assert.notDeepEqual(pose[0], before[index][0], 'color changes without a chorus or drum hit');
    assert.notDeepEqual(pose[1], before[index][1], 'each head sweeps');
    assert.notEqual(pose[2], before[index][2], 'beam aperture changes');
  });
});

test('visible cones, lenses and fixtures follow the actual spotlight at every angle', t => {
  const scenery = setup(t);
  for (const time of [0, 1, 12, 120]) {
    scenery.update(time, { kick: .7, snare: .8, chord: .6, chorus: true }, targets);
    lights(scenery).forEach((light, index) => {
      const beam = scenery.root.getObjectByName(`beam-${index}`);
      const fixture = scenery.root.getObjectByName(`fixture-${index}`);
      const direction = light.target.position.clone().sub(light.position);
      assert.ok(new Vector3(0, -1, 0).applyQuaternion(beam.quaternion).distanceTo(direction.clone().normalize()) < 1e-10);
      assert.ok(beam.position.distanceTo(light.position) < 1e-10);
      assert.ok(Math.abs(beam.scale.y - direction.length()) < 1e-10);
      assert.ok(Math.abs(beam.scale.x / beam.scale.y - Math.tan(light.angle)) < 1e-10);
      assert.deepEqual(fixture.quaternion.toArray(), beam.quaternion.toArray());
      assert.deepEqual(beam.material.uniforms.color.value, light.color);
      assert.deepEqual(fixture.children[1].material.emissive, light.color);
      if (light.name.startsWith('floor')) assert.ok(direction.y > 0, 'floor beams point upward');
      else assert.ok(direction.y < 0, 'overhead beams point downward');
    });
  }
});

test('a held playback clock freezes the lights and still mode returns to a stable pose', t => {
  const scenery = setup(t);
  scenery.update(4, quiet, targets);
  const held = poses(scenery);
  for (let i = 0; i < 10; i++) scenery.update(4, quiet, targets);
  assert.deepEqual(poses(scenery), held);
  scenery.update(0, quiet, targets);
  const still = poses(scenery);
  scenery.update(20, { kick: 1, snare: 1, chord: 1, chorus: true }, targets);
  scenery.update(0, quiet, targets);
  assert.deepEqual(poses(scenery), still);
});

test('empty and crowded stages keep finite light geometry with restrained beam widths', t => {
  const scenery = setup(t);
  for (const positions of [[], Array.from({ length: 32 }, (_, i) => new Vector3(i % 5 * 3.35 - 7, 0, Math.floor(i / 5) * 3.6))]) {
    scenery.layout(positions);
    scenery.update(8, quiet, positions);
    lights(scenery).forEach((light, index) => {
      const beam = scenery.root.getObjectByName(`beam-${index}`);
      assert.ok([...beam.scale.toArray(), ...beam.quaternion.toArray()].every(Number.isFinite));
      assert.ok(light.angle > .1 && light.angle < .5);
    });
  }
});
