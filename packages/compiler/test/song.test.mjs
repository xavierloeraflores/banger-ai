import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileMusic, serializeMusic, copyMusicProgram, validateMusicProgram, CompileError, resolveArrangement, resolvePattern, patternDurationBeats, programDurationBeats, pianoNotes, applyGroove, sampleAutomation } from '../dist/index.js';

const source = `tempo 110;
track kick { sound "drums/kick"; rhythm "x . x ."; gain .6; }
track keys { instrument "synth/keys"; bars 2; notes "C4 . G4 ."; gain .4;
 pattern chorus { piano { note "C4" start 0 duration 8 velocity .7; note "G4" start 12 duration 4 velocity .6; } bars 4; }
 groove { quantize .25; swing .2; humanize .01; seed 42; }
 output music; send space .2;
 effect filter { cutoff 1000; resonance 2; }
 effect eq { low -3; mid 0; high 2; }
 effect compressor { threshold -24; ratio 4; attack .01; release .1; knee 20; sidechain kick; }
 effect distortion { amount .2; mix .3; }
 automation "filter.cutoff" { interpolation linear; point 0 300; point 16 5000; }
 automation "pitch" { interpolation step; point 0 -12; point 8 7; }
 automation "gain" { point 0 .1; point 8 .5; }
}
bus music { gain .8; effect eq { low 0; mid -2; high 1; } send space .1; automation "eq.mid" { point 0 -2; point 16 2; } }
bus space { gain .5; effect reverb { mix 1; } }
section verse { bars 3; play keys; play kick; }
section chorus { bars 5; play keys chorus; }
song { play verse 2; play chorus; }`;

test('complete song compiles, copies and round trips every field', () => {
  const program = compileMusic(source);
  assert.deepEqual(compileMusic(serializeMusic(program)), program);
  const copy = copyMusicProgram(program);
  copy.tracks[1].patterns[0].pianoRoll[0].midi = 70;
  copy.tracks[1].automation[0].points[0].value = 500;
  copy.sections[0].tracks[0].pattern = 'chorus';
  copy.buses[0].sends[0].gain = .4;
  assert.equal(program.tracks[1].patterns[0].pianoRoll[0].midi, 60);
  assert.equal(program.tracks[1].automation[0].points[0].value, 300);
  assert.equal(program.sections[0].tracks[0].pattern, undefined);
  assert.equal(program.buses[0].sends[0].gain, .1);
});

test('arrangement repeats phrases and clips the last repetition to section end', () => {
  const program = compileMusic(source);
  assert.equal(programDurationBeats(program), 44);
  assert.deepEqual(resolveArrangement(program).filter(clip => clip.track === 'keys'), [
    {track:'keys', startBeat:0, durationBeats:8, section:'verse'},
    {track:'keys', startBeat:8, durationBeats:4, section:'verse'},
    {track:'keys', startBeat:12, durationBeats:8, section:'verse'},
    {track:'keys', startBeat:20, durationBeats:4, section:'verse'},
    {track:'keys', pattern:'chorus', startBeat:24, durationBeats:16, section:'chorus'},
    {track:'keys', pattern:'chorus', startBeat:40, durationBeats:4, section:'chorus'},
  ]);
  assert.equal(resolveArrangement(program).filter(clip => clip.track === 'kick').length, 6);
  assert.equal(patternDurationBeats(resolvePattern(program.tracks[1], 'chorus')), 16);
  assert.throws(() => resolvePattern(program.tracks[1], 'missing'), RangeError);
  assert.deepEqual(pianoNotes(program.tracks[1]).map(note => [note.start, note.duration]), [[0,2],[4,2]]);
});

test('without a song the longest base phrase determines duration', () => {
  const program = compileMusic('track a { sound "drums/hat"; rhythm "x"; } track b { instrument "synth/keys"; bars 3; notes "C4 ."; }');
  assert.equal(programDurationBeats(program), 12);
  assert.deepEqual(resolveArrangement(program).map(clip => [clip.track,clip.startBeat,clip.durationBeats]), [['a',0,4],['a',4,4],['a',8,4],['b',0,12]]);
});

