import assert from 'node:assert/strict';
import test from 'node:test';
import { compileMusic } from '@banger/compiler';
import { concertLayout, concertSignals, isChorus } from '../dist/concert.js';
import { PerformanceScore } from '../dist/score.js';
const snapshot = (program, beat, playing = true) => ({ program, fill: false, state: { playing, bar: Math.floor(beat / 4) + 1, phase: beat % 4 / 4, tempo: 120 } });
test('role staging preserves track indices and gives each performer space', () => {
  const roles = ['keys', 'drums', 'dance', 'bass', 'drums', 'keys'];
  const positions = concertLayout(roles);
  assert.ok(positions[1].y > positions[0].y && positions[0].y > positions[2].y);
  assert.ok(positions[1].z < positions[2].z);
  assert.ok(positions[0].x < positions[2].x && positions[5].x > positions[3].x);
  for (const compact of [false, true]) {
    const crowded = concertLayout(Array.from({ length: 32 }, (_, i) => roles[i % roles.length]), compact);
    for (let i = 0; i < crowded.length; i++) for (let j = i + 1; j < crowded.length; j++) {
      assert.ok(Math.hypot(crowded[i].x - crowded[j].x, crowded[i].z - crowded[j].z) >= 3.3);
    }
  }
  assert.deepEqual(concertLayout([]), []);
});
test('kick, snare and sustained backdrop envelopes obey score and still mode', () => {
  const program = compileMusic('tempo 120; track kick { sound "drums/kick"; rhythm "x . . ."; } track snare { sound "drums/snare"; rhythm ". x . ."; } track keys { instrument "synth/keys"; piano { note "C4" start 0 duration 4 velocity .7; } }');
  const score = new PerformanceScore();
  const signals = beat => concertSignals(program, score.sample(snapshot(program, beat)));
  assert.ok(signals(0).kick > 0); assert.equal(signals(0).snare, 0);
  assert.ok(signals(1).kick < .01); assert.ok(signals(1).snare > 0);
  assert.ok(signals(2).chord > 0); assert.equal(signals(4).chord > 0, true);
  program.tracks[0].muted = true; assert.equal(signals(0).kick, 0);
  for (const result of [concertSignals(program, score.sample(snapshot(program, 0, false))), concertSignals(program, score.sample(snapshot(program, 0)), true)]) {
    assert.deepEqual(result, { kick: 0, snare: 0, chord: 0, chorus: false });
  }
});
test('chorus sweeps follow repeated sections and looping, not wall time', () => {
  const program = compileMusic('track kick { sound "drums/kick"; rhythm "x . . ."; } section verse { bars 1; play kick; } section chorus { bars 1; play kick; } song { play verse 2; play chorus; }');
  assert.equal(isChorus(program, 7.9), false);
  assert.equal(isChorus(program, 8), true);
  assert.equal(isChorus(program, 12), false);
  program.chainEnabled = false; assert.equal(isChorus(program, 8), false);
  program.activePattern = 'chorus'; assert.equal(isChorus(program, 0), true);
});

test('a short overlapping note does not extinguish a sustained backdrop chord', () => {
  const program = compileMusic('track keys { instrument "synth/keys"; piano { note "C4" start 0 duration 4 velocity .8; note "G4" start 1 duration .25 velocity .4; } }');
  const motions = new PerformanceScore().sample(snapshot(program, 2));
  assert.ok(concertSignals(program, motions).chord > 0);
  program.tracks[0].gain = 0;
  assert.equal(concertSignals(program, new PerformanceScore().sample(snapshot(program, 2))).chord, 0);
});
