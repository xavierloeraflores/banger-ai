import { MAX_WAV_BYTES } from './protocol.js';

function camelCase(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelCase);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), camelCase(item),
    ]));
  }
  return value;
}

/** Parse MIME parts as bytes so binary audio is never decoded as text. */
export async function readMusicResponse(stream: ReadableStream<Uint8Array>, contentType: string | null) {
  const boundary = /boundary\s*=\s*(?:"([^"\r\n]+)"|([^;\s]+))/i.exec(contentType ?? '');
  const marker = boundary?.[1] ?? boundary?.[2];
  if (!marker || marker.length > 200) throw new Error('Missing music response boundary.');
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_WAV_BYTES + 4 * 1024 * 1024) throw new Error('Music response is too large.');
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks);
  const delimiter = Buffer.from(`--${marker}`);
  const nextDelimiter = (from: number): number => {
    let index = body.indexOf(delimiter, from);
    while (index !== -1) {
      const end = index + delimiter.length;
      if ((index === 0 || body[index - 1] === 10) &&
          (body.subarray(end, end + 2).equals(Buffer.from('--')) || body[end] === 10 ||
           (body[end] === 13 && body[end + 1] === 10))) return index;
      index = body.indexOf(delimiter, index + 1);
    }
    return -1;
  };
  let cursor = nextDelimiter(0);
  let json: Record<string, unknown> | undefined;
  let audio: Buffer | undefined;
  let closed = false;
  while (cursor !== -1) {
    const start = cursor + delimiter.length;
    if (body.subarray(start, start + 2).equals(Buffer.from('--'))) { closed = true; break; }
    const next = nextDelimiter(start);
    if (next === -1) break;
    const partEnd = next - (body[next - 2] === 13 ? 2 : 1);
    const part = body.subarray(start, partEnd);
    let headerEnd = part.indexOf('\r\n\r\n');
    let separatorSize = 4;
    if (headerEnd === -1) { headerEnd = part.indexOf('\n\n'); separatorSize = 2; }
    if (headerEnd === -1) throw new Error('Invalid music part headers.');
    const headers = part.subarray(0, headerEnd).toString('utf8');
    const type = /(?:^|\n)content-type:\s*([^;\r\n]+)/i.exec(headers)?.[1]?.trim().toLowerCase();
    const data = part.subarray(headerEnd + separatorSize);
    if (type === 'application/json') {
      if (json) throw new Error('Duplicate music metadata.');
      const parsed = camelCase(JSON.parse(data.toString('utf8')));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid music metadata.');
      json = parsed as Record<string, unknown>;
    } else if (type?.startsWith('audio/') || type === 'application/octet-stream') {
      if (audio) throw new Error('Duplicate music audio.');
      audio = data;
    }
    cursor = next;
  }
  if (!closed || !json || !audio?.length || audio.length > MAX_WAV_BYTES) throw new Error('Incomplete music response.');
  return { json, audio };
}
