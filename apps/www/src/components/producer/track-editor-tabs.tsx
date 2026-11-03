import type { ReactNode } from "react";

const tabs = ["notes", "sound", "effects", "routing", "automation"] as const;
export type TrackEditorTab = typeof tabs[number];

export function TrackEditorTabs({ id, name, active, onSelect, panels }: {
  id: string;
  name: string;
  active: TrackEditorTab;
  onSelect: (tab: TrackEditorTab) => void;
  panels: Record<TrackEditorTab, ReactNode>;
}) {
  return <>
    <div className="producer-editor-tabs" role="tablist" aria-label={`${name} editor`}>
      {tabs.map((tab, index) => <button key={tab} type="button" role="tab"
        id={`${id}-tab-${tab}`} aria-controls={`${id}-panel-${tab}`} aria-selected={active === tab}
        tabIndex={active === tab ? 0 : -1} onClick={() => onSelect(tab)}
        onKeyDown={event => {
          const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
            : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
            : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
          if (next === null) return;
          event.preventDefault();
          onSelect(tabs[next]!);
          document.getElementById(`${id}-tab-${tabs[next]}`)?.focus({ preventScroll: true });
        }}>{tab[0]!.toUpperCase() + tab.slice(1)}</button>)}
    </div>
    {/* Keep editors mounted so tab changes retain selection, drafts, and scrolling. */}
    {tabs.map(tab => <div key={tab} className="producer-editor-panel" role="tabpanel"
      id={`${id}-panel-${tab}`} aria-labelledby={`${id}-tab-${tab}`} hidden={active !== tab} tabIndex={0}>
      {panels[tab]}
    </div>)}
  </>;
}
