"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Input } from "@banger/shadcn";
import { AI_PROVIDERS, aiSettingsBridge, type AISettings, type ProviderId } from "@/lib/ai-providers";

import { ChatGPTSettings } from "./chatgpt-settings";
import { LocalModelSettings } from "./local-model";

export function ByokSettings() {
  const pending = useRef(false);
  const [settings, setSettings] = useState<AISettings>({ activeProvider: null, providers: {} });
  const [provider, setProvider] = useState<ProviderId | "local" | "chatgpt">("vercel");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const selected = AI_PROVIDERS.find(item => item.id === provider)!;
  const saved = provider !== "local" && provider !== "chatgpt" && settings.providers[provider]?.configured;

  function select(id: ProviderId | "local" | "chatgpt", next = settings) {
    setProvider(id);
    setModel((id === "local" || id === "chatgpt") ? "" : next.providers[id]?.model ?? "");
    setKey("");
    setVisible(false);
    setError(null);
    setNotice("");
  }

  useEffect(() => {
    let active = true;
    void aiSettingsBridge().load().then(next => {
      if (!active) return;
      setDesktop(Boolean(window.bangerAI));
      setSettings(next);
      const id = next.chatgpt?.selected ? "chatgpt" : next.localSelected ? "local" : next.activeProvider ?? "vercel";
      setProvider(id);
      setModel((id === "local" || id === "chatgpt") ? "" : next.providers[id]?.model ?? "");
      setLoaded(true);
      setError(next.settingsError ?? null);
    }).catch(cause => {
      if (active) { setDesktop(Boolean(window.bangerAI)); setError(cause instanceof Error ? cause.message : "Could not load AI settings."); }
    });
    const refresh = () => {
      void aiSettingsBridge().load().then(next => {
        if (active) { setSettings(next); setError(next.settingsError ?? null); }
      }).catch(() => { if (active) setError("Could not refresh AI settings."); });
    };
    window.addEventListener("banger:ai-settings-changed", refresh);
    return () => { active = false; window.removeEventListener("banger:ai-settings-changed", refresh); };
  }, []);

  async function update(remove = false) {
    if (pending.current || provider === "local" || provider === "chatgpt") return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const bridge = aiSettingsBridge();
      const next = await (remove ? bridge.remove(provider) : bridge.save(provider, model, key));
      setSettings(next);
      window.dispatchEvent(new Event("banger:ai-settings-changed"));
      setModel(next.providers[provider]?.model ?? "");
      setKey("");
      setVisible(false);
      setNotice(remove ? `${selected.name} key removed.` : `${selected.name} settings saved. Key has not been verified.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update AI settings."); }
    finally { pending.current = false; setBusy(false); }
  }

  return <section className="byok-settings" aria-labelledby="byok-title" aria-describedby="byok-description">
      <div className="byok-heading">
        <div><p className="producer-eyebrow">BYOK · AI providers</p><h2 id="byok-title">{desktop ? "Choose how to connect" : "Bring your own key"}</h2></div>
      </div>
      <p id="byok-description" className="byok-description">Configure your AI options here. Choose the active model from the AI model menu above.</p>
      <div className="byok-layout">
        <nav className="byok-providers" aria-label="AI providers">
          {desktop && <button type="button" aria-pressed={provider === "chatgpt"} disabled={busy} onClick={() => select("chatgpt")}>
            <span>ChatGPT</span><small>{settings.chatgpt?.selected ? "Selected" : "Use your plan"}</small>
          </button>}
          {desktop && <button type="button" aria-pressed={provider === "local"} disabled={busy} onClick={() => select("local")}>
            <span>Local model</span><small>{settings.localSelected ? "Selected" : "Muse Glimmer · no key"}</small>
          </button>}
          {AI_PROVIDERS.map(item => <button key={item.id} type="button" aria-pressed={provider === item.id}
            disabled={busy || !loaded} onClick={() => select(item.id)}>
            <span>{item.name}</span><small>{!settings.localSelected && !settings.chatgpt?.selected && settings.activeProvider === item.id ? "Selected" : settings.settingsError ? "Locked" : settings.providers[item.id]?.configured ? "Key saved" : "No key"}</small>
          </button>)}
        </nav>
        {provider === "chatgpt" ? <ChatGPTSettings /> : provider === "local" ? <LocalModelSettings /> : <form className="byok-form" onSubmit={event => { event.preventDefault(); void update(); }}>
          <h3>{selected.name}</h3>
          <p className="byok-hint">{selected.hint}</p>
          <fieldset disabled={busy || !loaded}>
            <label htmlFor="byok-model">Model ID</label>
            <Input id="byok-model" value={model} maxLength={200} placeholder={provider === "vercel" ? "provider/model-id" : "model-id"}
              autoComplete="off" spellCheck={false} required onChange={event => setModel(event.target.value)} />
            <label htmlFor="byok-key">{saved ? "Replace API key" : "API key"}</label>
            <div className="byok-key-field">
              <Input id="byok-key" type={visible ? "text" : "password"} value={key} maxLength={8192}
                placeholder={saved ? "Leave blank to keep saved key" : "Paste your API key"} required={!saved}
                autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="byok-storage"
                onChange={event => setKey(event.target.value)} />
              <Button variant="ghost" aria-label={visible ? "Hide API key" : "Show API key"} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? "Hide" : "Show"}</Button>
            </div>
            <p id="byok-storage" className="byok-storage">{desktop
              ? "Keys are encrypted on this device using operating system protection."
              : "Keys stay in this tab's session storage until the tab closes. Scripts on this site can access them."} Keys are used only for your selected provider and never included in .banger files.</p>
            <div className="byok-actions">
              <Button variant="primary" type="submit">{busy ? "Saving…" : "Save and select"}</Button>
              <Button variant="danger" disabled={!saved || busy} onClick={() => void update(true)}>Remove key</Button>
            </div>
          </fieldset>
        </form>}
      </div>
      <div className="byok-feedback" aria-live="polite">
        {!loaded && !error && <p>Loading settings…</p>}
        {error && <p className="has-error" role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
      </div>
    </section>;
}
