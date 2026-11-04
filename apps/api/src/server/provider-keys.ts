import { DEFAULT_PROVIDER_MODELS, PROVIDER_IDS, checkedReasoningLevel, publicAIError, type ProviderId, type ReasoningLevel } from '@banger/agent';
import { z } from 'zod';
import { ApiError } from './domain';

// Hosted web key resolution. Desktop never imports this module.
// Precedence for one provider: conventional env var, then BANGER_API_KEY when
// it targets that provider, then the user BYOK key. A non-empty invalid server
// value blocks every later source. A provider rejection never tries another key.
const KEY_PATTERN = /^[\x21-\x7e]+$/;
export const SERVER_PROVIDER_ENV: Record<ProviderId, readonly string[]> = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  grok: ['XAI_API_KEY'],
  vercel: ['AI_GATEWAY_API_KEY'],
  // Muse Wonder, Muse Spark, and Muse Image use the Meta key. The gateway key
  // serves the same Muse models through Vercel. MUSE_API_KEY is only an alias.
  meta: ['META_API_KEY', 'MUSE_API_KEY'],
};
export const SERVER_DEFAULT_ORDER: readonly ProviderId[] = ['vercel', 'meta', 'openai', 'anthropic', 'grok'];
export const optionalCredentialSchema = z.object({
  provider: z.string().max(40).optional(),
  model: z.string().max(200).optional(),
  key: z.string().max(8192).optional(),
  reasoningLevel: z.string().max(20).optional(),
}).strict();

export type EnvKey = { state: 'absent' | 'invalid' | 'present'; key?: string };
export type ResolvedWebCredentials = { provider: ProviderId; model: string; key: string; reasoningLevel?: ReasoningLevel; source: 'server' | 'user' };
export type ServerProviderStatus = { available: boolean; model?: string };
export type ServerAIStatus = {
  providers: Record<ProviderId, ServerProviderStatus>;
  elevenlabs: boolean;
  artwork: boolean;
  defaultProvider: ProviderId | null;
  defaultModel: string | null;
};
export type ElevenDecision =
  | { action: 'use-server'; key: string }
  | { action: 'use-client' }
  | { action: 'wait'; message: string }
  | { action: 'fail'; message: string };

export function readEnvKey(name: string): EnvKey {
  const raw = process.env[name];
  if (raw === undefined) return { state: 'absent' };
  const value = raw.trim();
  if (!value) return { state: 'absent' };
  if (value.length > 8192 || !KEY_PATTERN.test(value)) return { state: 'invalid' };
  return { state: 'present', key: value };
}

// Unset BANGER_PROVIDER means openai, matching the sandbox runner, but only
// when a BANGER key is actually configured. An unknown provider applies nowhere.
export function bangerProvider(): ProviderId | undefined {
  const raw = process.env.BANGER_PROVIDER?.trim();
  if (!raw) return readEnvKey('BANGER_API_KEY').state === 'absent' ? undefined : 'openai';
  return (PROVIDER_IDS as readonly string[]).includes(raw) ? raw as ProviderId : undefined;
}

export function serverKeyFor(provider: ProviderId): EnvKey {
  for (const name of SERVER_PROVIDER_ENV[provider]) {
    const value = readEnvKey(name);
    if (value.state !== 'absent') return value;
  }
  if (bangerProvider() === provider) {
    const shared = readEnvKey('BANGER_API_KEY');
    if (shared.state !== 'absent') return shared;
  }
  return { state: 'absent' };
}

export function serverElevenLabsKey(): EnvKey {
  return readEnvKey('ELEVENLABS_API_KEY');
}

function configuredModel(provider: ProviderId): string {
  if (bangerProvider() === provider) {
    const model = process.env.BANGER_MODEL?.trim();
    if (model && model.length <= 200 && /^\S+$/.test(model)) return model;
  }
  return DEFAULT_PROVIDER_MODELS[provider][0];
}

export function defaultServerSelection(): { provider: ProviderId; model: string } | undefined {
  const selected = bangerProvider();
  if (selected && readEnvKey('BANGER_API_KEY').state !== 'absent') return { provider: selected, model: configuredModel(selected) };
  for (const provider of SERVER_DEFAULT_ORDER) {
    const names = SERVER_PROVIDER_ENV[provider];
    if (names.some(name => readEnvKey(name).state !== 'absent')) return { provider, model: configuredModel(provider) };
  }
  return undefined;
}

export function serverAIStatus(): ServerAIStatus {
  const providers = Object.fromEntries(PROVIDER_IDS.map(provider => {
    const key = serverKeyFor(provider);
    return [provider, key.state === 'absent' ? { available: false } : { available: true, model: configuredModel(provider) }];
  })) as ServerAIStatus['providers'];
  const fallback = defaultServerSelection();
  return {
    providers,
    elevenlabs: serverElevenLabsKey().state !== 'absent',
    artwork: providers.meta.available || providers.vercel.available,
    defaultProvider: fallback?.provider ?? null,
    defaultModel: fallback?.model ?? null,
  };
}

function modelId(value: string | undefined, fallback: string): string {
  const model = value?.trim();
  if (!model) return fallback;
  if (model.length > 200 || !/^\S+$/.test(model)) throw new ApiError(400, 'Check your AI settings and try again.');
  return model;
}

