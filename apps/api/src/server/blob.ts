import { get, put } from "@vercel/blob";
import { ApiError } from "./domain";
export interface ObjectStore { write(path: string, body: string | Buffer, contentType: string): Promise<void>; text(path: string): Promise<string> }
export const blobs: ObjectStore = {
  async write(path, body, contentType) { await put(path, body, { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType }); },
  async text(path) {
    const result = await get(path, { access: "private" });
    if (!result || result.statusCode !== 200) throw new ApiError(502, "A saved project object is unavailable.");
    return new Response(result.stream).text();
  },
};
