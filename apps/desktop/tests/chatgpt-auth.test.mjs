/* global AbortController */
import { Buffer } from "node:buffer";
import { ReadableStream } from "node:stream/web";
import { URLSearchParams } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBangerAgent } from "@banger/agent";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { createChatGPTAuth, completedResponse, publicChatGPTError } from "../dist/chatgpt-auth.js";
import { verifyIdentity, authorize, ISSUER, TOKEN, RESOURCE, SCOPES } from "../dist/chatgpt-oauth.js";

const keys = await generateKeyPair("RS256");
const publicJwk = { ...await exportJWK(keys.publicKey), kid: "test" };
const verify = (token, client, nonce) => verifyIdentity(token, client, nonce, createLocalJWKSet({ keys: [publicJwk] }));
const signed = (claims, signingKey = keys.privateKey) => new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "test" })
  .setIssuer(ISSUER).setAudience("oaiapp_test1").setSubject("user-1").setIssuedAt().setExpirationTime("1h").sign(signingKey);
function cipher() {
  const key = randomBytes(32);
  return { isAvailable: () => true, encrypt(value) {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
    const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
  }, decrypt(bytes) {
    const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8");
  } };
}
function stream(events, fragmented = false) {
  const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(""));
  return new Response(new ReadableStream({ start(controller) {
    if (fragmented) for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); else controller.enqueue(bytes);
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "banger-chatgpt-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "accounts.enc"), encryption = cipher();
  const authorizations = [], calls = [];
  let subject = "user-1", issued = "oaiapp_test1", scopes = SCOPES, inference, revoke = true, refreshError;
  const options = { verify,
    async openExternal(value) {
      const url = new URL(value); authorizations.push(url);
      const callback = new URL(url.searchParams.get("redirect_uri"));
      callback.search = new URLSearchParams({ code: "single-use-code", state: url.searchParams.get("state"), client_id: issued });
      assert.equal((await fetch(callback)).status, 200);
    },
    async fetcher(input, init) {
      const url = String(input); calls.push({ url, init });
      if (url === TOKEN) {
        const form = new URLSearchParams(init.body);
        assert.equal(form.get("resource"), RESOURCE);
        if (form.get("grant_type") === "authorization_code") {
          const auth = authorizations.at(-1);
          assert.equal(form.get("redirect_uri"), auth.searchParams.get("redirect_uri"));
          assert.equal(createHash("sha256").update(form.get("code_verifier")).digest("base64url"), auth.searchParams.get("code_challenge"));
          const idToken = await new SignJWT({ nonce: auth.searchParams.get("nonce"), email: "same@example.test", name: "Musician" })
            .setProtectedHeader({ alg: "RS256", kid: "test" }).setIssuer(ISSUER).setAudience(issued).setSubject(subject).setIssuedAt().setExpirationTime("1h").sign(keys.privateKey);
          return Response.json({ access_token: "secret-access", refresh_token: "secret-refresh", id_token: idToken, token_type: "Bearer", expires_in: 3600, scope: scopes });
        }
        assert.equal(form.get("refresh_token"), "secret-refresh");
        if (refreshError) return Response.json({ error: refreshError }, { status: refreshError === "temporarily_unavailable" ? 503 : 400 });
        return Response.json({ access_token: "refreshed-access", refresh_token: "rotated-refresh", token_type: "Bearer", expires_in: 3600 });
      }
      if (url === `${RESOURCE}/models`) return Response.json({ models: [
        { slug: "hidden", display_name: "Hidden", visibility: "hidden" },
        { slug: "test-model", display_name: "Test model", visibility: "list" },
      ] });
      if (url === `${RESOURCE}/responses`) return inference ? inference(init) : stream([{ type: "response.completed", response: {
        id: "resp_1", status: "completed", created_at: 1, model: "test-model", output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Ready.", annotations: [] }] }],
        usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
      } }]);
      if (url === `${ISSUER}/.well-known/openid-configuration`) return Response.json({ revocation_endpoint: `${ISSUER}/revoke` });
      if (url === `${ISSUER}/revoke`) return new Response(null, { status: revoke ? 200 : 503 });
      throw new Error(`Unexpected URL ${url}`);
    },
  };
  const auth = createChatGPTAuth(path, encryption, options); t.after(() => auth.dispose());
  return { auth, path, encryption, options, authorizations, calls,
    configure(value) { ({ subject = subject, issued = issued, scopes = scopes, inference = inference, revoke = revoke, refreshError = refreshError } = value); },
    async saved() { return JSON.parse(encryption.decrypt(await readFile(path))); },
    async save(value) { await writeFile(path, encryption.encrypt(JSON.stringify(value))); },
  };
}

test("PKCE sign-in persists encrypted credentials, models and host, and supports separate registrations", async t => {
  const f = await fixture(t);
  assert.equal((await f.auth.status()).accounts.length, 0);
  const first = await f.auth.signIn();
  assert.equal(first.selected, true); assert.equal(first.accounts[0].sharing, true);
  assert.deepEqual(first.models, [{ id: "test-model", label: "Test model" }]);
  assert.equal(JSON.stringify(first).includes("secret-"), false);
  assert.equal((await readFile(f.path)).includes(Buffer.from("secret-")), false);
  const hostId = f.authorizations[0].searchParams.get("ext_agent_host_id");
  assert.match(hostId, /^urn:uuid:/);
  assert.equal(f.authorizations[0].searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(f.authorizations[0].searchParams.get("agent_name_hint"), "Banger");
  await f.auth.signIn(first.activeAccountId);
  assert.equal(f.authorizations[1].searchParams.get("client_id"), "oaiapp_test1");
  assert.equal(f.authorizations[1].searchParams.has("agent_name_hint"), false);
  assert.ok(f.authorizations[1].searchParams.get("id_token_hint"));
  assert.equal(f.authorizations[1].searchParams.get("ext_agent_host_id"), hostId);
  f.configure({ issued: "oaiapp_test2" });
  const second = await f.auth.signIn();
  assert.equal(second.accounts.length, 2); assert.notEqual(second.accounts[0].label, second.accounts[1].label);
  assert.equal(second.accounts[0].email, second.accounts[1].email);
  const reloaded = createChatGPTAuth(f.path, f.encryption, f.options);
  assert.deepEqual((await reloaded.status()).accounts, second.accounts);
  await f.auth.selectAccount(first.activeAccountId);
  assert.equal((await f.auth.status()).activeAccountId, first.activeAccountId);
});

test("valid identity without granted plan scope cannot perform inference", async t => {
  const f = await fixture(t); f.configure({ scopes: "openid profile email" });
  const result = await f.auth.signIn();
  assert.equal(result.selected, false); assert.equal(result.accounts[0].sharing, false);
  await assert.rejects(f.auth.select(true), /Allow Banger/);
  await assert.rejects(f.auth.model(), /Select ChatGPT/);
  assert.equal(f.calls.some(call => call.url.endsWith("/responses")), false);
  await f.auth.signIn(result.activeAccountId);
  assert.equal(f.authorizations.at(-1).searchParams.get("prompt"), "consent");
});

test("returning sign-in rejects a changed verified identity without overwriting saved credentials", async t => {
  const f = await fixture(t); const first = await f.auth.signIn(); const saved = await f.saved();
  f.configure({ subject: "another-user" });
  await assert.rejects(f.auth.signIn(first.activeAccountId), /different ChatGPT account/);
  assert.deepEqual(await f.saved(), saved);
});

test("refresh rotates once for concurrent consumers and inference streams to completion", async t => {
  const f = await fixture(t); await f.auth.signIn(); const saved = await f.saved();
  saved.accounts[0].tokens.expiresAt = 0; await f.save(saved);
  const [selected] = await Promise.all([f.auth.model(), f.auth.model()]);
  const refreshCalls = f.calls.filter(call => call.url === TOKEN && new URLSearchParams(call.init.body).get("grant_type") === "refresh_token");
  assert.equal(refreshCalls.length, 1);
  assert.equal((await f.saved()).accounts[0].tokens.refreshToken, "rotated-refresh");
  const result = await selected.model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }] });
  assert.equal(result.content.find(part => part.type === "text").text, "Ready.");
  const inference = f.calls.find(call => call.url.endsWith("/responses"));
  assert.equal(new Headers(inference.init.headers).get("Authorization"), "Bearer refreshed-access");
  assert.equal(JSON.parse(inference.init.body).store, false); assert.equal(JSON.parse(inference.init.body).stream, true);
});

