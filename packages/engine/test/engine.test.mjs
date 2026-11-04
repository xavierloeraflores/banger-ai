import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileMusic, createDefaultProgram } from '@banger/compiler';
import { AudioRenderer, BangerPlayer, eventsForBar, eventsForSong, barDuration } from '../dist/index.js';
import { scheduleSynth } from '../dist/synth.js';
import { FACTORY_PATCHES, INIT_SYNTH } from '@banger/compiler';

class Param {
  value = 0;
  events = [];
  setTargetAtTime(value, time, constant) { this.events.push({ value, time, constant }); }
  setValueAtTime(value, time) { this.events.push({ value, time }); }
  linearRampToValueAtTime(value, time) { this.events.push({ value, time }); }
  exponentialRampToValueAtTime(value, time) { assert.ok(value > 0); this.events.push({ value, time }); }
}
class Node {
  offset = new Param(); threshold = new Param(); ratio = new Param(); attack = new Param(); release = new Param(); knee = new Param(); gain = new Param(); frequency = new Param(); detune = new Param(); delayTime = new Param(); Q = new Param(); pan = new Param(); connections = []; starts = []; stops = [];
  constructor(context, kind) { this.context = context; this.kind = kind; context.nodes.push(this); }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.connections = []; }
  start(time) { assert.ok(Number.isFinite(time)); this.starts.push(time); }
  stop(time) { this.stops.push(time); }
}
class Context {
  static instances = [];
  state = 'suspended'; currentTime = 0; sampleRate = 8000; nodes = []; closeCalls = 0;
  constructor() { this.destination = new Node(this, 'destination'); Context.instances.push(this); }
  async resume() { this.state = 'running'; }
  async close() { this.closeCalls++; this.state = 'closed'; }
  createConstantSource() { return new Node(this, 'constant'); }
  createWaveShaper() { return new Node(this, 'shaper'); }
  createGain() { return new Node(this, 'gain'); }
  createDynamicsCompressor() { return new Node(this, 'compressor'); }
  createBiquadFilter() { return new Node(this, 'filter'); }
  createDelay() { return new Node(this, 'delay'); }
  createStereoPanner() { return new Node(this, 'panner'); }
  createConvolver() { return new Node(this, 'convolver'); }
  createBufferSource() { return new Node(this, 'buffer'); }
  createOscillator() { return new Node(this, 'oscillator'); }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, duration: length / sampleRate, getChannelData: channel => data[channel] };
  }
  get sources() { return this.nodes.filter(node => node.kind === 'buffer' || node.kind === 'oscillator'); }
}
function environment(t) {
  Context.instances = [];
  const old = globalThis.AudioContext;
  globalThis.AudioContext = Context;
  t.after(() => { if (old === undefined) delete globalThis.AudioContext; else globalThis.AudioContext = old; });
  const callbacks = new Set();
  t.mock.method(globalThis, 'setInterval', (callback, ms) => { assert.equal(ms, 25); callbacks.add(callback); return callback; });
  t.mock.method(globalThis, 'clearInterval', id => callbacks.delete(id));
  return { tick: () => { for (const callback of callbacks) callback(); }, callbacks };
}
const song = () => compileMusic('tempo 120; track kick { sound "drums/kick"; rhythm "x x x x"; gain .8; }');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('noise riser has no pitched sources and sweeps for the whole held note', () => {
  const config = FACTORY_PATCHES.find(patch => patch.name === 'Noise Riser').config;
  for (const duration of [.1, 2, 8]) {
    const context = new Context(); context.sampleRate=44100;
    const voice=scheduleSynth(context,context.destination,{time:1,duration,sustained:true,velocity:1,step:{kind:'note',midi:84}},config);
    assert.equal(voice.pitchOscillators.length,0);
    assert.equal(context.sources.filter(node=>node.kind==='oscillator').length,0);
    assert.equal(context.sources.filter(node=>node.kind==='buffer').length,1);
    for (const filter of context.nodes.filter(node=>node.kind==='filter')) {
      assert.deepEqual(filter.frequency.events,[{value:300,time:1},{value:9600,time:1+duration}]);
    }
    near(voice.end,1+duration+config.release);
  }
});

