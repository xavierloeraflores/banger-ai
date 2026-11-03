"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  compileMusic,
  serializeMusic,
  programDurationBeats,
  resolvePattern,
  resolveArrangement,
  type MusicProgram,
  type MusicTrack,
  type SoundName,
  type InstrumentName,
} from "@banger/compiler";
import { Button, IconButton, Input, Panel, Range, Select } from "@banger/shadcn";
import { openProject, saveProject } from "@/lib/project-files";
import { SongArrangement } from "./song-arrangement";
import { SequencerStep } from "./sequencer-step";
import { TransportControls } from "./transport-controls";
import { PatternControls } from "./pattern-controls";
import { AutomationEditor } from "./automation-editor";
import { TrackRouting, LevelMeter } from "./mixer-routing";
import { MixerView } from "./mixer-view";
import { AudioExport } from "./audio-export";
import { MusicWorkshop } from "./music-workshop";
import { CloudProjectWorkspace } from "./cloud-project-workspace";
import type { CloudMusicContext } from "@/lib/elevenlabs";
import type { CloudBinding } from "@/lib/cloud-projects";
import { SoundDesign } from "./sound-design";
import { TrackEffects } from "./track-effects";
import { PianoRoll } from "./piano-roll";
import { usePlayer } from "./use-player";
import { SettingsMenu } from "./settings-menu";
import { AIModelSelect } from "./ai-model-select";
import { DesktopProjectWorkspace } from "./desktop-project-workspace";
import { AIChat } from "./ai-chat";
import { ProjectStart } from "./project-start";
import type { ProjectFolder, WorkspaceFile } from "@/lib/project-workspace";
import type { BangerFile } from "@banger/agent/protocol";
import "./producer.css";
import "./mixer-song.css";

const studioViews = [
  { id: "sequencer", label: "Sequencer" },
  { id: "mixer", label: "Mixer" },
  { id: "song", label: "Song" },
  { id: "source", label: "Raw .banger" },
  { id: "elevenlabs", label: "ElevenLabs" },
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
  const [session, setSession] = useState<{ file: BangerFile; saved: boolean; folder?: ProjectFolder } | null>(null);
  if (!session) return <ProjectStart sample={initialFile} onStart={(file, saved, folder) => setSession({ file, saved, folder })} />;
  return <Studio initialFile={session.file} sample={initialFile} initiallySaved={session.saved} initialFolder={session.folder} />;
}

