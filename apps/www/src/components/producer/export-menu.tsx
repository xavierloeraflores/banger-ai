import { useState } from "react";
import { Button } from "@banger/shadcn";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@banger/shadcn/components/dropdown-menu";
import "./export-menu.css";

export function ExportMenu({ disabled, onExport }: { disabled: boolean; onExport(library: boolean): void }) {
  const [open, setOpen] = useState(false);
  return <div className="studio-export-menu">
    <DropdownMenu open={open && !disabled} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild><Button variant="secondary" disabled={disabled}>Export</Button></DropdownMenuTrigger>
      <DropdownMenuContent className="studio-export-options" align="end" sideOffset={8} collisionPadding={16} aria-label="Export song">
        <DropdownMenuItem asChild onSelect={() => onExport(false)}><button type="button">Export and download</button></DropdownMenuItem>
        <DropdownMenuItem asChild onSelect={() => onExport(true)}><button type="button">Export and save to library</button></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