test('sweep direction clamps to the audio rate and legacy configs keep oscillators', () => {
  const event={time:0,duration:2,sustained:true,velocity:1,step:{kind:'note',midi:60}};
  for (const [cutoff,filterSweep,target] of [[2000,1,3600],[300,-1,20]]) {
    const context=new Context();
    scheduleSynth(context,context.destination,event,{...INIT_SYNTH,cutoff,filterSweep});
    assert.equal(context.nodes.find(node=>node.kind==='filter').frequency.events.at(-1).value,target);
  }
  const context=new Context(),legacy={...INIT_SYNTH};delete legacy.tone;delete legacy.filterSweep;delete legacy.filterDecay;
  const voice=scheduleSynth(context,context.destination,event,legacy);
  assert.equal(voice.pitchOscillators.length,3);
  assert.equal(context.nodes.find(node=>node.kind==='filter').frequency.events.length,3);
});

test('brass filter stab decays briefly even when a note is held', () => {
  const config=FACTORY_PATCHES.find(patch=>patch.name==='Synth Brass').config;
  for(const duration of [.01,2]) {
    const context=new Context();
    scheduleSynth(context,context.destination,{time:0,duration,sustained:true,velocity:1,step:{kind:'note',midi:60}},config);
    const events=context.nodes.find(node=>node.kind==='filter').frequency.events;
    near(events.at(-1).time,Math.min(duration,Math.min(config.attack,duration/2)+.18));
    assert.equal(events.at(-1).value,config.cutoff);
  }
});

test('event timing divides each track across one bar', () => {
  const program = createDefaultProgram();
  assert.equal(barDuration(program), 2);
  const events = eventsForBar(program, 10);
  assert.equal(events.length, 14);
  assert.ok(events.every(event => event.time >= 10 && event.time < 12 && event.duration === .125));
  assert.ok(events.every((event, i) => !i || event.time >= events[i - 1].time));
  assert.throws(() => eventsForBar(program, Infinity), RangeError);
  assert.throws(() => eventsForBar(program, -1), RangeError);
});

test('does not create Web Audio until start and exposes sixteenth-note state', async t => {
  const env = environment(t), player = new BangerPlayer();
  assert.equal(Context.instances.length, 0);
  assert.deepEqual(player.state, { playing: false, bar: 0, step: 0, phase: 0, tempo: null, hasPendingUpdate: false });
  await player.start(song());
  const context = Context.instances[0];
  assert.equal(context.sources.length, 4);
  context.sources.forEach((source, i) => near(source.starts[0], .05 + i * .5));
  context.currentTime = .55;
  assert.equal(player.state.step, 4); near(player.state.phase, .25); assert.equal(player.state.bar, 1);
  assert.equal(env.callbacks.size, 1);
  player.stop();
  assert.equal(env.callbacks.size, 0);
  assert.ok(context.sources.every(source => source.stops.length && !source.connections.length));
  assert.equal(player.state.playing, false);
  await player.dispose();
});

test('queues copied edits for the next bar and changes tempo at its boundary', async t => {
  const env = environment(t), player = new BangerPlayer();
  await player.start(song());
  const context = Context.instances[0]; context.currentTime = .5;
  const next = song(); next.tempo = 240; next.tracks[0].gain = .3;
  player.update(next); next.tempo = 60;
  assert.equal(player.performance.program.tempo, 120, 'Visuals retain the score currently heard');
  assert.equal(player.state.hasPendingUpdate, true); assert.equal(player.state.tempo, 120);
  context.currentTime = 1.96; env.tick();
  assert.equal(player.performance.program.tempo, 120, 'Lookahead scheduling must not advance visuals');
  assert.equal(context.sources.length, 8);
  near(context.sources[5].starts[0], 2.3);
  assert.equal(player.state.hasPendingUpdate, true);
  context.currentTime = 2.06;
  assert.equal(player.performance.program.tempo, 240, 'Visual score switches at the audio boundary');
  assert.equal(player.state.tempo, 240); assert.equal(player.state.bar, 2); assert.equal(player.state.hasPendingUpdate, false);
  await player.dispose();
});

