import { browserCredentials } from '@/lib/ai-providers';
import type { ChatEvent, ChatOutcome, ChatRequest, LyricOutcome, LyricRequest } from '@banger/agent/protocol';
import type {} from '@/lib/ai-chat';

// The hosted app sends BYOK calls through its authenticated server so provider
// browser restrictions do not change the desktop chat workflow.
export function installWebChat(accountId: string) {
  let active: AbortController | undefined;
  let activeId: string | undefined;
  const listeners = new Set<(event: ChatEvent) => void>();
  async function send<T>(kind: string, request: ChatRequest | LyricRequest): Promise<T> {
    if (active) throw new Error('Wait for the current generation or stop it first.');
    const credentials = browserCredentials();
    if (!credentials) throw new Error('Add a provider key and model in Settings → BYOK.');
    const controller = new AbortController();
    active = controller;
    activeId = "requestId" in request ? request.requestId : undefined;
    try {
      const response = await fetch(`/api/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(kind === 'chat' ? { Accept: 'application/x-ndjson' } : {}), 'X-Banger-Account': accountId }, body: JSON.stringify({ credentials, request }), signal: controller.signal, redirect: 'error' });
      if (response.ok && kind === 'chat' && response.headers.get('content-type')?.includes('application/x-ndjson')) {
        const reader = response.body?.getReader();
        if (!reader) throw new Error('The chat response was interrupted.');
        const decoder = new TextDecoder();
        let pending = ''; let result: T | undefined;
        try {
          while (true) {
            const chunk = await reader.read();
            pending += decoder.decode(chunk.value, { stream: !chunk.done });
            if (pending.length > 1024 * 1024) throw new Error('The chat response is too large.');
            let newline: number;
            while ((newline = pending.indexOf('\n')) !== -1) {
              const item = JSON.parse(pending.slice(0, newline)); pending = pending.slice(newline + 1);
              if (item.event && item.event.requestId === activeId && !controller.signal.aborted) for (const listener of listeners) listener(item.event);
              if (item.result) result = item.result;
            }
            if (chunk.done) break;
          }
        } finally { await reader.cancel(); }
        controller.signal.throwIfAborted();
        if (!result) throw new Error('The chat response was interrupted. Try again.');
        return result;
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not complete generation.');
      return result;
    } finally { if (active === controller) active = undefined; }
  }
  window.bangerChat = {
    send: request => send<ChatOutcome>('chat', request),
    lyrics: request => send<LyricOutcome>('lyrics', request),
    cancel: async requestId => { if (requestId === undefined || requestId === activeId) active?.abort(); },
    onEvent(callback) { listeners.add(callback); return () => { listeners.delete(callback); }; },
  };
}
