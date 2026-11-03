import { programDurationBeats, type MusicProgram, type Send, type MusicBus } from "@banger/compiler";
import { Button, Range, Select } from "@banger/shadcn";
import { TrackEffects } from "./track-effects";
import { AutomationEditor } from "./automation-editor";

export function LevelMeter({ name, level = 0 }: { name: string; level?: number }) {
  return <label className="studio-meter">{name}<meter aria-label={`${name} output meter`} min={0} max={1} value={Math.min(1, level)} /><output>{level > 0 ? `${Math.round(20 * Math.log10(level))} dB` : "−∞"}</output></label>;
}
export function Sends({ name, sends = [], buses, isBus = false, onChange }: { name: string; sends?: Send[]; buses: MusicBus[]; isBus?: boolean; onChange: (sends: Send[]) => unknown }) {
  return <div className="studio-sends">{buses.filter(bus => !isBus || bus.name !== name).map(bus => {
    const send = sends.find(item => item.bus === bus.name);
    return <label key={bus.name}>Send to {bus.name}<Range aria-label={`${name} send ${bus.name}`} min={0} max={1} step={.01} value={send?.gain ?? 0} onChange={e => { const gain = Number(e.target.value); onChange([...sends.filter(item => item.bus !== bus.name), ...(gain ? [{ bus: bus.name, gain }] : [])]); }} /><output>{Math.round((send?.gain ?? 0)*100)}%</output></label>;
  })}</div>;
}
export function TrackRouting({ program, index, onChange }: { program: MusicProgram; index: number; onChange: (program: MusicProgram) => unknown }) {
  const track = program.tracks[index]!;
  return <div className="studio-routing"><label>Output <Select aria-label={`${track.name} output`} value={track.output ?? ""} onChange={e => { const next = { ...track }; if (e.target.value) next.output = e.target.value; else delete next.output; onChange({ ...program, tracks: program.tracks.map((item,i) => i === index ? next : item) }); }}><option value="">Master</option>{program.buses?.map(bus => <option key={bus.name}>{bus.name}</option>)}</Select></label>
    <Sends name={track.name} buses={program.buses ?? []} sends={track.sends} onChange={sends => onChange({ ...program, tracks: program.tracks.map((item,i) => i === index ? { ...track, sends } : item) })} />
  </div>;
}
export function BusMixer({ program, disabled, levels = {}, onChange }: { program: MusicProgram; disabled: boolean; levels?: Record<string, { peak: number }>; onChange: (program: MusicProgram) => unknown }) {
  const buses = program.buses ?? [];
  const update = (index: number, bus: MusicBus) => onChange({ ...program, buses: buses.map((item,i) => i === index ? bus : item) });
  return <details className="studio-buses" open><summary className="studio-buses-heading">Mixer buses <span>{buses.length} / 8</span></summary>
    <p className="studio-buses-help">Route tracks to a bus to control their level and effects together.</p>
    <fieldset disabled={disabled} aria-label="Mixer buses">
    <div className="studio-bus-grid">
    {!buses.length && <div className="studio-buses-empty"><strong>No buses yet</strong><p>Add a bus, then choose it from a track&apos;s routing controls.</p></div>}
    {buses.map((bus,index) => <section className="studio-bus" key={bus.name} aria-label={`${bus.name} bus`}>
      <header className="studio-bus-heading"><span className="studio-bus-number">{String(index + 1).padStart(2, "0")}</span><strong title={bus.name}>{bus.name}</strong><span className="studio-bus-destination">→ Master</span></header>
      <div className="studio-bus-level"><LevelMeter name={bus.name} level={levels[bus.name]?.peak} /><label className="studio-bus-gain"><span>Gain</span><output>{Math.round(bus.gain * 100)}%</output><Range aria-label={`${bus.name} gain`} aria-valuetext={`${Math.round(bus.gain * 100)} percent`} min={0} max={1} step={.01} value={bus.gain} onChange={e => update(index, { ...bus, gain: Number(e.target.value) })} /></label></div>
      <TrackEffects track={bus} disabled={disabled} tracks={program.tracks.map(track => track.name)} onChange={next => update(index, { ...bus, ...next })} />
      <details className="studio-bus-sends"><summary>Sends <span>{bus.sends?.length ?? 0} active</span></summary>
      {buses.length === 1 && <p>Add another bus to create a send.</p>}
      <Sends isBus name={bus.name} buses={buses} sends={bus.sends} onChange={sends => update(index, { ...bus, sends })} /></details>
      <AutomationEditor name={bus.name} bus curves={bus.automation} effects={bus.effects} beats={programDurationBeats(program)} onChange={automation => update(index, { ...bus, automation })} />
      <footer className="studio-bus-footer"><Button variant="ghost" onClick={() => onChange({ ...program, buses: buses.filter((_,i) => i !== index).map(item => ({ ...item, sends: item.sends?.filter(send => send.bus !== bus.name) })), tracks: program.tracks.map(track => { const next = { ...track, sends: track.sends?.filter(send => send.bus !== bus.name) }; if (next.output === bus.name) delete next.output; return next; }) })}>Remove {bus.name}</Button></footer>
    </section>)}
    </div><div className="studio-buses-actions"><Button variant="secondary" disabled={buses.length >= 8} onClick={() => { let number = buses.length + 1; while (buses.some(bus => bus.name === `bus_${number}`) || program.tracks.some(track => track.name === `bus_${number}`)) number++; onChange({ ...program, buses: [...buses, { name: `bus_${number}`, gain: .8 }] }); }}>+ Add bus</Button><span>{buses.length >= 8 ? "All 8 buses are in use" : `${8 - buses.length} available`}</span></div>
  </fieldset></details>;
}