test('late edits cancel audio already scheduled for the upcoming bar', async t => {
  const env = environment(t), player = new BangerPlayer();
  await player.start(song());
  const context = Context.instances[0]; context.currentTime = 1.96; env.tick();
  const previousFuture = context.sources.slice(4);
  const next = song(); next.tracks[0].steps = [{ kind: 'hit' }]; player.update(next);
  assert.ok(previousFuture.every(source => source.stops.length === 1 && !source.connections.length));
  assert.equal(context.sources.length, 9); near(context.sources[8].starts[0], 2.05);
  await player.dispose();
});

test('skips missed events after a long timer stall without replay bursts', async t => {
  const env = environment(t), player = new BangerPlayer();
  await player.start(song()); const context = Context.instances[0];
  context.currentTime = 3600.7; env.tick();
  const fresh = context.sources.slice(4);
  assert.equal(fresh.length, 2);
  assert.ok(fresh.every(source => source.starts[0] >= context.currentTime));
  assert.equal(player.state.bar, 1801);
  env.tick(); assert.equal(context.sources.length, 6);
  await player.dispose();
});

test('suspended audio does not accumulate bars, and resume skips stale events', async t => {
  const env = environment(t), player = new BangerPlayer();
  await player.start(song()); const context = Context.instances[0];
  context.state = 'suspended'; context.currentTime = 90;
  for (let i = 0; i < 20; i++) env.tick();
  assert.equal(context.sources.length, 4);
  context.state = 'running'; env.tick();
  assert.ok(context.sources.slice(4).every(source => source.starts[0] >= 90));
  await player.dispose();
});

test('invalid updates and starts preserve current playback', async t => {
  environment(t); const player = new BangerPlayer(); await player.start(song());
  const bad = song(); bad.tempo = 0;
  assert.throws(() => player.update(bad), RangeError);
  await assert.rejects(player.start(bad), RangeError);
  assert.equal(player.state.playing, true); assert.equal(player.state.hasPendingUpdate, false);
  await player.dispose();
});

test('stop during pending resume cannot restart playback', async t => {
  const env = environment(t); let resume;
  t.mock.method(Context.prototype, 'resume', function () { this.state = 'running'; return new Promise(resolve => { resume = resolve; }); });
  const player = new BangerPlayer(), starting = player.start(song());
  player.stop(); resume(); await starting;
  assert.equal(player.state.playing, false); assert.equal(env.callbacks.size, 0);
  assert.equal(Context.instances[0].sources.length, 0);
  await player.dispose();
});

test('dispose is idempotent and prevents restart', async t => {
  environment(t); const player = new BangerPlayer(); await player.start(song());
  await Promise.all([player.dispose(), player.dispose()]);
  const context = Context.instances[0]; assert.equal(context.closeCalls, 1);
  assert.ok(context.nodes.every(node => !node.connections.length));
  await assert.rejects(player.start(song()), /disposed/);
  assert.throws(() => player.update(song()), /disposed/);
});

test('renderer produces finite drum samples and pitched envelopes and cleans nodes', () => {
  const context = new Context(), renderer = new AudioRenderer(context);
  const program = createDefaultProgram();
  program.tracks.push({ name: 'lead', source: { kind: 'instrument', name: 'synth/pluck' }, steps: [{ kind: 'note', midi: 69 }], gain: .4, effects: [{ kind: 'reverb', mix: .2 }] });
  const rendered = renderer.renderBar(program, .05);
  const buffers = context.sources.filter(source => source.kind === 'buffer');
  for (const source of buffers) {
    const data = source.buffer.getChannelData(0);
    assert.ok(data.every(Number.isFinite)); assert.ok(data.some(value => Math.abs(value) > .01));
    assert.equal(Math.abs(data[0]), 0); assert.equal(Math.abs(data.at(-1)), 0);
  }
  assert.ok(context.sources.some(source => source.kind === 'oscillator' && source.frequency.value === 440));
  assert.ok(context.nodes.some(node => node.kind === 'convolver'));
  rendered.dispose(); rendered.dispose(); renderer.dispose(); renderer.dispose();
  assert.ok(context.nodes.every(node => !node.connections.length));
});

