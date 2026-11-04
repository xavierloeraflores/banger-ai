import { browserCredentials } from '@/lib/ai-providers';
import type { ChatOutcome, ChatRequest, LyricOutcome, LyricRequest } from '@banger/agent/protocol';
import type {} from '@/lib/ai-chat';

// The hosted app sends BYOK calls through its authenticated server so provider
// browser restrictions do not change the desktop chat workflow.
export function installWebChat(accountId: string) {
  let active: AbortController | undefined;
  async function send<T>(kind: string, request: ChatRequest | LyricRequest): Promise<T> {
    if (active) throw new Error('Wait for the current generation or stop it first.');
    const credentials = browserCredentials();
    if (!credentials) throw new Error('Add a provider key and model in Settings → BYOK.');
    const controller = new AbortController();
    active = controller;
    try {
      const response = await fetch(`/api/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Banger-Account': accountId }, body: JSON.stringify({ credentials, request }), signal: controller.signal, redirect: 'error' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not complete generation.');
      return result;
    } finally { if (active === controller) active = undefined; }
  }
  window.bangerChat = {
    send: request => send<ChatOutcome>('chat', request),
    lyrics: request => send<LyricOutcome>('lyrics', request),
    cancel: async () => { active?.abort(); },
  };
}
