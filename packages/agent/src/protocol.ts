export const PROVIDER_IDS = ["vercel", "anthropic", "openai", "meta", "grok"] as const;
export type ProviderId = typeof PROVIDER_IDS[number];
export type Credentials = { provider: ProviderId; model: string; key: string };
export type BangerFile = { name: string; source: string; operation?: "create" | "edit" };
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type EditPermissions = { beat: boolean; lyrics: boolean };
export type ChatRequest = {
  permissions?: EditPermissions;
  messages: ChatMessage[];
  currentFile: BangerFile;
  previousFiles: BangerFile[];
  targetFile?: string;
  targetVersion?: "editor" | "generated";
};
export type ChatReply = { lyricPrompt?: string; text: string; files: BangerFile[]; model: string };
export type ChatOutcome = { ok: true; reply: ChatReply } | { ok: false; error: string };
export const MAX_CHAT_BODY_BYTES = 256 * 1024;

export type LyricRequest = { prompt: string; chunks: { index: number; text: string; durationMs: number }[] };
export type LyricEdit = { index: number; lyrics: string };
export type LyricOutcome = { ok: true; edits: LyricEdit[] } | { ok: false; error: string };
