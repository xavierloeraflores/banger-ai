"use client";

import { useEffect, useState } from "react";
import type { ChatRun } from "@banger/agent/protocol";

export function ChatActivity({ run, legacy }: { run?: ChatRun; legacy?: string[] }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (run?.status !== "running") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [run?.status]);
  if (!run && !legacy?.length) return null;
  const elapsed = run ? Math.max(0, Math.floor(((run.endedAt ?? (now || run.startedAt)) - run.startedAt) / 1000)) : null;
  const status = run?.status === "running" ? run.activity.at(-1)?.message ?? "Starting request"
    : run?.status === "failed" ? "Failed" : run?.status === "stopped" ? "Stopped" : "Completed";
  return <details className={`ai-chat-activity${run?.status === "running" ? " ai-chat-working" : ""}`} aria-live="off">
    <summary><span>Activity{run ? ` · ${status}` : ""}</span>{elapsed !== null && <span className="ai-chat-elapsed">{elapsed}s</span>}</summary>
    <ol>{run ? run.activity.map((item, index) => <li key={index}><span>{item.message}</span><time>{Math.max(0, Math.floor((item.at - run.startedAt) / 1000))}s</time></li>) : legacy?.map((item, index) => <li key={index}>{item}</li>)}</ol>
  </details>;
}
