"use client";
import { useCallback, useEffect, useState } from "react";
import { getProjectWorkspace } from "@/lib/browser-workspace";
import type { RecentProject } from "@/lib/project-workspace";

export function useRecentProjects() {
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const refresh = useCallback(() => {
    void getProjectWorkspace().recent?.().then(setRecent).catch(() => {});
  }, []);
  useEffect(() => { refresh(); window.addEventListener("banger:projects-changed", refresh); return () => window.removeEventListener("banger:projects-changed", refresh); }, [refresh]);
  return recent;
}
