import { canEditSong } from "@banger/agent/protocol";
import type { ChatSnapshot, ProjectChat } from "./chat-sessions";

// A task can write any selected song, even before its first file claim.
export function isSongAgentEditing(chats: ProjectChat[], song: ChatSnapshot, activeChat: string): boolean {
  return chats.some(chat => chat.status === "running"
    && (song.folder?.id ? chat.snapshot.folder?.id === song.folder.id : chat.id === activeChat)
    && Boolean(chat.history?.permissions.beat || chat.history?.permissions.lyrics)
    && canEditSong(chat.history!.permissions, song.workspaceFile?.path ?? song.fileName));
}
