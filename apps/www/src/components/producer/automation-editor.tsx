import { useState } from "react";
import type { AutomationCurve, AutomationTarget, MusicEffect } from "@banger/compiler";
import { Button, Input, Select } from "@banger/shadcn";

const ranges: Record<AutomationTarget, [number, number, number]> = {
  gain: [0, 1, 1], pan: [-1, 1, 0], pitch: [-48, 48, 0],
  "filter.cutoff": [20, 20000, 6000], "filter.resonance": [0, 20, 1],
  "reverb.mix": [0, 1, .25], "delay.mix": [0, 1, .25], "delay.time": [.01, 2, .25], "delay.feedback": [0, .85, .3],
  "eq.low": [-24, 24, 0], "eq.mid": [-24, 24, 0], "eq.high": [-24, 24, 0],
  "compressor.threshold": [-100, 0, -24], "compressor.ratio": [1, 20, 4], "distortion.amount": [0, 1, .2], "distortion.mix": [0, 1, .3],
};
function PointNumber({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number | "any"; onChange: (value: number) => void }) {
  return <Input key={value} aria-label={label} type="number" min={min} max={max} step={step} defaultValue={value} onBlur={event => {
    const next = Number(event.target.value);
    if (event.target.value === "" || !Number.isFinite(next) || !event.target.checkValidity()) { event.target.value = String(value); return; }
    onChange(next);
  }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { event.currentTarget.value = String(value); event.currentTarget.blur(); } }} />;
}
export function AutomationEditor({ name, curves = [], beats, effects = [], bus = false, onChange }: { name: string; curves?: AutomationCurve[]; beats: number; effects?: MusicEffect[]; bus?: boolean; onChange: (curves: AutomationCurve[]) => unknown }) {
  const [target, setTarget] = useState<AutomationTarget>("gain");
  const available = (Object.keys(ranges) as AutomationTarget[]).filter(key => key === "gain" || key === "pan" || key === "pitch" && !bus || effects.some(effect => key.startsWith(`${effect.kind}.`)));
  const chosenTarget = available.includes(target) ? target : "gain";
  function update(index: number, next: AutomationCurve) { onChange(curves.map((curve, i) => i === index ? next : curve)); }
  return <details className="studio-automation"><summary>{name} automation · {curves.length} lanes</summary>
    <p>{bus ? "Bus curves follow song beats." : "Track curves restart with each pattern."} Click a curve to add a point. Edit its beat and value below.</p>
    {curves.map((curve, index) => {
      const [min, max] = ranges[curve.target];
      const span = Math.max(beats, ...curve.points.map(point => point.beat));
      const position = (point: { beat: number; value: number }) => `${point.beat / span * 600},${100 - (point.value - min) / (max - min) * 100}`;
      const plotted = curve.points.flatMap((point, i) => curve.interpolation === "step" && i ? [position({ beat: point.beat, value: curve.points[i-1]!.value }), position(point)] : [position(point)]).join(" ");
      return <section key={curve.target} className="studio-automation-lane">
        <div className="studio-inline"><strong>{curve.target}</strong><Select aria-label={`${name} ${curve.target} interpolation`} value={curve.interpolation ?? "linear"} onChange={e => update(index, { ...curve, interpolation: e.target.value as "linear" | "step" })}><option>linear</option><option>step</option></Select><Button variant="ghost" aria-label={`Remove ${name} ${curve.target} automation`} onClick={() => onChange(curves.filter((_, i) => i !== index))}>Remove lane</Button></div>
        <svg viewBox="0 0 600 100" role="img" aria-label={`${name} ${curve.target} curve`} onClick={event => {
          if (curve.points.length >= 128 || event.currentTarget.closest("fieldset")?.disabled) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const beat = Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * span * 4) / 4;
          const value = Number((min + (1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))) * (max-min)).toFixed(3));
          update(index, { ...curve, points: [...curve.points.filter(point => point.beat !== beat), { beat, value }].sort((a,b) => a.beat-b.beat) });
        }}><path d="M0 50 H600 M150 0 V100 M300 0 V100 M450 0 V100" className="studio-curve-grid" /><polyline points={plotted} />{curve.points.map((point,i) => <circle key={i} cx={point.beat/span*600} cy={100-(point.value-min)/(max-min)*100} r={4} />)}</svg>
        <div className="studio-automation-points">{curve.points.map((point, pointIndex) => <div className="studio-inline" key={pointIndex}>
          <label>Beat <PointNumber label={`${name} ${curve.target} point ${pointIndex + 1} beat`} min={0} max={4096} step={.25} value={point.beat} onChange={beat => { if (curve.points.some((p,i) => i !== pointIndex && p.beat === beat)) return; update(index, { ...curve, points: curve.points.map((p,i) => i === pointIndex ? { ...p, beat } : p).sort((a,b) => a.beat-b.beat) }); }} /></label>
          <label>Value <PointNumber label={`${name} ${curve.target} point ${pointIndex + 1} value`} min={min} max={max} step="any" value={point.value} onChange={value => update(index, { ...curve, points: curve.points.map((p,i) => i === pointIndex ? { ...p, value } : p) })} /></label>
          <Button variant="ghost" disabled={curve.points.length <= 1} aria-label={`Remove ${name} ${curve.target} point ${pointIndex + 1}`} onClick={() => update(index, { ...curve, points: curve.points.filter((_, i) => i !== pointIndex) })}>×</Button>
        </div>)}</div>
        <Button variant="secondary" disabled={curve.points.length >= 128 || (curve.points.at(-1)?.beat ?? 0) >= 4096} onClick={() => update(index, { ...curve, points: [...curve.points, { beat: Math.min(4096, (curve.points.at(-1)?.beat ?? 0) + 1), value: curve.points.at(-1)?.value ?? ranges[curve.target][2] }] })}>Add point</Button>
      </section>;
    })}
    <div className="studio-inline"><Select aria-label={`${name} automation parameter`} value={chosenTarget} onChange={e => setTarget(e.target.value as AutomationTarget)}>{available.map(key => <option key={key}>{key}</option>)}</Select><Button variant="secondary" disabled={curves.some(curve => curve.target === chosenTarget) || curves.length >= 16} onClick={() => onChange([...curves, { target: chosenTarget, interpolation: "linear", points: [{ beat: 0, value: ranges[chosenTarget][2] }, { beat: beats, value: ranges[chosenTarget][2] }] }])}>Add automation lane</Button></div>
  </details>;
}