test('muted tracks allocate no voices and past events are excluded', () => {
  const context = new Context(), renderer = new AudioRenderer(context);
  const program = song(); program.tracks[0].gain = 0;
  renderer.renderBar(program, 0); assert.equal(context.sources.length, 0);
  program.tracks[0].gain = .5; renderer.renderBar(program, 0, .75);
  assert.deepEqual(context.sources.map(source => source.starts[0]), [1, 1.5]);
  renderer.dispose();
});

test('dispose during pending resume leaves no scheduled audio', async t => {
  const env = environment(t); let resume;
  t.mock.method(Context.prototype, 'resume', function () { this.state = 'running'; return new Promise(resolve => { resume = resolve; }); });
  const player = new BangerPlayer(), starting = player.start(song());
  await player.dispose(); resume(); await starting;
  assert.equal(env.callbacks.size, 0); assert.equal(Context.instances[0].sources.length, 0);
  assert.equal(Context.instances[0].state, 'closed');
});

test('overlapping starts keep only the newest playback request', async t => {
  const env = environment(t), resumes = [];
  t.mock.method(Context.prototype, 'resume', function () { this.state = 'running'; return new Promise(resolve => resumes.push(resolve)); });
  const player = new BangerPlayer(), first = player.start(song());
  const faster = song(); faster.tempo = 240;
  const second = player.start(faster);
  resumes[1](); await second; resumes[0](); await first;
  assert.equal(player.state.tempo, 240); assert.equal(env.callbacks.size, 1);
  assert.equal(Context.instances.length, 1); assert.equal(Context.instances[0].sources.length, 4);
  await player.dispose();
});

const chords = () => compileMusic(`tempo 120; track chords { instrument "synth/pluck"; piano {
  note "A4" start 0 duration 2 velocity 1;
  note "C5" start 0 duration 1 velocity .5;
  note "A4" start .5 duration 3.5 velocity .25;
  note "E5" start 1 duration 1 velocity 0;
} gain .4; }`);

test('piano events preserve chords, overlaps, velocity and beat duration at any tempo', () => {
  const program = chords();
  const events = eventsForBar(program, 10);
  assert.deepEqual(events.map(e => [e.time, e.duration, e.velocity]), [[10, 1, 1], [10, .5, .5], [10.25, 1.75, .25], [10.5, .5, 0]]);
  program.tempo = 60;
  assert.equal(eventsForBar(program)[2].duration, 3.5);
});

test('piano audio sustains full lengths, scales velocity and allocates overlapping voices', () => {
  const context = new Context(), renderer = new AudioRenderer(context);
  const bar = renderer.renderBar(chords(), 1);
  assert.equal(context.sources.length, 3);
  assert.deepEqual(context.sources.map(s => s.starts[0]), [1, 1, 1.25]);
  assert.deepEqual(context.sources.map(s => s.stops[0]), [2.05, 1.55, 3.05]);
  const envelopes = context.sources.map(s => s.connections[0].gain.events);
  near(envelopes[0][1].value, .55); near(envelopes[1][1].value, .275);
  near(envelopes[2][1].value, .1375);
  assert.ok(bar.cleanupAt > 3.05);
  bar.dispose(); renderer.dispose();
  assert.ok(context.nodes.every(n => !n.connections.length));
});

