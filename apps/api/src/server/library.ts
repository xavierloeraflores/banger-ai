import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { associatedBeatSchema, librarySongType } from '@banger/elevenlabs/protocol';
import { db } from './db';
import { ApiError, id } from './domain';
import { getArtifact } from './artifacts';
import { getMusic } from './elevenlabs';

export const libraryInput = z.object({ artifactId: id, name: z.string().trim().min(1).max(160), scope: z.enum(['global','project']).default('global'), beat: associatedBeatSchema.optional(), musicId: id.optional(), version: z.number().int().positive().optional() }).strict();
export async function saveLibraryEntry(user: string, value: unknown) {
  const input = libraryInput.parse(value);
  const artifact = await getArtifact(user, input.artifactId);
  if (artifact.status !== 'ready') throw new ApiError(409, 'Wait for the audio upload to finish.');
  let lyrics, recording;
  if (input.musicId) {
    const music = await getMusic(user, input.musicId);
    lyrics = (await db().query('SELECT document FROM music_versions WHERE music_id=$1 AND revision=$2', [music.id, input.version ?? music.revision])).rows[0]?.document;
    if (!lyrics || lyrics.audioId !== artifact.id || music.project_id !== artifact.project_id) throw new ApiError(400, 'Choose audio and lyrics from the same recording.');
    recording = (await db().query('SELECT document FROM music_versions WHERE music_id=$1 AND revision=$2', [music.id, lyrics.audioVersion])).rows[0]?.document;
  }
  const entry = randomUUID();
  await db().query('INSERT INTO library_entries(id,user_id,project_id,artifact_id,name,scope,beat,lyrics,song_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [entry, user, artifact.project_id, artifact.id, input.name, input.scope, input.beat ?? lyrics?.beat ?? null, recording ?? lyrics ?? null, librarySongType(recording ?? lyrics)]);
  return { id: entry, name: input.name, scope: input.scope };
}
export async function readLibraryEntry(user: string, entry: string) {
  const row = (await db().query('SELECT * FROM library_entries WHERE id=$1 AND user_id=$2', [entry, user])).rows[0];
  if (!row) throw new ApiError(404, 'Library song not found.');
  const artifact = await getArtifact(user, row.artifact_id);
  return { artifactId: artifact.id, contentType: artifact.content_type, beat: row.beat ?? undefined, lyrics: row.lyrics ?? undefined };
}