test("model selection and account sign-out stop old models and retain registration without tokens", async t => {
  const f = await fixture(t); const signedIn = await f.auth.signIn(); const model = await f.auth.model();
  await assert.rejects(f.auth.selectModel("not-available"), /available ChatGPT model/);
  await f.auth.signOut();
  const saved = await f.saved();
  assert.equal(saved.accounts.length, 1); assert.equal(saved.accounts[0].tokens, undefined);
  assert.equal(saved.accounts[0].clientId, "oaiapp_test1"); assert.equal(saved.selected, false);
  const revokeCall = f.calls.find(call => call.url.endsWith("/revoke"));
  assert.equal(new URLSearchParams(revokeCall.init.body).get("token"), "secret-refresh");
  await assert.rejects(model.model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }] }), /changed/);
  await f.auth.signIn(signedIn.activeAccountId);
  assert.equal(f.authorizations.at(-1).searchParams.has("id_token_hint"), false);
});

test("failed revocation clears local tokens and reports that remote revocation is unconfirmed", async t => {
  const f = await fixture(t); await f.auth.signIn(); f.configure({ revoke: false });
  const result = await f.auth.signOut();
  assert.match(result.error, /not confirmed/); assert.equal((await f.saved()).accounts[0].tokens, undefined);
  assert.equal(f.calls.filter(call => call.url.endsWith("/revoke")).length, 2);
});

