import { setBrowserSettingsAccount } from "./ai-providers";
// The hosted entry point sets this before mounting the shared studio. Static web
// previews and Electron keep their existing storage names.
let accountId: string | undefined;
export function setBrowserAccount(id: string) { accountId = id; setBrowserSettingsAccount(id); }
export function browserStorageKey(name: string) { return accountId ? `${name}:${accountId}` : name; }
