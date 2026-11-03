import { useRef, useState } from "react";
import type { Step } from "@banger/compiler";
import { StepButton } from "@banger/shadcn";

const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const pitchName = (midi: number) => `${notes[midi % 12]}${Math.floor(midi / 12) - 1}`;
export function SequencerStep({ step, index, name, current, selected, onSelect, newStep, onChange }: { step: Step; index: number; name: string; current: boolean; selected: boolean; onSelect: () => void; newStep: NonNullable<Step>; onChange: (step: Step) => unknown }) {
  const drag = useRef<{ y: number; velocity: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const [velocity, setVelocity] = useState<number | null>(null);
  const active = step !== null, level = velocity ?? step?.velocity ?? 1;
  const locked = Object.keys(step?.locks ?? {}).length > 0;
  const label = `${name}, step ${index + 1}`;
  return <div className="producer-step-cell">
    <StepButton active={active} current={current} accent="var(--producer-lime)" data-current={current} data-selected={selected} className="producer-step"
      aria-label={`${label}, ${step ? step.kind === "note" ? pitchName(step.midi) : "hit" : "rest"}, velocity ${Math.round(level * 100)}%${locked ? ", parameter locks" : ""}`} aria-pressed={active}
      aria-describedby="producer-step-help" aria-details={selected ? "producer-step-inspector" : undefined}
      title="Click to toggle. Shift-click to inspect. Drag to adjust velocity."
      onFocus={onSelect}
      onPointerDown={event => { onSelect(); if (event.button !== 0 || !step) return; drag.current = { y: event.clientY, velocity: step.velocity ?? 1, moved: false }; dragged.current = false; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { const start = drag.current; if (!start) return; if (Math.abs(event.clientY - start.y) > 3) start.moved = true; if (start.moved) setVelocity(Math.max(0, Math.min(1, Math.round((start.velocity + (start.y - event.clientY) / 100) * 100) / 100))); }}
      onPointerUp={event => { const start = drag.current; drag.current = null; if (!start) return; dragged.current = start.moved; if (start.moved && step) onChange({ ...step, velocity: Math.max(0, Math.min(1, Math.round((start.velocity + (start.y - event.clientY) / 100) * 100) / 100)) }); setVelocity(null); }}
      onPointerCancel={() => { drag.current = null; setVelocity(null); }}
      onKeyDown={event => {
        if (event.shiftKey && step && ["ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault();
          onChange({ ...step, velocity: Math.round(Math.max(0, Math.min(1, (step.velocity ?? 1) + (event.key === "ArrowUp" ? .05 : -.05))) * 100) / 100 });
          return;
        }
        if (event.key.toLowerCase() === "e") { event.preventDefault(); (document.querySelector<HTMLInputElement>(".producer-step-inspector input:not(:disabled)") ?? document.querySelector<HTMLButtonElement>(".producer-step-inspector button:not(:disabled)"))?.focus(); return; }
        const row = event.currentTarget.closest(".producer-track");
        const buttons = row?.querySelectorAll<HTMLButtonElement>(".producer-step");
        if (!buttons) return;
        let target: HTMLButtonElement | undefined;
        if (event.key === "ArrowLeft") target = buttons[Math.max(0, index - 1)];
        if (event.key === "ArrowRight") target = buttons[Math.min(buttons.length - 1, index + 1)];
        if (event.key === "Home") target = buttons[0];
        if (event.key === "End") target = buttons[buttons.length - 1];
        if (["ArrowUp", "ArrowDown"].includes(event.key)) {
          const rows = Array.from(row!.parentElement!.children);
          const nextRow = rows[rows.indexOf(row!) + (event.key === "ArrowUp" ? -1 : 1)];
          const nextButtons = nextRow?.querySelectorAll<HTMLButtonElement>(".producer-step");
          target = nextButtons?.[Math.min(index, nextButtons.length - 1)];
        }
        if (target) { event.preventDefault(); target.focus({ preventScroll: true }); target.scrollIntoView({ block: "nearest", inline: "nearest" }); }
      }}
      onClick={event => { onSelect(); if (dragged.current) { dragged.current = false; return; } if (!event.shiftKey) onChange(step ? null : newStep); }}>
      <span className="producer-step-tone" aria-hidden="true">{step?.kind === "note" ? pitchName(step.midi) : step ? "●" : ""}</span>
      {locked && <span className="producer-step-lock" aria-hidden="true">◆</span>}
    </StepButton>
  </div>;
}
