"use client";

import { useId, useState, type ReactNode } from "react";
import "./app-sidebar.css";
import { useRecentProjects } from "./recent-projects";
import type { ProjectChat } from "@/lib/chat-sessions";
import { SettingsMenu } from "./settings-menu";

export type AppDestination = "beat" | "vocal" | "library";

const destinations = [
  { id: "beat", label: "Beat Studio", icon: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></> },
  { id: "vocal", label: "Vocal Studio", icon: <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></> },
  { id: "library", label: "Library", icon: <><rect x="3" y="4" width="4" height="16" rx="1" /><rect x="10" y="4" width="4" height="16" rx="1" /><path d="m17 4 4 1v15l-4-1z" /></> },
] as const;

export function AppShell({ active, expanded, onToggle, onNavigate, chats = [], activeChat, onChat, onNewChat, onOpenRecent, children }: {
  active: AppDestination;
  expanded: boolean;
  onToggle(): void;
  onNavigate(destination: AppDestination): void;
  chats?: ProjectChat[];
  activeChat?: string;
  onChat?(id: string): void;
  onNewChat?(): void;
  onOpenRecent?(id: string): void;
  children: ReactNode;
}) {
  const [settingsTarget, setSettingsTarget] = useState<HTMLDivElement | null>(null);
  const recent = useRecentProjects();
  const navigationId = useId();
  const toggleLabel = expanded ? "Collapse sidebar" : "Expand sidebar";

  return <div className="app-shell" data-sidebar-expanded={expanded}>
    <aside className="app-sidebar" aria-label="App sidebar">
      <div className="app-sidebar-heading">
        <button className="app-sidebar-toggle" type="button" aria-label={toggleLabel} title={toggleLabel} aria-expanded={expanded} aria-controls={navigationId} onClick={onToggle}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="3" /><path d="M9 3v18" /><path d={expanded ? "m16 9-3 3 3 3" : "m14 9 3 3-3 3"} />
          </svg>
        </button>
        <span className="app-sidebar-brand" hidden={!expanded}>banger<span>_</span></span>
      </div>
      <nav id={navigationId} className="app-sidebar-nav" aria-label="Studios and library">
        {destinations.map(destination => <button key={destination.id} type="button" className="app-sidebar-link" aria-label={destination.label} aria-current={active === destination.id ? "page" : undefined} title={expanded ? undefined : destination.label} onClick={() => onNavigate(destination.id)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{destination.icon}</svg>
          <span hidden={!expanded}>{destination.label}</span>
        </button>)}
      </nav>
      <section className="app-sidebar-chats" aria-label="Chats">
        <div className="app-sidebar-section-heading"><span hidden={!expanded}>Chats</span><button type="button" aria-label="New chat" title="New chat" disabled={!onNewChat} onClick={onNewChat}>+</button></div>
        {chats.map(chat => <button key={chat.id} type="button" className="app-sidebar-chat" aria-current={chat.id === activeChat ? "true" : undefined} aria-label={`${chat.title} · ${chat.snapshot.folder?.name ?? chat.snapshot.fileName} · ${chat.status}`} title={`${chat.title} · ${chat.snapshot.folder?.name ?? chat.snapshot.fileName} · ${chat.status}`} onClick={() => onChat?.(chat.id)}>
          <span className="app-chat-indicator" data-status={chat.status} aria-hidden="true">{chat.status === "running" ? "◌" : chat.status === "error" ? "!" : chat.status === "done" ? "✓" : "◇"}</span>
          <span hidden={!expanded} className="app-chat-label"><span>{chat.title}</span><small>{chat.snapshot.folder?.name ?? chat.snapshot.fileName}</small></span>
        </button>)}
        {!chats.length && expanded && <p>Chats appear when you open a project.</p>}
      </section>
      {!!recent.length && <section className="app-sidebar-recents" aria-label="Recent projects">
        <div className="app-sidebar-section-heading" hidden={!expanded}>Recent projects</div>
        {recent.map(project => <button key={project.id} type="button" aria-label={`Open recent project ${project.name}`} title={project.name} onClick={() => onOpenRecent?.(project.id)} disabled={!onOpenRecent}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 7V5h7l2 2h9v13H3z" /></svg><span hidden={!expanded} className="app-chat-label">{project.name}</span>
        </button>)}
      </section>}
      <div className="app-sidebar-footer" ref={setSettingsTarget} />
    </aside>
    <div className="app-shell-content">{children}<div className="producer app-settings-host"><SettingsMenu triggerContainer={settingsTarget} expanded={expanded} /></div></div>
  </div>;
}
