"use client";

import { AIModelSelect } from "./ai-model-select";
import { ChatActivity } from "./chat-activity";
import { AgentResponse } from "./agent-response";

import { useEffect, useRef, useState } from "react";
import { Button, IconButton, Panel, Modal, Select, Checkbox, Textarea, type ModalHandle } from "@banger/shadcn";
import { canEditSong, type EditPermissions, type BangerFile, type ChatMessage, type ChatEvent, type ChatReply } from "@banger/agent/protocol";
import { KeyHint, LLM_KEY_HINT, useGenerationAccess } from "./generation-access";
import { sendChat } from "@/lib/ai-chat";
import { saveProject } from "@/lib/project-files";
import { AI_PROVIDERS, aiSettingsBridge } from "@/lib/ai-providers";

import type { FullSend } from "@/lib/full-send";
import type { ChatHistory, ChatTurn as Turn, ProjectChat } from "@/lib/chat-sessions";
import type { WorkspaceFile } from "@/lib/project-workspace";

type ProjectSnapshot = { source: string; revision: number; activeFile?: string };
type Props = { chatId: string; projectId?: string; active: boolean; initialHistory?: ChatHistory;
  onClose(): void; onUpdate(id: string, update: Partial<ProjectChat>): void; onFullSend:FullSend; onFullSendCheck(vocals:boolean):void; onLyrics(prompt:string,signal:AbortSignal):Promise<string>; vocalStudio:boolean; source: string; fileName: string; revision: number; fileBusy: boolean; onLoad(file: BangerFile, revision: number, automatic?:boolean): void;
  folderName: string; projectPaths?: string[]; projectEpoch: number; activeFile?: string; projectDirty: boolean;
  onResolveEdits(action: "save" | "discard"): Promise<ProjectSnapshot>;
  onProjectComplete(): void; onProjectFile(file: WorkspaceFile, revision: number): void;
};
const suggestions = [
  "Make a beat",
  "Make a pop song with lyrics for the verses and chorus",
  "Make a rap song with lyrics for the verses and hook",
];

