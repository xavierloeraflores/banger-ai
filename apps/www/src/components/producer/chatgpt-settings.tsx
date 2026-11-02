"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@banger/shadcn";
import type { ChatGPTStatus } from "@/lib/chatgpt";

const empty: ChatGPTStatus = { selected: false, activeAccountId: null, signingIn: false, accounts: [], models: [] };
const welcomeKey = "banger.chatgpt.welcome.v1";

export function ChatGPTSettings() {
  const [status, setStatus] = useState<ChatGPTStatus>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  const welcome = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => { void window.bangerChatGPT?.status().then(next => {
      if (active) setStatus(next);
    }).catch(() => { if (active) setError("Could not load ChatGPT accounts."); }); };
    refresh();
    const timer = window.setInterval(refresh, 2000);
    window.addEventListener("banger:ai-settings-changed", refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener("banger:ai-settings-changed", refresh); };
  }, []);
  async function run(action: () => Promise<ChatGPTStatus>, signingIn = false) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    if (signingIn) setStatus(previous => ({ ...previous, signingIn: true }));
    try {
      const next = await action();
      setStatus(next); setError(next.error ?? "");
      window.dispatchEvent(new Event("banger:ai-settings-changed"));
      if (signingIn && next.selected) {
        setNotice("Connected. Eligible AI requests use your ChatGPT plan.");
        let seen = false;
        try { seen = window.localStorage.getItem(welcomeKey) === "seen"; } catch { /* Account access does not require browser storage. */ }
        if (!seen) welcome.current?.showModal();
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update the ChatGPT account."); }
    finally { pending.current = false; setBusy(false); setStatus(previous => ({ ...previous, signingIn: false })); }
  }
  const account = status.accounts.find(item => item.id === status.activeAccountId);
  const disabled = busy || status.signingIn;
  return <section className="chatgpt-settings" aria-labelledby="chatgpt-title">
    <h3 id="chatgpt-title">Use your ChatGPT plan</h3>
    <p>Connect a ChatGPT account to use eligible plan usage for music generation and project edits. Your music and task messages are sent to OpenAI.</p>
    {status.accounts.length > 0 && <>
      <label htmlFor="chatgpt-account">ChatGPT account</label>
      <select id="chatgpt-account" disabled={disabled} value={status.activeAccountId ?? ""} onChange={event => {
        const id = event.target.value;
        const next = status.accounts.find(item => item.id === id);
        void run(() => next?.connected && next.sharing ? window.bangerChatGPT!.selectAccount(id) : window.bangerChatGPT!.signIn(id), !next?.connected || !next.sharing);
      }}>
        <option value="" disabled>Choose an account</option>
        {status.accounts.map(item => <option key={item.id} value={item.id}>{item.label}{!item.connected ? " · signed out" : !item.sharing ? " · plan access needed" : ""}</option>)}
      </select>
    </>}
    {account?.connected && account.sharing && <>
      <label htmlFor="chatgpt-model">ChatGPT model</label>
      <select id="chatgpt-model" value={account.model ?? ""} disabled={disabled || !status.models.length} onChange={event => void run(() => window.bangerChatGPT!.selectModel(event.target.value))}>
        <option value="" disabled>Select an available model</option>
        {status.models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
      </select>
      <p>{status.selected ? "Using ChatGPT plan" : "Choose ChatGPT from the AI model menu to use this account."}</p>
    </>}
    <div className="byok-actions">
      <Button variant="primary" disabled={disabled} onClick={() => void run(() => window.bangerChatGPT!.signIn(account && (!account.connected || !account.sharing) ? account.id : undefined), true)}>
        {account?.connected && account.sharing ? "Add ChatGPT account" : "Continue with ChatGPT"}
      </Button>
      {status.signingIn && <Button onClick={() => void window.bangerChatGPT!.cancelSignIn().catch(() => setError("Could not cancel sign-in."))}>Cancel sign-in</Button>}
      {account?.connected && <Button disabled={disabled} onClick={() => void run(() => window.bangerChatGPT!.signOut(account.id))}>Sign out</Button>}
      <Button variant="ghost" onClick={() => void window.bangerChatGPT!.usage().catch(() => setError("Could not open ChatGPT usage settings."))}>Manage usage</Button>
    </div>
    {status.signingIn && <p role="status">Complete sign-in in your browser, then return here.</p>}
    {error && <p className="has-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <dialog ref={welcome} className="chatgpt-welcome" aria-labelledby="chatgpt-welcome-title" onClose={() => {
      try { window.localStorage.setItem(welcomeKey, "seen"); } catch { /* Optional presentation preference. */ }
    }}>
      <h3 id="chatgpt-welcome-title">You&apos;re using your ChatGPT plan</h3>
      <p>Eligible AI requests in Banger use your ChatGPT plan. Review and manage usage in ChatGPT settings.</p>
      <Button variant="primary" onClick={() => welcome.current?.close()}>Got it</Button>
    </dialog>
  </section>;
}
