/**
 * Global error handler middleware.
 * Catches service-layer errors and maps them to proper HTTP responses.
 */

import type { Context } from "hono";
import { AppError, logger } from "@coding-agents/shared";

export function onError(err: Error, c: Context): Response {
  if (err instanceof AppError) {
    return c.json(err.toJSON(), err.httpStatus as 400);
  }

  logger.errorWithCause(err, "unhandled gateway error", {
    method: c.req.method,
    path: c.req.path,
  });

  return c.json({ error: "Internal server error" }, 500);
}
