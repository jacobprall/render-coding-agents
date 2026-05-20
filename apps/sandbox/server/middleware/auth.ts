import { timingSafeEqual } from "node:crypto";
import { IS_PRODUCTION, SANDBOX_SESSION_SECRET, SANDBOX_SHARED_SECRET } from "../lib/constants";
import { jsonError } from "../lib/http-response";
import { verifySandboxSessionToken } from "../../session-token";

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export function checkAuth(req: Request): Response | null {
  if (!SANDBOX_SHARED_SECRET) return null;

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token || !constantTimeCompare(token, SANDBOX_SHARED_SECRET)) {
    return jsonError(req, 401, "UNAUTHORIZED", "Unauthorized");
  }
  return null;
}

export function checkSessionBinding(req: Request): Response | null {
  if (!SANDBOX_SESSION_SECRET) return null;

  const sessionId = req.headers.get("x-session-id");
  const token = req.headers.get("x-sandbox-session-token");
  if (!sessionId || !token) {
    return jsonError(req, 401, "SESSION_BINDING_REQUIRED", "Missing session binding token");
  }

  const claims = verifySandboxSessionToken(token, SANDBOX_SESSION_SECRET);
  if (!claims || claims.sessionId !== sessionId) {
    return jsonError(req, 401, "INVALID_SESSION_TOKEN", "Invalid session binding token");
  }

  return null;
}

export function assertProductionSecretsOrExit(): void {
  if (!IS_PRODUCTION) {
    if (!SANDBOX_SHARED_SECRET) {
      console.warn(
        "WARNING: SANDBOX_SHARED_SECRET is not set — bearer auth is disabled (non-production only)",
      );
    }
    if (!SANDBOX_SESSION_SECRET) {
      console.warn(
        "WARNING: SANDBOX_SESSION_SECRET is not set — session binding is disabled (non-production only)",
      );
    }
    return;
  }

  if (!SANDBOX_SHARED_SECRET) {
    console.error("FATAL: SANDBOX_SHARED_SECRET is required when NODE_ENV=production");
    process.exit(1);
  }
  if (!SANDBOX_SESSION_SECRET) {
    console.error("FATAL: SANDBOX_SESSION_SECRET is required when NODE_ENV=production");
    process.exit(1);
  }
}
