import { songStorage } from '@banger/harness';
import { ApiError, pathSchema } from './domain';
import { authorize, readManifest } from './projects';
import { db, transaction } from './db';

export async function readSongDraft(user: string, project: string, path: string) {
  pathSchema.parse(path);
  const current = await authorize(user, project);
  if (!(await readManifest(project, current.revision)).files.some(file => file.path === path)) throw new ApiError(404, 'Song not found.');
  return (await db().query('SELECT draft FROM project_lyric_drafts WHERE project_id=$1 AND path=$2', [project, path])).rows[0]?.draft ?? null;
}
export async function saveSongDraft(user: string, project: string, path: string, value: unknown, expected: unknown, retire = false) {
  pathSchema.parse(path);
  let draft: songStorage.LyricDraft | null, before: songStorage.LyricDraft | null;
  try { draft = retire ? null : songStorage.validateDraft(value); before = expected === null ? null : songStorage.validateDraft(expected); }
  catch { throw new ApiError(400, 'Use a nonempty lyric draft under 12 KiB.'); }
  await transaction(async client => {
    const current = await authorize(user, project, true, client, true);
    const manifest = (await client.query('SELECT manifest FROM project_revisions WHERE project_id=$1 AND revision=$2', [project, current.revision])).rows[0].manifest;
    if (!manifest.files.some((file: {path:string}) => file.path === path)) throw new ApiError(404, 'Song not found.');
    const row = (await client.query('SELECT draft,retired FROM project_lyric_drafts WHERE project_id=$1 AND path=$2', [project, path])).rows[0];
    if (row?.retired) throw new ApiError(409, 'This draft has been retired. Edit the chunk lyrics instead.');
    const composition = await client.query("SELECT 1 FROM music_sessions WHERE project_id=$1 AND COALESCE(current_version->>'studioPath',current_version->'beat'->>'name')=$2 AND revision>0 LIMIT 1", [project, path]);
    if (retire && (!composition.rowCount || !before)) throw new ApiError(409, 'Save chunk lyrics before retiring the draft.');
    if (!retire && composition.rowCount) throw new ApiError(409, 'A composition is saved. Edit its chunk lyrics instead.');
    const saved = row?.draft ? songStorage.validateDraft(row.draft) : null;
    if (JSON.stringify(saved) !== JSON.stringify(before)) throw new ApiError(409, 'The draft changed. Read it again before editing.');
    await client.query('INSERT INTO project_lyric_drafts(project_id,path,draft,retired) VALUES($1,$2,$3,$4) ON CONFLICT(project_id,path) DO UPDATE SET draft=$3,retired=$4', [project, path, draft, retire]);
  });
}
