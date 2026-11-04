import { randomUUID } from "node:crypto";
import { localMediaEnabled, mediaObjects, MAX_AUDIO_BYTES } from "./media-objects";
export { MAX_AUDIO_BYTES } from "./media-objects";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { z } from "zod";
import { validateWav } from "@banger/elevenlabs";
import { db } from "./db";
import { authenticate } from "./auth";
import { authorize, readManifest } from "./projects";
import { ApiError, id } from "./domain";
export async function reserveWav(user: string, project: string, revision: number) {
  await authorize(user, project, true);
  await readManifest(project, revision);
  const artifactId = randomUUID();
  const pathname = `projects/${project}/audio/${artifactId}.wav`;
  await db().query("INSERT INTO artifacts(id,project_id,revision,user_id,kind,pathname,content_type) VALUES($1,$2,$3,$4,'wav',$5,'audio/wav')", [artifactId, project, revision, user, pathname]);
  return { id: artifactId, pathname, ...(localMediaEnabled() ? {uploadUrl: `/artifacts/${artifactId}/upload`} : {}) };
}
export async function getArtifact(user: string, artifactId: string, write = false) {
  const artifact = (await db().query("SELECT * FROM artifacts WHERE id=$1", [artifactId])).rows[0];
  if (!artifact) throw new ApiError(404, "Audio not found.");
  await authorize(user, artifact.project_id, write);
  return artifact as { id: string; project_id: string; revision: number; user_id: string; kind: string; pathname: string; content_type: string; size: string; status: string };
}
export async function finalizeWav(artifactId: string) {
  const artifact = (await db().query("SELECT * FROM artifacts WHERE id=$1 AND kind='wav'", [artifactId])).rows[0];
  if (!artifact) throw new ApiError(404, "Upload not found.");
  if (artifact.status === 'ready') return;
  const size = await mediaObjects.size(artifact.pathname);
  if (size < 44 || size > MAX_AUDIO_BYTES) throw new ApiError(422, 'Invalid WAV upload.');
  const bytes = await mediaObjects.read(artifact.pathname);
  try {validateWav(bytes,false);}catch(error){throw new ApiError(422,error instanceof Error?error.message:"Invalid WAV.");}
  await db().query("UPDATE artifacts SET status='ready',size=$2 WHERE id=$1 AND status='pending'", [artifactId, size]);
}
export async function uploadCallback(request: Request, body: HandleUploadBody) {
  return handleUpload({ request, body,
    onBeforeGenerateToken: async (pathname, payload) => {
      const user = await authenticate(request);
      const { artifactId } = z.object({ artifactId: id }).strict().parse(JSON.parse(payload ?? '{}'));
      const artifact = await getArtifact(user, artifactId, true);
      if (artifact.user_id !== user || artifact.kind !== 'wav' || artifact.status !== 'pending' || pathname !== artifact.pathname) throw new ApiError(403, "This upload is not authorized.");
      return { allowedContentTypes: ['audio/wav'], maximumSizeInBytes: MAX_AUDIO_BYTES, addRandomSuffix: false, allowOverwrite: false, validUntil: Date.now() + 10 * 60000, tokenPayload: JSON.stringify({ artifactId }) };
    },
    // handleUpload authenticates the signed provider callback before invoking this function.
    onUploadCompleted: async ({ blob, tokenPayload }) => {
      const { artifactId } = z.object({ artifactId: id }).parse(JSON.parse(tokenPayload ?? '{}'));
      const artifact = (await db().query("SELECT pathname FROM artifacts WHERE id=$1", [artifactId])).rows[0];
      if (!artifact || blob.pathname !== artifact.pathname) throw new ApiError(403, "Upload path does not match.");
      await finalizeWav(artifactId);
    },
  });
}
