"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Panel } from "@banger/shadcn";
import type { BangerFile, ChatMessage, ChatReply } from "@banger/agent/protocol";
import { sendChat } from "@/lib/ai-chat";
import { saveProject } from "@/lib/project-files";
import { AI_PROVIDERS, aiSettingsBridge } from "@/lib/ai-providers";

type Turn = { prompt: string; reply: ChatReply; revision: number };
type Props = { source: string; fileName: string; revision: number; fileBusy: boolean; onLoad(file: BangerFile, revision: number): void };
const suggestions = ["Make a warm lo-fi beat at 85 BPM", "Create three different house loops", "Add a melody to this project"];

export function AIChat({ source, fileName, revision, fileBusy, onLoad }: Props) {
  const [prompt, setPrompt] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [local, setLocal] = useState(false);
  const [connection, setConnection] = useState("Choose a provider in BYOK");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const request = useRef<AbortController | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const busy = pendingPrompt !== null;

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void aiSettingsBridge().load().then(settings => {
        if (!active) return;
        const provider = AI_PROVIDERS.find(item => item.id === settings.activeProvider);
        setLocal(Boolean(settings.localSelected));
        setConnection(settings.localSelected ? "Muse Glimmer 30B · local" : provider ? `${provider.name} · your key` : "Choose a provider in BYOK");
      }).catch(() => { if (active) setConnection("AI settings unavailable"); });
    };
    refresh();
    window.addEventListener("banger:ai-settings-changed", refresh);
    return () => { active = false; window.removeEventListener("banger:ai-settings-changed", refresh); request.current?.abort(); };
  }, []);

  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: "instant" });
  }, [turns, pendingPrompt, error]);

  async function send() {
    const text = prompt.trim();
    if (!text || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPendingPrompt(text);
    setError(null);
    setNotice("");
    const snapshotRevision = revision;
    const recent = turns.slice(-5);
    const messages: ChatMessage[] = recent.flatMap(turn => [
      { role: "user", content: turn.prompt },
      { role: "assistant", content: turn.reply.text.slice(0, 4000) },
    ]);
    const previousFiles = recent.flatMap(turn => turn.reply.files).slice(-4);
    try {
      const reply = await sendChat({ messages: [...messages, { role: "user", content: text }], currentFile: { name: fileName, source }, previousFiles }, controller.signal);
      if (request.current !== controller) return;
      setTurns(previous => [...previous, { prompt: text, reply, revision: snapshotRevision }]);
      setPrompt("");
    } catch (cause) {
      if (controller.signal.aborted) setNotice("Generation stopped. Your project is unchanged.");
      else setError(cause instanceof Error ? cause.message : "Could not generate a reply. Try again.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPendingPrompt(null);
        input.current?.focus();
      }
    }
  }

  async function save(file: BangerFile) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await saveProject(file.source, file.name);
      if (result) setNotice(`Saved ${result.name}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the file."); }
    finally { savingRef.current = false; setSaving(false); }
  }

  return <Panel className="producer-ai" aria-labelledby="ai-chat-title">
    <div className="producer-panel-heading">
      <div><p className="producer-eyebrow">Create with AI</p><h2 id="ai-chat-title">Describe your next banger</h2></div>
      <div className="ai-chat-heading-actions"><span className="producer-tag">{connection}</span>
        <Button variant="ghost" disabled={busy || !turns.length} onClick={() => { setTurns([]); setPrompt(""); setError(null); setNotice(""); }}>New chat</Button>
      </div>
    </div>
    <div ref={transcript} className="ai-chat-transcript" role="log" aria-label="AI conversation" aria-live="polite" aria-relevant="additions">
      {!turns.length && !busy && <div className="ai-chat-empty">
        <p>Make a new loop, revise this project, or ask for a few variations. Preview the files, then load one into the studio or save it.</p>
        <div className="ai-chat-suggestions">{suggestions.map(text => <Button key={text} variant="ghost" onClick={() => { setPrompt(text); input.current?.focus(); }}>{text}</Button>)}</div>
      </div>}
      {turns.map((turn, index) => <div className="ai-chat-turn" key={index}>
        <p className="ai-chat-user"><span className="producer-sr-only">You: </span>{turn.prompt}</p>
        <p className="ai-chat-answer"><span className="producer-sr-only">Banger: </span>{turn.reply.text}</p>
        <div className="ai-chat-files">{turn.reply.files.map(file => <article className="ai-chat-file" key={file.name}>
          <div className="ai-chat-file-heading"><strong>{file.name}</strong><span>Compiled</span></div>
          <details><summary>Preview source</summary><pre>{file.source}</pre></details>
          <div className="ai-chat-file-actions">
            <Button variant="primary" disabled={fileBusy || saving} onClick={() => onLoad(file, turn.revision)}>Load in studio</Button>
            <Button disabled={fileBusy || saving} onClick={() => void save(file)}>Save file</Button>
          </div>
        </article>)}</div>
        <p className="ai-chat-model">{turn.reply.model}</p>
      </div>)}
      {busy && <div className="ai-chat-turn"><p className="ai-chat-user">{pendingPrompt}</p><p className="ai-chat-working" role="status">Composing and checking your files…</p></div>}
    </div>
    <form className="ai-chat-compose" onSubmit={event => { event.preventDefault(); void send(); }}>
      <label className="producer-sr-only" htmlFor="ai-chat-prompt">Message Banger AI</label>
      <textarea id="ai-chat-prompt" ref={input} rows={2} maxLength={4000} value={prompt} disabled={busy}
        placeholder="A syncopated bass line with tight drums, 124 BPM…" onChange={event => setPrompt(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
      {busy ? <Button variant="secondary" onClick={() => request.current?.abort()}>Stop generating</Button>
        : <Button variant="primary" type="submit" disabled={!prompt.trim() || fileBusy}>Send</Button>}
    </form>
    <div className="ai-chat-footer">
      <p>{local ? "Your current source and recent chat stay on this computer. Muse Glimmer generates files locally." : "Your current source and recent chat are sent to the selected AI provider. Choose a local model or your own key in BYOK."}</p>
      {error && <p className="has-error" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </div>
  </Panel>;
}