test('automation samples clamped linear and step segments including exact points', () => {
  const curve = {target:'gain', points:[{beat:2,value:.2},{beat:4,value:.6},{beat:8,value:1}]};
  for (const [beat, value] of [[-1,.2],[2,.2],[3,.4],[4,.6],[6,.8],[20,1]]) assert.ok(Math.abs(sampleAutomation(curve,beat)-value)<1e-12);
  assert.equal(sampleAutomation({...curve, interpolation:'step'},3),.2);
  assert.equal(sampleAutomation({...curve, interpolation:'step'},4),.6);
  assert.equal(sampleAutomation({...curve, interpolation:'step'},7),.6);
});

test('groove quantizes and swings on a stable grid with reproducible seeded jitter', () => {
  assert.equal(applyGroove(.26,{quantize:.25}),.25);
  assert.equal(applyGroove(.5,{swing:1}),.75);
  assert.equal(applyGroove(1,{swing:1}),1);
  const groove = {quantize:.25,swing:.2,humanize:.03,seed:123};
  const first = Array.from({length:32},(_,i)=>applyGroove(i*.25,groove,i));
  assert.deepEqual(first,Array.from({length:32},(_,i)=>applyGroove(i*.25,groove,i)));
  assert.notDeepEqual(first,Array.from({length:32},(_,i)=>applyGroove(i*.25,{...groove,seed:124},i)));
  first.forEach((beat,i)=>assert.ok(Math.abs(beat-(i*.25+(i%2)*.025))<=.03));
});

test('invalid references, routing, timing and automation fail before scheduling', () => {
  const mutations = [
    p=>p.tracks[1].output='missing', p=>p.buses[0].sends[0].bus='missing',
    p=>p.buses[1].sends=[{bus:'music',gain:.2}], p=>p.buses[0].sends=[{bus:'music',gain:.1}],
    p=>p.tracks[1].effects[2].sidechain='missing', p=>p.sections[0].tracks[0].track='missing',
    p=>p.sections[0].tracks[0].pattern='missing', p=>p.timeline[0].section='missing',
    p=>p.tracks[1].patterns[0].bars=0, p=>p.tracks[1].patterns[0].bars=65,
    p=>p.tracks[1].patterns[0].pianoRoll[1].duration=5,
    p=>p.tracks[1].automation[0].points[1].beat=0,
    p=>p.tracks[1].automation[0].points[0].value=0,
    p=>p.tracks[1].effects.shift(), p=>p.tracks[1].groove.seed=.2,
    p=>p.buses[0].automation=[{target:'pitch',points:[{beat:0,value:0}]}],
    p=>p.timeline[0].repeats=1024, p=>p.sections[0].tracks.push({...p.sections[0].tracks[0]}),
  ];
  for (const mutate of mutations) {const program=compileMusic(source);mutate(program);assert.throws(()=>validateMusicProgram(program),RangeError);}
  for (const text of [source.replace('bars 2','bars 1.5'),source.replace('point 16 5000','point 16 25000'),source.replace('pattern chorus','pattern 4'),source.replace('send space .2','send space 2'),source.replace('song {','song { play absent;'),source.replace('groove {','groove { surprise 1;'),source.replace('play keys;','play absent;')]) assert.throws(()=>compileMusic(text),CompileError);
});

test('expanded event budget rejects dense repetitions without allocating song events', () => {
  const program = compileMusic('track a { sound "drums/kick"; rhythm "x"; } section a { bars 64; play a; } song { play a 16; }');
  assert.equal(resolveArrangement(program).length, 1024);
  program.tracks[0].steps = Array(64).fill({kind:'hit'});
  validateMusicProgram(program);
  program.tracks.push({...program.tracks[0],name:'b'});program.sections[0].tracks.push({track:'b'});
  assert.throws(()=>validateMusicProgram(program),/65536 expanded events/);
});
