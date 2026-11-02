import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { createOpenAI } from "@ai-sdk/openai";
import { authorize, exchangeToken, parseTokens, verifyIdentity, ISSUER, RESOURCE, type Identity, type TokenSet } from "./chatgpt-oauth.js";

type Encryption = { isAvailable(): boolean | Promise<boolean>; encrypt(value: string): Buffer | Promise<Buffer>; decrypt(value: Buffer): string | Promise<string> };
type Model = { id: string; label: string };
type Account = Identity & { id: string; clientId: string; tokens?: TokenSet; model?: string; models: Model[] };
type Saved = { version: 1; hostId: string; accounts: Account[]; activeAccountId: string | null; selected: boolean };
export type ChatGPTStatus = { selected: boolean; activeAccountId: string | null; signingIn: boolean;
  accounts: { id: string; label: string; email?: string; connected: boolean; sharing: boolean; model?: string }[]; models: Model[]; error?: string };

function sharing(account?: Account) {
  return Boolean(account?.tokens?.scopes.includes("chatgpt.tokens.use.direct") && account.tokens.scopes.includes("resource.invoke"));
}
function summary(saved: Saved, signingIn: boolean): ChatGPTStatus {
  return { selected: saved.selected, activeAccountId: saved.activeAccountId, signingIn,
    accounts: saved.accounts.map((account, index) => ({ id: account.id,
      label: `${account.name || account.email || "ChatGPT account"} · ${index + 1}`,
      email: account.email, connected: Boolean(account.tokens), sharing: sharing(account), model: account.model })),
    models: saved.accounts.find(account => account.id === saved.activeAccountId)?.models ?? [] };
}

