import { useState } from "react";
import { MUSIC_LIMITS, resolvePattern, type MusicProgram, type MusicSection } from "@banger/compiler";
import { Button, Input, Select } from "@banger/shadcn";

export function SongArrangement({ program, disabled, section, preview, onPreview, onChange }: {
  program: MusicProgram; disabled: boolean; section?: string; preview?: string;
  onPreview: (section?: string) => void; onChange: (program: MusicProgram) => unknown;
}) {
  const sections = program.sections ?? [], timeline = program.timeline ?? [];
  const [dragged, setDragged] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const chain = program.chainEnabled !== false && timeline.length > 0;
  const bars = timeline.reduce((sum, entry) => sum + (sections.find(item => item.name === entry.section)?.bars ?? 0) * (entry.repeats ?? 1), 0);
  const update = (index: number, next: MusicSection) => onChange({ ...program, sections: sections.map((item, i) => i === index ? next : item) });
  const move = (from: number, to: number) => {
    if (disabled || from === to || from < 0 || to < 0 || to >= timeline.length) return;
    const next = [...timeline]; next.splice(to, 0, next.splice(from, 1)[0]!);
    onChange({ ...program, timeline: next });
  };
  const duplicate = (index: number) => onChange({ ...program, timeline: [...timeline.slice(0, index + 1), { ...timeline[index]! }, ...timeline.slice(index + 1)] });
  return <section className="studio-song" aria-labelledby="song-title">
    <div className="studio-song-heading"><h2 id="song-title">Song arrangement</h2>
      <Button variant={chain ? "primary" : "secondary"} disabled={disabled || !timeline.length} aria-label="Chain arrangement" aria-pressed={chain} onClick={() => { onPreview(); onChange({ ...program, chainEnabled: !chain }); }}>Chain {chain ? "on" : "off"}</Button>
      <span>{timeline.length} sections · {bars} bars</span>
      <Button variant="ghost" disabled={disabled || !timeline.length} onClick={() => { onPreview(); const next = { ...program, chainEnabled: false }; delete next.timeline; onChange(next); }}>Clear timeline</Button>
      {preview && <Button variant="secondary" onClick={() => onPreview()}>Stop preview</Button>}
    </div>
    <fieldset disabled={disabled}>
      <div className="studio-song-palette" aria-label="Sections to append">{sections.map(item => <Button key={item.name} variant="secondary" disabled={timeline.length >= MUSIC_LIMITS.timeline} aria-label={`Append ${item.name}`} onClick={() => onChange({ ...program, timeline: [...timeline, { section: item.name, repeats: 1 }] })}>{item.name}</Button>)}</div>
      {!sections.length && <p>Create a section below, then add it to the song.</p>}
      <ol className="studio-song-timeline" aria-label="Song timeline">{timeline.map((entry, index) => {
        const item = sections.find(item => item.name === entry.section)!;
        return <li key={`${index}-${entry.section}`} draggable={!disabled} data-playing={section === entry.section} data-drop-target={over === index}
          onDragStart={event => { if (disabled) { event.preventDefault(); return; } setDragged(index); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(index)); }}
          onDragOver={event => { if (dragged !== null && !disabled) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(index); } }}
          onDrop={event => { event.preventDefault(); if (dragged !== null) move(dragged, index); setDragged(null); setOver(null); }}
          onDragEnd={() => { setDragged(null); setOver(null); }}>
          <span className="studio-song-grip" aria-hidden="true">⠿</span><span className="studio-song-index">{index + 1}</span>
          <Button className="studio-section-badge" variant={preview === item.name ? "primary" : "secondary"} aria-label={`Preview ${entry.section}, timeline ${index + 1}`} aria-pressed={preview === item.name} onClick={() => onPreview(preview === item.name ? undefined : item.name)}>{item.name}</Button>
          <div className="studio-section-activity" aria-label={`${item.tracks.length} active tracks`}>{program.tracks.map(track => {
            const binding = item.tracks.find(binding => binding.track === track.name);
            const pattern = binding ? resolvePattern(track, binding.pattern) : undefined;
            const active = !!pattern && (pattern.pianoRoll ? pattern.pianoRoll.length > 0 : pattern.steps.some(Boolean));
            return <span key={track.name} data-active={active} title={`${track.name}: ${active ? binding?.pattern ?? "base" : "silent"}`} />;
          })}</div>
          <span>{item.bars} {item.bars === 1 ? "bar" : "bars"}</span>
          <label className="studio-song-repeats">Repeats <Input aria-label={`Timeline ${index + 1} repeats`} type="number" min={1} max={64} value={entry.repeats ?? 1} onChange={e => onChange({ ...program, timeline: timeline.map((item, i) => i === index ? { ...item, repeats: Number(e.target.value) } : item) })} /></label>
          <div className="studio-song-row-actions">
            <Button variant="ghost" disabled={timeline.length >= MUSIC_LIMITS.timeline} aria-label={`Duplicate timeline ${index + 1}`} onClick={() => duplicate(index)}>⧉</Button>
            <Button variant="ghost" aria-label={`Move timeline ${index + 1} earlier`} disabled={!index} onClick={() => move(index, index - 1)}>↑</Button>
            <Button variant="ghost" aria-label={`Move timeline ${index + 1} later`} disabled={index === timeline.length - 1} onClick={() => move(index, index + 1)}>↓</Button>
            <Button variant="ghost" aria-label={`Remove timeline ${index + 1}`} onClick={() => onChange({ ...program, timeline: timeline.filter((_, i) => i !== index) })}>×</Button>
          </div>
        </li>;
      })}</ol>
      <p className="studio-song-help">Drag rows to reorder, or use the arrow buttons. Click a section badge to preview. Enable Chain to play the song in order.</p>
      <details className="studio-arrangement"><summary>Edit sections · {sections.length}</summary>
        <div className="studio-sections">{sections.map((item, index) => <section key={item.name} className="studio-section">
          <Input aria-label={`${item.name} section name`} defaultValue={item.name} onBlur={event => {
            const name = event.target.value; if (name === item.name) return;
            if (!onChange({ ...program, sections: sections.map((section, i) => i === index ? { ...item, name } : section), ...(program.timeline ? { timeline: timeline.map(entry => entry.section === item.name ? { ...entry, section: name } : entry) } : {}) })) event.target.value = item.name;
          }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
          <label>Bars <Input type="number" aria-label={`${item.name} section bars`} min={1} max={64} value={item.bars} onChange={e => update(index, { ...item, bars: Number(e.target.value) })} /></label>
          {program.tracks.map(track => {
            const binding = item.tracks.find(binding => binding.track === track.name);
            return <label key={track.name}>{track.name}<Select aria-label={`${item.name} ${track.name} pattern`} value={binding ? binding.pattern ? `pattern:${binding.pattern}` : "base" : "silent"} onChange={e => update(index, { ...item, tracks: [...item.tracks.filter(binding => binding.track !== track.name), ...(e.target.value === "silent" ? [] : [{ track: track.name, ...(e.target.value === "base" ? {} : { pattern: e.target.value.slice(8) }) }])] })}>
              <option value="silent">Silent</option><option value="base">Base pattern</option>{track.patterns?.map(pattern => <option key={pattern.name} value={`pattern:${pattern.name}`}>{pattern.name}</option>)}
            </Select></label>;
          })}
          <Button variant="ghost" onClick={() => { if (preview === item.name) onPreview(); onChange({ ...program, sections: sections.filter((_, i) => i !== index), timeline: timeline.filter(entry => entry.section !== item.name) }); }}>Remove {item.name}</Button>
        </section>)}</div>
      </details>
      <Button variant="secondary" disabled={sections.length >= MUSIC_LIMITS.sections} onClick={() => {
        let number = sections.length + 1; while (sections.some(item => item.name === `section_${number}`)) number++;
        onChange({ ...program, sections: [...sections, { name: `section_${number}`, bars: 4, tracks: program.tracks.map(track => ({ track: track.name })) }] });
      }}>+ Add section</Button>
    </fieldset>
  </section>;
}
