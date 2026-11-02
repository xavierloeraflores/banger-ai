// A deterministic Gateway response, used only by smoke tests. No paid calls.
export function chatFixture(body) {
  const source = 'tempo 105; meter 4/4; track agent_kick { sound "drums/kick"; rhythm "x . x ."; gain 0.5; }';
  const prompt = body.prompt;
  const last = prompt.at(-1);
  const content = last.role === "tool" ? [{ type: "text", text: "Two loops are ready. Preview either file or load it in the studio." }] : [
    { type: "tool-call", toolCallId: "loop-one", toolName: "create_banger_file", input: JSON.stringify({ name: "warm-loop.banger", source }) },
    { type: "tool-call", toolCallId: "loop-two", toolName: "create_banger_file", input: JSON.stringify({ name: "slow-loop.banger", source: source.replace("105", "85") }) },
  ];
  const reason = last.role === "tool" ? "stop" : "tool-calls";
  return { content, finishReason: { unified: reason, raw: reason }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 10 } }, warnings: [] };
}
