export type ChatGPTStatus = {
  selected: boolean;
  activeAccountId: string | null;
  signingIn: boolean;
  accounts: { id: string; label: string; email?: string; connected: boolean; sharing: boolean; model?: string; reasoningLevel?: import("@banger/agent/protocol").ReasoningLevel }[];
  models: { id: string; label: string }[];
  error?: string;
};
export type ChatGPTBridge = {
  status(): Promise<ChatGPTStatus>;
  signIn(accountId?: string): Promise<ChatGPTStatus>;
  cancelSignIn(): Promise<void>;
  selectAccount(accountId: string): Promise<ChatGPTStatus>;
  selectModel(model: string): Promise<ChatGPTStatus>;
  signOut(accountId?: string): Promise<ChatGPTStatus>;
  usage(): Promise<void>;
};
declare global { interface Window { bangerChatGPT?: ChatGPTBridge } }
