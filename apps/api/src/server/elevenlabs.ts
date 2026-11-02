import { randomUUID } from "node:crypto";
import { get, head, put } from "@vercel/blob";
import { transaction } from "./db";
import { ApiError } from "./domain";
import { authorize } from "./projects";
import { checkpoint, elevenInput, type Job } from "./jobs";
import { getArtifact, MAX_AUDIO_BYTES } from "./artifacts";
export async function boundedAudio(stream: ReadableStream<Uint8Array>, limit = MAX_AUDIO_BYTES): Promise<Buffer> {
  const reader = stream.getReader(); const chunks: Buffer[] = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > limit) throw new ApiError(413, 'Audio exceeds 100 MiB.'); chunks.push(Buffer.from(part.value)); }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}
export async function runElevenStep(job: Job) {
  if (!process.env.ELEVENLABS_API_KEY) throw new ApiError(503, 'ElevenLabs is not configured.');
  const input = elevenInput.parse(job.input);
  const source = await getArtifact(job.user_id, input.artifactId, true);
  if (source.project_id !== job.project_id || source.status !== 'ready' || source.kind !== 'wav') throw new ApiError(400, 'The source WAV is unavailable.');
  const pathname = `projects/${job.project_id}/elevenlabs/${job.id}.${input.operation === 'audio-isolation' ? 'wav' : 'mp3'}`;
  let metadata = await head(pathname).catch((error: unknown) => {
    if (error instanceof Error && error.name === 'BlobNotFoundError') return null;
    throw error;
  });
  if (!metadata) {
    if (job.checkpoint.submitting) {
      // ElevenLabs has no documented idempotency key for these endpoints. Never bill twice on an ambiguous retry.
      await checkpoint(job, 'needs-review', 40, {}, 'needs_review', null, 'The provider request was interrupted. Check ElevenLabs history before explicitly submitting a new job.'); return;
    }
    const audio = await get(source.pathname, { access: 'private' });
    if (!audio || audio.statusCode !== 200) throw new ApiError(502, 'The source WAV could not be read.');
    const bytes = await boundedAudio(audio.stream);
    const form = new FormData(); form.append('audio', new Blob([new Uint8Array(bytes)], {type:'audio/wav'}), 'source.wav');
    const endpoint = input.operation === 'audio-isolation' ? 'audio-isolation' : `voice-changer/${encodeURIComponent(input.voiceId!)}`;
    if (input.operation === 'voice-conversion') form.append('model_id', 'eleven_multilingual_sts_v2');
    await checkpoint(job, 'submitting', 40, { submitting: true }, 'running');
    const response = await fetch(`https://api.elevenlabs.io/v1/${endpoint}`, { method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }, body: form, signal: AbortSignal.timeout(180000) });
    if (!response.ok || !response.body) {
      if (response.status >= 400 && response.status < 500) await checkpoint(job, 'failed', 40, {}, 'failed', null, `ElevenLabs rejected the request (${response.status}).`);
      else await checkpoint(job, 'needs-review', 40, {}, 'needs_review', null, 'ElevenLabs returned an uncertain response. Review provider history before resubmitting.');
      return;
    }
    const contentType = response.headers.get('content-type')?.split(';')[0] ?? 'audio/mpeg';
    if (!['audio/mpeg','audio/wav','audio/x-wav'].includes(contentType)) throw new ApiError(502, 'ElevenLabs returned an unexpected file type.');
    const result = await boundedAudio(response.body);
    await put(pathname, result, { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType });
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
