import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { credentialsSchema, editPermissionsSchema, publicAIError, selectModel, type SelectedModel } from '@banger/agent';
import { openProject, ProjectSession, songStorage, type HarnessEvent } from '@banger/harness';
import { lyricsOf, performMusicAction, type MusicVersion } from '@banger/elevenlabs';
import { ApiError, id, pathSchema } from './domain';
import { db, transaction } from './db';
import { authorize, projectFiles, saveChanges } from './projects';
import { projectObjects } from './project-objects';
import { saveSongDraft } from './song-drafts';

const inputSchema = z.object({ thread: id, baseRevision: z.number().int().nonnegative(), prompt: z.string().trim().min(1).max(16000), activeFile: pathSchema.optional(), permissions: editPermissionsSchema.optional(), credentials: credentialsSchema }).strict();
type Sidecar = { path: string; source: string; songPath: string; music?: MusicVersion };
async function saveLyrics(user: string, project: string, before: MusicVersion, source: string) {
  const document = JSON.parse(source) as MusicVersion;
  const stripText = (value: MusicVersion) => ({ ...value, plan: { ...value.plan, chunks: value.plan.chunks.map(chunk => ({ ...chunk, text: '', vocalStyle: '' })) } });
  if (!isDeepStrictEqual(stripText(document), stripText(before))) throw new ApiError(400, 'Lyric edits must preserve the composition timing, styles and audio references.');
  const action = { operation: 'edit' as const, baseVersion: before.version, edits: document.plan.chunks.map((chunk, index) => ({ index, lyrics: lyricsOf(chunk.text), ...(chunk.vocalStyle !== undefined ? { vocalStyle: chunk.vocalStyle } : {}) })) };
  const { version } = await performMusicAction(() => { throw new Error('A lyric save must not call a provider.'); }, before, action, randomUUID());
  const pathname = `projects/${project}/music/${before.id}/lyrics/${randomUUID()}.json`;
  await projectObjects.write(pathname, JSON.stringify(version), 'application/json');
  await transaction(async client => {
    await authorize(user, project, true, client, true);
    const current = (await client.query('SELECT revision FROM music_sessions WHERE id=$1 AND project_id=$2 FOR UPDATE', [before.id, project])).rows[0];
    if (current?.revision !== before.version) throw new ApiError(409, 'The composition changed. Reload it before editing.');
    await client.query('INSERT INTO music_versions(music_id,revision,document_path,document) VALUES($1,$2,$3,$4)', [before.id, version.version, pathname, version]);
    await client.query('UPDATE music_sessions SET revision=$2,current_version=$3 WHERE id=$1', [before.id, version.version, version]);
  });
}

