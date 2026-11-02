import { after } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { z, ZodError } from 'zod';
import { get } from '@vercel/blob';
import type { HandleUploadBody } from '@vercel/blob/client';
import { authenticate } from '../../../server/auth';
import { ApiError, changeSchema, id, saveSchema } from '../../../server/domain';
import { db } from '../../../server/db';
import { authorize, createProject, projectFiles, saveChanges, setMember } from '../../../server/projects';
import { enqueue, getJob, publicJob } from '../../../server/jobs';
import { workOne } from '../../../server/worker';
import { finalizeWav, getArtifact, reserveWav, uploadCallback } from '../../../server/artifacts';
import { blobs } from '../../../server/blob';
export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => Response.json(body, {status});
async function body(request: Request) {
  if (Number(request.headers.get('content-length') ?? 0) > 4 * 1024 * 1024) throw new ApiError(413,'Request exceeds 4 MiB.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400,'A JSON body is required.');
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 4 * 1024 * 1024) throw new ApiError(413,'Request exceeds 4 MiB.'); chunks.push(part.value); } }
  finally { await reader.cancel(); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new ApiError(400,'Invalid JSON.'); }
}
async function dispatch(request: Request, path: string[]) {
  const method = request.method;
  const url = new URL(request.url);
  if (path.join('/') === 'worker' && ['GET','POST'].includes(method)) {
    const secret = process.env.CRON_SECRET, provided = request.headers.get('authorization') ?? '';
    const expected = `Bearer ${secret}`;
    if (!secret || provided.length !== expected.length || !timingSafeEqual(Buffer.from(provided),Buffer.from(expected))) throw new ApiError(401,'Unauthorized worker.');
    return json({ worked: await workOne() });
  }
  if (path.join('/') === 'uploads' && method === 'POST') return json(await uploadCallback(request, await body(request) as HandleUploadBody));
  const user = await authenticate(request);
  if (path[0] === 'projects') {
    if (path.length === 1) {
      if (method === 'GET') return json({projects:(await db().query('SELECT p.id,p.name,p.revision FROM projects p WHERE p.owner_id=$1 OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=$1) ORDER BY p.created_at DESC LIMIT 100',[user])).rows});
      if (method === 'POST') {
        const input = z.object({name:z.string().trim().min(1).max(120),files:z.array(changeSchema).max(256)}).strict().parse(await body(request));
        return json(await createProject(user,input.name,input.files),201);
      }
    }
    const project = id.parse(path[1]);
    if (path.length === 2 && method === 'GET') return json(await projectFiles(user,project,url.searchParams.has('since') ? z.coerce.number().int().nonnegative().parse(url.searchParams.get('since')) : undefined));
    if (path.length === 2 && method === 'PATCH') { const input=saveSchema.parse(await body(request)); return json(await saveChanges(user,project,input.baseRevision,input.changes)); }
    if (path[2] === 'members' && path.length === 3 && method === 'PUT') { const input=z.object({userId:z.string().min(1).max(256),role:z.enum(['viewer','editor']).nullable()}).strict().parse(await body(request)); await setMember(user,project,input.userId,input.role); return json({ok:true}); }
    if (path[2] === 'jobs' && path.length === 3) {
      if (method === 'POST') {
        const input=z.object({kind:z.enum(['agent','elevenlabs']),idempotencyKey:id,input:z.unknown()}).strict().parse(await body(request));
        const job=await enqueue(user,project,input.kind,input.idempotencyKey,input.input);
        after(() => workOne(job.id).then(() => undefined)); return json(publicJob(job),202);
      }
      if (method === 'GET') { await authorize(user,project); return json({jobs:(await db().query('SELECT * FROM jobs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 50',[project])).rows.map(publicJob)}); }
    }
    if (path[2] === 'artifacts' && path.length === 3) {
      if (method === 'POST') { const input=z.object({revision:z.number().int().nonnegative()}).strict().parse(await body(request)); return json(await reserveWav(user,project,input.revision),201); }
      if (method === 'GET') { await authorize(user,project); return json({artifacts:(await db().query("SELECT id,revision,kind,content_type,size,status,created_at FROM artifacts WHERE project_id=$1 ORDER BY created_at DESC LIMIT 50",[project])).rows}); }
    }
  }
  if (path[0] === 'jobs') {
    const job=await getJob(user,id.parse(path[1]));
    if (path.length === 2 && method === 'GET') return json(publicJob(job));
    if (path[2] === 'resume' && method === 'POST') { await authorize(user,job.project_id,true); if (job.status === 'awaiting_provider') await db().query("UPDATE jobs SET status='queued',available_at=now() WHERE id=$1 AND status='awaiting_provider'", [job.id]); after(() => workOne(job.id).then(() => undefined)); return json(publicJob(job),202); }
    if (path[2] === 'candidate' && method === 'GET' && typeof job.checkpoint.candidate === 'string') return json(JSON.parse(await blobs.text(job.checkpoint.candidate)));
  }
  if (path[0] === 'artifacts') {
    const artifact=await getArtifact(user,id.parse(path[1]),method === 'POST');
    if (path[2] === 'complete' && method === 'POST') { await finalizeWav(artifact.id); return json({id:artifact.id,status:'ready'}); }
    if (path.length === 2 && method === 'GET') {
      if (artifact.status !== 'ready') throw new ApiError(409,'Audio is still uploading.');
      const data=await get(artifact.pathname,{access:'private'});
      if (!data || data.statusCode !== 200) throw new ApiError(404,'Audio unavailable.');
      return new Response(data.stream,{headers:{'Content-Type':artifact.content_type,'Content-Disposition':`inline; filename="${artifact.id}.${artifact.content_type === 'audio/mpeg' ? 'mp3' : 'wav'}"`,'X-Content-Type-Options':'nosniff'}});
    }
  }
  throw new ApiError(404,'Endpoint not found.');
}
async function route(request:Request,context:{params:Promise<{path:string[]}>}) {
  const origin=request.headers.get('origin');
  const allowed=(process.env.CLIENT_ORIGINS ?? '').split(',').map(value=>value.trim()).filter(Boolean);
  const same=origin === new URL(request.url).origin;
  let response:Response;
  try {
    if (origin && !same && !allowed.includes(origin)) throw new ApiError(403,'This client origin is not allowed.');
    response=request.method === 'OPTIONS' ? new Response(null,{status:204}) : await dispatch(request,(await context.params).path);
  } catch (error) {
    if (error instanceof ApiError) response=json({error:error.message,details:error.details},error.status);
    else if (error instanceof ZodError) response=json({error:'Invalid request.',details:error.issues},400);
    else { console.error('API request failed', error instanceof Error ? error.name : 'UnknownError'); response=json({error:'The service could not complete the request.'},500); }
  }
  response.headers.set('Cache-Control','private, no-store'); response.headers.set('Vary','Origin');
  if (origin && (same || allowed.includes(origin))) { response.headers.set('Access-Control-Allow-Origin',origin); response.headers.set('Access-Control-Allow-Headers','Authorization, Content-Type'); response.headers.set('Access-Control-Allow-Methods','GET, POST, PATCH, PUT, OPTIONS'); }
  return response;
}
export {route as GET,route as POST,route as PATCH,route as PUT,route as OPTIONS};
