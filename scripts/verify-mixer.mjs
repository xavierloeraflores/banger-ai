import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { app, BrowserWindow } from 'electron';

const root = new URL('../', import.meta.url);
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Mixer verification</title><script type="importmap">{"imports":{"@banger/compiler":"/packages/compiler/dist/index.js"}}</script>'); return;
  }
  if (!/^\/packages\/(compiler|engine)\/dist\/[a-z-]+\.js$/.test(path)) { response.writeHead(404); response.end(); return; }
  try { response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(new URL(path.slice(1), root))); }
  catch { response.writeHead(404); response.end(); }
});
let window;
const timeout = setTimeout(() => { console.error('Mixer audio verification timed out'); app.exit(1); }, 60000);
async function run() {
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await app.whenReady();
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL(`http://127.0.0.1:${server.address().port}/`);
  const report = await window.webContents.executeJavaScript(`(async () => {
    const { compileMusic, serializeMusic, programDurationBeats } = await import('/packages/compiler/dist/index.js');
    const { renderWav, renderStems, BangerPlayer } = await import('/packages/engine/dist/index.js');
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const source = 'tempo 240; track voice { instrument "synth/keys"; piano { note "C4" start 0 duration 4 velocity .8; } gain .6; pan -.7; automation "gain" { point 0 .6; point 4 1; } } section silent { bars 2; } section music { bars 1; play voice; } song { play silent; play music; }';
    const song = compileMusic(source), options = { sampleRate: 22050, tailSeconds: .1 };
    const energy = buffer => { let sum = 0; for (let c = 0; c < buffer.numberOfChannels; c++) for (const value of buffer.getChannelData(c)) { check(Number.isFinite(value), 'Nonfinite sample'); sum += value * value; } return sum; };
    const chained = await renderWav(song, options);
    const loop = compileMusic(serializeMusic({ ...song, chainEnabled: false }));
    check(JSON.stringify(loop.timeline) === JSON.stringify(song.timeline), 'Chain toggle lost timeline');
    check(programDurationBeats(loop) === 4 && programDurationBeats(song) === 12, 'Chain duration mismatch');
    const audible = await renderWav(loop, options);
    check(energy(audible.buffer) > 1, 'Loop is silent');
    check(audible.duration < chained.duration, 'Export did not use chain mode');
    const muted = compileMusic(serializeMusic({ ...loop, tracks: loop.tracks.map(track => ({ ...track, muted: true })) }));
    check(energy((await renderWav(muted, options)).buffer) === 0, 'Gain automation bypassed mute');
    check(energy((await renderStems(muted, options)).voice.buffer) === 0, 'Stem bypassed mute');
    const withSolo = compileMusic(serializeMusic({ ...loop, tracks: [loop.tracks[0], { name: 'silent', source: { kind: 'sound', name: 'drums/kick' }, steps: [null], gain: 1, solo: true }] }));
    check(energy((await renderWav(withSolo, options)).buffer) === 0, 'Solo did not exclude voice');
    const left = audible.buffer.getChannelData(0).reduce((sum, value) => sum + value * value, 0);
    const right = audible.buffer.getChannelData(1).reduce((sum, value) => sum + value * value, 0);
    check(left > right * 2, 'Pan did not change stereo audio');
    // Compare deterministic rendered audio through the same graph used for playback.
    const routing = compileMusic('tempo 240; track tone { instrument "synth/keys"; notes "C4"; gain .6; }');
    const renderedEnergy = async program => energy((await renderWav(compileMusic(serializeMusic(program)), options)).buffer);
    const reference = await renderedEnergy(routing);
    const ratio = async (program, expected, label) => {
      const actual = await renderedEnergy(program) / reference;
      check(Math.abs(actual - expected) < .001, label + ': ' + actual);
      return actual;
    };
    const routed = { ...routing, buses: [{ name: 'group', gain: .5 }], tracks: routing.tracks.map(track => ({ ...track, output: 'group' })) };
    const routedRatio = await ratio(routed, .25, 'Track output bypassed bus gain');
    const sent = { ...routing, buses: [{ name: 'silent', gain: 0 }, { name: 'return', gain: 1 }], tracks: routing.tracks.map(track => ({ ...track, output: 'silent', sends: [{ bus: 'return', gain: .5 }] })) };
    const sendRatio = await ratio(sent, .25, 'Send did not reach return bus');
    await ratio({ ...sent, tracks: sent.tracks.map(track => ({ ...track, gain: .3 })) }, .0625, 'Send is not post-fader');
    await ratio({ ...sent, tracks: sent.tracks.map(track => ({ ...track, muted: true, automation: [{ target: 'gain', points: [{ beat: 0, value: .6 }, { beat: 4, value: 1 }] }] })) }, 0, 'Muted send leaked audio');
    await ratio({ ...sent, tracks: [...sent.tracks, { name: 'solo_silence', source: { kind: 'sound', name: 'drums/kick' }, gain: 1, steps: [null], solo: true }] }, 0, 'Solo exclusion leaked through send');
    await ratio({ ...sent, tracks: sent.tracks.map(track => ({ ...track, solo: true })) }, .25, 'Solo lost routed send');
    await ratio({ ...sent, tracks: sent.tracks.map(track => ({ ...track, muted: true, solo: true })) }, 0, 'Solo bypassed mute');
    await ratio({ ...routed, masterGain: .5 }, .0625, 'Master did not scale routed output');
    await ratio({ ...routed, masterGain: 0 }, 0, 'Master zero leaked output');
    const busSendRatio = await ratio({ ...routed, buses: [{ name: 'group', gain: .5, sends: [{ bus: 'return', gain: .5 }] }, { name: 'return', gain: 1 }] }, .5625, 'Bus send did not preserve direct master output');
    const player = new BangerPlayer();
    await player.start(loop); await new Promise(resolve => setTimeout(resolve, 180));
    check(player.state.playing && player.state.section === undefined, 'Unchained playback retained section label');
    player.stop(); await player.dispose();
    return { chainedSeconds: chained.duration, loopSeconds: audible.duration, audibleEnergy: energy(audible.buffer), panEnergyRatio: left / right, mutedMixAndStem: 'silent', solo: 'silent', livePlayback: 'passed', routedRatio, sendRatio, busSendRatio, routedMuteSoloAndMaster: 'passed' };
  })()`, true);
  console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error(error); process.exitCode = 1; }
finally { clearTimeout(timeout); window?.destroy(); server.close(); app.exit(process.exitCode ?? 0); }

}
void run();
