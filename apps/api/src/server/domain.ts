import { createHash } from "node:crypto";
import { validateSource } from "@banger/harness";
import { z } from "zod";
export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}
export const id = z.uuid();
export const pathSchema = z.string().min(1).max(512).refine(path => path.endsWith(".banger") && !/[\\\x00-\x1f]/.test(path) && path.split("/").length <= 12 && path.split("/").every(part => part && !part.startsWith(".")), "Use a relative .banger path without hidden folders or traversal.");
export const changeSchema = z.object({ path: pathSchema, source: z.string().max(65536).nullable() }).strict();
export const saveSchema = z.object({ baseRevision: z.number().int().nonnegative(), changes: z.array(changeSchema).min(1).max(256) }).strict();
export type Change = z.infer<typeof changeSchema>;
export type FileVersion = { path: string; sha256: string; pathname: string; bytes: number };
export type Manifest = { projectId: string; revision: number; files: FileVersion[] };
export const hash = (source: string) => createHash("sha256").update(source).digest("hex");
export function validateChanges(changes: Change[]) {
  if (new Set(changes.map(file => file.path)).size !== changes.length) throw new ApiError(400, "A file may only appear once per save.");
  for (const change of changes) { pathSchema.parse(change.path); if (change.source !== null) {
    try { validateSource(change.source); } catch (error) { throw new ApiError(422, `Cannot save ${change.path}: ${error instanceof Error ? error.message : "Invalid music"}`); }
  } }
}
