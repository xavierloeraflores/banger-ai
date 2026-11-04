"use client";

import { useEffect, useRef, useState } from "react";
import { FACTORY_PATCHES, INSTRUMENT_PATCHES, trackSynth, INIT_SYNTH, SYNTH_RANGES, type MusicTrack, type SynthConfig, type SynthParameter, type SynthPatch } from "@banger/compiler";
import { renderWav } from "@banger/engine";
import { Button, Input, Select } from "@banger/shadcn";
import "./sound-design.css";

const waves = [["sine", "Sine", "∿"], ["triangle", "Triangle", "△"], ["sawtooth", "Sawtooth", "⩘"], ["square", "Square", "⊓"]] as const;
const format = (key: SynthParameter, value: number) => key === "filterDecay" && value === 0 ? "Note length" : ["attack", "decay", "release", "glide", "pitchDecay", "filterDecay"].includes(key) ? `${Math.round(value * 1000)}ms` : key === "resonance" ? value.toFixed(1) : key === "cutoff" ? `${Math.round(value)}Hz` : key.includes("Rate") ? `${value.toFixed(2)}Hz` : ["detune", "unisonDetune"].includes(key) ? `${value.toFixed(0)}c` : key === "pitchEnv" ? `${value.toFixed(0)}st` : key === "fmRatio" ? `${value.toFixed(2)}×` : key === "voices" ? String(value) : `${Math.round(value * 100)}%`;
const controlStep = (key: SynthParameter) => key === "voices" || key === "cutoff" || key === "pitchEnv" || key.toLowerCase().includes("detune") ? 1 : ["attack", "decay", "release", "glide", "pitchDecay", "filterDecay"].includes(key) ? .001 : .01;
const soundPatches = [...FACTORY_PATCHES, ...Object.values(INSTRUMENT_PATCHES)];
const instrumentHints: Record<string, string> = {
  "808 Bass": "Use C1 to C3 for bass lines. Hold notes for the 1.6-second decay; adjust Decay, Pitch amount and Pitch decay. Keep Drive low; add Glide for slides.",
  "Music Box": "Use C4 to C7 for bell-like melodies. Try 0.5 to 2 beat notes; adjust Decay, Release and FM amount. Integer FM ratios keep the overtones pitched.",
  Clavinet: "Use C3 to C5 for syncopated notes and chords, about 0.125 to 0.5 beats long. Adjust Envelope to filter, Filter decay and Cutoff; keep Drive low.",
  Marimba: "Use short notes or chords for warm mallet strikes. Adjust Decay and FM amount for the body and brightness.",
  Woodblock: "Use short notes for wooden percussion. Adjust Decay, FM ratio and Cutoff to shape the strike.",
  "Noise Downlifter": "Hold a C4 note for the full downward sweep. Note length controls the sweep duration; Filter sweep controls its direction and depth.",
  Impact: "Use a C2 note for a low impact. Adjust Noise, Pitch amount and Decay to balance the thump and tail.",
  "Muted Synth Guitar": "Use short notes or chords for muted strums. Adjust Decay, Cutoff and Drive. This is a synthesized guitar sound.",
};
const patchGroups = [
  { name: "Leads and pads", names: ["Synth Brass", "Flute Lead", "Chiptune Lead", "String Ensemble", "Init Saw", "Acid", "S&H Bleeps"] },
  { name: "Keys and plucks", names: ["Music Box", "Clavinet", "Kalimba Pluck", "Marimba", "Muted Synth Guitar", "Acoustic Piano", "Electric Piano", "FM Electric Piano", "FM Bell", "Karplus-ish"] },
  { name: "Bass", names: ["808 Bass", "Sub Bass", "Analog Bass", "Acid Bass", "FM Bass", "Reese Bass", "Pluck Bass"] },
  { name: "Transitions", names: ["Noise Riser", "Noise Downlifter", "Impact"] },
];
const groupedPatches = [...patchGroups.map(group => ({ name: group.name, patches: soundPatches.filter(patch => group.names.includes(patch.name)) })),
  { name: "Drums and percussion", patches: soundPatches.filter(patch => !patchGroups.some(group => group.names.includes(patch.name))) }];
function factoryOptions() { return groupedPatches.map(group => <optgroup key={group.name} label={group.name}>{group.patches.map(patch => <option key={patch.name} value={patch.name}>{patch.name}</option>)}</optgroup>); }