test('piano edits are copied, scheduled at the next bar and stopped together', async t => {
  const env = environment(t), player = new BangerPlayer();
  await player.start(chords());
  const context = Context.instances[0]; context.currentTime = .5;
  const next = chords(); next.tracks[0].pianoRoll[0].midi = 60;
  player.update(next); next.tracks[0].pianoRoll[0].midi = 0;
  context.currentTime = 1.96; env.tick();
  near(context.sources[3].frequency.value, 440 * 2 ** ((60 - 69) / 12));
  player.stop(); assert.ok(context.sources.every(s => !s.connections.length));
  await player.dispose();
});


test('every instrument renders its own voicing and releases overlapping piano notes', async () => {
  const { INSTRUMENT_NAMES } = await import('@banger/compiler');
  const signatures = new Set();
  for (const name of INSTRUMENT_NAMES) {
    const context = new Context(), renderer = new AudioRenderer(context);
    const program = compileMusic(`track a { instrument "${name}"; piano {
      note "A4" start 0 duration 4 velocity .8;
      note "C5" start 1 duration 2 velocity .4;
    } }`);
    const bar = renderer.renderBar(program, 1);
    assert.ok(context.sources.every(source => source.stops[0] <= bar.cleanupAt));
    signatures.add(JSON.stringify(context.sources.filter(s => s.starts[0] === 1).map(s => [s.type, s.frequency.value, s.detune.value])));
    bar.dispose(); renderer.dispose();
    assert.ok(context.nodes.every(node => node.connections.length === 0));
  }
  assert.equal(signatures.size, INSTRUMENT_NAMES.length);
});

test('all drum sounds render finite, distinct samples with quiet boundaries', async () => {
  const { SOUND_NAMES } = await import('@banger/compiler');
  const samples = [];
  for (const name of SOUND_NAMES) {
    const context = new Context(), renderer = new AudioRenderer(context);
    renderer.renderBar(compileMusic(`track a { sound "${name}"; rhythm "x"; }`), 0);
    const data = context.sources[0].buffer.getChannelData(0);
    assert.ok(data.every(Number.isFinite)); assert.ok(data.some(value => Math.abs(value) > .01));
    assert.equal(Math.abs(data[0]), 0); assert.equal(Math.abs(data.at(-1)), 0);
    samples.push(Array.from(data.slice(10, 30))); renderer.dispose();
  }
  assert.equal(new Set(samples.map(s => JSON.stringify(s))).size, SOUND_NAMES.length);
});

test('ordered filter, feedback delay, reverb and stereo pan connect and clean up', () => {
  const context = new Context(), renderer = new AudioRenderer(context);
  const bar = renderer.renderBar(compileMusic(`track a { instrument "synth/pad"; notes "C4"; pan -.75;
    effect filter { cutoff 1200; resonance 3; }
    effect delay { time .375; feedback .45; mix .3; }
    effect reverb { mix .2; }
  }`), 0);
  const node = kind => context.nodes.find(n => n.kind === kind);
  assert.equal(node('filter').frequency.value, 1200); assert.equal(node('filter').Q.value, 3);
  assert.equal(node('delay').delayTime.value, .375); assert.equal(node('panner').pan.value, -.75);
  assert.ok(node('filter').connections.includes(node('delay')));
  const feedback = node('delay').connections.find(n => n.connections.includes(node('delay')));
  assert.equal(feedback.gain.value, .45);
  assert.equal(feedback.gain.events.length, 0, 'persistent feedback survives bar boundaries');
  assert.ok(bar.cleanupAt > 4);
  bar.dispose(); renderer.dispose(); assert.ok(context.nodes.every(n => !n.connections.length));
});

test('delay tails are bounded and zero mixes avoid effect node allocation', () => {
  const context = new Context(), renderer = new AudioRenderer(context);
  const bar = renderer.renderBar(compileMusic(`track a { sound "drums/open-hat"; rhythm "x";
    effect delay { time 2; feedback .85; mix 1; } effect reverb { mix 0; } }`), 0);
  assert.ok(bar.cleanupAt <= 116.7);
  assert.equal(context.nodes.filter(n => n.kind === 'convolver').length, 0);
  renderer.dispose();
});


