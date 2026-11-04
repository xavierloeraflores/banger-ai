import type { ChatReply } from "@banger/agent/protocol";
import type { ProjectFolder, WorkspaceFile } from "./project-workspace";
import type { CloudBinding } from "./cloud-projects";
import { browserStorageKey } from "./browser-account";

export type ChatTurn = { prompt: string; reply: ChatReply; revision: number; project?: string; activity?: string[] };
export type ChatHistory = { error?: string | null; prompt: string; turns: ChatTurn[]; targetFile: string | null; permissions: { beat: boolean; lyrics: boolean }; fullSend: boolean };
export type ChatSnapshot = { revision?: number; source: string; appliedSource: string; savedSource: string; fileName: string; folder?: ProjectFolder; workspaceFile: WorkspaceFile | null; cloudBinding: CloudBinding | null };
export type ProjectChat = { id: string; title: string; snapshot: ChatSnapshot; history?: ChatHistory; status: "idle" | "running" | "done" | "error"; blocksSwitch?: boolean };
const validFile = (file: unknown): boolean => !!file && typeof file === "object" && "name" in file && typeof file.name === "string" && "source" in file && typeof file.source === "string";
const key = () => browserStorageKey("banger.project-chats.v1");
export function readChats(): ProjectChat[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key()) ?? "[]");
    if (!Array.isArray(data)) return [];
    return data.filter((chat): chat is ProjectChat => {
      const snapshot = chat?.snapshot;
      return typeof chat?.id === "string" && typeof chat.title === "string" && snapshot &&
        [snapshot.source, snapshot.appliedSource, snapshot.savedSource, snapshot.fileName].every(value => typeof value === "string") &&
        typeof snapshot.folder?.id === "string" && typeof snapshot.folder.name === "string" && Array.isArray(snapshot.folder.paths) && snapshot.folder.paths.every((path: unknown) => typeof path === "string") &&
        (!snapshot.workspaceFile || (typeof snapshot.workspaceFile.path === "string" && typeof snapshot.workspaceFile.source === "string")) &&
        ["idle", "running", "done", "error"].includes(chat.status) &&
        (!chat.history || (typeof chat.history.prompt === "string" && Array.isArray(chat.history.turns) && chat.history.turns.every((turn: ChatTurn) => typeof turn?.prompt === "string" && typeof turn.reply?.text === "string" && typeof turn.reply.model === "string" && Array.isArray(turn.reply.files) && turn.reply.files.every(validFile)) && typeof chat.history.permissions?.beat === "boolean" && typeof chat.history.permissions?.lyrics === "boolean" && typeof chat.history.fullSend === "boolean" && (chat.history.error == null || typeof chat.history.error === "string")));
    }).map(chat => ({ ...chat, blocksSwitch: false, history: chat.status === "running" && chat.history ? { ...chat.history, error: "This task was interrupted when the app closed. Check saved changes before retrying." } : chat.history, status: chat.status === "running" ? "error" : chat.status }));
  } catch { return []; }
}
export function writeChats(chats: ProjectChat[]) {
  // Cloud credentials belong to the existing account/settings stores, never chat history.
  const safe = chats.filter(chat => chat.snapshot.folder?.id).map(chat => ({ ...chat, snapshot: { ...chat.snapshot, cloudBinding: null } }));
  localStorage.setItem(key(), JSON.stringify(safe));
}
