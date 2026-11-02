const MESSAGES = {
  client: "ChatGPT rejected Banger’s client registration. Add a new ChatGPT account registration in AI settings.",
  unsupported: "This request uses a capability unavailable through your ChatGPT plan. Try another model or a simpler request.",
  identity: "ChatGPT identity could not be verified. Sign in again.",
  reauthorize: "Your ChatGPT session expired or was revoked. Continue with ChatGPT again in AI settings.",
  access: "ChatGPT plan access is unavailable for this account or model. Check AI settings and ChatGPT Settings → Usage.",
  usage: "ChatGPT plan usage is unavailable or at its limit. Review ChatGPT Settings → Usage, then try again.",
  unavailable: "ChatGPT is unavailable. Check your connection and try again in a moment.",
  incomplete: "ChatGPT did not complete the response. Try again with a smaller request.",
  interrupted: "ChatGPT disconnected before completing the response. Try again.",
  invalidTokens: "ChatGPT returned an invalid token response. Continue with ChatGPT again in AI settings.",
  noIdentity: "ChatGPT did not return a verifiable identity. Continue with ChatGPT again in AI settings.",
} as const;
export class ChatGPTError extends Error {
  constructor(readonly code: keyof typeof MESSAGES, readonly diagnostics?: { status?: number; providerCode?: string; requestId?: string }) { super(MESSAGES[code]); this.name = "ChatGPTError"; }
}

// Never forward raw SDK, HTTP, JWT, or keychain diagnostics to the renderer.
export function publicChatGPTError(error: unknown): string {
  if (error instanceof ChatGPTError) return error.message;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return "ChatGPT generation stopped or timed out. Try again.";
  // AI SDK may wrap network failures. Read only our typed cause, not a provider's message.
  if (error instanceof Error && error.cause instanceof ChatGPTError) return error.cause.message;
  return "ChatGPT could not complete the request. Check your account, model, and usage in AI settings, then try again.";
}
