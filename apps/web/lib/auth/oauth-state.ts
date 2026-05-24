import crypto from "crypto";

const SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";

export function createSignedState(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  const data = Buffer.from(json).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifySignedState<T = Record<string, unknown>>(state: string): T | null {
  const dotIdx = state.indexOf(".");
  if (dotIdx === -1) return null;
  const data = state.slice(0, dotIdx);
  const sig = state.slice(dotIdx + 1);
  if (!data || !sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) return null;
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString()) as T;
  } catch {
    return null;
  }
}
