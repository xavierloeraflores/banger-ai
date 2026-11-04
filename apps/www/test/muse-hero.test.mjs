import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as compiler from '@banger/compiler';
import * as engine from '@banger/engine';

const source = await readFile(new URL('../src/lib/muse-hero.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: name => name === '@banger/compiler' ? compiler : engine });
const { createHeroChart, HeroRun } = exports;

test('chart follows the arranged audio events and clips sustained notes', () => {
  const program = compiler.compileMusic('tempo 120; track keys { instrument "synth/keys"; piano { note "C4" start 0 duration 3 velocity 1; note "C4" start 2 duration 2 velocity 1; } } section a { bars 2; play keys; } song { play a; }');
  const chart = createHeroChart(program);
  assert.equal(chart.duration, 8);
  assert.equal(chart.notes.length, 8);
  assert.deepEqual(Array.from(chart.notes, n => n.time), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(chart.notes[0].end, 1);
  assert.ok(chart.notes.every(note => note.lane >= 0 && note.lane < 5 && note.end <= chart.duration));
});

test('chart excludes muted and non-solo tracks, supports track selection, and merges layered notes', () => {
  const program = compiler.compileMusic('tempo 120; track a { instrument "synth/keys"; notes "C4 ."; } track b { instrument "synth/keys"; notes "C4 ."; }');
  const chart = createHeroChart(program);
  assert.equal(chart.notes.length, 4);
  assert.equal(createHeroChart(program, 'missing').notes.length, 0);
  program.tracks[0].solo = true;
  assert.equal(createHeroChart(program, 'b').notes.length, 0);
  program.tracks[0].muted = true;
  assert.equal(createHeroChart(program).notes.length, 0);
});

test('chart preserves groove and probability decisions on each repeated pass', () => {
  const program = compiler.compileMusic('tempo 120; track kick { sound "drums/kick"; rhythm "x x x x"; groove { swing .2; humanize .008; seed 17; } }');
  const chart = createHeroChart(program);
  const expected = Array.from({ length: 4 }, (_, cycle) => engine.eventsForSong(program, 0, { cycle }).map(event => event.time + cycle * 2)).flat();
  assert.deepEqual(Array.from(chart.notes, n => n.time), expected);
});

test('difficulty maps pitched notes and percussion into every available lane', () => {
  const pitched = compiler.compileMusic('tempo 120; track keys { instrument "synth/keys"; notes "C4 D4 E4 F4 G4 A4 B4 C5"; }');
  const drums = compiler.compileMusic(Array.from({ length: 5 }, (_, i) => `track drum${i} { sound "drums/kick"; rhythm "x . . ."; }`).join(' '));
  for (const laneCount of [2, 3, 4, 5]) {
    for (const program of [pitched, drums]) {
      const chart = createHeroChart(program, '', laneCount);
      assert.deepEqual([...new Set(chart.notes.map(note => note.lane))].sort(), Array.from({ length: laneCount }, (_, i) => i));
      assert.ok(chart.notes.every(note => note.lane >= 0 && note.lane < laneCount));
      const run = new HeroRun(chart);
      run.advance(chart.duration + 1, true);
      assert.equal(run.stats.miss, 0);
      assert.equal(run.stats.perfect, chart.notes.length);
    }
  }
  assert.equal(Math.max(...createHeroChart(pitched).notes.map(note => note.lane)), 3, 'Normal defaults to four lanes');
});

test('hit windows, misses, combo multiplier, duplicate hits and holds', () => {
  const notes = Array.from({ length: 12 }, (_, id) => ({ id, lane: id % 5, time: id, end: id }));
  notes.push({ id: 12, lane: 2, time: 12, end: 14 });
  const run = new HeroRun({ notes, duration: 15 });
  for (let id = 0; id < 10; id++) run.hit(id % 5, id);
  assert.equal(run.stats.perfect, 10);
  assert.equal(run.multiplier, 2);
  assert.equal(run.stats.score, 1100);
  assert.equal(run.hit(4, 9), false);
  assert.equal(run.stats.combo, 0);
  run.hit(0, 10.08);
  run.hit(1, 11.15);
  assert.equal(run.stats.great, 1);
  assert.equal(run.stats.good, 1);
  run.hit(2, 12);
  run.release(2, 13);
  assert.equal(run.judgment, 'Hold lost');
  assert.equal(run.stats.held, 0);
  run.advance(15, false);
  assert.equal(run.stats.miss, 0);
});

test('unplayed notes expire once, autoplay completes chords and holds, and released sustains lose their bonus', () => {
  const chart = { notes: [{ id: 0, lane: 0, time: 1, end: 3 }, { id: 1, lane: 2, time: 1, end: 1 }, { id: 2, lane: 4, time: 2, end: 2 }], duration: 4 };
  const missed = new HeroRun(chart);
  missed.advance(5, false); missed.advance(6, false);
  assert.equal(missed.stats.miss, 3);
  assert.equal(missed.accuracy, 0);
  const auto = new HeroRun(chart);
  auto.advance(1.02, true); auto.advance(2.03, true); auto.advance(3.1, true);
  assert.equal(auto.stats.perfect, 3);
  assert.equal(auto.stats.held, 1);
  assert.equal(auto.stats.score, 350);
  assert.equal(auto.accuracy, 100);
  const early = new HeroRun(chart);
  early.hit(0, 1); early.release(0, 1.5); early.advance(4, false);
  assert.equal(early.stats.held, 0);
  assert.equal(early.stats.score, 100);
});