// Only terminal completed output is returned to the AI SDK. HTTP 200 alone is not success.
export async function completedResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("ChatGPT returned no response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let output: unknown;
  let completed = false;
  function event(block: string) {
    const data = block.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return;
    const value = JSON.parse(data) as { type?: string; response?: { status?: string; error?: { code?: string } } };
    if (value.type === "error" || value.type === "response.failed" || value.type === "response.incomplete") {
      const code = value.response?.error?.code;
      if (code === "subscription_sharing_usage_limit_exceeded" || code === "subscription_sharing_usage_unavailable") {
        throw new Error("ChatGPT plan usage is unavailable or at its limit. Review ChatGPT Settings → Usage, then try again.");
      }
      throw new Error("ChatGPT could not complete this response. Try again.");
    }
    if (value.type === "response.completed") {
      if (!value.response || value.response.status !== "completed") throw new Error("ChatGPT returned an invalid completion.");
      completed = true; output = value.response;
    }
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending = (pending + decoder.decode(value, { stream: !done })).replace(/\r\n/g, "\n");
      if (pending.length > 16 * 1024 * 1024) throw new Error("ChatGPT returned too much data. Try a smaller request.");
      let end: number;
      while ((end = pending.indexOf("\n\n")) >= 0) { event(pending.slice(0, end)); pending = pending.slice(end + 2); }
      if (done) break;
    }
    if (pending.trim()) event(pending);
    if (!completed) throw new Error("ChatGPT disconnected before completing the response. Try again.");
    return output;
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

// This module runs in Electron's main process. No method returns a credential to IPC.
export function createChatGPTAuth(path: string, encryption: Encryption, options: {
  openExternal(url: string): Promise<void>; fetcher?: typeof fetch; verify?: typeof verifyIdentity;
}) {
  const fetcher = options.fetcher ?? fetch;
  let queue = Promise.resolve();
  let pendingLogin: AbortController | undefined;
  const requests = new Set<AbortController>();
  const serialize = <T>(action: () => Promise<T>): Promise<T> => {
    const result = queue.then(action); queue = result.then(() => undefined, () => undefined); return result;
  };
  async function requireEncryption() {
    if (!await encryption.isAvailable()) throw new Error("Secure ChatGPT storage is unavailable. Unlock your system keychain and try again.");
  }
  async function read(): Promise<Saved> {
    let bytes: Buffer;
    try { bytes = await readFile(path); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        const saved: Saved = { version: 1, hostId: `urn:uuid:${randomUUID()}`, accounts: [], activeAccountId: null, selected: false };
        return saved;
      }
      throw new Error("Could not read saved ChatGPT accounts.");
    }
    await requireEncryption();
    try {
      const saved = JSON.parse(await encryption.decrypt(bytes)) as Saved;
      if (saved.version !== 1 || !/^urn:uuid:[0-9a-f-]+$/.test(saved.hostId) || !Array.isArray(saved.accounts) ||
        saved.accounts.some(account => !account.id || !account.subject || !/^oaiapp_[A-Za-z0-9_-]+$/.test(account.clientId) || !Array.isArray(account.models))) throw new Error();
      return saved;
    } catch { throw new Error("Could not unlock saved ChatGPT accounts. Check your system keychain and try again."); }
  }
  async function persist(saved: Saved) {
    await requireEncryption();
    try {
      await writeFile(`${path}.tmp`, await encryption.encrypt(JSON.stringify(saved)), { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    } catch { throw new Error("Could not save ChatGPT accounts securely."); }
  }
  function accountById(saved: Saved, id: unknown): Account {
    const account = saved.accounts.find(account => account.id === id);
    if (!account) throw new Error("Choose a saved ChatGPT account.");
    return account;
  }
  function stopRequests() { for (const request of requests) request.abort(); }
  async function credentials(saved: Saved, account: Account) {
    if (!account.tokens) throw new Error("Sign in to this ChatGPT account again.");
    if (!sharing(account)) throw new Error("Allow Banger to use your ChatGPT plan when signing in.");
    if (account.tokens.expiresAt <= Date.now() + 60_000) {
      if (!account.tokens.refreshToken) throw new Error("Your ChatGPT session expired. Sign in again.");
      const raw = await exchangeToken(new URLSearchParams({ grant_type: "refresh_token", client_id: account.clientId,
        refresh_token: account.tokens.refreshToken, resource: RESOURCE }), fetcher);
      const next = parseTokens(raw, account.tokens);
      if (next.idToken && next.idToken !== account.tokens.idToken) {
        const identity = await (options.verify ?? verifyIdentity)(next.idToken, account.clientId);
        if (identity.subject !== account.subject) throw new Error("ChatGPT returned a different account. Sign in again.");
      }
      account.tokens = next;
      await persist(saved);
      if (!sharing(account)) throw new Error("ChatGPT plan permission was removed. Sign in again.");
    }
    return account.tokens.accessToken;
  }
  async function catalog(saved: Saved, account: Account) {
    const token = await credentials(saved, account);
    const response = await fetcher(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000), redirect: "error" });
    if (!response.ok) throw new Error("Could not load ChatGPT models. Check your connection and sign in again if needed.");
    const body = await response.json() as { models?: { slug?: string; display_name?: string; visibility?: string }[] };
    if (!Array.isArray(body.models)) throw new Error("ChatGPT returned an invalid model list.");
    account.models = body.models.filter(model => model.visibility === "list" && typeof model.slug === "string" && model.slug)
      .map(model => ({ id: model.slug!, label: typeof model.display_name === "string" ? model.display_name : model.slug! }));
    if (!account.models.some(model => model.id === account.model)) account.model = account.models[0]?.id;
  }
  async function status() { return serialize(async () => summary(await read(), Boolean(pendingLogin))); }
  return {
    status,
    cancelSignIn() { pendingLogin?.abort(); },
    dispose() { pendingLogin?.abort(); stopRequests(); },
    async signIn(accountId?: unknown) {
      if (pendingLogin) throw new Error("A ChatGPT sign-in is already open in your browser.");
      const controller = new AbortController(); pendingLogin = controller;
      try {
        const { hostId, account } = await serialize(async () => {
          const saved = await read();
          await persist(saved);
          return { hostId: saved.hostId, account: accountId === undefined ? undefined : accountById(saved, accountId) };
        });
        const result = await authorize({ hostId, account, openExternal: options.openExternal, fetcher, verify: options.verify, signal: controller.signal });
        return await serialize(async () => {
          controller.signal.throwIfAborted();
          const saved = await read();
          const existing = saved.accounts.find(item => item.clientId === result.clientId && item.subject === result.identity.subject);
          const next: Account = { ...result.identity, id: existing?.id ?? randomUUID(), clientId: result.clientId,
            tokens: result.tokens, model: existing?.model, models: existing?.models ?? [] };
          if (existing) saved.accounts[saved.accounts.indexOf(existing)] = next; else saved.accounts.push(next);
          saved.activeAccountId = next.id; saved.selected = sharing(next);
          // Save valid credentials even if model discovery is temporarily unavailable.
          await persist(saved);
          let error: string | undefined;
          if (sharing(next)) {
            try { await catalog(saved, next); await persist(saved); }
            catch { error = "Signed in. ChatGPT models could not be loaded; select this account to retry."; }
          } else error = "Signed in without ChatGPT plan access. Continue with ChatGPT again to enable it.";
          stopRequests();
          return { ...summary(saved, false), ...(error ? { error } : {}) };
        });
      } finally { if (pendingLogin === controller) pendingLogin = undefined; }
    },
    selectAccount: (id: unknown) => serialize(async () => {
      const saved = await read(); const account = accountById(saved, id);
      await catalog(saved, account);
      saved.activeAccountId = account.id; saved.selected = true;
      stopRequests(); await persist(saved); return summary(saved, Boolean(pendingLogin));
    }),
    select: (selected: boolean) => serialize(async () => {
      const saved = await read();
      if (!selected && !saved.selected) return summary(saved, Boolean(pendingLogin));
      if (selected) await catalog(saved, accountById(saved, saved.activeAccountId));
      saved.selected = selected; stopRequests(); await persist(saved); return summary(saved, Boolean(pendingLogin));
    }),
    selectModel: (model: unknown) => serialize(async () => {
      const saved = await read(); const account = accountById(saved, saved.activeAccountId);
      if (typeof model !== "string" || !account.models.some(value => value.id === model)) throw new Error("Choose an available ChatGPT model.");
      account.model = model; stopRequests(); await persist(saved); return summary(saved, Boolean(pendingLogin));
    }),
    signOut: (id?: unknown) => {
      pendingLogin?.abort(); stopRequests();
      return serialize(async () => {
        const saved = await read(); const account = accountById(saved, id ?? saved.activeAccountId);
        let revoked = !account.tokens?.refreshToken;
        if (account.tokens?.refreshToken) {
          try {
            const discovery = await fetcher(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000), redirect: "error" });
            const config = await discovery.json() as { revocation_endpoint?: string };
            const endpoint = new URL(config.revocation_endpoint ?? "");
            if (!discovery.ok || endpoint.origin !== ISSUER) throw new Error();
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                const response = await fetcher(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
                  body: new URLSearchParams({ token: account.tokens.refreshToken, token_type_hint: "refresh_token", client_id: account.clientId }),
                  signal: AbortSignal.timeout(10_000), redirect: "error" });
                revoked = response.status === 200;
                if (revoked || response.status < 500) break;
              } catch { /* Retry once before removing local tokens. */ }
              if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 250));
            }
          } catch { /* Local sign-out still clears credentials if remote revocation is unavailable. */ }
        }
        delete account.tokens; account.models = [];
        if (saved.activeAccountId === account.id) saved.selected = false;
        await persist(saved);
        return { ...summary(saved, Boolean(pendingLogin)), ...(!revoked ? { error: "Signed out locally. Remote revocation was not confirmed; disconnect Banger in ChatGPT Settings." } : {}) };
      });
    },
    async model(): Promise<{ model: ReturnType<ReturnType<typeof createOpenAI>["responses"]>; name: string }> {
      const selection = await serialize(async () => {
        const saved = await read();
        if (!saved.selected) throw new Error("Select ChatGPT in AI settings first.");
        const account = accountById(saved, saved.activeAccountId);
        await credentials(saved, account);
        if (!account.model) { await catalog(saved, account); await persist(saved); }
        if (!account.model) throw new Error("No ChatGPT models are available for this account.");
        return { accountId: account.id, model: account.model };
      });
      const authorizedFetch: typeof fetch = async (input, init) => {
        if (String(input) !== `${RESOURCE}/responses` || init?.method !== "POST") throw new Error("Unsupported ChatGPT inference endpoint.");
        const controller = new AbortController(); requests.add(controller);
        try {
          const token = await serialize(async () => {
            const saved = await read();
            if (!saved.selected || saved.activeAccountId !== selection.accountId) throw new Error("The selected ChatGPT account changed. Start the request again.");
            return credentials(saved, accountById(saved, selection.accountId));
          });
          controller.signal.throwIfAborted();
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          // ChatGPT plan usage has a narrower contract than API-key Responses requests.
          for (const field of ["background", "conversation", "max_output_tokens", "max_tool_calls", "metadata", "moderation",
            "multi_agent", "prompt", "prompt_cache_retention", "safety_identifier", "temperature", "top_logprobs", "top_p",
            "truncation", "user", "previous_response_id"]) delete body[field];
          if (!Array.isArray(body.input)) throw new Error("ChatGPT requests must include their conversation history.");
          body.input = body.input.map((item: Record<string, unknown>) => item.role === "system" ? { ...item, role: "developer" } : item);
          const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${token}`);
          const response = await fetcher(`${RESOURCE}/responses`, { ...init, headers,
            body: JSON.stringify({ ...body, store: false, stream: true }), redirect: "error",
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000), ...(init.signal ? [init.signal] : [])]) });
          if (!response.ok) return response;
          const output = await completedResponse(response);
          return new Response(JSON.stringify(output), { status: 200, headers: { "Content-Type": "application/json" } });
        } finally { requests.delete(controller); }
      };
      const base = createOpenAI({ apiKey: "managed-by-chatgpt-auth", fetch: authorizedFetch }).responses(selection.model);
      // Tell the SDK that items are not stored so follow-up tool steps include content, not remote references.
      const model = new Proxy(base, { get(target, property, receiver) {
        if (property === "doGenerate") return (args: Parameters<typeof base.doGenerate>[0]) => target.doGenerate({ ...args,
          tools: args.tools?.map(tool => tool.type === "function" ? { ...tool, providerOptions: { ...tool.providerOptions,
            openai: { ...tool.providerOptions?.openai, namespace: { name: "banger", description: "Read, edit, and validate Banger music projects." } } } } : tool),
          providerOptions: { ...args.providerOptions, openai: { ...args.providerOptions?.openai, store: false, systemMessageMode: "developer" } } });
        return Reflect.get(target, property, receiver);
      } });
      return { model, name: selection.model };
    },
  };
}
