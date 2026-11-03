import assert from 'node:assert/strict';
import { dialog } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
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
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.producer-start button')].map(button => button.textContent)"), ['Create project', 'Open project', 'Work without a project']);
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
  assert.equal(await evaluate("document.querySelector('.producer-project .producer-dim').textContent"), 'Local project');
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
  console.log('Startup smoke passed: chooser, cancellation, errors, Night Drive, create, open, invalid source recovery, and narrow layout.');
}
