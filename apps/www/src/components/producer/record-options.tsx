import { useId, useRef, useState } from 'react';
import { Button, Input, Modal, Select, type ModalHandle } from '@banger/shadcn';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@banger/shadcn/components/dropdown-menu';

type Choice = { id: string; name: string };
export function RecordOptions({ name, kind = 'record', generating, rename, regenerate, openProject, records = [], addToRecord, songs = [], selectedSongs = [], editSongs, onChange }: {
  name: string; kind?: 'song' | 'record'; generating?: boolean; rename(name: string): Promise<void>; regenerate(): Promise<void>; onChange(): void;
  openProject?(): void; records?: Choice[]; addToRecord?(id: string, name?: string): Promise<void>;
  songs?: Choice[]; selectedSongs?: string[]; editSongs?(ids: string[]): Promise<void>;
}) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(name), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [mode, setMode] = useState<'name' | 'record' | 'songs'>('name'), [recordId, setRecordId] = useState(''), [chosen, setChosen] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const dialog = useRef<ModalHandle>(null), trigger = useRef<HTMLButtonElement>(null), id = useId();
  const title = mode === 'name' ? `Edit ${kind} name` : mode === 'record' ? 'Add to record' : 'Edit record song list';
  function show(next: typeof mode) {
    setMode(next); setDraft(next === 'name' ? name : ''); setRecordId(records[0]?.id ?? ''); setChosen(selectedSongs); setError(''); dialog.current?.showModal();
  }
  async function save() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (mode === 'name') await rename(draft.trim());
      else if (mode === 'record') await addToRecord?.(recordId || crypto.randomUUID(), recordId ? undefined : draft.trim());
      else await editSongs?.(chosen);
      onChange(); dialog.current?.close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save these changes.'); }
    finally { setBusy(false); }
  }
  async function generate() {
    if (busy || generating) return;
    setBusy(true); setNotice('');
    try { await regenerate(); setNotice('Generating new artwork…'); onChange(); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Could not regenerate artwork.'); }
    finally { setBusy(false); }
  }
  function move(index: number, offset: number) {
    setChosen(value => { const next = [...value]; [next[index], next[index + offset]] = [next[index + offset]!, next[index]!]; return next; });
  }
  return <>
    <div className="library-record-options">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild><Button ref={trigger} className="library-record-menu-trigger" variant="ghost" aria-label={`Options for ${name}`}><span aria-hidden="true">⋯</span></Button></DropdownMenuTrigger>
        <DropdownMenuContent className="library-record-menu" align="end" sideOffset={6} collisionPadding={12}
          onCloseAutoFocus={event => { if(dialog.current?.open) event.preventDefault(); }}>
          <DropdownMenuItem disabled={busy} onSelect={() => show('name')}>Edit {kind} name</DropdownMenuItem>
          {openProject && <DropdownMenuItem onSelect={openProject}>Open project</DropdownMenuItem>}
          {addToRecord && <DropdownMenuItem disabled={busy} onSelect={() => show('record')}>Add to record</DropdownMenuItem>}
          {editSongs && <DropdownMenuItem disabled={busy} onSelect={() => show('songs')}>Edit record song list</DropdownMenuItem>}
          <DropdownMenuItem disabled={busy || generating} onSelect={() => void generate()}>Regenerate artwork</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    {notice && !generating && notice !== 'Generating new artwork…' && <p className="library-record-notice" role="status">{notice}</p>}
    <Modal ref={dialog} className="library-record-dialog" aria-label={title} onClose={() => trigger.current?.focus()}>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <h2>{title}</h2>
        {mode === 'record' && <><label htmlFor={`${id}-record`}>Record</label><Select id={`${id}-record`} data-autofocus value={recordId} disabled={busy} onChange={event => setRecordId(event.target.value)}>{records.map(record => <option key={record.id} value={record.id}>{record.name}</option>)}<option value="">New record…</option></Select></>}
        {(mode === 'name' || (mode === 'record' && !recordId)) && <><label htmlFor={id}>{mode === 'name' ? `${kind === 'record' ? 'Record' : 'Song'} name` : 'New record name'}</label><Input id={id} data-autofocus value={draft} maxLength={160} required disabled={busy} onChange={event => setDraft(event.target.value)} /></>}
        {mode === 'songs' && <>
          <p className="library-record-notice">Removed songs stay in your library as standalone songs.</p>
          <ol className="library-edit-songs">{chosen.map((songId, index) => <li key={songId}><span>{songs.find(song => song.id === songId)?.name}</span><Button type="button" variant="ghost" disabled={busy || index === 0} aria-label={`Move ${songs.find(song => song.id === songId)?.name} up`} onClick={() => move(index, -1)}>↑</Button><Button type="button" variant="ghost" disabled={busy || index === chosen.length - 1} aria-label={`Move ${songs.find(song => song.id === songId)?.name} down`} onClick={() => move(index, 1)}>↓</Button><Button type="button" variant="secondary" disabled={busy} onClick={() => setChosen(value => value.filter(id => id !== songId))}>Remove</Button></li>)}</ol>
          <label htmlFor={`${id}-song`}>Add a song</label><Select id={`${id}-song`} value="" disabled={busy} onChange={event => { if (event.target.value) setChosen(value => [...value, event.target.value]); }}><option value="">Choose a song…</option>{songs.filter(song => !chosen.includes(song.id)).map(song => <option key={song.id} value={song.id}>{song.name}</option>)}</Select>
        </>}
        {error && <p role="alert" className="library-error">{error}</p>}
        <div className="library-record-dialog-actions"><Button variant="secondary" type="button" disabled={busy} onClick={() => dialog.current?.close()}>Cancel</Button><Button type="submit" disabled={busy || ((mode === 'name' || (mode === 'record' && !recordId)) && !draft.trim())}>{busy ? 'Saving…' : 'Save'}</Button></div>
      </form>
    </Modal>
  </>;
}
