"use client";

import { Activity, forwardRef, useImperativeHandle, useRef, useState, type ComponentPropsWithoutRef } from "react";
import { Dialog, DialogContent, DialogTitle } from "./components/dialog.js";
import { cn } from "./lib/utils.js";

export type ModalHandle = { showModal(): void; close(): void; readonly open: boolean };
type ModalProps = Omit<ComponentPropsWithoutRef<"div">, "onClose" | "onCancel"> & {
  onClose?(): void;
  onCancel?(event: Event): void;
  dismissOnOutsideClick?: boolean;
};

// The imperative API lets asynchronous project and generation workflows open
// shadcn dialogs without moving their state into the UI package.
export const Modal = forwardRef<ModalHandle, ModalProps>(function Modal({
  children, className, onClose, onCancel, dismissOnOutsideClick = false, ...props
}, ref) {
  const [open, setOpen] = useState(false);
  const isOpen = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const callbacks = useRef({ onClose, onCancel });
  callbacks.current = { onClose, onCancel };
  const close = () => {
    if (!isOpen.current) return;
    isOpen.current = false;
    setOpen(false);
  };
  useImperativeHandle(ref, () => ({
    get open() { return isOpen.current; },
    showModal() {
      if (isOpen.current) return;
      trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      isOpen.current = true;
      setOpen(true);
    },
    close,
  }), []);
  const cancel = (event: Event) => {
    callbacks.current.onCancel?.(event);
    if (!event.defaultPrevented) close();
  };
  let portalContainer = anchor.current?.parentElement;
  // Nested dialogs must escape transformed dialog content and its scrolling box.
  while (portalContainer?.closest('[data-slot="dialog-content"]')) {
    portalContainer = portalContainer.closest('[data-slot="dialog-content"]')?.parentElement ?? undefined;
  }
  return <>
    <span hidden ref={anchor} />
    <Dialog open={open} onOpenChange={next => { if (!next) close(); }}>
      <Activity mode={open ? "visible" : "hidden"}>
      <DialogContent forceMount ref={content} {...props} className={cn("banger-modal", className)}
        portalContainer={portalContainer} showCloseButton={false} aria-modal="true"
        aria-describedby={props["aria-describedby"]}
        onEscapeKeyDown={cancel}
        onPointerDownOutside={event => {
          if (dismissOnOutsideClick) cancel(event);
          event.preventDefault();
        }}
        onInteractOutside={event => event.preventDefault()}
        onOpenAutoFocus={event => {
          const autofocus = content.current?.querySelector<HTMLElement>("[autofocus], [data-autofocus]");
          if (autofocus) { event.preventDefault(); autofocus.focus(); }
        }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          trigger.current?.focus();
          callbacks.current.onClose?.();
        }}>
        {/* Existing visible headings retain their IDs and accessible names. */}
        <DialogTitle aria-hidden="true" className="banger-visually-hidden">{props["aria-label"] ?? "Studio dialog"}</DialogTitle>
        {children}
      </DialogContent>
      </Activity>
    </Dialog>
  </>;
});