test('player stop disconnects feedback graphs and cancels all layered voices', async t => {
  environment(t); const player = new BangerPlayer();
  await player.start(compileMusic(`track a { instrument "synth/organ"; notes "C4 E4";
    effect delay { feedback .85; } effect filter {} pan .5; }`));
  const context = Context.instances[0];
  assert.equal(context.sources.length, 6);
  player.stop();
  assert.ok(context.sources.every(s => s.stops.length >= 2 && !s.connections.length));
  assert.ok(context.nodes.filter(n => ['delay', 'filter', 'panner'].includes(n.kind)).every(n => !n.connections.length));
  await player.dispose(); assert.ok(context.nodes.every(n => !n.connections.length));
});

test('arranged phrases preserve sustained notes, named patterns and deterministic groove', async () => {
  const { eventsForSong, songDuration } = await import('../dist/index.js');
  const program = chords(), track = program.tracks[0];
  track.bars = 2; track.pianoRoll = [{ midi: 60, start: 3, duration: 5, velocity: .8 }];
  track.patterns = [{ name: 'up', bars: 2, steps: [], pianoRoll: [{ midi: 72, start: 0, duration: 8, velocity: .5 }] }];
  track.groove = { humanize: .01, seed: 45 };
  program.sections = [{ name: 'a', bars: 2, tracks: [{ track: track.name }] }, { name: 'b', bars: 2, tracks: [{ track: track.name, pattern: 'up' }] }];
  program.timeline = [{ section: 'a' }, { section: 'b', repeats: 2 }];
  const events = eventsForSong(program);
  assert.equal(songDuration(program), 12); assert.equal(events.length, 3);
  assert.deepEqual(events, eventsForSong(program)); assert.equal(events[1].step.midi, 72);
  assert.equal(eventsForBar(program, 2, 1).length, 0, 'sustained note is not retriggered in second bar');
  const context = new Context(), renderer = new AudioRenderer(context);
  const first = renderer.renderBar(program, 0, -Infinity, 0), second = renderer.renderBar(program, 2, -Infinity, 1);
  assert.ok(first.cleanupAt >= 4.5); assert.equal(context.sources.length, 1);
  first.dispose(); assert.ok(context.nodes.some(node => node.connections.length));
  second.dispose(); renderer.dispose(); assert.ok(context.nodes.every(node => !node.connections.length));
});

test('automation continues through bars and zero initial gain still schedules voices', () => {
  const program = song(), track = program.tracks[0]; track.bars = 2; track.gain = 0;
  track.automation = [{ target: 'gain', points: [{ beat: 0, value: 0 }, { beat: 8, value: 1 }] }];
  const context = new Context(), renderer = new AudioRenderer(context);
  renderer.renderBar(program, 0, -Infinity, 0); renderer.renderBar(program, 2, -Infinity, 1);
  assert.equal(context.sources.length, 4);
  const automated = context.nodes.find(node => node.gain.events.some(event => event.time === 4 && event.value === 1));
  assert.ok(automated.gain.events.some(event => event.time === 2 && event.value === .5));
  renderer.dispose();
});

test('automated zero-mix delays allocate effects and retain maximum automated tail', () => {
  const program = song(); program.tracks[0].effects = [{ kind: 'delay', time: .1, feedback: 0, mix: 0 }];
  program.tracks[0].automation = [
    { target: 'delay.mix', points: [{ beat: 0, value: 0 }, { beat: 4, value: 1 }] },
    { target: 'delay.time', points: [{ beat: 0, value: .1 }, { beat: 4, value: 1 }] },
    { target: 'delay.feedback', points: [{ beat: 0, value: 0 }, { beat: 4, value: .8 }] },
  ];
  const context = new Context(), renderer = new AudioRenderer(context), bar = renderer.renderBar(program, 0);
  assert.ok(context.nodes.some(node => node.kind === 'delay')); assert.ok(bar.cleanupAt > 25); renderer.dispose();
});


