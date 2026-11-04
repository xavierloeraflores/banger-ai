export const PROVIDER_IDS = ["vercel", "anthropic", "openai", "meta", "grok"] as const;
export type ProviderId = typeof PROVIDER_IDS[number];
export type Credentials = { provider: ProviderId; model: string; key: string; reasoningLevel?: ReasoningLevel };
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
    if (/^grok-4\.5(?:-|$)/.test(model)) return ["low", "medium", "high"];
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
