import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@banger/shadcn";
import "./export-menu.css";

export function ExportMenu({ disabled, onExport }: { disabled: boolean; onExport(library: boolean): void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const initialItem = useRef(0);
  const expanded = open && !disabled;

  useLayoutEffect(() => {
    if (!expanded) return;
    const position = () => {
      const element = menu.current;
      if (!element) return;
      element.style.translate = "0px";
      const bounds = element.getBoundingClientRect();
      const shift = Math.max(16 - bounds.left, Math.min(0, document.documentElement.clientWidth - 16 - bounds.right));
      element.style.translate = `${shift}px`;
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[initialItem.current]?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [expanded]);

  function choose(library: boolean) {
    setOpen(false);
    trigger.current?.focus();
    onExport(library);
  }

  return <div className="studio-export-menu" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === "Escape" && expanded) {
      event.preventDefault(); event.stopPropagation();
      setOpen(false); trigger.current?.focus();
    }
  }}>
    <Button ref={trigger} variant="secondary" disabled={disabled} aria-haspopup="menu" aria-expanded={expanded} aria-controls={expanded ? id : undefined}
      onClick={() => { initialItem.current = 0; setOpen(value => !value); }}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); initialItem.current = event.key === "ArrowUp" ? 1 : 0; setOpen(true);
        }
      }}>Export</Button>
    {expanded && <div ref={menu} id={id} role="menu" aria-label="Export song" className="studio-export-options" onKeyDown={event => {
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "ArrowDown" ? (index + 1) % items.length
        : event.key === "ArrowUp" ? (index + items.length - 1) % items.length
        : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
      if (next !== null) { event.preventDefault(); items[next]?.focus(); }
    }}>
      <button type="button" role="menuitem" tabIndex={-1} onClick={() => choose(false)}>Export and download</button>
      <button type="button" role="menuitem" tabIndex={-1} onClick={() => choose(true)}>Export and save to library</button>
    </div>}
  </div>;
}
