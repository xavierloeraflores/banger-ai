"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  compileMusic,
  createDefaultProgram,
  serializeMusic,
  type MusicProgram,
  type MusicTrack,
} from "@banger/compiler";
import { Button, IconButton, Input, Panel, Range, Select, StepButton } from "@banger/shadcn";
import { openProject, saveProject } from "@/lib/project-files";
import { usePlayer } from "./use-player";
import "./producer.css";

const sounds = [
  ["drums/kick", "Kick"],
  ["drums/snare", "Snare"],
  ["drums/hat", "Hi-hat"],
  ["synth/bass", "Bass"],
  ["synth/pluck", "Pluck"],
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

export function Producer() {
  const [program, setProgram] = useState<MusicProgram>(() => createDefaultProgram());
  const [appliedSource, setAppliedSource] = useState(() => serializeMusic(program));
  const [source, setSource] = useState(appliedSource);
  const [savedSource, setSavedSource] = useState(appliedSource);
  const [fileName, setFileName] = useState("first-loop.banger");
  const [tempoDraft, setTempoDraft] = useState(String(program.tempo));
  const [muted, setMuted] = useState<Set<number>>(() => new Set());
  const [solo, setSolo] = useState<Set<number>>(() => new Set());
  const [pitch, setPitch] = useState<Record<number, number>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const filePending = useRef(false);
  const sourceRef = useRef(source);
  const revision = useRef(0);
  const editor = useRef<HTMLTextAreaElement>(null);
  const draft = source !== appliedSource;
  const dirty = source !== savedSource;
  const result = useMemo(() => {
    try { return { program: compileMusic(source), error: null }; }
    catch (cause) { return { program: null, error: diagnose(cause) }; }
  }, [source]);
  const audibleProgram = useMemo(() => ({
    ...program,
    tracks: program.tracks.map((track, index) => ({
      ...track,
      gain: muted.has(index) || (solo.size > 0 && !solo.has(index)) ? 0 : track.gain,
    })),
  }), [program, muted, solo]);
  const playback = usePlayer(audibleProgram);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function writeSource(next: string) {
    sourceRef.current = next;
    revision.current += 1;
    setSource(next);
  }

  function edit(next: MusicProgram) {
    if (draft || fileBusy) return;
    try {
      const text = serializeMusic(next);
      const checked = compileMusic(text);
      setProgram(checked);
      setAppliedSource(text);
      writeSource(text);
      setNotice(null);
      return true;
    } catch (cause) { setNotice(diagnose(cause)); return false; }
  }

  function editTrack(index: number, track: MusicTrack) {
    return edit({ ...program, tracks: program.tracks.map((item, i) => i === index ? track : item) });
  }

  function apply() {
    if (!result.program) { editor.current?.focus(); return; }
    setProgram(result.program);
    setTempoDraft(String(result.program.tempo));
    setAppliedSource(source);
    setMuted(new Set());
    setSolo(new Set());
    setPitch({});
    setNotice("Source applied. Mute and solo reset.");
  }

  function toggle(set: Set<number>, index: number, update: (value: Set<number>) => void) {
    const next = new Set(set);
    if (next.has(index)) next.delete(index); else next.add(index);
    update(next);
  }

  function remove(index: number) {
    if (!edit({ ...program, tracks: program.tracks.filter((_, i) => i !== index) })) return;
    const shift = (set: Set<number>) => new Set([...set].filter(i => i !== index).map(i => i > index ? i - 1 : i));
    setMuted(shift(muted));
    setSolo(shift(solo));
    setPitch({});
  }

  function addTrack() {
    let suffix = program.tracks.length + 1;
    while (program.tracks.some(track => track.name === `track_${suffix}`)) suffix += 1;
    edit({ ...program, tracks: [...program.tracks, {
      name: `track_${suffix}`, source: { kind: "sound", name: "drums/hat" },
      steps: Array.from({ length: 16 }, () => null), gain: 0.5,
    }] });
  }

  async function open() {
    if (filePending.current) return;
    if (dirty && !window.confirm("Open another project? Unsaved changes in this tab will be replaced.")) return;
    filePending.current = true;
    setFileBusy(true);
    setNotice(null);
    try {
      const file = await openProject();
      if (!file) return;
      // Keep invalid files editable; the last valid sequence remains available.
      writeSource(file.source);
      setSavedSource(file.source);
      setFileName(file.name);
      try {
        const next = compileMusic(file.source);
        setProgram(next);
        setAppliedSource(file.source);
        setTempoDraft(String(next.tempo));
        setMuted(new Set());
        setSolo(new Set());
        setPitch({});
        setNotice(`Opened ${file.name}.`);
      } catch { setNotice("File opened as a draft. Fix the errors, then apply it."); }
    } catch (cause) { setNotice(message(cause)); }
    finally { filePending.current = false; setFileBusy(false); }
  }

  async function save() {
    if (filePending.current) return;
    filePending.current = true;
    setFileBusy(true);
    const snapshot = sourceRef.current;
    const savedRevision = revision.current;
    setNotice(null);
    try {
      const file = await saveProject(snapshot, fileName);
      if (file) {
        setFileName(file.name);
        setSavedSource(snapshot);
        setNotice(revision.current === savedRevision ? `Saved ${file.name}.` : "Saved the earlier version. Your newer edits are still unsaved.");
      }
    } catch (cause) { setNotice(message(cause)); }
    finally { filePending.current = false; setFileBusy(false); }
  }

  function changeSound(index: number, name: string) {
    const track = program.tracks[index];
    if (!track) return;
    const instrument = name.startsWith("synth/");
    const selected = sounds.find(([value]) => value === name);
    if (!selected) return;
    const nextSource: MusicTrack["source"] = instrument
      ? { kind: "instrument", name: name as "synth/bass" | "synth/pluck" }
      : { kind: "sound", name: name as "drums/kick" | "drums/snare" | "drums/hat" };
    editTrack(index, { ...track, source: nextSource, steps: track.steps.map(step => !step ? null : instrument
      ? { kind: "note", midi: step.kind === "note" ? step.midi : pitch[index] ?? 36 }
      : { kind: "hit" }) });
  }

  return (
    <main className="producer">
      <header className="producer-header">
        <a className="producer-wordmark" href="#studio" aria-label="Banger studio">banger<span>_</span></a>
        <div className="producer-project"><span className="producer-file-dot" aria-hidden="true" />{fileName}<span className="producer-dim">{dirty ? "Unsaved" : "Local project"}</span></div>
        <div className="producer-file-actions">
          <Button variant="ghost" onClick={open} disabled={fileBusy}>Open</Button>
          <Button variant="secondary" onClick={save} disabled={fileBusy}>Save .banger</Button>
        </div>
      </header>

      <section className="producer-transport" aria-label="Transport">
        <div className="producer-play-controls">
          <Button variant="primary" onClick={() => void playback.play()} disabled={playback.starting || playback.state.playing} className="producer-play">
            <span aria-hidden="true">▶</span> {playback.starting ? "Starting" : "Play"}
          </Button>
          <IconButton aria-label="Stop playback" variant="secondary" onClick={playback.stop} disabled={!playback.state.playing && !playback.starting}><span aria-hidden="true">■</span></IconButton>
        </div>
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
        <div className="producer-meter"><strong>4/4</strong><span>1 bar · 1/16 grid</span></div>
        <div className="producer-position" aria-label={playback.state.playing ? `Bar ${playback.state.bar}, step ${playback.state.step + 1}` : "Stopped"}>
          <span className={playback.state.playing ? "producer-live-dot is-playing" : "producer-live-dot"} />
          <span>{playback.state.playing ? `${String(Math.max(1, playback.state.bar)).padStart(2, "0")}.${String(playback.state.step + 1).padStart(2, "0")}` : "01.01"}</span>
        </div>
        <span className="producer-transport-state">{playback.state.hasPendingUpdate ? "Changes next bar" : playback.state.playing ? "Playing" : "Ready to play"}</span>
      </section>

      {playback.error && <p className="producer-alert" role="alert">{playback.error}</p>}
      <div className="producer-workspace" id="studio">
        <Panel className="producer-sequencer" aria-labelledby="sequence-title">
          <div className="producer-panel-heading"><div><p className="producer-eyebrow">Pattern 01</p><h1 id="sequence-title">Make a little noise.</h1></div><span className="producer-tag">16 STEP</span></div>
          {draft && <div className="producer-draft-banner">Source has unapplied edits. Apply or revert the draft to edit the sequencer.</div>}
          <div className="producer-sequence-scroll">
            <div className="producer-step-ruler" aria-hidden="true"><span>TRACK / SOUND</span><div>{Array.from({ length: 16 }, (_, i) => <span key={i} className={i % 4 === 0 ? "is-beat" : ""}>{String(i + 1).padStart(2, "0")}</span>)}</div><span>LEVEL</span></div>
            <fieldset className="producer-tracks" disabled={draft || fileBusy} aria-label="Sequencer tracks">
              {program.tracks.map((track, index) => (
                <div className={`producer-track${muted.has(index) || (solo.size > 0 && !solo.has(index)) ? " is-muted" : ""}`} key={index}>
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
                  <div className="producer-step-grid" style={{ "--track-steps": track.steps.length } as CSSProperties} role="group" aria-label={`${track.name} steps`}>
                    {track.steps.map((step, stepIndex) => <StepButton key={stepIndex} active={step !== null} current={playback.state.playing && Math.floor(playback.state.phase * track.steps.length) === stepIndex} accent="var(--producer-lime)"
                      data-current={playback.state.playing && Math.floor(playback.state.phase * track.steps.length) === stepIndex} className="producer-step" aria-label={`${track.name}, step ${stepIndex + 1}, ${step ? step.kind === "note" ? noteName(step.midi) : "hit" : "rest"}`} aria-pressed={step !== null}
                      onClick={() => editTrack(index, { ...track, steps: track.steps.map((item, i) => i !== stepIndex ? item : item ? null : track.source.kind === "sound" ? { kind: "hit" } : { kind: "note", midi: pitch[index] ?? 36 }) })}>
                      <span>{step?.kind === "note" ? noteName(step.midi) : step ? "●" : ""}</span>
                    </StepButton>)}
                  </div>
                  <div className="producer-track-mix">
                    <Range min={0} max={1} step={0.01} value={track.gain} aria-label={`${track.name} gain`} aria-valuetext={`${Math.round(track.gain * 100)} percent`} onChange={event => editTrack(index, { ...track, gain: Number(event.target.value) })} />
                    <output aria-label={`${track.name} level`}>{Math.round(track.gain * 100)}%</output>
                  </div>
                  <div className="producer-track-options">
                    <Button variant={muted.has(index) ? "primary" : "ghost"} aria-pressed={muted.has(index)} aria-label={`Mute ${track.name}`} onClick={() => toggle(muted, index, setMuted)}>M</Button>
                    <Button variant={solo.has(index) ? "primary" : "ghost"} aria-pressed={solo.has(index)} aria-label={`Solo ${track.name}`} onClick={() => toggle(solo, index, setSolo)}>S</Button>
                    {track.source.kind === "instrument" && <Select aria-label={`${track.name} pitch for new steps`} value={pitch[index] ?? 36} onChange={event => setPitch({ ...pitch, [index]: Number(event.target.value) })}>
                      {Array.from({ length: 49 }, (_, i) => i + 24).map(midi => <option key={midi} value={midi}>{noteName(midi)}</option>)}
                    </Select>}
                    <span className="producer-track-length">{track.steps.length} steps</span>
                    <IconButton variant="ghost" aria-label={`Remove ${track.name}`} onClick={() => remove(index)}>×</IconButton>
                  </div>
                </div>
              ))}
            </fieldset>
          </div>
          {program.tracks.length === 0 && <p className="producer-empty">No tracks yet. Add a track and tap a few steps.</p>}
          <div className="producer-sequence-footer"><Button variant="secondary" onClick={addTrack} disabled={draft || fileBusy || program.tracks.length >= 16}>+ Add track</Button><span>{program.tracks.length} tracks · Click a step to toggle</span></div>
          <p className="producer-mix-note">Mute and solo are listening controls. Saved files keep each track's original gain. Sequencer edits rewrite source formatting.</p>
        </Panel>

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
      <footer className="producer-footer"><span>banger / music in plain text</span><span role="status">{notice ?? "One bar. Start somewhere."}</span></footer>
    </main>
  );
}
