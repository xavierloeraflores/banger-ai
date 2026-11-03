import { type MusicProgram, type Send, type MusicBus } from "@banger/compiler";
import { Range, Select } from "@banger/shadcn";

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
