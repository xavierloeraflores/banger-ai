import { Sandbox } from '@vercel/sandbox';
import { claim, checkpoint } from './jobs';
import { runAgentStep } from './sandbox';
import { runElevenStep } from './elevenlabs';
import { authorize } from './projects';
import { ApiError } from './domain';
import { db } from './db';
export async function workOne(jobId?: string) {
  const job = await claim(jobId);
  if (!job) return false;
  try {
    await authorize(job.user_id, job.project_id, true);
    if (job.kind === 'agent') await runAgentStep(job); else await runElevenStep(job);
  } catch (error) {
    const permanent = error instanceof ApiError && [400,403,404,413,422,504].includes(error.status);
    const uncertain = job.kind === 'elevenlabs' && Boolean(job.checkpoint.submitting);
    const status = uncertain ? 'needs_review' : permanent || job.attempts >= 12 ? 'failed' : 'queued';
    const message = error instanceof ApiError ? error.message : 'The service could not finish this step. It will retry from its saved checkpoint.';
    await checkpoint(job, status === 'queued' ? 'retrying' : status, job.progress, {}, status, null, message).catch(() => undefined);
    if (status === 'failed' && job.kind === 'agent') {
      await db().query("UPDATE agent_sessions SET status='failed' WHERE id=$1", [job.session_id]);
      await Sandbox.get({ name: `banger-${job.id}` }).then(sandbox => sandbox.stop()).catch(() => undefined);
    }
  }
  return true;
}
