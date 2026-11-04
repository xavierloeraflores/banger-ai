import { type ChatEvent, generateLyrics, lyricRequestSchema, parseChatRequest, runBangerAgent, selectModel } from '@banger/agent';
import { z } from 'zod';
import { ApiError } from './domain';
import { db } from './db';
import { hostedProviderError, optionalCredentialSchema, resolveWebCredentials } from './provider-keys';

export async function browserGeneration(user: string, kind: 'chat' | 'lyrics', body: unknown, signal: AbortSignal, fetcher?: typeof fetch, emit?: (event: ChatEvent) => void) {
  if (Buffer.byteLength(JSON.stringify(body)) > 280 * 1024) throw new ApiError(413, 'The conversation is too large. Start a new chat.');
  const input = z.object({ credentials: optionalCredentialSchema.optional(), request: z.unknown() }).strict().safeParse(body);
  // Do not return schema diagnostics for credentials or provider errors.
  if (!input.success) throw new ApiError(400, 'Check your AI settings and try again.');
  let request;
  try { request = kind === 'chat' ? parseChatRequest(input.data.request) : lyricRequestSchema.parse(input.data.request); }
  catch { throw new ApiError(400, 'The conversation is too large or invalid. Start a new chat.'); }
  const resolved = resolveWebCredentials(input.data.credentials);
  const result = await db().query(`INSERT INTO web_auth_limits(bucket,attempts,expires_at) VALUES($1,1,now()+interval '1 minute')
    ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN web_auth_limits.expires_at<=now() THEN 1 ELSE web_auth_limits.attempts+1 END,
    expires_at=CASE WHEN web_auth_limits.expires_at<=now() THEN now()+interval '1 minute' ELSE web_auth_limits.expires_at END RETURNING attempts`, [`ai:${user}`]);
  if (result.rows[0].attempts > 20) throw new ApiError(429, 'Too many generation requests. Try again in a minute.');
  try {
    const selected = selectModel({ provider: resolved.provider, model: resolved.model, key: resolved.key, reasoningLevel: resolved.reasoningLevel }, fetcher);
    return kind === 'chat'
      ? { ok: true, reply: await runBangerAgent(request as ReturnType<typeof parseChatRequest>, selected, signal, emit) }
      : { ok: true, edits: await generateLyrics(request as z.infer<typeof lyricRequestSchema>, selected, signal) };
  } catch (error) { return { ok: false, error: hostedProviderError(error, resolved.source), ...(resolved.source === 'server' ? { code: 'hosted_provider_rejected' as const } : {}) }; }
}