function Studio({ initialFile, sample, initiallySaved, initialFolder }: { initialFile: BangerFile; sample: BangerFile; initiallySaved: boolean; initialFolder?: ProjectFolder }) {
  const projectDialog = useRef<HTMLDialogElement>(null);
  const projectTrigger = useRef<HTMLButtonElement>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceFile, setWorkspaceFile] = useState<WorkspaceFile | null>(initialFolder?.file ?? null);
  useEffect(() => { if (initialFolder) projectDialog.current?.showModal(); }, [initialFolder]);
  function showProjects() { projectDialog.current?.showModal(); }
  const [cloudMusicContext,setCloudMusicContext]=useState<CloudMusicContext>();
  const [cloudBinding, setCloudBinding] = useState<CloudBinding | null>(null);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [initialProgram] = useState(() => {
    try { return { program: compileMusic(initialFile.source), source: initialFile.source }; }
    catch { return { program: compileMusic(sample.source), source: sample.source }; }
  });
  const [view, setView] = useState<StudioView>(initialProgram.source === initialFile.source ? "sequencer" : "source");
  const [program, setProgram] = useState<MusicProgram>(initialProgram.program);
  const [appliedSource, setAppliedSource] = useState(initialProgram.source);
  const [source, setSource] = useState(initialFile.source);
  const [savedSource, setSavedSource] = useState(initialFile.source);
  const [hasProject, setHasProject] = useState(initiallySaved);
  const [fileName, setFileName] = useState(initialFile.name);
  const [tempoDraft, setTempoDraft] = useState(String(program.tempo));
  const [previewSection, setPreviewSection] = useState<string | undefined>();
  const [expandedTrack, setExpandedTrack] = useState<number | null>(null);
  const [patterns, setPatterns] = useState<Record<number, string>>({});
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
    catch (cause) { return { program: null, error: diagnose(cause) }; }
  }, [source]);
  const audibleProgram = useMemo(() => previewSection && program.sections?.some(section => section.name === previewSection)
    ? { ...program, chainEnabled: true, timeline: [{ section: previewSection }] } : program, [program, previewSection]);
  const playback = usePlayer(audibleProgram);
  const arrangement = useMemo(() => resolveArrangement(audibleProgram), [audibleProgram]);
  const stopPlayback = () => { playback.stop(); setPreviewSection(undefined); };
  const preview = (name?: string) => { if (name || previewSection) playback.stop(); setPreviewSection(name); };
  const playPreview = playback.play;
  useEffect(() => {
    if (previewSection) void playPreview();
  }, [previewSection, playPreview]);
  const hasSolo = program.tracks.some(track => track.solo);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

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

  async function open() {
    if (filePending.current || workspaceBusy) return;
    if (dirty && !window.confirm("Open another project? Unsaved changes in this tab will be replaced.")) return;
    filePending.current = true;
    setFileBusy(true);
    setNotice(null);
    try {
      const file = await openProject();
      if (!file) return;
      loadOpenedFile(file);
      setWorkspaceFile(null);
      setCloudBinding(null);
    } catch (cause) { setNotice(message(cause)); }
    finally { filePending.current = false; setFileBusy(false); }
  }

  async function save() {
    if (filePending.current || workspaceBusy) return;
    filePending.current = true;
    setFileBusy(true);
    const snapshot = sourceRef.current;
    const savedRevision = revision.current;
    setNotice(null);
    try {
      const folderFile = workspaceFile && window.bangerWorkspace
        ? await window.bangerWorkspace.save(workspaceFile.path, snapshot, workspaceFile.source)
        : null;
      const file = folderFile ? { name: folderFile.path.split("/").pop()! } : await saveProject(snapshot, fileName);
      if (folderFile) setWorkspaceFile(folderFile);
      if (file) {
        setFileName(file.name);
        setHasProject(true);
        setSavedSource(snapshot);
        setNotice(revision.current === savedRevision ? `Saved ${file.name}.` : "Saved the earlier version. Your newer edits are still unsaved.");
      }
    } catch (cause) { setNotice(message(cause)); }
    finally { filePending.current = false; setFileBusy(false); }
  }

  function loadGeneratedFile(file: BangerFile, generatedRevision: number) {
    if (filePending.current || workspaceBusy) return;
    if (revision.current !== generatedRevision && !window.confirm("Your project changed after this request. Load the generated file and replace the current editor?")) return;
    try {
      const next = compileMusic(file.source);
      setProgram(next);
      setAppliedSource(file.source);
      writeSource(file.source);
      setSavedSource("");
      setWorkspaceFile(null);
      setFileName(file.name);
      setTempoDraft(String(next.tempo));
      setPreviewSection(undefined);
      setPitch({});
      setPatterns({});
      setExpandedTrack(null);
      setEditorEpoch(value => value + 1);
      setNotice(`Loaded ${file.name}. Save .banger to keep it.`);
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
    editTrack(index, next);
  }

  return (
    <main className="producer" data-view={view}>
      <header className="producer-header">
        <a className="producer-wordmark" href="#studio" aria-label="Banger studio">banger<span>_</span></a>
        <div className="producer-project"><span className="producer-file-dot" aria-hidden="true" />{fileName}{(dirty || !hasProject) && <span className="producer-dim">{dirty ? "Unsaved" : "No project"}</span>}</div>
        {view!=="elevenlabs"&&<AIModelSelect />}
        <div className="producer-file-actions">
          <Button ref={projectTrigger} variant="secondary" onClick={showProjects} aria-haspopup="dialog" aria-controls="project-controls">Project</Button>
        </div>
        <SettingsMenu />
      </header>

      <dialog ref={projectDialog} onClose={() => projectTrigger.current?.focus()} id="project-controls" className="producer-project-dialog" aria-labelledby="project-controls-title" aria-describedby="project-controls-description">
        <div className="producer-project-dialog-heading">
          <div><h2 id="project-controls-title">Project</h2><p id="project-controls-description">Open, save, export audio, and manage your music files.</p></div>
          <Button variant="ghost" onClick={() => projectDialog.current?.close()} aria-label="Close project controls">Close</Button>
        </div>
        <section className="project-workspace producer-panel" aria-label="Studio file">
          <h2>{fileName}</h2><p>{dirty ? "Unsaved changes" : hasProject ? "Saved" : "No saved project"}{workspaceFile ? ` · ${workspaceFile.path}` : ""}</p>
          <div className="project-workspace-actions">
            <Button variant="ghost" onClick={open} disabled={fileBusy || workspaceBusy}>Open</Button>
            <Button variant="secondary" onClick={save} disabled={fileBusy || workspaceBusy}>Save .banger</Button>
          </div>
          {notice && <p role="status">{notice}</p>}
        </section>
        <AudioExport program={program} fileName={fileName} disabled={draft || fileBusy} cloud={cloudBinding?.source === source ? cloudBinding : null} />
        <DesktopProjectWorkspace studioBusy={fileBusy} onBusyChange={setWorkspaceBusy} initialFolder={initialFolder} savedFile={workspaceFile} onFolderChange={() => setWorkspaceFile(null)} onLoad={(file, saved) => {
          if (filePending.current || (dirty && !window.confirm("Load this workspace file and replace unsaved studio edits?"))) return;
          loadOpenedFile({ name: file.path.split("/").pop()!, source: file.source });
          setSavedSource(saved); setWorkspaceFile({ ...file, source: saved }); setCloudBinding(null);
          projectDialog.current?.close();
        }} />
        <CloudProjectWorkspace onMusicContextChange={setCloudMusicContext} onOpenMusic={()=>{projectDialog.current?.close();stopPlayback();setView("elevenlabs");}} studioFile={{ name: fileName, source }} onDisconnect={() => setCloudBinding(null)} onLoad={(file, binding) => {
          if (!window.confirm("Load this cloud file and replace the current studio editor?")) return;
          loadGeneratedFile(file, sourceRevision); setCloudBinding(binding); projectDialog.current?.close();
        }} />
      </dialog>

      <section className="producer-transport" aria-label="Transport">
        <div className="producer-play-controls">
          <Button variant="primary" onClick={() => void playback.play()} disabled={playback.starting || playback.state.playing} className="producer-play">
            <span aria-hidden="true">▶</span> {playback.starting ? "Starting" : "Play"}
          </Button>
          <IconButton aria-label="Stop playback" variant="secondary" onClick={stopPlayback} disabled={!playback.state.playing && !playback.starting}><span aria-hidden="true">■</span></IconButton>
        </div>
        <div className="producer-meter"><strong>4/4</strong><span>{programDurationBeats(program) / 4} bar song</span></div>
        <div className="producer-position" aria-label={playback.state.playing ? `Bar ${playback.state.bar}, step ${playback.state.step + 1}` : "Stopped"}>
          <span className={playback.state.playing ? "producer-live-dot is-playing" : "producer-live-dot"} />
          <span>{playback.state.playing ? `${String(Math.max(1, playback.state.bar)).padStart(2, "0")}.${String(playback.state.step + 1).padStart(2, "0")}` : "01.01"}</span>
        </div>
        <span className="producer-transport-state">{playback.state.hasPendingUpdate ? "Changes next bar" : playback.state.playing ? "Playing" : null}</span>
        <TransportControls program={program} disabled={draft || fileBusy} onChange={edit} onFill={playback.setFill}
          onTempo={tempo => { if (edit({ ...program, tempo })) setTempoDraft(String(tempo)); }}
          onLaunch={(name, next = program) => { const launch = { ...next, chainEnabled: false }; if (name) launch.activePattern = name; else delete launch.activePattern; if (edit(launch)) { setPreviewSection(undefined); setPatterns(Object.fromEntries(next.tracks.map((track, index) => [index, track.patterns?.some(pattern => pattern.name === name) ? name : ""]))); } }} />
        <LevelMeter name="Master" level={playback.meters.master.peak} />
      </section>
      {playback.error && <p className="producer-alert" role="alert">{playback.error}</p>}
      <div className="producer-workspace" id="studio">
        <div className="producer-tabs" role="tablist" aria-label="Studio views">
          {studioViews.map((item, index) => <button key={item.id} type="button" role="tab"
            id={`studio-tab-${item.id}`} aria-controls={`studio-panel-${item.id}`} aria-selected={view === item.id}
            tabIndex={view === item.id ? 0 : -1} onClick={() => {if(item.id==="elevenlabs")stopPlayback();setView(item.id);}}
            onKeyDown={event => {
              const nextIndex = event.key === "ArrowRight" ? (index + 1) % studioViews.length
                : event.key === "ArrowLeft" ? (index + studioViews.length - 1) % studioViews.length
                : event.key === "Home" ? 0 : event.key === "End" ? studioViews.length - 1 : null;
              if (nextIndex === null) return;
              event.preventDefault();
              const next = studioViews[nextIndex]!;
              if(next.id==="elevenlabs")stopPlayback();setView(next.id);
              document.getElementById(`studio-tab-${next.id}`)?.focus();
            }}>{item.label}</button>)}
        </div>
        <div id="studio-panel-sequencer" role="tabpanel" aria-labelledby="studio-tab-sequencer" hidden={view !== "sequencer"} tabIndex={0}>
          <Panel className="producer-sequencer" aria-labelledby="sequence-title">
            <div className="producer-panel-heading">
              <div className="producer-rack-title"><h1 id="sequence-title">Sequencer</h1><span>{program.tracks.length} tracks</span></div>
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

            <div className="producer-sequence-scroll">
              <div className="producer-step-ruler" aria-hidden="true"><span>TRACK / SOUND</span><span>STEPS / SELECTED PHRASE</span><span>M / S</span></div>
              <fieldset className="producer-tracks" disabled={draft || fileBusy} aria-label="Sequencer tracks">
                {program.tracks.map((track, index) => {
                  const requestedPattern = patterns[index] ?? program.activePattern;
                  const selectedPattern = track.patterns?.some(pattern => pattern.name === requestedPattern) ? requestedPattern : undefined;
                  const phrase = resolvePattern(track, selectedPattern);
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
                  return <div className={`producer-track${track.muted || (hasSolo && !track.solo) ? " is-muted" : ""}`} key={index}>
                    <button type="button" className="producer-track-toggle" aria-label={`Edit ${track.name}`} aria-expanded={expandedTrack === index} aria-controls={`track-editor-${index}`}
                      title={`Edit ${track.name} sound, pattern and mix`} onClick={() => setExpandedTrack(expandedTrack === index ? null : index)}>
                      <span className="producer-track-number">{String(index + 1).padStart(2, "0")}</span>
                      <span className="producer-track-label"><strong>{track.name}</strong><small>{sounds.find(([value]) => value === track.source.name)?.[1] ?? track.source.name}{selectedPattern ? ` · ${selectedPattern}` : ""}</small></span>
                      <span className="producer-track-chevron" aria-hidden="true">{expandedTrack === index ? "▾" : "▸"}</span>
                    </button>
                    {phraseTrack.pianoRoll !== undefined ? <button type="button" className="producer-phrase-preview" aria-label={`Edit ${track.name} piano roll`} aria-expanded={expandedTrack === index} aria-controls={`track-editor-${index}`} onClick={() => setExpandedTrack(expandedTrack === index ? null : index)}>
                      <svg viewBox="0 0 1000 32" preserveAspectRatio="none" aria-hidden="true">
                        {phraseTrack.pianoRoll.map((note, noteIndex) => <rect key={noteIndex} x={note.start / ((phrase.bars ?? 1) * 4) * 1000} y={3 + (highestPitch - note.midi) / (highestPitch - lowestPitch) * 23} width={Math.max(3, note.duration / ((phrase.bars ?? 1) * 4) * 1000)} height={3} rx={1} />)}
                        {phrasePlaying && <line x1={(phase % 1) * 1000} x2={(phase % 1) * 1000} y1={0} y2={32} />}
                      </svg>
                      <span>{phraseTrack.pianoRoll.length} notes · {phrase.bars ?? 1} {(phrase.bars ?? 1) === 1 ? "bar" : "bars"}</span>
                    </button> : <div className="producer-step-grid" style={{ "--track-steps": phraseTrack.steps.length } as CSSProperties} role="group" aria-label={`${track.name} steps`}>
                      {phraseTrack.steps.map((step, stepIndex) => <SequencerStep key={stepIndex} step={step} index={stepIndex} name={track.name}
                        current={phrasePlaying && Math.floor(phase * phraseTrack.steps.length) === stepIndex}
                        newStep={track.source.kind === "sound" ? { kind: "hit" } : { kind: "note", midi: pitch[index] ?? 36 }}
                        onChange={next => editPhrase({ ...phraseTrack, steps: phraseTrack.steps.map((item, i) => i === stepIndex ? next : item) })} />)}
                    </div>}
                    <div className="producer-track-mix">
                      <Button className="producer-track-mute" variant={!!track.muted ? "primary" : "ghost"} aria-pressed={!!track.muted} aria-label={`Mute ${track.name}`} title={!!track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`} onClick={() => editTrack(index, { ...track, muted: !track.muted })}>M</Button>
                      <Button variant={!!track.solo ? "primary" : "ghost"} aria-pressed={!!track.solo} aria-label={`Solo ${track.name}`} title={`Solo ${track.name}`} onClick={() => editTrack(index, { ...track, solo: !track.solo })}>S</Button>
                    </div>
                    <div className="producer-track-editor" id={`track-editor-${index}`} hidden={expandedTrack !== index}>
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
                        <IconButton variant="ghost" aria-label={`Close ${track.name} editor`} onClick={() => { setExpandedTrack(null); document.querySelector<HTMLButtonElement>(`[aria-controls="track-editor-${index}"]`)?.focus(); }}>×</IconButton>
                      </div>
                      <PatternControls track={track} selected={selectedPattern ?? ""} onSelect={name => setPatterns({ ...patterns, [index]: name })}
                        onRename={(oldName, name) => edit({ ...program, tracks: program.tracks.map((item,i) => i === index ? { ...track, patterns: track.patterns!.map(pattern => pattern.name === oldName ? { ...pattern, name } : pattern) } : item), sections: program.sections?.map(section => ({ ...section, tracks: section.tracks.map(binding => binding.track === track.name && binding.pattern === oldName ? { ...binding, pattern: name } : binding) })) })}
                        onRemove={name => edit({ ...program, tracks: program.tracks.map((item,i) => i === index ? { ...track, patterns: track.patterns!.filter(pattern => pattern.name !== name) } : item), sections: program.sections?.map(section => ({ ...section, tracks: section.tracks.map(binding => binding.track === track.name && binding.pattern === name ? { track: track.name } : binding) })) })}
                        onChange={next => editTrack(index, next)} />
                      <LevelMeter name={track.name} level={playback.meters.tracks[track.name]?.peak} />
                      <TrackRouting program={program} index={index} onChange={edit} />
                      <SoundDesign track={track} phrase={phraseTrack} disabled={draft || fileBusy} onChange={next => editTrack(index, next)} onPhraseChange={editPhrase} />
                      <TrackEffects track={track} tracks={program.tracks.map(item => item.name)} disabled={draft || fileBusy} onChange={next => editTrack(index, { ...track, ...next })} />
                      <AutomationEditor name={track.name} curves={track.automation} effects={track.effects} beats={(phrase.bars ?? 1) * 4} onChange={automation => editTrack(index, { ...track, automation })} />
                      {track.source.kind === "instrument" && <PianoRoll key={`${editorEpoch}-${track.name}-${selectedPattern ?? "base"}`} track={phraseTrack} beats={(phrase.bars ?? 1) * 4} disabled={draft || fileBusy} visible={view === "sequencer" && expandedTrack === index} playing={phrasePlaying} phase={phase} onChange={editPhrase} />}
                    </div>
                  </div>;
                })}
              </fieldset>
            </div>
            {program.tracks.length === 0 && <p className="producer-empty">No tracks yet. Add a track and tap a few steps.</p>}
            <div className="producer-sequence-footer"><Button variant="secondary" onClick={addTrack} disabled={draft || fileBusy || program.tracks.length >= 16}>+ Add track</Button></div>
          </Panel>

        </div>
        <div id="studio-panel-mixer" role="tabpanel" aria-labelledby="studio-tab-mixer" hidden={view !== "mixer"} tabIndex={0}>
          <Panel><MixerView program={program} disabled={draft || fileBusy} meters={playback.meters} onTrackChange={editTrack} onChange={edit} /></Panel>
        </div>
        <div id="studio-panel-song" role="tabpanel" aria-labelledby="studio-tab-song" hidden={view !== "song"} tabIndex={0}>
          <Panel><SongArrangement program={program} disabled={draft || fileBusy} section={playback.state.section} preview={previewSection} onPreview={preview} onChange={edit} /></Panel>
        </div>
        <div id="studio-panel-source" role="tabpanel" aria-labelledby="studio-tab-source" hidden={view !== "source"} tabIndex={0}>
          <Panel className="producer-editor" aria-labelledby="source-title">
            <div className="producer-editor-heading"><div><p className="producer-eyebrow">The source</p><h2 id="source-title">{fileName}</h2></div><span className={`producer-source-status${result.error ? " has-error" : ""}`}>{result.error ? "Check source" : draft ? "Unapplied" : "In sync"}</span></div>
            <label className="producer-sr-only" htmlFor="producer-source">Banger source code</label>
            <textarea id="producer-source" ref={editor} value={source} disabled={fileBusy} onChange={event => writeSource(event.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off" aria-invalid={Boolean(result.error)} aria-describedby="producer-source-help producer-diagnostics"
              onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); apply(); } }} />
            <div className="producer-editor-actions"><Button variant="primary" disabled={!draft || !result.program || fileBusy} onClick={apply}>Apply source</Button><Button variant="ghost" disabled={!draft || fileBusy} onClick={() => { writeSource(appliedSource); setNotice("Draft reverted to the current sequence."); }}>Revert draft</Button><span>⌘ / Ctrl + Enter</span></div>
            <div id="producer-diagnostics" className={result.error ? "producer-diagnostics has-error" : "producer-diagnostics"} role="status">{result.error ?? (draft ? "Source is valid. Apply it to update the sequence." : "Compiled. The source and sequence match.")}</div>
            <p id="producer-source-help" className="producer-source-help">Edits stay in this tab until saved. Invalid drafts keep the last applied sequence playing. Save also preserves unapplied drafts.</p>
          </Panel>
        </div>
        <div id="studio-panel-elevenlabs" role="tabpanel" aria-labelledby="studio-tab-elevenlabs" hidden={view!=="elevenlabs"}>
          <MusicWorkshop cloud={cloudMusicContext} studioFile={{ name:fileName,source }} active={view==="elevenlabs"} onConnect={()=>{showProjects();const panel=document.getElementById('cloud-projects') as HTMLDetailsElement|null;if(panel)panel.open=true;}}/>
        </div>
        <div hidden={view==="elevenlabs"}><AIChat source={source} fileName={fileName} revision={sourceRevision} fileBusy={fileBusy} onLoad={loadGeneratedFile} /></div>
      </div>
      <footer className="producer-footer"><span role="status">{notice}</span></footer>
    </main>
  );
}