export async function runWebTask(user: string, project: string, body: unknown, signal: AbortSignal, model?: SelectedModel, emit?: (event: HarnessEvent) => void) {
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, 'Check your project task and AI settings.');
  const input = parsed.data;
  const snapshot = await projectFiles(user, project);
  await authorize(user, project, true);
  if (snapshot.revision !== input.baseRevision) throw new ApiError(409, 'The project changed. Reload it before running the agent.');
  if (input.activeFile && !snapshot.files.some(file => file.path === input.activeFile)) throw new ApiError(404, 'Active song not found.');
  await db().query('UPDATE projects SET original_prompt=COALESCE(original_prompt,$2) WHERE id=$1', [project,input.prompt]);
  const modelName = `${input.credentials.provider}:${input.credentials.model}:${input.credentials.reasoningLevel ?? ''}`;
  const lease = randomUUID();
  const history = await transaction(async client => {
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user]);
    const running = await client.query('SELECT id FROM web_agent_threads WHERE user_id=$1 AND lease_until>now()', [user]);
    if (running.rowCount! >= 2) throw new ApiError(429, 'Wait for your current project tasks to finish.');
    await client.query("DELETE FROM web_agent_threads WHERE user_id=$1 AND updated_at<now()-interval '30 days' AND (lease_until IS NULL OR lease_until<=now())", [user]);
    await client.query('INSERT INTO web_agent_threads(id,project_id,user_id,model) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [input.thread, project, user, modelName]);
    const row = (await client.query('SELECT * FROM web_agent_threads WHERE id=$1 FOR UPDATE', [input.thread])).rows[0];
    if (row.user_id !== user || row.project_id !== project) throw new ApiError(404, 'Project conversation not found.');
    if (row.lease_until && new Date(row.lease_until).getTime() > Date.now()) throw new ApiError(409, 'This project conversation is already running.');
    await client.query("UPDATE web_agent_threads SET lease_token=$2,lease_until=now()+interval '5 minutes',updated_at=now() WHERE id=$1", [input.thread, lease]);
    return row.model === modelName ? row.history : [];
  });
  let root: string | undefined;
  let session: ProjectSession | undefined;
  const events: HarnessEvent[] = [];
  const changes = new Map<string, string>();
  const saved: string[] = [];
  let reply = { text: '', status: 'incomplete', changedPaths: saved };
  try {
    root = await mkdtemp(join(tmpdir(), 'banger-web-project-'));
    const sidecars: Sidecar[] = [];
    const drafts = (await db().query('SELECT path,draft FROM project_lyric_drafts WHERE project_id=$1 AND draft IS NOT NULL', [project])).rows;
    for (const draft of drafts) if (snapshot.files.some(file => file.path === draft.path)) sidecars.push({ path: draft.path.replace(/\.banger$/, '.draft.json'), source: JSON.stringify(draft.draft, null, 2) + '\n', songPath: draft.path });
    const music = (await db().query("SELECT DISTINCT ON (COALESCE(current_version->>'studioPath',current_version->'beat'->>'name')) current_version FROM music_sessions WHERE project_id=$1 AND revision>0 ORDER BY COALESCE(current_version->>'studioPath',current_version->'beat'->>'name'),created_at DESC", [project])).rows;
    for (const { current_version: version } of music as {current_version: MusicVersion}[]) {
      const path = version.studioPath ?? version.beat?.name;
      if (path && snapshot.files.some(file => file.path === path)) {
        sidecars.push({ path: path.replace(/\.banger$/, '.lyric.json'), source: JSON.stringify(version, null, 2) + '\n', songPath: path, music: version });
        const history=(await db().query('SELECT revision,document FROM music_versions WHERE music_id=$1 ORDER BY revision DESC LIMIT 50',[version.id])).rows;
        const parts=path.split('/'), stem=parts.pop()!.replace(/\.banger$/,'');
        for(const item of history)sidecars.push({path:[...parts,'.banger','history',stem,'lyrics',`lyrics-v${String(item.revision).padStart(3,'0')}.json`].join('/'),source:JSON.stringify(item.document,null,2)+'\n',songPath:path});
      }
    }
    if (sidecars.reduce((sum,file)=>sum+Buffer.byteLength(file.source),0)>4*1024*1024)throw new ApiError(413,'Project lyrics exceed the agent context limit.');
    for (const file of [...snapshot.files, ...sidecars]) {
      await mkdir(dirname(join(root, file.path)), { recursive: true });
      await writeFile(join(root, file.path), file.source, { flag: 'wx', mode: 0o600 });
    }
    const workspace = await openProject(root);
    session = new ProjectSession({ workspace, history, selected: model ?? { ...selectModel(input.credentials), timeoutMs: 180000 }, onEvent(event) {
      if (event.type === 'file-changed') changes.set(event.file.path, event.file.source);
      else if (events.length < 160) { events.push(event); if (!['complete','stopped'].includes(event.type)) emit?.(event); }
    } });
    try {
      const result = await session.run(input.prompt, { activeFile: input.activeFile, permissions: input.permissions, signal });
      reply = { text: result.text, status: result.status, changedPaths: saved };
    } catch (error) { reply.text = publicAIError(error); }
    // Keep validated writes after cancellation, like desktop. Publication still
    // checks the saved revision, so concurrent users cannot overwrite each other.
    const musicChanges = [...changes].filter(([path]) => path.endsWith('.banger')).map(([path, source]) => ({ path, source }));
    if (musicChanges.length) {
      await saveChanges(user, project, snapshot.revision, musicChanges);
      saved.push(...musicChanges.map(file => file.path));
    }
    for (const [path, source] of changes) {
      if (path.endsWith('.draft.json')) {
        const before = sidecars.find(file => file.path === path);
        await saveSongDraft(user, project, path.replace(/\.draft\.json$/, '.banger'), songStorage.validateDraft(JSON.parse(source)), before ? JSON.parse(before.source) : null);
        saved.push(path);
      } else if (path.endsWith('.lyric.json')) {
        const before = sidecars.find(file => file.path === path)?.music;
        if (!before) throw new ApiError(409, 'The saved composition is unavailable.');
        await saveLyrics(user, project, before, source); saved.push(path);
      }
    }
  } catch (error) {
    reply = { text: error instanceof ApiError ? error.message : publicAIError(error), status: 'incomplete', changedPaths: saved };
  } finally {
    if (root) await rm(root, { recursive: true, force: true });
    await db().query('UPDATE web_agent_threads SET history=$3,model=$4,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2', [input.thread, lease, JSON.stringify([...(session?.messages ?? history), ...(reply.status==='incomplete' ? [{role:'assistant',content:`Publication result: ${reply.text} Saved project paths: ${JSON.stringify(saved)}. Read current files before continuing.`}] : [])]), modelName]);
  }
  const published = saved.filter(path => path.endsWith('.banger')).map(path => ({ type: 'file-changed' as const, file: { path, source: changes.get(path)! } }));
  for (const event of published) emit?.(event);
  return { reply, events: [...events.filter(event => !['complete', 'stopped'].includes(event.type)), ...published] };
}
