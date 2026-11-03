"use client";

import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { aiSettingsBridge, hasLanguageModel } from "@/lib/ai-providers";

export const LLM_KEY_HINT = "Add an AI model API key in Settings to generate beats and lyrics.";
export const VOCAL_KEY_HINT = "Add an ElevenLabs API key in Settings to generate vocals.";

export function useGenerationAccess() {
  const [access, setAccess] = useState({ languageModel: false, vocals: false });
  useEffect(() => {
    let active = true;
    let revision = 0;
    const refresh = async () => {
      const ticket = ++revision;
      try {
        const settings = await aiSettingsBridge().load();
        if (active && ticket === revision) setAccess({ languageModel: hasLanguageModel(settings), vocals: Boolean(settings.elevenLabsConfigured) });
      } catch { if (active && ticket === revision) setAccess({ languageModel: false, vocals: false }); }
    };
    void refresh();
    window.addEventListener("banger:ai-settings-changed", refresh);
    return () => { active = false; window.removeEventListener("banger:ai-settings-changed", refresh); };
  }, []);
  return access;
}

// The wrapper receives hover and keyboard focus even when its button is disabled.
export function KeyHint({ reason, children, className = "" }: { reason?: string; children: ReactNode; className?: string }) {
  const id = useId();
  const [position, setPosition] = useState<CSSProperties>({});
  function place(element: HTMLElement) {
    if (!reason) return;
    const rect = element.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 32);
    setPosition({ width, left: Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16)), right: "auto",
      ...(rect.top > 100 ? { bottom: window.innerHeight - rect.top + 8, top: "auto" } : { top: rect.bottom + 8, bottom: "auto" }) });
  }
  return <span className={`generation-key-hint ${className}`} onMouseEnter={event => place(event.currentTarget)} onFocus={event => place(event.currentTarget)} tabIndex={reason ? 0 : undefined} aria-describedby={reason ? id : undefined}>
    {children}
    {reason && <span id={id} role="tooltip" style={position} className="generation-key-tooltip">{reason}</span>}
  </span>;
}
