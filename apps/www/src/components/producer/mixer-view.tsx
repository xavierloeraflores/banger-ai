import { useRef, useState } from "react";
import { programDurationBeats, type MusicProgram, type MusicTrack } from "@banger/compiler";
import type { MeterSnapshot } from "@banger/engine";
import { Button, Range } from "@banger/shadcn";
import { LevelMeter, Sends, TrackRouting } from "./mixer-routing";
import { TrackEffects } from "./track-effects";
import { AutomationEditor } from "./automation-editor";

const gainText = (gain: number) => gain > 0 ? `${(20 * Math.log10(gain)).toFixed(1)} dB` : "−∞ dB";
type Channel = { kind: "track" | "bus"; name: string } | { kind: "master" };

function Fader({ disabled, name, gain, onChange }: { disabled: boolean; name: string; gain: number; onChange: (gain: number) => unknown }) {
  return <label className="studio-mixer-fader"><output>{gainText(gain)}</output><Range disabled={disabled} aria-label={`Mixer ${name} gain`} aria-orientation="vertical" min={0} max={1} step={.01} value={gain} aria-valuetext={gainText(gain)} onChange={event => onChange(Number(event.target.value))} /><span>Level</span></label>;
}

export function MixerView({ program, disabled, meters, onTrackChange, onChange }: {
  program: MusicProgram; disabled: boolean; meters: MeterSnapshot;
  onTrackChange: (index: number, track: MusicTrack) => unknown; onChange: (program: MusicProgram) => unknown;
}) {
  const [selection, setSelection] = useState<Channel>(() => program.tracks[0] ? { kind: "track", name: program.tracks[0].name } : { kind: "master" });
  const inspectorHeading = useRef<HTMLHeadingElement>(null);
  const masterButton = useRef<HTMLButtonElement>(null);
  const buses = program.buses ?? [];
  const trackIndex = selection.kind === "track" ? program.tracks.findIndex(track => track.name === selection.name) : -1;
  const busIndex = selection.kind === "bus" ? buses.findIndex(bus => bus.name === selection.name) : -1;
  const track = program.tracks[trackIndex], bus = buses[busIndex];
  const selected = track ?? bus;
  const masterSelected = !selected;
  const hasSolo = program.tracks.some(item => item.solo);
  const inspect = (channel: Channel) => { setSelection(channel); inspectorHeading.current?.focus(); };
  const updateBus = (next: typeof buses[number]) => onChange({ ...program, buses: buses.map((item, index) => index === busIndex ? next : item) });
  const removeBus = () => {
    if (!bus) return;
    const result = onChange({ ...program, buses: buses.filter(item => item.name !== bus.name).map(item => ({ ...item, sends: item.sends?.filter(send => send.bus !== bus.name) })), tracks: program.tracks.map(item => {
      const next = { ...item, sends: item.sends?.filter(send => send.bus !== bus.name) };
      if (next.output === bus.name) delete next.output;
      return next;
    }) });
    if (result !== false) { setSelection({ kind: "master" }); masterButton.current?.focus(); }
  };
  const addBus = () => {
    let number = buses.length + 1;
    while ([...buses, ...program.tracks].some(item => item.name === `bus_${number}`)) number++;
    const name = `bus_${number}`;
    if (onChange({ ...program, buses: [...buses, { name, gain: .8 }] }) !== false) inspect({ kind: "bus", name });
  };
  return <section className="studio-mixer" aria-labelledby="mixer-title">
    <div className="studio-song-heading"><h2 id="mixer-title">Mixer</h2><span>{program.tracks.length} tracks · {buses.length} buses</span><span className="studio-mixer-hint">Select a channel to edit its effects and routing.</span></div>
    <div className="studio-mixer-workspace">
      <div className="studio-mixer-console">
        <fieldset className="studio-mixer-bank" aria-label="Mixer channels">
          <div className="studio-mixer-strips" tabIndex={0} role="region" aria-label="Track channels, scroll horizontally for more">
            {program.tracks.map((item, index) => {
              const pan = item.pan ?? 0, panText = pan === 0 ? "Center" : `${Math.round(Math.abs(pan) * 100)}% ${pan < 0 ? "left" : "right"}`;
              const active = trackIndex === index;
              return <section key={item.name} className="studio-mixer-strip" data-selected={active} data-muted={item.muted || (hasSolo && !item.solo)} aria-label={`${item.name} mixer strip`}>
                <Button className="studio-mixer-channel" variant="ghost" aria-label={`Select ${item.name} channel`} aria-pressed={active} aria-controls="mixer-detail" onClick={() => setSelection({ kind: "track", name: item.name })}><span>{String(index + 1).padStart(2, "0")}</span><strong title={item.name}>{item.name}</strong></Button>
                <div className="studio-mixer-chips"><Button variant="ghost" title={`Output: ${item.output ?? "Master"}`} aria-label={`${item.name} output: ${item.output ?? "Master"}. Inspect routing`} aria-controls="mixer-detail" onClick={() => inspect({ kind: "track", name: item.name })}>{item.output ?? "Master"}</Button><Button variant="ghost" aria-label={`${item.name}: ${item.effects?.length ?? 0} effects. Inspect effects`} aria-controls="mixer-detail" onClick={() => inspect({ kind: "track", name: item.name })}>{item.effects?.length ?? 0} FX</Button></div>
                <LevelMeter name={item.name} level={meters.tracks[item.name]?.peak} />
                <Fader disabled={disabled} name={item.name} gain={item.gain} onChange={gain => onTrackChange(index, { ...item, gain })} />
                <label className="studio-mixer-pan"><span>Pan <output>{pan === 0 ? "C" : `${pan < 0 ? "L" : "R"} ${Math.round(Math.abs(pan) * 100)}`}</output></span><Range disabled={disabled} aria-label={`Mixer ${item.name} pan`} min={-1} max={1} step={.01} value={pan} aria-valuetext={panText} onChange={event => onTrackChange(index, { ...item, pan: Number(event.target.value) })} /></label>
                <div className="studio-mixer-switches"><Button disabled={disabled} variant={item.muted ? "primary" : "secondary"} aria-label={`Mixer mute ${item.name}`} title={`Mute ${item.name}`} aria-pressed={!!item.muted} onClick={() => onTrackChange(index, { ...item, muted: !item.muted })}>M</Button><Button disabled={disabled} variant={item.solo ? "primary" : "secondary"} aria-label={`Mixer solo ${item.name}`} title={`Solo ${item.name}`} aria-pressed={!!item.solo} onClick={() => onTrackChange(index, { ...item, solo: !item.solo })}>S</Button></div>
              </section>;
            })}
            {!program.tracks.length && <p>Add a track in the Sequencer to start mixing.</p>}
          </div>
          <section className="studio-mixer-strip studio-mixer-master" data-selected={masterSelected} aria-label="Master mixer strip">
            <Button ref={masterButton} className="studio-mixer-channel" variant="ghost" aria-pressed={masterSelected} aria-controls="mixer-detail" onClick={() => setSelection({ kind: "master" })}><span>OUT</span><strong>Master</strong></Button>
            <span className="studio-mixer-output">Stereo out</span>
            <LevelMeter name="Master mix" level={meters.master.peak} />
            <Fader disabled={disabled} name="Master" gain={program.masterGain ?? 1} onChange={masterGain => onChange({ ...program, masterGain })} />
            <span className="studio-mixer-master-note">Full mix</span>
          </section>
        </fieldset>
        <fieldset className="studio-mixer-buses" aria-label="Mixer buses">
          <div className="studio-mixer-bus-heading"><h3>Buses <span>{buses.length} / 8</span></h3><Button variant="secondary" disabled={disabled || buses.length >= 8} onClick={addBus}>+ Add bus</Button></div>
          <div className="studio-mixer-bus-list">{buses.map((item, index) => <div key={item.name} className="studio-mixer-bus-card"><Button className="studio-mixer-bus-chip" variant="ghost" aria-label={`Select ${item.name} bus`} aria-pressed={busIndex === index} aria-controls="mixer-detail" onClick={() => setSelection({ kind: "bus", name: item.name })}><strong>{item.name}</strong><span>{gainText(item.gain)}</span><span>{item.effects?.length ?? 0} FX</span></Button><LevelMeter name={`${item.name} bus`} level={meters.buses[item.name]?.peak} /></div>)}</div>
          {!buses.length && <p>Add a bus to group tracks or receive sends.</p>}
        </fieldset>
      </div>
      <aside id="mixer-detail" className="studio-mixer-detail" aria-labelledby="mixer-channel-title">
        <header><span>{track ? "Track" : bus ? "Bus" : "Output"}</span><h3 ref={inspectorHeading} tabIndex={-1} id="mixer-channel-title">{selected?.name ?? "Master"}</h3></header>
        <fieldset disabled={disabled} key={selected ? `${track ? "track" : "bus"}:${selected.name}` : "master"}>
          {track && <><h4>Routing &amp; sends</h4><TrackRouting program={program} index={trackIndex} onChange={onChange} /></>}
          {bus && <><h4>Routing &amp; sends</h4><p>Output <strong>Master</strong></p><label className="studio-mixer-bus-gain">Level <output>{gainText(bus.gain)}</output><Range aria-label={`${bus.name} gain`} aria-valuetext={gainText(bus.gain)} min={0} max={1} step={.01} value={bus.gain} onChange={event => updateBus({ ...bus, gain: Number(event.target.value) })} /></label><Sends isBus name={bus.name} buses={buses} sends={bus.sends} onChange={sends => updateBus({ ...bus, sends })} /></>}
          {selected && <><h4>Effects · {selected.effects?.length ?? 0}</h4><TrackEffects open track={selected} disabled={disabled} tracks={program.tracks.map(item => item.name)} onChange={next => track ? onTrackChange(trackIndex, { ...track, ...next }) : updateBus({ ...bus!, ...next })} /><AutomationEditor name={selected.name} bus={!!bus} curves={selected.automation} effects={selected.effects} beats={programDurationBeats(program)} onChange={automation => track ? onTrackChange(trackIndex, { ...track, automation }) : updateBus({ ...bus!, automation })} /></>}
          {bus && <Button className="studio-mixer-remove" variant="danger" onClick={removeBus}>Remove {bus.name}</Button>}
          {masterSelected && <><h4>Stereo output</h4><p>All buses and tracks routed to Master feed this output.</p><p>The master fader controls playback and export volume.</p></>}
        </fieldset>
      </aside>
    </div>
    <p className="studio-mixer-footnote">Mute and solo apply to playback and exports. Sends follow channel level, pan, effects, and mute or solo.</p>
  </section>;
}
