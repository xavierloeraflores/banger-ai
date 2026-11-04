'use client';
import { useEffect, useRef, useState } from 'react';
import type { ProjectChoice } from './web-workspace';

export function WebProjectPicker({ choice, onChoose }: { choice: ProjectChoice; onChoose(value: string | null): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(choice.name ?? '');
  const [selected, setSelected] = useState(choice.projects?.[0]?.id ?? '');
  useEffect(() => {
    const previous = document.activeElement;
    const modal = dialog.current; modal?.showModal();
    return () => { modal?.close(); if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  const create = choice.mode === 'create';
  return <dialog className="web-project-picker" ref={dialog} aria-labelledby="web-project-title" onCancel={event => { event.preventDefault(); onChoose(null); }}>
    <form onSubmit={event => { event.preventDefault(); onChoose(create ? name.trim() : selected); }}>
      <h2 id="web-project-title">{create ? 'Create New Project' : 'Open Project'}</h2>
      {create ? <label>Project name<input autoFocus required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
        : choice.projects?.length ? <label>Project<select autoFocus value={selected} onChange={event => setSelected(event.target.value)}>{choice.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          : <p>No saved projects yet. Create a new project or load the sample to get started.</p>}
      <div><button type="button" onClick={() => onChoose(null)}>Cancel</button><button type="submit" disabled={create ? !name.trim() : !selected}>{create ? 'Create New Project' : 'Open Project'}</button></div>
    </form>
  </dialog>;
}
