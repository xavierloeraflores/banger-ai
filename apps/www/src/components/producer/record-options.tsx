import { useId, useRef, useState } from 'react';
import { Button, Input, Modal, type ModalHandle } from '@banger/shadcn';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@banger/shadcn/components/dropdown-menu';

export function RecordOptions({ name, generating, rename, regenerate, onChange }: {
  name: string; generating?: boolean; rename(name: string): Promise<void>; regenerate(): Promise<void>; onChange(): void;
}) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(name), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialog = useRef<ModalHandle>(null), trigger = useRef<HTMLButtonElement>(null), id = useId();
  async function save() {
    if (busy) return;
    setBusy(true); setError('');
    try { await rename(draft.trim()); onChange(); dialog.current?.close(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not rename the record.'); }
    finally { setBusy(false); }
  }
  async function generate() {
    if (busy || generating) return;
    setBusy(true); setNotice('');
    try { await regenerate(); setNotice('Generating new artwork…'); onChange(); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Could not regenerate artwork.'); }
    finally { setBusy(false); }
  }
  return <>
    <div className="library-record-options">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild><Button ref={trigger} className="library-record-menu-trigger" variant="ghost" aria-label={`Options for ${name}`}><span aria-hidden="true">⋯</span></Button></DropdownMenuTrigger>
        <DropdownMenuContent className="library-record-menu" align="end" sideOffset={6} collisionPadding={12}
          onCloseAutoFocus={event => { if(dialog.current?.open) event.preventDefault(); }}>
          <DropdownMenuItem disabled={busy} onSelect={() => { setDraft(name); setError(''); dialog.current?.showModal(); }}>Edit record name</DropdownMenuItem>
          <DropdownMenuItem disabled={busy || generating} onSelect={() => void generate()}>Regenerate artwork</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    {notice && !generating && notice !== 'Generating new artwork…' && <p className="library-record-notice" role="status">{notice}</p>}
    <Modal ref={dialog} className="library-record-dialog" aria-label="Edit record name" onClose={() => trigger.current?.focus()}>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <h2>Edit record name</h2>
        <label htmlFor={id}>Record name</label>
        <Input id={id} data-autofocus value={draft} maxLength={160} required disabled={busy} onChange={event => setDraft(event.target.value)} />
        {error && <p role="alert" className="library-error">{error}</p>}
        <div className="library-record-dialog-actions"><Button variant="secondary" type="button" onClick={() => dialog.current?.close()}>Cancel</Button><Button type="submit" disabled={busy || !draft.trim()}>{busy ? 'Saving…' : 'Save'}</Button></div>
      </form>
    </Modal>
  </>;
}
