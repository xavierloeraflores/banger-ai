import assert from 'node:assert/strict';
import test from 'node:test';
import { Group, Mesh, Vector3 } from 'three';
import { FACTORY_PATCHES, INSTRUMENT_PATCHES, compileMusic } from '@banger/compiler';
import { createCharacter } from '../dist/character.js';
import { createInstrument, animatePerformer, PerformerAnimator } from '../dist/animation.js';
import { PerformanceScore, trackRole } from '../dist/score.js';
import { concertLayout } from '../dist/concert.js';

const roles = ['brass', 'flute', 'chiptune', 'strings', 'kalimba', 'riser', 'bass808', 'marimba', 'woodblock', 'downlifter', 'impact', 'mutedGuitar'];
const names = ['Synth Brass', 'Flute Lead', 'Chiptune Lead', 'String Ensemble', 'Kalimba Pluck', 'Noise Riser', ...Object.values(INSTRUMENT_PATCHES).map(patch => patch.name)];
const patch = name => structuredClone([...FACTORY_PATCHES, ...Object.values(INSTRUMENT_PATCHES)].find(patch => patch.name === name).config);
const fixture = name => {
  const program = compileMusic('tempo 120; track misleading_name { instrument "synth/bass"; piano { note "C4" start 0 duration 3 velocity .8; note "E4" start 0 duration 1 velocity .7; note "G4" start 1 duration .25 velocity .5; } gain .8; }');
  program.tracks[0].synth = patch(name); return program;
};
const snapshot = (program, beat, playing = true) => ({ program, fill: false, state: { playing, bar: Math.floor(beat / 4) + 1, phase: (beat % 4) / 4, tempo: program.tempo } });
const note = { playing: true, active: true, beat: 0, age: 0, duration: 1.5, energy: .8, midi: 60, index: 0, gestureIndex: 0 };
const poses = rig => [rig.body, rig.head, rig.leftArm, rig.rightArm].flatMap(node => [...node.position, ...node.quaternion, ...node.scale]);
function dispose(instrument) {
  const geometries = new Set(), materials = new Set();
  instrument.traverse(node => { if (node instanceof Mesh) { geometries.add(node.geometry); materials.add(node.material); } });
  geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose());
}

test('actual recipes select visuals through synth and modular precedence without trusting names', () => {
  names.forEach((name, i) => {
    const track = fixture(name).tracks[0];
    assert.equal(trackRole(track), roles[i]);
    track.source = { kind: 'sound', name: 'drums/kick' };
    assert.equal(trackRole(track), roles[i], 'synth overrides sample sources too');
    track.modular = { name: 'misleading patch name', config: patch(names[(i + 1) % names.length]) };
    assert.equal(trackRole(track), roles[(i + 1) % names.length]);
    track.modular.name = 'Synth Brass';
    assert.equal(trackRole(track), roles[(i + 1) % names.length]);
    track.modular = undefined;
    track.synth.cutoff *= .8; track.synth.volume *= .5;
    assert.equal(trackRole(track), roles[i], 'level and filter edits preserve timbre family');
    assert.equal(trackRole(track, { kind: 'note', midi: 60, locks: { cutoff: 1000, volume: .4 } }), roles[i]);
  });
  const track = fixture('Noise Riser').tracks[0];
  assert.equal(trackRole(track, { kind: 'note', midi: 60, locks: { attack: .001, noise: 0, tone: 1 } }), 'keys', 'structural step locks change the effective sound');
  track.synth = { ...patch('Flute Lead'), osc1: 'sawtooth', fm: .9, sub: .7 };
  assert.equal(trackRole(track), 'keys', 'unknown edits have a neutral electronic fallback');
});

test('held flute, strings and riser retain coherent duration and gesture across overlapping chords', () => {
  for (const name of ['Flute Lead', 'String Ensemble', 'Noise Riser']) {
    const program = fixture(name), score = new PerformanceScore();
    const onset = score.sample(snapshot(program, 0))[0];
    assert.equal(onset.midi, 60); assert.equal(onset.gestureIndex, 0);
    const held = score.sample(snapshot(program, 2))[0];
    assert.equal(held.active, true); assert.equal(held.midi, 60);
    assert.equal(held.age, 1); assert.equal(held.duration, 1.5);
    assert.equal(held.gestureIndex, 0);
    assert.equal(score.sample(snapshot(program, 3.5))[0].active, false);
    assert.deepEqual(score.sample(snapshot(program, 2))[0], held, 'seeking reconstructs the same pose input');
    assert.equal(score.sample(snapshot(program, 4))[0].age, 0, 'loop retriggers');
  }
});

