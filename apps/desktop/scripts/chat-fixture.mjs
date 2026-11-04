// A deterministic Gateway response, used only by smoke tests. No paid calls.
export function chatFixture(body) {
  if (!body.tools?.length) return { content: [{ type: "text", text: "Reply only. Your song is unchanged." }], finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 10 } }, warnings: [] };
  const source = 'tempo 105; meter 4/4; track agent_kick { sound "drums/kick"; rhythm "x . x ."; gain 0.5; }';
  const prompt = body.prompt;
  const last = prompt.at(-1);
  const latestPrompt = JSON.stringify(prompt.findLast(message => message.role === "user").content);
  const revision = latestPrompt.includes("Make the second loop softer");
  const slower = latestPrompt.includes("Slow the selected loop again");
  const manual = latestPrompt.includes("Keep my manual edit and soften the editor");
  const variations = latestPrompt.includes("Create three more loops");
  const older = latestPrompt.includes("Edit the older selected loop");
  const contextText = prompt.find(message => message.role === "user").content.find(part => part.type === "text").text;
  const context = JSON.parse(contextText.slice(contextText.indexOf("\n") + 1));
  const edit = (oldText, newText) => [{ type: "tool-call", toolCallId: "revise-selected-loop", toolName: "edit_banger_file", input: JSON.stringify({ name: context.targetFile, edits: [{ oldText, newText }] }) }];
  const content = last.role === "tool" ? [{ type: "text", text: "Two loops are ready. Preview either file or load it in the studio." }] : slower ? edit("tempo 85;", "tempo 75;")
    : manual ? edit("gain 0.25;", "gain 0.15;")
    : older ? edit("tempo 105;", "tempo 100;")
    : variations ? [1, 2, 3].map(index => ({ type: "tool-call", toolCallId: `variation-${index}`, toolName: "create_banger_file", input: JSON.stringify({ name: `variation-${index}.banger`, source }) }))
    : revision ? [
    { type: "tool-call", toolCallId: "revise-loop", toolName: "edit_banger_file", input: JSON.stringify({ name: "slow-loop.banger", edits: [{ oldText: "gain 0.5;", newText: "gain 0.25;" }] }) },
  ] : [
    { type: "tool-call", toolCallId: "loop-one", toolName: "create_banger_file", input: JSON.stringify({ name: "warm-loop.banger", source }) },
    { type: "tool-call", toolCallId: "loop-two", toolName: "create_banger_file", input: JSON.stringify({ name: "slow-loop.banger", source: source.replace("105", "85") }) },
  ];
  const reason = last.role === "tool" ? "stop" : "tool-calls";
  return { content, finishReason: { unified: reason, raw: reason }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 10 } }, warnings: [] };
}

// Gateway streams the provider's typed chunks as SSE. Delay answer chunks so
// browser checks can observe an unfinished reply before files become available.
export function gatewayFixtureResponse(result, options) {
  if (new Headers(options.headers).get('ai-language-model-streaming') !== 'true') return Response.json(result);
  const parts = [{ type: 'stream-start', warnings: [] }];
  for (const item of result.content) {
    if (item.type !== 'text') { parts.push(item); continue; }
    parts.push({ type: 'text-start', id: 'answer' });
    const middle = Math.max(1, Math.floor(item.text.length / 2));
    parts.push({ type: 'text-delta', id: 'answer', delta: item.text.slice(0, middle) });
    parts.push({ type: 'text-delta', id: 'answer', delta: item.text.slice(middle) });
    parts.push({ type: 'text-end', id: 'answer' });
  }
  parts.push({ type: 'finish', finishReason: result.finishReason, usage: result.usage });
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    async pull(output) {
      const part = parts.shift();
      if (!part) { output.close(); return; }
      if (part.type === 'text-delta' || part.type === 'text-end') await new Promise(resolve => setTimeout(resolve, 180));
      if (options.signal?.aborted) { output.error(options.signal.reason); return; }
      output.enqueue(encoder.encode(`data: ${JSON.stringify(part)}\n\n`));
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}
