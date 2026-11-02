import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { compileMusic, serializeMusic } from "../../../packages/compiler/dist/index.js";

// Shared by the secure desktop app and the HTTP web app, without a preload bridge.
export async function smokePiano(window) {
  const evaluate = code => window.webContents.executeJavaScript(code, true).catch(error => { throw new Error(`${error.message} while evaluating: ${code}`); });
  const waitFor = async (code, label) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await evaluate(code)) return;
      await setTimeout(25);
    }
    throw new Error(`Piano smoke timed out: ${label}`);
  };
  const clickText = async text => {
    await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)});
      if (!button || button.matches(':disabled')) throw new Error('Unavailable button: ${text}');
      button.click();
    })()`);
  };
  const source = () => evaluate("document.querySelector('#producer-source').value");
  const editSource = async text => {
    await clickText('Raw .banger');
    await evaluate(`(() => {
      const input = document.querySelector('#producer-source');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  };
  const apply = async text => {
    await editSource(text);
    await waitFor("document.querySelector('#producer-source').getAttribute('aria-invalid') === 'false'", 'valid source');
    await clickText('Apply source'); await clickText('Sequencer');
    await evaluate("document.querySelector('[aria-label=\"Edit keys\"]').click()");
    await waitFor("document.querySelector('.producer-source-status').textContent === 'In sync'", 'applied source');
  };
  const point = async (selector, fraction = .5) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center' })`);
    const rect = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; })()`);
    return { x: Math.round(rect.x + rect.width * fraction), y: Math.round(rect.y + rect.height / 2) };
  };
  const mouse = (type, p) => window.webContents.sendInputEvent({ type, ...p, button: 'left', clickCount: 1 });
  const click = async (selector, fraction) => {
    const p = await point(selector, fraction);
    mouse('mouseMove', p); mouse('mouseDown', p); mouse('mouseUp', p);
    await setTimeout(60);
  };
  const drag = async (selector, beats, rows = 0, cancel = false) => {
    const p = await point(selector);
    const width = await evaluate("document.querySelector('.piano-grid').clientWidth");
    const end = { x: Math.round(p.x + width * beats / 4), y: p.y + rows * 22 };
    mouse('mouseMove', p); mouse('mouseDown', p); await setTimeout(25);
    mouse('mouseMove', end); await setTimeout(25);
    if (cancel) {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await setTimeout(25);
    }
    mouse('mouseUp', end); await setTimeout(60);
  };
  const readNotes = async () => compileMusic(await source()).tracks[1].pianoRoll;
  await apply('tempo 120; track drum { sound "drums/kick"; rhythm "x . x . . . x ."; gain .5; } track keys { instrument "synth/pluck"; notes "C4 . G4"; gain .3; }');
  await waitFor("document.querySelector('.piano-scroll').scrollTop > 1000", 'source-applied roll scrolls to its notes');
  assert.equal(await evaluate("document.querySelectorAll('.producer-step').length"), 11);
  assert.equal(await evaluate("document.querySelectorAll('.piano-note').length"), 2);
  const legacy = await source();
  await click('.piano-note-body');
  assert.equal(await source(), legacy, 'Selecting a legacy note must not convert or rewrite it.');
  await click('.piano-row[data-midi="64"]', .02);
  await waitFor("document.querySelectorAll('.piano-note').length === 3", 'click adds chord');
  let notes = await readNotes();
  assert.deepEqual(notes.map(n => n.midi), [60, 67, 64]);
  assert.equal(notes[1].start, 8 / 3, 'Legacy mixed-length onset is preserved.');
  assert.equal(notes[2].start, 0); assert.equal(notes[2].velocity, .8);
  await drag('.piano-note:last-of-type .piano-note-body', .5, -1);
  await waitFor("document.querySelectorAll('.piano-note')[2].dataset.start === '0.5'", 'drag move');
  notes = await readNotes();
  assert.equal(notes[2].start, .5); assert.equal(notes[2].midi, 65);
  await drag('.piano-note:last-of-type .piano-note-resize', .75);
  await waitFor("document.querySelectorAll('.piano-note')[2].dataset.duration === '1'", 'resize');
  assert.equal((await readNotes())[2].duration, 1);
  const beforeCancel = await source();
  await drag('.piano-note:last-of-type .piano-note-body', .25, 0, true);
  assert.equal(await source(), beforeCancel, 'Escape cancels without source changes.');
  await evaluate(`(() => {
    const input = document.querySelector('[aria-label="keys note velocity"]');
    input.focus(); input.value = '0.35'; input.dispatchEvent(new Event('input', { bubbles: true })); input.blur();
  })()`);
  await waitFor("document.querySelectorAll('.piano-note')[2].dataset.velocity === '0.35'", 'velocity edit');
  assert.equal((await readNotes())[2].velocity, .35);
  // Keyboard edits use the same source update path as pointer gestures.
  await evaluate("document.querySelectorAll('.piano-note-body')[2].focus()");
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
  await waitFor("document.querySelectorAll('.piano-note')[2].dataset.start === '0.75'", 'keyboard move');
  await evaluate("document.querySelectorAll('.piano-note-resize')[2].focus()");
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
  await waitFor("document.querySelectorAll('.piano-note')[2].dataset.duration === '1.25'", 'keyboard resize');
  await clickText('Delete note');
  assert.equal((await readNotes()).length, 2);
  await click('.piano-row[data-midi="64"]', .02);
  await click('.piano-row[data-midi="67"]', .02);
  let chordSource = await source();
  assert.deepEqual(compileMusic(serializeMusic(compileMusic(chordSource))), compileMusic(chordSource));
  assert.match(chordSource, /rhythm "x . x . . . x ."/);

  // Solo the instrument so the audibility check cannot pass from drums alone.
  await evaluate("document.querySelector('[aria-label=\"Solo keys\"]').click()");
  await evaluate("document.querySelector('.producer-play').click()");
  await waitFor("document.querySelector('.producer-transport-state').textContent === 'Playing' && !!document.querySelector('.piano-playhead')", 'piano playback');
  const position = await evaluate("document.querySelector('.piano-playhead').style.left");
  await waitFor(`document.querySelector('.piano-playhead').style.left !== ${JSON.stringify(position)}`, 'piano playhead advances');
  const deadline = Date.now() + 3000;
  while (!window.webContents.isCurrentlyAudible() && Date.now() < deadline) await setTimeout(25);
  assert.equal(window.webContents.isCurrentlyAudible(), true, 'Piano alone produces real audio.');
  await evaluate("document.querySelector('.piano-note-body').focus()");
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Up' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Up' });
  await waitFor("document.querySelector('.piano-note').dataset.midi === '61'", 'piano edit during playback');
  await waitFor("document.querySelector('.producer-transport-state').textContent === 'Playing'", 'edit reaches next bar');
  assert.equal(await evaluate("!!document.querySelector('.producer-alert')"), false);
  chordSource = await source();
  await editSource('track broken { piano {');
  await waitFor("document.querySelector('#producer-source').getAttribute('aria-invalid') === 'true'", 'invalid draft');
  await clickText('Sequencer');
  assert.equal(await evaluate("document.querySelector('.piano-note-body').matches(':disabled')"), true);
  assert.equal(await evaluate("document.querySelectorAll('.piano-note').length"), 4);
  assert.equal(await evaluate("document.querySelector('.producer-play').disabled"), true, 'Playback continues.');
  assert.equal(await source(), 'track broken { piano {');
  await clickText('Raw .banger'); await clickText('Revert draft'); await clickText('Sequencer');
  assert.equal(await source(), chordSource);
  await evaluate("document.querySelector('[aria-label=\"Stop playback\"]').click()");
  await waitFor("!document.querySelector('.piano-playhead')", 'stopped piano');
  await apply(chordSource.replace('tempo 120', 'tempo 137'));
  assert.equal(await evaluate("document.querySelector('#producer-tempo').value"), '137');
  assert.equal(await evaluate("document.querySelectorAll('.piano-note').length"), 4);
  assert.equal(await evaluate("document.querySelectorAll('.producer-step').length"), 8);
  console.log('Piano smoke passed: legacy conversion, chord add, real pointer move/resize/cancel, velocity, delete, round trip, source apply, piano-only audio, playhead and invalid draft.');
  return source();
}
