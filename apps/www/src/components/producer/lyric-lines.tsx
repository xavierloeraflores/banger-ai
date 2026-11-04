'use client';

import {createContext, useContext, useId, useRef, useState, type DragEvent, type ReactNode} from 'react';
import {Button, Select, Textarea} from '@banger/shadcn';
import {MAX_CHUNK_LINE_CHARACTERS} from '@banger/elevenlabs/protocol';

const splitLines = (text: string) => text.split(/\r\n|\r|\n/);
const lineError = (text: string) => splitLines(text).some(line => Array.from(line).length > MAX_CHUNK_LINE_CHARACTERS)
  ? `Each lyric line can have up to ${MAX_CHUNK_LINE_CHARACTERS} characters. Split this line before adding it.` : undefined;
export function draftLineError(text: string) {
  if (!text.trim()) return 'Add at least one lyric line before saving.';
  if (new TextEncoder().encode(text).length > 12000) return 'Keep the lyric draft under 12 KiB.';
  return lineError(text);
}
type Position = {group: number; line: number};
type Editor = {
  values: string[]; labels: string[]; destinations: string[]; disabled: boolean; id: string;
  update(group: number, text: string): void;
  reject(error: string): void;
  move(from: Position, to: Position): void;
  start(event: DragEvent, from: Position): void;
  drop(event: DragEvent, to: Position): void;
  over(event: DragEvent, to: Position): void;
  end(): void;
  target: Position | null;
};
const Context = createContext<Editor | null>(null);

/** Keep the stored newline format; all groups share one drag operation. */
export function LyricLines({values, labels, destinations = labels, disabled = false, onChange, validate, children}: {
  values: string[]; labels: string[]; destinations?: string[]; disabled?: boolean; onChange(values: string[]): void;
  validate?(group: number, text: string): string | undefined; children: ReactNode;
}) {
  const id = useId();
  const drag = useRef<{from: Position; snapshot: string} | null>(null);
  const [target, setTarget] = useState<Position | null>(null);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  function update(group: number, text: string) {
    if (disabled) return;
    setError('');
    onChange(values.map((value, index) => index === group ? text : value));
  }
  function move(from: Position, to: Position) {
    if (disabled || !values[from.group] || values[to.group] === undefined) return;
    const next = values.map(splitLines);
    const [line] = next[from.group]!.splice(from.line, 1);
    if (line === undefined) return;
    if (from.group !== to.group && values[to.group] === '') next[to.group] = [];
    const at = Math.min(next[to.group]!.length, Math.max(0, to.line - (from.group === to.group && from.line < to.line ? 1 : 0)));
    next[to.group]!.splice(at, 0, line);
    const result = next.map(lines => lines.join('\n'));
    for (const group of new Set([from.group, to.group])) {
      const problem = lineError(result[group]!) ?? validate?.(group, result[group]!);
      if (problem) { setError(problem); return; }
    }
    setError('');
    onChange(result);
    setAnnouncement(`Moved line to ${destinations[to.group]}, position ${at + 1}.`);
    requestAnimationFrame(() => document.getElementById(`${id}-${to.group}-${at}`)?.focus());
  }
  function end() { drag.current = null; setTarget(null); }
  const editor: Editor = {
    values, labels, destinations, disabled, id, update, move, target, end, reject: setError,
    start(event, from) {
      if (disabled) { event.preventDefault(); return; }
      drag.current = {from, snapshot: JSON.stringify(values)};
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-banger-lyric-line', id);
    },
    over(event, to) {
      if (!disabled && drag.current) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setTarget(to); }
    },
    drop(event, to) {
      event.preventDefault();
      if (event.dataTransfer.getData('application/x-banger-lyric-line') === id && drag.current?.snapshot === JSON.stringify(values)) move(drag.current.from, to);
      end();
    },
  };
  return <Context.Provider value={editor}>{children}
    {error && <p className="music-lyric-help" role="alert">{error}</p>}
    <span className="sr-only" role="status">{announcement}</span>
  </Context.Provider>;
}

