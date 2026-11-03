import { STEP_CONDITIONS, type Step } from "@banger/compiler";
import { Button, Input, Select } from "@banger/shadcn";

const conditionLabels = { always: "Always", fill: "Fill", "not-fill": "Not fill", first: "First loop", "every-2": "Every 2 loops", "every-4": "Every 4 loops" };

export function StepInspector({ name, index, pattern, step, disabled, newStep, onChange }: {
  name?: string; index?: number; pattern?: string; step?: Step; disabled: boolean;
  newStep?: NonNullable<Step>; onChange: (step: Step) => void;
}) {
  return <section id="producer-step-inspector" className="producer-step-inspector" aria-label="Selected step" onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); document.querySelector<HTMLButtonElement>('.producer-step[data-selected="true"]')?.focus(); }
  }}>
    <div className="producer-inspector-heading">
      <strong>{name === undefined ? "Select a step" : `${name} · Step ${index! + 1}`}</strong>
      <span>{name === undefined ? "Focus a step or Shift-click to inspect it." : `Editing ${pattern || "Base"} · ${step ? step.kind === "note" ? "Note" : "Hit" : "Rest"}`}</span>
    </div>
    {name !== undefined && <fieldset disabled={disabled}>
      <Button variant={step ? "primary" : "secondary"} aria-pressed={!!step} onClick={() => onChange(step ? null : newStep!)}>{step ? "On" : "Off"}</Button>
      <label>Velocity <Input aria-label="Selected step velocity" type="number" min={0} max={100} step={1} disabled={!step} value={Math.round((step?.velocity ?? 1) * 100)} onChange={event => {
        const value = event.target.valueAsNumber;
        if (step && Number.isFinite(value) && value >= 0 && value <= 100) onChange({ ...step, velocity: value / 100 });
      }} /><span>%</span></label>
      <label>Probability <Input aria-label="Selected step probability" type="number" min={0} max={100} step={1} disabled={!step} value={Math.round((step?.probability ?? 1) * 100)} onChange={event => {
        const value = event.target.valueAsNumber;
        if (step && Number.isFinite(value) && value >= 0 && value <= 100) onChange({ ...step, probability: value / 100 });
      }} /><span>%</span></label>
      <label>Condition <Select aria-label="Selected step condition" disabled={!step} value={step?.condition ?? "always"} onChange={event => {
        if (step) onChange({ ...step, condition: event.target.value as NonNullable<Step>["condition"] });
      }}>{STEP_CONDITIONS.map(condition => <option key={condition} value={condition}>{conditionLabels[condition]}</option>)}</Select></label>
    </fieldset>}
  </section>;
}