test('silence, disconnected patches, locks, mute, solo, stop and replacement suppress gestures', () => {
  for (const name of names) {
    for (const silence of [track => { track.modular = null; }, track => { track.synth.enabled = false; }, track => { track.synth.volume = 0; }, track => { track.muted = true; }, track => { track.gain = 0; }]) {
      const program = fixture(name); silence(program.tracks[0]);
      const motion = new PerformanceScore().sample(snapshot(program, 0))[0];
      assert.equal(motion.active, false); assert.equal(motion.energy, 0);
    }
    const program = fixture(name), score = new PerformanceScore();
    assert.equal(score.sample(snapshot(program, 0, false))[0].active, false);
    program.tracks.push({ ...structuredClone(program.tracks[0]), name: 'solo', solo: true });
    assert.equal(score.sample(snapshot(program, 0))[0].active, false);
  }
  const program = fixture('Noise Riser');
  program.tracks[0].pianoRoll = undefined;
  program.tracks[0].steps = [{ kind: 'note', midi: 60, locks: { volume: 0 } }, null, null, null];
  assert.equal(new PerformanceScore().sample(snapshot(program, 0))[0].active, false);
  program.tracks[0].steps[0].locks = { attack: .001, noise: 0, tone: 1 };
  assert.equal(new PerformanceScore().sample(snapshot(program, 0))[0].role, 'keys');
  const score = new PerformanceScore(); score.sample(snapshot(fixture('Flute Lead'), 0));
  assert.equal(score.sample(snapshot(fixture('Kalimba Pluck'), 0))[0].role, 'kalimba');
});

test('procedural props fit the rig, follow translated anchors and have bounded geometry', () => {
  for (const role of roles) {
    const rig = createCharacter(), instrument = createInstrument(role, rig), anchor = new Group();
    anchor.position.set(3, 1, -2); anchor.rotation.y = .6; anchor.add(rig.root, instrument);
    let triangles = 0;
    instrument.traverse(node => { if (node instanceof Mesh) { triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3; assert.ok([...node.geometry.attributes.position.array].every(Number.isFinite)); } });
    assert.ok(triangles < 9000, `${role}: ${triangles} triangles`);
    for (const motion of [note, { ...note, age: .7 }, { ...note, active: false, age: Infinity, energy: 0 }, { ...note, playing: false }]) {
      rig.resetPose(); animatePerformer(role, rig, motion, instrument); anchor.updateMatrixWorld(true);
      for (const side of ['left', 'right']) {
        const hand = rig.sockets[`${side}Hand`].getWorldPosition(new Vector3());
        const target = instrument.getObjectByName(`${side}-contact`).getWorldPosition(new Vector3());
        assert.ok(hand.distanceTo(target) < .14, `${role} ${side} reach error ${hand.distanceTo(target)}`);
      }
      assert.ok(poses(rig).every(Number.isFinite));
    }
    if (['brass', 'flute'].includes(role)) {
      rig.resetPose(); animatePerformer(role, rig, note, instrument); anchor.updateMatrixWorld(true);
      const mouth = rig.head.localToWorld(new Vector3(0, .185, .569));
      const lip = instrument.getObjectByName('held-prop').getWorldPosition(new Vector3());
      assert.ok(mouth.distanceTo(lip) < .015, `${role} mouth alignment`);
    }
    dispose(instrument); rig.dispose();
  }
  const positions = concertLayout(roles);
  assert.equal(new Set(positions.map(point => `${point.x},${point.z}`)).size, roles.length);
});

test('stops blend to idle and frozen clocks reproduce every new playing pose', () => {
  for (const role of roles) {
    const rig = createCharacter(), instrument = createInstrument(role, rig), animator = new PerformerAnimator(role, rig, instrument);
    animator.update(note); const onset = poses(rig);
    animator.update({ ...note, playing: false }, 0); assert.ok(poses(rig).every((value, i) => Math.abs(value - onset[i]) < 1e-12));
    for (let i = 0; i < 60; i++) animator.update({ ...note, playing: false, beat: 100 }, 1 / 60);
    const stopped = poses(rig); rig.resetPose(); animatePerformer(role, rig, { ...note, playing: false }, instrument);
    assert.ok(poses(rig).every((value, i) => Math.abs(value - stopped[i]) < 1e-7), role);
    const motion = { ...note, age: .4, beat: .8 };
    animator.update(motion); const held = poses(rig);
    animator.update(motion); assert.ok(poses(rig).every((value, i) => Math.abs(value - held[i]) < 1e-12));
    dispose(instrument); rig.dispose();
  }
});

test('valves, keys, bow, thumbs and sweep move with onset age and duration', () => {
  for (const [role, part, axis] of [['brass', 'valve-0', 'y'], ['chiptune', 'chip-key-0', 'y'], ['strings', 'bow', 'x'], ['kalimba', 'left-thumb', 'z'], ['riser', 'slider', 'z'], ['bass808', 'pitch-cursor', 'z'], ['marimba', 'left-mallet', 'y'], ['woodblock', 'left-mallet', 'y'], ['downlifter', 'slider', 'z'], ['impact', 'impact-pad', 'y'], ['mutedGuitar', 'mute-pad', 'z']]) {
    const rig = createCharacter(), instrument = createInstrument(role, rig);
    rig.resetPose(); animatePerformer(role, rig, note, instrument);
    const start = instrument.getObjectByName(part).position[axis];
    rig.resetPose(); animatePerformer(role, rig, { ...note, age: .7 }, instrument);
    assert.notEqual(instrument.getObjectByName(part).position[axis], start, role);
    if (role === 'riser') {
      assert.ok(instrument.getObjectByName(part).position.z < start);
      rig.resetPose(); animatePerformer(role, rig, { ...note, age: .7, duration: 3 }, instrument);
      assert.ok(instrument.getObjectByName(part).position.z > -.01, 'sweep scales with scheduled duration');
    }
    dispose(instrument); rig.dispose();
  }
});

