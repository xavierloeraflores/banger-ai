import { basename, extname } from "node:path";

export const MAX_PROJECT_BYTES = 5 * 1024 * 1024;

export function validateSource(source: unknown): string {
  if (typeof source !== "string") throw new Error("Project source must be text.");
  if (Buffer.byteLength(source, "utf8") > MAX_PROJECT_BYTES) {
    throw new Error("Projects must be 5 MB or smaller.");
  }
  if (source.includes("\0")) throw new Error("Project source cannot contain null characters.");
  return source;
}

export function projectName(name: unknown): string {
  if (typeof name !== "string") throw new Error("Project name must be text.");
  const safe = basename(name.replaceAll("\\", "/")).replace(/[<>:"|?*]/g, "").split("").filter((character) => character.charCodeAt(0) > 31).join("").trim();
  const stem = safe.replace(/\.banger$/i, "").replace(/[. ]+$/g, "") || "Untitled";
  const characters = Array.from(stem).slice(0, 80);
  while (new TextEncoder().encode(characters.join("")).byteLength > 240) characters.pop();
  return `${characters.join("")}.banger`;
}

export function requireProjectExtension(path: string): void {
  if (extname(path).toLowerCase() !== ".banger") {
    throw new Error("Choose a .banger project file.");
  }
}
