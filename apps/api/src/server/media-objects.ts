import { get, head, put } from '@vercel/blob';
import { constants } from 'node:fs';
import { mkdir, open, link, unlink, lstat, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { ApiError } from './domain';

export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
export const localMediaEnabled = () => Boolean(process.env.BANGER_LOCAL_DATA_DIR);
export async function boundedAudio(stream: ReadableStream<Uint8Array>, limit = MAX_AUDIO_BYTES): Promise<Buffer> {
  const reader = stream.getReader(); const chunks: Buffer[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > limit) throw new ApiError(413, 'Audio exceeds 100 MiB.'); chunks.push(Buffer.from(part.value)); } }
  finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}
async function localPath(path: string) {
  const parts = path.split('/');
  if (parts.some(part => !part || part.startsWith('.') || /[\\\0]/.test(part))) throw new ApiError(400, 'Invalid media path.');
  const configured = process.env.BANGER_LOCAL_DATA_DIR;
  if (!configured) throw new ApiError(503, 'Audio storage is not configured.');
  await mkdir(configured, { recursive: true, mode: 0o700 });
  let directory = await realpath(configured);
  for (const part of parts.slice(0, -1)) {
    directory = join(directory, part);
    await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ApiError(400, 'Invalid media directory.');
  }
  return join(directory, parts.at(-1)!);
}
export interface MusicObjects {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<Buffer>;
  write(path: string, body: string | Buffer, contentType: string): Promise<void>;
  size(path: string): Promise<number>;
}
export const mediaObjects: MusicObjects & { stream(path: string): Promise<ReadableStream<Uint8Array>> } = {
  async exists(path) {
    if (localMediaEnabled()) { try { await this.size(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
    return Boolean(await head(path).catch((error: unknown) => { if (error instanceof Error && error.name === 'BlobNotFoundError') return null; throw error; }));
  },
  async read(path) { return boundedAudio(await this.stream(path)); },
  async stream(path) {
    if (localMediaEnabled()) {
      await this.size(path);
      const file = await open(await localPath(path), constants.O_RDONLY | constants.O_NOFOLLOW);
      return Readable.toWeb(file.createReadStream()) as ReadableStream<Uint8Array>;
    }
    const data = await get(path, { access: 'private' });
    if (!data || data.statusCode !== 200) throw new ApiError(404, 'Saved audio is unavailable.');
    return data.stream;
  },
  async size(path) {
    if (!localMediaEnabled()) return (await head(path)).size;
    const file = await open(await localPath(path), constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const stat = await file.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_AUDIO_BYTES) throw new ApiError(400, 'Invalid media file.'); return stat.size; }
    finally { await file.close(); }
  },
  async write(path, body, contentType) {
    if (Buffer.byteLength(body) > MAX_AUDIO_BYTES) throw new ApiError(413, 'Audio exceeds 100 MiB.');
    if (!localMediaEnabled()) { await put(path, body, { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType }); return; }
    const destination = await localPath(path), temporary = join(dirname(destination), `.pending-${randomUUID()}`);
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(body); await file.sync(); } finally { await file.close(); }
      await link(temporary, destination);
    } finally { await unlink(temporary).catch(() => {}); }
  },
};
