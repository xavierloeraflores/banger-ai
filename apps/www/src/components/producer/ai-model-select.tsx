"use client";
import { Select, Button } from "@banger/shadcn";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@banger/shadcn/components/dropdown-menu";


import { useEffect, useRef, useState } from "react";
import { AI_PROVIDERS, aiSettingsBridge, type AIOptionId, type AISettings } from "@/lib/ai-providers";
import type {} from "./local-model";

import { reasoningLevels, type ReasoningLevel } from "@banger/agent/protocol";

function modelName(model: string) {
  const name = model.split("/").at(-1) ?? model;
  const claude = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)$/.exec(name);
  if (claude) return `Claude ${claude[1]![0]!.toUpperCase()}${claude[1]!.slice(1)} ${claude[2]}.${claude[3]}`;
  return name.replace(/^gpt-/, "GPT-").replace(/-(astra|sol|luna|terra)$/, (_, family: string) => ` ${family[0]!.toUpperCase()}${family.slice(1)}`);
}

export function AIModelSelect({ id = "active-ai", mode = "settings", disabled = false }: { id?: string; mode?: "settings" | "model-menu" | "reasoning-menu"; disabled?: boolean }) {
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
  const account = settings.chatgpt?.accounts.find(account => account.id === settings.chatgpt?.activeAccountId);
  const options = [
    ...AI_PROVIDERS.filter(provider => settings.providers[provider.id]?.configured).map(provider => {
      const model = settings.providers[provider.id]!.model;
      return { id: provider.id, label: `${provider.name} · ${model}`, name: modelName(model), detail: provider.name };
    }),
    ...(settings.localModels ?? []).map(model => ({ ...model, name: model.label.replace(/ · local$/, ""), detail: "On this device" })),
    ...(settings.chatgpt?.accounts.some(account => account.connected && account.sharing) ? [{ id: "chatgpt", label: `ChatGPT · ${account?.model ?? "Choose a model"}`, name: modelName(account?.model ?? "Choose a model"), detail: "ChatGPT plan" }] : []),
  ];
  const chatModels = options.flatMap(option => option.id === "chatgpt" && settings.chatgpt?.models.length
    ? settings.chatgpt.models.map(model => ({ id: `chatgpt:${model.id}`, label: `ChatGPT · ${model.id}`, name: model.label, detail: "ChatGPT plan" }))
    : [option]);
  const selected = settings.chatgpt?.selected ? "chatgpt" : settings.localSelected ? `local:${settings.localVariant ?? "small"}` : settings.activeProvider ?? "";
  const modelSettings = selected === "chatgpt" ? account : settings.providers[selected as keyof typeof settings.providers];
  const levels = reasoningLevels(selected, modelSettings?.model ?? "");
  async function selectReasoning(value: string) {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true); setError("");
    try {
      setSettings(await aiSettingsBridge().setReasoning(selected as AIOptionId, value ? value as ReasoningLevel : undefined));
      window.dispatchEvent(new Event("banger:ai-settings-changed"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not change reasoning level."); }
    finally { pending.current = false; setBusy(false); }
  }
  async function select(value: string) {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true); setError("");
    try {
      if (value.startsWith("chatgpt:")) {
        if (!window.bangerChatGPT) throw new Error("ChatGPT is unavailable. Check Settings → AI.");
        await window.bangerChatGPT.selectModel(value.slice("chatgpt:".length));
        value = "chatgpt";
      }
      setSettings(await aiSettingsBridge().select(value as AIOptionId));
      window.dispatchEvent(new Event("banger:ai-settings-changed"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not switch AI models."); }
    finally { pending.current = false; setBusy(false); }
  }
  const reasoning = levels.includes(modelSettings?.reasoningLevel as ReasoningLevel) ? modelSettings?.reasoningLevel ?? "" : "";
  const levelLabel = (level: string) => level === "xhigh" ? "Extra high" : level ? level[0]!.toUpperCase() + level.slice(1) : "Default";
  if (mode !== "settings") {
    const isModel = mode === "model-menu";
    const selectedModel = selected === "chatgpt" && settings.chatgpt?.models.length ? `chatgpt:${account?.model}` : selected;
    const selectedOption = chatModels.find(option => option.id === selectedModel);
    const label = isModel ? selectedOption?.name ?? "Choose model" : levels.length ? `Reasoning · ${levelLabel(reasoning)}` : "Reasoning unavailable";
    return <div className={`ai-chat-selector ${isModel ? "ai-chat-model-selector" : "ai-chat-reasoning-selector"}`}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button id={`${id}-${isModel ? "model" : "reasoning"}`} variant="ghost" disabled={busy || disabled || (!isModel && !levels.length)}
            aria-label={isModel ? `AI model: ${selectedOption?.label ?? "Choose model"}` : `Reasoning level: ${levels.length ? levelLabel(reasoning) : "Not supported by this model"}`}
            title={isModel ? selectedOption?.label : levels.length ? "Reasoning effort for your next message" : "This model does not offer reasoning controls"}>
            <span>{label}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="ai-chat-select-menu" align="start" side={isModel ? "bottom" : "top"} sideOffset={8} collisionPadding={12}>
          <DropdownMenuLabel>{isModel ? "Model" : "Reasoning effort"}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={isModel ? selectedModel : reasoning} onValueChange={value => void (isModel ? select(value) : selectReasoning(value))}>
            {isModel ? chatModels.map(option => <DropdownMenuRadioItem key={option.id} value={option.id} title={option.label} disabled={busy || disabled}>
              <span className="ai-chat-model-option"><span>{option.name}</span><small>{option.detail}</small></span>
            </DropdownMenuRadioItem>) : ["", ...levels].map(level => <DropdownMenuRadioItem key={level} value={level} disabled={busy || disabled}>{level ? levelLabel(level) : "Provider default"}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          {isModel && <p className="ai-chat-menu-hint">{options.length ? "Manage models in Settings → AI." : "Add a model in Settings → AI to start chatting."} Model settings apply across chats.</p>}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && <p className="has-error" role="alert">{error}</p>}
    </div>;
  }
  return <div className="ai-model-select">
    <label htmlFor={`${id}-model`}>AI model</label>
    <Select id={`${id}-model`} value={selected} disabled={busy || !options.length} onChange={event => void select(event.target.value)}>
      <option value="" disabled>{options.length ? "Choose a configured model" : "Configure a model in Settings → AI"}</option>
      {selected && !options.some(option => option.id === selected) && <option value={selected} disabled>Local model needs a download</option>}
      {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </Select>
    <label htmlFor={`${id}-reasoning`}>Reasoning level</label>
    <Select id={`${id}-reasoning`} value={levels.includes(modelSettings?.reasoningLevel as ReasoningLevel) ? modelSettings?.reasoningLevel ?? "" : ""} disabled={busy || !levels.length} onChange={event => void selectReasoning(event.target.value)}>
      <option value="">Provider default</option>
      {levels.map(level => <option key={level} value={level}>{level === "xhigh" ? "Extra high" : level[0]!.toUpperCase() + level.slice(1)}</option>)}
    </Select>
    {settings.chatgpt?.selected && <span className="chatgpt-usage">Using ChatGPT plan <Button type="button" onClick={() => void window.bangerChatGPT?.usage().catch(() => setError("Could not open usage settings."))}>Manage usage</Button></span>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
