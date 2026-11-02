"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Input } from "@banger/shadcn";
import { AI_PROVIDERS, aiSettingsBridge, type AISettings, type ProviderId } from "@/lib/ai-providers";

import { LocalModelSettings } from "./local-model";

export function ByokSettings() {
  const pending = useRef(false);
  const [settings, setSettings] = useState<AISettings>({ activeProvider: null, providers: {} });
  const [provider, setProvider] = useState<ProviderId>("vercel");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const selected = AI_PROVIDERS.find(item => item.id === provider)!;
  const saved = settings.providers[provider]?.configured;

  function select(id: ProviderId, next = settings) {
    setProvider(id);
    setModel(next.providers[id]?.model ?? "");
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
      const id = next.activeProvider ?? "vercel";
      setProvider(id);
      setModel(next.providers[id]?.model ?? "");
      setLoaded(true);
    }).catch(cause => {
      if (active) { setDesktop(Boolean(window.bangerAI)); setError(cause instanceof Error ? cause.message : "Could not load AI settings."); }
    });
    return () => { active = false; };
  }, []);

  async function update(remove = false) {
    if (pending.current) return;
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
        <div><p className="producer-eyebrow">AI providers</p><h2 id="byok-title">{desktop ? "Local model or your own key" : "Bring your own key"}</h2></div>
      </div>
      <p id="byok-description" className="byok-description">Select your own key and model for AI chat.</p>
      {desktop && <LocalModelSettings />}
      <div className="byok-layout">
        <nav className="byok-providers" aria-label="AI providers">
          {AI_PROVIDERS.map(item => <button key={item.id} type="button" aria-pressed={provider === item.id}
            disabled={busy || !loaded} onClick={() => select(item.id)}>
            <span>{item.name}</span><small>{settings.activeProvider === item.id ? "Selected" : settings.providers[item.id]?.configured ? "Key saved" : "No key"}</small>
          </button>)}
        </nav>
        <form className="byok-form" onSubmit={event => { event.preventDefault(); void update(); }}>
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
        </form>
      </div>
      <div className="byok-feedback" aria-live="polite">
        {!loaded && !error && <p>Loading settings…</p>}
        {error && <p className="has-error" role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
      </div>
    </section>;
}
