import { DEFAULT_PROVIDER_MODELS, checkedReasoningLevel, normalizeProvider, saveProviderModel, selectProviderModel, removeProviderModel, setProviderReasoning, reasoningLevels, type SavedProvider, type SavedModel, type ReasoningLevel } from "@banger/agent/protocol";
import type { ChatGPTStatus } from "./chatgpt";

export const AI_PROVIDERS = [
  { id: "vercel", name: "Vercel AI Gateway", defaultModel: DEFAULT_PROVIDER_MODELS.vercel[0], hint: "Muse Wonder and Muse Spark 1.3. Use a Vercel AI Gateway key." },
  { id: "anthropic", name: "Anthropic", defaultModel: DEFAULT_PROVIDER_MODELS.anthropic[0], hint: "Claude Opus 5.5 and Sonnet 5.5. Use an Anthropic API key." },
  { id: "openai", name: "OpenAI", defaultModel: DEFAULT_PROVIDER_MODELS.openai[0], hint: "GPT-6 Astra and GPT-6.1 Sol. Use an OpenAI API key." },
  { id: "meta", name: "Meta Muse", defaultModel: DEFAULT_PROVIDER_MODELS.meta[0], hint: "Muse Wonder and Muse Spark 1.3. Use a Meta Model API key." },
  { id: "grok", name: "Grok", defaultModel: DEFAULT_PROVIDER_MODELS.grok[0], hint: "Grok 4.7 and Grok 4.3. Use an xAI API key." },
] as const;

export type ProviderId = typeof AI_PROVIDERS[number]["id"];
export type ProviderSettings = SavedModel & { models: SavedModel[]; configured: boolean };
export type AIOptionId = ProviderId | "local:small" | "local:dynamic" | "chatgpt";
export type ServerProviderStatus = { available: boolean; model?: string };
export type ServerAIStatus = { providers: Record<ProviderId, ServerProviderStatus>; elevenlabs: boolean; artwork: boolean; defaultProvider: ProviderId | null; defaultModel: string | null };
export type HostedSelection = { provider: ProviderId; model: string; reasoningLevel?: ReasoningLevel };
export type AISettings = { elevenLabsConfigured?: boolean; chatgpt?: ChatGPTStatus; localSelected?: boolean; localVariant?: "small" | "dynamic"; localModels?: { id: "local:small" | "local:dynamic"; label: string }[]; settingsError?: string; activeProvider: ProviderId | null; hostedSelection?: HostedSelection; server?: ServerAIStatus; providers: Partial<Record<ProviderId, ProviderSettings>> };
export type AISettingsBridge = {
  load(): Promise<AISettings>;
  setReasoning(option: AIOptionId, level?: ReasoningLevel, model?: string): Promise<AISettings>;
  saveElevenLabs(key: string): Promise<AISettings>;
  removeElevenLabs(): Promise<AISettings>;
  select(option: AIOptionId, model?: string): Promise<AISettings>;
  save(provider: ProviderId, model: string, key: string): Promise<AISettings>;
  removeModel(provider: ProviderId, model: string): Promise<AISettings>;
  remove(provider: ProviderId): Promise<AISettings>;
};

declare global { interface Window { bangerAI?: AISettingsBridge } }

type StoredSettings = {
  elevenLabsKey?: string;
  activeProvider: ProviderId | null;
  hostedSelection?: HostedSelection;
  providers: Partial<Record<ProviderId, SavedProvider>>;
};
const STORAGE_KEY = "banger.ai-settings.v1";
const SERVER_STATUS_KEYS = ["providers", "elevenlabs", "artwork", "defaultProvider", "defaultModel"];
let storageKey = STORAGE_KEY;
let accountId = "";
let serverStatusCache: { at: number; value?: ServerAIStatus } | undefined;
export function setBrowserSettingsAccount(id: string) { storageKey = `${STORAGE_KEY}:${id}`; accountId = id; }
export function invalidateServerAIStatus() { serverStatusCache = undefined; }

