import assert from 'node:assert/strict';
import { app, dialog } from 'electron';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

async function wait(window, expression) {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (await window.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await delay(25);
  }
  throw new Error(`Startup UI timed out: ${expression}`);
}
const click = (window, label) => window.webContents.executeJavaScript(`(() => {
  const focusedDialog = document.activeElement?.closest('[role="dialog"][data-state="open"]');
  const matches = root => [...root.querySelectorAll('button')].find(button => button.getBoundingClientRect().width > 0 && button.textContent.trim() === ${JSON.stringify(label)});
  (focusedDialog && matches(focusedDialog) || matches(document)).click();
})()`, true);

export async function enterStudio(window) {
  let projectFolder;
  await wait(window, "document.querySelector('.producer-start') || document.querySelector('#producer-source')");
  if (await window.webContents.executeJavaScript("Boolean(document.querySelector('.producer-start'))")) {
    const native = await window.webContents.executeJavaScript("Boolean(window.bangerWorkspace)");
    const original = dialog.showSaveDialog;
    let directory;
    if (native) {
      directory = await mkdtemp(join(tmpdir(), 'banger-sample-smoke-'));
      projectFolder = join(directory, 'Sample Project');
      app.once('will-quit', () => { void rm(directory, { recursive: true, force: true }); });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: join(directory, 'Sample Project') });
    } else {
      // The browser fixture supplies folder handles; the real browser workspace code performs all reads and writes.
      await window.webContents.executeJavaScript(`(() => {
        const directory = name => {
          const entries = new Map();
          return { kind: 'directory', name, async *values() { yield* entries.values(); },
            async getDirectoryHandle(name, options) { if (!entries.has(name)) { if (!options?.create) throw new DOMException('Missing', 'NotFoundError'); entries.set(name, directory(name)); } return entries.get(name); },
            async getFileHandle(name, options) { if (!entries.has(name)) { if (!options?.create) throw new DOMException('Missing', 'NotFoundError'); let text = ''; entries.set(name, { kind: 'file', name, getFile: async () => new File([text], name), createWritable: async () => ({ write: async value => { text = value; }, close: async () => {} }) }); } return entries.get(name); }
          };
        };
        const parent = directory('Smoke projects'); window.smokeProjectParent = parent; window.showDirectoryPicker = async () => parent; window.prompt = () => 'Sample Project';
      })()`);
    }
    try { await click(window, 'Load Sample Project'); await wait(window, "document.querySelector('#producer-source')"); }
    finally { dialog.showSaveDialog = original; }
  }
  await wait(window, "document.querySelector('#producer-source')");
  await window.webContents.executeJavaScript("document.querySelector('#project-controls [aria-label=\"Close project controls\"]')?.click()");
  return projectFolder;
}

