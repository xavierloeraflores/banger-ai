import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacter } from '../dist/character.js';
import { VocalScore, SingerAnimator, createMicrophone } from '../dist/vocal.js';

const words = [{ word: 'Hello', startMs: 1000, endMs: 1600 }, { word: 'home', startMs: 3000, endMs: 4200 }];
const vocals = (positionMs, playing = true) => ({ words, positionMs, playing });
test('recorded words govern mouth motion through silence, seeks, pause and end without looping', () => {
  const score = new VocalScore();
  for (const time of [0, 999, 1600, 2500, 4200, 60000]) assert.deepEqual(score.sample(vocals(time)), { active: false, mouth: 0 });
  for (const time of [1200, 3500, 1100]) { const motion = score.sample(vocals(time)); assert.equal(motion.active, true); assert.ok(motion.mouth > .3 && motion.mouth <= 1); }
  assert.equal(score.sample(vocals(1200, false)).mouth, 0);
  assert.equal(score.sample({ words: [], positionMs: 1200, playing: true }).active, false);
  assert.equal(score.sample().active, false);
});
test('timing validation rejects invalid words, preserves overlaps and accepts unsorted input', () => {
  const score = new VocalScore();
  const source = [{ word: 'held', startMs: 0, endMs: 5000 }, ...words.slice().reverse(), { word: ' ', startMs: 0, endMs: 10000 }, { word: 'bad', startMs: NaN, endMs: 10000 }, { word: 'reverse', startMs: 1000, endMs: 0 }];
  assert.equal(score.sample({ words: source, positionMs: 2500, playing: true }).active, true);
  assert.equal(score.sample({ words: source, positionMs: 5500, playing: true }).active, false);
});
test('singer dances at recorded words, closes mouth on pause and stays still in reduced motion', () => {
  const rig = createCharacter(), animator = new SingerAnimator(rig);
  const smile = rig.root.getObjectByName('smile'), mouth = rig.root.getObjectByName('singing-mouth');
  animator.update(vocals(1200), 120);
  assert.equal(mouth.visible, true); assert.equal(smile.visible, false);
  assert.notEqual(rig.body.position.x, 0);
  animator.update(vocals(1200, false), 120);
  assert.equal(mouth.visible, false); assert.equal(smile.visible, true);
  assert.equal(rig.body.position.x, 0);
  animator.update(vocals(1200), 120, true);
  assert.equal(mouth.visible, false); assert.equal(rig.body.position.x, 0);
  const microphone = createMicrophone();
  assert.equal(microphone.children.length, 4);
  assert.ok(microphone.children.every(part => part.position.z > .5));
  rig.dispose();
  microphone.traverse(node => { node.geometry?.dispose(); node.material?.dispose(); });
});
