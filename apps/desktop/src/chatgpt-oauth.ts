import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { ChatGPTError } from "./chatgpt-errors.js";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export const ISSUER = "https://auth.openai.com";
export const RESOURCE = "https://api.openai.com/v1";
export const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
export const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
export const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
export type Identity = { subject: string; email?: string; name?: string };
export type TokenSet = { accessToken: string; refreshToken?: string; idToken?: string; expiresAt: number; scopes: string[] };

export async function verifyIdentity(token: string, clientId: string, nonce?: string, keys: JWTVerifyGetKey = jwks): Promise<Identity> {
  const { payload } = await jwtVerify(token, keys, {
    issuer: ISSUER, audience: clientId, algorithms: ["RS256"], requiredClaims: ["sub", "exp", "iat"], clockTolerance: 5,
  }).catch(() => { throw new ChatGPTError("identity"); });
  if (!payload.sub || (nonce !== undefined && payload.nonce !== nonce)) throw new ChatGPTError("identity");
  return { subject: payload.sub, ...(typeof payload.email === "string" ? { email: payload.email } : {}),
    ...(typeof payload.name === "string" ? { name: payload.name } : {}) };
}

export function parseTokens(value: unknown, previous?: TokenSet): TokenSet {
  const data = value as Record<string, unknown>;
  if (!data || typeof data.access_token !== "string" || !data.access_token ||
    typeof data.token_type !== "string" || data.token_type.toLowerCase() !== "bearer" ||
    typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
    (data.scope !== undefined && typeof data.scope !== "string")) throw new ChatGPTError("invalidTokens");
  return { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000,
    refreshToken: typeof data.refresh_token === "string" && data.refresh_token ? data.refresh_token : previous?.refreshToken,
    idToken: typeof data.id_token === "string" && data.id_token ? data.id_token : previous?.idToken,
    scopes: typeof data.scope === "string" ? data.scope.split(/\s+/).filter(Boolean) : previous?.scopes ?? [],
  };
}

export async function exchangeToken(body: URLSearchParams, fetcher: typeof fetch, signal?: AbortSignal) {
  const response = await fetcher(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body, signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]), redirect: "error" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string | { code?: string } } | null;
    const code = typeof payload?.error === "string" ? payload.error : payload?.error?.code;
    const diagnostics = { status: response.status, providerCode: code,
      requestId: response.headers.get("x-request-id") ?? response.headers.get("openai-request-id") ?? undefined };
    if (code && ["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"].includes(code)) {
      throw new ChatGPTError("reauthorize", diagnostics);
    }
    if (code === "invalid_client") throw new ChatGPTError("client", diagnostics);
    throw new ChatGPTError("unavailable", diagnostics);
  }
  return response.json() as Promise<unknown>;
}

export async function authorize(options: {
  hostId: string; account?: Identity & { clientId: string; tokens?: TokenSet };
  openExternal(url: string): Promise<void>; fetcher?: typeof fetch; signal: AbortSignal;
  verify?: typeof verifyIdentity;
}): Promise<{ clientId: string; identity: Identity; tokens: TokenSet }> {
  const fetcher = options.fetcher ?? fetch;
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(180_000)]);
  signal.throwIfAborted();
  let redirectUri = "";
  let consumed = false;
  let resolveCallback!: (value: { code: string; clientId: string }) => void;
  let rejectCallback!: (error: Error) => void;
  const callback = new Promise<{ code: string; clientId: string }>((resolve, reject) => { resolveCallback = resolve; rejectCallback = reject; });
  // Browser opening can fail before callback is awaited.
  void callback.catch(() => undefined);
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'none'");
    let url: URL;
    try { url = new URL(request.url ?? "/", redirectUri); }
    catch { response.writeHead(400).end("Invalid callback."); return; }
    const returnedState = url.searchParams.get("state") ?? "";
    if (request.method !== "GET" || request.headers.host !== new URL(redirectUri).host || url.pathname !== "/auth/callback") {
      response.writeHead(404).end("Not found."); return;
    }
    if (consumed || Buffer.byteLength(returnedState) !== Buffer.byteLength(state) || !timingSafeEqual(Buffer.from(returnedState), Buffer.from(state))) {
      response.writeHead(400).end("Sign-in could not be verified. Return to Banger and try again."); return;
    }
    consumed = true;
    const code = url.searchParams.get("code");
    const returnedClient = url.searchParams.get("client_id");
    const clientId = options.account?.clientId ?? returnedClient;
    if (url.searchParams.has("error") || !code || !clientId || !/^oaiapp_[A-Za-z0-9_-]+$/.test(clientId) ||
      (options.account && returnedClient && returnedClient !== options.account.clientId)) {
      response.writeHead(400).end("Sign-in was not completed. Return to Banger and try again.");
      rejectCallback(new Error("ChatGPT sign-in was declined or could not be verified.")); return;
    }
    response.end("Authorization received. Return to Banger to finish connecting your account.");
    resolveCallback({ code, clientId });
  });
  const onAbort = () => rejectCallback(new Error("ChatGPT sign-in stopped or timed out. Try again."));
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not start the sign-in callback.");
    redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
    const url = new URL(AUTHORIZE);
    url.search = new URLSearchParams({ client_id: options.account?.clientId ?? "dynamic_agent_client", ext_agent_host_id: options.hostId,
      response_type: "code", redirect_uri: redirectUri, scope: SCOPES, resource: RESOURCE,
      state, nonce, code_challenge_method: "S256", code_challenge: challenge }).toString();
    if (!options.account) url.searchParams.set("agent_name_hint", "Banger");
    if (options.account?.tokens?.idToken) url.searchParams.set("id_token_hint", options.account.tokens.idToken);
    if (options.account?.email) url.searchParams.set("login_hint", options.account.email);
    // An explicit reconnect after declining plan permission must request consent again.
    if (options.account?.tokens && !options.account.tokens.scopes.includes("chatgpt.tokens.use.direct")) url.searchParams.set("prompt", "consent");
    signal.throwIfAborted();
    await options.openExternal(url.toString());
    const { code, clientId } = await callback;
    const tokens = parseTokens(await exchangeToken(new URLSearchParams({ grant_type: "authorization_code", client_id: clientId,
      code, code_verifier: verifier, redirect_uri: redirectUri, resource: RESOURCE }), fetcher, signal));
    if (!tokens.idToken) throw new ChatGPTError("noIdentity");
    const identity = await (options.verify ?? verifyIdentity)(tokens.idToken, clientId, nonce);
    if (options.account && identity.subject !== options.account.subject) throw new Error("This is a different ChatGPT account. Add it as a new account instead.");
    signal.throwIfAborted();
    return { clientId, identity, tokens };
  } finally {
    signal.removeEventListener("abort", onAbort);
    server.close();
    server.closeAllConnections();
  }
}
