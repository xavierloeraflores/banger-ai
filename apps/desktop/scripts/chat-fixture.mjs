// A deterministic Gateway response, used only by smoke tests. No paid calls.
export function chatFixture(body) {
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