test("ID tokens reject bad signatures, audiences, expiry, issuer and nonce", async () => {
  const valid = await signed({ nonce: "expected" });
  assert.equal((await verify(valid, "oaiapp_test1", "expected")).subject, "user-1");
  await assert.rejects(verify(valid, "other-client", "expected"));
  await assert.rejects(verify(valid, "oaiapp_test1", "wrong"));
  const other = await generateKeyPair("RS256");
  await assert.rejects(verify(await signed({ nonce: "expected" }, other.privateKey), "oaiapp_test1", "expected"));
  for (const claims of [{ iss: "https://evil.example" }, { exp: 1 }]) {
    const token = await new SignJWT({ sub: "user", aud: "oaiapp_test1", iss: ISSUER, iat: 1, exp: Math.floor(Date.now() / 1000) + 600, ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "test" }).sign(keys.privateKey);
    await assert.rejects(verify(token, "oaiapp_test1"));
  }
});

test("callback rejects unrelated paths and Unicode state safely; cancellation stops listener", async () => {
  const controller = new AbortController(); let callback;
  const pending = authorize({ hostId: "urn:uuid:test", signal: controller.signal, async openExternal(value) {
    const url = new URL(value); callback = new URL(url.searchParams.get("redirect_uri"));
    const wrong = new URL(callback); wrong.pathname = "/other";
    assert.equal((await fetch(wrong)).status, 404);
    callback.search = new URLSearchParams({ state: "雪".repeat(url.searchParams.get("state").length), code: "bad", client_id: "oaiapp_wrong" });
    assert.equal((await fetch(callback)).status, 400);
    controller.abort();
  } });
  await assert.rejects(pending, /stopped or timed out/);
  await assert.rejects(fetch(callback));
});

test("callback denies consent and changed client IDs before token exchange", async () => {
  for (const extra of [{ error: "access_denied" }, { code: "x", client_id: "oaiapp_wrong" }]) {
    await assert.rejects(authorize({ hostId: "urn:uuid:test", account: { clientId: "oaiapp_test1", subject: "user-1" },
      signal: new AbortController().signal, fetcher() { assert.fail("Must not exchange unverified callbacks"); },
      async openExternal(value) {
        const url = new URL(value), callback = new URL(url.searchParams.get("redirect_uri"));
        callback.search = new URLSearchParams({ state: url.searchParams.get("state"), ...extra });
        assert.equal((await fetch(callback)).status, 400);
      },
    }), /declined or could not be verified/);
  }
});

test("encrypted storage unavailable fails before opening the browser and corrupt files remain intact", async t => {
  const f = await fixture(t);
  const locked = createChatGPTAuth(f.path, { ...f.encryption, isAvailable: () => false }, f.options);
  await assert.rejects(locked.signIn(), /Secure ChatGPT storage/);
  assert.equal(f.authorizations.length, 0);
  await writeFile(f.path, "corrupt");
  await assert.rejects(f.auth.signIn(), /Could not unlock/);
  assert.equal(await readFile(f.path, "utf8"), "corrupt");
});

test("response reader handles fragmented SSE and rejects failed, incomplete and interrupted streams", async () => {
  const expected = { id: "response", status: "completed", output: [] };
  assert.deepEqual(await completedResponse(stream([{ type: "response.completed", response: expected }], true)), expected);
  await assert.rejects(completedResponse(stream([{ type: "response.output_text.delta", delta: "unfinished" }])), /before completing/);
  await assert.rejects(completedResponse(stream([{ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } }])), /at its limit/);
  await assert.rejects(completedResponse(stream([{ type: "response.incomplete" }])), /did not complete/);
});


