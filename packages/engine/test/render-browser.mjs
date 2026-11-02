import { compileMusic, copyMusicProgram, SOUND_NAMES, INSTRUMENT_NAMES } from '/compiler/index.js';
import { renderWav, renderStems, AudioRenderer, prepareAudio, eventsForSong } from '/engine/index.js';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
function rms(buffer, from = 0, to = buffer.duration, channel = 0) {
  const samples = buffer.getChannelData(channel); let sum = 0, count = 0;
  for (let i = Math.floor(from * buffer.sampleRate); i < Math.min(samples.length, Math.floor(to * buffer.sampleRate)); i++) { assert(Number.isFinite(samples[i]), 'Nonfinite audio'); sum += samples[i] ** 2; count++; }
  return Math.sqrt(sum / Math.max(1, count));
}
const options = { sampleRate: 16000, tailSeconds: 1.5 };
export async function run() {
  const report = {};
  const keySong = compileMusic(`tempo 120;
    track kick { sound "drums/kick"; bars 2; rhythm "x . . . x . . ."; gain 1; }
    track pad { instrument "synth/organ"; bars 2; piano { note "A3" start 0 duration 8 velocity .8; } gain .8;
      effect compressor { threshold -36; ratio 12; attack .001; release .08; knee 0; sidechain kick; }
    }`);
  const ducked = await renderWav(keySong, { ...options, stem: 'pad' });
  const drySong = copyMusicProgram(keySong); drySong.tracks[1].effects = [];
  const dry = await renderWav(drySong, { ...options, stem: 'pad' });
  const mutedSong = copyMusicProgram(keySong); mutedSong.tracks[0].gain = 0;
  const muted = await renderWav(mutedSong, { ...options, stem: 'pad' });
  const duckRatio = rms(ducked.buffer, .04, .15) / rms(dry.buffer, .04, .15);
  assert(duckRatio < .6, `Signal sidechain did not duck: ${duckRatio}`);
  assert(Math.abs(rms(muted.buffer, .1, .4) / rms(dry.buffer, .1, .4) - 1) < .02, `Muted key ratio ${rms(muted.buffer, .1, .4) / rms(dry.buffer, .1, .4)}`);
  assert(rms(ducked.buffer, .8, 1.1) / rms(dry.buffer, .8, 1.1) > .9, 'Sidechain did not recover');
  const lowKey = copyMusicProgram(keySong); lowKey.tracks[0].gain = .001;
  const low = await renderWav(lowKey, { ...options, stem: 'pad' });
  assert(rms(low.buffer, .04, .15) > rms(ducked.buffer, .04, .15) * 2, 'Sidechain ignores key amplitude');
  const automated = copyMusicProgram(keySong);
  automated.tracks[1].automation = [{ target: 'compressor.threshold', interpolation: 'step', points: [{ beat: 0, value: 0 }, { beat: 4, value: -50 }] }];
  const changed = await renderWav(automated, { ...options, stem: 'pad' });
  assert(rms(changed.buffer, 2.04, 2.15) < rms(changed.buffer, .04, .15) * .5, 'Sidechain threshold automation ignored');
  report.sidechain = { duckRatio, mutedKeyRatio: rms(muted.buffer, .1, .4) / rms(dry.buffer, .1, .4), recoveryRatio: rms(ducked.buffer, .8, 1.1) / rms(dry.buffer, .8, 1.1) };
  const song = compileMusic(`tempo 120;
    track keys { instrument "synth/keys"; bars 2; piano { note "C4" start 3 duration 5 velocity .7; }
      pattern high { bars 2; piano { note "C5" start 0 duration 7 velocity .8; } }
      output music; send space .2; gain .6; pan -.4;
      automation "pitch" { point 0 0; point 8 12; }
      automation "filter.cutoff" { point 0 300; point 8 6000; }
      automation "gain" { point 0 .2; point 8 .8; }
      effect filter { cutoff 300; } effect distortion { amount .1; mix .2; }
    }
    bus music { effect eq { low -3; mid 1; high 2; } effect compressor { threshold -20; ratio 2; } }
    bus space { effect delay { time .25; feedback .5; mix .5; } effect reverb { mix .5; } }
    section first { bars 2; play keys; }
    section second { bars 2; play keys high; }
    song { play first; play second; }
  `);
  const mix = await renderWav(song, options), stems = await renderStems(song, options);
  assert(eventsForSong(song).length === 2, 'Phrase was retriggered');
  assert(rms(mix.buffer, 2.1, 3.5) > .01, 'Sustained note lost at bar boundary');
  assert(rms(mix.buffer, 8, 8.5) > .00001, 'Effect tail lost');
  assert(mix.buffer.numberOfChannels === 2 && mix.buffer.length === 152000, 'Wrong output shape');
  assert(stems.keys.buffer.length === mix.buffer.length, 'Stem length mismatch');
  const wav = new DataView(mix.wav); assert(wav.getUint32(24, true) === 16000 && wav.getUint16(22, true) === 2 && wav.getUint32(40, true) === 608000, 'Wrong WAV header');
  assert(String.fromCharCode(...new Uint8Array(mix.wav, 0, 4)) === 'RIFF', 'Missing RIFF header');
  const meterContext = new OfflineAudioContext(2, 64000, 16000); await prepareAudio(meterContext);
  const renderer = new AudioRenderer(meterContext); renderer.renderSong(song);
  let meter;
  const paused = meterContext.suspend(2.5).then(async () => { meter = renderer.meters; await meterContext.resume(); });
  await meterContext.startRendering(); await paused;
  assert(meter.master.peak > 0 && meter.tracks.keys.rms > 0 && meter.buses.music.peak > 0, 'Meters are silent'); renderer.dispose();
  report.arrangement = { frames: mix.buffer.length, seconds: mix.duration, left: rms(mix.buffer), right: rms(mix.buffer, 0, mix.duration, 1), meter };
  report.voices = {};
  for (const name of [...SOUND_NAMES, ...INSTRUMENT_NAMES]) {
    const drum = name.startsWith('drums/');
    const voice = compileMusic(`track voice { ${drum ? 'sound' : 'instrument'} "${name}"; ${drum ? 'rhythm "x"' : 'notes "C4"'}; pan -1; }`);
    const result = await renderWav(voice, { sampleRate: 16000, tailSeconds: .7 });
    const left = rms(result.buffer), right = rms(result.buffer, 0, result.duration, 1);
    assert(left > .0001 && right < 1e-6, `Voice/pan failed: ${name}, ${left}, ${right}`); report.voices[name] = left;
  }
  const keyStems = await renderStems(keySong, options);
  assert(Object.values(keyStems).every(stem => stem.buffer.length === ducked.buffer.length), 'Stems not aligned');
  assert(Math.abs(rms(keyStems.pad.buffer, .04, .15) - rms(ducked.buffer, .04, .15)) < 1e-7, 'Single stem differs from stems export');
  const large = copyMusicProgram(keySong); large.tempo = 20; large.sections = [{ name: 'long', bars: 64, tracks: [{ track: 'pad' }] }]; large.timeline = [{ section: 'long', repeats: 16 }];
  let rejected = false; try { await renderWav(large, { sampleRate: 192000 }); } catch (error) { rejected = /512 MiB/.test(error.message); }
  assert(rejected, 'Large render did not reject before allocation');
  const aggregate = copyMusicProgram(large); aggregate.timeline[0].repeats = 4;
  for (let i = 0; i < 6; i++) aggregate.tracks.push({ ...copyMusicProgram(keySong).tracks[0], name: `extra${i}` });
  rejected = false; try { await renderStems(aggregate, { sampleRate: 16000 }); } catch (error) { rejected = /combined/.test(error.message); }
  assert(rejected, 'Aggregate stem memory was not guarded');
  const stereoContext = new OfflineAudioContext(2, 16000, 16000); await prepareAudio(stereoContext);
  const stereo = stereoContext.createBuffer(2, 16000, 16000); stereo.getChannelData(0).fill(.2);
  const source = stereoContext.createBufferSource(); source.buffer = stereo;
  const compressor = new AudioWorkletNode(stereoContext, 'banger-sidechain', { numberOfInputs: 2, outputChannelCount: [2] });
  source.connect(compressor).connect(stereoContext.destination); source.start();
  const stereoResult = await stereoContext.startRendering(); assert(rms(stereoResult, 0, 1, 0) > .19 && rms(stereoResult, 0, 1, 1) === 0, 'Sidechain leaked left into zero right channel');
  const pitched = compileMusic('tempo 240; track low { sound "drums/open-hat"; rhythm ". . . x"; automation "pitch" { point 0 -48; } }');
  const pitchedResult = await renderWav(pitched, { sampleRate: 16000 });
  assert(pitchedResult.duration > 11 && rms(pitchedResult.buffer, 2, 3) > .0001, 'Pitch-down drum tail truncated');
  report.stems = Object.keys(keyStems); report.memoryGuard = true; report.stereoSidechain = true; report.pitchTailSeconds = pitchedResult.tailSeconds;
  return report;
}
