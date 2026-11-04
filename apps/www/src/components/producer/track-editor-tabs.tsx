
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@banger/shadcn/components/tabs";
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
  return <Tabs className="producer-track-tabs" value={active} onValueChange={value => onSelect(value as TrackEditorTab)}>
    <TabsList className="producer-editor-tabs" aria-label={`${name} editor`}>
      {tabs.map(tab => <TabsTrigger key={tab} value={tab} onClick={() => onSelect(tab)}
        id={`${id}-tab-${tab}`} aria-controls={`${id}-panel-${tab}`}>
        {tab[0]!.toUpperCase() + tab.slice(1)}
      </TabsTrigger>)}
    </TabsList>
    {/* Keep editors mounted so tab changes retain selection, drafts, and scrolling. */}
    {tabs.map(tab => <TabsContent forceMount value={tab} key={tab} className="producer-editor-panel"
      id={`${id}-panel-${tab}`} aria-labelledby={`${id}-tab-${tab}`} hidden={active !== tab} tabIndex={0}>
      {panels[tab]}
    </TabsContent>)}
  </Tabs>;
}
