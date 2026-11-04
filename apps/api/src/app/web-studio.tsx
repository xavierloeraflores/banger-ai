'use client';
import { Button, Input } from '@banger/shadcn';

import { useEffect, useRef, useState } from 'react';
import { Producer } from '@banger/www/studio';
import './web-studio.css';
import { accountRequest, installWebWorkspace, type ProjectChoice } from './web-workspace';
import { installWebMusic } from './web-music';
import { WebProjectPicker } from './web-project-picker';
import { installWebChat } from './web-chat';
import { setBrowserAccount, browserStorageKey } from '@/lib/browser-account';

type Account = { id: string; username: string };
export function WebStudio({ initialFile }: { initialFile: { name: string; source: string } }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [checking, setChecking] = useState(true);
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [choice, setChoice] = useState<{value: ProjectChoice; resolve(value: string|null): void}|null>(null);

  async function session() {
    const response = await fetch('/api/session', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Could not check your account.');
    if (result.account) { setBrowserAccount(result.account.id); installWebChat(result.account.id); const workspace = installWebWorkspace(accountRequest(result.account.id), value => new Promise(resolve => setChoice({value, resolve})), result.account.id); installWebMusic(result.account.id, workspace); }
    setAccount(result.account);
    if (!result.signInEnabled) throw new Error('Account sign-in is not configured. Please try again later.');
  }
  useEffect(() => {
    queueMicrotask(() => { void session().catch(cause => setError(cause.message)).finally(() => setChecking(false)); });
  }, []);

  async function authenticate(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(register ? '/api/accounts' : '/api/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not sign in.');
      setPassword('');
      await session();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not sign in.'); }
    finally { pending.current = false; setBusy(false); }
  }
  async function signOut() {
    if (pending.current || !window.confirm('Sign out? Save any unfinished work first.')) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/session', { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not sign out. Try again.');
      // Drop tab credentials and all in-memory project/audio state before another account signs in.
      try { sessionStorage.removeItem(browserStorageKey('banger.ai-settings.v1')); } catch { /* Session is already revoked. */ }
      await Promise.allSettled([window.bangerChat?.cancel(), window.bangerWorkspace?.cancel()]);
      delete window.bangerChat; delete window.bangerWorkspace; delete window.bangerStorage; delete window.bangerMusic; delete window.bangerLibrary;
      setAccount(null); setPassword('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not sign out.'); }
    finally { pending.current = false; setBusy(false); }
  }
  if (checking) return <main className="web-auth"><p role="status">Opening your workspace…</p></main>;
  if (account) return <div className="web-hosted">
    <div className="web-account"><span>{account.username}</span><Button disabled={busy} onClick={() => void signOut()}>Sign out</Button>{error && <p role="alert">{error}</p>}</div>
    <Producer key={account.id} initialFile={initialFile} />
    {choice && <WebProjectPicker choice={choice.value} onChoose={value => { choice.resolve(value); setChoice(null); }} />}
  </div>;
  return <main className="web-auth">
    <form className="web-auth-card" onSubmit={authenticate} aria-busy={busy}>
      <div className="producer-wordmark">banger<span>_</span></div>
      <h1>{register ? 'Create your account' : 'Sign in to Banger'}</h1>
      <p>{register ? 'Choose a username and password to start making music.' : 'Your projects are waiting.'}</p>
      <label htmlFor="account-username">Username</label>
      <Input id="account-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={32} pattern="[a-zA-Z0-9_]+" required value={username} onChange={event => setUsername(event.target.value)} aria-describedby={register ? 'username-help' : undefined} />
      {register && <small id="username-help">3–32 letters, numbers or underscores. Usernames ignore case.</small>}
      <label htmlFor="account-password">Password</label>
      <Input id="account-password" name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={12} maxLength={128} required value={password} onChange={event => setPassword(event.target.value)} aria-describedby={register ? 'password-help' : undefined} />
      {register && <small id="password-help">Use 12–128 characters.</small>}
      {error && <p role="alert">{error}</p>}
      <Button type="submit" disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</Button>
      <Button type="button" disabled={busy} onClick={() => { setRegister(!register); setError(''); setPassword(''); }}>{register ? 'Already have an account? Sign in' : 'New to Banger? Create an account'}</Button>
    </form>
  </main>;
}
