import { useEffect, useRef, useState } from "react";
import { resolvePattern, type MusicProgram, type MusicPattern } from "@banger/compiler";
import { Button, Range } from "@banger/shadcn";

export function TransportControls({ program, disabled, onChange, onTempo, onLaunch, onFill, fill }: { program: MusicProgram; disabled: boolean; onChange: (program: MusicProgram) => unknown; onTempo: (tempo: number) => void; onLaunch: (name: string, next?: MusicProgram) => void; onFill: (active: boolean) => void; fill: boolean }) {
  const taps = useRef<number[]>([]);
  const tapReset = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tapStatus, setTapStatus] = useState("Tap twice or more");
  const [fillHint, setFillHint] = useState(false);
  const hasFillSteps = program.tracks.some(track => [track, ...track.patterns ?? []].some(pattern =>
    pattern.steps.some(step => step?.condition === "fill" || step?.condition === "not-fill")));
  const [clipboard, setClipboard] = useState<Record<string, MusicPattern> | null>(null);
  const names = [...new Set(program.tracks.flatMap(track => track.patterns?.map(pattern => pattern.name) ?? []))];
  useEffect(() => () => { if (tapReset.current) clearTimeout(tapReset.current); }, []);
  useEffect(() => { if (disabled || !hasFillSteps) onFill(false); }, [disabled, hasFillSteps, onFill]);
  const tap = () => {
    const now = performance.now(), previous = taps.current.at(-1);
    taps.current = previous === undefined || now - previous > 3000 ? [now] : [...taps.current.slice(-5), now];
    if (tapReset.current) clearTimeout(tapReset.current);
    tapReset.current = setTimeout(() => { taps.current = []; setTapStatus("Tap twice or more"); }, 3200);
    if (taps.current.length < 2) { setTapStatus("Tap again to set tempo"); return; }
    const bpm = Math.round(60000 * (taps.current.length - 1) / (now - taps.current[0]!));
    if (bpm >= 20 && bpm <= 300) {
      onTempo(bpm);
      setTapStatus(`${bpm} BPM · ${taps.current.length} taps`);
    } else {
      taps.current = [now];
      setTapStatus("Tap slower · 20–300 BPM");
    }
  };
  return <fieldset className="producer-transport-extras" disabled={disabled} aria-label="Performance controls">
    <div className="producer-performance-control">
      <Button aria-pressed={fill} variant={fill ? "primary" : "secondary"} aria-describedby="producer-fill-status"
        title="Toggle steps marked F or !F. Exports use Fill off."
        onClick={() => { setFillHint(true); if (hasFillSteps) onFill(!fill); }}>Fill</Button>
      <span id="producer-fill-status" role="status">{!hasFillSteps ? fillHint ? "Set a step condition to F or !F" : "No Fill steps" : fill ? "Fill on" : "Fill off"}</span>
    </div>
    <div className="producer-performance-control">
      <Button variant="secondary" onClick={tap} aria-describedby="producer-tap-status" title="Tap at least twice to set tempo">Tap tempo</Button>
      <span id="producer-tap-status" role="status">{tapStatus}</span>
    </div>
    <Button variant={program.metronome ? "primary" : "secondary"} aria-pressed={program.metronome ?? false} onClick={() => onChange({ ...program, metronome: !program.metronome })} title="Live metronome. Excluded from exports.">Click</Button>
    <label>Master <Range aria-label="Master volume" min={0} max={1} step={.01} value={program.masterGain ?? 1} onChange={event => onChange({ ...program, masterGain: Number(event.target.value) })} /><output>{Math.round((program.masterGain ?? 1) * 100)}%</output></label>
    <div className="producer-pattern-launcher" role="group" aria-label="Launch patterns">
      <Button variant={!program.activePattern && program.chainEnabled === false ? "primary" : "secondary"} aria-pressed={!program.activePattern && program.chainEnabled === false} onClick={() => onLaunch("")}>Base</Button>
      {names.map(name => <Button key={name} variant={program.activePattern === name && program.chainEnabled === false ? "primary" : "secondary"} aria-pressed={program.activePattern === name && program.chainEnabled === false} onClick={() => onLaunch(name)}>{name}</Button>)}
      <Button variant="ghost" disabled={program.tracks.length === 0 || program.tracks.some(track => (track.patterns?.length ?? 0) >= 32)} onClick={() => {
        let number = 1; let name = "A"; while (names.includes(name)) { number++; name = number <= 10 ? String.fromCharCode(64 + number) : `pattern_${number}`; }
        const tracks = program.tracks.map(track => ({ ...track, patterns: [...track.patterns ?? [], { ...structuredClone(resolvePattern(track, track.patterns?.some(pattern => pattern.name === program.activePattern) ? program.activePattern : undefined)), name }] }));
        onLaunch(name, { ...program, tracks });
      }}>Copy to new pattern</Button>
      <Button variant="ghost" onClick={() => setClipboard(Object.fromEntries(program.tracks.map(track => [track.name, structuredClone(resolvePattern(track, track.patterns?.some(pattern => pattern.name === program.activePattern) ? program.activePattern : undefined))])))}>Copy</Button>
      <Button variant="ghost" disabled={!clipboard} onClick={() => onChange({ ...program, tracks: program.tracks.map(track => {
        const copied = clipboard?.[track.name]; if (!copied) return track;
        const { steps, pianoRoll, bars } = structuredClone(copied);
        if (track.source.kind === "sound" ? steps.some(step => step?.kind === "note") || pianoRoll !== undefined : steps.some(step => step?.kind === "hit")) return track;
        const active = track.patterns?.find(pattern => pattern.name === program.activePattern);
        return active ? { ...track, patterns: track.patterns!.map(pattern => pattern === active ? { ...pattern, steps, pianoRoll, bars } : pattern) } : { ...track, steps, pianoRoll, bars };
      }) })}>Paste</Button>
    </div>
  </fieldset>;
}
