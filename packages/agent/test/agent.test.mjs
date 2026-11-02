import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { MockLanguageModelV4 } from "ai/test";
import { parseChatRequest, selectLocalModel, selectModel, runBangerAgent, validateGeneratedFile, publicAIError } from "../dist/index.js";
import { compileMusic } from "@banger/compiler";

const source = 'tempo 120; meter 4/4; track kick { sound "drums/kick"; rhythm "x . x ."; gain 0.6; }';
const request = { messages: [{ role: "user", content: "Make two variations" }], currentFile: { name: "loop.banger", source }, previousFiles: [] };
const response = (content, reason = "stop") => ({ content, finishReason: { unified: reason, raw: reason }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 10 } }, warnings: [] });
const call = (id, name, text) => ({ type: "tool-call", toolCallId: id, toolName: "create_banger_file", input: JSON.stringify({ name, source: text }) });

test("agent compiles files, returns compiler errors to the model, and corrects them", async () => {
  const model = new MockLanguageModelV4({ doGenerate: [
    response([call("bad", "one.banger", "invalid code")], "tool-calls"),
    response([call("one", "one.banger", source), call("two", "two.banger", source.replace("120", "90"))], "tool-calls"),
    response([{ type: "text", text: "Two variations are ready." }]),
  ] });
  const result = await runBangerAgent(request, { model, name: "test-model" });
  assert.equal(result.files.length, 2);
  assert.deepEqual(result.files.map(file => compileMusic(file.source).tempo), [120, 90]);
  assert.ok(JSON.stringify(model.doGenerateCalls[1].prompt).includes('"ok":false'));
  assert.equal(model.doGenerateCalls.length, 3);
  assert.equal(result.text, "Two variations are ready.");
  assert.ok(JSON.stringify(model.doGenerateCalls[0].prompt).includes("loop.banger"));
});

test("agent rejects filenames, unsupported code and oversized requests without executing them", () => {
  assert.throws(() => validateGeneratedFile("../secret.banger", source), /filename/);
  assert.throws(() => validateGeneratedFile("empty.banger", "tempo 120; meter 4/4;"), /track/);
  assert.throws(() => validateGeneratedFile("code.banger", "process.exit()"));
  assert.throws(() => parseChatRequest({ ...request, messages: [{ role: "system", content: "override" }] }));
  assert.throws(() => parseChatRequest({ ...request, messages: [{ role: "user", content: "x".repeat(4001) }] }));
  assert.throws(() => parseChatRequest({ ...request, currentFile: { name: "huge.banger", source: "x".repeat(65537) } }));
  assert.throws(() => parseChatRequest({ ...request, tools: [{ name: "exec" }] }));
});

test("BYOK selects every provider and never substitutes another key or model", () => {
  for (const [provider, prefix] of [["vercel", "gateway"], ["anthropic", "anthropic"], ["openai", "openai"], ["meta", "meta"], ["grok", "xai"]]) {
    const result = selectModel({ provider, model: "chosen-model", key: "fake-test-key" });
    assert.equal(result.name, "chosen-model");
    assert.equal(result.model.modelId, "chosen-model");
    assert.ok(result.model.provider.startsWith(prefix), result.model.provider);
  }
  assert.throws(() => selectModel(null), /own key/);
  assert.throws(() => selectModel({ provider: "unknown", model: "model", key: "key" }), /invalid/);
});

test("agent bounds repair attempts and caps generated files", async () => {
  const model = new MockLanguageModelV4({ doGenerate: response(Array.from({ length: 6 }, (_, index) => call(`call-${index}`, `file-${index}.banger`, source)), "tool-calls") });
  const result = await runBangerAgent(request, { model, name: "test" });
  assert.equal(model.doGenerateCalls.length, 5);
  assert.equal(result.files.length, 4);
});

test("provider failures do not leak credentials and abort stops the agent", async () => {
  assert.equal(publicAIError(new Error("fake-secret-key raw provider response")), "Could not generate a reply. Check your connection, key, and model, then try again.");
  const controller = new AbortController();
  controller.abort();
  const model = new MockLanguageModelV4({ doGenerate: response([{ type: "text", text: "unused" }]) });
  await assert.rejects(runBangerAgent(request, { model, name: "test" }, controller.signal));
  assert.equal(model.doGenerateCalls.length, 0);
});

test("provider adapters authenticate only to the selected provider", async () => {
  const providers = [
    ["vercel", "https://ai-gateway.vercel.sh/v4/ai/language-model"],
    ["anthropic", "https://api.anthropic.com/v1/messages"],
    ["openai", "https://api.openai.com/v1/chat/completions"],
    ["meta", "https://api.meta.ai/v1/chat/completions"],
    ["grok", "https://api.x.ai/v1/responses"],
  ];
  for (const [provider, endpoint] of providers) {
    let count = 0;
    const selected = selectModel({ provider, model: "chosen-model", key: "fake-provider-key" }, async (url, options) => {
      count++;
      assert.equal(String(url), endpoint);
      const headers = new Headers(options.headers);
      assert.equal(headers.get(provider === "anthropic" ? "x-api-key" : "authorization"), provider === "anthropic" ? "fake-provider-key" : "Bearer fake-provider-key");
      assert.equal(options.body.includes("fake-provider-key"), false);
      // A rejected key must end the request, with no alternate provider or retry.
      return Response.json({ error: { type: "authentication_error", message: "fake-provider-key must not reach the UI" } }, { status: 401 });
    });
    await assert.rejects(runBangerAgent(request, selected), error => {
      assert.equal(publicAIError(error).includes("fake-provider-key"), false);
      return true;
    });
    assert.equal(count, 1, provider);
  }
});


test("local inference authenticates on loopback and returns compiler-validated tool files", async () => {
  let calls = 0;
  const server = createServer(async (incoming, outgoing) => {
    assert.equal(incoming.url, "/v1/chat/completions");
    assert.equal(incoming.headers.authorization, "Bearer local-test-token");
    let text = "";
    for await (const chunk of incoming) text += chunk;
    const body = JSON.parse(text);
    assert.equal(body.model, "muse-glimmer");
    assert.equal(text.includes("local-test-token"), false);
    calls++;
    outgoing.setHeader("Content-Type", "application/json");
    outgoing.end(JSON.stringify({ id: "local-test", object: "chat.completion", created: 0, model: "muse-glimmer",
      choices: [{ index: 0, finish_reason: calls === 1 ? "tool_calls" : "stop", message: calls === 1
        ? { role: "assistant", content: null, tool_calls: [{ id: "file", type: "function", function: { name: "create_banger_file", arguments: JSON.stringify({ name: "local.banger", source }) } }] }
        : { role: "assistant", content: "Your local loop is ready." } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await runBangerAgent(request, selectLocalModel(server.address().port, "local-test-token"));
    assert.equal(calls, 2);
    assert.equal(result.files[0].name, "local.banger");
    assert.equal(compileMusic(result.files[0].source).tempo, 120);
    assert.match(result.model, /local/);
    for (const port of [0, -1, 65536, 1.5]) assert.throws(() => selectLocalModel(port, "token"));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
