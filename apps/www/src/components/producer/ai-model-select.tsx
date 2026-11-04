"use client";
import { Select, Button } from "@banger/shadcn";


import { useEffect, useRef, useState } from "react";
import { AI_PROVIDERS, aiSettingsBridge, type AIOptionId, type AISettings } from "@/lib/ai-providers";
import type {} from "./local-model";

import { reasoningLevels, type ReasoningLevel } from "@banger/agent/protocol";

export function AIModelSelect({ id = "active-ai", reasoningOnly = false }: { id?: string; reasoningOnly?: boolean }) {
  const [settings, setSettings] = useState<AISettings>({ activeProvider: null, providers: {} });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    let localSignature = "";
    const refresh = async () => {
      try {
        const next = await aiSettingsBridge().load();
        if (active) { setSettings(next); setError(next.settingsError ?? ""); }
      } catch { if (active) setError("Could not load AI options. Check Settings → AI."); }
    };
    const changed = () => { void refresh(); };
    void refresh();
    // Downloads continue when their settings panel is closed.
    const timer = window.bangerLocal ? window.setInterval(() => {
      void window.bangerLocal!.status().then(status => {
        const signature = JSON.stringify([status.selected, status.variant, status.installedVariants]);
        if (active && signature !== localSignature) { localSignature = signature; void refresh(); }
      }).catch(() => {});
    }, 2000) : undefined;
    window.addEventListener("banger:ai-settings-changed", changed);
    return () => { active = false; clearInterval(timer); window.removeEventListener("banger:ai-settings-changed", changed); };
  }, []);
  const options = [
    ...AI_PROVIDERS.filter(provider => settings.providers[provider.id]?.configured).map(provider => ({ id: provider.id, label: `${provider.name} · ${settings.providers[provider.id]!.model}` })),
    ...settings.localModels ?? [],
    ...(settings.chatgpt?.accounts.some(account => account.connected && account.sharing) ? [{ id: "chatgpt", label: `ChatGPT · ${settings.chatgpt.accounts.find(account => account.id === settings.chatgpt?.activeAccountId)?.model ?? "Choose a model"}` }] : []),
  ];
  const selected = settings.chatgpt?.selected ? "chatgpt" : settings.localSelected ? `local:${settings.localVariant ?? "small"}` : settings.activeProvider ?? "";
  const account = settings.chatgpt?.accounts.find(account => account.id === settings.chatgpt?.activeAccountId);
  const modelSettings = selected === "chatgpt" ? account : settings.providers[selected as keyof typeof settings.providers];
  const levels = reasoningLevels(selected, modelSettings?.model ?? "");
  async function selectReasoning(value: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      setSettings(await aiSettingsBridge().setReasoning(selected as AIOptionId, value ? value as ReasoningLevel : undefined));
      window.dispatchEvent(new Event("banger:ai-settings-changed"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not change reasoning level."); }
    finally { pending.current = false; setBusy(false); }
  }
  async function select(value: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      setSettings(await aiSettingsBridge().select(value as AIOptionId));
      window.dispatchEvent(new Event("banger:ai-settings-changed"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not switch AI models."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className="ai-model-select">
    {!reasoningOnly && <><label htmlFor={`${id}-model`}>AI model</label>
    <Select id={`${id}-model`} value={selected} disabled={busy || !options.length} onChange={event => void select(event.target.value)}>
      <option value="" disabled>{options.length ? "Choose a configured model" : "Configure a model in Settings → AI"}</option>
      {selected && !options.some(option => option.id === selected) && <option value={selected} disabled>Local model needs a download</option>}
      {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </Select></>}
    <label htmlFor={`${id}-reasoning`}>Reasoning level</label>
    <Select id={`${id}-reasoning`} value={levels.includes(modelSettings?.reasoningLevel as ReasoningLevel) ? modelSettings?.reasoningLevel ?? "" : ""} disabled={busy || !levels.length} onChange={event => void selectReasoning(event.target.value)}>
      <option value="">Provider default</option>
      {levels.map(level => <option key={level} value={level}>{level === "xhigh" ? "Extra high" : level[0]!.toUpperCase() + level.slice(1)}</option>)}
    </Select>
    {!reasoningOnly && settings.chatgpt?.selected && <span className="chatgpt-usage">Using ChatGPT plan <Button type="button" onClick={() => void window.bangerChatGPT?.usage().catch(() => setError("Could not open usage settings."))}>Manage usage</Button></span>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