test('cached schedule handles 1024 bars without rereading source patterns on subsequent bars', () => {
  const program = song(); program.tracks[0].steps = Array.from({ length: 64 }, () => ({ kind: 'hit' }));
  program.sections = [{ name: 'long', bars: 64, tracks: [{ track: 'kick' }] }]; program.timeline = [{ section: 'long', repeats: 16 }];
  const context = new Context(), renderer = new AudioRenderer(context);
  const first = renderer.renderBar(program, 0);
  Object.defineProperty(program.tracks[0], 'steps', { get() { throw new Error('Pattern reread after cached schedule'); } });
  const started = performance.now();
  for (let bar = 1; bar < 100; bar++) renderer.renderBar(program, bar * 2, -Infinity, bar).dispose();
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 1000, `Cached scheduling took ${elapsed}ms`); first.dispose(); renderer.dispose();
});

test('silent sections retain their timeline labels in transport state', async t => {
  environment(t); const player = new BangerPlayer(), program = song();
  program.sections = [{ name: 'silence', bars: 1, tracks: [] }, { name: 'beat', bars: 1, tracks: [{ track: 'kick' }] }];
  program.timeline = [{ section: 'silence' }, { section: 'beat' }];
  await player.start(program); assert.equal(player.state.section, 'silence'); assert.equal(player.state.songBar, 1); await player.dispose();
});


test('conditions count each named phrase independently, including late first use', () => {
  const program = compileMusic(`track k { sound "drums/kick"; rhythm "x!first x!every-2 x!every-4 x!fill x!not-fill x?0"; pattern late { rhythm "x!first"; } }
    section intro { bars 4; play k; } section outro { bars 2; play k late; } song { play intro; play outro; }`);
  const events = eventsForSong(program);
  assert.equal(events.filter(event => event.pattern === 'late').length, 1);
  assert.equal(events.find(event => event.pattern === 'late').beat, 16);
  assert.equal(events.filter(event => event.step.condition === 'first').length, 2);
  assert.equal(events.filter(event => event.step.condition === 'every-2').length, 2);
  assert.equal(events.filter(event => event.step.condition === 'every-4').length, 1);
  assert.equal(events.filter(event => event.step.condition === 'fill').length, 0);
  assert.equal(events.filter(event => event.step.probability === 0).length, 0);
  assert.equal(eventsForSong(program, 0, { cycle: 1 }).filter(event => event.step.condition === 'first').length, 0);
  const fill = eventsForSong(program, 0, { fill: true });
  assert.equal(fill.filter(event => event.step.condition === 'fill').length, 4);
  assert.equal(fill.filter(event => event.step.condition === 'not-fill').length, 0);
});

test('probability remains deterministic and bar events match song rendering', () => {
  const program = compileMusic('track k { sound "drums/kick"; bars 2; rhythm "x?.5 x?.5 x?.5 x?.5 x?.5 x?.5 x?.5 x?.5"; }');
  assert.deepEqual(eventsForSong(program), eventsForSong(program));
  assert.deepEqual([...eventsForBar(program, 0, 0), ...eventsForBar(program, 2, 1)], eventsForSong(program));
  assert.notDeepEqual(eventsForSong(program).map(event => event.index), eventsForSong(program, 0, { cycle: 1 }).map(event => event.index));
});

test('held Fill changes future notes within a bar without stopping started notes', async t => {
  environment(t); const player = new BangerPlayer();
  await player.start(compileMusic('track k { sound "drums/kick"; rhythm "x x!fill x!not-fill x!fill"; }'));
  const context = Context.instances[0], started = context.sources[0], normal = context.sources[1];
  context.currentTime = .3; player.setFill(true);
  assert.equal(started.stops.length, 0);
  assert.equal(normal.stops.length, 1);
  assert.deepEqual(context.sources.slice(2).map(source => source.starts[0]), [.55, 1.55]);
  context.currentTime = .8; player.setFill(false);
  assert.equal(context.sources[2].stops.length, 0);
  assert.equal(context.sources[3].stops.length, 1);
  assert.equal(context.sources.at(-1).starts[0], 1.05);
  await player.dispose();
});

