import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";
import { projectObjects } from "./project-objects";
import { blobs } from "./blob";
import { ApiError, hash, changeSchema } from "./domain";
import { agentInput, checkpoint, type Job } from "./jobs";
import { readManifest, saveChanges } from "./projects";
import { db } from "./db";
import { claimAgentFile, releaseAgentFiles } from './agent-file-claims';
const resultSchema = z.object({ status: z.enum(["completed", "incomplete", "failed"]), text: z.string().max(64000).optional(), error: z.string().max(1000).optional(), files: z.array(changeSchema.extend({ source: z.string().max(65536) })).max(256).optional() });
export async function runAgentStep(job: Job) {
  const input = agentInput.parse(job.input);
  const name = `banger-${job.id}`;
  if (!job.checkpoint.started) {
    if (!process.env.SANDBOX_RUNNER_BLOB_PATH || !process.env.BANGER_MODEL || !process.env.BANGER_API_KEY) throw new ApiError(503, "The cloud agent is not configured.");
    const manifest = await readManifest(job.project_id, input.baseRevision);
    const files = [];
    for (const file of manifest.files) {
      const source = await projectObjects.text(file.pathname);
      if (hash(source) !== file.sha256) throw new ApiError(502, "Project integrity check failed.");
      files.push({ path: file.path, source });
    }
    const sandbox = await Sandbox.getOrCreate({ name, runtime: "node24", timeout: 600000 });
    await db().query("UPDATE agent_sessions SET sandbox_id=$2,status='running' WHERE id=$1", [job.session_id, name]);
    // Replayed initialization only writes outside the workspace. The runner owns its lock.
    await sandbox.writeFiles([
      { path: '/vercel/sandbox/runner.mjs', content: await blobs.text(process.env.SANDBOX_RUNNER_BLOB_PATH) },
      { path: '/vercel/sandbox/input.json', content: JSON.stringify({ ...input, files }) },
    ]);
    await sandbox.runCommand({ cmd: 'node', args: ['/vercel/sandbox/runner.mjs'], detached: true, env: {
      BANGER_PROVIDER: process.env.BANGER_PROVIDER ?? 'openai', BANGER_MODEL: process.env.BANGER_MODEL, BANGER_API_KEY: process.env.BANGER_API_KEY,
    } });
    await checkpoint(job, 'editing', 25, { started: true, sandbox: name, startedAt: Date.now() });
    return;
  }
  const sandbox = typeof job.checkpoint.candidate === 'string' ? undefined : await Sandbox.get({ name });
  try {
    const raw = typeof job.checkpoint.candidate === 'string' ? Buffer.from(await blobs.text(job.checkpoint.candidate)) : await sandbox!.readFileToBuffer({ path: '/vercel/sandbox/result.json' });
    if (!raw) {
      if (Date.now() - Number(job.checkpoint.startedAt) > 8 * 60000) throw new ApiError(504, "The agent timed out. The saved project is unchanged.");
      const progress = await sandbox!.readFileToBuffer({ path: '/vercel/sandbox/progress.json' });
      const activity = progress ? z.object({ activity: z.array(z.string().max(1200)).max(40) }).parse(JSON.parse(progress.toString())).activity : [];
      await checkpoint(job, 'editing', 50, { activity }); return;
    }
    if (raw.length > 5 * 1024 * 1024) throw new ApiError(413, "The agent result exceeds the project limit.");
    const result = resultSchema.parse(JSON.parse(raw.toString()));
    if (result.status === 'failed' || !result.files) throw new ApiError(422, result.error ?? 'The agent did not produce a valid workspace.');
    const candidate = typeof job.checkpoint.candidate === 'string' ? job.checkpoint.candidate : `projects/${job.project_id}/agent-results/${job.id}.json`;
    if (!job.checkpoint.candidate) {
      // Durable candidate survives conflicts and Sandbox cleanup.
      try { await blobs.write(candidate, JSON.stringify(result), 'application/json'); }
      catch (error) { if (await blobs.text(candidate).catch(() => '') !== JSON.stringify(result)) throw error; }
      await checkpoint(job, 'publishing', 90, { candidate }, 'running');
    }
    const base = await readManifest(job.project_id, input.baseRevision);
    const changes = [...result.files, ...base.files.filter(file => !result.files!.some(next => next.path === file.path)).map(file => ({path:file.path,source:null}))]
      .filter(file => file.source === null || base.files.find(previous => previous.path === file.path)?.sha256 !== hash(file.source));
    try {
      for (const change of changes) await claimAgentFile(job.project_id, change.path, job.session_id!, job.lease_token);
      const manifest = await saveChanges(job.user_id, job.project_id, input.baseRevision, changes, projectObjects, { id: job.id, lease: job.lease_token });
      await db().query("UPDATE agent_sessions SET status=$2 WHERE id=$1", [job.session_id, result.status]);
      return manifest;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await checkpoint(job, 'conflict', 90, {}, 'conflict', { candidateAvailable: true, text: result.text }, error.message);
        await db().query("UPDATE agent_sessions SET status='conflict' WHERE id=$1", [job.session_id]);
      } else throw error;
    } finally { await releaseAgentFiles(job.project_id, job.session_id!, job.lease_token); }
  } finally {
    const state = (await db().query("SELECT status FROM jobs WHERE id=$1", [job.id])).rows[0]?.status;
    if (!['queued', 'running'].includes(state)) {
      const cleanup = sandbox ?? await Sandbox.get({ name }).catch(() => undefined);
      await cleanup?.stop().catch(() => undefined);
    }
  }
}
