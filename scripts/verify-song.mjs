import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

// Run with: pnpm --filter @banger/desktop exec electron ../../scripts/verify-song.mjs
const root = new URL('../', import.meta.url);
const source = await readFile(new URL('examples/night-drive.banger', root), 'utf8');
let window;
const deadline = setTimeout(() => { console.error('Song verification timed out'); app.exit(1); }, 120000);
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Song verification</title><script type="importmap">{"imports":{"@banger/compiler":"/packages/compiler/dist/index.js"}}</script>');
    return;
  }
  if (!/^\/packages\/(compiler|engine)\/dist\/[a-z-]+\.js$/.test(path)) {
    response.writeHead(404); response.end(); return;
  }
  try {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(await readFile(fileURLToPath(new URL(path.slice(1), root))));
  } catch { response.writeHead(404); response.end(); }
});

async function run() {
try {
  console.log('Starting song verification');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await app.whenReady();
  console.log('Electron ready');
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL(`http://127.0.0.1:${server.address().port}/`);
  console.log('Rendering example mix and stems');
  const report = await window.webContents.executeJavaScript(`(async () => {
    const compiler = await import('/packages/compiler/dist/index.js');
    const engine = await import('/packages/engine/dist/index.js');
    const song = compiler.compileMusic(${JSON.stringify(source)});
    const checked = compiler.compileMusic(compiler.serializeMusic(compiler.copyMusicProgram(song)));
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const canonical = value => JSON.stringify(value, (_key, item) => item && !Array.isArray(item) && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
    assert(canonical(checked) === canonical(song), 'Song roundtrip changed musical data');
    assert(compiler.programDurationBeats(song) === 160, 'Expected 40 bars');
    const clips = compiler.resolveArrangement(song);
    assert(clips.some(clip => clip.pattern === 'chorus'), 'Named chorus pattern not resolved');
    const events = engine.eventsForSong(song);
    assert(events.length > 100, 'Arrangement did not expand');
    assert(events.some(event => event.duration > engine.barDuration(song)), 'Sustained phrase notes were truncated');
    const used = new Set(events.map(event => event.track.source.name));
    for (const name of ['drums/kick', 'drums/snare', 'drums/hat', 'synth/bass', 'synth/lead', 'synth/pad', 'synth/bell', 'synth/keys']) {
      assert(used.has(name), 'Missing voice ' + name);
    }
    const options = { sampleRate: 22050 };
    const mix = await engine.renderWav(song, options);
    const inspect = (rendered, label) => {
      const header = new DataView(rendered.wav);
      const text = (offset, size) => String.fromCharCode(...new Uint8Array(rendered.wav, offset, size));
      assert(text(0, 4) === 'RIFF' && text(8, 4) === 'WAVE', label + ' lacks WAV header');
      assert(header.getUint16(20, true) === 1 && header.getUint16(34, true) === 16, label + ' is not PCM16');
      assert(header.getUint16(22, true) === 2 && header.getUint32(24, true) === options.sampleRate, label + ' channel/rate mismatch');
      assert(header.getUint32(4, true) === rendered.wav.byteLength - 8, label + ' size mismatch');
      assert(rendered.buffer.duration >= engine.songDuration(song), label + ' omitted song bars');
      let energy = 0, peak = 0;
      for (let channel = 0; channel < rendered.buffer.numberOfChannels; channel++) {
        for (const value of rendered.buffer.getChannelData(channel)) {
          assert(Number.isFinite(value), label + ' has nonfinite audio');
          energy += value * value; peak = Math.max(peak, Math.abs(value));
        }
      }
      const rms = Math.sqrt(energy / rendered.buffer.length / rendered.buffer.numberOfChannels);
      assert(rms > .00001, label + ' is silent');
      return { duration: rendered.buffer.duration, bytes: rendered.wav.byteLength, rms, peak };
    };
    const mixReport = inspect(mix, 'Mix');
    const stems = await engine.renderStems(song, options);
    assert(Object.keys(stems).length === song.tracks.length, 'Missing stems');
    const stemReport = {};
    for (const track of song.tracks) {
      assert(stems[track.name], 'Missing stem ' + track.name);
      stemReport[track.name] = inspect(stems[track.name], track.name);
      assert(stems[track.name].buffer.length === mix.buffer.length, 'Stem alignment differs');
    }
    return { bars: 40, clips: clips.length, events: events.length, mix: mixReport, stems: stemReport };
  })()`, true);
  assert.equal(report.bars, 40);
  console.log(JSON.stringify(report, null, 2));
  console.log('Song verification passed: roundtrip, arrangement, sustained notes, every voice, full WAV and aligned audible stems.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  window?.destroy();
  server.close();
  app.exit(process.exitCode ?? 0);
}
}
void run();
