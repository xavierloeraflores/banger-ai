export type WorkspaceFile = { path: string; source: string };
type Event = { type: string; name?: string; path?: string; text?: string; ok?: boolean; error?: string; file?: WorkspaceFile };
type Bridge = {
  open(): Promise<{ name: string; paths: string[] } | null>;
  list(): Promise<string[]>;
  read(path: string): Promise<WorkspaceFile>;
  save(path: string, source: string, expected: string | null): Promise<WorkspaceFile>;
  run(prompt: string, activeFile?: string): Promise<{ ok: true; reply: { text: string; status: string } } | { ok: false; error: string }>;
  cancel(): Promise<void>;
  onEvent(callback: (event: Event) => void): () => void;
};
declare global { interface Window { bangerWorkspace?: Bridge } }

export type ProjectFolder = { name: string; paths: string[]; file: WorkspaceFile | null };
