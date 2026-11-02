export const AI_PROVIDERS = [
  { id: "vercel", name: "Vercel AI Gateway", hint: "Use a Gateway key and a provider/model ID." },
  { id: "anthropic", name: "Anthropic", hint: "Use an Anthropic API key and a Claude model ID." },
  { id: "openai", name: "OpenAI", hint: "Use an OpenAI API key and model ID." },
  { id: "meta", name: "Meta Muse", hint: "Use a Meta Model API key and a Muse model ID." },
  { id: "grok", name: "Grok", hint: "Use an xAI API key and a Grok model ID." },
] as const;

export type ProviderId = typeof AI_PROVIDERS[number]["id"];
export type ProviderSettings = { model: string; configured: boolean };
export type AISettings = { localSelected?: boolean; activeProvider: ProviderId | null; providers: Partial<Record<ProviderId, ProviderSettings>> };
export type AISettingsBridge = {
  load(): Promise<AISettings>;
  save(provider: ProviderId, model: string, key: string): Promise<AISettings>;
  remove(provider: ProviderId): Promise<AISettings>;
};

declare global { interface Window { bangerAI?: AISettingsBridge } }

type StoredSettings = {
  activeProvider: ProviderId | null;
  providers: Partial<Record<ProviderId, { model: string; key: string }>>;
};
const STORAGE_KEY = "banger.ai-settings.v1";

function read(): StoredSettings {
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return { activeProvider: null, providers: {} };
  const parsed = JSON.parse(raw) as StoredSettings;
  if (!parsed || typeof parsed.providers !== "object" || !parsed.providers) throw new Error("Invalid settings.");
  const providers: StoredSettings["providers"] = {};
  for (const { id } of AI_PROVIDERS) {
    const value = parsed.providers[id];
    if (value && typeof value.model === "string" && typeof value.key === "string" && value.key) providers[id] = value;
  }
  return { providers, activeProvider: AI_PROVIDERS.some(({ id }) => id === parsed.activeProvider) && providers[parsed.activeProvider!]
    ? parsed.activeProvider : null };
}

function summary(settings: StoredSettings): AISettings {
  return {
    activeProvider: settings.activeProvider,
    providers: Object.fromEntries(Object.entries(settings.providers).map(([id, value]) => [id, { model: value.model, configured: true }])),
  };
}

export function aiSettingsBridge(): AISettingsBridge {
  if (window.bangerAI) return window.bangerAI;
  return {
    async load() {
      try { return summary(read()); }
      catch { throw new Error("Could not read AI settings. Allow session storage for this site and try again."); }
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
        settings.providers[provider] = { model, key: nextKey };
        settings.activeProvider = provider;
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        return summary(settings);
      } catch (error) {
        if (error instanceof Error && error.message === "missing-key") throw new Error("Enter an API key for this provider.");
        throw new Error("Could not save AI settings. Allow session storage for this site and try again.");
      }
    },
    async remove(provider) {
      if (!AI_PROVIDERS.some(({ id }) => id === provider)) throw new Error("Choose a supported provider.");
      try {
        const settings = read();
        delete settings.providers[provider];
        if (settings.activeProvider === provider) settings.activeProvider = null;
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
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
  return provider && value ? { provider, ...value } : null;
}
