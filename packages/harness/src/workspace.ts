import { constants } from "node:fs";
import { lstat, open, opendir, realpath, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { compileMusic, programDurationBeats } from "@banger/compiler";

export const PROJECT_LIMITS = { fileBytes: 65536, files: 256, entries: 4096, depth: 12 } as const;
export type ProjectFile = { path: string; source: string };
export type MusicSummary = { tracks: number; tempo: number; durationBeats: number; patterns: number; sections: number; buses: number };
export type Validation = { path: string; ok: true } & MusicSummary | { path: string; ok: false; error: string };
const ignored = new Set(["node_modules", ".git", "dist", ".next"]);
const failure = (error: unknown) => error instanceof Error ? error.message : "The project operation failed.";

export function validateSource(source: string): MusicSummary {
  if (typeof source !== "string" || Buffer.byteLength(source, "utf8") > PROJECT_LIMITS.fileBytes || source.includes("\0")) throw new Error("Music files must be UTF-8 text under 64 KiB without null characters.");
  const program = compileMusic(source);
  if (!program.tracks.length) throw new Error("Add at least one track.");
  return { tracks: program.tracks.length, tempo: program.tempo, durationBeats: programDurationBeats(program),
    patterns: program.tracks.reduce((count, track) => count + 1 + (track.patterns?.length ?? 0), 0),
    sections: program.sections?.length ?? 0, buses: program.buses?.length ?? 0 };
}

export class ProjectWorkspace {
  readonly root: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(root: string) { this.root = root; }

  private async target(path: string, mayCreate = false): Promise<string> {
    if (typeof path !== "string" || !path || path.length > 512 || isAbsolute(path) || path.includes("\\") || path.includes("\0") || !path.endsWith(".banger")) throw new Error("Use a relative .banger path inside the open project.");
    const parts = path.split("/");
    if (parts.length > PROJECT_LIMITS.depth || parts.some(part => !part || part === "." || part === ".." || part.startsWith("."))) throw new Error("Hidden paths and path traversal are not allowed.");
    const absolute = resolve(this.root, path);
    if (relative(this.root, absolute).startsWith(`..${sep}`)) throw new Error("Path leaves the project.");
    if (await realpath(this.root) !== this.root) throw new Error("The project root moved. Reopen the project.");
    let current = this.root;
    for (let index = 0; index < parts.length; index++) {
      current = join(current, parts[index]!);
      let stat;
      try { stat = await lstat(current); }
      catch (error) {
        if (mayCreate && index === parts.length - 1 && (error as NodeJS.ErrnoException).code === "ENOENT") return absolute;
        throw new Error("The requested project file or folder does not exist.");
      }
      if (stat.isSymbolicLink()) throw new Error("Symbolic links are not allowed in project paths.");
      if (index < parts.length - 1 && !stat.isDirectory()) throw new Error("The parent path is not a directory.");
      if (index === parts.length - 1 && (!stat.isFile() || stat.nlink !== 1)) throw new Error("Only regular files without hard links are supported.");
    }
    return absolute;
  }

  async list(): Promise<string[]> {
    if (await realpath(this.root) !== this.root) throw new Error("The project root moved. Reopen the project.");
    const files: string[] = [];
    let entries = 0;
    const visit = async (directory: string, depth: number): Promise<void> => {
      if (depth > PROJECT_LIMITS.depth) throw new Error("The project has too many nested folders.");
      const handle = await opendir(directory);
      for await (const entry of handle) {
        if (++entries > PROJECT_LIMITS.entries) throw new Error("The project is too large. Open a smaller music folder.");
        if (entry.name.startsWith(".") || ignored.has(entry.name) || entry.isSymbolicLink()) continue;
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) {
          const stat = await lstat(absolute);
          if (stat.isSymbolicLink() || await realpath(absolute) !== absolute) continue;
          await visit(absolute, depth + 1);
        } else if (entry.isFile() && entry.name.endsWith(".banger")) {
          files.push(relative(this.root, absolute).split(sep).join("/"));
          if (files.length > PROJECT_LIMITS.files) throw new Error("The project has more than 256 music files. Open a smaller folder.");
        }
      }
    };
    await visit(this.root, 0);
    return files.sort();
  }

  async read(path: string): Promise<ProjectFile> {
    const absolute = await this.target(path);
    const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > PROJECT_LIMITS.fileBytes) throw new Error("Only regular music files under 64 KiB can be read.");
      const buffer = Buffer.alloc(PROJECT_LIMITS.fileBytes + 1);
      let count = 0;
      while (count < buffer.length) {
        const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count);
        if (!bytesRead) break;
        count += bytesRead;
      }
      if (count > PROJECT_LIMITS.fileBytes) throw new Error("Music files must be under 64 KiB.");
      const source = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, count));
      if (source.includes("\0")) throw new Error("Music files cannot contain null characters.");
      return { path, source };
    } finally { await handle.close(); }
  }

  // expectedSource prevents overwriting another editor's changes. null means create only.
  write(path: string, source: string, expectedSource: string | null, signal?: AbortSignal): Promise<ProjectFile> {
    const operation = this.queue.then(async () => {
      signal?.throwIfAborted();
      validateSource(source);
      const absolute = await this.target(path, true);
      let previous: ProjectFile | null = null;
      try { await lstat(absolute); previous = await this.read(path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (previous?.source !== expectedSource && !(previous === null && expectedSource === null)) throw new Error("The file changed or was not read. Read it again before editing.");
      if (previous === null && (await this.list()).length >= PROJECT_LIMITS.files) throw new Error("The project has reached its 256-file limit.");
      const temporary = join(dirname(absolute), `.banger-write-${randomUUID()}`);
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        await handle.writeFile(source, "utf8");
        await handle.sync();
        await handle.close();
        signal?.throwIfAborted();
        await this.target(path, true);
        if (previous !== null && (await this.read(path)).source !== expectedSource) throw new Error("The file changed while editing. Read it again.");
        if (previous === null) {
          // Link creates the final name exclusively, so a new editor file cannot be replaced.
          const { link } = await import("node:fs/promises");
          await link(temporary, absolute);
          await unlink(temporary);
        } else await rename(temporary, absolute);
        return { path, source };
      } finally {
        await handle.close().catch(() => undefined);
        await unlink(temporary).catch(() => undefined);
      }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async edit(path: string, search: string, replacement: string, expectedSource: string, signal?: AbortSignal): Promise<ProjectFile> {
    if (!search || expectedSource.split(search).length !== 2) throw new Error("The edit must match exactly one occurrence. Read the file and provide a unique search string.");
    return this.write(path, expectedSource.replace(search, () => replacement), expectedSource, signal);
  }

  async validate(paths?: string[]): Promise<Validation[]> {
    const selected = paths ?? await this.list();
    if (selected.length > PROJECT_LIMITS.files) throw new Error("Too many files to validate.");
    return Promise.all(selected.map(async path => {
      try { return { path, ok: true as const, ...validateSource((await this.read(path)).source) }; }
      catch (error) { return { path, ok: false as const, error: failure(error) }; }
    }));
  }
}

export async function openProject(root: string): Promise<ProjectWorkspace> {
  const canonical = await realpath(resolve(root));
  if (!(await lstat(canonical)).isDirectory()) throw new Error("Open a project directory.");
  const workspace = new ProjectWorkspace(canonical);
  await workspace.list();
  return workspace;
}
