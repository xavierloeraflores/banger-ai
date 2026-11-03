import { enterStudio } from "./smoke-startup.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { smokePiano } from "./smoke-piano.mjs";
import { dialog } from "electron";
import { compileMusic } from "../../../packages/compiler/dist/index.js";

const mixedLengthSource = `tempo 137;
meter 4/4;
track smoke_kick { sound "drums/kick"; rhythm "x . x . . . x ."; gain 0.5; }
track smoke_bass { instrument "synth/bass"; notes "C2 . G2"; gain 0.3; }
`;
const replacementSource = `tempo 91;
meter 4/4;
track replacement { sound "drums/hat"; rhythm "x . . ."; gain 0.2; }
`;
const applyButton = `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Apply source')`;
const gridSnapshot = `[...document.querySelectorAll('.producer-track')].map(track => ({
  name: track.querySelector('.producer-track-name').value,
  steps: [...track.querySelectorAll('.producer-step')].map(step => step.getAttribute('aria-pressed')),
}))`;

export async function smokeProducer(window, directory) {
  await enterStudio(window);
  const evaluate = (script) => window.webContents.executeJavaScript(script, true);
  async function waitFor(script, label, timeout = 5_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(script)) return;
      await setTimeout(25);
    }
    const details = await evaluate(`({
      diagnostics: document.querySelector('#producer-diagnostics')?.textContent,
      alert: document.querySelector('[role="alert"]')?.textContent,
      notice: document.querySelector('.producer-footer [role="status"]')?.textContent,
      transport: document.querySelector('.producer-transport-state')?.textContent,
    })`);
    throw new Error(`${label} timed out: ${JSON.stringify(details)}`);
  }
  async function click(selector) {
    await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.matches(':disabled')) throw new Error('Control is unavailable: ' + ${JSON.stringify(selector)});
      element.click();
    })()`);
  }
  async function clickText(text) {
    if (text === "Open" || text === "Save .banger") await clickText("Project");
    await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(text)});
      if (!button || button.matches(':disabled')) throw new Error('Button is unavailable: ' + ${JSON.stringify(text)});
      button.click();
    })()`);
    if (text === "Open" || text === "Save .banger") {
      await waitFor("![...document.querySelectorAll('#project-controls button')].find(b => b.textContent === 'Open').disabled", "file operation");
      await clickText("Close");
    }
  }
  async function editSource(source) {
    await clickText("Raw .banger");
    await evaluate(`(() => {
      const editor = document.querySelector('#producer-source');
      if (!editor || editor.disabled) throw new Error('Source editor is unavailable.');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor, ${JSON.stringify(source)});
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  }
  async function applySource(source, tempo, names, lengths) {
    await editSource(source);
    await waitFor(`!${applyButton}?.disabled && document.querySelector('#producer-source')?.getAttribute('aria-invalid') === 'false'`, "valid draft");
    await clickText("Apply source");
    await waitFor(`document.querySelector('#producer-tempo')?.value === ${JSON.stringify(String(tempo))} && document.querySelector('.producer-source-status')?.textContent === 'In sync'`, "applied source");
    await clickText("Sequencer");
    const grid = await evaluate(gridSnapshot);
    assert.deepEqual(grid.map(track => track.name), names);
    assert.deepEqual(grid.map(track => track.steps.length), lengths);
  }
  async function saveAs(path, filename) {
    let dialogCalls = 0;
    dialog.showSaveDialog = async () => { dialogCalls += 1; return { canceled: false, filePath: path }; };
    await clickText("Save .banger");
    await waitFor(`document.querySelector('.producer-footer [role="status"]')?.textContent === ${JSON.stringify(`Saved ${filename}.`)}`, "native save");
    assert.equal(dialogCalls, 1, "Save must use the native dialog once.");
    assert.equal(await evaluate("document.querySelector('.producer-project .producer-dim')?.textContent"), undefined);
  }

  await waitFor("document.querySelectorAll('.producer-track').length === 8 && Boolean(document.querySelector('#producer-source')?.value)", "producer hydration", 10_000);
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert.equal(await evaluate("document.querySelectorAll('[role=tab]').length"), 5);
  assert.equal(await evaluate("document.querySelectorAll('[role=tabpanel]:not([hidden])').length"), 1);
  await evaluate("document.querySelector('#studio-tab-sequencer').focus()");
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Right" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Right" });
  await waitFor("document.activeElement.id === 'studio-tab-mixer' && !document.querySelector('#studio-panel-mixer').hidden", "keyboard tab navigation");
  await clickText("Sequencer");
  const initial = await evaluate(gridSnapshot);
  assert.deepEqual(initial.map(track => track.name), ["kick", "snare", "hats", "bass", "keys", "pad", "lead", "bell"]);
  assert.deepEqual(initial.map(track => track.steps.length), [16, 16, 16, 16, 0, 0, 16, 8]);
  assert.equal(await evaluate("document.querySelector('#producer-tempo').value"), "112");
  const originalSource = await evaluate("document.querySelector('#producer-source').value");
  assert.equal(originalSource, await readFile(new URL("../../../examples/night-drive.banger", import.meta.url), "utf8"));
  assert.equal(await evaluate("document.querySelector('#source-title').textContent"), "night-drive.banger");
  assert.equal(await evaluate("document.querySelector('.producer-project .producer-dim').textContent"), "No project");
  assert.equal(await evaluate("document.querySelectorAll('.producer-track-editor:not([hidden])').length"), 0, 'Track editors start collapsed.');
  assert.equal(await evaluate("document.querySelectorAll('.producer-song-tools details[open]').length"), 0, 'Song tools start collapsed.');
  assert.ok(await evaluate("[...document.querySelectorAll('.producer-track')].every(row => row.getBoundingClientRect().height <= 64)"), 'Collapsed tracks, including step performance badges, form a compact rack.');
  await click('[aria-label="Edit kick"]');
  await waitFor("document.querySelector('[aria-label=\"kick gain\"]').checkVisibility()", 'track controls expand');
  await click('[aria-label="Edit bass"]');
  assert.equal(await evaluate("document.querySelectorAll('.producer-track-editor:not([hidden])').length"), 1, 'Only one track editor opens at a time.');
  await click('[aria-label="Close bass editor"]');
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), 'Edit bass', 'Closing restores focus to the track.');
  assert.equal(await evaluate("document.querySelector('#producer-source').value"), originalSource, 'Opening editors does not edit the project.');

  const originalLevels = await evaluate("[...document.querySelectorAll('.producer-track-gain input')].map(input => input.value)");
  for (const name of ["kick", "snare"]) {
    await click(`[aria-label="Mute ${name}"]`);
    await waitFor(`document.querySelector('[aria-label="Mute ${name}"]')?.getAttribute('aria-pressed') === 'true'`, `${name} muted`);
    assert.equal(await evaluate(`document.querySelector('[aria-label="Mute ${name}"]').title`), `Unmute ${name}`);
  }
  await click('[aria-label="Mute kick"]');
  await waitFor(`document.querySelector('[aria-label="Mute kick"]')?.getAttribute('aria-pressed') === 'false'`, "kick unmuted");
  assert.equal(await evaluate(`document.querySelector('[aria-label="Mute snare"]').getAttribute('aria-pressed')`), "true", "Unmuting one track must leave another muted.");
  await click('[aria-label="Mute snare"]');
  await waitFor(`document.querySelector('[aria-label="Mute snare"]')?.getAttribute('aria-pressed') === 'false'`, "snare unmuted");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.producer-track-gain input')].map(input => input.value)"), originalLevels, "Mute toggles must preserve every volume slider.");
  const afterMute = compileMusic(await evaluate("document.querySelector('#producer-source').value"));
  assert.deepEqual(afterMute.tracks.map(track => track.gain), compileMusic(originalSource).tracks.map(track => track.gain), "Mute toggles must preserve saved track gains.");
  assert.ok(afterMute.tracks.every(track => !track.muted), "Unmuting must also update saved mixer state.");
  assert.equal(initial[0].steps[1], "false");
  await click('.producer-track:first-child .producer-step-cell:nth-child(2) .producer-step');
  await waitFor(`document.querySelector('.producer-track:first-child .producer-step-cell:nth-child(2) .producer-step')?.getAttribute('aria-pressed') === 'true' && document.querySelector('#producer-source')?.value !== ${JSON.stringify(originalSource)}`, "step edit and serialization");
  assert.equal(await evaluate("document.querySelector('.producer-source-status').textContent"), "In sync");

  await click(".producer-play");
  await waitFor("document.querySelector('.producer-transport-state')?.textContent === 'Playing' && document.querySelectorAll('.producer-step[data-current=" + '"true"' + "]').length > 0", "audio playback");
  const firstPosition = await evaluate("document.querySelector('.producer-position').getAttribute('aria-label')");
  await waitFor(`document.querySelector('.producer-position')?.getAttribute('aria-label') !== ${JSON.stringify(firstPosition)}`, "advancing audio playhead");
  const audioDeadline = Date.now() + 3_000;
  while (!window.webContents.isCurrentlyAudible() && Date.now() < audioDeadline) await setTimeout(25);
  assert.equal(window.webContents.isCurrentlyAudible(), true, "Real Web Audio output must become audible.");
  await clickText("Raw .banger");
  assert.equal(await evaluate("document.querySelector('.producer-transport-state').textContent"), "Playing");
  await clickText("Sequencer");
  await click('[aria-label="Stop playback"]');
  await waitFor("document.querySelector('.producer-position')?.getAttribute('aria-label') === 'Stopped' && document.querySelectorAll('.producer-step[data-current=" + '"true"' + "]').length === 0", "stopped playhead");

  const beforeInvalid = await evaluate(gridSnapshot);
  await editSource("tempo nope;");
  await waitFor(`document.querySelector('#producer-source')?.getAttribute('aria-invalid') === 'true' && ${applyButton}?.disabled`, "invalid draft diagnostic");
  await clickText("Sequencer");
  await clickText("Raw .banger");
  assert.equal(await evaluate("document.querySelector('#producer-source').value"), "tempo nope;");
  assert.deepEqual(await evaluate(gridSnapshot), beforeInvalid, "Invalid source must preserve the applied sequence.");
  assert.equal(await evaluate("document.querySelector('.producer-tracks').disabled"), true);
  const pianoSource = await smokePiano(window);
  const pianoPath = join(directory, "piano.banger");
  await saveAs(pianoPath, "piano.banger");
  assert.equal(await readFile(pianoPath, "utf8"), pianoSource);
  await applySource(replacementSource, 91, ["replacement"], [4]);
  await saveAs(join(directory, "before-piano.banger"), "before-piano.banger");
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pianoPath] });
  await clickText("Open");
  await waitFor("document.querySelectorAll('.piano-note').length === 4", "native piano reopen");
  assert.equal(await evaluate("document.querySelector('#producer-source').value"), pianoSource);
  await applySource(mixedLengthSource, 137, ["smoke_kick", "smoke_bass"], [8, 3]);

  const filename = "対話 🎵.banger";
  const path = join(directory, filename);
  await saveAs(path, filename);
  assert.equal(await readFile(path, "utf8"), mixedLengthSource, "The UI must save its real source through IPC.");
  const savedGrid = await evaluate(gridSnapshot);
  // Save a different current project so reopening exercises replacement without a confirmation stub.
  await applySource(replacementSource, 91, ["replacement"], [4]);
  await saveAs(join(directory, "replacement.banger"), "replacement.banger");
  let openCalls = 0;
  dialog.showOpenDialog = async () => { openCalls += 1; return { canceled: false, filePaths: [path] }; };
  await clickText("Open");
  await waitFor(`document.querySelector('.producer-footer [role="status"]')?.textContent === ${JSON.stringify(`Opened ${filename}.`)}`, "native reopen");
  assert.equal(openCalls, 1, "Open must use the native dialog once.");
  assert.equal(await evaluate("document.querySelector('#producer-source').value"), mixedLengthSource);
  assert.equal(await evaluate("document.querySelector('#producer-tempo').value"), "137");
  assert.deepEqual(await evaluate(gridSnapshot), savedGrid, "Reopening must compile the saved track names, lengths, and steps.");
  assert.equal(await evaluate("document.querySelector('.producer-source-status').textContent"), "In sync");
  await click('.producer-track:first-child .producer-step:first-child');
  await waitFor("document.querySelector('.producer-project .producer-dim')?.textContent === 'Unsaved'", "dirty close setup");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const unsavedSource = await evaluate("document.querySelector('#producer-source').value");
  let closeChoice = 0;
  let closeDialogs = 0;
  let unloadAttempts = 0;
  window.webContents.on("will-prevent-unload", () => { unloadAttempts += 1; });
  dialog.showMessageBoxSync = (owner, options) => {
    assert.equal(owner, window);
    assert.deepEqual(options.buttons, ["Cancel", "Discard"]);
    assert.equal(options.defaultId, 0);
    assert.equal(options.cancelId, 0);
    closeDialogs += 1;
    return closeChoice;
  };
  window.close();
  const cancelDeadline = Date.now() + 3_000;
  while (closeDialogs === 0 && !window.isDestroyed() && Date.now() < cancelDeadline) await setTimeout(25);
  await setTimeout(100);
  assert.equal(closeDialogs, 1, "A real close attempt must ask before discarding.");
  assert.equal(unloadAttempts, 1);
  assert.equal(window.isDestroyed(), false, "Cancel must preserve the dirty window.");
  assert.equal(await evaluate("document.querySelector('#producer-source').value"), unsavedSource);
  closeChoice = 1;
  window.close();
  const discardDeadline = Date.now() + 3_000;
  while (!window.isDestroyed() && Date.now() < discardDeadline) await setTimeout(25);
  assert.equal(closeDialogs, 2);
  assert.equal(unloadAttempts, 2);
  assert.equal(window.isDestroyed(), true, "Explicit discard must close the dirty window.");
  console.log("Unsaved-close smoke passed: actual beforeunload, Cancel preserves the project, explicit Discard closes the window.");
  console.log("Producer smoke passed: loaded exact Night Drive source and eight-track grid, step serialization, real audio and moving playhead, stop, invalid draft preservation, 8/3-step patterns, native save/reopen with restored tracks and tempo.");
}
