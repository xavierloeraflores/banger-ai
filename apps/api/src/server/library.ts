import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { associatedBeatSchema, librarySongType, type MusicVersion } from '@banger/elevenlabs/protocol';
import { db, transaction } from './db';
import { artworkContext, generateRecordArtwork, type ArtworkCredentials } from '@banger/agent';
import { ApiError, id } from './domain';
import { getArtifact } from './artifacts';
import { getMusic } from './elevenlabs';

export const libraryInput = z.object({ artifactId: id, name: z.string().trim().min(1).max(160), scope: z.enum(['global','project']).default('global'), beat: associatedBeatSchema.optional(), musicId: id.optional(), version: z.number().int().positive().optional() }).strict();
export async function saveLibraryEntry(user: string, value: unknown) {
  const input = libraryInput.parse(value);
  const artifact = await getArtifact(user, input.artifactId);
  if (artifact.status !== 'ready') throw new ApiError(409, 'Wait for the audio upload to finish.');
  let lyrics: MusicVersion | undefined, recording: MusicVersion | undefined;
  if (input.musicId) {
    const music = await getMusic(user, input.musicId);
    lyrics = (await db().query('SELECT document FROM music_versions WHERE music_id=$1 AND revision=$2', [music.id, input.version ?? music.revision])).rows[0]?.document;
    if (!lyrics || lyrics.audioId !== artifact.id || music.project_id !== artifact.project_id) throw new ApiError(400, 'Choose audio and lyrics from the same recording.');
    recording = (await db().query('SELECT document FROM music_versions WHERE music_id=$1 AND revision=$2', [music.id, lyrics.audioVersion])).rows[0]?.document;
  }
  const entry = randomUUID();
  const recordId = await transaction(async client => {
    const project = (await client.query('SELECT name,original_prompt FROM projects WHERE id=$1', [artifact.project_id])).rows[0];
    const context = artworkContext({ name: project.name, prompt: project.original_prompt ?? undefined, source: input.beat?.source ?? lyrics?.beat?.source, lyrics: lyrics ? JSON.stringify(lyrics) : undefined });
    const record = (await client.query('INSERT INTO library_records(id,user_id,project_id,name,context) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,project_id) DO UPDATE SET name=library_records.name RETURNING id', [randomUUID(), user, artifact.project_id, project.name.slice(0,160), context])).rows[0];
    await client.query('INSERT INTO library_entries(id,user_id,project_id,artifact_id,name,scope,beat,lyrics,song_type,record_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [entry, user, artifact.project_id, artifact.id, input.name, input.scope, input.beat ?? lyrics?.beat ?? null, recording ?? lyrics ?? null, librarySongType(recording ?? lyrics), record.id]);
    return record.id;
  });
  return { id: entry, recordId, name: input.name, scope: input.scope };
}
export async function readLibraryEntry(user: string, entry: string) {
  const row = (await db().query('SELECT * FROM library_entries WHERE id=$1 AND user_id=$2', [entry, user])).rows[0];
  if (!row) throw new ApiError(404, 'Library song not found.');
  const artifact = await getArtifact(user, row.artifact_id);
  return { artifactId: artifact.id, contentType: artifact.content_type, beat: row.beat ?? undefined, lyrics: row.lyrics ?? undefined };
}

export async function generateLibraryArtwork(user: string, recordId: string, credentials: ArtworkCredentials, generate = generateRecordArtwork) {
  const lease = randomUUID();
  const row = (await db().query(`UPDATE library_records SET lease_token=$3,lease_until=now()+interval '5 minutes',attempts=attempts+1
    WHERE id=$1 AND user_id=$2 AND artwork IS NULL AND attempts<3 AND (lease_until IS NULL OR lease_until<now()) RETURNING context`, [recordId,user,lease])).rows[0];
  if (!row) return;
  try {
    const artwork = await generate(row.context, credentials);
    await db().query('UPDATE library_records SET artwork=$3,lease_until=NULL,lease_token=NULL WHERE id=$1 AND lease_token=$2', [recordId,lease,artwork]);
  } catch {
    // Keep the song available and bound retries. Never persist provider errors or keys.
    await db().query('UPDATE library_records SET lease_until=NULL,lease_token=NULL WHERE id=$1 AND lease_token=$2', [recordId,lease]);
  }
}
