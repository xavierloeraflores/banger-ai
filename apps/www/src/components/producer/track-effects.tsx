import type { MusicEffect, MusicTrack } from "@banger/compiler";
import { Button, Range, Select } from "@banger/shadcn";

const defaults: MusicEffect[] = [
  { kind: "filter", cutoff: 6000, resonance: 1 }, { kind: "delay", mix: .25, time: .25, feedback: .3 }, { kind: "reverb", mix: .25 },
  { kind: "eq", low: 0, mid: 0, high: 0 }, { kind: "compressor", threshold: -24, ratio: 4, attack: .01, release: .1, knee: 20 }, { kind: "distortion", amount: .2, mix: .3 },
];
const names = { filter: "Filter", delay: "Delay", reverb: "Reverb", eq: "EQ", compressor: "Compressor", distortion: "Distortion" };
const parameters: Record<MusicEffect["kind"], [string, number, number, number][]> = {
  filter: [["cutoff", 20, 20000, 1], ["resonance", 0, 20, .1]], delay: [["mix", 0, 1, .01], ["time", .01, 2, .01], ["feedback", 0, .85, .01]], reverb: [["mix", 0, 1, .01]],
  eq: [["low", -24, 24, .5], ["mid", -24, 24, .5], ["high", -24, 24, .5]], compressor: [["threshold", -100, 0, 1], ["ratio", 1, 20, .1], ["attack", 0, 1, .001], ["release", 0, 1, .01], ["knee", 0, 40, 1]], distortion: [["amount", 0, 1, .01], ["mix", 0, 1, .01]],
};
const panLabel = (value: number) => value === 0 ? "Center" : `${Math.round(Math.abs(value) * 100)}% ${value < 0 ? "left" : "right"}`;
function Parameter({ label, value, min, max, step, display, onChange }: { label: string; value: number; min: number; max: number; step: number; display?: string; onChange: (value: number) => void }) {
  return <label className="producer-effect-parameter"><span>{label}</span><Range aria-label={label} aria-valuetext={display ?? String(value)} min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} /><output>{display ?? value}</output></label>;
}
export function TrackEffects({ track, disabled, tracks = [], open, onChange }: { track: Pick<MusicTrack, "name" | "pan" | "effects" | "automation">; disabled: boolean; tracks?: string[]; open?: boolean; onChange: (track: Pick<MusicTrack, "name" | "pan" | "effects" | "automation">) => unknown }) {
  const effects = track.effects ?? [];
  const changeEffects = (next: MusicEffect[]) => onChange({ ...track, effects: next, ...(track.automation ? { automation: track.automation.filter(curve => !curve.target.includes(".") || next.some(effect => curve.target.startsWith(`${effect.kind}.`))) } : {}) });
  const changeEffect = (index: number, effect: MusicEffect) => changeEffects(effects.map((current, i) => i === index ? effect : current));
  const move = (index: number, direction: number) => { const next = [...effects]; const target = index + direction; if (!next[index] || !next[target]) return; [next[index], next[target]] = [next[target]!, next[index]!]; changeEffects(next); };
  return <details className="producer-track-effects" open={open}><summary>{track.name} mix &amp; effects <span>{panLabel(track.pan ?? 0)} · {effects.length ? effects.map(effect => names[effect.kind]).join(" → ") : "No effects"}</span></summary>
    <fieldset disabled={disabled} aria-label={`${track.name} mix and effects`}>
      <Parameter label={`${track.name} pan`} value={track.pan ?? 0} min={-1} max={1} step={.01} display={panLabel(track.pan ?? 0)} onChange={pan => onChange({ ...track, pan })} /><p>Effects run in the order shown.</p>
      <ol className="producer-effect-chain">{effects.map((effect, index) => <li key={effect.kind} data-effect={effect.kind}>
        <div className="producer-effect-heading"><strong>{index + 1}. {names[effect.kind]}</strong><Button variant="ghost" disabled={!index} aria-label={`Move ${track.name} ${effect.kind} earlier`} onClick={() => move(index, -1)}>↑</Button><Button variant="ghost" disabled={index === effects.length - 1} aria-label={`Move ${track.name} ${effect.kind} later`} onClick={() => move(index, 1)}>↓</Button><Button variant="ghost" aria-label={`Remove ${track.name} ${effect.kind}`} onClick={() => changeEffects(effects.filter((_, i) => i !== index))}>Remove</Button></div>
        {parameters[effect.kind].map(([field, min, max, step]) => <Parameter key={field} label={`${track.name} ${effect.kind} ${field}`} value={Number((effect as unknown as Record<string, unknown>)[field])} min={min} max={max} step={step} onChange={value => changeEffect(index, { ...effect, [field]: value })} />)}
        {effect.kind === "compressor" && <label>Sidechain source <Select aria-label={`${track.name} compressor sidechain`} value={effect.sidechain ?? ""} onChange={e => { const next = { ...effect }; if (e.target.value) next.sidechain = e.target.value; else delete next.sidechain; changeEffect(index, next); }}><option value="">Own signal</option>{tracks.filter(name => name !== track.name).map(name => <option key={name}>{name}</option>)}</Select></label>}
      </li>)}</ol><div className="producer-effect-add">{defaults.map(effect => <Button key={effect.kind} variant="secondary" disabled={effects.some(current => current.kind === effect.kind)} aria-label={`Add ${track.name} ${effect.kind}`} onClick={() => changeEffects([...effects, { ...effect }])}>+ {names[effect.kind]}</Button>)}</div>
    </fieldset>
  </details>;
}
