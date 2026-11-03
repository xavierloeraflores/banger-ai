"use client";

import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { highlightBanger } from "@/lib/banger-highlighting";

export function SourceEditor({ source, error, errorOffset, disabled, editor, onChange, onApply }: {
  source: string;
  error: string | null;
  errorOffset?: number;
  disabled: boolean;
  editor: RefObject<HTMLTextAreaElement | null>;
  onChange: (source: string) => void;
  onApply: () => void;
}) {
  const backdrop = useRef<HTMLPreElement>(null);
  const tokens = useMemo(() => highlightBanger(source, errorOffset), [source, errorOffset]);
  const syncScroll = () => {
    if (!backdrop.current || !editor.current) return;
    backdrop.current.scrollTop = editor.current.scrollTop;
    backdrop.current.scrollLeft = editor.current.scrollLeft;
  };
  useLayoutEffect(syncScroll);

  return <div className="producer-source-editor">
    <pre ref={backdrop} className="producer-source-highlight" aria-hidden="true">{tokens.map(token =>
      <span key={token.offset} className={`source-${token.kind}${token.error ? " source-error" : ""}`}>{token.text}</span>
    )}</pre>
    <textarea id="producer-source" ref={editor} value={source} disabled={disabled}
      onChange={event => onChange(event.target.value)} onScroll={syncScroll}
      wrap="off" spellCheck={false} autoCapitalize="off" autoCorrect="off"
      aria-invalid={Boolean(error)} aria-describedby="producer-source-help producer-diagnostics"
      onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); onApply(); } }} />
  </div>;
}
