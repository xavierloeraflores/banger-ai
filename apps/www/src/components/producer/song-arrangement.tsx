import { useState } from "react";
import { programDurationBeats, type MusicProgram, type MusicSection } from "@banger/compiler";
import { Button, Input, Select } from "@banger/shadcn";

export function SongArrangement({ program, disabled, section, onChange }: { program: MusicProgram; disabled: boolean; section?: string; onChange: (program: MusicProgram) => unknown }) {
  const sections = program.sections ?? [];
  const timeline = program.timeline ?? [];
  const [chosen, setChosen] = useState("");
  const update = (index: number, next: MusicSection) => onChange({ ...program, sections: sections.map((item, i) => i === index ? next : item) });
  return <details className="studio-arrangement" open>
    <summary>Song arrangement · {programDurationBeats(program) / 4} bars</summary>
    <fieldset disabled={disabled}>
      <p>Sections choose which track patterns play. Add sections to the timeline to build the song.</p>
      <div className="studio-sections">{sections.map((item, index) => <section key={item.name} className="studio-section" data-playing={section === item.name}>
        <Input key={item.name} aria-label={`${item.name} section name`} defaultValue={item.name} onBlur={event => {
          const name = event.target.value; if (name === item.name) return;
          if (!onChange({ ...program, sections: sections.map((section,i) => i === index ? { ...item, name } : section), ...(program.timeline ? { timeline: timeline.map(entry => entry.section === item.name ? { ...entry, section: name } : entry) } : {}) })) event.target.value = item.name;
        }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
        <label>Bars <Input type="number" aria-label={`${item.name} section bars`} min={1} max={64} value={item.bars} onChange={e => update(index, { ...item, bars: Number(e.target.value) })} /></label>
        {program.tracks.map(track => <label key={track.name}>{track.name}<Select aria-label={`${item.name} ${track.name} pattern`} value={(item.tracks.find(binding => binding.track === track.name)?.pattern ? `pattern:${item.tracks.find(binding => binding.track === track.name)!.pattern}` : undefined) ?? (item.tracks.some(binding => binding.track === track.name) ? "base" : "silent")} onChange={e => update(index, { ...item, tracks: [...item.tracks.filter(binding => binding.track !== track.name), ...(e.target.value === "silent" ? [] : [{ track: track.name, ...(e.target.value === "base" ? {} : { pattern: e.target.value.slice(8) }) }])] })}>
          <option value="silent">Silent</option><option value="base">Base pattern</option>{track.patterns?.map(pattern => <option key={pattern.name} value={`pattern:${pattern.name}`}>{pattern.name}</option>)}
        </Select></label>)}
        <Button variant="ghost" onClick={() => onChange({ ...program, sections: sections.filter((_, i) => i !== index), timeline: timeline.filter(entry => entry.section !== item.name) })}>Remove {item.name}</Button>
      </section>)}</div>
      <Button variant="secondary" disabled={sections.length >= 64} onClick={() => {
        let number = sections.length + 1; while (sections.some(item => item.name === `section_${number}`)) number++;
        onChange({ ...program, sections: [...sections, { name: `section_${number}`, bars: 4, tracks: program.tracks.map(track => ({ track: track.name })) }] });
      }}>+ Add section</Button>
      <ol className="studio-timeline" aria-label="Song timeline">{timeline.map((entry, index) => <li key={index} data-playing={section === entry.section}>
        <span>{index + 1}. {entry.section}</span>
        <label>Repeats <Input aria-label={`Timeline ${index + 1} repeats`} type="number" min={1} max={64} value={entry.repeats ?? 1} onChange={e => onChange({ ...program, timeline: timeline.map((item, i) => i === index ? { ...item, repeats: Number(e.target.value) } : item) })} /></label>
        <Button variant="ghost" aria-label={`Move timeline ${index + 1} earlier`} disabled={!index} onClick={() => { const next = [...timeline]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; onChange({ ...program, timeline: next }); }}>←</Button>
        <Button variant="ghost" aria-label={`Remove timeline ${index + 1}`} onClick={() => onChange({ ...program, timeline: timeline.filter((_, i) => i !== index) })}>×</Button>
      </li>)}</ol>
      <div className="studio-inline"><Select aria-label="Section to append" value={chosen || sections[0]?.name || ""} onChange={e => setChosen(e.target.value)}>{sections.map(item => <option key={item.name}>{item.name}</option>)}</Select>
        <Button variant="secondary" disabled={!sections.length || timeline.length >= 128} onClick={() => onChange({ ...program, timeline: [...timeline, { section: sections.some(item => item.name === chosen) ? chosen : sections[0]!.name, repeats: 1 }] })}>Append section</Button>
        <Button variant="ghost" disabled={!timeline.length} onClick={() => { const next = { ...program }; delete next.timeline; onChange(next); }}>Loop base patterns</Button>
      </div>
    </fieldset>
  </details>;
}
