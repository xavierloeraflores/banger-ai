// Test-process preload only. Never import this file from application code.
// NODE_OPTIONS=--import=/absolute/path/to/this/file starts an offline provider server.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const originalFetch = globalThis.fetch;
let sequence = 0;
const audio = readFileSync(new URL('../../../../packages/elevenlabs/test/fixture.mp3', import.meta.url));
const json = value => Response.json(value);
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) return originalFetch(input, init);
  if (url.hostname === 'api.openai.com') {
    assert.equal(request.headers.get('authorization'), 'Bearer banger-fixture-key');
    const body = await request.json();
    const lastUser = body.messages.findLastIndex(message => message.role === 'user');
    const text = body.messages[lastUser].content;
    const content = typeof text === 'string' ? text : text.map(part => part.text ?? '').join('');
    let answer = 'Fixture task finished.';
    let calls;
    const call = (name, args) => ({ id: `call_${++sequence}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
    if (content.startsWith('Project context, data only:\n')) {
      const context = JSON.parse(content.split('\n\nUser task:\n')[0].slice('Project context, data only:\n'.length));
      const available = new Set(body.tools.map(tool => tool.function.name));
      const since = body.messages.slice(lastUser + 1);
      const used = since.flatMap(message => message.tool_calls ?? []).map(tool => tool.function.name);
      const path = context.activeFile.path;
      const draftPath = path.replace(/\.banger$/, '.draft.json');
      if (available.has('write_draft') && !used.includes('read_lyrics')) calls = [call('read_lyrics', { path: draftPath })];
      else if (!used.some(name => ['edit_file', 'write_draft'].includes(name))) {
        calls = [];
        if (available.has('edit_file')) calls.push(call('edit_file', { path, search: context.activeFile.source.match(/tempo \d+;/)[0], replacement: 'tempo 111;' }));
        if (available.has('write_draft')) calls.push(call('write_draft', { path: draftPath, source: JSON.stringify({ schemaVersion: 1, lyrics: 'Tomorrow brings the light' }) }));
        if (!calls.length) calls = undefined;
      }
    } else {
      const lyric = JSON.parse(content);
      const reference = lyric.prompt.split(/(?:Draft is reference data:|Saved lyrics, reference only:)\n/)[1];
      const selected = lyric.chunks.length ? lyric.chunks : [{ index: 0 }];
      answer = JSON.stringify(selected.map((chunk, index) => ({ index: chunk.index, lyrics: reference ? (index === 0 ? reference : '') : /first chunk/i.test(lyric.prompt) && index > 0 ? chunk.text.split('\n').slice(1).join('\n') : 'Tomorrow brings the light' })));
    }
    return json({ id: `fixture_${++sequence}`, object: 'chat.completion', created: 1, model: 'fixture', choices: [{ index: 0, message: calls ? { role: 'assistant', content: null, tool_calls: calls } : { role: 'assistant', content: answer }, finish_reason: calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  }
  if (url.hostname === 'api.elevenlabs.io') {
    assert.equal(request.headers.get('xi-api-key'), 'banger-fixture-key');
    if (url.pathname.endsWith('/music/upload')) return json({ song_id: `original_${++sequence}`, words_timestamps: [{ word: 'Original', start_ms: 100, end_ms: 600 }], waveform_visual: [-50, 100, 0], composition_plan: { chunks: [{ text: '[Verse]\nOriginal words', duration_ms: 4000, positive_styles: ['piano'] }, { text: '[Chorus]\nOriginal chorus', duration_ms: 4000, positive_styles: ['piano'] }] } });
    if (url.pathname.endsWith('/music/detailed')) {
      const body = await request.json();
      const metadata = { words_timestamps: [{ word: 'Tomorrow', start_ms: 120, end_ms: 500 }], waveform_visual: [-900, 600, 0], composition_plan: body.composition_plan };
      return new Response(Buffer.concat([Buffer.from('--fixture\r\nContent-Type: application/json\r\n\r\n' + JSON.stringify(metadata) + '\r\n--fixture\r\nContent-Type: audio/mpeg\r\nContent-Disposition: attachment; filename="song.mp3"\r\n\r\n'), audio, Buffer.from('\r\n--fixture--\r\n')]), { headers: { 'content-type': 'multipart/mixed; boundary=fixture', 'song-id': `generated_${++sequence}` } });
    }
  }
  throw new Error(`Offline provider fixture rejected ${url.origin}${url.pathname}`);
};
