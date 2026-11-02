import type { MusicEffect, MusicTrack } from "@banger/compiler";
import { Button, Range } from "@banger/shadcn";

const defaults: MusicEffect[] = [
  { kind: "filter", cutoff: 6000, resonance: 1 },
  { kind: "delay", mix: 0.25, time: 0.25, feedback: 0.3 },
  { kind: "reverb", mix: 0.25 },
];
const names = { filter: "Filter", delay: "Delay", reverb: "Reverb" };
const percent = (value: number) => `${Math.round(value * 100)}%`;
const panLabel = (value: number) => value === 0 ? "Center" : `${Math.round(Math.abs(value) * 100)}% ${value < 0 ? "left" : "right"}`;

function Parameter({ label, value, min, max, step, display, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  display?: string; onChange: (value: number) => void;
}) {
  return <label className="producer-effect-parameter">
    <span>{label}</span>
    <Range aria-label={label} aria-valuetext={display ?? String(value)} min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} />
    <output>{display ?? value}</output>
  </label>;
}

export function TrackEffects({ track, disabled, onChange }: {
  track: MusicTrack; disabled: boolean; onChange: (track: MusicTrack) => unknown;
}) {
  const effects = track.effects ?? [];
  const changeEffects = (next: MusicEffect[]) => onChange({ ...track, effects: next });
  const changeEffect = (index: number, effect: MusicEffect) => changeEffects(effects.map((current, i) => i === index ? effect : current));
  const move = (index: number, direction: number) => {
    const next = [...effects];
    const target = index + direction;
    const current = next[index];
    const other = next[target];
    if (!current || !other) return;
    next[index] = other;
    next[target] = current;
    changeEffects(next);
  };
  return <details className="producer-track-effects">
    <summary>{track.name} mix &amp; effects <span>{panLabel(track.pan ?? 0)} · {effects.length ? effects.map(effect => names[effect.kind]).join(" → ") : "No effects"}</span></summary>
    <fieldset disabled={disabled} aria-label={`${track.name} mix and effects`}>
      <Parameter label={`${track.name} pan`} value={track.pan ?? 0} min={-1} max={1} step={0.01} display={panLabel(track.pan ?? 0)} onChange={pan => onChange({ ...track, pan })} />
      <p>Effects run in the order shown.</p>
      <ol className="producer-effect-chain">
        {effects.map((effect, index) => <li key={effect.kind} data-effect={effect.kind}>
          <div className="producer-effect-heading">
            <strong>{index + 1}. {names[effect.kind]}</strong>
            <Button variant="ghost" disabled={index === 0} aria-label={`Move ${track.name} ${effect.kind} earlier`} onClick={() => move(index, -1)}>↑</Button>
            <Button variant="ghost" disabled={index === effects.length - 1} aria-label={`Move ${track.name} ${effect.kind} later`} onClick={() => move(index, 1)}>↓</Button>
            <Button variant="ghost" aria-label={`Remove ${track.name} ${effect.kind}`} onClick={() => changeEffects(effects.filter((_, i) => i !== index))}>Remove</Button>
          </div>
          {effect.kind === "filter" ? <>
            <Parameter label={`${track.name} filter cutoff`} value={effect.cutoff} min={20} max={20000} step={1} display={`${effect.cutoff} Hz`} onChange={cutoff => changeEffect(index, { ...effect, cutoff })} />
            <Parameter label={`${track.name} filter resonance`} value={effect.resonance} min={0} max={20} step={0.1} onChange={resonance => changeEffect(index, { ...effect, resonance })} />
          </> : <>
            <Parameter label={`${track.name} ${effect.kind} mix`} value={effect.mix} min={0} max={1} step={0.01} display={percent(effect.mix)} onChange={mix => changeEffect(index, { ...effect, mix })} />
            {effect.kind === "delay" && <>
              <Parameter label={`${track.name} delay time`} value={effect.time} min={0.01} max={2} step={0.01} display={`${effect.time} s`} onChange={time => changeEffect(index, { ...effect, time })} />
              <Parameter label={`${track.name} delay feedback`} value={effect.feedback} min={0} max={0.85} step={0.01} display={percent(effect.feedback)} onChange={feedback => changeEffect(index, { ...effect, feedback })} />
            </>}
          </>}
        </li>)}
      </ol>
      <div className="producer-effect-add">{defaults.map(effect => <Button key={effect.kind} variant="secondary" disabled={effects.some(current => current.kind === effect.kind)} aria-label={`Add ${track.name} ${effect.kind}`} onClick={() => changeEffects([...effects, { ...effect }])}>+ {names[effect.kind]}</Button>)}</div>
    </fieldset>
  </details>;
}