test('changing instruments blends from the displayed character pose', () => {
  const rig = createCharacter();
  const first = createInstrument('strings', rig), second = createInstrument('flute', rig);
  new PerformerAnimator('strings', rig, first).update(note);
  const before = poses(rig);
  const animator = new PerformerAnimator('flute', rig, second, true);
  animator.update(note, 0);
  assert.ok(poses(rig).every((value, i) => Math.abs(value - before[i]) < 1e-12));
  animator.update(note, 1 / 60);
  assert.ok(poses(rig).some((value, i) => Math.abs(value - before[i]) > .001));
  dispose(first); dispose(second); rig.dispose();
});

test('new step-based sounds use the audio gate and one pluck per chord onset', () => {
  const program = compileMusic('tempo 120; track part { instrument "synth/lead"; notes "C4 . E4 ."; }');
  program.tracks[0].synth = patch('Flute Lead');
  const score = new PerformanceScore();
  const start = score.sample(snapshot(program, 0))[0];
  assert.equal(start.duration, .425);
  assert.equal(score.sample(snapshot(program, .8))[0].active, true);
  assert.equal(score.sample(snapshot(program, .9))[0].active, false);
  assert.equal(score.sample(snapshot(program, 2))[0].gestureIndex, 1);
  const kalimba = fixture('Kalimba Pluck');
  assert.equal(new PerformanceScore().sample(snapshot(kalimba, 0))[0].gestureIndex, 0);
  kalimba.tracks[0].pianoRoll.reverse();
  assert.equal(new PerformanceScore().sample(snapshot(kalimba, 0))[0].midi, 60, 'chord input order cannot change the performing voice');
});

test('a chord sweep keeps the longest voice for its entire duration', () => {
  const program = fixture('Noise Riser');
  program.tracks[0].pianoRoll = [
    { midi: 60, start: 0, duration: .5, velocity: .8 },
    { midi: 67, start: 0, duration: 3, velocity: .8 },
  ];
  const score = new PerformanceScore();
  for (const beat of [0, .25, 1, 2]) {
    const motion = score.sample(snapshot(program, beat))[0];
    assert.equal(motion.duration, 1.5);
    assert.equal(motion.midi, 67);
    assert.equal(motion.age, beat / 2);
  }
});


test('native sources select Muse props without patch metadata and silence disconnects them', () => {
  Object.keys(INSTRUMENT_PATCHES).forEach((name, index) => {
    const program = compileMusic(`tempo 120; track part { instrument "${name}"; notes "C4 . G4 ."; }`);
    const role = roles[index + 6];
    assert.equal(trackRole(program.tracks[0]), role);
    const score = new PerformanceScore();
    const onset = score.sample(snapshot(program, 0))[0];
    assert.equal(onset.role, role); assert.equal(onset.active, true);
    assert.equal(score.sample(snapshot(program, 4))[0].age, 0);
    program.tracks[0].modular = null;
    assert.equal(new PerformanceScore().sample(snapshot(program, 0))[0].active, false);
  });
});


test('sweep direction locks change the effects gesture without trusting the patch name', () => {
  const program = compileMusic('track sweep { instrument "synth/downlifter"; notes "C4 C4"; lock 1 { filterSweep 1; } }');
  assert.equal(trackRole(program.tracks[0], program.tracks[0].steps[0]), 'downlifter');
  assert.equal(trackRole(program.tracks[0], program.tracks[0].steps[1]), 'riser');
});

test('new props remain within mitten reach across the MIDI range', () => {
  for (const role of roles.slice(6)) {
    const rig = createCharacter(), instrument = createInstrument(role, rig), anchor = new Group();
    anchor.add(rig.root, instrument);
    for (let midi = 0; midi < 128; midi++) {
      rig.resetPose(); animatePerformer(role, rig, { ...note, midi, gestureIndex: midi % 2 }, instrument);
      anchor.updateMatrixWorld(true);
      for (const side of ['left', 'right']) {
        const hand = rig.sockets[`${side}Hand`].getWorldPosition(new Vector3());
        const target = instrument.getObjectByName(`${side}-contact`).getWorldPosition(new Vector3());
        assert.ok(hand.distanceTo(target) < .14, `${role} ${midi} ${side} reach`);
      }
    }
    dispose(instrument); rig.dispose();
  }
});
