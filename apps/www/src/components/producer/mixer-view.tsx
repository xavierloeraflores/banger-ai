import { useState, type CSSProperties } from "react";
import type { MusicProgram, MusicTrack } from "@banger/compiler";
import type { MeterSnapshot } from "@banger/engine";
import { Button, Range } from "@banger/shadcn";
import { BusMixer, LevelMeter, TrackRouting } from "./mixer-routing";
import { TrackEffects } from "./track-effects";

export function MixerView({ program, disabled, meters, onTrackChange, onChange }: {
  program: MusicProgram; disabled: boolean; meters: MeterSnapshot;
  onTrackChange: (index: number, track: MusicTrack) => unknown; onChange: (program: MusicProgram) => unknown;
}) {
  const [panel, setPanel] = useState<{ index: number; kind: "effects" | "routing" } | null>(null);
  const selected = panel ? program.tracks[panel.index] : undefined;
  const hasSolo = program.tracks.some(track => track.solo);
  const show = (index: number, kind: "effects" | "routing") => setPanel(panel?.index === index && panel.kind === kind ? null : { index, kind });
  return <section className="studio-mixer" aria-labelledby="mixer-title">
    <div className="studio-song-heading"><h2 id="mixer-title">Mixer</h2><span>{program.tracks.length} tracks</span><LevelMeter name="Master mix" level={meters.master.peak} /></div>
    <fieldset disabled={disabled} className="studio-mixer-strips">
      {program.tracks.map((track, index) => {
        const pan = track.pan ?? 0, panText = pan === 0 ? "Center" : `${Math.round(Math.abs(pan) * 100)}% ${pan < 0 ? "left" : "right"}`;
        return <section key={track.name} className="studio-mixer-strip" data-muted={track.muted || (hasSolo && !track.solo)} style={{ "--strip-color": `hsl(${index * 29 + 335} 85% 63%)` } as CSSProperties} aria-label={`${track.name} mixer strip`}>
          <span className="studio-mixer-number">{index + 1}</span><strong title={track.name}>{track.name}</strong>
          <LevelMeter name={track.name} level={meters.tracks[track.name]?.peak} />
          <label className="studio-mixer-pan">Pan<Range aria-label={`Mixer ${track.name} pan`} min={-1} max={1} step={.01} value={pan} aria-valuetext={panText} onChange={event => onTrackChange(index, { ...track, pan: Number(event.target.value) })} /><output>{panText}</output></label>
          <label className="studio-mixer-fader">Level<Range aria-label={`Mixer ${track.name} gain`} aria-orientation="vertical" min={0} max={1} step={.01} value={track.gain} aria-valuetext={`${Math.round(track.gain * 100)} percent`} onChange={event => onTrackChange(index, { ...track, gain: Number(event.target.value) })} /><output>{Math.round(track.gain * 100)}%</output></label>
          <Button variant={track.muted ? "primary" : "secondary"} aria-label={`Mixer mute ${track.name}`} aria-pressed={!!track.muted} onClick={() => onTrackChange(index, { ...track, muted: !track.muted })}>M</Button>
          <Button variant={track.solo ? "primary" : "secondary"} aria-label={`Mixer solo ${track.name}`} aria-pressed={!!track.solo} onClick={() => onTrackChange(index, { ...track, solo: !track.solo })}>S</Button>
          <Button variant="ghost" aria-label={`${track.name} effects`} aria-expanded={panel?.index === index && panel.kind === "effects"} aria-controls="mixer-detail" onClick={() => show(index, "effects")}>FX</Button>
          <Button variant="ghost" aria-label={`${track.name} routing`} aria-expanded={panel?.index === index && panel.kind === "routing"} aria-controls="mixer-detail" onClick={() => show(index, "routing")}>Routing</Button>
        </section>;
      })}
      {!program.tracks.length && <p>Add a track in the Sequencer to start mixing.</p>}
    </fieldset>
    {panel && selected && <fieldset id="mixer-detail" className="studio-mixer-detail" disabled={disabled}>
      <div className="studio-song-heading"><h3>{selected.name} {panel.kind}</h3><Button variant="ghost" onClick={() => setPanel(null)}>Close</Button></div>
      {panel.kind === "effects" ? <TrackEffects key={selected.name} open track={selected} disabled={disabled} tracks={program.tracks.map(track => track.name)} onChange={next => onTrackChange(panel.index, { ...selected, ...next })} /> : <TrackRouting program={program} index={panel.index} onChange={onChange} />}
    </fieldset>}
    <BusMixer program={program} disabled={disabled} levels={meters.buses} onChange={onChange} />
  </section>;
}
