"use client";

export type OpenedProject = { name: string; source: string };
export type SavedProject = { name: string };
type ProjectBridge = {
  openProject(): Promise<OpenedProject | null>;
  saveProject(source: string, name: string): Promise<SavedProject | null>;
};
declare global { interface Window { bangerProjects?: ProjectBridge } }

const MAX_PROJECT_BYTES = 5 * 1024 * 1024;

function validateSource(source: string): string {
  if (typeof source !== "string") throw new Error("Project source must be text.");
  if (new TextEncoder().encode(source).byteLength > MAX_PROJECT_BYTES) {
    throw new Error("Projects must be 5 MB or smaller.");
  }
  if (source.includes("\0")) throw new Error("Project source cannot contain null characters.");
  return source;
}

function projectName(name: string): string {
  if (typeof name !== "string") throw new Error("Project name must be text.");
  const safe = (name.replaceAll("\\", "/").split("/").pop() ?? "")
    .replace(/[<>:"|?*]/g, "").split("").filter((character) => character.charCodeAt(0) > 31).join("").trim();
  const stem = safe.replace(/\.banger$/i, "").replace(/[. ]+$/g, "") || "Untitled";
  const characters = Array.from(stem).slice(0, 80);
  while (new TextEncoder().encode(characters.join("")).byteLength > 240) characters.pop();
  return `${characters.join("")}.banger`;
}

export async function openProject(): Promise<OpenedProject | null> {
  if (window.bangerProjects) return window.bangerProjects.openProject();
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".banger";
    input.hidden = true;
    const cleanup = () => input.remove();
    input.addEventListener("cancel", () => { cleanup(); resolve(null); }, { once: true });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      cleanup();
      if (!file) { resolve(null); return; }
      if (!/\.banger$/i.test(file.name)) { reject(new Error("Choose a .banger project file.")); return; }
      if (file.size > MAX_PROJECT_BYTES) { reject(new Error("Projects must be 5 MB or smaller.")); return; }
      void file.arrayBuffer().then((bytes) => {
        let source: string;
        try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
        catch { throw new Error("The project must contain valid UTF-8 text."); }
        resolve({ name: file.name, source: validateSource(source) });
      }).catch((error: unknown) => reject(error instanceof Error ? error : new Error("Could not read the project.")));
    }, { once: true });
    document.body.append(input);
    input.click();
  });
}

export async function saveProject(source: string, name: string): Promise<SavedProject | null> {
  const text = validateSource(source);
  const filename = projectName(name);
  if (window.bangerProjects) return window.bangerProjects.saveProject(text, filename);
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Keep the URL alive while the browser starts its download.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { name: filename };
}