export function AIChat({ chatId, projectId, active, initialHistory, onClose, onUpdate, onFullSend, onFullSendCheck, onLyrics, vocalStudio, source, fileName, revision, fileBusy, onLoad, folderName, projectPaths, projectEpoch, activeFile, projectDirty, onResolveEdits, onProjectComplete, onProjectFile }: Props) {
  const [permissions, setPermissions] = useState<EditPermissions>(initialHistory?.permissions ?? { beat: !vocalStudio, lyrics: vocalStudio });
  const [listedSongs, setListedSongs] = useState(projectPaths ?? []);
  const [songsError, setSongsError] = useState("");
  const [fullSend, setFullSend] = useState(initialHistory?.fullSend ?? false);

  const { languageModel, vocals } = useGenerationAccess();
  const [desktop, setDesktop] = useState(false);
  const [pendingTurn, setPendingTurn] = useState<Turn | null>(null);
  const liveTurn = useRef<Turn | null>(null);
  const mounted = useRef(true);
  const receiveEvent = useRef<(event: ChatEvent) => void>(() => {});
  const projectRequest = useRef(false);
  const resetProjectHistory = useRef(false);
  const projectMode = desktop && !!folderName;
  const editsDialog = useRef<ModalHandle>(null);
  const [prompt, setPrompt] = useState(initialHistory?.prompt ?? "");
  const [turns, setTurns] = useState<Turn[]>(initialHistory?.turns ?? []);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialHistory?.error ?? null);
  const [notice, setNotice] = useState("");
  const [editedSongPaths, setEditedSongPaths] = useState<string[]>(initialHistory?.editedSongPaths ?? []);
  const [targetFile, setTargetFile] = useState<string | null>(initialHistory?.targetFile ?? null);
  const [connection, setConnection] = useState("Choose a provider in Settings → BYOK");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const request = useRef<AbortController | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const busy = pendingPrompt !== null;
  const followTranscript = useRef(true);
  useEffect(() => {
    const field = input.current;
    if (!field || !active) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 180)}px`;
  }, [prompt, active]);
  useEffect(() => {
    onUpdate(chatId, {
      history: { prompt, turns: pendingTurn ? [...turns, pendingTurn] : turns, targetFile, permissions, fullSend, error, editedSongPaths },
      title: (turns[0]?.prompt ?? pendingPrompt ?? "New chat").slice(0, 70),
      status: busy ? "running" : error ? "error" : turns.length ? "done" : "idle",
      blocksSwitch: busy && (fullSend || (permissions.lyrics && !projectMode)),
    });
  }, [chatId, onUpdate, prompt, turns, targetFile, permissions, fullSend, pendingPrompt, busy, error, projectMode, editedSongPaths, pendingTurn]);
  useEffect(() => {
    if (active) input.current?.focus();
    else editsDialog.current?.close();
  }, [active]);
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
    if (!active || !projectMode) return;
    let cancelled = false;
    void window.bangerWorkspace?.list().then(paths => {
      if (!cancelled) { setListedSongs(paths); setSongsError(""); }
    }).catch(() => { if (!cancelled) setSongsError("Could not refresh the song list. Reopen the chat to try again."); });
    return () => { cancelled = true; };
  }, [active, projectMode, projectEpoch, busy]);

  useEffect(() => {
    queueMicrotask(() => {
      setDesktop(Boolean(window.bangerWorkspace));
    });
  }, [folderName, projectEpoch]);

  useEffect(() => window.bangerWorkspace?.onEvent(event => {
    if (!projectRequest.current || !event.requestId || event.requestId !== liveTurn.current?.run?.requestId || (event.projectId && event.projectId !== projectId) || (event.threadId && event.threadId !== chatId)) return;
    if (event.type === "file-changed" && event.file?.path) {
      const path = event.file.path;
      if (path.endsWith(".banger")) setListedSongs(previous => previous.includes(path) ? previous : [...previous, path]);
      setEditedSongPaths(previous => previous.includes(path) ? previous : [...previous, path]);
    }
    const messages: Record<string, string> = {
      list_files: "Listing project files", read_file: "Reading file", list_lyrics: "Listing lyrics", read_lyrics: "Reading lyrics",
      write_file: "Validating and saving file", edit_file: "Validating and saving edits", validate_project: "Validating project",
      write_draft: "Validating and saving lyric draft", write_lyrics: "Validating and saving lyrics", edit_lyrics: "Validating and saving lyric edits",
    };
    if (event.type === "activity" && event.message && event.at !== undefined) receiveEvent.current({ type: "activity", requestId: event.requestId!, message: event.message, at: event.at });
    if (event.type === "text-delta" && event.text) receiveEvent.current({ type: "text-delta", requestId: event.requestId!, text: event.text });
    if (event.type === "text-reset") receiveEvent.current({ type: "text-reset", requestId: event.requestId! });
    const text = event.type === "file-changed" ? `Saved ${event.file?.path}`
      : event.type === "tool-start" ? `${messages[event.name ?? ""] ?? "Running project operation"}${event.path ? ` · ${event.path}` : ""}`
      : event.type === "tool-result" && !event.ok ? "Project operation failed. A correction is needed" : "";
    if (text) receiveEvent.current({ type: "activity", requestId: event.requestId!, message: text, at: Date.now() });
  }), [chatId, projectId]);

  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy, projectMode]);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    const refresh = () => {
      void aiSettingsBridge().load().then(settings => {
        if (!active) return;
        const provider = AI_PROVIDERS.find(item => item.id === settings.activeProvider);
        setConnection(settings.chatgpt?.selected ? `ChatGPT · ${settings.chatgpt.accounts.find(account => account.id === settings.chatgpt?.activeAccountId)?.model ?? "Choose a model"}` : settings.localSelected ? "Muse Glimmer 30B · local" : provider ? `${provider.name} · ${settings.providers[provider.id]?.model || "Choose a model in Settings → BYOK"}` : "Choose a provider in Settings → BYOK");
      }).catch(() => { if (active) setConnection("AI settings unavailable"); });
    };
    refresh();
    window.addEventListener("banger:ai-settings-changed", refresh);
    return () => { active = false; mounted.current = false; window.removeEventListener("banger:ai-settings-changed", refresh); request.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!followTranscript.current) return;
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: "instant" });
  }, [turns, pendingPrompt, error, active, pendingTurn]);

  const recordSongs = [...new Set(projectMode
    ? [...listedSongs, ...(activeFile ? [activeFile] : []), ...(permissions.songs ?? [])]
    : [fileName, ...availableFiles.map(file => file.name)])].filter(path => path.endsWith(".banger"));
  const selectedSongs = recordSongs.filter(path => canEditSong(permissions, path));
  function selectSong(path: string, checked: boolean) {
    setPermissions(previous => ({ ...previous, songs: checked ? [...new Set([...selectedSongs, path])] : selectedSongs.filter(song => song !== path) }));
  }

  async function send(action?: "save" | "discard") {
    const text = prompt.trim();
    const requestPermissions = { ...permissions, lyrics: permissions.lyrics && (projectMode || canEditSong(permissions, fileName)) };
    if (fullSend && (permissions.beat || permissions.lyrics) && !canEditSong(permissions, projectMode ? activeFile ?? fileName : selectedTarget ?? fileName)) {
      setError("Select the current song in Record controls before using Produce and Add to Library.");
      return;
    }
    if (!languageModel || !text || request.current || fileBusy) return;
    if(fullSend && (requestPermissions.beat || requestPermissions.lyrics)) {
      try { onFullSendCheck(requestPermissions.lyrics); }
      catch(cause){setError(cause instanceof Error?cause.message:"Produce and Add to Library is unavailable.");return;}
    }
    if (requestPermissions.beat && projectMode && projectDirty && !action) {
      setError(null);
      editsDialog.current?.showModal();
      return;
    }
    followTranscript.current = true;
    const controller = new AbortController();
    request.current = controller;
    setPendingPrompt(text);
    setError(null);
    setNotice("");
    const requestId = crypto.randomUUID();
    liveTurn.current = { prompt: text, revision, ...(projectMode ? { project: folderName } : {}), reply: { text: "", files: [], model: connection },
      // eslint-disable-next-line react-hooks/purity -- send runs only from submit and click handlers.
      run: { requestId, startedAt: Date.now(), status: "running", activity: [] } };
    setPendingTurn(liveTurn.current);
    const emit = (event: ChatEvent) => {
      const turn = liveTurn.current;
      if (!mounted.current || request.current !== controller || !turn?.run || turn.run.requestId !== event.requestId) return;
      if (event.type !== "activity" && controller.signal.aborted) return;
      liveTurn.current = event.type === "activity"
        ? { ...turn, run: { ...turn.run, activity: [...turn.run.activity, { message: event.message, at: event.at }].slice(-160) } }
        : { ...turn, reply: { ...turn.reply, text: event.type === "text-reset" ? "" : (turn.reply.text + event.text).slice(0, 5000) } };
      setPendingTurn(liveTurn.current);
    };
    receiveEvent.current = emit;
    const setProgress = (message: string) => emit({ type: "activity", requestId, message, at: Date.now() });
    let completedReply: ChatReply | undefined;
    let failure: string | undefined;
    const finish = () => {
      if (request.current !== controller) return;
      const turn = liveTurn.current;
      if (mounted.current && turn?.run) {
        const status = controller.signal.aborted ? "stopped" : failure ? "failed" : "completed";
        const reply = completedReply ?? { ...turn.reply, text: turn.reply.text || (status === "stopped" ? "Generation stopped. Completed saves are kept." : failure ?? "The task finished.") };
        setTurns(previous => [...previous, { ...turn, reply, run: { ...turn.run!, status, endedAt: Date.now() } }]);
        setPendingTurn(null);
        setPendingPrompt(null);
        if (status === "completed") setPrompt("");
        input.current?.focus();
      }
      liveTurn.current = null;
      request.current = null;
    };
    const failed = (cause: unknown) => {
      failure = cause instanceof Error ? cause.message : "Could not complete the request. Try again.";
      if (!mounted.current) return;
      if (controller.signal.aborted) setNotice("Generation stopped. Completed saves are kept. Submitted music requests may finish in Vocal Studio.");
      else { setProgress(`Request failed: ${failure}`); setError(failure); }
    };
    const snapshotRevision = revision;
    const songPath = selectedTarget ?? activeFile ?? fileName;
    setEditedSongPaths(previous => previous.includes(songPath) ? previous : [...previous, songPath]);
    if(requestPermissions.lyrics && !requestPermissions.beat && !projectMode) {
      try {
        setProgress("Generating and saving lyrics");
        let answer = await onLyrics(text, controller.signal);
        if(fullSend) answer += `\n\n${await onFullSend({file:{name:fileName,source},vocals:true},controller.signal,setProgress)}`;
        controller.signal.throwIfAborted();
        completedReply = { text: answer, files: [], model: connection };
      } catch(cause) { failed(cause); }
      finally { finish(); }
      return;
    }
    if (projectMode && window.bangerWorkspace) {
      const bridge = window.bangerWorkspace;
      projectRequest.current = true;
      const cancel = () => { void bridge.cancel(projectId, chatId, requestId).catch(() => {}); };
      controller.signal.addEventListener("abort", cancel, { once: true });
      try {
        if (action) setProgress(action === "save" ? "Saving current edits" : "Restoring the saved file");
        const snapshot = action ? await onResolveEdits(action) : { source, revision, activeFile };
        controller.signal.throwIfAborted();
        editsDialog.current?.close();
        const result = await bridge.run(text, snapshot.activeFile, resetProjectHistory.current, requestPermissions, projectId, chatId,
          turns.slice(-5).flatMap(turn => [{ role: "user" as const, content: turn.prompt }, { role: "assistant" as const, content: turn.reply.text.slice(0, 4000) }]), requestId);
        resetProjectHistory.current = false;
        if (!mounted.current || request.current !== controller) return;
        if (result.ok && result.reply.changedPaths?.length) setEditedSongPaths(previous => [...new Set([...previous, ...result.reply.changedPaths!])]);
        if (result.ok && !controller.signal.aborted) completedReply = { text: result.reply.text, files: [], model: connection };
        let completedFile:BangerFile = {name:fileName,source:snapshot.source};
        // Saved files remain available after cancellation. Refresh only an unchanged studio.
        if (requestPermissions.beat && snapshot.activeFile) {
          const saved = await bridge.read(snapshot.activeFile, projectId);
          if (!mounted.current || request.current !== controller) return;
          completedFile = {name:fileName,source:saved.source};
          if (saved.source !== snapshot.source) onProjectFile(saved, snapshot.revision);
        }
        controller.signal.throwIfAborted();
        if (!result.ok || result.reply.status !== "completed") throw new Error(result.ok ? "The task stopped before completing. Review the saved changes before retrying." : result.error);
        if (requestPermissions.lyrics && !fullSend) onProjectComplete();
        if(fullSend && (requestPermissions.beat || requestPermissions.lyrics)) {
          if(result.reply.changedPaths?.some(path=>path.endsWith(".banger")&&path!==snapshot.activeFile)) throw new Error("The agent edited another song. Open that song before running Produce and Add to Library so its beat and lyrics stay together.");
          if(!snapshot.activeFile) throw new Error("Open the song you want to send, then run Produce and Add to Library.");
          setNotice(await onFullSend({file:completedFile,vocals:requestPermissions.lyrics},controller.signal,setProgress));
        }
      } catch (cause) { failed(cause); }
      finally {
        controller.signal.removeEventListener("abort", cancel);
        projectRequest.current = false;
        finish();
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
      const reply = await sendChat({ requestId, permissions: requestPermissions, messages: [...messages, { role: "user", content: text }], currentFile: { name: fileName, source }, previousFiles, targetFile: selectedTarget ?? fileName, targetVersion: selectedTarget ? "generated" : "editor" }, controller.signal, emit);
      completedReply = reply;
      if(fullSend && reply.files.length>1){
        throw new Error("Produce and Add to Library needs one song. Your proposals are kept; ask the agent to edit a single song.");
      }
      if(requestPermissions.lyrics && reply.lyricPrompt) { setProgress("Generating and saving lyrics"); reply.text += `\n\n${await onLyrics(`${reply.lyricPrompt}\nOriginal user request; preserve these edit restrictions:\n${text}`,controller.signal)}`; }
      if (request.current !== controller) return;
      controller.signal.throwIfAborted();
      if (reply.files.length) setTargetFile(reply.files[0]!.name);
      if(fullSend && (requestPermissions.beat || requestPermissions.lyrics)) {
        const file=reply.files[0] ?? (selectedTarget ? latestFiles.get(selectedTarget)! : {name:fileName,source});
        setNotice(await onFullSend({file,vocals:requestPermissions.lyrics},controller.signal,setProgress));
        if(requestPermissions.beat && reply.files.length)onLoad(file,snapshotRevision,true);
      }
    } catch (cause) { failed(cause); }
    finally { finish(); }
  }

  function stop() {
    const requestId = liveTurn.current?.run?.requestId;
    if (requestId) receiveEvent.current({ type: "activity", requestId, message: "Stopping request", at: Date.now() });
    request.current?.abort();
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

  const beatTarget = projectMode ? activeFile || fileName : selectedTarget || fileName;
  const lyricsTarget = (activeFile || fileName).replace(/\.banger$/i, "") + ".lyrics";
  const projectName = folderName || fileName.replace(/\.banger$/i, "");
  const editTargets = projectMode ? (permissions.beat || permissions.lyrics ? selectedSongs : []) : [permissions.beat && canEditSong(permissions, beatTarget) && beatTarget, permissions.lyrics && canEditSong(permissions, activeFile || fileName) && lyricsTarget].filter(Boolean) as string[];

  if (!active) return null;
  return <>
    <Panel id="ai-chat-view" className="producer-ai" aria-labelledby="ai-chat-title">
    <header className="ai-chat-header">
      <h1 id="ai-chat-title" className="producer-sr-only">{turns[0]?.prompt.slice(0, 70) || "New chat"}</h1>
      <AIModelSelect id="chat-ai" mode="model-menu" disabled={busy} />
      <div className="ai-chat-project" aria-label="Project and files to edit">
        <span className="ai-chat-project-name" title={projectName}>{projectName}</span>
        <ul className="ai-chat-edit-targets">
          {editTargets.length ? editTargets.map(path => <li key={path} title={path}>{path}</li>) : <li>No files selected for editing</li>}
        </ul>
      </div>
      <IconButton variant="ghost" aria-label="Close chat" title={busy ? "Wait for the task to finish or stop it before closing" : "Close chat"} disabled={busy} onClick={() => { if (!request.current) onClose(); }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </IconButton>
    </header>
    <div ref={transcript} onScroll={event => { const element = event.currentTarget; followTranscript.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }} className="ai-chat-transcript" role="log" aria-label="AI conversation" aria-live="off">
      {!turns.length && !busy && <div className="ai-chat-empty">
        <span className="ai-chat-empty-mark" aria-hidden="true">♪</span><h2>What are we making?</h2>
        <p>Start with an idea, or give your song a new direction.</p>
        <div className="ai-chat-suggestions">{suggestions.map(text => <Button key={text} variant="ghost" onClick={() => { setPrompt(text); input.current?.focus(); }}>{text}</Button>)}</div>
      </div>}
      {[...turns, ...(pendingTurn ? [pendingTurn] : [])].map((turn, index) => <div className="ai-chat-turn" key={index}>
        <p className="ai-chat-user"><span className="producer-sr-only">You: </span>{turn.prompt}</p>
        {turn.project && <p className="ai-chat-model">Project · {turn.project}</p>}
        <AgentResponse text={turn.reply.text} />
        <div className="ai-chat-files">{turn.reply.files.map(file => <article className="ai-chat-file" key={file.name}>
          <div className="ai-chat-file-heading"><strong>{file.name}</strong><span>{file.operation === "edit" ? "Revision compiled" : "Compiled"}</span></div>
          <details><summary>Preview source</summary><pre>{file.source}</pre></details>
          <div className="ai-chat-file-actions">
            <Button variant="primary" disabled={busy || fileBusy || saving} onClick={() => onLoad(file, turn.revision)}>Load in studio</Button>
            <Button disabled={busy} onClick={() => { setTargetFile(file.name); input.current?.focus(); }}>Edit this file</Button>
            <Button disabled={fileBusy || saving} onClick={() => void save(file)}>Save file</Button>
          </div>
        </article>)}</div>
        <ChatActivity run={turn.run} legacy={turn.activity} />
        <p className="ai-chat-model">{turn.reply.model}</p>
      </div>)}

    </div>
    <p className="producer-sr-only" role="status">{busy ? "Request running" : turns.at(-1)?.run ? `Request ${turns.at(-1)!.run!.status}` : ""}</p>
    <div className="ai-chat-composer-area">
    <div className="ai-chat-control-panels">
    <details className="ai-chat-controls">
      <summary>Song controls <span>{[permissions.beat && "Beat", permissions.lyrics && "Lyrics", fullSend && "Produce and Add to Library"].filter(Boolean).join(" · ") || "Reply only"}</span></summary>
    {permissions.beat && (projectMode ? <p className="ai-chat-scope-note">Changes save directly to {folderName}. {activeFile ? `Current song: ${activeFile}.` : "Choose editable songs in Record controls."}</p> : <label className="ai-chat-target">Editing
      <Select aria-label="File to edit" value={selectedTarget ?? ""} disabled={busy} onChange={event => setTargetFile(event.target.value || null)}>
        <option value="">{fileName} · current editor</option>
        {availableFiles.map(file => <option key={file.name} value={file.name}>{file.name} · latest proposal</option>)}
      </Select>
    </label>)}
    <fieldset className="ai-chat-permissions" disabled={busy}>
      <legend className="producer-sr-only">Allow AI edits</legend>
      <label><Checkbox  checked={permissions.beat} onCheckedChange={checked => setPermissions(previous => ({ ...previous, beat: checked === true }))} />Edit beat</label>
      <label><Checkbox  checked={permissions.lyrics} onCheckedChange={checked => setPermissions(previous => ({ ...previous, lyrics: checked === true }))} />Edit lyrics</label>
      <label><Checkbox  checked={fullSend} onCheckedChange={checked =>setFullSend(checked === true)} />Produce and Add to Library</label>
      {fullSend && (permissions.beat || permissions.lyrics) && <span>{permissions.lyrics?"Generate vocals with ElevenLabs and add the song to your library.":"Render a WAV and add it to your library."}</span>}
      {!permissions.beat && !permissions.lyrics && <span>Reply only. No files will be edited.</span>}
    </fieldset>
    </details>
    <details className="ai-chat-controls ai-chat-record-controls">
      <summary>Record controls <span>{selectedSongs.length} of {recordSongs.length} songs</span></summary>
      <fieldset disabled={busy}>
        <legend className="producer-sr-only">Songs this chat may edit</legend>
        <p>Check the songs this chat may edit. Unchecked songs stay read-only.</p>
        <div className="ai-chat-record-actions">
          <Button variant="ghost" onClick={() => setPermissions(previous => ({ ...previous, songs: undefined }))}>Select all</Button>
          <Button variant="ghost" onClick={() => setPermissions(previous => ({ ...previous, songs: [] }))}>Clear selection</Button>
        </div>
        <div className="ai-chat-record-songs">
          {recordSongs.map(path => <label key={path}><Checkbox checked={canEditSong(permissions, path)} onCheckedChange={checked => selectSong(path, checked === true)} /><span title={path}>{path}</span>{path === (activeFile ?? fileName) && <small>Current song</small>}</label>)}
        </div>
        {!recordSongs.length && <p>No songs in this project yet.</p>}
        <label className="ai-chat-new-songs"><Checkbox checked={permissions.allowNewSongs !== false} onCheckedChange={checked => setPermissions(previous => ({ ...previous, allowNewSongs: checked === true }))} />Allow new songs</label>
        {!selectedSongs.length && permissions.allowNewSongs === false && <p>Reply only. Select a song or allow new songs to enable edits.</p>}
        {songsError && <p role="status">{songsError}</p>}
      </fieldset>
    </details>
    </div>
    <form className="ai-chat-compose" onSubmit={event => { event.preventDefault(); void send(); }}>
      <label className="producer-sr-only" htmlFor="ai-chat-prompt">Message Banger AI</label>
      <Textarea data-autofocus id="ai-chat-prompt" ref={input} rows={2} maxLength={permissions.lyrics && !permissions.beat ? 4000 : projectMode ? 16000 : 4000} value={prompt} disabled={busy}
        placeholder={!permissions.beat && !permissions.lyrics ? "Ask about your song or project…" : permissions.lyrics && !permissions.beat?"Write lyrics, or describe changes to this song’s lyrics…":projectMode ? "Add a bass part to verse.banger, then soften the drums in chorus.banger…" : "Describe a song, a loop, or a change to this project…"} onChange={event => setPrompt(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
      <div className="ai-chat-compose-toolbar">
      <AIModelSelect id="chat-ai" mode="reasoning-menu" disabled={busy} />
      {busy ? <IconButton className="ai-chat-send" variant="secondary" aria-label={projectMode ? "Stop task" : "Stop generating"} onClick={stop}><span className="producer-sr-only">{projectMode ? "Stop task" : "Stop generating"}</span><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="2" /></svg></IconButton>
        : <KeyHint reason={!languageModel ? LLM_KEY_HINT : undefined}><IconButton className="ai-chat-send" variant="primary" type="submit" aria-label="Send" disabled={!languageModel || !prompt.trim() || fileBusy || (fullSend && permissions.lyrics && !vocals)}><span className="producer-sr-only">Send</span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg></IconButton></KeyHint>}
      </div>
    </form>
    <div className="ai-chat-footer">
      {fullSend && permissions.lyrics && !vocals && <p>Add an ElevenLabs API key in Settings to use Produce and Add to Library with lyrics.</p>}
      {error && <p className="has-error" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </div>
    </div>
    </Panel>
    <Modal ref={editsDialog} className="producer-project-dialog ai-chat-edits-dialog" aria-labelledby="ai-chat-edits-title" aria-describedby="ai-chat-edits-description"
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
    </Modal>
  </>;
}

export function AIChatLauncher({ onNewChat }: { onNewChat(): void }) {
  return <IconButton className="ai-chat-launcher" variant="primary" aria-label="Start a new chat" title="New chat" aria-controls="ai-chat-view" onClick={onNewChat}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 3V11.5A8.5 8.5 0 0 1 9.5 3h3a8.5 8.5 0 0 1 8.5 8.5Z" transform="translate(1 -1) scale(.95)" />
      <path d="M8 11h8M12 7v8" />
    </svg>
  </IconButton>;
}
