"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { MUSIC_LIMITS, pianoNotes, type MusicTrack, type PianoNote } from "@banger/compiler";
import { Button, Input, Range, Select } from "@banger/shadcn";

const ROW = 22;

const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const pitchName = (midi: number) => `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
type Gesture = { index: number; mode: "move" | "resize"; x: number; y: number; width: number; original: PianoNote; preview: PianoNote; track: MusicTrack };

export function PianoRoll({ track, disabled, visible, playing, phase, beats = 4, onChange }: {
  track: MusicTrack; disabled: boolean; visible: boolean; playing: boolean; phase: number; beats?: number;
  onChange: (track: MusicTrack) => unknown;
}) {
  const notes = pianoNotes(track);
  const [snap, setSnap] = useState(.25);
  const [selected, setSelected] = useState<number | null>(null);
  const [velocity, setVelocity] = useState(.8);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const initialPitch = useRef(notes[0]?.midi ?? 60);
  const positioned = useRef(false);
  useEffect(() => {
    // Applying source mounts the roll inside a hidden tab, where scrolling has no effect.
    if (visible && !positioned.current && scroll.current) {
      scroll.current.scrollTop = (127 - initialPitch.current - 5) * ROW;
      positioned.current = true;
    }
  }, [visible]);
  const active = selected === null ? undefined : notes[selected];
  const currentGesture = !disabled && gesture?.track.steps === track.steps && gesture?.track.pianoRoll === track.pianoRoll && gesture?.track.bars === track.bars ? gesture : null;

  function commit(next: PianoNote[]) {
    if (!disabled) onChange({ ...track, steps: [], pianoRoll: next });
  }
  function change(index: number, note: PianoNote) {
    commit(notes.map((item, i) => i === index ? note : item));
  }
  function remove(index: number) {
    commit(notes.filter((_, i) => i !== index));
    setSelected(null);
  }
  function begin(event: PointerEvent<HTMLButtonElement>, index: number, mode: Gesture["mode"]) {
    if (disabled || event.button !== 0 || !grid.current) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelected(index);
    const original = notes[index]!;
    setGesture({ index, mode, x: event.clientX, y: event.clientY, width: grid.current.clientWidth, original, preview: original, track });
  }
  function preview(event: PointerEvent<HTMLButtonElement>, drag: Gesture): PianoNote {
    const delta = Math.round((event.clientX - drag.x) / drag.width * beats / snap) * snap;
    const note = drag.original;
    return drag.mode === "resize"
      ? { ...note, duration: clamp(note.duration + delta, Math.min(snap, note.duration, beats - note.start), beats - note.start) }
      : { ...note, start: clamp(note.start + delta, 0, beats - note.duration), midi: clamp(note.midi - Math.round((event.clientY - drag.y) / ROW), 0, 127) };
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    if (currentGesture) setGesture({ ...currentGesture, preview: preview(event, currentGesture) });
  }
  function finish(event: PointerEvent<HTMLButtonElement>) {
    if (currentGesture) {
      const next = preview(event, currentGesture);
      if (next.start !== currentGesture.original.start || next.midi !== currentGesture.original.midi || next.duration !== currentGesture.original.duration)
        change(currentGesture.index, next);
    }
    setGesture(null);
  }

  return <section role="group" className="piano-roll" aria-label={`${track.name} piano roll`} aria-disabled={disabled}>
    <div className="piano-toolbar">
      <strong>Piano roll</strong><span>{beats} beats</span>
      <label>Snap <Select aria-label={`${track.name} grid snap`} value={snap} disabled={disabled} onChange={e => setSnap(Number(e.target.value))}>
        {[1, .5, .25, .125].map(value => <option value={value} key={value}>{value} beat</option>)}
      </Select></label>
      <Button variant="secondary" disabled={disabled || !notes.length} onClick={() => commit(notes.map(note => {
        const start = Math.min(beats - snap, Math.round(note.start / snap) * snap);
        return { ...note, start, duration: Math.min(beats - start, Math.max(snap, Math.round(note.duration / snap) * snap)) };
      }))}>Quantize notes</Button>
      <label>New velocity <Range aria-label={`${track.name} new note velocity`} min={0} max={1} step={.01} value={velocity} disabled={disabled} onChange={e => setVelocity(Number(e.target.value))} /></label>
      <span>{Math.round(velocity * 100)}%</span>
      <Select aria-label={`${track.name} selected note`} value={selected ?? ""} onChange={e => setSelected(e.target.value === "" ? null : Number(e.target.value))}>
        <option value="">Select a note</option>
        {notes.map((note, i) => <option key={i} value={i}>{i + 1}. {pitchName(note.midi)} at {Number(note.start.toFixed(3))}</option>)}
      </Select>
    </div>
    <div className="piano-time-scroll"><div style={{ minWidth: beats * 64 + 52 }}>
    <div className="piano-ruler" aria-hidden="true"><span>BEAT</span><div>{Array.from({ length: beats }, (_, i) => i + 1).map(beat => <span key={beat}>{beat}</span>)}</div></div>
    <div className="piano-scroll" ref={scroll}>
      <div className="piano-keys" aria-hidden="true">{Array.from({ length: 128 }, (_, i) => <div key={i} data-black={Boolean(names[(127 - i) % 12]?.includes("#"))}>{pitchName(127 - i)}</div>)}</div>
      <div className="piano-grid" style={{ "--piano-beat": `${100 / beats}%`, "--piano-snap": `${100 * snap / beats}%` } as CSSProperties} ref={grid} role="group" aria-label={`${track.name} note grid`}>
        {Array.from({ length: 128 }, (_, i) => {
          const midi = 127 - i;
          return <button type="button" className="piano-row" key={midi} data-midi={midi} data-black={Boolean(names[midi % 12]?.includes("#"))} aria-label={`Add ${pitchName(midi)} to ${track.name}`} disabled={disabled || notes.length >= MUSIC_LIMITS.notes}
            onClick={event => {
              const rect = event.currentTarget.getBoundingClientRect();
              const start = event.detail === 0 ? 0 : clamp(Math.floor((event.clientX - rect.left) / rect.width * beats / snap) * snap, 0, beats - snap);
              commit([...notes, { midi, start, duration: snap, velocity }]);
              setSelected(notes.length);
            }} />;
        })}
        {notes.map((stored, index) => {
          const note = currentGesture?.index === index ? currentGesture.preview : stored;
          const label = `${track.name} note ${index + 1}, ${pitchName(note.midi)}, start ${note.start}, duration ${note.duration}, velocity ${note.velocity}`;
          const pointer = { onPointerMove: move, onPointerUp: finish, onPointerCancel: () => setGesture(null), onLostPointerCapture: () => setGesture(null) };
          return <div className="piano-note" key={index} data-selected={selected === index} data-midi={note.midi} data-start={note.start} data-duration={note.duration} data-velocity={note.velocity}
            style={{ top: (127 - note.midi) * ROW + 1, left: `${note.start / beats * 100}%`, width: `${note.duration / beats * 100}%`, opacity: .45 + note.velocity * .55 }}>
            <button type="button" className="piano-note-body" aria-label={label} aria-pressed={selected === index} aria-disabled={disabled}
              {...pointer} onPointerDown={e => begin(e, index, "move")} onClick={() => setSelected(index)}
              onKeyDown={event => {
                if (event.key === "Escape") { setGesture(null); return; }
                if (disabled) return;
                if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); remove(index); return; }
                const horizontal = event.key === "ArrowRight" ? snap : event.key === "ArrowLeft" ? -snap : 0;
                const vertical = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
                if (!horizontal && !vertical) return;
                event.preventDefault();
                change(index, event.shiftKey && horizontal ? { ...stored, duration: clamp(stored.duration + horizontal, Math.min(snap, beats - stored.start), beats - stored.start) }
                  : { ...stored, start: clamp(stored.start + horizontal, 0, beats - stored.duration), midi: clamp(stored.midi + vertical, 0, 127) });
              }}>{pitchName(note.midi)}</button>
            <button type="button" className="piano-note-resize" aria-label={`Resize ${track.name} note ${index + 1}`} disabled={disabled} {...pointer} onPointerDown={e => begin(e, index, "resize")}
              onKeyDown={event => {
                if (event.key === "Escape") setGesture(null);
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                change(index, { ...stored, duration: clamp(stored.duration + (event.key === "ArrowRight" ? snap : -snap), Math.min(snap, beats - stored.start), beats - stored.start) });
              }} />
          </div>;
        })}
        {playing && <div className="piano-playhead" style={{ left: `${phase * 100}%` }} aria-hidden="true" />}
      </div>
    </div>
    </div></div>
    <div className="piano-inspector">
      {active && selected !== null ? <>
        <label>Pitch <Select aria-label={`${track.name} note pitch`} disabled={disabled} value={active.midi} onChange={e => change(selected, { ...active, midi: Number(e.target.value) })}>
          {Array.from({ length: 128 }, (_, midi) => <option key={midi} value={midi}>{pitchName(midi)}</option>)}
        </Select></label>
        {(["start", "duration", "velocity"] as const).map(field => <label key={field}>{field === "start" ? "Start beat" : field === "duration" ? "Beats" : "Velocity"}
          <Input key={`${selected}-${active[field]}`} aria-label={`${track.name} note ${field}`} disabled={disabled} type="number" min={0} max={field === "velocity" ? 1 : field === "start" ? beats - active.duration : beats - active.start} step="any" defaultValue={active[field]}
            onBlur={event => {
              const value = Number(event.target.value);
              if (event.target.value === "" || !event.target.checkValidity() || !Number.isFinite(value) || (field === "duration" && value <= 0)) { event.target.value = String(active[field]); return; }
              if (value !== active[field]) change(selected, { ...active, [field]: value });
            }} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />
        </label>)}
        <Button disabled={disabled} variant="ghost" onClick={() => remove(selected)}>Delete note</Button>
      </> : <span>{notes.length} notes · Click the grid to add a note.</span>}
    </div>
    <p className="piano-help">Drag notes to move. Drag the right edge to resize. Select a note to edit velocity or delete it. Arrow keys move; Shift + left/right resizes. Delete removes. Escape cancels a drag.</p>
  </section>;
}
