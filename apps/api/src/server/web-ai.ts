import { credentialsSchema, generateLyrics, lyricRequestSchema, parseChatRequest, publicAIError, runBangerAgent, selectModel } from '@banger/agent';
import { z } from 'zod';
import { ApiError } from './domain';
import { db } from './db';

export async function browserGeneration(user: string, kind: 'chat' | 'lyrics', body: unknown, signal: AbortSignal, fetcher?: typeof fetch) {
  if (Buffer.byteLength(JSON.stringify(body)) > 280 * 1024) throw new ApiError(413, 'The conversation is too large. Start a new chat.');
  const input = z.object({ credentials: credentialsSchema, request: z.unknown() }).strict().safeParse(body);
  // Do not return schema diagnostics for credentials or provider errors.
  if (!input.success) throw new ApiError(400, 'Check your AI settings and try again.');
  let request;
  try { request = kind === 'chat' ? parseChatRequest(input.data.request) : lyricRequestSchema.parse(input.data.request); }
  catch { throw new ApiError(400, 'The conversation is too large or invalid. Start a new chat.'); }
  const result = await db().query(`INSERT INTO web_auth_limits(bucket,attempts,expires_at) VALUES($1,1,now()+interval '1 minute')
    ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN web_auth_limits.expires_at<=now() THEN 1 ELSE web_auth_limits.attempts+1 END,
    expires_at=CASE WHEN web_auth_limits.expires_at<=now() THEN now()+interval '1 minute' ELSE web_auth_limits.expires_at END RETURNING attempts`, [`ai:${user}`]);
  if (result.rows[0].attempts > 20) throw new ApiError(429, 'Too many generation requests. Try again in a minute.');
  try {
    const selected = selectModel(input.data.credentials, fetcher);
    return kind === 'chat'
      ? { ok: true, reply: await runBangerAgent(request as ReturnType<typeof parseChatRequest>, selected, signal) }
      : { ok: true, edits: await generateLyrics(request as z.infer<typeof lyricRequestSchema>, selected, signal) };
  } catch (error) { return { ok: false, error: publicAIError(error) }; }
}
