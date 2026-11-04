export type WorkspaceFile = { path: string; source: string };
export type RecentProject = { id: string; name: string; openedAt: number };
type Event = { requestId?: string; message?: string; at?: number; projectId?: string; threadId?: string; type: string; name?: string; path?: string; text?: string; ok?: boolean; error?: string; file?: WorkspaceFile };
export type WorkspaceBridge = {
  open(): Promise<ProjectFolder | null>;
  create(name?: string, source?: string): Promise<ProjectFolder | null>;
  recent?(): Promise<RecentProject[]>;
  restore?(id: string): Promise<ProjectFolder>;
  activate(projectId?: string): Promise<void>;
  list(): Promise<string[]>;
  read(path: string, projectId?: string): Promise<WorkspaceFile>;
  save(path: string, source: string, expected: string | null): Promise<WorkspaceFile>;
  run(prompt: string, activeFile?: string, resetHistory?: boolean, permissions?: import("@banger/agent/protocol").EditPermissions, projectId?: string, threadId?: string, history?: { role: "user" | "assistant"; content: string }[], requestId?: string): Promise<{ ok: true; reply: { text: string; status: string; changedPaths?: string[] } } | { ok: false; error: string }>;
  cancel(projectId?: string, threadId?: string, requestId?: string): Promise<void>;
  onEvent(callback: (event: Event) => void): () => void;
};
declare global { interface Window { bangerWorkspace?: WorkspaceBridge } }

export type ProjectFolder = { id?: string; name: string; paths: string[]; file: WorkspaceFile | null };
