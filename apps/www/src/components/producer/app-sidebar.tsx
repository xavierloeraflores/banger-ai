"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import "./app-sidebar.css";
import { useRecentProjects } from "./recent-projects";
import { chatSidebarLabel, type ProjectChat } from "@/lib/chat-sessions";
import { SettingsMenu } from "./settings-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@banger/shadcn/components/tooltip";

export type AppDestination = "beat" | "vocal" | "library";

const destinations = [
  { id: "library", label: "Library", icon: <><rect x="3" y="4" width="4" height="16" rx="1" /><rect x="10" y="4" width="4" height="16" rx="1" /><path d="m17 4 4 1v15l-4-1z" /></> },
  { id: "beat", label: "Beat Studio", icon: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></> },
  { id: "vocal", label: "Vocal Studio", icon: <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></> },
] as const;

export function AppShell({ active, expanded: requestedExpanded, hasProject = false, onToggle, onNavigate, chats = [], activeChat, onChat, onNewChat, onOpenRecent, onAddProject, songs = [], activeSong, activeProject, projectName, songsBusy = false, onSong, onAddSong, children }: {
  active: AppDestination | "chat";
  expanded: boolean;
  hasProject?: boolean;
  onToggle(): void;
  onNavigate(destination: AppDestination): void;
  chats?: ProjectChat[];
  activeChat?: string;
  onChat?(id: string): void;
  onNewChat?(): void;
  onOpenRecent?(id: string): void;
  onAddProject?(trigger: HTMLButtonElement): void;
  songs?: string[];
  activeSong?: string;
  activeProject?: string;
  projectName?: string;
  songsBusy?: boolean;
  onSong?(path: string): void;
  onAddSong?(): void;
  children: ReactNode;
}) {
  const expanded = hasProject && requestedExpanded;
  const [settingsTarget, setSettingsTarget] = useState<HTMLDivElement | null>(null);
  const recent = useRecentProjects();
  const navigationId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closePanel = () => { onToggle(); toggleRef.current?.focus(); };
  const toggleLabel = expanded ? "Collapse sidebar" : "Expand sidebar";

  return <TooltipProvider delayDuration={150}><div className="app-shell" data-sidebar-expanded={expanded}>
    <aside className="app-sidebar app-sidebar-rail" aria-label="App navigation">
      <div className="app-sidebar-heading">
        <button ref={toggleRef} className="app-sidebar-toggle" type="button" aria-label={toggleLabel} title={toggleLabel} aria-expanded={expanded} aria-controls={navigationId} disabled={!hasProject} onClick={onToggle}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="3" /><path d="M9 3v18" /><path d={expanded ? "m16 9-3 3 3 3" : "m14 9 3 3-3 3"} />
          </svg>
        </button>
      </div>
      <nav className="app-sidebar-nav" aria-label="Studios and library">
        {destinations.map(destination => <button key={destination.id} type="button" className="app-sidebar-link" aria-label={destination.label} aria-current={active === destination.id ? "page" : undefined} title={destination.label} onClick={() => onNavigate(destination.id)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{destination.icon}</svg>
        </button>)}
      </nav>
      <div className="app-sidebar-footer">
        {!hasProject && <button type="button" aria-label="Add project" title="Add project" aria-haspopup="dialog" disabled={!onAddProject} onClick={event => onAddProject?.(event.currentTarget)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M3 7V5h7l2 2h9v13H3zM12 10v7M8.5 13.5h7" /></svg>
        </button>}
        <div ref={setSettingsTarget} />
      </div>
    </aside>
    {expanded && <button className="app-sidebar-backdrop" type="button" aria-label="Close sidebar" onClick={closePanel} />}
    <aside id={navigationId} className="app-sidebar app-sidebar-panel" aria-label="Songs, chats, and projects" hidden={!expanded} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closePanel(); }
    }}>
      <div className="app-sidebar-heading"><span className="app-sidebar-brand">banger<span>_</span></span></div>
      <section className="app-sidebar-songs" aria-label="Songs">
        <div className="app-sidebar-section-heading"><span>Songs</span><button type="button" aria-label="Add song" title="Add song" aria-haspopup="dialog" disabled={songsBusy || !onAddSong} onClick={onAddSong}>+</button></div>
        {projectName && <p className="app-sidebar-project-name" title={projectName}>{projectName}</p>}
        {songs.map(path => <Tooltip key={path}><TooltipTrigger asChild><button type="button" className="app-sidebar-song" data-song-path={path} aria-label={`Open song ${path}`} aria-current={path === activeSong ? "true" : undefined} disabled={songsBusy || !onSong} onClick={() => onSong?.(path)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M9 18V5l12-2v13M9 8l12-2" /><ellipse cx="6" cy="18" rx="3" ry="2" /><ellipse cx="18" cy="16" rx="3" ry="2" /></svg>
          <span className="app-chat-label"><span>{path.replace(/\.banger$/i, "")}</span></span>
        </button></TooltipTrigger><TooltipContent className="app-sidebar-tooltip" side="right" sideOffset={12} collisionPadding={12}>{path}</TooltipContent></Tooltip>)}
        {!songs.length && <p>{projectName ? "No songs in this project." : "Open a project to add songs."}</p>}
      </section>
      <section className="app-sidebar-chats" aria-label="Chats">
        <div className="app-sidebar-section-heading"><span>Chats</span><button type="button" aria-label="New chat" title="New chat" disabled={!onNewChat} onClick={onNewChat}>+</button></div>
        {chats.map(chat => {
          const { project, songs, label } = chatSidebarLabel(chat);
          return <Tooltip key={chat.id}><TooltipTrigger asChild><button type="button" className="app-sidebar-chat" aria-current={chat.id === activeChat ? "page" : undefined} aria-label={`${label} · ${chat.status}`} onClick={() => onChat?.(chat.id)}>
            <span className="app-chat-indicator" data-status={chat.status} aria-hidden="true">{chat.status === "running" ? "◌" : chat.status === "error" ? "!" : chat.status === "done" ? "✓" : "◇"}</span>
            <span className="app-chat-label"><span>{label}</span></span>
          </button></TooltipTrigger>
            <TooltipContent className="app-sidebar-tooltip" side="right" sideOffset={12} collisionPadding={12}>
              <span>{project}</span>{songs.map(song => <small key={song}>{song}</small>)}
            </TooltipContent>
          </Tooltip>;
        })}
        {!chats.length && <p>Chats appear when you open a project.</p>}
      </section>
      <section className="app-sidebar-recents" aria-label="Projects">
        <div className="app-sidebar-section-heading"><span>Projects</span><button type="button" aria-label="Add project" title="Add project" aria-haspopup="dialog" disabled={!onAddProject} onClick={event => onAddProject?.(event.currentTarget)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button></div>
        {recent.map(project => <Tooltip key={project.id}><TooltipTrigger asChild><button type="button" aria-label={`Open project ${project.name}`} aria-current={project.id === activeProject ? "true" : undefined} title={project.name} onClick={() => onOpenRecent?.(project.id)} disabled={!onOpenRecent}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 7V5h7l2 2h9v13H3z" /></svg><span className="app-chat-label">{project.name}</span>
        </button></TooltipTrigger>
          <TooltipContent className="app-sidebar-tooltip" side="right" sideOffset={12} collisionPadding={12}>{project.name}</TooltipContent>
        </Tooltip>)}
      </section>
    </aside>
    <div className="app-shell-content">{children}<div className="producer app-settings-host"><SettingsMenu triggerContainer={settingsTarget} expanded={false} /></div></div>
  </div></TooltipProvider>;
}
