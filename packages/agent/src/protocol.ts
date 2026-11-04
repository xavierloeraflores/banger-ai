export const PROVIDER_IDS = ["vercel", "anthropic", "openai", "meta", "grok"] as const;
export type ProviderId = typeof PROVIDER_IDS[number];
export const DEFAULT_PROVIDER_MODELS: Record<ProviderId, readonly [string, string]> = {
  vercel: ["meta/muse-wonder-1.0", "meta/muse-spark-1.3"],
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5"],
  openai: ["gpt-6-astra", "gpt-6.1-sol"],
  meta: ["muse-wonder-1.0", "muse-spark-1.3"],
  grok: ["grok-4.7", "grok-4.3"],
};
export type SavedModel = { model: string; reasoningLevel?: ReasoningLevel };
export type SavedProvider = SavedModel & { key: string; models: SavedModel[] };

// Migrate single-model settings without changing the selected model or its effort.
// An existing list is authoritative, so deleted defaults do not reappear on reload.
export function normalizeProvider(provider: ProviderId, value: SavedModel & { key: string; models?: SavedModel[] }): SavedProvider {
  const models: SavedModel[] = [];
  const entries: SavedModel[] = value.models ?? DEFAULT_PROVIDER_MODELS[provider].map(model => ({ model }));
  for (const entry of entries) {
    if (entry && typeof entry.model === "string" && entry.model && !models.some(item => item.model === entry.model)) {
      models.push({ model: entry.model, reasoningLevel: reasoningLevels(provider, entry.model).includes(entry.reasoningLevel as ReasoningLevel) ? entry.reasoningLevel : undefined });
    }
  }
  if (!models.some(entry => entry.model === value.model)) models.push({ model: value.model, reasoningLevel: value.reasoningLevel });
  const selected = models.find(entry => entry.model === value.model)!;
  if (!value.models) selected.reasoningLevel = value.reasoningLevel;
  return { key: value.key, models, ...selected };
}

export function selectProviderModel(value: SavedProvider, model: unknown = value.model) {
  const selected = value.models.find(entry => entry.model === model);
  if (!selected) throw new Error("Add this model before selecting it.");
  value.model = selected.model;
  value.reasoningLevel = selected.reasoningLevel;
}

export function saveProviderModel(provider: ProviderId, previous: SavedProvider | undefined, model: string, key: string): SavedProvider {
  const value = previous ?? normalizeProvider(provider, { model, key });
  value.key = key;
  if (!value.models.some(entry => entry.model === model)) value.models.push({ model });
  selectProviderModel(value, model);
  return value;
}

export function removeProviderModel(value: SavedProvider, model: unknown) {
  if (!value.models.some(entry => entry.model === model)) throw new Error("Choose a saved model.");
  if (value.models.length === 1) throw new Error("Keep at least one model, or remove the provider key.");
  value.models = value.models.filter(entry => entry.model !== model);
  if (value.model === model) selectProviderModel(value, value.models[0]!.model);
}

export function setProviderReasoning(provider: ProviderId, value: SavedProvider, level: unknown, model: unknown = value.model) {
  const selected = value.models.find(entry => entry.model === model);
  if (!selected) throw new Error("Choose a saved model.");
  selected.reasoningLevel = checkedReasoningLevel(provider, selected.model, level);
  if (value.model === selected.model) value.reasoningLevel = selected.reasoningLevel;
}

export type Credentials = { provider: ProviderId; model: string; key: string; reasoningLevel?: ReasoningLevel };
export type BangerFile = { name: string; source: string; operation?: "create" | "edit" };
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type EditPermissions = { beat: boolean; lyrics: boolean; songs?: string[]; allowNewSongs?: boolean };
// Lyrics and drafts share the edit permission of their companion song.
export function songPath(path: string): string {
  return path.replace(/\.(?:lyric|draft)\.json$/, ".banger");
}
export function canEditSong(permissions: EditPermissions, path: string, existing = true): boolean {
  return existing ? permissions.songs === undefined || permissions.songs.includes(songPath(path)) : permissions.allowNewSongs !== false;
}
// Only operational messages and answer text cross this boundary. Tool inputs and
// provider reasoning are deliberately absent.
export type ChatEvent = { requestId: string } & (
  | { type: "activity"; message: string; at: number }
  | { type: "text-delta"; text: string }
  | { type: "text-reset" }
);
export type ChatActivity = { message: string; at: number };
export type ChatRun = { requestId: string; startedAt: number; endedAt?: number; status: "running" | "completed" | "failed" | "stopped"; activity: ChatActivity[] };

export type ChatRequest = {
  requestId?: string;
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

export type LyricRequest = { prompt: string; chunks: { index: number; text: string; durationMs: number; vocalStyle?: string }[] };
export type LyricEdit = { index: number; lyrics: string; vocalStyle?: string };
export type LyricOutcome = { ok: true; edits: LyricEdit[] } | { ok: false; error: string };

// Conservative capability list: unknown models retain the provider default.
export const REASONING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningLevel = typeof REASONING_LEVELS[number];
export function reasoningLevels(provider: string, model: string): readonly ReasoningLevel[] {
  if (provider === "vercel") {
    const [vendor, ...id] = model.split("/");
    return reasoningLevels(vendor === "xai" ? "grok" : vendor!, id.join("/"));
  }
  if (provider === "openai" || provider === "chatgpt") {
    if (model.includes("pro") || model.includes("chat")) return [];
    if (/^gpt-(6(?:\.1)?-(?:astra|sol|terra|luna)|5\.[2-6])(?:-|$)/.test(model)) return ["low", "medium", "high", "xhigh"];
    if (/^(o1|o3(?:-mini)?|o4-mini|gpt-5(?:-mini|-nano)?)(?:-\d{4}-\d{2}-\d{2})?$/.test(model) && !model.includes("pro")) return ["low", "medium", "high"];
  }
  if (provider === "meta" && /^(muse-wonder-1\.0|muse-spark-1\.3)$/.test(model)) return REASONING_LEVELS;
  if (provider === "meta" && model === "muse-spark-1.3-contributor") return ["minimal", "low", "medium", "high", "xhigh"];
  if (provider === "anthropic" && /^claude-(?:opus-(?:5|4-[5678])|sonnet-(?:5|4-6)|haiku-5|fable-5)(?:-|$)/.test(model)) return ["low", "medium", "high"];
  if (provider === "grok") {
    if (/^grok-4\.[67](?:-|$)/.test(model)) return ["low", "medium", "high", "xhigh"];
    if (/^grok-4\.[35](?:-|$)/.test(model)) return ["low", "medium", "high"];
    if (/^grok-3-mini(?:-fast)?(?:-|$)/.test(model)) return ["low", "high"];
  }
  return [];
}
export function checkedReasoningLevel(provider: string, model: string, value: unknown): ReasoningLevel | undefined {
  if (value === undefined || value === "") return undefined;
  if (!reasoningLevels(provider, model).includes(value as ReasoningLevel)) throw new Error("Choose a supported reasoning level for this model.");
  return value as ReasoningLevel;
}
export function reasoningOptions(provider: string, model: string, value?: ReasoningLevel): Record<string, Record<string, string>> | undefined {
  const level = checkedReasoningLevel(provider, model, value);
  if (!level) return undefined;
  const vendor = provider === "vercel" ? model.split("/")[0] : provider;
  if (vendor === "meta") return { meta: { reasoningEffort: level } };
  if (vendor === "anthropic") return { anthropic: { effort: level } };
  return { [vendor === "grok" || vendor === "xai" ? "xai" : "openai"]: { reasoningEffort: level } };
}
