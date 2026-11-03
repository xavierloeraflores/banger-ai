export type WorkspaceFile = { path: string; source: string };
type Event = { type: string; name?: string; path?: string; text?: string; ok?: boolean; error?: string; file?: WorkspaceFile };
export type WorkspaceBridge = {
  open(): Promise<ProjectFolder | null>;
  create(name?: string, source?: string): Promise<ProjectFolder | null>;
  activate(): Promise<void>;
  list(): Promise<string[]>;
  read(path: string): Promise<WorkspaceFile>;
  save(path: string, source: string, expected: string | null): Promise<WorkspaceFile>;
  run(prompt: string, activeFile?: string, resetHistory?: boolean): Promise<{ ok: true; reply: { text: string; status: string } } | { ok: false; error: string }>;
  cancel(): Promise<void>;
  onEvent(callback: (event: Event) => void): () => void;
};
declare global { interface Window { bangerWorkspace?: WorkspaceBridge } }

export type ProjectFolder = { name: string; paths: string[]; file: WorkspaceFile | null };
