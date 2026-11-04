import type { MusicTrack } from "@banger/compiler";
import { Button, Input, Range, Select } from "@banger/shadcn";

export function PatternControls({ disabled = false, hidePicker = false, track, selected, onSelect, onRename, onRemove, onChange }: { disabled?: boolean; hidePicker?: boolean; track: MusicTrack; selected: string; onSelect: (name: string) => void; onRename: (oldName: string, name: string) => unknown; onRemove: (name: string) => unknown; onChange: (track: MusicTrack) => unknown }) {
  const pattern = track.patterns?.find(item => item.name === selected);
  const phrase = pattern ?? track;
  const changeBars = (bars: number) => {
    if (!Number.isInteger(bars) || bars < 1 || bars > 64) return;
    if (phrase.pianoRoll?.some(note => note.start + note.duration > bars * 4)) return;
    onChange(pattern ? { ...track, patterns: track.patterns!.map(item => item === pattern ? { ...item, bars } : item) } : { ...track, bars });
  };
  return <fieldset disabled={disabled} className="studio-pattern-controls producer-edit-fields">
    {!hidePicker && <label>Pattern <Select aria-label={`${track.name} pattern`} value={pattern?.name ?? ""} onChange={e => onSelect(e.target.value)}><option value="">Base pattern</option>{track.patterns?.map(item => <option key={item.name}>{item.name}</option>)}</Select></label>}
    {pattern && <><label>Name <Input key={pattern.name} aria-label={`${track.name} pattern name`} defaultValue={pattern.name} onBlur={event => {
      if (event.target.value === pattern.name) return;
      if (onRename(pattern.name, event.target.value)) onSelect(event.target.value); else event.target.value = pattern.name;
    }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
      <Button variant="ghost" onClick={() => { if (window.confirm("Delete this pattern? Sections using it will switch to the base pattern.") && onRemove(pattern.name)) onSelect(""); }}>Delete pattern</Button></>}
    <label>Phrase bars <Input aria-label={`${track.name} phrase bars`} type="number" min={Math.max(1, Math.ceil(Math.max(0, ...phrase.pianoRoll?.map(note => note.start + note.duration) ?? []) / 4))} max={64} value={phrase.bars ?? 1} onChange={e => changeBars(Number(e.target.value))} /></label>
    {phrase.pianoRoll === undefined && <label>Steps <Select aria-label={`${track.name} step count`} value={phrase.steps.length} onChange={e => {
      const length = Number(e.target.value);
      if (length < phrase.steps.length && phrase.steps.slice(length).some(Boolean) && !window.confirm("Shorten this pattern and remove its final steps?")) return;
      const steps = Array.from({ length }, (_, i) => phrase.steps[i] ?? null);
      onChange(pattern ? { ...track, patterns: track.patterns!.map(item => item === pattern ? { ...item, steps } : item) } : { ...track, steps });
    }}>{[...new Set([phrase.steps.length, 8, 16, 32, 64])].sort((a,b) => a-b).map(count => <option key={count}>{count}</option>)}</Select></label>}
    <Button variant="secondary" disabled={(track.patterns?.length ?? 0) >= 32} onClick={() => {
      let number = (track.patterns?.length ?? 0) + 1; while (track.patterns?.some(item => item.name === `pattern_${number}`)) number++;
      const name = `pattern_${number}`;
      if (onChange({ ...track, patterns: [...track.patterns ?? [], { name, bars: phrase.bars ?? 1, steps: phrase.steps, ...(phrase.pianoRoll === undefined ? {} : { pianoRoll: phrase.pianoRoll }) }] })) onSelect(name);
    }}>Duplicate pattern</Button>
    <label>Quantize <Select aria-label={`${track.name} timing quantize`} value={track.groove?.quantize ?? 0} onChange={e => { const groove = { ...track.groove }; if (Number(e.target.value)) groove.quantize = Number(e.target.value); else delete groove.quantize; onChange({ ...track, groove }); }}><option value={0}>Off</option>{[1, .5, .25, .125].map(value => <option key={value} value={value}>{value} beat</option>)}</Select></label>
    <label>Swing <Range aria-label={`${track.name} swing`} min={0} max={.49} step={.01} value={track.groove?.swing ?? 0} onChange={e => onChange({ ...track, groove: { ...track.groove, swing: Number(e.target.value) } })} /></label>
    <label>Humanize <Range aria-label={`${track.name} humanize`} min={0} max={.1} step={.005} value={track.groove?.humanize ?? 0} onChange={e => onChange({ ...track, groove: { ...track.groove, humanize: Number(e.target.value), seed: track.groove?.seed ?? 42 } })} /></label>
    <label>Seed <Input aria-label={`${track.name} humanize seed`} type="number" min={0} max={2147483647} value={track.groove?.seed ?? 42} onChange={e => onChange({ ...track, groove: { ...track.groove, seed: Number(e.target.value) } })} /></label>
  </fieldset>;
}
