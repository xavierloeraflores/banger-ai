import { randomUUID } from "node:crypto";
import { z } from "zod";
import { musicActionSchema, musicActionBase } from "@banger/elevenlabs/protocol";
import { db, transaction } from "./db";
import { authorize } from "./projects";
import { ApiError, id, pathSchema } from "./domain";
export const agentInput = z.object({ baseRevision: z.number().int().nonnegative(), prompt: z.string().trim().min(1).max(16000), activeFile: pathSchema.optional() }).strict();
export const elevenInput = z.union([
  z.object({ clientKeyRequired: z.boolean().optional(), artifactId: id, operation: z.literal('analyze').default('analyze') }).strict(),
  z.object({ clientKeyRequired: z.boolean().optional(), musicId: id, action: musicActionSchema }).strict(),
]);
export type Job = { id: string; project_id: string; user_id: string; kind: "agent" | "elevenlabs"; session_id: string | null; status: string; stage: string; progress: number; input: Record<string, unknown>; checkpoint: Record<string, unknown>; result: Record<string, unknown> | null; error: string | null; lease_token: string; attempts: number; created_at: Date };
export async function enqueue(user: string, project: string, kind: Job["kind"], key: string, input: unknown) {
  const parsed = kind === "agent" ? agentInput.parse(input) : elevenInput.parse(input);
  return transaction(async client => {
    const current = await authorize(user, project, true, client, true);
    const previous = (await client.query("SELECT * FROM jobs WHERE user_id=$1 AND idempotency_key=$2", [user, key])).rows[0];
    if (previous) {
      const match = await client.query("SELECT 1 FROM jobs WHERE id=$1 AND project_id=$2 AND kind=$3 AND input=$4::jsonb", [previous.id, project, kind, parsed]);
      if (!match.rowCount) throw new ApiError(409, "This request key was already used for a different task.");
      return previous as Job;
    }
    const active = (await client.query("SELECT count(*)::int AS count FROM jobs WHERE project_id=$1 AND status IN ('queued','running')", [project])).rows[0].count;
    if (active >= 4) throw new ApiError(429, "This project already has four active jobs.");
    let session: string | null = null;
    if (kind === "agent") {
      const agent = agentInput.parse(parsed);
      if (current.revision !== agent.baseRevision) throw new ApiError(409, "Reload the project before running the agent.", { currentRevision: current.revision });
      session = randomUUID();
      await client.query("INSERT INTO agent_sessions(id,project_id,user_id,base_revision) VALUES($1,$2,$3,$4)", [session, project, user, agent.baseRevision]);
    } else {
      const eleven = elevenInput.parse(parsed);
      if ('artifactId' in eleven) {
        const artifact = await client.query("SELECT 1 FROM artifacts WHERE id=$1 AND project_id=$2 AND kind='wav' AND status='ready'", [eleven.artifactId, project]);
        if (!artifact.rowCount) throw new ApiError(400, "Choose an uploaded WAV from this project.");
      } else {
        const music = (await client.query("SELECT revision,current_version FROM music_sessions WHERE id=$1 AND project_id=$2", [eleven.musicId,project])).rows[0];
        if (!music) throw new ApiError(404, "Music session not found.");
        if (music.revision !== eleven.action.baseVersion) throw new ApiError(409, "This song changed. Reload its composition plan.");
        const source=eleven.action.sourceVersion?(await client.query('SELECT document FROM music_versions WHERE music_id=$1 AND revision=$2',[eleven.musicId,eleven.action.sourceVersion])).rows[0]?.document:music.current_version;
        if(!source)throw new ApiError(404,'Music version not found.');
        try{musicActionBase(music.current_version,source,eleven.action);}catch(error){throw new ApiError(400,error instanceof Error?error.message:'Invalid composition action.');}
        const pending = await client.query("SELECT 1 FROM jobs WHERE project_id=$1 AND input->>'musicId'=$2 AND status IN ('queued','running') LIMIT 1", [project,eleven.musicId]);
        if (pending.rowCount) throw new ApiError(409, "Wait for the current song operation to finish.");
      }
    }
    return (await client.query("INSERT INTO jobs(id,project_id,user_id,kind,idempotency_key,session_id,input) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *", [randomUUID(), project, user, kind, key, session, parsed])).rows[0] as Job;
  });
}
export async function claim(jobId?: string): Promise<Job | undefined> {
  // A lease is longer than a worker invocation. Only its token may checkpoint or publish.
  const result = await db().query(`UPDATE jobs SET status='running',lease_token=$2,lease_until=now()+interval '6 minutes',attempts=attempts+1,updated_at=now()
    WHERE id=(SELECT id FROM jobs WHERE ($1::uuid IS NULL OR id=$1) AND status IN ('queued','running') AND available_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, [jobId ?? null, randomUUID()]);
  return result.rows[0];
}
export async function checkpoint(job: Job, stage: string, progress: number, data: Record<string, unknown>, status = "queued", result: Record<string, unknown> | null = null, error: string | null = null) {
  const updated = await db().query(`UPDATE jobs SET checkpoint=checkpoint || $3::jsonb,stage=$4,progress=$5,status=$6,result=COALESCE($7,result),error=$8,
    lease_token=CASE WHEN $6='running' THEN lease_token ELSE NULL END,lease_until=CASE WHEN $6='running' THEN lease_until ELSE NULL END,
    available_at=now()+interval '3 seconds',updated_at=now() WHERE id=$1 AND lease_token=$2 AND lease_until>now() AND status='running' RETURNING id`,
    [job.id, job.lease_token, data, stage, progress, status, result, error]);
  if (!updated.rowCount) throw new ApiError(409, "Job lease expired.");
  Object.assign(job.checkpoint, data);
}
export async function getJob(user: string, jobId: string) {
  const job = (await db().query("SELECT * FROM jobs WHERE id=$1", [jobId])).rows[0] as Job | undefined;
  if (!job) throw new ApiError(404, "Job not found.");
  await authorize(user, job.project_id);
  return job;
}
export function publicJob(job: Job) {
  return { id: job.id, projectId: job.project_id, kind: job.kind, status: job.status, stage: job.stage, progress: job.progress, result: job.result, error: job.error, activity: job.checkpoint.activity ?? [], createdAt: job.created_at };
}
