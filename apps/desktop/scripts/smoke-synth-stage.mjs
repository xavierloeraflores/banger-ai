import assert from 'node:assert/strict';
import { app } from 'electron';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { compileMusic, serializeMusic, FACTORY_PATCHES, INSTRUMENT_PATCHES } from '../../../packages/compiler/dist/index.js';
import { enterStudio } from './smoke-startup.mjs';

const profile = await mkdtemp(join(tmpdir(), 'banger-synth-stage-'));
app.setPath('userData', profile);
app.once('will-quit', () => { void rm(profile, { recursive: true, force: true }); });
const extended = process.argv.includes('--extended');
const sources = Object.keys(INSTRUMENT_PATCHES);
const names = extended ? Object.values(INSTRUMENT_PATCHES).map(patch => patch.name) : ['Synth Brass', 'Flute Lead', 'Chiptune Lead', 'String Ensemble', 'Kalimba Pluck', 'Noise Riser'];
const roles = extended ? 'bass808,marimba,woodblock,downlifter,impact,mutedGuitar' : 'brass,flute,chiptune,strings,kalimba,riser';
const graphicsErrors = [];
app.on('web-contents-created', (_event, contents) => contents.on('console-message', details => {
  if (/THREE.WebGLProgram|GL_INVALID|Shader Error|WebGL: INVALID/.test(details.message)) graphicsErrors.push(details.message);
}));
const timeout = setTimeout(() => { console.error('Synth stage smoke timed out'); app.exit(1); }, 120000);
app.on('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', async () => {
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  const wait = async code => { for (let i = 0; i < 600; i++) { if (await evaluate(code)) return; await delay(30); } throw new Error(`Timed out: ${code}`); };
  const click = async text => {
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)} && !button.closest('[hidden]')).click()`);
    await delay(60);
  };
  const apply = async program => {
    await click('Raw .banger');
    await evaluate(`(() => { const el = document.querySelector('#producer-source'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(serializeMusic(program))}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await delay(60); await click('Apply source'); await click('Sequencer');
  };
  try {
    window.webContents.setBackgroundThrottling(false);
    await enterStudio(window); window.setSize(1500, 1000);
    const program = compileMusic(`tempo 90; ${names.map((_, i) => `track part_${i} { instrument "${extended ? sources[i] : 'synth/bass'}"; piano { note "C4" start 0 duration 3 velocity .8; note "E4" start 0 duration 1 velocity .6; note "G4" start 1 duration .25 velocity .7; } gain .3; }`).join('\n')}`);
    if (!extended) names.forEach((name, i) => { program.tracks[i].synth = globalThis.structuredClone(FACTORY_PATCHES.find(patch => patch.name === name).config); });
    // Cover unnamed synth data and a renamed modular patch overriding the source.
    program.tracks[1].modular = { name: 'My patch', config: extended ? INSTRUMENT_PATCHES[sources[1]].config : program.tracks[1].synth };
    await apply(program); await click('Band stage');
    const canvas = "document.querySelector('.performance-viewport canvas')";
    await wait(`${canvas}?.dataset.instruments === '${roles}' && ${canvas}.dataset.playing === 'true'`);
    const outfits = await evaluate(`${canvas}.dataset.outfits`);
    await delay(400);
    assert.equal(window.webContents.isCurrentlyAudible(), true, 'real audio plays alongside the stage');
    await writeFile('/tmp/banger-synth-stage-playing.png', (await window.webContents.capturePage()).toPNG());
    await click('Stop'); await wait(`${canvas}.dataset.playing === 'false'`);
    await delay(400);
    assert.equal(await evaluate(`${canvas}.dataset.instruments`), roles);
    assert.equal(await evaluate(`${canvas}.dataset.outfits`), outfits);
    await writeFile('/tmp/banger-synth-stage-idle.png', (await window.webContents.capturePage()).toPNG());
    await evaluate("document.querySelector('[aria-label=\"Close band stage\"]').click()");
    for (let i = 0; i < names.length; i++) {
      const single = { ...program, tracks: [{ ...program.tracks[i], name: 'part_' + names[i].replaceAll(' ', '_') }] };
      await apply(single); await click('Band stage');
      await wait(`${canvas}?.dataset.instruments === '${roles.split(',')[i]}' && ${canvas}.dataset.playing === 'true'`);
      await wait(`Number(${canvas}.dataset.beat) % 4 > .35 && Number(${canvas}.dataset.beat) % 4 < .8`);
      await writeFile(`/tmp/banger-synth-stage-${roles.split(',')[i]}.png`, (await window.webContents.capturePage()).toPNG());
      await evaluate("document.querySelector('[aria-label=\"Close band stage\"]').click()");
      await wait(`!${canvas}`);
    }
    const locked = compileMusic('tempo 90; track same_track { instrument "synth/bass"; notes "C4 C4 C4 C4"; gain .2; }');
    locked.tracks[0].synth = globalThis.structuredClone(FACTORY_PATCHES.find(patch => patch.name === 'Noise Riser').config);
    locked.tracks[0].steps[1].locks = { attack: .001, noise: 0, tone: 1 };
    await apply(locked); await click('Band stage');
    // The editor update reaches audio at the next bar; wait for its locked note.
    await wait(`${canvas}?.dataset.instruments === 'keys'`);
    await wait(`${canvas}.dataset.instruments === 'riser'`);
    await evaluate(`void (window.originalSynthCanvas = ${canvas})`);
    const lockedOutfit = await evaluate(`${canvas}.dataset.outfits`);
    await wait(`${canvas}.dataset.instruments === 'keys'`);
    await wait(`${canvas}.dataset.instruments === 'riser'`);
    assert.equal(await evaluate(`${canvas} === window.originalSynthCanvas`), true, 'step locks replace only the instrument');
    assert.equal(await evaluate(`${canvas}.dataset.outfits`), lockedOutfit, 'instrument replacement preserves the character');
    await evaluate("document.querySelector('[aria-label=\"Close band stage\"]').click()");
    await wait(`!${canvas}`);
    assert.deepEqual(graphicsErrors, []);
    console.log(`Synth stage smoke passed: ${extended ? 'six native instrument roles' : 'six effective preset roles'}, renamed modular override, audio playback, stop/idle, stable outfits, six close-up renders and repeated disposal.`);
    clearTimeout(timeout); app.exit(0);
  } catch (error) {
    await writeFile('/tmp/banger-synth-stage-failure.png', (await window.webContents.capturePage()).toPNG());
    console.error(error); clearTimeout(timeout); app.exit(1);
  }
}));
await import('../dist/main.js');
