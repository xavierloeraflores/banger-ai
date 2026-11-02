import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { db, transaction } from "./db";
import { blobs, type ObjectStore } from "./blob";
import { ApiError, hash, validateChanges, type Change, type Manifest } from "./domain";
type Queryable = Pick<Pool | PoolClient, "query">;
export async function authorize(user: string, project: string, write = false, client: Queryable = db(), lock = false) {
  const result = await client.query(`SELECT p.*, m.role FROM projects p LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=$2 WHERE p.id=$1 ${lock ? "FOR UPDATE OF p" : ""}`, [project, user]);
  const row = result.rows[0];
  if (!row || (row.owner_id !== user && (!row.role || (write && row.role !== "editor")))) throw new ApiError(404, "Project not found or access denied.");
  return row as { id: string; name: string; owner_id: string; revision: number; role?: string };
}
export async function readManifest(project: string, revision: number): Promise<Manifest> {
  const row = (await db().query("SELECT manifest FROM project_revisions WHERE project_id=$1 AND revision=$2", [project, revision])).rows[0];
  if (!row) throw new ApiError(404, "Project revision not found.");
  return row.manifest;
}
export async function createProject(user: string, name: string, changes: Change[], store: ObjectStore = blobs) {
  validateChanges(changes);
  const project = randomUUID();
  const manifest: Manifest = { projectId: project, revision: 0, files: [] };
  const path = `projects/${project}/manifests/${randomUUID()}.json`;
  await store.write(path, JSON.stringify(manifest), "application/json");
  await transaction(async client => {
    await client.query("INSERT INTO users(id) VALUES($1) ON CONFLICT DO NOTHING", [user]);
    await client.query("INSERT INTO projects(id,owner_id,name) VALUES($1,$2,$3)", [project, user, name]);
    await client.query("INSERT INTO project_revisions VALUES($1,0,$2,$3,$4,now())", [project, path, manifest, user]);
  });
  if (changes.length) return saveChanges(user, project, 0, changes, store);
  return manifest;
}
export async function saveChanges(user: string, project: string, baseRevision: number, changes: Change[], store: ObjectStore = blobs, job?: { id: string; lease: string }) {
  const current = await authorize(user, project, true);
  if (current.revision !== baseRevision) throw new ApiError(409, "The project changed. Reload the saved revision before merging your draft.", { currentRevision: current.revision });
  validateChanges(changes);
  const base = await readManifest(project, baseRevision);
  const files = new Map(base.files.map(file => [file.path, file]));
  for (const change of changes) {
    if (change.source === null) files.delete(change.path);
    else {
      const sha256 = hash(change.source);
      if (files.get(change.path)?.sha256 === sha256) continue;
      const pathname = `projects/${project}/files/${randomUUID()}/${sha256}.banger`;
      await store.write(pathname, change.source, "text/plain; charset=utf-8");
      files.set(change.path, { path: change.path, sha256, pathname, bytes: Buffer.byteLength(change.source) });
    }
  }
  if (files.size > 256 || [...files.values()].reduce((sum, file) => sum + file.bytes, 0) > 4 * 1024 * 1024) throw new ApiError(413, "Projects support 256 files and 4 MiB of source.");
  const manifest: Manifest = { projectId: project, revision: baseRevision + 1, files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)) };
  const pathname = `projects/${project}/manifests/${randomUUID()}.json`;
  await store.write(pathname, JSON.stringify(manifest), "application/json");
  await transaction(async client => {
    // Lock permission changes and publication on the same project row.
    const locked = await authorize(user, project, true, client, true);
    if (locked.revision !== baseRevision) throw new ApiError(409, "Another edit was saved first. Your draft has not overwritten it.", { currentRevision: locked.revision });
    if (job) {
      const lease = await client.query("SELECT id FROM jobs WHERE id=$1 AND lease_token=$2 AND lease_until>now() AND status='running' FOR UPDATE", [job.id, job.lease]);
      if (!lease.rowCount) throw new ApiError(409, "Job lease expired.");
    }
    await client.query("INSERT INTO project_revisions(project_id,revision,manifest_path,manifest,author_id) VALUES($1,$2,$3,$4,$5)", [project, manifest.revision, pathname, manifest, user]);
    await client.query("UPDATE projects SET revision=$2 WHERE id=$1 AND revision=$3", [project, manifest.revision, baseRevision]);
    if (job) await client.query("UPDATE jobs SET status='completed',stage='completed',progress=100,result=$3,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2", [job.id, job.lease, { revision: manifest.revision }]);
  });
  return manifest;
}
export async function projectFiles(user: string, project: string, since?: number, store: ObjectStore = blobs) {
  const current = await authorize(user, project);
  const manifest = await readManifest(project, current.revision);
  const before = since === undefined ? undefined : await readManifest(project, since);
  const old = new Map(before?.files.map(file => [file.path, file.sha256]));
  const changed = manifest.files.filter(file => old.get(file.path) !== file.sha256);
  const files = [];
  // Sequential reads cap concurrent downloads and memory to the project limit.
  for (const file of changed) {
    const source = await store.text(file.pathname);
    if (Buffer.byteLength(source) !== file.bytes || hash(source) !== file.sha256) throw new ApiError(502, "Saved file integrity check failed.");
    files.push({ path: file.path, source, sha256: file.sha256 });
  }
  return { projectId: project, name: current.name, revision: manifest.revision, files, deleted: before?.files.filter(file => !manifest.files.some(next => next.path === file.path)).map(file => file.path) ?? [] };
}
export async function setMember(user: string, project: string, member: string, role: "viewer" | "editor" | null) {
  await transaction(async client => {
    const row = await authorize(user, project, true, client, true);
    if (row.owner_id !== user) throw new ApiError(403, "Only the owner can change project access.");
    if (member === user) throw new ApiError(400, "The owner already has full access.");
    if (role === null) await client.query("DELETE FROM project_members WHERE project_id=$1 AND user_id=$2", [project, member]);
    else {
      await client.query("INSERT INTO users(id) VALUES($1) ON CONFLICT DO NOTHING", [member]);
      await client.query("INSERT INTO project_members VALUES($1,$2,$3) ON CONFLICT(project_id,user_id) DO UPDATE SET role=$3", [project, member, role]);
    }
  });
}
