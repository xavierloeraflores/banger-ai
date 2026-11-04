import { saveLibraryEntry, readLibraryEntry, generateLibraryArtwork, renameLibraryRecord, requestArtworkRegeneration } from '../../../server/library';
import { readSongDraft, saveSongDraft } from '../../../server/song-drafts';
import { runWebTask } from '../../../server/web-task';
import { after } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { z, ZodError } from 'zod';
import { localMediaEnabled, mediaObjects, boundedAudio } from '../../../server/media-objects';
import { validateWav } from '@banger/elevenlabs';
import type { HandleUploadBody } from '@vercel/blob/client';
import { browserGeneration } from '../../../server/web-ai';
import { authenticate } from '../../../server/auth';
import {assertWebOrigin,hasWebSession,sessionAccount,signIn,signOut,webOrigin,webSessionEnabled} from '../../../server/web-session';
import { ApiError, changeSchema, id, saveSchema } from '../../../server/domain';
import { db } from '../../../server/db';
import { authorize, createProject, projectFiles, saveChanges, setMember } from '../../../server/projects';
import { elevenInput, enqueue, getJob, publicJob } from '../../../server/jobs';
import { workOne } from '../../../server/worker';
import { finalizeWav, getArtifact, reserveWav, uploadCallback } from '../../../server/artifacts';
import { blobs } from '../../../server/blob';
import { getMusic } from '../../../server/elevenlabs';
import { musicActionSchema } from '@banger/elevenlabs/protocol';
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
  if(path.join('/')==='session' || path.join('/')==='accounts') {
    if(method==='GET' && path[0]==='session') {
      let account: {id:string;username:string}|null=null;
      try{account=await sessionAccount(request);}catch(error){if(!(error instanceof ApiError && error.status===401))throw error;}
      return json({authenticated:Boolean(account),account,signInEnabled:webSessionEnabled(),services:{storage:Boolean(process.env.DATABASE_URL),audio:Boolean(process.env.BLOB_READ_WRITE_TOKEN||process.env.BANGER_LOCAL_DATA_DIR),agent:Boolean(process.env.SANDBOX_RUNNER_BLOB_PATH&&process.env.BANGER_MODEL&&process.env.BANGER_API_KEY)}});
    }
    if(method==='POST') {
      const input=z.object({username:z.string().max(32),password:z.string().max(128)}).strict().parse(await body(request));
      const cookie=await signIn(request,input.username,input.password,path[0]==='accounts');const response=json({authenticated:true});response.headers.set('Set-Cookie',cookie);return response;
    }
    if(method==='DELETE' && path[0]==='session') {assertWebOrigin(request);const response=json({authenticated:false});response.headers.set('Set-Cookie',await signOut(request));return response;}
  }
  if (path.join('/') === 'worker' && ['GET','POST'].includes(method)) {
    const secret = process.env.CRON_SECRET, provided = request.headers.get('authorization') ?? '';
    const expected = `Bearer ${secret}`;
    if (!secret || Buffer.byteLength(provided) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(provided),Buffer.from(expected))) throw new ApiError(401,'Unauthorized worker.');
    return json({ worked: await workOne() });
  }
  if (path.join('/') === 'uploads' && method === 'POST') return json(await uploadCallback(request, await body(request) as HandleUploadBody));
  const user = await authenticate(request);
  const expectedAccount=request.headers.get('x-banger-account');
  if(expectedAccount && expectedAccount!==user)throw new ApiError(409,'The signed-in account changed. Reload the app before continuing.');
  if (method === 'POST' && path.length === 1 && (path[0] === 'chat' || path[0] === 'lyrics')) {
    const input = await body(request);
    if (path[0] !== 'chat' || request.headers.get('accept') !== 'application/x-ndjson') return json(await browserGeneration(user, path[0], input, request.signal));
    const controller = new AbortController();
    const signal = AbortSignal.any([request.signal, controller.signal]);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(output) {
        const send = (value: unknown) => { if (!signal.aborted) output.enqueue(encoder.encode(JSON.stringify(value) + '\n')); };
        try { send({ result: await browserGeneration(user, 'chat', input, signal, undefined, event => send({ event })) }); }
        catch (error) { send({ result: { ok: false, error: error instanceof ApiError ? error.message : 'Could not complete generation.' } }); }
        finally { if (!controller.signal.aborted) output.close(); }
      },
      cancel() { controller.abort(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'X-Accel-Buffering': 'no' } });
  }
  const elevenLabsKey = request.headers.get('x-banger-elevenlabs-key');
  if (elevenLabsKey !== null && (!elevenLabsKey || elevenLabsKey.length > 8192 || /[^\x21-\x7e]/.test(elevenLabsKey))) throw new ApiError(400,'Invalid ElevenLabs API key.');
  if(path[0]==='library'){
    if(path.length===1 && method==='GET')return json({songs:(await db().query(`SELECT l.id,l.name,'audio' AS kind,CASE WHEN l.scope='project' THEN p.name ELSE 'Library' END AS scope,l.song_type AS "songType",r.id AS "recordId",r.name AS "recordName",CASE WHEN r.artwork IS NOT NULL THEN '/api/library/'||r.id::text||'/artwork?v='||r.artwork_version::text ELSE NULL END AS artwork,r.attempts AS "artworkAttempts",(r.regenerate_artwork AND (r.attempts<3 OR COALESCE(r.lease_until>now(),false))) AS "artworkPending",(r.regenerate_artwork AND r.attempts>=3 AND (r.lease_until IS NULL OR r.lease_until<=now())) AS "artworkError" FROM library_entries l JOIN library_records r ON r.id=l.record_id JOIN projects p ON p.id=l.project_id WHERE l.user_id=$1 ORDER BY l.created_at DESC LIMIT 1000`,[user])).rows});
    if(path.length===1 && method==='POST')return json(await saveLibraryEntry(user,await body(request)),201);
    if(path.length===3 && path[2]==='record' && method==='PATCH')return json(await renameLibraryRecord(user,id.parse(path[1]),await body(request)));
    if(path.length===3 && path[2]==='artwork' && method==='GET') {
      const recordId=id.parse(path[1]);
      const artwork=(await db().query('SELECT artwork FROM library_records WHERE id=$1 AND user_id=$2',[recordId,user])).rows[0]?.artwork as string | undefined;
      if(!artwork)throw new ApiError(404,'Record artwork is not ready.');
      const match=artwork.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
      if(!match)throw new ApiError(404,'Record artwork is unavailable.');
      return new Response(Buffer.from(match[2]!, 'base64'),{headers:{'Content-Type':match[1]!, 'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff'}});
    }
    if(path.length===3 && ['artwork','regenerate'].includes(path[2]!) && method==='POST') {
      const recordId=id.parse(path[1]);
      const credentials=z.object({provider:z.enum(['meta','vercel']),key:z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/)}).strict().parse(await body(request));
      if(!(await db().query('SELECT 1 FROM library_records WHERE id=$1 AND user_id=$2',[recordId,user])).rowCount)throw new ApiError(404,'Record not found.');
      if(path[2]==='regenerate')await requestArtworkRegeneration(user,recordId);
      after(()=>generateLibraryArtwork(user,recordId,credentials));
      return json({queued:true},202);
    }
    if(path.length===2 && method==='GET')return json(await readLibraryEntry(user,id.parse(path[1])));
  }
  if (path[0] === 'projects') {
    if (path.length === 1) {
      if (method === 'GET') return json({projects:(await db().query('SELECT p.id,p.name,p.revision FROM projects p WHERE p.owner_id=$1 OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=$1) ORDER BY p.created_at DESC LIMIT 100',[user])).rows});
      if (method === 'POST') {
        const input = z.object({name:z.string().trim().min(1).max(120),files:z.array(changeSchema).max(256)}).strict().parse(await body(request));
        return json(await createProject(user,input.name,input.files),201);
      }
    }
    const project = id.parse(path[1]);
    if(path[2]==='audio-history' && path.length===3){
      const song=url.searchParams.get('path')??'';
      await readSongDraft(user,project,song);
      if(method==='POST'){
        await authorize(user,project,true);
        const input=z.object({artifactId:id}).strict().parse(await body(request));
        const artifact=await getArtifact(user,input.artifactId,true);
        if(artifact.project_id!==project||artifact.status!=='ready')throw new ApiError(400,'Choose saved audio from this project.');
        await db().query('INSERT INTO song_audio_history(project_id,path,artifact_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[project,song,artifact.id]);return json({ok:true});
      }
      if(method==='GET')return json({audio:(await db().query('SELECT artifact_id AS id FROM song_audio_history WHERE project_id=$1 AND path=$2 ORDER BY created_at',[project,song])).rows});
    }
    if(path[2]==='task' && path.length===3 && method==='POST'){
      const input=await body(request);
      if(request.headers.get('accept')!=='application/x-ndjson')return json(await runWebTask(user,project,input,request.signal));
      const taskController = new AbortController();
      const taskSignal = AbortSignal.any([request.signal, taskController.signal]);
      const stream=new ReadableStream({async start(controller){
        const send=(value:unknown)=>{try{controller.enqueue(new TextEncoder().encode(JSON.stringify(value)+'\n'));}catch{/* Disconnected browser; validated saves still finish. */}};
        try{const result=await runWebTask(user,project,input,taskSignal,undefined,event=>send({event}));send({reply:result.reply});}
        catch(error){send({error:error instanceof ApiError?error.message:'The project task could not finish.'});}
        finally{try{controller.close();}catch{/* Already disconnected. */}}
      }, cancel() { taskController.abort(); }});
      return new Response(stream,{headers:{'Content-Type':'application/x-ndjson','X-Accel-Buffering':'no'}});
    }
    if(path[2]==='draft' && path.length===3){
      const song=url.searchParams.get('path')??'';
      if(method==='GET')return json({draft:await readSongDraft(user,project,song)});
      if(method==='PUT'||method==='DELETE'){
        const input=z.object({draft:z.unknown().optional(),expected:z.unknown()}).strict().parse(await body(request));
        await saveSongDraft(user,project,song,input.draft,input.expected,method==='DELETE');return json({ok:true});
      }
    }
    if (path.length === 2 && method === 'GET') return json(await projectFiles(user,project,url.searchParams.has('since') ? z.coerce.number().int().nonnegative().parse(url.searchParams.get('since')) : undefined));
    if (path.length === 2 && method === 'PATCH') { const input=saveSchema.parse(await body(request)); return json(await saveChanges(user,project,input.baseRevision,input.changes)); }
    if (path[2] === 'members' && path.length === 3 && method === 'PUT') { const input=z.object({userId:z.string().min(1).max(256),role:z.enum(['viewer','editor']).nullable()}).strict().parse(await body(request)); await setMember(user,project,input.userId,input.role); return json({ok:true}); }
    if (path[2] === 'jobs' && path.length === 3) {
      if (method === 'POST') {
        const input=z.object({kind:z.enum(['agent','elevenlabs']),idempotencyKey:id,input:z.unknown()}).strict().parse(await body(request));
        const job=await enqueue(user,project,input.kind,input.idempotencyKey,input.kind==='elevenlabs' && elevenLabsKey ? {...elevenInput.parse(input.input),clientKeyRequired:true} : input.input);
        after(() => workOne(job.id, request.headers.get('x-banger-elevenlabs-key') ?? undefined).then(() => undefined)); return json(publicJob(job),202);
      }
      if (method === 'GET') { await authorize(user,project); return json({jobs:(await db().query('SELECT * FROM jobs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 50',[project])).rows.map(publicJob)}); }
    }
    if (path[2] === 'music' && path.length === 3 && method === 'GET') {
      await authorize(user,project); return json({music:(await db().query("SELECT id,revision AS version,current_version->>'name' AS name, COALESCE(current_version->>'studioPath',current_version->'beat'->>'name') AS \"studioPath\" FROM music_sessions WHERE project_id=$1 AND revision>0 ORDER BY created_at DESC LIMIT 100",[project])).rows});
    }
    if (path[2] === 'artifacts' && path.length === 3) {
      if (method === 'POST') { const input=z.object({revision:z.number().int().nonnegative()}).strict().parse(await body(request)); return json(await reserveWav(user,project,input.revision),201); }
      if (method === 'GET') { await authorize(user,project); return json({artifacts:(await db().query("SELECT id,revision,kind,content_type,size,status,created_at FROM artifacts WHERE project_id=$1 ORDER BY created_at DESC LIMIT 50",[project])).rows}); }
    }
  }
  if (path[0] === 'music') {
    const music=await getMusic(user,id.parse(path[1]));
    if (path.length===2 && method==='GET') return json(music.current_version);
    if (path[2]==='versions' && path.length===3 && method==='GET') {
      const before=url.searchParams.has('before')?z.coerce.number().int().positive().parse(url.searchParams.get('before')):music.revision+1;
      const versions=(await db().query('SELECT revision,document FROM music_versions WHERE music_id=$1 AND revision<$2 ORDER BY revision DESC LIMIT 50',[music.id,before])).rows;
      const original=(await db().query('SELECT document FROM music_versions WHERE music_id=$1 AND revision=1',[music.id])).rows[0]?.document;
      const last=versions.at(-1)?.revision;return json({versions,original,...(last>1?{nextBefore:last}:{})});
    }
    if (path[2]==='actions' && method==='POST') {
      const input=z.object({action:musicActionSchema,idempotencyKey:id}).strict().parse(await body(request));
      const job=await enqueue(user,music.project_id,'elevenlabs',input.idempotencyKey,{musicId:music.id,action:input.action,...(elevenLabsKey?{clientKeyRequired:true}:{})});
      after(()=>workOne(job.id, request.headers.get('x-banger-elevenlabs-key') ?? undefined).then(()=>undefined));return json(publicJob(job),202);
    }
  }
  if (path[0] === 'jobs') {
    const job=await getJob(user,id.parse(path[1]));
    if (path.length === 2 && method === 'GET') return json(publicJob(job));
    if (path[2] === 'resume' && method === 'POST') { if(elevenLabsKey && job.user_id!==user)throw new ApiError(403,'Only the requester can supply a key for this job.'); await authorize(user,job.project_id,true); if (job.status === 'awaiting_provider') await db().query("UPDATE jobs SET status='queued',available_at=now() WHERE id=$1 AND status='awaiting_provider'", [job.id]); after(() => workOne(job.id, request.headers.get('x-banger-elevenlabs-key') ?? undefined).then(() => undefined)); return json(publicJob(job),202); }
    if (path[2] === 'candidate' && method === 'GET' && typeof job.checkpoint.candidate === 'string') return json(JSON.parse(await blobs.text(job.checkpoint.candidate)));
  }
  if (path[0] === 'artifacts') {
    const artifact=await getArtifact(user,id.parse(path[1]),method === 'POST'||method==='PUT');
    if(path[2]==='upload' && path.length===3 && method==='PUT' && localMediaEnabled()){
      if(artifact.kind!=='wav'||artifact.status!=='pending'||artifact.user_id!==user)throw new ApiError(409,'This upload is not available.');
      if(!request.body)throw new ApiError(400,'Choose a WAV file.');
      const bytes=await boundedAudio(request.body);
      try{validateWav(bytes,false);}catch{throw new ApiError(422,'Choose a valid WAV file.');}
      await mediaObjects.write(artifact.pathname,bytes,'audio/wav');await finalizeWav(artifact.id);return json({ok:true});
    }
    if (path[2] === 'complete' && method === 'POST') { await finalizeWav(artifact.id); return json({id:artifact.id,status:'ready'}); }
    if (path.length === 2 && method === 'GET') {
      if (artifact.status !== 'ready') throw new ApiError(409,'Audio is still uploading.');
      return new Response(await mediaObjects.stream(artifact.pathname),{headers:{'Content-Type':artifact.content_type,'Content-Disposition':`inline; filename="${artifact.id}.${artifact.content_type === 'audio/mpeg' ? 'mp3' : 'wav'}"`,'X-Content-Type-Options':'nosniff'}});
    }
  }
  throw new ApiError(404,'Endpoint not found.');
}
async function route(request:Request,context:{params:Promise<{path:string[]}>}) {
  const origin=request.headers.get('origin');
  const allowed=(process.env.CLIENT_ORIGINS ?? '').split(',').map(value=>value.trim()).filter(Boolean);
  const same=origin === webOrigin(request);
  let response:Response;
  try {
    if(hasWebSession(request)&&!['GET','HEAD','OPTIONS'].includes(request.method)&&!request.headers.has('authorization'))assertWebOrigin(request);
    if (origin && !same && !allowed.includes(origin)) throw new ApiError(403,'This client origin is not allowed.');
    response=request.method === 'OPTIONS' ? new Response(null,{status:204}) : await dispatch(request,(await context.params).path);
  } catch (error) {
    if (error instanceof ApiError) response=json({error:error.message,details:error.details},error.status);
    else if (error instanceof ZodError) response=json({error:'Invalid request.',details:error.issues},400);
    else { console.error('API request failed', error instanceof Error ? error.name : 'UnknownError'); response=json({error:'The service could not complete the request.'},500); }
  }
  if (response.status === 429) response.headers.set('Retry-After','900');
  response.headers.set('X-Content-Type-Options','nosniff');
  response.headers.set('Cache-Control','private, no-store'); response.headers.set('Vary','Origin');
  if (origin && (same || allowed.includes(origin))) { response.headers.set('Access-Control-Allow-Origin',origin); response.headers.set('Access-Control-Allow-Headers','Authorization, Content-Type, X-Banger-ElevenLabs-Key'); response.headers.set('Access-Control-Allow-Methods','GET, POST, PATCH, PUT, DELETE, OPTIONS'); }
  return response;
}
export {route as GET,route as POST,route as PATCH,route as PUT,route as DELETE,route as OPTIONS};
