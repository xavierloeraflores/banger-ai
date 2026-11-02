"use client";

import { compileMusic } from "@banger/compiler";
import type { ChatOutcome, ChatReply, ChatRequest } from "@banger/agent/protocol";
import { browserCredentials } from "./ai-providers";

declare global {
  interface Window {
    bangerChat?: { send(request: ChatRequest): Promise<ChatOutcome>; cancel(): Promise<void> };
  }
}

function checkedReply(value: unknown): ChatReply {
  const reply = value as ChatReply | null;
  if (!reply || typeof reply.text !== "string" || reply.text.length > 5000 || typeof reply.model !== "string" || reply.model.length > 200 ||
      !Array.isArray(reply.files) || reply.files.length > 4) throw new Error("The AI returned an invalid reply. Try again.");
  for (const file of reply.files) {
    if (!file || typeof file.name !== "string" || (file.name.length > 100 || !file.name.endsWith(".banger") || /[\/\\\x00-\x1f\x7f]/.test(file.name)) ||
        typeof file.source !== "string" || file.source.length > 65536) throw new Error("The AI returned an invalid file. Try again.");
    compileMusic(file.source);
  }
  return reply;
}

export async function sendChat(request: ChatRequest, signal: AbortSignal): Promise<ChatReply> {
  let result: ChatOutcome;
  signal.throwIfAborted();
  if (window.bangerChat) {
    const bridge = window.bangerChat;
    const cancel = () => { void bridge.cancel().catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    try { result = await bridge.send(request); }
    finally { signal.removeEventListener("abort", cancel); }
  } else {
    if (window.location.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) {
      throw new Error("Open Banger over HTTPS to use AI chat.");
    }
    const credentials = browserCredentials();
    if (!credentials) throw new Error("Add a provider key and model in BYOK to start chatting.");
    const { selectModel, runBangerAgent, publicAIError } = await import("@banger/agent");
    try {
      result = { ok: true, reply: await runBangerAgent(request, selectModel(credentials), signal) };
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error(`${publicAIError(error)} If this provider blocks browser requests, use the desktop app.`);
    }
  }
  signal.throwIfAborted();
  if (!result || typeof result.ok !== "boolean") throw new Error("The AI service returned an invalid reply.");
  if (!result.ok) throw new Error(typeof result.error === "string" ? result.error.slice(0, 500) : "Could not generate a reply.");
  return checkedReply(result.reply);
}
