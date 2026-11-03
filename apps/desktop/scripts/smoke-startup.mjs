import assert from 'node:assert/strict';
import { dialog } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

async function wait(window, expression) {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (await window.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await delay(25);
  }
  throw new Error(`Startup UI timed out: ${expression}`);
}
const click = (window, label) => window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`, true);

export async function enterStudio(window) {
  await wait(window, "document.querySelector('.producer-start') || document.querySelector('#producer-source')");
  if (await window.webContents.executeJavaScript("Boolean(document.querySelector('.producer-start'))")) {
    await click(window, 'Work without a project');
  }
  await wait(window, "document.querySelector('#producer-source')");
}

export async function smokeStartup(window, directory) {
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  const reload = async () => { await window.loadURL('banger://app/'); await wait(window, "document.querySelector('.producer-start')"); };
  await wait(window, "document.querySelector('.producer-start')");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.producer-start button')].map(button => button.textContent)"), ['Create project', 'Open project', 'Open project folder', 'Work without a project']);
  assert.equal(await evaluate("document.querySelector('.producer-transport')"), null);
  if (process.env.BANGER_STARTUP_SCREENSHOT) await writeFile(process.env.BANGER_STARTUP_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
  const minimumSize = window.getMinimumSize();
  window.setMinimumSize(0, 0);
  window.setContentSize(390, 844);
  await wait(window, "innerWidth === 390");
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'));
  if (process.env.BANGER_STARTUP_SCREENSHOT) await writeFile(process.env.BANGER_STARTUP_SCREENSHOT.replace('.png', '-mobile.png'), (await window.webContents.capturePage()).toPNG());
  window.setContentSize(1440, 1000);
  window.setMinimumSize(...minimumSize);
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  await click(window, 'Open project');
  await wait(window, "document.querySelector('.producer-start-card').getAttribute('aria-busy') === 'false'");
  dialog.showSaveDialog = async () => ({ canceled: true });
  await click(window, 'Create project');
  await wait(window, "document.querySelector('.producer-start-card').getAttribute('aria-busy') === 'false'");
  dialog.showOpenDialog = async () => { throw new Error('Startup open failed'); };
  await click(window, 'Open project');
  await wait(window, "document.querySelector('.producer-start [role=alert]')?.textContent.includes('Startup open failed')");
  await enterStudio(window);
  const sample = await readFile(new URL('../../../examples/night-drive.banger', import.meta.url), 'utf8');
  assert.equal(await evaluate("document.querySelector('#producer-source').value"), sample);
  assert.equal(await evaluate("document.querySelector('.producer-project .producer-dim').textContent"), 'No project');
  await reload();
  const createdPath = join(directory, 'new-project.banger');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: createdPath });
  await click(window, 'Create project');
  await wait(window, "document.querySelector('#producer-source')");
  assert.equal(await evaluate("document.querySelector('#producer-source').value"), await readFile(createdPath, 'utf8'));
  assert.equal(await evaluate("document.querySelector('#source-title').textContent"), 'new-project.banger');
  assert.equal(await evaluate("document.querySelector('.producer-project .producer-dim')?.textContent"), undefined);
  await reload();
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [createdPath] });
  await click(window, 'Open project');
  await wait(window, "document.querySelector('#source-title')?.textContent === 'new-project.banger'");
  assert.equal(await evaluate("document.querySelector('#producer-source').value"), await readFile(createdPath, 'utf8'));
  await reload();
  await writeFile(createdPath, 'invalid music source');
  await click(window, 'Open project');
  await wait(window, "document.querySelector('#producer-source')?.getAttribute('aria-invalid') === 'true'");
  assert.equal(await evaluate("document.querySelector('#studio-tab-source').getAttribute('aria-selected')"), 'true');
  assert.equal(await evaluate("document.querySelector('#producer-source').value"), 'invalid music source');
  await reload();
  await click(window, 'Open project folder');
  await wait(window, "document.querySelector('.producer-start [role=alert]')");
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  await click(window, 'Open project folder');
  await wait(window, "document.querySelector('.producer-start-card').getAttribute('aria-busy') === 'false'");
  const folder = join(directory, 'folder-project');
  await mkdir(join(folder, 'songs'), { recursive: true });
  const folderSource = 'tempo 123; meter 4/4; track kick { sound "drums/kick"; rhythm "x . x ."; gain 0.5; }';
  const folderPath = join(folder, 'songs', 'verse.banger');
  await writeFile(folderPath, folderSource);
  dialog.showOpenDialog = async (_window, options) => {
    assert.deepEqual(options.properties, ['openDirectory']);
    return { canceled: false, filePaths: [folder] };
  };
  await click(window, 'Open project folder');
  await wait(window, "document.querySelector('#project-controls')?.open && document.querySelector('#workspace-file')?.value === 'songs/verse.banger'");
  assert.equal(await evaluate("document.querySelector('#producer-source').value"), folderSource);
  assert.equal(await evaluate("document.querySelectorAll('.project-workspace:not(#project-controls .project-workspace)').length"), 0);
  assert.equal(await evaluate("document.activeElement.closest('dialog')?.id"), 'project-controls');
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await wait(window, "!document.querySelector('#project-controls').open");
  await click(window, 'Project');
  await wait(window, "document.querySelector('#project-controls').open");
  await click(window, 'Close');
  await wait(window, "document.activeElement.textContent === 'Project'");
  await click(window, 'Raw .banger');
  const editedSource = folderSource.replace('123', '125');
  await evaluate(`(() => { const input = document.querySelector('#producer-source'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(editedSource)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click(window, 'Project');
  await click(window, 'Save .banger');
  await wait(window, "document.querySelector('.producer-footer [role=status]').textContent === 'Saved verse.banger.'");
  assert.equal(await readFile(folderPath, 'utf8'), editedSource);
  await wait(window, "document.querySelector('#workspace-source').value.includes('tempo 125')");
  await evaluate(`(() => { const input = document.querySelector('#workspace-prompt'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Keep this task draft'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click(window, 'Close'); await click(window, 'Project');
  assert.equal(await evaluate("document.querySelector('#workspace-prompt').value"), 'Keep this task draft');
  window.setMinimumSize(0, 0); window.setContentSize(390, 844);
  await wait(window, "innerWidth === 390");
  assert.ok(await evaluate("document.querySelector('#project-controls').scrollWidth <= document.querySelector('#project-controls').clientWidth + 1"));
  await writeFile('/tmp/banger-project-controls-mobile.png', (await window.webContents.capturePage()).toPNG());
  window.setContentSize(1440, 1000); window.setMinimumSize(...minimumSize);
  await writeFile('/tmp/banger-project-controls.png', (await window.webContents.capturePage()).toPNG());
  await reload();
  const emptyFolder = join(directory, 'empty-project'); await mkdir(emptyFolder);
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [emptyFolder] });
  await click(window, 'Open project folder');
  await wait(window, "document.querySelector('#project-controls')?.open && document.querySelector('[aria-label=\"Project workspace\"]')?.textContent.includes('No .banger files yet')");
  await reload();
  console.log('Startup smoke passed: file and folder choices, nested-file saves, empty folders, cancellation, errors, Night Drive, invalid source recovery, modal dismissal and focus, draft persistence, and narrow layout.');
}