export async function smokeStartup(window, directory) {
  const evaluate = code => window.webContents.executeJavaScript(code, true).catch(error => { throw new Error(`Startup action failed: ${code}`, { cause: error }); });
  const reload = async () => { await window.loadURL('banger://app/'); await wait(window, "document.querySelector('.producer-start')"); };
  const idle = () => wait(window, "document.querySelector('.producer-start-card')?.getAttribute('aria-busy') === 'false'");
  const input = async (selector, value) => { await wait(window, `document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`); return evaluate(`(() => { const field = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(field.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event('input', { bubbles: true })); })()`); };
  await wait(window, "document.querySelector('.producer-start')");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.producer-start button')].map(b => b.textContent)"), ['Open Project', 'Create New Project', 'Load Sample Project', 'Open Library']);
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  dialog.showSaveDialog = async () => ({ canceled: true });
  for (const label of ['Open Project', 'Create New Project', 'Load Sample Project']) { await click(window, label); await idle(); }
  dialog.showOpenDialog = async () => { throw new Error('Startup open failed'); };
  await click(window, 'Open Project'); await idle();
  assert.match(await evaluate("document.querySelector('[role=alert]').textContent"), /Startup open failed/);
  const sampleFolder = join(directory, 'sample-project');
  dialog.showSaveDialog = async (_window, options) => { assert.equal(options.title, 'Create project folder'); return { canceled: false, filePath: sampleFolder }; };
  await click(window, 'Load Sample Project');
  await wait(window, "document.querySelector('#producer-source')");
  const sample = await readFile(new URL('../../../examples/night-drive.banger', import.meta.url), 'utf8');
  assert.equal(await readFile(join(sampleFolder, 'night-drive.banger'), 'utf8'), sample);
  assert.equal(await evaluate("document.querySelector('#producer-source').value"), sample);
  assert.match(await evaluate("document.querySelector('.producer-project').textContent"), /sample-project.*night-drive/);
  await click(window, 'Project');
  await wait(window, "document.querySelector('#workspace-file')");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('#project-controls > section')].map(s => s.querySelector('h2')?.textContent)"), ['Project Workspace', 'night-drive.banger', 'Export Controls']);
  await wait(window, "(document.querySelector('#project-controls')?.getAttribute('data-state') === 'open')");
  await click(window, 'Create Song');
  await wait(window, "(document.querySelector('.create-song-dialog')?.getAttribute('data-state') === 'open')");
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), 'New song name');
  await delay(150);
  await writeFile('/tmp/banger-create-song-modal.png', (await window.webContents.capturePage()).toPNG());
  await input('[aria-label="New song name"]', 'verse');
  await click(window, 'Create New Song');
  await wait(window, "document.querySelector('#workspace-file').value === 'verse.banger'");
  await wait(window, "document.querySelector('.create-song-dialog')?.getAttribute('data-state') !== 'open'");
  const blank = await readFile(join(sampleFolder, 'verse.banger'), 'utf8');
  assert.notEqual(blank, sample);
  await click(window, 'Create Song');
  await wait(window, "(document.querySelector('.create-song-dialog')?.getAttribute('data-state') === 'open')");
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), 'New song name');
  await input('[aria-label="New song name"]', 'verse'); await click(window, 'Create New Song');
  await wait(window, "document.querySelector('.project-workspace-notice')?.textContent.includes('changed')");
  assert.equal(await readFile(join(sampleFolder, 'verse.banger'), 'utf8'), blank);
  await click(window, 'Cancel');
  await wait(window, "document.querySelector('.create-song-dialog')?.getAttribute('data-state') !== 'open'");
  await evaluate("(() => { const s = document.querySelector('#workspace-file'); s.value = 'night-drive.banger'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await wait(window, "document.querySelector('#producer-source').value === " + JSON.stringify(sample));
  await input('#producer-source', sample + '\n// unsaved');
  await evaluate('void (window.confirm = () => false)');
  const previousChat = await evaluate("[...document.querySelectorAll('.app-sidebar-chat')].findIndex(button => button.getAttribute('aria-current') === 'true')");
  const previousChatCount = await evaluate("document.querySelectorAll('.app-sidebar-chat').length");
  let opened = false;
  dialog.showOpenDialog = async () => { opened = true; return { canceled: false, filePaths: [sampleFolder] }; };
  await click(window, 'Open Project');
  assert.equal(opened, true);
  await wait(window, `document.querySelectorAll('.app-sidebar-chat').length === ${previousChatCount + 1} && document.querySelector('#project-controls')?.getAttribute('data-state') !== 'open'`);
  await evaluate(`document.querySelectorAll('.app-sidebar-chat')[${previousChat}].click()`);
  await wait(window, "document.querySelector('#producer-source').value.includes('unsaved')");
  await evaluate("document.querySelector('[aria-label=\"Close AI chat\"]').click()");
  await click(window, 'Project');
  await evaluate("(() => { const s = document.querySelector('#workspace-file'); s.value = 'verse.banger'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  assert.match(await evaluate("document.querySelector('#producer-source').value"), /unsaved/);
  await evaluate('void (window.confirm = () => true)');
  await click(window, 'Save .banger');
  await wait(window, "document.querySelector('.project-file-card [role=status]')?.textContent.includes('Saved night-drive')");
  assert.match(await readFile(join(sampleFolder, 'night-drive.banger'), 'utf8'), /unsaved/);
  assert.equal(await evaluate("document.querySelector('#workspace-source, #workspace-prompt, .project-song-advanced')"), null);
  await click(window, 'Close');
  await evaluate("window.bangerAI.save('vercel', 'anthropic/claude-opus-5-5', 'fake-startup-key')");
  await evaluate("window.dispatchEvent(new Event('banger:ai-settings-changed'))");
  await wait(window, "!document.querySelector('[aria-label=\"Open AI chat\"]').disabled");
  await evaluate("document.querySelector('[aria-label=\"Open AI chat\"]').click()");
  await input('#ai-chat-prompt', 'Keep this task draft');
  await evaluate("document.querySelector('[aria-label=\"Close AI chat\"]').click()");
  await evaluate("document.querySelector('[aria-label=\"Open AI chat\"]').click()");
  assert.equal(await evaluate("document.querySelector('#ai-chat-prompt').value"), 'Keep this task draft');
  await evaluate("document.querySelector('[aria-label=\"Close AI chat\"]').click()");
  await click(window, 'Project');
  const minimum = window.getMinimumSize(); window.setMinimumSize(0, 0); window.setContentSize(390, 844);
  await wait(window, 'innerWidth === 390');
  assert.ok(await evaluate("document.querySelector('#project-controls').scrollWidth <= document.querySelector('#project-controls').clientWidth + 1"));
  await writeFile('/tmp/banger-project-controls-mobile.png', (await window.webContents.capturePage()).toPNG());
  window.setContentSize(1440, 1000); window.setMinimumSize(...minimum);
  await wait(window, 'innerWidth === 1440');
  await writeFile('/tmp/banger-project-controls.png', (await window.webContents.capturePage()).toPNG());
  const newFolder = join(directory, 'new-project');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: newFolder });
  await click(window, 'Create New Project');
  await wait(window, "(document.querySelector('.first-song-dialog')?.getAttribute('data-state') === 'open')");
  assert.deepEqual(await readdir(newFolder), []);
  await input('#first-song-name', 'New tune');
  await click(window, 'Create Song');
  await wait(window, "document.querySelector('.producer-project')?.textContent.includes('New tune.banger')");
  await wait(window, "document.querySelector('#project-controls')?.getAttribute('data-state') !== 'open'");
  assert.equal(await evaluate("document.querySelector('#producer-source').value"), blank);
  assert.equal(await readFile(join(newFolder, 'New tune.banger'), 'utf8'), blank);
  assert.deepEqual((await readdir(newFolder)).filter(name => name.endsWith('.banger')), ['New tune.banger']);
  await reload();
  // Existing folders are never overwritten by project creation.
  await click(window, 'Create New Project'); await idle();
  assert.match(await evaluate("document.querySelector('[role=alert]').textContent"), /already exists/);
  const startFolder = join(directory, 'startup-created');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: startFolder });
  await click(window, 'Create New Project');
  await wait(window, "(document.querySelector('.first-song-dialog')?.getAttribute('data-state') === 'open')");
  assert.equal(await evaluate("document.querySelector('#producer-source')"), null);
  assert.deepEqual(await readdir(startFolder), []);
  await writeFile('/tmp/banger-first-song-dialog.png', (await window.webContents.capturePage()).toPNG());
  assert.equal(await evaluate("document.activeElement.id"), 'first-song-name');
  assert.equal(await evaluate("document.querySelector('.first-song-dialog button').disabled"), true);
  await input('#first-song-name', '../invalid'); await click(window, 'Create Song');
  await wait(window, "document.querySelector('#first-song-error')");
  assert.deepEqual(await readdir(startFolder), []);
  // A save conflict keeps the prompt open and preserves the existing song.
  await writeFile(join(startFolder, 'taken.banger'), sample);
  await input('#first-song-name', 'taken'); await click(window, 'Create Song');
  await wait(window, "document.querySelector('#first-song-error')?.textContent.includes('changed')");
  assert.equal(await readFile(join(startFolder, 'taken.banger'), 'utf8'), sample);
  await input('#first-song-name', 'First song.banger');
  await evaluate("document.querySelector('.first-song-dialog form').requestSubmit()");
  await wait(window, "document.querySelector('.producer-project')?.textContent.includes('First song.banger')");
  await wait(window, "document.querySelector('#project-controls')?.getAttribute('data-state') !== 'open'");
  assert.equal(await evaluate("document.querySelector('#producer-source').value"), blank);
  assert.equal(await readFile(join(startFolder, 'First song.banger'), 'utf8'), blank);
  assert.match(await evaluate("document.querySelector('.producer-project').textContent"), /First song.banger/);
  await reload();
  const folder = join(directory, 'folder-project'); await mkdir(join(folder, 'songs'), { recursive: true });
  await writeFile(join(folder, 'songs/verse.banger'), blank);
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  await click(window, 'Open Project'); await wait(window, "document.querySelector('.producer-project')?.textContent.includes('verse.banger')");
  await reload();
  await writeFile(join(folder, 'songs/verse.banger'), 'invalid music source');
  await click(window, 'Open Project'); await wait(window, "document.querySelector('#producer-source')?.getAttribute('aria-invalid') === 'true'");
  await reload();
  const empty = join(directory, 'empty-project'); await mkdir(empty);
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [empty] });
  await click(window, 'Open Project'); await wait(window, "(document.querySelector('.first-song-dialog')?.getAttribute('data-state') === 'open')");
  assert.deepEqual(await readdir(empty), []);
  await input('#first-song-name', 'first'); await click(window, 'Create Song');
  await wait(window, "document.querySelector('.producer-project')?.textContent.includes('first.banger')");
  assert.equal(await readFile(join(empty, 'first.banger'), 'utf8'), blank);
  assert.deepEqual((await readdir(empty)).filter(name => name.endsWith('.banger')), ['first.banger']);
  await reload();
  console.log('Startup smoke passed: stored sample and new projects, cancellation, modal order, project/song switching, new songs, duplicate protection, unsaved edits, nested songs, invalid source, empty folders, draft persistence, and narrow layout.');
}
