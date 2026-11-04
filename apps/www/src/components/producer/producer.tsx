"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  compileMusic,
  INSTRUMENT_PATCHES,
  CompileError,
  serializeMusic,
  programDurationBeats,
  resolvePattern,
  resolveArrangement,
  type MusicProgram,
  type MusicTrack,
  type SoundName,
  type InstrumentName,
} from "@banger/compiler";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@banger/shadcn/components/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@banger/shadcn/components/tabs";
import { Button, IconButton, Input, Panel, Range, Select, Modal, type ModalHandle } from "@banger/shadcn";
import { saveProject } from "@/lib/project-files";
import { SongArrangement } from "./song-arrangement";
import { StepInspector } from "./step-inspector";
import { SequencerStep } from "./sequencer-step";
import { TransportControls } from "./transport-controls";
import { PatternControls } from "./pattern-controls";
import { AutomationEditor } from "./automation-editor";
import { TrackRouting, LevelMeter } from "./mixer-routing";
import { MixerView } from "./mixer-view";
import { ProjectIcon } from "./project-icon";
import { AudioExport } from "./audio-export";
import { useRecordedStage, type StageRecording } from "./recorded-stage";
import { SongLibrary } from "./song-library";
import { AppShell, type AppDestination } from "./app-sidebar";
import { MusicWorkshop, type LyricAgent } from "./music-workshop";
import { CloudProjectWorkspace } from "./cloud-project-workspace";
import type { CloudMusicContext } from "@/lib/elevenlabs";
import type { CloudBinding } from "@/lib/cloud-projects";
import { SoundDesign } from "./sound-design";
import { TrackEffects } from "./track-effects";
import { PianoRoll } from "./piano-roll";
import { TrackEditorTabs, type TrackEditorTab } from "./track-editor-tabs";
import { usePlayer } from "./use-player";
import { DesktopProjectWorkspace } from "./desktop-project-workspace";
import type { FullSend } from "@/lib/full-send";
import { readChats, writeChats, type ProjectChat, type ChatSnapshot } from "@/lib/chat-sessions";
import { FirstSongDialog } from "./first-song-dialog";
import { AIChat, AIChatLauncher } from "./ai-chat";
import { ProjectStart } from "./project-start";
import { SourceEditor } from "./source-editor";
import { BandStageButton, PerformanceStage } from "./performance-stage";
import { getProjectWorkspace } from "@/lib/browser-workspace";
import type { ProjectFolder, WorkspaceFile } from "@/lib/project-workspace";
import type { BangerFile } from "@banger/agent/protocol";
import "./producer.css";
import "./mixer-song.css";

const studioViews = [
  { id: "sequencer", label: "Sequencer" },
  { id: "mixer", label: "Mixer" },
  { id: "song", label: "Song" },
  { id: "source", label: "Raw .banger" },
] as const;
type StudioView = typeof studioViews[number]["id"];

const sounds = [
  ["drums/kick", "Kick"],
  ["drums/snare", "Snare"],
  ["drums/hat", "Hi-hat"],
  ["drums/clap", "Clap"],
  ["drums/tom", "Tom"],
  ["drums/open-hat", "Open hi-hat"],
  ["synth/bass", "Bass"],
  ["synth/pluck", "Pluck"],
  ["synth/lead", "Lead"],
  ["synth/pad", "Pad"],
  ["synth/bell", "Bell"],
  ["synth/organ", "Organ"],
  ["synth/keys", "Keys"],
  ...Object.entries(INSTRUMENT_PATCHES).map(([source, patch]) => [source, patch.name] as const),
] as const;
const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (midi: number) => `${notes[midi % 12]}${Math.floor(midi / 12) - 1}`;
const message = (cause: unknown) => cause instanceof Error ? cause.message : "Something went wrong.";

function diagnose(cause: unknown) {
  if (cause && typeof cause === "object") {
    const detail = cause as { line?: number; column?: number; position?: number | { line?: number; column?: number } };
    const position = typeof detail.position === "object" ? detail.position : detail;
    if (position.line) return `Line ${position.line}${position.column ? `, column ${position.column}` : ""}: ${message(cause)}`;
  }
  return message(cause);
}

export function Producer({ initialFile }: { initialFile: BangerFile }) {
  const [session, setSession] = useState<{ file: BangerFile; saved: boolean; folder?: ProjectFolder; studio: "beat" | "vocal"; chatId?: string } | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [requiredStudio, setRequiredStudio] = useState<"beat" | "vocal" | null>(null);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [startDestination, setStartDestination] = useState<AppDestination>("library");
  const startStudio = startDestination === "vocal" ? "vocal" : "beat";
  const [savedChats, setSavedChats] = useState<ProjectChat[]>([]);
  useEffect(() => { queueMicrotask(() => setSavedChats(readChats())); }, []);
  const [recentError, setRecentError] = useState("");
  const [emptyRecent, setEmptyRecent] = useState<ProjectFolder | null>(null);
  const openingRecent = useRef(false);
  async function openRecent(id: string, chatId?: string) {
    if (openingRecent.current) return;
    openingRecent.current = true; setRecentError("");
    try {
      const folder = await getProjectWorkspace().restore?.(id);
      if (!folder) return;
      window.dispatchEvent(new Event("banger:projects-changed"));
      if (!folder.file) { setEmptyRecent(folder); return; }
      setSession({ file: { name: folder.file.path.split("/").pop()!, source: folder.file.source }, saved: true, folder, studio: startStudio, chatId });
    } catch (cause) { setRecentError(message(cause)); }
    finally { openingRecent.current = false; }
  }
  const toggleSidebar = () => setSidebarExpanded(expanded => !expanded);
  if (!session && !libraryOpen) return <AppShell chats={savedChats} onChat={id => {
    const chat = savedChats.find(item => item.id === id);
    if (!chat) return;
    if (chat.snapshot.folder?.id) void openRecent(chat.snapshot.folder.id, id);
    else setSession({ file: { name: chat.snapshot.fileName, source: chat.snapshot.source }, saved: true, studio: startStudio, chatId: id });
  }} onAddProject={() => setRequiredStudio(startStudio)} onOpenRecent={id => void openRecent(id)} active={startDestination} expanded={sidebarExpanded} onToggle={toggleSidebar} onNavigate={next => {
    if (next === "library") setLibraryOpen(true);
    else setStartDestination(next);
  }}>{requiredStudio && <ProjectStart sample={initialFile} requiredStudio={requiredStudio} onCancel={() => setRequiredStudio(null)} onStart={(file, saved, folder) => { setSession({ file, saved, folder, studio: requiredStudio }); setRequiredStudio(null); }} />}<ProjectStart sample={initialFile} onOpenLibrary={() => setLibraryOpen(true)} onStart={(file, saved, folder) => setSession({ file, saved, folder, studio: startStudio })} />{recentError && <p role="alert">{recentError}</p>}{emptyRecent && <FirstSongDialog folder={emptyRecent} onCreated={folder => { if (folder.file) setSession({ file: { name: folder.file.path, source: folder.file.source }, saved: true, folder, studio: startStudio }); setEmptyRecent(null); }} />}</AppShell>;
  return <Studio initialChatId={session?.chatId} key={session ? "project" : "library"} sidebarExpanded={sidebarExpanded} onToggleSidebar={toggleSidebar} initialFile={session?.file ?? initialFile} sample={initialFile} initiallySaved={session?.saved ?? false} initialFolder={session?.folder} initialStudio={session?.studio ?? "library"} onRequireProject={setRequiredStudio}>
    {requiredStudio && <ProjectStart sample={initialFile} requiredStudio={requiredStudio} onCancel={() => setRequiredStudio(null)} onStart={(file, saved, folder) => {
      setSession({ file, saved, folder, studio: requiredStudio });
      setRequiredStudio(null);
    }} />}
  </Studio>;
}

