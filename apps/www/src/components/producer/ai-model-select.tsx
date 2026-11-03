"use client";

import { useEffect, useRef, useState } from "react";
import { AI_PROVIDERS, aiSettingsBridge, type AIOptionId, type AISettings } from "@/lib/ai-providers";
import type {} from "./local-model";

export function AIModelSelect() {
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
      } catch { if (active) setError("Could not load AI options. Check Settings → BYOK."); }
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
    <label htmlFor="active-ai-model">AI model</label>
    <select id="active-ai-model" value={selected} disabled={busy || !options.length} onChange={event => void select(event.target.value)}>
      <option value="" disabled>{options.length ? "Choose a configured model" : "Configure a model in Settings → BYOK"}</option>
      {selected && !options.some(option => option.id === selected) && <option value={selected} disabled>Local model needs a download</option>}
      {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
    {settings.chatgpt?.selected && <span className="chatgpt-usage">Using ChatGPT plan <button type="button" onClick={() => void window.bangerChatGPT?.usage().catch(() => setError("Could not open usage settings."))}>Manage usage</button></span>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