export function SoundDesign({ track, phrase, disabled, onChange, onPhraseChange }: { track: MusicTrack; phrase: MusicTrack; disabled: boolean; onChange: (track: MusicTrack) => void; onPhraseChange: (track: MusicTrack) => void }) {
  const [selectedStep, setSelectedStep] = useState(-1);
  const [status, setStatus] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const context = useRef<AudioContext | null>(null);
  const patchName = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const modular = track.modular !== undefined;
  const resolvedSynth = trackSynth(track);
  const config = { ...INIT_SYNTH, ...resolvedSynth };
  const active = Boolean(resolvedSynth?.enabled);
  const selectedPreset = soundPatches.find(patch => Object.entries(patch.config).every(([key, value]) => config[key as keyof SynthConfig] === value))?.name ?? "";
  const step = phrase.steps[selectedStep];
  const locks = step?.locks ?? {};
  const effective = { ...config, ...locks };
  useEffect(() => () => { generation.current++; void context.current?.close().catch(() => {}); }, []);
  function stopPreview() { generation.current++; void context.current?.close().catch(() => {}); context.current = null; setPreviewing(false); }
  function updateConfig(next: SynthConfig) {
    if (!next.enabled) stopPreview();
    onChange(modular && track.modular ? { ...track, modular: { ...track.modular, config: next } } : { ...track, synth: next });
  }
  function parameter(key: SynthParameter, value: number) {
    if (step) onPhraseChange({ ...phrase, steps: phrase.steps.map((item, index) => index === selectedStep && item ? { ...item, locks: { ...item.locks, [key]: value } } : item) });
    else updateConfig({ ...config, [key]: value });
  }
  function toggleLock(key: SynthParameter) {
    if (!step) return;
    const next = { ...locks };
    if (Object.hasOwn(next, key)) delete next[key]; else next[key] = config[key];
    onPhraseChange({ ...phrase, steps: phrase.steps.map((item, index) => index === selectedStep && item ? { ...item, locks: next } : item) });
  }
  function slider(key: SynthParameter, label: string) {
    const value = locks[key] ?? config[key], bounds = SYNTH_RANGES[key];
    return <label className="sound-slider" key={key}><span>{label}</span><input type="range" min={bounds[0]} max={bounds[1]} step={controlStep(key)} value={value} aria-label={`${track.name} ${label}`} onChange={event => parameter(key, Number(event.target.value))} /><output>{format(key, value)}</output>{step && <button type="button" className="sound-lock" aria-label={`${Object.hasOwn(locks, key) ? "Remove" : "Add"} ${label} lock`} aria-pressed={Object.hasOwn(locks, key)} onClick={() => toggleLock(key)}>{Object.hasOwn(locks, key) ? "◆" : "◇"}</button>}</label>;
  }
  function choices<K extends keyof SynthConfig>(key: K, label: string, values: readonly (readonly [SynthConfig[K], string, string?])[]) {
    return <div className="sound-choices"><span>{label}</span><div role="group" aria-label={`${track.name} ${label}`}>{values.map(([value, name, icon]) => <button type="button" key={String(value)} aria-label={`${label} ${name}`} title={name} aria-pressed={config[key] === value} onClick={() => updateConfig({ ...config, [key]: value })}>{icon ?? name}</button>)}</div></div>;
  }
  async function preview() {
    const request = ++generation.current;
    setPreviewing(true); setStatus("");
    try {
      await context.current?.close().catch(() => {});
      const audio = new AudioContext(); context.current = audio; await audio.resume();
      const midi = step?.kind === "note" ? step.midi : phrase.pianoRoll?.[0]?.midi ?? (track.source.kind === "sound" || selectedPreset === "808 Bass" || selectedPreset === "Impact" ? 36 : 60);
      // Hold slow patches long enough to hear their attack. Apply the selected
      // step's locks to this isolated preview, without changing the project.
      const previewConfig = { ...config, ...step?.locks };
      const previewTrack: MusicTrack = { name: "preview", source: { kind: "instrument", name: "synth/lead" }, gain: track.gain, synth: previewConfig, steps: [], pianoRoll: [{ midi, start: 0, duration: Math.min(4, Math.max(1, (previewConfig.attack + previewConfig.decay) * 2)), velocity: 1 }] };
      const result = await renderWav({ tempo: 120, meter: { numerator: 4, denominator: 4 }, tracks: [previewTrack] }, { sampleRate: 22050 });
      if (request !== generation.current) { await audio.close(); return; }
      const source = audio.createBufferSource(); source.buffer = result.buffer; source.connect(audio.destination); source.start();
      source.onended = () => { void audio.close().catch(() => {}); if (request === generation.current) { context.current = null; setPreviewing(false); } };
      setStatus("Preview playing.");
    } catch (error) { if (request === generation.current) { setStatus(error instanceof Error ? error.message : "Preview failed."); setPreviewing(false); } }
  }
  function loadPatch(patch: SynthPatch) { stopPreview(); if (patchName.current) patchName.current.value = patch.name; onChange({ ...track, modular: structuredClone(patch) }); setStatus(`Loaded ${patch.name}.`); }
  function loadSynth(config: SynthConfig, name: string) { stopPreview(); updateConfig({ ...config }); setStatus(`Loaded ${name}.`); }
  function savePatch() {
    if (!track.modular) return;
    const name = patchName.current?.value.trim() ?? "";
    if (!name) { setStatus("Enter a patch name before saving."); patchName.current?.focus(); return; }
    if (name.length > 64) { setStatus("Use a patch name with at most 64 characters."); return; }
    const saved = { name, config: { ...track.modular.config } }, library = track.patchLibrary ?? [];
    if (library.length >= 32 && !library.some(patch => patch.name === name)) { setStatus("This track already has 32 saved patches."); return; }
    onChange({ ...track, modular: saved, patchLibrary: [...library.filter(patch => patch.name !== name), saved] }); setStatus(`Saved ${name} in this project.`);
  }
  return <fieldset className="sound-design" disabled={disabled}>
    <legend>Sound design</legend>
    <div className="sound-header"><div className="sound-mode" role="group" aria-label={`${track.name} engine`}><Button variant={!modular ? "primary" : "ghost"} aria-pressed={!modular} onClick={() => { stopPreview(); const next = { ...track }; delete next.modular; onChange(next); }}>Synth engine</Button><Button variant={modular ? "primary" : "ghost"} aria-pressed={modular} onClick={() => { stopPreview(); onChange({ ...track, modular: track.modular ?? null }); }}>Modular</Button></div>
      <Button variant={active ? "primary" : "secondary"} aria-pressed={active} disabled={modular && !track.modular} onClick={() => updateConfig({ ...config, enabled: !active })}>{active ? "On" : "Off"}</Button>
      {!modular && <Select value={selectedPreset} aria-label={`${track.name} synth preset`} onChange={event => { const patch = soundPatches.find(patch => patch.name === event.target.value); if (patch) loadSynth(patch.config, patch.name); else if (event.target.value === "init") loadSynth(INIT_SYNTH, "Init"); }}><option value="">{track.synth ? "Custom / Init" : "Choose a sound…"}</option><option value="init">Init</option>{factoryOptions()}</Select>}
      {!modular && <Button variant="ghost" onClick={() => loadSynth(INIT_SYNTH, "Init")}>Reset Init</Button>}
      <Button variant="secondary" disabled={!active || previewing} onClick={() => void preview()}>{previewing ? "Playing…" : modular ? "Preview note" : "Preview"}</Button>
    </div>
    {modular && <div className="sound-modular">
      <div className="sound-header"><Select value="" aria-label={`${track.name} factory patch`} onChange={event => { const patch = soundPatches.find(patch => patch.name === event.target.value); if (patch) loadPatch(patch); }}><option value="">Factory…</option>{factoryOptions()}</Select>
        {(track.patchLibrary?.length ?? 0) > 0 && <Select value="" aria-label={`${track.name} saved patch`} onChange={event => { const patch = track.patchLibrary?.find(patch => patch.name === event.target.value); if (patch) loadPatch(patch); }}><option value="">Saved patches…</option>{track.patchLibrary!.map(patch => <option key={patch.name}>{patch.name}</option>)}</Select>}
        <label className="sound-patch-field">Patch name<Input key={track.modular?.name ?? "empty"} ref={patchName} defaultValue={track.modular?.name ?? ""} aria-label={`${track.name} patch name`} maxLength={64} disabled={!track.modular} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); savePatch(); } }} /></label>
        <Button disabled={!track.modular} onClick={savePatch}>Save patch</Button><Button disabled={!track.modular} onClick={() => { stopPreview(); onChange({ ...track, modular: null }); setStatus("Patch cleared. This track is silent."); }}>Clear patch</Button></div>
      {!track.modular ? <div className="sound-empty"><p>No patch loaded. This track is silent.</p><Button onClick={() => loadPatch(FACTORY_PATCHES[0]!)}>Start patching</Button></div> : <p className="sound-patch-name">{track.modular.name}</p>}
      <details open={!track.modular}><summary>Factory patches</summary><div className="sound-factory">{soundPatches.map(patch => <Button key={patch.name} variant="secondary" onClick={() => loadPatch(patch)}>{patch.name}</Button>)}</div></details>
    </div>}
    {(!modular || track.modular) && <>
      <p className="sound-hint">Factory sounds are synthesized. Use long piano-roll notes for String Ensemble, Noise Riser and Noise Downlifter. Step locks still override the selected sound.</p>
      {instrumentHints[selectedPreset] && <p className="sound-hint">{instrumentHints[selectedPreset]}</p>}
      <div className="sound-header sound-lock-header"><span>VCO → VCF → VCA → OUT</span><label>Edit <Select aria-label={`${track.name} parameter lock step`} value={step ? selectedStep : -1} onChange={event => setSelectedStep(Number(event.target.value))}><option value={-1}>Track sound</option>{phrase.steps.map((item, index) => item && <option key={index} value={index}>Step {index + 1}{Object.keys(item.locks ?? {}).length ? " ◆" : ""}</option>)}</Select></label>{step && <Button variant="ghost" onClick={() => onPhraseChange({ ...phrase, steps: phrase.steps.map((item,index) => { if (index !== selectedStep || !item) return item; const next = {...item}; delete next.locks; return next; }) })}>Clear step locks</Button>}</div>
      <p className="sound-hint">{step ? `Step ${selectedStep + 1}: moving a numeric control adds a lock. ◆ removes that lock. Waveforms and mode buttons edit the track.` : "Choose an active step to lock its numeric controls. Track settings stay unchanged."}</p>
      <div className="sound-columns">
        <section><h3>Oscillators</h3>{choices("osc1", "Osc 1", waves)}{choices("osc2", "Osc 2", waves)}{slider("mix", "Mix")}{slider("drive", "Drive")}{slider("fm", "FM amount")}{slider("fmRatio", "FM ratio")}{slider("detune", "Detune")}{slider("sub", "Sub oscillator")}{slider("tone", "Oscillator level")}{slider("noise", "Noise")}{choices("noiseType", "Noise type", [["white", "White"], ["metal", "Metal"]])}<h3>Unison</h3>{slider("voices", "Voices")}{slider("unisonDetune", "Unison detune")}{slider("spread", "Spread")}</section>
        <section><h3>Filter · 4-pole VCF</h3>{choices("filterType", "Filter type", [["lowpass", "LP"], ["bandpass", "BP"], ["highpass", "HP"]])}{slider("cutoff", "Cutoff")}{slider("resonance", "Resonance")}{slider("filterEnv", "Envelope to filter")}{slider("filterDecay", "Filter decay")}{slider("filterSweep", "Filter sweep")}<p className="sound-hint">Filter sweep rises or falls across the note. Set it to zero to use Envelope to filter.</p>{slider("velocityFilter", "Velocity to filter")}
          {([1, 2] as const).map(id => <div key={id}><h3>LFO {id}</h3>{choices(`lfo${id}Wave`, `LFO ${id} waveform`, waves)}{slider(`lfo${id}Rate`, `LFO ${id} rate`)}{slider(`lfo${id}Depth`, `LFO ${id} depth`)}{choices(`lfo${id}Target`, `LFO ${id} target`, [["filter", "Filter"], ["pitch", "Pitch"], ["amp", "Amp"]])}</div>)}</section>
        <section><h3>Envelope · ADSR</h3><svg className="sound-envelope" viewBox="0 0 300 80" role="img" aria-label="Envelope shape"><path d={`M 0 78 L ${10 + effective.attack * 40} 5 L ${80 + effective.decay * 30} ${78 - effective.sustain * 70} L 240 ${78 - effective.sustain * 70} L ${250 + effective.release * 16} 78`} fill="none" stroke="currentColor" strokeWidth="2" /></svg>{slider("attack", "Attack")}{slider("decay", "Decay")}{slider("sustain", "Sustain")}{slider("release", "Release")}{slider("glide", "Glide")}<h3>Pitch envelope</h3>{slider("pitchEnv", "Pitch amount")}{slider("pitchDecay", "Pitch decay")}<h3>Output</h3>{slider("volume", "Synth volume")}</section>
      </div>
    </>}
    <p className="sound-status" role="status">{status || (!modular && !resolvedSynth ? "Enable the synth to replace this track’s current instrument." : "")}</p>
  </fieldset>;
}
