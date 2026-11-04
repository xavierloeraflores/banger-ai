"use client";

import { useRef, useState } from "react";
import { IconButton, Modal, Select, type ModalHandle } from "@banger/shadcn";
import { AIModelSelect } from "./ai-model-select";
import { ElevenLabsSettings } from "./elevenlabs-settings";
import { ByokSettings } from "./byok-menu";
import { HERO_DIFFICULTIES, setHeroDifficulty, useHeroDifficulty, type HeroDifficulty } from "@/lib/muse-hero-settings";

export function SettingsMenu() {
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<ModalHandle>(null);
  const [open, setOpen] = useState(false);
  const difficulty = useHeroDifficulty();

  return <div className="producer-settings">
    <IconButton ref={trigger} aria-label="Settings" title="Settings" variant="ghost" aria-haspopup="dialog" aria-expanded={open} aria-controls="producer-settings-dialog"
      onClick={() => { setOpen(true); dialog.current?.showModal(); }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m9 3-.6 2.4-1.8 1L4.2 6 2 10l1.8 1.6v2L2 15.2 4.2 19l2.4-.4 1.8 1L9 22h5l.6-2.4 1.8-1 2.4.4 2.2-3.8-1.8-1.6v-2L21 10l-2.2-4-2.4.4-1.8-1L14 3Z" />
        <circle cx="11.5" cy="12.5" r="3.5" />
      </svg>
    </IconButton>
    <Modal dismissOnOutsideClick ref={dialog} id="producer-settings-dialog" className="producer-settings-dialog" aria-labelledby="producer-settings-title"
      onClose={() => { setOpen(false); trigger.current?.focus(); }}>
      <div className="producer-settings-content">
        <div className="producer-settings-heading">
          <h2 id="producer-settings-title">Settings</h2>
          <IconButton aria-label="Close settings" variant="ghost" onClick={() => dialog.current?.close()}><span aria-hidden="true">×</span></IconButton>
        </div>
        {open && <>
          <div className="muse-hero-settings">
            <label htmlFor="muse-hero-difficulty">Muse Hero difficulty</label>
            <Select id="muse-hero-difficulty" value={difficulty} onChange={event => setHeroDifficulty(event.target.value as HeroDifficulty)}>
              {HERO_DIFFICULTIES.map(option => <option key={option.value} value={option.value}>{option.label} · {option.lanes} tracks</option>)}
            </Select>
          </div>
          <AIModelSelect /><ByokSettings /><ElevenLabsSettings />
        </>}
      </div>
    </Modal>
  </div>;
}
