import assert from 'node:assert/strict';
import test from 'node:test';
import { compileMusic } from '@banger/compiler';
import { eventsForSong } from '@banger/engine';
import { PerformanceScore, trackRole } from '../dist/score.js';
const fixture = () => compileMusic('tempo 120; track kick { sound "drums/kick"; rhythm "x . . ."; gain .8; } track keys { instrument "synth/keys"; piano { note "C4" start 1 duration 2 velocity .7; } gain .5; }');
const snapshot = (program, beat, playing = true, fill = false) => ({ program, fill, state: { playing, bar: Math.floor(beat / 4) + 1, phase: beat % 4 / 4, step: 0, tempo: program.tempo, hasPendingUpdate: false } });
test('each track follows its own onset, rest and sustained note', () => {
  const score = new PerformanceScore(), program = fixture();
  const start = score.sample(snapshot(program, 0));
  assert.equal(start[0].energy, .8); assert.equal(start[1].energy, 0);
  const held = score.sample(snapshot(program, 2));
  assert.equal(held[0].active, false); assert.equal(held[1].active, true);
  assert.equal(held[1].midi, 60); assert.equal(held[1].energy, .35);
  assert.equal(score.sample(snapshot(program, 3.9))[1].active, false);
  assert.ok(score.sample(snapshot(program, 4))[0].active);
});
test('stop, mute, solo, zero gain and missing notes suppress motion', () => {
  const score = new PerformanceScore(), program = fixture();
  assert.ok(score.sample(snapshot(program, 1, false)).every(motion => motion.energy === 0 && !motion.active));
  program.tracks[0].muted = true;
  assert.equal(score.sample(snapshot(program, 0))[0].energy, 0);
  program.tracks[0].muted = false; program.tracks[1].solo = true;
  assert.equal(score.sample(snapshot(program, 0))[0].energy, 0);
  program.tracks[1].gain = 0;
  assert.equal(score.sample(snapshot(program, 1))[1].energy, 0);
});
test('arrangement gaps, active patterns and loop conditions use engine decisions', () => {
  const program = fixture();
  program.sections = [{ name: 'intro', bars: 1, tracks: [{ track: 'kick' }] }, { name: 'verse', bars: 1, tracks: [{ track: 'keys' }] }];
  program.timeline = [{ section: 'intro' }, { section: 'verse' }];
  const score = new PerformanceScore();
  assert.equal(score.sample(snapshot(program, 1))[1].energy, 0);
  assert.equal(score.sample(snapshot(program, 5))[1].active, true);
  program.tracks[0].steps[0].condition = 'first';
  const conditional = new PerformanceScore();
  assert.ok(conditional.sample(snapshot(program, 0))[0].active);
  assert.equal(conditional.sample(snapshot(program, 8))[0].active, false);
});
test('probability, groove and fill match audible engine events', () => {
  const program = fixture();
  program.tracks[0].steps[0].condition = 'fill';
  const score = new PerformanceScore();
  assert.equal(score.sample(snapshot(program, 0))[0].energy, 0);
  assert.ok(score.sample(snapshot(program, 0, true, true))[0].active);
  const next = fixture(); next.tracks[0].steps[0].probability = 0;
  assert.equal(score.sample(snapshot(next, 0))[0].energy, 0);
  next.tracks[1].groove = { swing: .3, humanize: .02, seed: 42 };
  const event = eventsForSong(next).find(event => event.track.name === 'keys');
  const grooved = new PerformanceScore();
  assert.ok(grooved.sample(snapshot(next, event.beat + .001))[1].active);
  assert.equal(grooved.sample(snapshot(next, Math.max(0, event.beat - .001)))[1].active, false);
});
test('roles cover every source family', () => {
  const program = fixture();
  assert.equal(trackRole(program.tracks[0]), 'drums');
  for (const [name, role] of [['bass','bass'],['pluck','bass'],['keys','keys'],['organ','keys'],['bell','keys'],['pad','dance'],['lead','dance']]) {
    assert.equal(trackRole({ ...program.tracks[1], source: { kind: 'instrument', name: `synth/${name}` } }), role);
  }
});
test('overlapping short notes do not interrupt a held chord tone', () => {
  const program = compileMusic('track keys { instrument "synth/keys"; piano { note "C4" start 0 duration 4 velocity .8; note "G4" start 1 duration .25 velocity .4; } gain .5; }');
  const motion = new PerformanceScore().sample(snapshot(program, 2))[0];
  assert.equal(motion.active, true);
  assert.equal(motion.energy, .4);
});
