import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
  ".wasm": "application/wasm", ".mp3": "audio/mpeg", ".wav": "audio/wav",
};

export const APP_URL = "banger://app/";

export function isAppUrl(value: string, developmentUrl?: string): boolean {
  try {
    const url = new URL(value);
    const allowed = new URL(developmentUrl ?? APP_URL);
    return url.protocol === allowed.protocol && url.host === allowed.host &&
      !url.username && !url.password;
  } catch { return false; }
}

export async function serveApp(request: Request, directory: string): Promise<Response> {
  if (!isAppUrl(request.url)) return new Response("Forbidden", { status: 403 });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  let pathname: string;
  try { pathname = decodeURIComponent(new URL(request.url).pathname); }
  catch { return new Response("Invalid path", { status: 400 }); }
  if (pathname.includes("\\") || pathname.includes("\0") || pathname.split("/").includes("..")) {
    return new Response("Forbidden", { status: 403 });
  }
  const root = resolve(directory);
  const path = resolve(root, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
  if (!path.startsWith(`${root}${sep}`)) return new Response("Forbidden", { status: 403 });
  try {
    const body = await readFile(path);
    return new Response(request.method === "HEAD" ? null : new Uint8Array(body), {
      headers: {
        "Content-Type": contentTypes[extname(path)] ?? "application/octet-stream",
        "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch { return new Response("Not found", { status: 404 }); }
}
