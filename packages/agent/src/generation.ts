import { generateText, streamText, type ModelMessage, type FinishReason, type ToolSet } from "ai";
import type { ChatEvent } from "./protocol.js";

// Consume only answer deltas. Never forward reasoning, tool arguments, raw
// provider payloads or partial structured output to the transcript.
export async function generateAnswer<TOOLS extends ToolSet>(options: Parameters<typeof generateText<TOOLS>>[0], live?: { requestId: string; emit(event: ChatEvent): void }): Promise<{ text: string; response: { messages: ModelMessage[] }; finishReason: FinishReason }> {
  if (!live) return generateText(options);
  const result = streamText({ ...options, onError: () => {} });
  for await (const part of result.fullStream) {
    if (part.type === "error") throw part.error;
    if (part.type === "start-step") live.emit({ requestId: live.requestId, type: "text-reset" });
    if (part.type === "text-delta") live.emit({ requestId: live.requestId, type: "text-delta", text: part.text });
  }
  options.abortSignal?.throwIfAborted();
  return { text: await result.text, response: await result.response, finishReason: await result.finishReason };
}