test('master volume smooths live graphs and metronome stays out of export renders', async t => {
  environment(t); const player = new BangerPlayer(), program = song(); program.masterGain = .5; program.metronome = true;
  await player.start(program); const context = Context.instances[0];
  const master = context.nodes.find(node => node.connections.includes(context.destination));
  assert.equal(master.gain.value, .3);
  assert.equal(context.sources.filter(node => node.kind === 'oscillator').length, 4);
  context.currentTime = .2; player.update({ ...program, masterGain: .25 });
  assert.deepEqual(master.gain.events.at(-1), { value: .15, time: .2, constant: .01 });
  const offline = new Context(), renderer = new AudioRenderer(offline); renderer.renderSong(program);
  assert.equal(offline.sources.filter(node => node.kind === 'oscillator').length, 0);
  renderer.dispose(); await player.dispose();
});


test('holding Fill before Play is honored by the first bar', async t => {
  environment(t); const player = new BangerPlayer(); player.setFill(true);
  await player.start(compileMusic('track k { sound "drums/kick"; rhythm "x!fill"; }'));
  assert.equal(Context.instances[0].sources.length, 1);
  await player.dispose();
});

test('native synth sources use recipes, step locks and explicit override precedence', async () => {
  const { INSTRUMENT_PATCHES } = await import('@banger/compiler');
  const { synthForEvent } = await import('../dist/synth.js');
  for (const [name, patch] of Object.entries(INSTRUMENT_PATCHES)) {
    const program = compileMusic(`track voice { instrument "${name}"; notes "C2 G2"; lock 0 { volume .2; release .7; } }`);
    const events = eventsForSong(program);
    assert.deepEqual(synthForEvent(events[0]), { ...patch.config, volume: .2, release: .7 });
    assert.deepEqual(synthForEvent(events[1]), patch.config, 'locks cannot mutate recipes');
    const context = new Context(), renderer = new AudioRenderer(context);
    const rendered = renderer.renderSong(program);
    assert.ok(context.sources.length > 0);
    assert.ok(rendered.cleanupAt >= events[1].time + events[1].duration + patch.config.release);
    rendered.dispose(); renderer.dispose();
    assert.ok(context.nodes.every(node => node.connections.length === 0));
    const track = program.tracks[0];
    track.synth = { ...INIT_SYNTH, volume: .4 };
    assert.equal(synthForEvent(events[1]).volume, .4);
    track.modular = { name: 'renamed', config: { ...INIT_SYNTH, volume: .6 } };
    assert.equal(synthForEvent(events[1]).volume, .6);
    track.modular = null;
    assert.equal(synthForEvent(events[1]), null);
  }
});

test('808 glide and transient apply to the fundamental and sub together', async () => {
  const { INSTRUMENT_PATCHES } = await import('@banger/compiler');
  const config = INSTRUMENT_PATCHES['synth/808-bass'].config;
  const context = new Context();
  const result = scheduleSynth(context, context.destination, { time: 1, duration: 2, sustained: true, velocity: 1, step: { kind: 'note', midi: 48 } }, config, 36);
  const fundamental = result.pitchOscillators[0], sub = result.pitchOscillators.at(-1);
  assert.equal(fundamental.frequency.events.length, 2);
  for (let i = 0; i < 2; i++) {
    near(sub.frequency.events[i].value * 2, fundamental.frequency.events[i].value);
    near(sub.frequency.events[i].time, fundamental.frequency.events[i].time);
  }
  near(sub.frequency.events.at(-1).time, 1 + config.glide);
  const transient = context.nodes.find(node => node.kind === 'constant');
  assert.ok(transient.connections.includes(sub.detune));
  assert.deepEqual(transient.offset.events, [{ value: config.pitchEnv * 100, time: 1 }, { value: 0, time: 1 + config.pitchDecay }]);
  assert.ok(context.nodes.some(node => node.kind === 'shaper'));
});
