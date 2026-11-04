"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@banger/shadcn/components/tooltip";
import { aiSettingsBridge, hasLanguageModel, vocalsConfigured } from "@/lib/ai-providers";

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
        if (active && ticket === revision) setAccess({ languageModel: hasLanguageModel(settings), vocals: vocalsConfigured(settings) });
      } catch { if (active && ticket === revision) setAccess({ languageModel: false, vocals: false }); }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 20000);
    window.addEventListener("banger:ai-settings-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener("banger:ai-settings-changed", refresh); window.removeEventListener("focus", refresh); };
  }, []);
  return access;
}

// The wrapper receives hover and keyboard focus even when its button is disabled.
export function KeyHint({ reason, children, className = "" }: { reason?: string; children: ReactNode; className?: string }) {
  const trigger = <span className={`generation-key-hint ${className}`} tabIndex={reason ? 0 : undefined}>{children}</span>;
  if (!reason) return trigger;
  return <TooltipProvider delayDuration={150}><Tooltip>
    <TooltipTrigger asChild>{trigger}</TooltipTrigger>
    <TooltipContent className="generation-key-tooltip" side="top" sideOffset={8} collisionPadding={16}>{reason}</TooltipContent>
  </Tooltip></TooltipProvider>;
}
