import type { ProjectFolder, WorkspaceBridge } from '@/lib/project-workspace';
import type { CloudSnapshot } from '@/lib/cloud-projects';
import { browserCredentials } from '@/lib/ai-providers';

export type ProjectChoice = { mode: 'open' | 'create'; name?: string; projects?: { id: string; name: string }[] };
export type ChooseProject = (choice: ProjectChoice) => Promise<string | null>;
export type WebRequest = <T>(path: string, method?: string, input?: unknown, signal?: AbortSignal) => Promise<T>;
export function accountRequest(accountId: string): WebRequest {
  return async (path, method = 'GET', input, signal) => {
    const response = await fetch(`/api${path}`, { method, cache: 'no-store', redirect: 'error', signal,
      headers: { 'X-Banger-Account': accountId, ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Could not complete the project operation.');
    return result;
  };
}
export function installWebWorkspace(request: WebRequest, choose: ChooseProject, accountId: string) {
  let project: CloudSnapshot | undefined;
  let activePath: string | undefined;
  let active: AbortController | undefined;
  let thread = crypto.randomUUID();
  const listeners = new Set<Parameters<WorkspaceBridge['onEvent']>[0]>();
  function current() { if (!project) throw new Error('Open a project first.'); return project; }
  async function refresh() { project = await request<CloudSnapshot>(`/projects/${current().projectId}`); return project; }
  async function adopt(id: string): Promise<ProjectFolder> {
    const next = await request<CloudSnapshot>(`/projects/${id}`);
    project = next; activePath = next.files[0]?.path; thread = crypto.randomUUID();
    return { name: next.name, paths: next.files.map(file => file.path), file: next.files[0] ?? null };
  }
  const workspace: WorkspaceBridge = {
    async open() {
      const { projects } = await request<{ projects: { id: string; name: string }[] }>('/projects');
      const id = await choose({ mode: 'open', projects });
      return id ? adopt(id) : null;
    },
    async create(name, source) {
      const title = await choose({ mode: 'create', name: name?.replace(/\.banger$/i, '') });
      if (!title) return null;
      const created = await request<{ projectId: string }>('/projects', 'POST', { name: title, files: name !== undefined && source !== undefined ? [{ path: name, source }] : [] });
      return adopt(created.projectId);
    },
    activate: async () => {},
    list: async () => (await refresh()).files.map(file => file.path),
    async read(path) {
      const file = (await refresh()).files.find(file => file.path === path);
      if (!file) throw new Error('The song is no longer in this project.');
      activePath = path; return file;
    },
    async save(path, source, expected) {
      const next = await refresh();
      if ((next.files.find(file => file.path === path)?.source ?? null) !== expected) throw new Error('The file changed. Reopen the saved song before saving your edits.');
      await request(`/projects/${next.projectId}`, 'PATCH', { baseRevision: next.revision, changes: [{ path, source }] });
      await refresh();
      activePath = path; return { path, source };
    },
    async run(prompt, activeFile, resetHistory, permissions) {
      if (active) return { ok: false, error: 'A project task is already running.' };
      const credentials = browserCredentials();
      if (!credentials) return { ok: false, error: 'Choose an AI provider in Settings → BYOK.' };
      if (resetHistory) thread = crypto.randomUUID();
      active = new AbortController();
      try {
        const next = await refresh();
        const response = await fetch(`/api/projects/${next.projectId}/task`, { method: 'POST', redirect: 'error', signal: active.signal,
          headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', 'X-Banger-Account': accountId },
          body: JSON.stringify({ thread, prompt, activeFile, permissions, credentials, baseRevision: next.revision }) });
        if (!response.ok) throw new Error((await response.json()).error ?? 'Could not start the project task.');
        const reader = response.body?.getReader();
        if (!reader) throw new Error('The project task did not return a response.');
        const decoder = new TextDecoder(); let pending = '';
        let reply: {text:string;status:string;changedPaths:string[]}|undefined;
        try {
          while (true) {
            const chunk = await reader.read();
            pending += decoder.decode(chunk.value, { stream: !chunk.done });
            if (pending.length > 1024 * 1024) throw new Error('The task response is too large.');
            let newline: number;
            while ((newline = pending.indexOf('\n')) !== -1) {
              const item = JSON.parse(pending.slice(0, newline)); pending = pending.slice(newline + 1);
              if (item.error) throw new Error(item.error);
              if (item.event) for (const listener of listeners) listener(item.event);
              if (item.reply) reply = item.reply;
            }
            if (chunk.done) break;
          }
        } finally { await reader.cancel(); }
        if (!reply) throw new Error('The project task was interrupted. Reopen the song to check saved changes.');
        await refresh();
        return { ok: true, reply };
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Could not complete the project task.' }; }
      finally { active = undefined; }
    },
    cancel: async () => { active?.abort(); },
    onEvent(callback) { listeners.add(callback); return () => { listeners.delete(callback); }; },
  };
  window.bangerWorkspace = workspace;
  return { workspace, current, refresh, request, activePath: () => activePath };
}
export type WebWorkspace = ReturnType<typeof installWebWorkspace>;
