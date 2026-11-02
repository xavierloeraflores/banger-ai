import { app, BrowserWindow, safeStorage, shell, dialog } from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'banger-chatgpt-ui-'));
app.setPath('userData', directory);
app.on('before-quit', event => event.preventDefault());
const timeout = setTimeout(() => { console.error('ChatGPT UI smoke timed out'); app.exit(1); }, 55000);
const opened = [];
shell.openExternal = async url => { opened.push(url); };
let calls = 0, projectCalls = 0;
const source = 'tempo 101; meter 4/4; track kick { sound "drums/clap"; rhythm "x . x ."; gain .5; }';
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://api.openai.com/v1/models') return Response.json({ models: [
    { slug: 'test-chatgpt', display_name: 'ChatGPT test model', visibility: 'list' },
    { slug: 'other-chatgpt', display_name: 'Another test model', visibility: 'list' },
  ] });
  if (url.endsWith('/.well-known/openid-configuration')) return Response.json({ revocation_endpoint: 'https://auth.openai.com/revoke' });
  if (url === 'https://auth.openai.com/revoke') return new Response(null, { status: 200 });
  assert.equal(url, 'https://api.openai.com/v1/responses');
  assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer fake-ui-access');
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'other-chatgpt');
  assert.equal(body.store, false); assert.equal(body.stream, true);
  assert.ok(!('max_output_tokens' in body));
  assert.equal(init.body.includes('fake-ui-access'), false);
  const namespace = body.tools.find(tool => tool.type === 'namespace');
  assert.equal(namespace.name, 'banger');
  const project = namespace.tools.some(tool => tool.name === 'edit_file');
  if (project) projectCalls++; else calls++;
  const output = project && projectCalls === 1 ? [{ type: 'function_call', id: 'fc_project', call_id: 'call_project', namespace: 'banger', name: 'edit_file', arguments: JSON.stringify({ path: 'song.banger', search: 'tempo 101;', replacement: 'tempo 88;' }), status: 'completed' }] : !project && calls === 1 ? [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', namespace: 'banger', name: 'create_banger_file', arguments: JSON.stringify({ name: 'chatgpt-loop.banger', source }), status: 'completed' }]
    : [{ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Your clap loop is ready.', annotations: [] }] }];
  return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { id: `resp_${calls}`, status: 'completed', created_at: 1, model: 'other-chatgpt', output, usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
};
let started = false;
app.on('browser-window-created', (_event, window) => {
  if (started) return;
  started = true;
  window.webContents.once('did-finish-load', () => { void run(window); });
});
await import('../dist/main.js');

async function run(window) {
  const evaluate = async code => { try { return await window.webContents.executeJavaScript(code, true); } catch (error) { throw new Error(`Renderer check failed: ${code}`, { cause: error }); } };
  const wait = async expression => {
    for (let i = 0; i < 300; i++) { if (await evaluate(`Boolean(${expression})`)) return; await delay(25); }
    throw new Error(`UI did not arrive: ${expression}`);
  };
  const click = text => evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(text)}); if (!button || button.disabled) throw Error('Button unavailable'); button.click(); })()`);
  const select = (id, value) => evaluate(`(() => { const input = document.getElementById(${JSON.stringify(id)}); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  try {
    await wait("document.querySelector('#producer-source')?.value");
    await click('BYOK');
    await wait("document.querySelectorAll('.byok-providers button').length === 7");
    await evaluate("[...document.querySelectorAll('.byok-providers button')].find(button => button.querySelector('span').textContent === 'ChatGPT').click()");
    await wait("document.querySelector('#chatgpt-title')");
    await click('Continue with ChatGPT');
    await wait("document.querySelector('.chatgpt-settings [role=status]')?.textContent.includes('browser')");
    for (let i = 0; i < 100 && !opened.length; i++) await delay(20);
    const authUrl = new URL(opened[0]);
    assert.equal(authUrl.origin, 'https://auth.openai.com');
    assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
    await click('Cancel sign-in');
    await wait("!document.querySelector('.chatgpt-settings [role=status]')");
    // Seed only a fake account, encrypted by the real operating-system storage API.
    const saved = { version: 1, hostId: 'urn:uuid:12345678-1234-4234-8234-123456789abc', activeAccountId: 'fake-account', selected: false,
      accounts: [{ id: 'fake-account', clientId: 'oaiapp_fakeui', subject: 'fake-user', name: 'Test Musician', email: 'music@example.test',
        model: 'test-chatgpt', models: [{ id: 'test-chatgpt', label: 'ChatGPT test model' }],
        tokens: { accessToken: 'fake-ui-access', refreshToken: 'fake-ui-refresh', expiresAt: Date.now() + 3600000, scopes: ['resource.invoke', 'chatgpt.tokens.use.direct'] } }] };
    await writeFile(join(directory, 'chatgpt-accounts.enc'), await safeStorage.encryptStringAsync(JSON.stringify(saved)));
    await evaluate("window.dispatchEvent(new Event('banger:ai-settings-changed'))");
    await wait("document.querySelector('#active-ai-model option[value=chatgpt]')");
    await select('active-ai-model', 'chatgpt');
    await wait("document.querySelector('.chatgpt-usage')?.textContent.includes('Using ChatGPT plan')");
    await wait("document.querySelector('#chatgpt-model option[value=other-chatgpt]')");
    await select('chatgpt-model', 'other-chatgpt');
    await wait("document.querySelector('#active-ai-model option[value=chatgpt]')?.textContent.includes('other-chatgpt')");
    await click('Manage usage');
    assert.ok(opened.includes('https://chatgpt.com/settings/usage'));
    await click('Sequencer');
    await evaluate("document.querySelector('[aria-label=\"Open AI chat\"]').click()");
    await wait("document.querySelector('.ai-chat-heading-actions .producer-tag')?.textContent === 'ChatGPT · other-chatgpt'");
    await evaluate(`(() => { const input = document.getElementById('ai-chat-prompt'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Make a clap loop'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await click('Send');
    await wait("document.querySelector('.ai-chat-file strong')?.textContent === 'chatgpt-loop.banger'");
    assert.equal(calls, 2);
    assert.equal(await evaluate("JSON.stringify(window.bangerChatGPT).includes('fake-ui-access')"), false);
    assert.equal(await evaluate("JSON.stringify(document.body.textContent).includes('fake-ui-access')"), false);
    await evaluate("document.querySelector('[aria-label=\"Close AI chat\"]').click()");
    const projectDir = join(directory, 'songs');
    await mkdir(projectDir);
    await writeFile(join(projectDir, 'song.banger'), source);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [projectDir] });
    await click('Open project folder');
    await wait("document.querySelector('#workspace-source')?.value.includes('tempo 101')");
    await evaluate(`(() => { const input = document.getElementById('workspace-prompt'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Slow this song to 88 BPM'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await click('Run project task');
    await wait("document.querySelector('#workspace-source')?.value.includes('tempo 88')");
    await wait("document.querySelector('.project-workspace-notice')?.textContent.includes('clap loop')");
    assert.equal(projectCalls, 2);
    assert.match(await readFile(join(projectDir, 'song.banger'), 'utf8'), /tempo 88;/);
    await click('BYOK');
    await wait("document.querySelector('#chatgpt-title')");
    await writeFile(join(tmpdir(), 'banger-chatgpt-settings.png'), (await window.webContents.capturePage()).toPNG());
    await click('Sign out');
    await wait("!document.querySelector('.chatgpt-usage')");
    const decrypted = (await safeStorage.decryptStringAsync(await readFile(join(directory, 'chatgpt-accounts.enc')))).result;
    assert.equal(decrypted.includes('fake-ui-access'), false);
    assert.equal(decrypted.includes('fake-ui-refresh'), false);
    console.log('ChatGPT UI smoke passed: real browser launch/cancel IPC, encrypted fake-account selection, models, plan indicator, usage link, namespaced chat and project-harness generation, and sign-out. No real account or paid request used.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { clearTimeout(timeout); for (const window of BrowserWindow.getAllWindows()) window.destroy(); await rm(directory, { recursive: true, force: true }); app.exit(process.exitCode ?? 0); }
}
