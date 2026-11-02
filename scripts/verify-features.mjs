import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { app, BrowserWindow } from 'electron';

// Exercises shared feature contracts with real Web Audio after all workers are integrated.
const root = new URL('../', import.meta.url);
let window;
const deadline = setTimeout(() => { console.error('Feature audio verification timed out'); app.exit(1); }, 90000);
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Feature audio verification</title><script type="importmap">{"imports":{"@banger/compiler":"/packages/compiler/dist/index.js"}}</script>');
    return;
  }
  if (!/^\/packages\/(compiler|engine)\/dist\/[a-z-]+\.js$/.test(path)) { response.writeHead(404); response.end(); return; }
  try { response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(new URL(path.slice(1), root))); }
  catch { response.writeHead(404); response.end(); }
});

async function run() {
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await app.whenReady();
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL(`http://127.0.0.1:${server.address().port}/`);
  const result = await window.webContents.executeJavaScript(`(async () => {
    const c = await import('/packages/compiler/dist/index.js');
    const e = await import('/packages/engine/dist/index.js');
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const clone = value => structuredClone(value);
    const canonical = value => JSON.stringify(value, (_key, item) => item && !Array.isArray(item) && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
    const synth = { ...c.INIT_SYNTH, attack: .005, decay: .05, sustain: .7, release: .08, glide: 0, lfo1Depth: 0, lfo2Depth: 0, sub: 0, drive: 0, filterEnv: 0, velocityFilter: 0, cutoff: 6000 };
    const song = c.compileMusic('tempo 240; track voice { instrument "synth/lead"; notes "C3 . G3 ."; gain .6; pattern B { bars 2; notes "C4 . G4 ."; } } track drum { sound "drums/kick"; rhythm "x . x ."; gain .5; } section intro { bars 1; play voice; play drum; } section chorus { bars 2; play voice B; play drum; } song { play intro; play chorus; }');
    song.masterGain = .7; song.metronome = true; song.chainEnabled = true;
    song.tracks[0].synth = synth;
    song.tracks[0].steps[0] = { kind: 'note', midi: 48, velocity: .8, probability: 1, condition: 'first', locks: { cutoff: 350, release: .2 } };
    song.tracks[0].patterns[0].steps[0].locks = { fm: .4 };
    song.tracks[0].patchLibrary = [{ name: 'Saved sound', config: clone(synth) }];
    song.tracks[1].muted = true;
    const roundtrip = c.compileMusic(c.serializeMusic(song));
    assert(canonical(roundtrip) === canonical(song), 'Combined project roundtrip lost fields');
    const options = { sampleRate: 16000, tailSeconds: .4 };
    const render = program => e.renderWav(program, options);
    const rms = buffer => { let energy = 0; for (let ch = 0; ch < buffer.numberOfChannels; ch++) for (const sample of buffer.getChannelData(ch)) { assert(Number.isFinite(sample), 'Nonfinite audio'); energy += sample * sample; } return Math.sqrt(energy / buffer.length / buffer.numberOfChannels); };
    const difference = (a, b) => { let max = 0; for (let ch=0; ch<a.numberOfChannels; ch++) { const x=a.getChannelData(ch), y=b.getChannelData(ch); for(let i=0;i<x.length;i++) max=Math.max(max,Math.abs(x[i]-y[i])); } return max; };
    const mix = await render(roundtrip);
    assert(rms(mix.buffer) > .001, 'Combined synth arrangement is silent');
    assert(mix.buffer.duration >= 3.4 && mix.buffer.duration < 3.401, 'Arrangement duration changed');
    const noClick = clone(song); noClick.metronome = false;
    const dry = await render(noClick);
    assert(difference(mix.buffer, dry.buffer) < 1e-6, 'Metronome leaked into export');
    const quiet = clone(song); quiet.masterGain *= .5;
    const quietMix = await render(quiet);
    const masterRatio = rms(quietMix.buffer) / rms(mix.buffer);
    assert(Math.abs(masterRatio - .5) < .001, 'Master volume did not scale exported audio');
    const stem = await e.renderWav(song, { ...options, stem: 'drum' });
    assert(rms(stem.buffer) === 0, 'Muted stem was audible');
    const loop = clone(song); loop.chainEnabled = false; loop.activePattern = 'B';
    assert(loop.timeline.length === 2 && c.programDurationBeats(loop) === 8, 'Chain off lost timeline or launched wrong duration');
    const loopAudio = await render(loop);
    assert(loopAudio.buffer.duration < mix.buffer.duration && rms(loopAudio.buffer) > .001, 'Pattern launch did not change export');
    const simple = c.compileMusic('tempo 240; track voice { instrument "synth/lead"; notes "C3 . C3 ."; gain .6; }');
    simple.tracks[0].synth = clone(synth);
    const reference = await render(simple);
    const zero = clone(simple); zero.tracks[0].steps.forEach(step => { if(step) step.probability = 0; });
    assert(rms((await render(zero)).buffer) === 0, 'Probability zero still rendered audio');
    const half = clone(simple); half.tracks[0].steps.forEach(step => { if(step) step.velocity = .5; });
    const velocityRatio = rms((await render(half)).buffer) / rms(reference.buffer);
    assert(Math.abs(velocityRatio - .5) < .001, 'Step velocity did not reach custom synthesis');
    const locked = clone(simple); locked.tracks[0].steps[0].locks = { cutoff: 50 };
    const lockedAudio = await render(locked);
    assert(difference(lockedAudio.buffer, reference.buffer) > .005, 'Parameter lock did not change audio');
    const first = lockedAudio.buffer.getChannelData(0), second = reference.buffer.getChannelData(0);
    let afterLock = 0; for(let i=8000;i<first.length;i++) afterLock=Math.max(afterLock,Math.abs(first[i]-second[i]));
    assert(afterLock < 1e-5, 'Parameter lock leaked into following step');
    const off = clone(simple); off.tracks[0].synth.enabled = false;
    assert(rms((await render(off)).buffer) === 0, 'Disabled synth is audible');
    const clear = clone(simple); clear.tracks[0].modular = null;
    assert(rms((await render(clear)).buffer) === 0, 'Cleared modular patch is audible');
    const preset = clone(simple); preset.tracks[0].modular = clone(c.FACTORY_PATCHES.find(patch => patch.name === 'FM Bell'));
    assert(rms((await render(preset)).buffer) > .001, 'Factory modular patch is silent');
    const wav = new DataView(mix.wav);
    assert(wav.getUint16(22, true) === 2 && wav.getUint32(24, true) === 16000, 'WAV format changed');
    return { combinedRoundtrip: true, arrangementSeconds: mix.buffer.duration, masterRatio, velocityRatio, lockIsolationPeakDifference: afterLock, mutedStem: true, metronomeExcluded: true, probabilityZero: true, chainLaunch: true, disabledAndClearSilent: true, factoryPatch: true };
  })()`, true);
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error); process.exitCode = 1; }
finally { clearTimeout(deadline); window?.destroy(); server.close(); app.exit(process.exitCode ?? 0); }

}
void run();