test("the real music agent completes a namespaced tool loop with stateless ChatGPT request history", async t => {
  const f = await fixture(t); await f.auth.signIn();
  let turn = 0;
  const source = 'tempo 110; meter 4/4; track kick { sound "drums/kick"; rhythm "x . . ."; gain .5; }';
  f.configure({ inference(init) {
    const body = JSON.parse(init.body);
    assert.equal(body.store, false); assert.equal(body.stream, true);
    for (const key of ["max_output_tokens", "temperature", "top_p", "previous_response_id"]) assert.equal(key in body, false);
    assert.ok(body.input.some(item => item.role === "developer"));
    assert.ok(body.input.every(item => item.role !== "system" && item.type !== "item_reference"));
    const namespace = body.tools.find(tool => tool.type === "namespace");
    assert.equal(namespace.name, "banger");
    assert.ok(namespace.tools.some(tool => tool.name === "create_banger_file"));
    turn++;
    if (turn === 1) return stream([{ type: "response.completed", response: { id: "resp_tool", status: "completed", created_at: 1,
      model: "test-model", output: [{ type: "function_call", id: "fc_1", call_id: "call_1", namespace: "banger", name: "create_banger_file",
        arguments: JSON.stringify({ name: "song.banger", source }), status: "completed" }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }]);
    assert.ok(body.input.some(item => item.type === "function_call" && item.namespace === "banger" && item.call_id === "call_1"));
    assert.ok(body.input.some(item => item.type === "function_call_output" && item.call_id === "call_1" && item.output.includes("Compiled successfully")));
    return stream([{ type: "response.completed", response: { id: "resp_text", status: "completed", created_at: 1, model: "test-model",
      output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Added a kick pattern.", annotations: [] }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }]);
  } });
  const result = await runBangerAgent({ currentFile: { name: "Untitled.banger", source: "" }, previousFiles: [], messages: [{ role: "user", content: "Make a simple beat." }] }, await f.auth.model());
  assert.equal(turn, 2); assert.equal(result.files.length, 1); assert.equal(result.files[0].name, "song.banger");
  assert.equal(result.text, "Added a kick pattern.");
});


test("invalid refresh grants clear credentials and cannot loop, while transient errors retain the session", async t => {
  for (const refreshError of ["invalid_grant", "refresh_token_reused", "temporarily_unavailable"]) {
    const f = await fixture(t); await f.auth.signIn(); const saved = await f.saved();
    saved.accounts[0].tokens.expiresAt = 0; await f.save(saved); f.configure({ refreshError });
    await assert.rejects(f.auth.model(), error => {
      assert.match(publicChatGPTError(error), refreshError !== "temporarily_unavailable" ? /revoked/ : /unavailable/); return true;
    });
    const after = await f.saved();
    assert.equal(Boolean(after.accounts[0].tokens), refreshError === "temporarily_unavailable");
    assert.equal(after.accounts[0].clientId, "oaiapp_test1");
    if (refreshError !== "temporarily_unavailable") {
      assert.equal(after.selected, false);
      await assert.rejects(f.auth.select(true), /Sign in/);
      assert.equal(f.calls.filter(call => call.url === TOKEN && new URLSearchParams(call.init.body).get("grant_type") === "refresh_token").length, 1);
    }
  }
});

test("real agent failures retain safe ChatGPT usage and session recovery messages", async t => {
  for (const response of [
    () => new Response("private provider diagnostic", { status: 429 }),
    () => stream([{ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } }]),
    () => new Response("private provider diagnostic", { status: 401 }),
  ]) {
    const f = await fixture(t); await f.auth.signIn(); f.configure({ inference: response });
    await assert.rejects(runBangerAgent({ currentFile: { name: "Untitled.banger", source: "" }, previousFiles: [],
      messages: [{ role: "user", content: "Make a beat." }] }, await f.auth.model()), error => {
      const message = publicChatGPTError(error);
      assert.match(message, /at its limit|revoked/);
      assert.equal(message.includes("BYOK"), false); assert.equal(message.includes("private provider"), false); return true;
    });
  }
  assert.equal(publicChatGPTError(new Error("secret-value")).includes("secret-value"), false);
});

test("ChatGPT reasoning persists per account and reaches subsequent Responses requests", async t => {
  const f = await fixture(t);
  await f.auth.signIn();
  const saved = await f.saved();
  saved.accounts[0].model = "gpt-6-astra";
  saved.accounts[0].models.push({ id: "gpt-6-astra", label: "GPT-6 Astra" });
  await f.save(saved);
  for (const level of [undefined, "low", "high", undefined]) {
    await f.auth.setReasoning(level);
    assert.equal((await f.saved()).accounts[0].reasoningLevel, level);
    assert.equal((await f.auth.status()).accounts[0].reasoningLevel, level);
    const selected = await f.auth.model();
    await selected.model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }], providerOptions: selected.providerOptions });
    const body = JSON.parse(f.calls.filter(call => call.url.endsWith("/responses")).at(-1).init.body);
    assert.equal(body.reasoning?.effort, level);
  }
  await f.auth.setReasoning("high");
  await f.auth.selectModel("test-model");
  assert.equal((await f.saved()).accounts[0].reasoningLevel, undefined);
  await assert.rejects(f.auth.setReasoning("high"), /supported reasoning/);
});