function isProviderId(value: unknown): value is ProviderId {
  return AI_PROVIDERS.some(provider => provider.id === value);
}
function isServerStatus(value: unknown): value is ServerAIStatus {
  if (!value || typeof value !== "object" || Object.keys(value).some(key => !SERVER_STATUS_KEYS.includes(key))) return false;
  const status = value as ServerAIStatus;
  if (typeof status.elevenlabs !== "boolean" || typeof status.artwork !== "boolean") return false;
  if (status.defaultProvider !== null && !isProviderId(status.defaultProvider)) return false;
  if (status.defaultModel !== null && (typeof status.defaultModel !== "string" || !/^\S{1,200}$/.test(status.defaultModel))) return false;
  if (!status.providers || typeof status.providers !== "object") return false;
  for (const provider of AI_PROVIDERS) {
    const item = status.providers[provider.id];
    if (!item || typeof item.available !== "boolean" || Object.keys(item).some(key => key !== "available" && key !== "model")) return false;
    if (item.model !== undefined && (typeof item.model !== "string" || !/^\S{1,200}$/.test(item.model))) return false;
  }
  return true;
}
export async function loadServerAIStatus(force = false): Promise<ServerAIStatus | undefined> {
  if (typeof fetch !== "function") return undefined;
  if (!force && serverStatusCache && Date.now() - serverStatusCache.at < 15000) return serverStatusCache.value;
  try {
    const response = await fetch("/api/ai/status", { cache: "no-store", credentials: "same-origin", headers: accountId ? { "X-Banger-Account": accountId } : {} });
    if (!response.ok) { serverStatusCache = { at: Date.now() }; return undefined; }
    const body = await response.json();
    const value = isServerStatus(body) ? body : undefined;
    serverStatusCache = { at: Date.now(), value };
    return value;
  } catch { return serverStatusCache?.value; }
}
function hostedSelection(value: unknown): HostedSelection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const selection = value as HostedSelection;
  if (!isProviderId(selection.provider) || typeof selection.model !== "string" || !/^\S{1,200}$/.test(selection.model)) return undefined;
  const level = reasoningLevels(selection.provider, selection.model).includes(selection.reasoningLevel as ReasoningLevel) ? selection.reasoningLevel : undefined;
  return { provider: selection.provider, model: selection.model, ...(level ? { reasoningLevel: level } : {}) };
}

function read(): StoredSettings {
  const raw = window.sessionStorage.getItem(storageKey);
  if (!raw) return { activeProvider: null, providers: {} };
  const parsed = JSON.parse(raw) as StoredSettings;
  if (!parsed || typeof parsed.providers !== "object" || !parsed.providers) throw new Error("Invalid settings.");
  const providers: StoredSettings["providers"] = {};
  for (const { id } of AI_PROVIDERS) {
    const value = parsed.providers[id];
    if (value && typeof value.model === "string" && typeof value.key === "string" && value.key) providers[id] = normalizeProvider(id, value);
  }
  const hosted = hostedSelection(parsed.hostedSelection);
  const active = AI_PROVIDERS.some(({ id }) => id === parsed.activeProvider) ? parsed.activeProvider as ProviderId : null;
  return { elevenLabsKey: typeof parsed.elevenLabsKey === "string" ? parsed.elevenLabsKey : undefined, providers, hostedSelection: hosted,
    activeProvider: active && (providers[active] || hosted?.provider === active) ? active : null };
}

function summary(settings: StoredSettings): AISettings {
  return {
    elevenLabsConfigured: Boolean(settings.elevenLabsKey),
    activeProvider: settings.activeProvider,
    hostedSelection: settings.hostedSelection,
    server: serverStatusCache?.value,
    providers: Object.fromEntries(Object.entries(settings.providers).map(([id, value]) => [id, { model: value.model, models: value.models, reasoningLevel: value.reasoningLevel, configured: true }])),
  };
}

