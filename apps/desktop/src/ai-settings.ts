import { readFile, rename, writeFile } from "node:fs/promises";

const PROVIDERS = ["vercel", "anthropic", "openai", "meta", "grok"] as const;
type Provider = typeof PROVIDERS[number];
type Settings = { elevenLabsKey?: string; activeProvider: Provider | null; providers: Partial<Record<Provider, { model: string; key: string }>> };
type Encryption = { isAvailable(): boolean | Promise<boolean>; encrypt(value: string): Buffer | Promise<Buffer>; decrypt(value: Buffer): string | Promise<string> };

function providerId(value: unknown): Provider {
  if (typeof value !== "string" || !PROVIDERS.includes(value as Provider)) throw new Error("Choose a supported provider.");
  return value as Provider;
}

function summary(settings: Settings) {
  return {
    elevenLabsConfigured: Boolean(settings.elevenLabsKey),
    activeProvider: settings.activeProvider,
    providers: Object.fromEntries(Object.entries(settings.providers).map(([id, value]) => [id, { model: value.model, configured: true }])),
  };
}

// Only metadata is exposed over IPC. Credentials are read only by the main-process agent.
export function createAISettingsStore(path: string, encryption: Encryption) {
  let queue = Promise.resolve();
  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }
  async function requireEncryption() {
    if (!await encryption.isAvailable()) throw new Error("Secure key storage is unavailable. Unlock your system keychain and try again.");
  }
  async function read(): Promise<Settings> {
    let bytes: Buffer;
    try { bytes = await readFile(path); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { activeProvider: null, providers: {} };
      throw new Error("Could not read AI settings.");
    }
    await requireEncryption();
    try {
      const parsed = JSON.parse(await encryption.decrypt(bytes)) as Settings;
      if (!parsed || typeof parsed.providers !== "object" || !parsed.providers) throw new Error();
      const providers: Settings["providers"] = {};
      for (const id of PROVIDERS) {
        const value = parsed.providers[id];
        if (value && typeof value.model === "string" && typeof value.key === "string" && value.key) providers[id] = value;
      }
      return { elevenLabsKey: typeof parsed.elevenLabsKey === "string" ? parsed.elevenLabsKey : undefined, providers, activeProvider: PROVIDERS.includes(parsed.activeProvider as Provider) && providers[parsed.activeProvider!]
        ? parsed.activeProvider : null };
    } catch { throw new Error("Could not unlock AI settings. Check your system keychain and try again."); }
  }
  async function persist(settings: Settings) {
    await requireEncryption();
    try {
      await writeFile(`${path}.tmp`, await encryption.encrypt(JSON.stringify(settings)), { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    } catch { throw new Error("Could not save AI settings."); }
    return summary(settings);
  }
  return {
    load: () => serialize(async () => summary(await read())),
    select: (provider: unknown) => serialize(async () => {
      const id = providerId(provider);
      const settings = await read();
      if (!settings.providers[id]) throw new Error("Configure this provider before selecting it.");
      settings.activeProvider = id;
      return persist(settings);
    }),
    elevenLabsKey: () => serialize(async () => (await read()).elevenLabsKey ?? null),
    saveElevenLabs: (key: unknown) => serialize(async () => {
      if (typeof key !== "string" || !key.trim() || key.trim().length > 8192 || /[^\x21-\x7e]/.test(key.trim())) throw new Error("Enter a valid ElevenLabs API key without spaces.");
      const settings = await read();
      settings.elevenLabsKey = key.trim();
      return persist(settings);
    }),
    removeElevenLabs: () => serialize(async () => {
      const settings = await read();
      delete settings.elevenLabsKey;
      return persist(settings);
    }),
    credentials: () => serialize(async () => {
      const settings = await read();
      const provider = settings.activeProvider;
      const value = provider ? settings.providers[provider] : undefined;
      return provider && value ? { provider, ...value } : null;
    }),
    save: (provider: unknown, model: unknown, key: unknown) => serialize(async () => {
      const id = providerId(provider);
      if (typeof model !== "string" || !model.trim() || model.trim().length > 200 || /\s/.test(model.trim())) {
        throw new Error("Enter a model ID without spaces, up to 200 characters.");
      }
      if (typeof key !== "string" || key.trim().length > 8192 || /[^\x21-\x7e]/.test(key.trim())) {
        throw new Error("Enter a valid API key without spaces.");
      }
      const settings = await read();
      const nextKey = key.trim() || settings.providers[id]?.key;
      if (!nextKey) throw new Error("Enter an API key for this provider.");
      settings.providers[id] = { model: model.trim(), key: nextKey };
      settings.activeProvider = id;
      return persist(settings);
    }),
    remove: (provider: unknown) => serialize(async () => {
      const id = providerId(provider);
      const settings = await read();
      delete settings.providers[id];
      if (settings.activeProvider === id) settings.activeProvider = null;
      return persist(settings);
    }),
  };
}
