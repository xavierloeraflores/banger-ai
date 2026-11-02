import { createRemoteJWKSet, jwtVerify } from "jose";
import { ApiError } from "./domain";
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
export async function authenticate(request: Request): Promise<string> {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new ApiError(401, "Sign in to access cloud projects.");
  const { AUTH_JWKS_URL, AUTH_ISSUER, AUTH_AUDIENCE } = process.env;
  if (!AUTH_JWKS_URL || !AUTH_ISSUER || !AUTH_AUDIENCE) throw new ApiError(503, "Cloud authentication is not configured.");
  jwks ??= createRemoteJWKSet(new URL(AUTH_JWKS_URL));
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: AUTH_ISSUER, audience: AUTH_AUDIENCE, algorithms: ["RS256", "ES256"], requiredClaims: ["sub", "exp"] });
    if (!payload.sub || payload.sub.length > 256) throw new Error("Invalid subject");
    return payload.sub;
  } catch { throw new ApiError(401, "Your session expired. Sign in again."); }
}
