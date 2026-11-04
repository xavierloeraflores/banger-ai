"use client";

import { AIModelSelect } from "./ai-model-select";

import { useEffect, useRef, useState } from "react";
import { Button, IconButton, Panel } from "@banger/shadcn";
import type { BangerFile, ChatMessage, ChatReply } from "@banger/agent/protocol";
import { KeyHint, LLM_KEY_HINT, useGenerationAccess } from "./generation-access";
import { sendChat } from "@/lib/ai-chat";
import { saveProject } from "@/lib/project-files";
import { AI_PROVIDERS, aiSettingsBridge } from "@/lib/ai-providers";

import type { FullSend } from "@/lib/full-send";
import type { WorkspaceFile } from "@/lib/project-workspace";

type Turn = { prompt: string; reply: ChatReply; revision: number; project?: string; activity?: string[] };
type ProjectSnapshot = { source: string; revision: number; activeFile?: string };
type Props = { onFullSend:FullSend; onFullSendCheck(vocals:boolean):void; onLyrics(prompt:string,signal:AbortSignal):Promise<string>; vocalStudio:boolean; source: string; fileName: string; revision: number; fileBusy: boolean; onLoad(file: BangerFile, revision: number, automatic?:boolean): void;
  folderName: string; projectEpoch: number; activeFile?: string; projectDirty: boolean;
  onResolveEdits(action: "save" | "discard"): Promise<ProjectSnapshot>;
  onProjectBusy(busy: boolean): void; onProjectFile(file: WorkspaceFile, revision: number): void;
};
const suggestions = [
  "Make a beat",
  "Make a pop song with lyrics for the verses and chorus",
  "Make a rap song with lyrics for the verses and hook",
];