export function LyricLineGroup({group}: {group: number}) {
  const editor = useContext(Context)!;
  const {values, labels, disabled, id, target} = editor;
  const lines = splitLines(values[group] ?? '');
  const label = labels[group]!;
  const dropProps = (line: number) => ({
    'data-drop-target': target?.group === group && target.line === line,
    onDragOver: (event: DragEvent) => editor.over(event, {group, line}),
    onDrop: (event: DragEvent) => editor.drop(event, {group, line}),
  });
  return <div className="music-lyric-lines">
    <ol aria-label={`Lyrics for ${label}`}>
      {lines.map((text, line) => {
        const name = `${label}, line ${line + 1}`;
        const count = Array.from(text).length;
        return <li key={line} className="music-lyric-line" {...dropProps(line)}>
          <Button className="music-lyric-grip" variant="ghost" draggable={!disabled} disabled={disabled}
            aria-label={`Drag ${name}`} title="Drag to reorder or move to another section"
            onDragStart={event => editor.start(event, {group, line})} onDragEnd={editor.end}>⠿</Button>
          <span className="music-lyric-number" aria-hidden="true">{line + 1}</span>
          <Textarea id={`${id}-${group}-${line}`} aria-label={`Lyrics for ${name}`} rows={1} value={text}
            disabled={disabled} placeholder="Write a lyric line…" aria-invalid={count > MAX_CHUNK_LINE_CHARACTERS}
            aria-describedby={`${id}-${group}-${line}-count`}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
              event.preventDefault();
              const {selectionStart, selectionEnd} = event.currentTarget;
              editor.update(group, lines.flatMap((value, index) => index === line ? [value.slice(0, selectionStart), value.slice(selectionEnd)] : [value]).join('\n'));
              requestAnimationFrame(() => {
                const input = document.getElementById(`${id}-${group}-${line + 1}`) as HTMLTextAreaElement | null;
                input?.focus(); input?.setSelectionRange(0, 0);
              });
            }}
            onChange={event => {
              const value = event.target.value;
              const problem = lineError(value);
              // Existing agent drafts may exceed the limit. Let the user shorten or split them.
              if (problem && Array.from(value).length >= count) { editor.reject(problem); return; }
              editor.update(group, lines.flatMap((previous, index) => index === line ? splitLines(value) : [previous]).join('\n'));
            }}/>
          <span className="music-lyric-count" id={`${id}-${group}-${line}-count`} data-invalid={count > MAX_CHUNK_LINE_CHARACTERS}>{count}/{MAX_CHUNK_LINE_CHARACTERS}</span>
          <div className="music-lyric-actions">
            <Button variant="ghost" aria-label={`Move ${name} up`} disabled={disabled || line === 0}
              onClick={() => editor.move({group, line}, {group, line: line - 1})}>↑</Button>
            <Button variant="ghost" aria-label={`Move ${name} down`} disabled={disabled || line === lines.length - 1}
              onClick={() => editor.move({group, line}, {group, line: line + 2})}>↓</Button>
            {labels.length > 1 && <Select aria-label={`Move ${name} to section`} disabled={disabled} value=""
              onChange={event => {const destination = Number(event.target.value); editor.move({group, line}, {group: destination, line: splitLines(values[destination]!).length});}}>
              <option value="" disabled>Move to…</option>
              {editor.destinations.map((label, index) => index !== group && <option key={index} value={index}>{label}</option>)}
            </Select>}
            <Button variant="ghost" aria-label={`Remove ${name}`} disabled={disabled || (lines.length === 1 && !text)}
              onClick={() => editor.update(group, lines.filter((_, index) => index !== line).join('\n'))}>×</Button>
          </div>
        </li>;
      })}
    </ol>
    <div className="music-lyric-add" {...dropProps(lines.length)}>
      <Button variant="ghost" disabled={disabled} aria-label={`Add line to ${label}`} onClick={() => {
        const next = values[group] ? lines.length : 0;
        editor.update(group, values[group] ? `${values[group]}\n` : '');
        requestAnimationFrame(() => document.getElementById(`${id}-${group}-${next}`)?.focus());
      }}>+ Add line</Button>
      <span>Drag lines here</span>
    </div>
  </div>;
}
