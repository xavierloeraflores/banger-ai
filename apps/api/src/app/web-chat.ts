import { browserCredentials, invalidateServerAIStatus, loadServerAIStatus, requestCredentials } from '@/lib/ai-providers';
import type { ChatEvent, ChatOutcome, ChatRequest, LyricOutcome, LyricRequest } from '@banger/agent/protocol';
import type {} from '@/lib/ai-chat';

// The hosted app sends generation through its authenticated server. A configured
// server key is selected there; a personal key is sent only as fallback.
export function installWebChat(accountId: string) {
  let active: AbortController | undefined;
  let activeId: string | undefined;
  const listeners = new Set<(event: ChatEvent) => void>();
  async function send<T>(kind: string, request: ChatRequest | LyricRequest): Promise<T> {
    if (active) throw new Error('Wait for the current generation or stop it first.');
    const saved = browserCredentials();
    const selected = saved ?? (typeof requestCredentials === 'function' ? requestCredentials() : null);
    if (!saved && !selected && !(await loadServerAIStatus())?.defaultProvider) throw new Error('Add a provider key and model in Settings → BYOK.');
    const credentials = saved ?? (selected ? { provider: selected.provider, model: selected.model, reasoningLevel: selected.reasoningLevel } : undefined);
    const controller = new AbortController();
    active = controller;
    activeId = "requestId" in request ? request.requestId : undefined;
    try {
      const response = await fetch(`/api/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(kind === 'chat' ? { Accept: 'application/x-ndjson' } : {}), 'X-Banger-Account': accountId }, body: JSON.stringify({ ...(credentials ? { credentials } : {}), request }), signal: controller.signal, redirect: 'error' });
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
        if (result && typeof result === 'object' && (result as { code?: string }).code === 'hosted_provider_rejected') invalidateServerAIStatus();
        return result;
      }
      const result = await response.json();
      if (!response.ok || result?.code === 'hosted_provider_rejected') invalidateServerAIStatus();
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
