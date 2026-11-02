import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileMusic, createDefaultProgram } from '@banger/compiler';
import { AudioRenderer, BangerPlayer, eventsForBar, barDuration } from '../dist/index.js';

class Param {
  value = 0;
  events = [];
  setValueAtTime(value, time) { this.events.push({ value, time }); }
  linearRampToValueAtTime(value, time) { this.events.push({ value, time }); }
  exponentialRampToValueAtTime(value, time) { assert.ok(value > 0); this.events.push({ value, time }); }
}
class Node {
  gain = new Param(); frequency = new Param(); detune = new Param(); delayTime = new Param(); Q = new Param(); pan = new Param(); connections = []; starts = []; stops = [];
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
  assert.equal(player.state.hasPendingUpdate, true); assert.equal(player.state.tempo, 120);
  context.currentTime = 1.96; env.tick();
  assert.equal(context.sources.length, 8);
  near(context.sources[5].starts[0], 2.3);
  assert.equal(player.state.hasPendingUpdate, true);
  context.currentTime = 2.06;
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
  assert.ok(feedback.gain.events.some(e => e.value === 0 && e.time < bar.cleanupAt));
  assert.ok(bar.cleanupAt > 4);
  bar.dispose(); renderer.dispose(); assert.ok(context.nodes.every(n => !n.connections.length));
});

test('delay tails are bounded and zero mixes avoid effect node allocation', () => {
  const context = new Context(), renderer = new AudioRenderer(context);
  const bar = renderer.renderBar(compileMusic(`track a { sound "drums/open-hat"; rhythm "x";
    effect delay { time 2; feedback .85; mix 1; } effect reverb { mix 0; } }`), 0);
  assert.ok(bar.cleanupAt <= 10.7);
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
