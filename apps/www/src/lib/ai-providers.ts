import { DEFAULT_PROVIDER_MODELS, normalizeProvider, saveProviderModel, selectProviderModel, removeProviderModel, setProviderReasoning, type SavedProvider, type SavedModel, type ReasoningLevel } from "@banger/agent/protocol";
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
export type AISettings = { elevenLabsConfigured?: boolean; chatgpt?: ChatGPTStatus; localSelected?: boolean; localVariant?: "small" | "dynamic"; localModels?: { id: "local:small" | "local:dynamic"; label: string }[]; settingsError?: string; activeProvider: ProviderId | null; providers: Partial<Record<ProviderId, ProviderSettings>> };
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
  providers: Partial<Record<ProviderId, SavedProvider>>;
};
const STORAGE_KEY = "banger.ai-settings.v1";
let storageKey = STORAGE_KEY;
export function setBrowserSettingsAccount(id: string) { storageKey = `${STORAGE_KEY}:${id}`; }

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
  return { elevenLabsKey: typeof parsed.elevenLabsKey === "string" ? parsed.elevenLabsKey : undefined, providers, activeProvider: AI_PROVIDERS.some(({ id }) => id === parsed.activeProvider) && providers[parsed.activeProvider!]
    ? parsed.activeProvider : null };
}

function summary(settings: StoredSettings): AISettings {
  return {
    elevenLabsConfigured: Boolean(settings.elevenLabsKey),
    activeProvider: settings.activeProvider,
    providers: Object.fromEntries(Object.entries(settings.providers).map(([id, value]) => [id, { model: value.model, models: value.models, reasoningLevel: value.reasoningLevel, configured: true }])),
  };
}

export function aiSettingsBridge(): AISettingsBridge {
  if (window.bangerAI) return window.bangerAI;
  return {
    async load() {
      try { return summary(read()); }
      catch { throw new Error("Could not read AI settings. Allow session storage for this site and try again."); }
    },
    async setReasoning(option, level, model) {
      const settings = read();
      const value = settings.providers[option as ProviderId];
      if (!value) throw new Error("Configure this provider first.");
      setProviderReasoning(option as ProviderId, value, level, model);
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
      if (!settings.providers[provider]) throw new Error("Configure this provider before selecting it.");
      selectProviderModel(settings.providers[provider]!, model);
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
        if (settings.activeProvider === provider) settings.activeProvider = null;
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
  return Boolean(settings.activeProvider && settings.providers[settings.activeProvider]?.configured);
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