export function aiSettingsBridge(): AISettingsBridge {
  if (window.bangerAI) return window.bangerAI;
  return {
    async load() {
      try { await loadServerAIStatus(); return summary(read()); }
      catch { throw new Error("Could not read AI settings. Allow session storage for this site and try again."); }
    },
    async setReasoning(option, level, model) {
      const settings = read();
      const provider = option as ProviderId;
      const value = settings.providers[provider];
      if (value) setProviderReasoning(provider, value, level, model);
      else if (settings.hostedSelection?.provider === provider) {
        const selectedModel = typeof model === "string" && model ? model : settings.hostedSelection.model;
        settings.hostedSelection = { provider, model: selectedModel, reasoningLevel: checkedReasoningLevel(provider, selectedModel, level) };
      } else throw new Error("Configure this provider first.");
      window.sessionStorage.setItem(storageKey, JSON.stringify(settings));
      return summary(settings);
    },
    async saveElevenLabs(key) {
      key = key.trim();
      if (!key || key.length > 8192 || /[^\x21-\x7e]/.test(key)) throw new Error("Enter a valid ElevenLabs API key without spaces.");
      try {
        const settings = read();
        settings.elevenLabsKey = key;
        window.sessionStorage.setItem(storageKey, JSON.stringify(settings));
        return summary(settings);
      } catch { throw new Error("Could not save the ElevenLabs key. Allow session storage for this site and try again."); }
    },
    async removeElevenLabs() {
      try {
        const settings = read();
        delete settings.elevenLabsKey;
        window.sessionStorage.setItem(storageKey, JSON.stringify(settings));
        return summary(settings);
      } catch { throw new Error("Could not remove the ElevenLabs key. Allow session storage for this site and try again."); }
    },
    async select(option, model) {
      if (!AI_PROVIDERS.some(({ id }) => id === option)) throw new Error("Choose a supported provider.");
      const provider = option as ProviderId;
      const settings = read();
      if (settings.providers[provider]) {
        selectProviderModel(settings.providers[provider]!, model);
        delete settings.hostedSelection;
      } else {
        const server = await loadServerAIStatus();
        const chosen = typeof model === "string" && model ? model : server?.providers[provider]?.model;
        if (!server?.providers[provider]?.available || !chosen || !/^\S{1,200}$/.test(chosen)) throw new Error("Configure this provider before selecting it.");
        settings.hostedSelection = { provider, model: chosen };
      }
      settings.activeProvider = provider;
      try { window.sessionStorage.setItem(storageKey, JSON.stringify(settings)); }
      catch { throw new Error("Could not select the provider. Allow session storage for this site and try again."); }
      return summary(settings);
    },
    async save(provider, model, key) {
      if (!AI_PROVIDERS.some(({ id }) => id === provider)) throw new Error("Choose a supported provider.");
      model = model.trim();
      key = key.trim();
      if (!model || model.length > 200 || /\s/.test(model)) throw new Error("Enter a model ID without spaces, up to 200 characters.");
      if (key.length > 8192 || /[^\x21-\x7e]/.test(key)) throw new Error("Enter a valid API key without spaces.");
      try {
        const settings = read();
        const nextKey = key || settings.providers[provider]?.key;
        if (!nextKey) throw new Error("missing-key");
        settings.providers[provider] = saveProviderModel(provider, settings.providers[provider], model, nextKey);
        settings.activeProvider = provider;
        delete settings.hostedSelection;
        window.sessionStorage.setItem(storageKey, JSON.stringify(settings));
        return summary(settings);
      } catch (error) {
        if (error instanceof Error && error.message === "missing-key") throw new Error("Enter an API key for this provider.");
        throw new Error("Could not save AI settings. Allow session storage for this site and try again.");
      }
    },
    async removeModel(provider, model) {
      if (!AI_PROVIDERS.some(({ id }) => id === provider)) throw new Error("Choose a supported provider.");
      const settings = read();
      const value = settings.providers[provider];
      if (!value) throw new Error("Configure this provider first.");
      removeProviderModel(value, model);
      window.sessionStorage.setItem(storageKey, JSON.stringify(settings));
      return summary(settings);
    },
    async remove(provider) {
      if (!AI_PROVIDERS.some(({ id }) => id === provider)) throw new Error("Choose a supported provider.");
      try {
        const settings = read();
        delete settings.providers[provider];
        if (settings.activeProvider === provider) {
          const server = serverStatusCache?.value?.providers[provider];
          if (server?.available && server.model) settings.hostedSelection = { provider, model: server.model };
          else { delete settings.hostedSelection; settings.activeProvider = null; }
        }
        window.sessionStorage.setItem(storageKey, JSON.stringify(settings));
        return summary(settings);
      } catch { throw new Error("Could not remove the key. Allow session storage for this site and try again."); }
    },
  };
}

// Browser credentials are used directly with the selected provider.
// Desktop credentials stay in the main process.
export function browserCredentials() {
  const settings = read();
  const provider = settings.activeProvider;
  const value = provider ? settings.providers[provider] : undefined;
  return provider && value ? { provider, model: value.model, key: value.key, reasoningLevel: value.reasoningLevel } : null;
}

export function browserElevenLabsKey(): string | null {
  return read().elevenLabsKey || null;
}

export function hasLanguageModel(settings: AISettings): boolean {
  if (settings.localSelected) return Boolean(settings.localModels?.length);
  if (settings.chatgpt?.selected) return settings.chatgpt.accounts.some(account => account.id === settings.chatgpt?.activeAccountId && account.connected);
  if (settings.activeProvider && settings.providers[settings.activeProvider]?.configured) return true;
  if (settings.hostedSelection && settings.server?.providers[settings.hostedSelection.provider]?.available) return true;
  return Boolean(settings.server?.defaultProvider);
}
export function vocalsConfigured(settings: AISettings): boolean {
  return Boolean(settings.elevenLabsConfigured || settings.server?.elevenlabs);
}
export function requestCredentials(): HostedSelection | null {
  const settings = read();
  if (!settings.hostedSelection || settings.providers[settings.hostedSelection.provider] || settings.activeProvider !== settings.hostedSelection.provider) return null;
  return settings.hostedSelection;
}

export function browserArtworkCredentials(): import('@banger/agent').ArtworkCredentials | null {
  try {
    const settings = read();
    for (const provider of ['vercel', 'meta'] as const) {
      const value = settings.providers[provider];
      if (value) return { provider, key: value.key };
    }
  } catch { /* Optional artwork must not interrupt an audio save. */ }
  return null;
}
