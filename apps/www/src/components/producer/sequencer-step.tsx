import { useRef, useState, type CSSProperties } from "react";
import { STEP_CONDITIONS, type Step } from "@banger/compiler";
import { StepButton } from "@banger/shadcn";

const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const pitchName = (midi: number) => `${notes[midi % 12]}${Math.floor(midi / 12) - 1}`;
const probabilities = [1, .9, .8, .75, .7, .65, .5, .25, 0];
export function SequencerStep({ step, index, name, current, newStep, onChange }: { step: Step; index: number; name: string; current: boolean; newStep: NonNullable<Step>; onChange: (step: Step) => unknown }) {
  const drag = useRef<{ y: number; velocity: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const [velocity, setVelocity] = useState<number | null>(null);
  const active = step !== null, level = velocity ?? step?.velocity ?? 1;
  const locked = Object.keys(step?.locks ?? {}).length > 0;
  const label = `${name}, step ${index + 1}`;
  return <div className="producer-step-cell" style={{ "--step-velocity": `${level * 100}%` } as CSSProperties}>
    <StepButton active={active} current={current} accent="var(--producer-lime)" data-current={current} className="producer-step"
      aria-label={`${label}, ${step ? step.kind === "note" ? pitchName(step.midi) : "hit" : "rest"}, velocity ${Math.round(level * 100)}%${locked ? ", parameter locks" : ""}`} aria-pressed={active}
      title="Click to toggle. Drag up or down to change velocity. Shift + arrow keys also change velocity."
      onPointerDown={event => { if (event.button !== 0 || !step) return; drag.current = { y: event.clientY, velocity: step.velocity ?? 1, moved: false }; dragged.current = false; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { const start = drag.current; if (!start) return; if (Math.abs(event.clientY - start.y) > 3) start.moved = true; if (start.moved) setVelocity(Math.max(0, Math.min(1, Math.round((start.velocity + (start.y - event.clientY) / 100) * 100) / 100))); }}
      onPointerUp={event => { const start = drag.current; drag.current = null; if (!start) return; dragged.current = start.moved; if (start.moved && step) onChange({ ...step, velocity: Math.max(0, Math.min(1, Math.round((start.velocity + (start.y - event.clientY) / 100) * 100) / 100)) }); setVelocity(null); }}
      onPointerCancel={() => { drag.current = null; setVelocity(null); }}
      onKeyDown={event => { if (!event.shiftKey || !step || !["ArrowUp", "ArrowDown"].includes(event.key)) return; event.preventDefault(); onChange({ ...step, velocity: Math.round(Math.max(0, Math.min(1, (step.velocity ?? 1) + (event.key === "ArrowUp" ? .05 : -.05))) * 100) / 100 }); }}
      onClick={() => { if (dragged.current) { dragged.current = false; return; } onChange(step ? null : newStep); }}>
      <span className="producer-step-index" aria-hidden="true">{index + 1}</span><span className="producer-step-tone">{step?.kind === "note" ? pitchName(step.midi) : step ? "●" : ""}</span>
      {active && <span className="producer-step-velocity" aria-hidden="true">{locked ? "◆ " : ""}{Math.round(level * 100)}</span>}
    </StepButton>
    {step && <div className="producer-step-badges">
      <button type="button" aria-label={`${label} probability ${Math.round((step.probability ?? 1) * 100)}%`} title="Cycle probability" onClick={() => onChange({ ...step, probability: probabilities[(probabilities.indexOf(step.probability ?? 1) + 1) % probabilities.length]! })}>{Math.round((step.probability ?? 1) * 100)}%</button>
      <button type="button" aria-label={`${label} condition ${step.condition ?? "always"}`} title={`Condition: ${step.condition ?? "always"}. Click to cycle.`} onClick={() => onChange({ ...step, condition: STEP_CONDITIONS[(STEP_CONDITIONS.indexOf(step.condition ?? "always") + 1) % STEP_CONDITIONS.length]! })}>{({ always: "C", fill: "F", "not-fill": "!F", first: "1st", "every-2": "2nd", "every-4": "4th" })[step.condition ?? "always"]}</button>
    </div>}
  </div>;
}
