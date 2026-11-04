"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Input } from "@banger/shadcn";
import { aiSettingsBridge } from "@/lib/ai-providers";

export function ElevenLabsSettings() {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [hosted, setHosted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    void aiSettingsBridge().load().then(settings => {
      if (!active) return;
      setDesktop(Boolean(window.bangerAI));
      setSaved(Boolean(settings.elevenLabsConfigured));
      setHosted(Boolean(settings.server?.elevenlabs));
      setLoaded(!settings.settingsError);
      setError(settings.settingsError ?? "");
    }).catch(() => { if (active) setError("Could not load ElevenLabs settings."); });
    return () => { active = false; };
  }, []);
  async function update(remove = false) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const bridge = aiSettingsBridge();
      const settings = await (remove ? bridge.removeElevenLabs() : bridge.saveElevenLabs(key));
      setSaved(Boolean(settings.elevenLabsConfigured)); setKey("");
      setNotice(remove ? "ElevenLabs key removed." : "ElevenLabs key saved. Key has not been verified.");
      window.dispatchEvent(new Event("banger:ai-settings-changed"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update the ElevenLabs key."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className="byok-settings elevenlabs-settings" aria-labelledby="elevenlabs-title">
    <h2 id="elevenlabs-title">Vocals · ElevenLabs</h2>
    <p className="byok-description">Add an ElevenLabs API key to generate vocals from your music. Beat and lyric generation use your selected AI model.</p>
    {hosted && <p className="byok-hint">A hosted ElevenLabs key is available. It is used first and is never shown. A personal key is used only when the server has no key.</p>}
    <form className="byok-form" onSubmit={event => { event.preventDefault(); void update(); }}>
      <fieldset disabled={busy || !loaded}>
        <label htmlFor="elevenlabs-key">{saved ? "Replace ElevenLabs API key" : "ElevenLabs API key"}</label>
        <Input id="elevenlabs-key" type="password" value={key} maxLength={8192} required autoComplete="off" autoCapitalize="none" spellCheck={false}
          placeholder={saved ? "Key saved. Paste a new key to replace it" : "Paste your ElevenLabs API key"}
          aria-describedby="elevenlabs-storage" onChange={event => setKey(event.target.value)} />
        <p id="elevenlabs-storage" className="byok-storage">{desktop ? "Encrypted on this device using operating system protection." : "Stored in this tab for this session. Sent to your connected cloud server only for vocal requests."} Never included in .banger files.</p>
        <div className="byok-actions">
          <Button type="submit" variant="primary" disabled={!key.trim()}>Save ElevenLabs key</Button>
          <Button variant="danger" disabled={!saved} onClick={() => void update(true)}>Remove ElevenLabs key</Button>
        </div>
      </fieldset>
    </form>
    <div className="byok-feedback" aria-live="polite">
      {error && <p role="alert" className="has-error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </div>
  </section>;
}
