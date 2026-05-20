import { createHmac, timingSafeEqual } from "node:crypto";

export interface SandboxSessionClaims {
  sessionId: string;
  userId: string;
}

export const DEFAULT_SANDBOX_SESSION_TTL_SEC = 15 * 60;

interface SerializedPayload {
  sid: string;
  uid: string;
  exp: number;
}

export function mintSandboxSessionToken(params: {
  sessionId: string;
  userId: string;
  secret: string;
  ttlSec?: number;
}): string {
  const ttl = params.ttlSec ?? DEFAULT_SANDBOX_SESSION_TTL_SEC;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const body: SerializedPayload = { sid: params.sessionId, uid: params.userId, exp };
  const json = JSON.stringify(body);
  const sig = createHmac("sha256", params.secret).update(json).digest("base64url");
  return Buffer.from(json, "utf8").toString("base64url") + "." + sig;
}

export function verifySandboxSessionToken(
  token: string,
  secret: string,
): SandboxSessionClaims | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const enc = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!enc || !sig) return null;

  let json: string;
  try {
    json = Buffer.from(enc, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expected = createHmac("sha256", secret).update(json).digest("base64url");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let data: SerializedPayload;
  try {
    data = JSON.parse(json) as SerializedPayload;
  } catch {
    return null;
  }

  if (typeof data.sid !== "string" || typeof data.uid !== "string" || typeof data.exp !== "number") {
    return null;
  }
  if (data.exp < Math.floor(Date.now() / 1000)) return null;

  return { sessionId: data.sid, userId: data.uid };
}
