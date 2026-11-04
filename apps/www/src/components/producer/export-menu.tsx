import { useId, useRef, type ReactNode } from "react";
import { Button, Modal, type ModalHandle } from "@banger/shadcn";
import { ProjectIcon } from "./project-icon";
import "./export-menu.css";

export function ExportMenu({ disabled, onExport, children, status }: { disabled: boolean; onExport(library: boolean): void; children?: ReactNode; status?: string }) {
  const dialog = useRef<ModalHandle>(null);
  const id = useId();
  return <div className="studio-export-menu">
    <Button variant="secondary" disabled={disabled} aria-haspopup="dialog" aria-controls={id} onClick={() => dialog.current?.showModal()}>Export</Button>
    <Modal ref={dialog} id={id} className="producer-project-dialog studio-export-dialog" aria-labelledby={`${id}-title`}>
      <div className="producer-project-dialog-heading">
        <div><h2 id={`${id}-title`}>Export</h2><p>Download your song or save it to your library.</p></div>
        <Button variant="secondary" aria-label="Close export options" onClick={() => dialog.current?.close()}><ProjectIcon name="close" />Close</Button>
      </div>
      <fieldset className="studio-export-options" disabled={disabled}>
        <div className="studio-export-actions">
          <Button data-autofocus variant="primary" onClick={() => onExport(false)}>Export and download</Button>
          <Button variant="secondary" onClick={() => onExport(true)}>Export and save to library</Button>
        </div>
        {children}
      </fieldset>
      {status && <p role="status" className="studio-export-status">{status}</p>}
    </Modal>
  </div>;
}