export function resolveWebCredentials(input: unknown): ResolvedWebCredentials {
  const parsed = input == null ? undefined : optionalCredentialSchema.safeParse(input);
  if (parsed && !parsed.success) throw new ApiError(400, 'Check your AI settings and try again.');
  const requested = parsed?.data;
  const named = Boolean(requested?.provider || requested?.model);
  const fallback = named ? undefined : defaultServerSelection();
  if (!named && !fallback) throw new ApiError(400, 'Add a provider key and model in Settings → BYOK.', { code: 'provider_key_required' });
  const provider = named ? requested?.provider : fallback?.provider;
  if (!provider || !(PROVIDER_IDS as readonly string[]).includes(provider)) throw new ApiError(400, 'Check your AI settings and try again.');
  const resolvedProvider = provider as ProviderId;
  const model = modelId(requested?.model, configuredModel(resolvedProvider));
  let reasoningLevel: ReasoningLevel | undefined;
  if (requested?.reasoningLevel) {
    try { reasoningLevel = checkedReasoningLevel(resolvedProvider, model, requested.reasoningLevel); }
    catch { throw new ApiError(400, 'Check your AI settings and try again.'); }
  }
  const server = serverKeyFor(resolvedProvider);
  if (server.state === 'invalid') throw new ApiError(503, 'The hosted AI key is not valid. A personal key was not used.', { code: 'hosted_key_invalid' });
  if (server.state === 'present' && server.key) return { provider: resolvedProvider, model, key: server.key, reasoningLevel, source: 'server' };
  const userKey = requested?.key?.trim();
  if (!userKey || userKey.length > 8192 || !KEY_PATTERN.test(userKey)) throw new ApiError(400, 'Add a provider key and model in Settings → BYOK.', { code: 'provider_key_required' });
  return { provider: resolvedProvider, model, key: userKey, reasoningLevel, source: 'user' };
}

export function resolveArtworkCredentials(input: unknown): { provider: 'meta' | 'vercel'; key: string } {
  const meta = serverKeyFor('meta');
  const vercel = serverKeyFor('vercel');
  const chosen = meta.state !== 'absent' ? { provider: 'meta' as const, server: meta } : vercel.state !== 'absent' ? { provider: 'vercel' as const, server: vercel } : undefined;
  if (chosen) {
    if (chosen.server.state !== 'present' || !chosen.server.key) throw new ApiError(503, 'The hosted Muse key is not valid. A personal key was not used.', { code: 'hosted_key_invalid' });
    return { provider: chosen.provider, key: chosen.server.key };
  }
  const parsed = z.object({ provider: z.enum(['meta', 'vercel']), key: z.string().min(1).max(8192).regex(KEY_PATTERN) }).strict().safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'Add a Meta or Vercel key in AI settings to generate artwork.', { code: 'provider_key_required' });
  return parsed.data;
}

export function hostedProviderError(error: unknown, source: 'server' | 'user'): string {
  const message = publicAIError(error);
  if (source !== 'server') return message;
  if (message.startsWith('The provider rejected')) return 'The hosted AI key was rejected by the provider. A personal key was not used.';
  if (message.startsWith('The provider is busy')) return 'The hosted AI provider is busy or out of credits. Try again later.';
  if (message.startsWith('The provider could not use')) return 'The hosted provider could not use that model. Try another model.';
  if (message.startsWith('Generation stopped')) return message;
  return 'Could not generate a reply with the hosted AI key. Try again later.';
}

export function decideElevenKey(input: { keySource?: string; clientKeyRequired?: boolean }, checkpoint: { keySource?: unknown; serverKeyRejected?: unknown }, hasClientProvider: boolean): ElevenDecision {
  const serverBound = input.keySource === 'server' || checkpoint.keySource === 'server' || checkpoint.serverKeyRejected === true;
  const clientBound = !serverBound && (input.keySource === 'client' || input.clientKeyRequired === true || checkpoint.keySource === 'client');
  const server = serverElevenLabsKey();
  if (serverBound || checkpoint.serverKeyRejected === true) {
    if (server.state === 'present' && server.key && checkpoint.serverKeyRejected !== true) return { action: 'use-server', key: server.key };
    if (server.state === 'invalid' || checkpoint.serverKeyRejected === true) return { action: 'fail', message: 'The hosted ElevenLabs key was rejected. A personal key was not used.' };
    return { action: 'wait', message: 'The hosted ElevenLabs key is no longer configured. This song will resume when the server key is restored.' };
  }
  if (clientBound) {
    return hasClientProvider
      ? { action: 'use-client' }
      : { action: 'wait', message: 'Add your ElevenLabs API key in Settings to resume this song.' };
  }
  // Unbound jobs are resolved again at execution. A server key still wins, so a
  // personal key supplied on resume cannot replace a key configured since enqueue.
  if (server.state === 'invalid') return { action: 'fail', message: 'The hosted ElevenLabs key is not valid. A personal key was not used.' };
  if (server.state === 'present' && server.key) return { action: 'use-server', key: server.key };
  if (hasClientProvider) return { action: 'use-client' };
  return { action: 'wait', message: 'Add an ElevenLabs API key in Settings, or set ELEVENLABS_API_KEY on the server.' };
}
