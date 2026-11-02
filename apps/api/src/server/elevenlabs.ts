import { randomUUID } from "node:crypto";
import { get, head, put } from "@vercel/blob";
import { transaction } from "./db";
import { ApiError } from "./domain";
import { authorize } from "./projects";
import { checkpoint, elevenInput, type Job } from "./jobs";
import { getArtifact, MAX_AUDIO_BYTES } from "./artifacts";
import { audioProvider, type AudioProvider } from "./audio-provider";
export async function boundedAudio(stream: ReadableStream<Uint8Array>, limit = MAX_AUDIO_BYTES): Promise<Buffer> {
  const reader = stream.getReader(); const chunks: Buffer[] = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > limit) throw new ApiError(413, 'Audio exceeds 100 MiB.'); chunks.push(Buffer.from(part.value)); }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}
export async function runElevenStep(job: Job, provider: AudioProvider | undefined = audioProvider()) {
  if (!provider) { await checkpoint(job, 'awaiting-provider', 0, {}, 'awaiting_provider', null, 'ElevenLabs integration is not implemented yet. Your submission is saved.'); return; }
  const input = elevenInput.parse(job.input);
  const source = await getArtifact(job.user_id, input.artifactId, true);
  if (source.project_id !== job.project_id || source.status !== 'ready' || source.kind !== 'wav') throw new ApiError(400, 'The source WAV is unavailable.');
  const pathname = `projects/${job.project_id}/elevenlabs/${job.id}/result`;
  let metadata = await head(pathname).catch((error: unknown) => {
    if (error instanceof Error && error.name === 'BlobNotFoundError') return null;
    throw error;
  });
  if (!metadata) {
    if (typeof job.checkpoint.providerRequestId !== 'string') {
      const audio = await get(source.pathname, { access: 'private' });
      if (!audio || audio.statusCode !== 200) throw new ApiError(502, 'The source WAV could not be read.');
      const bytes = await boundedAudio(audio.stream);
      await checkpoint(job, 'submitting', 10, {}, 'running');
      const submitted = await provider.submit({ idempotencyKey: job.id, audio: bytes, contentType: 'audio/wav' });
      await checkpoint(job, 'processing', 20, { providerRequestId: submitted.requestId });
      return;
    }
    const result = await provider.poll(job.checkpoint.providerRequestId);
    if (result.status === 'processing') { await checkpoint(job, 'processing', Math.max(20, Math.min(90, Math.round(result.progress))), {}); return; }
    if (result.status === 'failed') { await checkpoint(job, 'failed', job.progress, {}, 'failed', null, result.error.slice(0,500)); return; }
    const bytes = await boundedAudio(result.audio);
    await put(pathname, bytes, { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: result.contentType });
    metadata = await head(pathname);
  }
  await transaction(async client => {
    await authorize(job.user_id, job.project_id, true, client, true);
    const lease = await client.query("SELECT id FROM jobs WHERE id=$1 AND lease_token=$2 AND lease_until>now() AND status='running' FOR UPDATE", [job.id, job.lease_token]);
    if (!lease.rowCount) throw new ApiError(409, 'Job lease expired.');
    const artifact = (await client.query("INSERT INTO artifacts(id,project_id,revision,user_id,kind,pathname,content_type,size,status) VALUES($1,$2,$3,$4,'elevenlabs',$5,$6,$7,'ready') ON CONFLICT(pathname) DO UPDATE SET pathname=EXCLUDED.pathname RETURNING id", [randomUUID(),job.project_id,source.revision,job.user_id,pathname,metadata.contentType,metadata.size])).rows[0];
    await client.query("UPDATE jobs SET status='completed',stage='completed',progress=100,result=$3,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2", [job.id,job.lease_token,{artifactId:artifact.id}]);
  });
}