export function AIChat({ onFullSend, onFullSendCheck, onLyrics, vocalStudio, source, fileName, revision, fileBusy, onLoad, folderName, projectEpoch, activeFile, projectDirty, onResolveEdits, onProjectBusy, onProjectFile }: Props) {
  const [permissions, setPermissions] = useState({ beat: !vocalStudio, lyrics: vocalStudio });
  const [fullSend, setFullSend] = useState(false);
  const [progress, setProgress] = useState("");
  const { languageModel, vocals } = useGenerationAccess();
  const [desktop, setDesktop] = useState(false);
  const [activity, setActivity] = useState<string[]>([]);
  const activityRef = useRef<string[]>([]);
  const projectRequest = useRef(false);
  const resetProjectHistory = useRef(false);
  const projectMode = desktop && !!folderName;
  const editsDialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const [prompt, setPrompt] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [targetFile, setTargetFile] = useState<string | null>(null);
  const [connection, setConnection] = useState("Choose a provider in Settings → BYOK");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const request = useRef<AbortController | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const busy = pendingPrompt !== null;
  const latestFiles = new Map<string, BangerFile>();
  for (const turn of turns) for (const file of turn.reply.files) {
    latestFiles.delete(file.name);
    latestFiles.set(file.name, file);
  }
  const selectedTarget = targetFile && latestFiles.has(targetFile) ? targetFile : null;
  const availableFiles = [...latestFiles.values()].slice(-4);
  // An older card remains editable even after newer proposals fill the context window.
  if (selectedTarget && !availableFiles.some(file => file.name === selectedTarget)) {
    availableFiles.shift();
    availableFiles.push(latestFiles.get(selectedTarget)!);
  }

  useEffect(() => {
    queueMicrotask(() => {
      setDesktop(Boolean(window.bangerWorkspace));
    });
  }, [folderName, projectEpoch]);

  useEffect(() => window.bangerWorkspace?.onEvent(event => {
    if (!projectRequest.current) return;
    const text = event.type === "file-changed" ? `Saved ${event.file?.path}`
      : event.type === "tool-start" ? `${event.name}${event.path ? ` · ${event.path}` : ""}`
      : event.type === "tool-result" && !event.ok ? event.error : "";
    if (text) {
      activityRef.current = [...activityRef.current, text].slice(-80);
      setActivity(activityRef.current);
    }
  }), []);

  useEffect(() => {
    if (!busy || !projectMode) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy, projectMode]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void aiSettingsBridge().load().then(settings => {
        if (!active) return;
        const provider = AI_PROVIDERS.find(item => item.id === settings.activeProvider);
        setConnection(settings.chatgpt?.selected ? `ChatGPT · ${settings.chatgpt.accounts.find(account => account.id === settings.chatgpt?.activeAccountId)?.model ?? "Choose a model"}` : settings.localSelected ? "Muse Glimmer 30B · local" : provider ? `${provider.name} · ${settings.providers[provider.id]?.model || "Choose a model in Settings → BYOK"}` : "Choose a provider in Settings → BYOK");
      }).catch(() => { if (active) setConnection("AI settings unavailable"); });
    };
    refresh();
    window.addEventListener("banger:ai-settings-changed", refresh);
    return () => { active = false; window.removeEventListener("banger:ai-settings-changed", refresh); request.current?.abort(); };
  }, []);

  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: "instant" });
  }, [turns, pendingPrompt, error, open, activity]);

  async function send(action?: "save" | "discard") {
    const text = prompt.trim();
    if (!languageModel || !text || request.current || fileBusy) return;
    if(fullSend && (permissions.beat || permissions.lyrics)) {
      try { onFullSendCheck(permissions.lyrics); }
      catch(cause){setError(cause instanceof Error?cause.message:"Full Send is unavailable.");return;}
    }
    if (permissions.beat && projectMode && projectDirty && !action) {
      setError(null);
      editsDialog.current?.showModal();
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setPendingPrompt(text);
    setError(null);
    setNotice("");
    setProgress("");
    const snapshotRevision = revision;
    if(permissions.lyrics && !permissions.beat) {
      try {
        let answer=await onLyrics(text,controller.signal);
        if(fullSend)answer += `\n\n${await onFullSend({file:{name:fileName,source},vocals:true},controller.signal,setProgress)}`;
        setTurns(previous=>[...previous,{prompt:text,revision:snapshotRevision,reply:{text:answer,files:[],model:connection}}]);setPrompt("");
      }catch(cause){if(controller.signal.aborted)setNotice("Generation stopped. Completed saves are kept. Submitted music requests may finish in Vocal Studio.");else setError(cause instanceof Error?cause.message:"Could not save lyrics.");}
      finally{request.current=null;setPendingPrompt(null);}
      return;
    }
    if (projectMode && window.bangerWorkspace) {
      const bridge = window.bangerWorkspace;
      projectRequest.current = true;
      activityRef.current = [];
      setActivity([]);
      onProjectBusy(true);
      try {
        const snapshot = action ? await onResolveEdits(action) : { source, revision, activeFile };
        editsDialog.current?.close();
        const result = await bridge.run(text, snapshot.activeFile, resetProjectHistory.current, permissions);
        resetProjectHistory.current = false;
        setTurns(previous => [...previous, { prompt: text, revision: snapshotRevision, project: folderName,
          reply: { text: result.ok ? result.reply.text : result.error, files: [], model: connection }, activity: activityRef.current }]);
        setPrompt("");
        let completedFile:BangerFile={name:fileName,source:snapshot.source};
        // Cancelled tasks can still have saved files. Refresh only an unchanged studio.
        if (permissions.beat && snapshot.activeFile) {
          const saved = await bridge.read(snapshot.activeFile);
          completedFile={name:fileName,source:saved.source};
          if (saved.source !== snapshot.source) onProjectFile(saved, snapshot.revision);
        }
        projectRequest.current = false;
        if(fullSend && (permissions.beat || permissions.lyrics)) {
          controller.signal.throwIfAborted();
          if(!result.ok || result.reply.status !== "completed")throw new Error("Full Send stopped because the project task did not complete. Review its saved changes before retrying.");
          if(result.reply.changedPaths?.some(path=>path.endsWith(".banger")&&path!==snapshot.activeFile))throw new Error("The agent edited another song. Open that song before running Full Send so its beat and lyrics stay together.");
          if(!snapshot.activeFile)throw new Error("Open the song you want to send, then run Full Send.");
          setNotice(await onFullSend({file:completedFile,vocals:permissions.lyrics},controller.signal,setProgress));
        }
      } catch (cause) {
        if(controller.signal.aborted)setNotice("Generation stopped. Completed saves are kept. Submitted music requests may finish in Vocal Studio.");
        else setError(cause instanceof Error ? cause.message : "Could not run the project task.");
      } finally {
        projectRequest.current = false;
        request.current = null;
        setPendingPrompt(null);
        onProjectBusy(false);
        if (dialog.current?.open) input.current?.focus();
      }
      return;
    }
    const recent = turns.slice(-5);
    const messages: ChatMessage[] = recent.flatMap(turn => [
      { role: "user", content: turn.prompt },
      { role: "assistant", content: turn.reply.text.slice(0, 4000) },
    ]);
    const previousFiles = availableFiles;
    try {
      const reply = await sendChat({ permissions, messages: [...messages, { role: "user", content: text }], currentFile: { name: fileName, source }, previousFiles, targetFile: selectedTarget ?? fileName, targetVersion: selectedTarget ? "generated" : "editor" }, controller.signal);
      if(fullSend && reply.files.length>1){
        setTurns(previous=>[...previous,{prompt:text,reply,revision:snapshotRevision}]);
        throw new Error("Full Send needs one song. Your proposals are kept; ask the agent to edit a single song.");
      }
      if(permissions.lyrics && reply.lyricPrompt)reply.text += `\n\n${await onLyrics(`${reply.lyricPrompt}\nOriginal user request; preserve these edit restrictions:\n${text}`,controller.signal)}`;
      if (request.current !== controller) return;
      setTurns(previous => [...previous, { prompt: text, reply, revision: snapshotRevision }]);
      setPrompt("");
      if (reply.files.length) setTargetFile(reply.files[0]!.name);
      if(fullSend && (permissions.beat || permissions.lyrics)) {
        const file=reply.files[0] ?? (selectedTarget ? latestFiles.get(selectedTarget)! : {name:fileName,source});
        setNotice(await onFullSend({file,vocals:permissions.lyrics},controller.signal,setProgress));
        if(permissions.beat && reply.files.length)onLoad(file,snapshotRevision,true);
      }
    } catch (cause) {
      if (controller.signal.aborted) setNotice("Generation stopped. Completed saves are kept. Submitted music requests may finish in Vocal Studio.");
      else setError(cause instanceof Error ? cause.message : "Could not generate a reply. Try again.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPendingPrompt(null);
        if (dialog.current?.open) input.current?.focus();
      }
    }
  }

  function stop() {
    request.current?.abort();
    if (projectRequest.current) {
      void window.bangerWorkspace?.cancel().catch(cause => setError(cause instanceof Error ? cause.message : "Could not stop the project task."));
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

  return <>
    <KeyHint reason={!languageModel ? LLM_KEY_HINT : undefined} className="ai-chat-launcher-hint"><IconButton disabled={!languageModel} ref={launcher} className="ai-chat-launcher" variant="primary" aria-label="Open AI chat"
      aria-haspopup="dialog" aria-expanded={open} aria-controls="ai-chat-dialog"
      onClick={() => { dialog.current?.showModal(); setOpen(true); if (!busy) input.current?.focus(); }}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 3V11.5A8.5 8.5 0 0 1 9.5 3h3a8.5 8.5 0 0 1 8.5 8.5Z" transform="translate(1 -1) scale(.95)" />
        <path d="M7 10h8M7 14h5" />
      </svg>
    </IconButton></KeyHint>
    <dialog ref={dialog} id="ai-chat-dialog" className="ai-chat-dialog" aria-labelledby="ai-chat-title"
      onClose={() => { setOpen(false); launcher.current?.focus(); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.current?.close();
      }}>
    <Panel className="producer-ai" aria-labelledby="ai-chat-title">
    <div className="producer-panel-heading">
      <div><p className="producer-eyebrow">Create with AI</p><h2 id="ai-chat-title">Banger AI</h2></div>
      <div className="ai-chat-heading-actions"><span className="producer-tag">{connection}</span>
        <Button variant="ghost" disabled={busy || !turns.length} onClick={() => { resetProjectHistory.current = true; setActivity([]); setTurns([]); setTargetFile(null); setPrompt(""); setError(null); setNotice(""); }}>New chat</Button>
        <IconButton className="ai-chat-close" variant="ghost" aria-label="Close AI chat" onClick={() => dialog.current?.close()}>×</IconButton>
      </div>
    </div>
    <AIModelSelect id="chat-ai" reasoningOnly />
    <div ref={transcript} className="ai-chat-transcript" role="log" aria-label="AI conversation" aria-live="polite" aria-relevant="additions">
      {!turns.length && !busy && <div className="ai-chat-empty">
        <p>{projectMode ? `Edit songs across ${folderName}. Describe the changes you want, and the agent will compile and save them to your project folder.` : "Create a song or reshape the current one. Preview the files, then load one into the studio or save it."}</p>
        <div className="ai-chat-suggestions">{suggestions.map(text => <Button key={text} variant="ghost" onClick={() => { setPrompt(text); input.current?.focus(); }}>{text}</Button>)}</div>
      </div>}
      {turns.map((turn, index) => <div className="ai-chat-turn" key={index}>
        <p className="ai-chat-user"><span className="producer-sr-only">You: </span>{turn.prompt}</p>
        {turn.project && <p className="ai-chat-model">Project · {turn.project}</p>}
        <p className="ai-chat-answer"><span className="producer-sr-only">Banger: </span>{turn.reply.text}</p>
        <div className="ai-chat-files">{turn.reply.files.map(file => <article className="ai-chat-file" key={file.name}>
          <div className="ai-chat-file-heading"><strong>{file.name}</strong><span>{file.operation === "edit" ? "Revision compiled" : "Compiled"}</span></div>
          <details><summary>Preview source</summary><pre>{file.source}</pre></details>
          <div className="ai-chat-file-actions">
            <Button variant="primary" disabled={busy || fileBusy || saving} onClick={() => onLoad(file, turn.revision)}>Load in studio</Button>
            <Button disabled={busy} onClick={() => { setTargetFile(file.name); input.current?.focus(); }}>Edit this file</Button>
            <Button disabled={fileBusy || saving} onClick={() => void save(file)}>Save file</Button>
          </div>
        </article>)}</div>
        {!!turn.activity?.length && <details className="ai-chat-activity"><summary>Project activity</summary><ol>{turn.activity.map((item, index) => <li key={index}>{item}</li>)}</ol></details>}
        <p className="ai-chat-model">{turn.reply.model}</p>
      </div>)}
      {busy && <div className="ai-chat-turn"><p className="ai-chat-user">{pendingPrompt}</p><p className="ai-chat-working" role="status">{progress || (!permissions.beat && !permissions.lyrics ? "Thinking…" : projectMode ? "Working on your project…" : "Composing and checking your files…")}</p>{projectMode && <ol className="ai-chat-activity" aria-label="Project agent activity">{activity.map((item, index) => <li key={index}>{item}</li>)}</ol>}</div>}
    </div>
    {permissions.beat && (projectMode ? <p className="ai-chat-scope-note">Changes save directly to {folderName}. {activeFile ? `Current song: ${activeFile}.` : "You can work on any song in this folder."}</p> : <label className="ai-chat-target">Editing
      <select aria-label="File to edit" value={selectedTarget ?? ""} disabled={busy} onChange={event => setTargetFile(event.target.value || null)}>
        <option value="">{fileName} · current editor</option>
        {availableFiles.map(file => <option key={file.name} value={file.name}>{file.name} · latest proposal</option>)}
      </select>
    </label>)}
    <fieldset className="ai-chat-permissions" disabled={busy}>
      <legend className="producer-sr-only">Allow AI edits</legend>
      <label><input type="checkbox" checked={permissions.beat} onChange={event => setPermissions(previous => ({ ...previous, beat: event.target.checked }))} />Edit beat</label>
      <label><input type="checkbox" checked={permissions.lyrics} onChange={event => setPermissions(previous => ({ ...previous, lyrics: event.target.checked }))} />Edit lyrics</label>
      <label><input type="checkbox" checked={fullSend} onChange={event=>setFullSend(event.target.checked)} />Full Send</label>
      {fullSend && (permissions.beat || permissions.lyrics) && <span>{permissions.lyrics?"Generate vocals with ElevenLabs and add the song to your library.":"Render a WAV and add it to your library."}</span>}
      {!permissions.beat && !permissions.lyrics && <span>Reply only. No files will be edited.</span>}
    </fieldset>
    <form className="ai-chat-compose" onSubmit={event => { event.preventDefault(); void send(); }}>
      <label className="producer-sr-only" htmlFor="ai-chat-prompt">Message Banger AI</label>
      <textarea id="ai-chat-prompt" ref={input} rows={2} maxLength={permissions.lyrics && !permissions.beat ? 4000 : projectMode ? 16000 : 4000} value={prompt} disabled={busy}
        placeholder={!permissions.beat && !permissions.lyrics ? "Ask about your song or project…" : permissions.lyrics && !permissions.beat?"Write lyrics, or describe changes to this song’s lyrics…":projectMode ? "Add a bass part to verse.banger, then soften the drums in chorus.banger…" : "Describe a song, a loop, or a change to this project…"} onChange={event => setPrompt(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
      {busy ? <Button variant="secondary" onClick={stop}>{projectMode ? "Stop task" : "Stop generating"}</Button>
        : <KeyHint reason={!languageModel ? LLM_KEY_HINT : undefined}><Button variant="primary" type="submit" disabled={!languageModel || !prompt.trim() || fileBusy || (fullSend && permissions.lyrics && !vocals)}>Send</Button></KeyHint>}
    </form>
    <div className="ai-chat-footer">
      {fullSend && permissions.lyrics && !vocals && <p>Add an ElevenLabs API key in Settings to use Full Send with lyrics.</p>}
      {error && <p className="has-error" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </div>
    </Panel>
    </dialog>
    <dialog ref={editsDialog} className="producer-project-dialog ai-chat-edits-dialog" aria-labelledby="ai-chat-edits-title" aria-describedby="ai-chat-edits-description"
      onCancel={event => { if (busy) event.preventDefault(); }}
      onClose={() => input.current?.focus()}>
      <h2 id="ai-chat-edits-title">Unsaved changes</h2>
      <p id="ai-chat-edits-description">Save your edits to {fileName}, or discard them before starting the AI task.</p>
      {error && <p className="has-error" role="alert">{error}</p>}
      <div className="ai-chat-edits-actions">
        <Button disabled={busy} onClick={() => editsDialog.current?.close()}>Cancel</Button>
        <Button disabled={busy} onClick={() => void send("discard")}>Discard and start</Button>
        <Button variant="primary" disabled={busy} onClick={() => void send("save")}>Save and start</Button>
      </div>
    </dialog>
  </>;
}