function Studio({ initialChatId, initialFile: openedFile, sample, initiallySaved, initialFolder: openedFolder, initialStudio, onRequireProject, sidebarExpanded, onToggleSidebar, children }: { initialChatId?: string; initialFile: BangerFile; sample: BangerFile; initiallySaved: boolean; initialFolder?: ProjectFolder; initialStudio: AppDestination; onRequireProject(studio: "beat" | "vocal"): void; sidebarExpanded: boolean; onToggleSidebar(): void; children: ReactNode }) {
  const [initialChats] = useState(readChats);
  const [startingChat] = useState(() => initialChats.find(chat => chat.id === initialChatId) ?? [...initialChats].reverse().find(chat => openedFolder?.id && chat.snapshot.folder?.id === openedFolder.id));
  const initialSnapshot = startingChat?.snapshot;
  const initialFile = initialSnapshot ? { name: initialSnapshot.fileName, source: initialSnapshot.source } : openedFile;
  const initialFolder = initialSnapshot?.folder ?? openedFolder;
  const projectDialog = useRef<ModalHandle>(null);
  const projectTrigger = useRef<HTMLButtonElement>(null);
  const [vocalExportTarget, setVocalExportTarget] = useState<HTMLDivElement | null>(null);
  const [projectEpoch, setProjectEpoch] = useState(0);
  const [currentFolder, setCurrentFolder] = useState(initialFolder);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceFile, setWorkspaceFile] = useState<WorkspaceFile | null>(initialSnapshot ? initialSnapshot.workspaceFile : initialFolder?.file ?? null);
  function showProjects(trigger?: HTMLButtonElement) { if (trigger) projectTrigger.current = trigger; if (!hasProject) { onRequireProject("beat"); return; } projectDialog.current?.showModal(); }
  const lyricAgent=useRef<LyricAgent|null>(null);
  const setLyricAgent=useCallback((agent:LyricAgent|null)=>{lyricAgent.current=agent;},[]);
  const runFullSend=useCallback<FullSend>((input,signal,progress)=>{if(!lyricAgent.current)throw new Error("The song is still loading.");return lyricAgent.current.fullSend(input,signal,progress);},[]);
  const checkFullSend=useCallback((vocals:boolean)=>{if(!lyricAgent.current)throw new Error("The song is still loading.");lyricAgent.current.checkFullSend(vocals);},[]);
  const runLyrics=useCallback((prompt:string,signal:AbortSignal)=>{if(!lyricAgent.current)throw new Error("The song is still loading.");return lyricAgent.current.run(prompt,signal);},[]);
  const [vocalEdits,setVocalEdits]=useState({dirty:false,busy:false});
  const vocalEditsRef = useRef(vocalEdits);
  useEffect(() => { vocalEditsRef.current = vocalEdits; }, [vocalEdits]);
  const [cloudDraftDirty, setCloudDraftDirty] = useState(false);
  const [cloudBinding, setCloudBinding] = useState<CloudBinding | null>(initialSnapshot?.cloudBinding ?? null);
  const cloudMusicContext=useMemo<CloudMusicContext|undefined>(()=>cloudBinding?{url:cloudBinding.url,token:cloudBinding.token,projectId:cloudBinding.projectId,revision:cloudBinding.revision}:undefined,[cloudBinding]);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [initialProgram] = useState(() => {
    try { const applied = initialSnapshot?.appliedSource ?? initialFile.source; return { program: compileMusic(applied), source: applied }; }
    catch { return { program: compileMusic(sample.source), source: sample.source }; }
  });
  const [studio, setStudio] = useState<"beat" | "vocal" | "library">(initialStudio);
  const [vocalBeat, setVocalBeat] = useState<BangerFile | null>(null);
  const [vocalRecording, setVocalRecording] = useState<StageRecording | null>(null);
  const [libraryRecording, setLibraryRecording] = useState<StageRecording | null>(null);
  const [libraryBeat, setLibraryBeat] = useState<BangerFile | null>(null);
  const [singAlongOpen, setSingAlongOpen] = useState(false);
  const vocalStudio = studio === "vocal";
  const beatStudio = studio === "beat";
  const [view, setView] = useState<StudioView>(initialProgram.source === initialFile.source ? "sequencer" : "source");
  const [program, setProgram] = useState<MusicProgram>(initialProgram.program);
  const [appliedSource, setAppliedSource] = useState(initialProgram.source);
  const [source, setSource] = useState(initialFile.source);
  const [savedSource, setSavedSource] = useState(initialSnapshot?.savedSource ?? initialFile.source);
  const [projectName, setProjectName] = useState(initialFolder?.name ?? "");
  const [folderName, setFolderName] = useState(initialFolder?.name ?? "");
  const [hasProject, setHasProject] = useState(initiallySaved);
  const [fileName, setFileName] = useState(initialFile.name);
  const [tempoDraft, setTempoDraft] = useState(String(program.tempo));
  const [previewSection, setPreviewSection] = useState<string | undefined>();
  const [expandedTrack, setExpandedTrack] = useState<number | null>(null);
  const [editorTab, setEditorTab] = useState<TrackEditorTab>("notes");
  const [patterns, setPatterns] = useState<Record<number, string>>({});
  const [selectedStep, setSelectedStep] = useState<{ track: number; index: number; pattern?: string; epoch: number } | null>(null);
  const [pitch, setPitch] = useState<Record<number, number>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const filePending = useRef(false);
  const sourceRef = useRef(source);
  const revision = useRef(0);
  const [sourceRevision, setSourceRevision] = useState(0);
  const editor = useRef<HTMLTextAreaElement>(null);
  const draft = source !== appliedSource;
  const dirty = source !== savedSource;
  const result = useMemo(() => {
    try { return { program: compileMusic(source), error: null }; }
    catch (cause) { return { program: null, error: diagnose(cause), errorOffset: cause instanceof CompileError ? cause.position.offset : undefined }; }
  }, [source]);
  const [chats, setChats] = useState<ProjectChat[]>(() => startingChat ? initialChats : [...initialChats, {
    id: crypto.randomUUID(), title: "New chat", status: "idle", snapshot: { source, appliedSource, savedSource, fileName, folder: currentFolder, workspaceFile, cloudBinding },
  }]);
  const chatsRef = useRef(chats);
  const [activeChat, setActiveChat] = useState(startingChat?.id ?? chats[chats.length - 1]!.id);
  const activeChatRef = useRef(activeChat);
  const [chatView, setChatView] = useState(Boolean(initialChatId));
  const switchingChat = useRef(false);
  const [emptyRecent, setEmptyRecent] = useState<ProjectFolder | null>(null);
  const updateChats = useCallback((update: (previous: ProjectChat[]) => ProjectChat[]) => {
    const next = update(chatsRef.current);
    chatsRef.current = next;
    setChats(next);
  }, []);
  const updateChat = useCallback((id: string, update: Partial<ProjectChat>) => {
    updateChats(previous => previous.map(chat => chat.id === id ? { ...chat, ...update } : chat));
  }, [updateChats]);
  const snapshot: ChatSnapshot = { revision: sourceRevision, source, appliedSource, savedSource, fileName, folder: currentFolder, workspaceFile, cloudBinding };
  const snapshotRef = useRef(snapshot);
  useEffect(() => { snapshotRef.current = { revision: sourceRevision, source, appliedSource, savedSource, fileName, folder: currentFolder, workspaceFile, cloudBinding }; }, [sourceRevision, source, appliedSource, savedSource, fileName, currentFolder, workspaceFile, cloudBinding]);
  useEffect(() => { window.dispatchEvent(new Event("banger:projects-changed")); }, []);
  useEffect(() => {
    if (!activeChat) return;
    updateChat(activeChat, { snapshot: { revision: sourceRevision, source, appliedSource, savedSource, fileName, folder: currentFolder, workspaceFile, cloudBinding } });
  }, [activeChat, sourceRevision, source, appliedSource, savedSource, fileName, currentFolder, workspaceFile, cloudBinding, updateChat]);
  useEffect(() => {
    if (!chats.length) return;
    const timer = window.setTimeout(() => {
      try { writeChats(chats); }
      catch { setNotice("Chat history could not be saved on this device. Free some browser storage before closing the app."); }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [chats]);
  useEffect(() => {
    const persist = () => { try { writeChats(chatsRef.current); } catch { /* The visible save reports quota failures. */ } };
    window.addEventListener("pagehide", persist);
    return () => { persist(); window.removeEventListener("pagehide", persist); };
  }, []);
  const projectRunning = chats.some(chat => chat.status === "running" && chat.snapshot.folder?.id === currentFolder?.id);
  function canSwitchChat() {
    if (filePending.current || switchingChat.current) return false;
    if (chatsRef.current.some(chat => chat.blocksSwitch) || vocalEdits.busy || vocalEdits.dirty) {
      setNotice("Finish or stop the vocal operation and save lyric edits before switching projects. Beat tasks can keep running in the background.");
      return false;
    }
    return true;
  }
  function addChat(next = snapshotRef.current, open = true) {
    const chat: ProjectChat = { id: crypto.randomUUID(), title: "New chat", snapshot: next, status: "idle" };
    updateChats(previous => [...previous.map(item => item.id === activeChatRef.current ? { ...item, snapshot: snapshotRef.current } : item), chat]);
    activeChatRef.current = chat.id; setActiveChat(chat.id);
    setChatView(open);
    if (open) stopPlayback();
  }
  async function selectChat(id: string) {
    if (id === activeChatRef.current) { setChatView(true); stopPlayback(); return; }
    if (!canSwitchChat()) return;
    const chat = chatsRef.current.find(item => item.id === id);
    if (!chat) return;
    switchingChat.current = true; setFileBusy(true);
    updateChat(activeChatRef.current, { snapshot: snapshotRef.current });
    try {
      const bridge = getProjectWorkspace();
      const target = chat.snapshot;
      if (target.folder?.id) {
        await bridge.restore?.(target.folder.id);
        await bridge.activate(target.folder.id);
      }
      // A background task may have completed while the folder was being reopened.
      const next = chatsRef.current.find(item => item.id === id)!.snapshot;
      let file = next.workspaceFile;
      if (file && next.source === next.savedSource) file = await bridge.read(file.path, target.folder?.id);
      activeChatRef.current = id; setActiveChat(id);
      restoreSnapshot({ ...next, ...(file && next.source === next.savedSource ? { source: file.source, appliedSource: file.source, savedSource: file.source, workspaceFile: file } : {}) });
      setChatView(true); stopPlayback();
      window.dispatchEvent(new Event("banger:projects-changed"));
    } catch (cause) {
      await getProjectWorkspace().activate(snapshotRef.current.folder?.id).catch(() => {});
      setNotice(message(cause));
    }
    finally { switchingChat.current = false; setFileBusy(false); }
  }
  function restoreSnapshot(next: ChatSnapshot) {
    loadOpenedFile({ name: next.fileName, source: next.source });
    try { const program = compileMusic(next.appliedSource); setProgram(program); setAppliedSource(next.appliedSource); setTempoDraft(String(program.tempo)); } catch { /* Invalid drafts remain editable. */ }
    setSavedSource(next.savedSource); setWorkspaceFile(next.workspaceFile); setCurrentFolder(next.folder);
    setFolderName(next.folder?.name ?? ""); setProjectName(next.folder?.name ?? ""); setCloudBinding(next.cloudBinding);
    setProjectEpoch(value => value + 1); setStudio("beat"); setChatView(false); snapshotRef.current = next;
  }
  function openedRecent(folder: ProjectFolder) {
    if (!folder.file) { setEmptyRecent(folder); return; }
    const next: ChatSnapshot = { source: folder.file.source, appliedSource: folder.file.source, savedSource: folder.file.source, fileName: folder.file.path.split("/").pop()!, folder, workspaceFile: folder.file, cloudBinding: null };
    addChat(next, false); restoreSnapshot(next); setEmptyRecent(null);
    window.dispatchEvent(new Event("banger:projects-changed"));
  }
  async function openRecent(id: string) {
    if (!canSwitchChat()) return;
    const existing = [...chatsRef.current].reverse().find(chat => chat.snapshot.folder?.id === id);
    if (existing) { await selectChat(existing.id); return; }
    switchingChat.current = true; setFileBusy(true);
    try { const folder = await getProjectWorkspace().restore?.(id); if (folder) openedRecent(folder); }
    catch (cause) { setNotice(message(cause)); }
    finally { switchingChat.current = false; setFileBusy(false); }
  }
  const audibleProgram = useMemo(() => previewSection && program.sections?.some(section => section.name === previewSection)
    ? { ...program, chainEnabled: true, timeline: [{ section: previewSection }] } : program, [program, previewSection]);
  const playback = usePlayer(audibleProgram);
  const associatedBeat = vocalStudio ? vocalBeat : libraryBeat;
  const associatedProgram = useMemo(() => {
    if (!associatedBeat) return null;
    try { return compileMusic(associatedBeat.source); } catch { return null; }
  }, [associatedBeat]);
  const associatedPlayback = usePlayer(associatedProgram ?? program);
  const stopAssociatedPlayback = associatedPlayback.stop;
  useEffect(() => { stopAssociatedPlayback(); }, [associatedBeat?.source, studio, stopAssociatedPlayback]);
  const stageProgram = beatStudio ? program : associatedProgram;
  const stageRecording = beatStudio ? null : vocalStudio ? vocalRecording : libraryRecording;
  const recordedPlayback = useRecordedStage(associatedProgram ?? program, stageRecording);
  const stagePlayback = beatStudio ? playback : stageRecording ? recordedPlayback : associatedPlayback;
  const arrangement = useMemo(() => resolveArrangement(audibleProgram), [audibleProgram]);
  const stopPlayback = () => { playback.stop(); setPreviewSection(undefined); };
  const preview = (name?: string) => { if (name || previewSection) playback.stop(); setPreviewSection(name); };
  const playPreview = playback.play;
  useEffect(() => {
    if (previewSection) void playPreview();
  }, [previewSection, playPreview]);
  const hasSolo = program.tracks.some(track => track.solo);
  const songMode = audibleProgram.chainEnabled !== false && !!audibleProgram.timeline?.length;
  const patternNames = [...new Set(program.tracks.flatMap(track => track.patterns?.map(pattern => pattern.name) ?? []))];
  const phrases = program.tracks.map((track, index) => {
    const requested = patterns[index] ?? program.activePattern;
    const name = track.patterns?.some(pattern => pattern.name === requested) ? requested : undefined;
    return { name, phrase: resolvePattern(track, name) };
  });
  const gridBeats = Math.max(4, ...phrases.map(({ phrase }) => (phrase.bars ?? 1) * 4));
  const beatWidth = Math.max(112, ...phrases.filter(({ phrase }) => phrase.pianoRoll === undefined).map(({ phrase }) => phrase.steps.length / ((phrase.bars ?? 1) * 4) * 36));
  const inspectedTrack = selectedStep && selectedStep.epoch === editorEpoch && phrases[selectedStep.track]?.name === selectedStep.pattern
    ? program.tracks[selectedStep.track] : undefined;
  const inspectedPhrase = inspectedTrack && selectedStep ? phrases[selectedStep.track]!.phrase : undefined;
  const hasSelectedStep = !!inspectedPhrase && inspectedPhrase.pianoRoll === undefined && selectedStep!.index < inspectedPhrase.steps.length;

  function launchPattern(name: string, next = program) {
    const launch = { ...next, chainEnabled: false };
    if (name) launch.activePattern = name; else delete launch.activePattern;
    if (edit(launch)) { setPreviewSection(undefined); setPatterns({}); setSelectedStep(null); }
  }

  function setTransportMode(song: boolean) {
    if (edit({ ...program, chainEnabled: song })) {
      setPreviewSection(undefined);
      if (!song) { setPatterns({}); setSelectedStep(null); }
    }
  }

  useEffect(() => {
    if (!dirty && !cloudDraftDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, cloudDraftDirty]);

  function writeSource(next: string) {
    sourceRef.current = next;
    revision.current += 1;
    setSourceRevision(revision.current);
    setSource(next);
  }

  function edit(next: MusicProgram) {
    if (draft || fileBusy) return;
    try {
      if (next.timeline?.length === 0) { next = { ...next }; delete next.timeline; }
      const text = serializeMusic(next);
      const checked = compileMusic(text);
      if (previewSection && !checked.sections?.some(section => section.name === previewSection)) stopPlayback();
      setProgram(checked);
      setAppliedSource(text);
      writeSource(text);
      setNotice(null);
      return true;
    } catch (cause) { setNotice(diagnose(cause)); return false; }
  }

  function editTrack(index: number, track: MusicTrack) {
    const oldName = program.tracks[index]!.name;
    const renameEffects = (effects: MusicTrack["effects"]) => effects?.map(effect => effect.kind === "compressor" && effect.sidechain === oldName ? { ...effect, sidechain: track.name } : effect);
    return edit({ ...program,
      tracks: program.tracks.map((item, i) => ({ ...(i === index ? track : item), effects: renameEffects((i === index ? track : item).effects) })),
      ...(program.sections ? { sections: program.sections.map(section => ({ ...section, tracks: section.tracks.map(binding => binding.track === oldName ? { ...binding, track: track.name } : binding) })) } : {}),
      ...(program.buses ? { buses: program.buses.map(bus => ({ ...bus, effects: renameEffects(bus.effects) })) } : {}),
    });
  }

  function apply() {
    if (!result.program) { editor.current?.focus(); return; }
    setProgram(result.program);
    setTempoDraft(String(result.program.tempo));
    setAppliedSource(source);
    setPreviewSection(undefined);
    setPitch({});
    setPatterns({});
    setExpandedTrack(null);
    setEditorEpoch(value => value + 1);
    setNotice("Source applied.");
  }

  function remove(index: number) {
    const removed = program.tracks[index]!.name;
    const cleanEffects = (effects: MusicTrack["effects"]) => effects?.map(effect => {
      if (effect.kind !== "compressor" || effect.sidechain !== removed) return effect;
      const next = { ...effect }; delete next.sidechain; return next;
    });
    if (!edit({ ...program, tracks: program.tracks.filter((_, i) => i !== index).map(track => ({ ...track, effects: cleanEffects(track.effects) })),
      ...(program.sections ? { sections: program.sections.map(section => ({ ...section, tracks: section.tracks.filter(binding => binding.track !== removed) })) } : {}),
      ...(program.buses ? { buses: program.buses.map(bus => ({ ...bus, effects: cleanEffects(bus.effects) })) } : {}),
    })) return;
    setPitch({});
    setPatterns({});
    setExpandedTrack(null);
    setEditorEpoch(value => value + 1);
  }

  function addTrack() {
    let suffix = program.tracks.length + 1;
    while (program.tracks.some(track => track.name === `track_${suffix}`)) suffix += 1;
    edit({ ...program, tracks: [...program.tracks, {
      name: `track_${suffix}`, source: { kind: "sound", name: "drums/hat" },
      steps: Array.from({ length: 16 }, () => null), gain: 0.5,
    }] });
  }

  function canReplaceSong() {
    if(filePending.current||vocalEdits.busy)return false;
    return !(dirty||vocalEdits.dirty)||window.confirm("Replace unsaved beat or lyric changes in the current song?");
  }

  function loadOpenedFile(file: BangerFile) {
    stopPlayback();
    // Keep invalid files editable; the last valid sequence remains available.
    writeSource(file.source);
    setSavedSource(file.source);
    setFileName(file.name);
    setHasProject(true);
    try {
      const next = compileMusic(file.source);
      setProgram(next);
      setAppliedSource(file.source);
      setTempoDraft(String(next.tempo));
      setPreviewSection(undefined);
      setPitch({});
      setPatterns({});
      setExpandedTrack(null);
      setEditorEpoch(value => value + 1);
      setNotice(`Opened ${file.name}.`);
    } catch { setNotice("File opened as a draft. Fix the errors, then apply it."); }
  }

  const refreshRestoredSong = useEffectEvent((file: WorkspaceFile) => {
    if (activeChatRef.current !== startingChat?.id || revision.current !== 0 || sourceRef.current === file.source) return;
    loadOpenedFile({ name: file.path.split("/").pop()!, source: file.source });
    setWorkspaceFile(file);
  });
  useEffect(() => {
    const saved = startingChat?.snapshot;
    if (!saved?.workspaceFile || saved.source !== saved.savedSource) return;
    let active = true;
    void getProjectWorkspace().read(saved.workspaceFile.path, saved.folder?.id).then(file => {
      if (active) refreshRestoredSong(file);
    }).catch(cause => { if (active) setNotice(message(cause)); });
    return () => { active = false; };
  }, [startingChat]);

  async function save() {
    if (filePending.current || workspaceBusy || projectRunning) return;
    filePending.current = true;
    setFileBusy(true);
    const snapshot = sourceRef.current;
    const savedRevision = revision.current;
    setNotice(null);
    try {
      const saveToFolder = Boolean(workspaceFile || (folderName && !cloudBinding));
      if (saveToFolder) await getProjectWorkspace().activate(currentFolder?.id);
      const folderFile = saveToFolder
        ? await getProjectWorkspace().save(workspaceFile?.path ?? fileName, snapshot, workspaceFile?.source ?? null)
        : null;
      const file = folderFile ? { name: folderFile.path.split("/").pop()! } : await saveProject(snapshot, fileName);
      if (folderFile) { setWorkspaceFile(folderFile); setProjectName(folderName); }
      if (file) {
        setFileName(file.name);
        setHasProject(true);
        setSavedSource(snapshot);
        setNotice(revision.current === savedRevision ? `Saved ${file.name}.` : "Saved the earlier version. Your newer edits are still unsaved.");
      }
    } catch (cause) { setNotice(message(cause)); }
    finally { filePending.current = false; setFileBusy(false); }
  }

  async function resolveEditsForAI(action: "save" | "discard") {
    if (filePending.current) throw new Error("Wait for the current file operation to finish.");
    filePending.current = true;
    setFileBusy(true);
    const snapshot = sourceRef.current;
    const snapshotRevision = revision.current;
    try {
      const bridge = getProjectWorkspace();
      await bridge.activate(currentFolder?.id);
      const file = action === "save"
        ? await bridge.save(workspaceFile?.path ?? fileName, snapshot, workspaceFile?.source ?? null)
        : workspaceFile ? await bridge.read(workspaceFile.path) : null;
      if (revision.current !== snapshotRevision) throw new Error("Your edits changed. Send again to start with the latest version.");
      if (action === "discard") {
        loadOpenedFile({ name: file?.path.split("/").pop() ?? fileName, source: file?.source ?? savedSource });
      } else if (file) {
        setSavedSource(file.source);
        setFileName(file.path.split("/").pop()!);
        setHasProject(true);
      }
      setWorkspaceFile(file);
      setProjectName(folderName);
      return { source: sourceRef.current, revision: revision.current, activeFile: file?.path };
    } finally {
      filePending.current = false;
      setFileBusy(false);
    }
  }

  function loadGeneratedFile(file: BangerFile, generatedRevision: number, automatic=false) {
    if (filePending.current || workspaceBusy || (!automatic && !canReplaceSong())) return;
    if (revision.current !== generatedRevision && !window.confirm("Your project changed after this request. Load the generated file and replace the current editor?")) return;
    try {
      const next = compileMusic(file.source);
      setProgram(next);
      setAppliedSource(file.source);
      writeSource(file.source);
      setSavedSource("");
      setProjectName(folderName);
      setWorkspaceFile(null);
      setFileName(file.name);
      setTempoDraft(String(next.tempo));
      setPreviewSection(undefined);
      setPitch({});
      setPatterns({});
      setExpandedTrack(null);
      setEditorEpoch(value => value + 1);
      if (!automatic) { setChatView(false); setStudio("beat"); }
      setNotice(`Loaded ${file.name}. Save to keep it.`);
    } catch (cause) { setNotice(diagnose(cause)); }
  }

  function changeSound(index: number, name: string) {
    const track = program.tracks[index];
    if (!track) return;
    const instrument = name.startsWith("synth/");
    const selected = sounds.find(([value]) => value === name);
    if (!selected) return;
    const nextSource: MusicTrack["source"] = instrument
      ? { kind: "instrument", name: name as InstrumentName }
      : { kind: "sound", name: name as SoundName };
    if (!instrument && (track.pianoRoll !== undefined || track.patterns?.some(pattern => pattern.pianoRoll !== undefined)) && !window.confirm("Switch all this track's patterns to drums? Pitches, note lengths and velocities will become drum hits with onsets rounded to a 64-step grid.")) return;
    const convert = (phrase: { steps: MusicTrack["steps"]; pianoRoll?: MusicTrack["pianoRoll"]; bars?: number }) => {
      if (phrase.pianoRoll !== undefined && !instrument) {
        const steps: MusicTrack["steps"] = Array.from({ length: 64 }, (_, step) => phrase.pianoRoll!.some(note => Math.floor(note.start / ((phrase.bars ?? 1) * 4) * 64) === step) ? { kind: "hit" } : null);
        return { steps };
      }
      return { steps: phrase.steps.map(step => !step ? null : instrument
        ? { ...step, kind: "note" as const, midi: step.kind === "note" ? step.midi : pitch[index] ?? 36 }
        : { ...step, kind: "hit" as const }), ...(phrase.pianoRoll === undefined ? {} : { pianoRoll: phrase.pianoRoll }) };
    };
    const next = { ...track, source: nextSource, ...convert(track), patterns: track.patterns?.map(pattern => {
      const nextPattern = { ...pattern, ...convert(pattern) }; if (!instrument) delete nextPattern.pianoRoll; return nextPattern;
    }) };
    if (!instrument) delete next.pianoRoll;
    // Selecting a recipe must make it audible even after an explicit synth or
    // modular override. Saved patches and phrase locks belong to the track.
    if (Object.hasOwn(INSTRUMENT_PATCHES, name)) {
      delete next.synth;
      delete next.modular;
    }
    editTrack(index, next);
  }

  function openNotes(index: number) {
    setEditorTab("notes");
    setExpandedTrack(index);
    requestAnimationFrame(() => {
      const panel = document.getElementById(`track-${index}-panel-notes`);
      if (panel) panel.scrollTop = 0;
      document.getElementById(`track-editor-${index}`)?.scrollIntoView({ block: "nearest" });
    });
  }

  const trackViews = program.tracks.map((track, index) => {
    const { name: selectedPattern, phrase } = phrases[index]!;
    const previewNotes = phrase.pianoRoll ?? [];
    const lowestPitch = Math.min(60, ...previewNotes.map(note => note.midi));
    const highestPitch = Math.max(lowestPitch + 12, ...previewNotes.map(note => note.midi));
    const phraseTrack = { ...track, steps: phrase.steps, bars: phrase.bars, pianoRoll: phrase.pianoRoll };
    const editPhrase = (next: MusicTrack) => {
      if (!selectedPattern) return editTrack(index, next);
      return editTrack(index, { ...track, patterns: track.patterns!.map(pattern => pattern.name === selectedPattern ? { ...pattern, steps: next.steps, pianoRoll: next.pianoRoll, bars: next.bars } : pattern) });
    };
    const songBeat = (Math.max(1, playback.state.songBar ?? playback.state.bar) - 1 + playback.state.phase) * 4;
    const clip = arrangement.find(item => item.track === track.name && item.startBeat <= songBeat && item.startBeat + item.durationBeats > songBeat);
    const phrasePlaying = playback.state.playing && !!clip && clip.pattern === selectedPattern;
    const phase = clip ? (songBeat - clip.startBeat) / ((phrase.bars ?? 1) * 4) : 0;
    const row = <div className={`producer-track${track.muted || (hasSolo && !track.solo) ? " is-muted" : ""}`} key={index}>
      <button type="button" className="producer-track-toggle" aria-label={`Edit ${track.name}`} aria-expanded={expandedTrack === index} aria-controls={`track-editor-${index}`}
        title={`Edit ${track.name} sound, pattern and mix. Editing ${selectedPattern || "Base"}, ${phrase.bars ?? 1} bars.`} onClick={() => setExpandedTrack(index)}>
        <span className="producer-track-number">{String(index + 1).padStart(2, "0")}</span>
        <span className="producer-track-label"><strong>{track.name}</strong><small>{sounds.find(([value]) => value === track.source.name)?.[1] ?? track.source.name}</small><small>{selectedPattern || "Base"} · {phrase.bars ?? 1} {(phrase.bars ?? 1) === 1 ? "bar" : "bars"}</small></span>
        <span className="producer-track-chevron" aria-hidden="true">{expandedTrack === index ? "▾" : "▸"}</span>
      </button>
      <div className="producer-time-lane">
        <div className="producer-phrase-length" style={{ width: `${(phrase.bars ?? 1) * 4 / gridBeats * 100}%` }}>
      {phraseTrack.pianoRoll !== undefined ? <button type="button" className="producer-phrase-preview" aria-label={`Edit ${track.name} piano roll`} aria-expanded={expandedTrack === index} aria-controls={`track-editor-${index}`} onClick={() => openNotes(index)}>
        <svg viewBox="0 0 1000 32" preserveAspectRatio="none" aria-hidden="true">
          {phraseTrack.pianoRoll.map((note, noteIndex) => <rect key={noteIndex} x={note.start / ((phrase.bars ?? 1) * 4) * 1000} y={3 + (highestPitch - note.midi) / (highestPitch - lowestPitch) * 23} width={Math.max(3, note.duration / ((phrase.bars ?? 1) * 4) * 1000)} height={3} rx={1} />)}
          {phrasePlaying && <line x1={(phase % 1) * 1000} x2={(phase % 1) * 1000} y1={0} y2={32} />}
        </svg>
        <span>{phraseTrack.pianoRoll.length} notes · {phrase.bars ?? 1} {(phrase.bars ?? 1) === 1 ? "bar" : "bars"}</span>
      </button> : <div className="producer-step-grid" style={{ "--track-steps": phraseTrack.steps.length } as CSSProperties} role="group" aria-label={`${track.name} steps`}>
        {phraseTrack.steps.map((step, stepIndex) => <SequencerStep key={stepIndex} step={step} index={stepIndex} name={track.name}
          selected={hasSelectedStep && selectedStep?.track === index && selectedStep.index === stepIndex}
          onSelect={() => setSelectedStep({ track: index, index: stepIndex, pattern: selectedPattern, epoch: editorEpoch })}
          current={phrasePlaying && Math.floor(phase * phraseTrack.steps.length) === stepIndex}
          newStep={track.source.kind === "sound" ? { kind: "hit" } : { kind: "note", midi: pitch[index] ?? 36 }}
          onChange={next => editPhrase({ ...phraseTrack, steps: phraseTrack.steps.map((item, i) => i === stepIndex ? next : item) })} />)}
      </div>}
        </div>
      </div>
      <div className="producer-track-mix">
        <Button className="producer-track-mute" variant={!!track.muted ? "primary" : "ghost"} aria-pressed={!!track.muted} aria-label={`Mute ${track.name}`} title={!!track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`} onClick={() => editTrack(index, { ...track, muted: !track.muted })}>M</Button>
        <Button variant={!!track.solo ? "primary" : "ghost"} aria-pressed={!!track.solo} aria-label={`Solo ${track.name}`} title={`Solo ${track.name}`} onClick={() => editTrack(index, { ...track, solo: !track.solo })}>S</Button>
      </div>
    </div>;
    const editor = <div key={index} className="producer-track-editor" id={`track-editor-${index}`} hidden={expandedTrack !== index}>
        <div className="producer-focused-heading">
          <h2>{track.name} <span>/ {selectedPattern ?? "Base pattern"} / {phrase.bars ?? 1} {(phrase.bars ?? 1) === 1 ? "bar" : "bars"}</span></h2>
          <IconButton variant="ghost" aria-label={`Close ${track.name} editor`} onClick={() => { setExpandedTrack(null); document.querySelector<HTMLButtonElement>(`[aria-controls="track-editor-${index}"]`)?.focus({ preventScroll: true }); }}>×</IconButton>
        </div>
        <label className="producer-focused-pattern">Pattern <Select aria-label={`${track.name} pattern`} value={selectedPattern ?? ""} onChange={event => setPatterns({ ...patterns, [index]: event.target.value })}><option value="">Base pattern</option>{track.patterns?.map(pattern => <option key={pattern.name}>{pattern.name}</option>)}</Select></label>
        <TrackEditorTabs id={`track-${index}`} name={track.name} active={editorTab} onSelect={setEditorTab} panels={{
          notes: <>
            {track.source.kind === "instrument" && <PianoRoll key={`${editorEpoch}-${track.name}-${selectedPattern ?? "base"}`} track={phraseTrack} beats={(phrase.bars ?? 1) * 4} disabled={draft || fileBusy} visible={beatStudio && view === "sequencer" && expandedTrack === index && editorTab === "notes"} playing={phrasePlaying} phase={phase} onChange={editPhrase} />}
            {track.source.kind === "sound" && <p className="producer-empty">Edit this pattern with the steps in the track list.</p>}
            <details className="producer-pattern-settings"><summary>Pattern settings</summary>
              <PatternControls hidePicker track={track} selected={selectedPattern ?? ""} onSelect={name => setPatterns({ ...patterns, [index]: name })}
                onRename={(oldName, name) => edit({ ...program, tracks: program.tracks.map((item,i) => i === index ? { ...track, patterns: track.patterns!.map(pattern => pattern.name === oldName ? { ...pattern, name } : pattern) } : item), sections: program.sections?.map(section => ({ ...section, tracks: section.tracks.map(binding => binding.track === track.name && binding.pattern === oldName ? { ...binding, pattern: name } : binding) })) })}
                onRemove={name => edit({ ...program, tracks: program.tracks.map((item,i) => i === index ? { ...track, patterns: track.patterns!.filter(pattern => pattern.name !== name) } : item), sections: program.sections?.map(section => ({ ...section, tracks: section.tracks.map(binding => binding.track === track.name && binding.pattern === name ? { track: track.name } : binding) })) })}
                onChange={next => editTrack(index, next)} />
            </details>
          </>,
          sound: <>
            <div className="producer-track-editor-heading">
              <div className="producer-track-identity">
                <span className="producer-track-number">{String(index + 1).padStart(2, "0")}</span>
                <div className="producer-track-fields">
                  <Input className="producer-track-name" key={track.name} defaultValue={track.name} aria-label={`Track ${index + 1} name`} title="Use letters, numbers, and underscores. Start with a letter or underscore."
                    onBlur={event => {
                      if (event.target.value === track.name) return;
                      if (!editTrack(index, { ...track, name: event.target.value })) event.target.value = track.name;
                    }}
                    onKeyDown={event => {
                      if (event.key === "Escape") event.currentTarget.value = track.name;
                      if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
                    }} />
                  <Select value={track.source.name} aria-label={`${track.name} sound`} onChange={event => changeSound(index, event.target.value)}>{sounds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
                </div>
              </div>
              <label className="producer-track-gain">Level
                <Range min={0} max={1} step={0.01} value={track.gain} aria-label={`${track.name} gain`} aria-valuetext={`${Math.round(track.gain * 100)} percent`} onChange={event => editTrack(index, { ...track, gain: Number(event.target.value) })} />
                <output aria-label={`${track.name} level`}>{Math.round(track.gain * 100)}%</output>
              </label>
              {track.source.kind === "instrument" && phraseTrack.pianoRoll === undefined && <Select aria-label={`${track.name} pitch for new steps`} value={pitch[index] ?? 36} onChange={event => setPitch({ ...pitch, [index]: Number(event.target.value) })}>
                {Array.from({ length: 49 }, (_, i) => i + 24).map(midi => <option key={midi} value={midi}>{noteName(midi)}</option>)}
              </Select>}
              <Button variant="ghost" aria-label={`Remove ${track.name}`} onClick={() => remove(index)}>Remove track</Button>
            </div>
            <SoundDesign key={track.source.name} track={track} phrase={phraseTrack} disabled={draft || fileBusy} onChange={next => editTrack(index, next)} onPhraseChange={editPhrase} />
          </>,
          effects: <>
            <TrackEffects open track={track} tracks={program.tracks.map(item => item.name)} disabled={draft || fileBusy} onChange={next => editTrack(index, { ...track, ...next })} />
          </>,
          routing: <>
            <LevelMeter name={track.name} level={playback.meters.tracks[track.name]?.peak} />
            <TrackRouting program={program} index={index} onChange={edit} />
          </>,
          automation: <>
            <AutomationEditor name={track.name} curves={track.automation} effects={track.effects} beats={(phrase.bars ?? 1) * 4} onChange={automation => editTrack(index, { ...track, automation })} />
          </>,
        }} />
      </div>;
    return { row, editor };
  });

  function navigateStudio(next: AppDestination) {
    if (next === studio && !chatView) return;
    if (next !== "library" && !hasProject) { onRequireProject(next); return; }
    stopPlayback();
    setSingAlongOpen(false);
    setStudio(next);
    setChatView(false);
  }

  return (
    <AppShell onAddProject={showProjects} chats={hasProject ? chats : []} activeChat={chatView ? activeChat : undefined} onChat={id => void selectChat(id)} onNewChat={hasProject ? () => { if (canSwitchChat()) addChat(); } : undefined} onOpenRecent={id => void openRecent(id)} active={chatView ? "chat" : studio} expanded={sidebarExpanded} onToggle={onToggleSidebar} onNavigate={navigateStudio}>
    <main className="producer" data-view={chatView ? "chat" : beatStudio ? view : studio}>
      <header className="producer-header" hidden={chatView}>
        <a className="producer-wordmark" href="#studio" aria-label="Banger studio">banger<span>_</span></a>
        <div className="producer-project"><span className="producer-file-dot" aria-hidden="true" /><span>{projectName || <span className="producer-project-empty">no project</span>}{hasProject ? ` / ${fileName}` : ""}</span></div>
        <div className="producer-file-actions">
          {studio === "library" && !stageProgram && <BandStageButton disabled title="Select a song with a beat to open the band stage." />}
          {stageProgram && <PerformanceStage duration={stageRecording?.element.duration} program={stageProgram} fileName={beatStudio ? fileName : associatedBeat!.name} heroDisabled={(beatStudio && draft) || fileBusy || workspaceBusy} readPerformance={stagePlayback.readPerformance} playing={stagePlayback.state.playing} starting={stagePlayback.starting} tempo={stagePlayback.state.playing ? stagePlayback.state.tempo ?? stageProgram.tempo : stageProgram.tempo} tracks={stageProgram.tracks.length} error={stagePlayback.error} onPlay={stagePlayback.play} onStop={beatStudio ? stopPlayback : stagePlayback.stop} onOpen={() => { if (stageRecording) { associatedPlayback.stop(); stageRecording.prepare?.(); } }} />}
          {studio === "library" && <Button variant="secondary" disabled={!libraryRecording?.vocals} aria-pressed={singAlongOpen} aria-controls="library-sing-along" onClick={() => setSingAlongOpen(value => !value)}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></svg>
            Lyrics
          </Button>}
          <Button variant="secondary" onClick={() => void save()} disabled={!hasProject || !dirty || fileBusy || workspaceBusy || projectRunning}><ProjectIcon name="save" />Save</Button>
          {!vocalStudio && <AudioExport program={program} fileName={fileName} source={source} disabled={!hasProject || draft || fileBusy || workspaceBusy} cloud={cloudBinding?.source === source ? cloudBinding : null} />}
          <div ref={setVocalExportTarget} hidden={!vocalStudio} />
        </div>
      </header>

      {hasProject && <Modal ref={projectDialog} onClose={() => projectTrigger.current?.focus()} id="project-controls" className="producer-project-dialog" aria-labelledby="project-controls-title" aria-describedby="project-controls-description">
        <div className="producer-project-dialog-heading">
          <div className="project-dialog-title"><span className="project-dialog-emblem"><ProjectIcon name="folder" /></span><div><h2 id="project-controls-title">Projects</h2><p id="project-controls-description">Create a project, open a folder, or load the sample project.</p></div></div>
          <Button variant="secondary" onClick={() => projectDialog.current?.close()} aria-label="Close project controls"><ProjectIcon name="close" />Close</Button>
        </div>
        <DesktopProjectWorkspace sample={sample} studioBusy={fileBusy || workspaceBusy} onBusyChange={setWorkspaceBusy} key={currentFolder?.id ?? projectEpoch} initialFolder={currentFolder} savedFile={workspaceFile}
          onProjectOpened={() => { projectDialog.current?.close(); setStudio("beat"); setChatView(false); }}
          canReplace={canReplaceSong} canChangeProject={canSwitchChat}
          onFolderChange={folder => {
            if (folder.file) {
              const next: ChatSnapshot = { source: folder.file.source, appliedSource: folder.file.source, savedSource: folder.file.source, fileName: folder.file.path.split("/").pop()!, folder, workspaceFile: folder.file, cloudBinding: null };
              addChat(next, false);
            }
            setCurrentFolder(folder); window.dispatchEvent(new Event("banger:projects-changed"));
            setProjectEpoch(value => value + 1); setFolderName(folder.name); setProjectName(folder.name); setWorkspaceFile(null); setCloudBinding(null);
          }}
          onLoad={async (file, saved, name) => {
            await getProjectWorkspace().activate();
            loadOpenedFile({ name: file.path.split("/").pop()!, source: file.source });
            setProjectName(name); setSavedSource(saved); setWorkspaceFile({ ...file, source: saved }); setCloudBinding(null);
          }}
          songCard={<>
            <div className="project-file-identity"><ProjectIcon name="file" /><div><h2>{fileName}</h2><p>{dirty ? "Unsaved changes" : hasProject ? "Saved" : "No saved song"}{workspaceFile ? ` · ${workspaceFile.path}` : ""}</p></div></div>
            {notice && <p role="status">{notice}</p>}
          </>}
          cloudControls={<details className="project-cloud-controls"><summary>Cloud projects</summary>
            <CloudProjectWorkspace onDirtyChange={setCloudDraftDirty} onOpenMusic={()=>{projectDialog.current?.close();stopPlayback();setStudio("vocal");}} studioFile={{ name: fileName, source }} onDisconnect={() => { setCloudBinding(null); setProjectName(""); }} onLoad={(file, binding, name) => {
              if (!canReplaceSong()) return false;
              loadOpenedFile(file); setWorkspaceFile(null); setProjectName(name); setCloudBinding(binding); projectDialog.current?.close(); return true;
            }} />
          </details>}
        />
      </Modal>}

      <section hidden={chatView || !beatStudio} className="producer-transport" aria-label="Transport">
        <div className="producer-play-controls">
          <Button variant="primary" onClick={() => void playback.play()} disabled={playback.starting || playback.state.playing} className="producer-play">
            <span aria-hidden="true">▶</span> {playback.starting ? "Starting" : "Play"}
          </Button>
          <IconButton aria-label="Stop playback" variant="secondary" onClick={stopPlayback} disabled={!playback.state.playing && !playback.starting}><span aria-hidden="true">■</span></IconButton>
        </div>
        <div className="producer-playback-mode" role="group" aria-label="Playback mode">
          <Button variant={songMode ? "primary" : "secondary"} aria-pressed={songMode} disabled={draft || fileBusy || !program.timeline?.length} title={program.timeline?.length ? "Play the song arrangement" : "Add a song timeline to enable Song mode"} onClick={() => setTransportMode(true)}>Song</Button>
          <Button variant={!songMode ? "primary" : "secondary"} aria-pressed={!songMode} disabled={draft || fileBusy} onClick={() => setTransportMode(false)}>Pattern</Button>
        </div>
        <label className="producer-launch-pattern">Launch <Select aria-label="Launch pattern" value={program.activePattern ?? ""} disabled={draft || fileBusy} onChange={event => launchPattern(event.target.value)}>
          <option value="">Base</option>{patternNames.map(name => <option key={name} value={name}>{name}</option>)}
        </Select></label>
        <div className="producer-transport-summary">
          <LevelMeter name="Master" level={playback.meters.master.peak} />
          <div className="producer-meter"><strong>4/4</strong><span>{programDurationBeats(audibleProgram) / 4} bars · {songMode ? "Song" : "Pattern"}</span></div>
          <div className="producer-position" aria-label={playback.state.playing ? `Bar ${playback.state.bar}, step ${playback.state.step + 1}` : "Stopped"}>
            <span className={playback.state.playing ? "producer-live-dot is-playing" : "producer-live-dot"} />
            <span>{playback.state.playing ? `${String(Math.max(1, playback.state.bar)).padStart(2, "0")}.${String(playback.state.step + 1).padStart(2, "0")}` : "01.01"}</span>
          </div>
          {playback.state.hasPendingUpdate && <span className="producer-transport-state" role="status">Changes next bar</span>}
        </div>
        <TransportControls program={program} disabled={draft || fileBusy} onChange={edit} onFill={playback.setFill} fill={playback.fill}
          onTempo={tempo => { if (edit({ ...program, tempo })) setTempoDraft(String(tempo)); }}
          onLaunch={launchPattern} />
        <span className="producer-mode-status" role="status">{previewSection ? `Previewing ${previewSection}` : songMode ? "Song arrangement" : `Pattern loop · ${program.activePattern || "Base"}`}</span>
      </section>
      {!chatView && playback.error && <p className="producer-alert" role="alert">{playback.error}</p>}
      <Tabs hidden={chatView} className="producer-workspace" id="studio" value={view} onValueChange={value => setView(value as StudioView)}>
        <TabsList className="producer-tabs" variant="line" hidden={!beatStudio} aria-label="Studio views">
          {studioViews.map(item => <TabsTrigger key={item.id} value={item.id} onClick={() => setView(item.id)}
            id={`studio-tab-${item.id}`} aria-controls={`studio-panel-${item.id}`}>{item.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent forceMount value="sequencer" id="studio-panel-sequencer" aria-labelledby="studio-tab-sequencer" hidden={!beatStudio || view !== "sequencer"} tabIndex={0}>
          <Panel className="producer-sequencer" aria-labelledby="sequence-title">
            <div className="producer-panel-heading">
              <div className="producer-rack-title"><h1 id="sequence-title">Sequencer</h1><span>{program.tracks.length} tracks</span>
                <TooltipProvider delayDuration={150}><Tooltip>
                  <TooltipTrigger asChild><IconButton className="producer-help-button" variant="ghost" aria-label="Sequencer help"><ProjectIcon name="eye" /></IconButton></TooltipTrigger>
                  <TooltipContent className="producer-help-tooltip" side="bottom" align="start" sideOffset={8} collisionPadding={16}>
                    <p>Click or Space to toggle. Shift-click or focus to inspect. Arrow keys move; Shift + ↑ / ↓ adjusts velocity; E opens the inspector.</p>
                    <p><strong>Select a step</strong><br />Focus a step or Shift-click to inspect it.</p>
                  </TooltipContent>
                </Tooltip></TooltipProvider>
              </div>
              <div className="producer-sequence-controls">
                <label className="producer-tempo" htmlFor="producer-tempo">
                  <Input id="producer-tempo" type="number" inputMode="numeric" min={20} max={300} step={1} value={tempoDraft} disabled={draft || fileBusy}
                    onChange={event => setTempoDraft(event.target.value)}
                    onBlur={() => {
                      const tempo = Number(tempoDraft);
                      if (!Number.isFinite(tempo) || tempo < 20 || tempo > 300 || !edit({ ...program, tempo })) setTempoDraft(String(program.tempo));
                      else setTempoDraft(String(tempo));
                    }}
                    onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
                  <span>BPM</span>
                </label>
                <span className="producer-tag">{programDurationBeats(program) / 4} BARS</span>
              </div>
            </div>
            {draft && <div className="producer-draft-banner">Source has unapplied edits. Apply or revert the draft to edit the sequencer.</div>}

            <p id="producer-step-help" className="producer-sr-only">Click or Space to toggle. Shift-click or focus to inspect. Arrow keys move; Shift + ↑ / ↓ adjusts velocity; E opens the inspector.</p>
            <div className="producer-sequence-scroll" data-focused={expandedTrack !== null} role="region" aria-label="Shared beat grid" tabIndex={0} style={{ "--grid-beats": gridBeats, "--beat-width": `${beatWidth}px` } as CSSProperties}>
              <div className="producer-step-ruler" aria-hidden="true"><span className="producer-ruler-label">TRACK / PHRASE</span><div className="producer-beat-ruler">{Array.from({ length: gridBeats }, (_, beat) => <span key={beat} className={beat % 4 === 0 ? "is-beat" : ""}>{Math.floor(beat / 4) + 1}.{beat % 4 + 1}</span>)}</div><span className="producer-ruler-mix">M / S</span></div>
              <fieldset className="producer-tracks" disabled={draft || fileBusy} aria-label="Sequencer tracks">
                <div className="producer-track-list">{trackViews.map(item => item.row)}</div>
                <div className="producer-editors" hidden={expandedTrack === null}>{trackViews.map(item => item.editor)}</div>
              </fieldset>
            </div>
            <StepInspector name={hasSelectedStep ? inspectedTrack!.name : undefined} index={selectedStep?.index} pattern={selectedStep?.pattern}
              step={hasSelectedStep ? inspectedPhrase!.steps[selectedStep!.index] : undefined} disabled={draft || fileBusy}
              newStep={inspectedTrack?.source.kind === "sound" ? { kind: "hit" } : { kind: "note", midi: pitch[selectedStep?.track ?? 0] ?? 36 }}
              onChange={step => {
                if (!hasSelectedStep || !selectedStep || !inspectedTrack || !inspectedPhrase) return;
                const steps = inspectedPhrase.steps.map((item, index) => index === selectedStep.index ? step : item);
                editTrack(selectedStep.track, selectedStep.pattern
                  ? { ...inspectedTrack, patterns: inspectedTrack.patterns!.map(pattern => pattern.name === selectedStep.pattern ? { ...pattern, steps } : pattern) }
                  : { ...inspectedTrack, steps });
              }} />
            {program.tracks.length === 0 && <p className="producer-empty">No tracks yet. Add a track and tap a few steps.</p>}
            <div className="producer-sequence-footer"><Button variant="secondary" onClick={addTrack} disabled={draft || fileBusy || program.tracks.length >= 16}>+ Add track</Button></div>
          </Panel>

        </TabsContent>
        <TabsContent forceMount value="mixer" id="studio-panel-mixer" aria-labelledby="studio-tab-mixer" hidden={!beatStudio || view !== "mixer"} tabIndex={0}>
          <Panel><MixerView program={program} disabled={draft || fileBusy} meters={playback.meters} onTrackChange={editTrack} onChange={edit} /></Panel>
        </TabsContent>
        <TabsContent forceMount value="song" id="studio-panel-song" aria-labelledby="studio-tab-song" hidden={!beatStudio || view !== "song"} tabIndex={0}>
          <Panel><SongArrangement program={program} disabled={draft || fileBusy} section={playback.state.section} preview={previewSection} onPreview={preview} onChange={edit} /></Panel>
        </TabsContent>
        <TabsContent forceMount value="source" id="studio-panel-source" aria-labelledby="studio-tab-source" hidden={!beatStudio || view !== "source"} tabIndex={0}>
          <Panel className="producer-editor" aria-labelledby="source-title">
            <div className="producer-editor-heading"><div><p className="producer-eyebrow">The source</p><h2 id="source-title">{fileName}</h2></div><span className={`producer-source-status${result.error ? " has-error" : ""}`}>{result.error ? "Check source" : draft ? "Unapplied" : "In sync"}</span></div>
            <label className="producer-sr-only" htmlFor="producer-source">Banger source code</label>
            <SourceEditor source={source} error={result.error} errorOffset={result.errorOffset} disabled={fileBusy} editor={editor} onChange={writeSource} onApply={apply} />
            <div className="producer-editor-actions"><Button variant="primary" disabled={!draft || !result.program || fileBusy} onClick={apply}>Apply source</Button><Button variant="ghost" disabled={!draft || fileBusy} onClick={() => { writeSource(appliedSource); setNotice("Draft reverted to the current sequence."); }}>Revert draft</Button><span>⌘ / Ctrl + Enter</span></div>
            <div id="producer-diagnostics" className={result.error ? "producer-diagnostics has-error" : "producer-diagnostics"} role="status">{result.error ?? (draft ? "Source is valid. Apply it to update the sequence." : "Compiled. The source and sequence match.")}</div>
            <p id="producer-source-help" className="producer-source-help">The first compiler error is underlined in red. Edits stay in this tab until saved. Invalid drafts keep the last applied sequence playing. Save also preserves unapplied drafts.</p>
          </Panel>
        </TabsContent>
        <div id="vocal-studio" hidden={!vocalStudio}>
          {hasProject && <MusicWorkshop exportTarget={vocalExportTarget} hasProject={hasProject} onLyricAgent={setLyricAgent} key={`${projectEpoch}:${cloudBinding?.projectId ?? "local"}:${cloudBinding?.path ?? workspaceFile?.path ?? fileName}`} cloud={cloudMusicContext} studioPath={cloudBinding?.path ?? workspaceFile?.path ?? fileName} studioFile={{ name:fileName,source }} onEditStateChange={setVocalEdits} active={vocalStudio && !chatView} onRecordingChange={setVocalRecording} onBeatChange={setVocalBeat} onConnect={()=>{showProjects();const panel=document.getElementById('cloud-projects') as HTMLDetailsElement|null;if(panel)panel.open=true;}}/>}
        </div>
        {studio === "library" && <SongLibrary onOpenProject={id => void openRecent(id)} onRecordingChange={setLibraryRecording} onBeatChange={setLibraryBeat} singAlong={singAlongOpen} onCloseSingAlong={() => setSingAlongOpen(false)} />}
      </Tabs>
        {hasProject && !chatView && <AIChatLauncher onNewChat={() => { if (canSwitchChat()) addChat(); }} />}
        {hasProject && chats.map(chat => {
          const selected = chat.id === activeChat;
          const bound = selected ? snapshot : chat.snapshot;
          return <AIChat key={chat.id} chatId={chat.id} projectId={bound.folder?.id} active={selected && chatView} initialHistory={chat.history} onUpdate={updateChat}
            onFullSend={runFullSend} onFullSendCheck={checkFullSend} onLyrics={runLyrics} vocalStudio={vocalStudio} source={bound.source} fileName={bound.fileName} revision={sourceRevision} fileBusy={fileBusy || workspaceBusy || chats.some(other => other.id !== chat.id && other.status === "running" && other.snapshot.folder?.id === bound.folder?.id)}
            onLoad={(file, requestRevision, automatic) => { if (activeChatRef.current === chat.id) loadGeneratedFile(file, requestRevision, automatic); }}
            folderName={bound.folder?.name ?? ""} projectEpoch={projectEpoch} activeFile={bound.workspaceFile?.path} projectDirty={bound.source !== bound.savedSource}
            onResolveEdits={resolveEditsForAI} onProjectComplete={() => { if (activeChatRef.current === chat.id && !vocalEditsRef.current.dirty && !vocalEditsRef.current.busy) setProjectEpoch(value => value + 1); }}
            onProjectFile={(file, requestRevision) => {
              const current = chatsRef.current.find(item => item.id === chat.id);
              if (!current) return;
              const latest = activeChatRef.current === chat.id ? snapshotRef.current : current.snapshot;
              if ((latest.source !== bound.source && latest.revision !== requestRevision) || latest.workspaceFile?.path !== file.path) {
                if (activeChatRef.current === chat.id) setNotice("The agent saved project changes. Your newer studio edits are preserved. Reopen the saved song to review them.");
                return;
              }
              const next = { ...latest, source: file.source, appliedSource: file.source, savedSource: file.source, workspaceFile: file };
              updateChat(chat.id, { snapshot: next });
              if (activeChatRef.current === chat.id) {
                loadOpenedFile({ name: file.path.split("/").pop()!, source: file.source }); setWorkspaceFile(file);
                snapshotRef.current = next;
              }
            }} />;
        })}

      {emptyRecent && <FirstSongDialog folder={emptyRecent} onCreated={openedRecent} />}
      {children}
      <footer className="producer-footer"><span role="status">{notice}</span></footer>
    </main>
    </AppShell>
  );
}
