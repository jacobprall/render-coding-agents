import { NextResponse } from "next/server";

export function apiSuccess<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function apiError(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json(
    { ok: false, error: { code, message, ...(details ? { details } : {}) } },
    { status },
  );
}

export function apiNotFound(message = "Not found") {
  return apiError("NOT_FOUND", message, 404);
}

export function apiForbidden(message = "Forbidden") {
  return apiError("FORBIDDEN", message, 403);
}

export function apiBadRequest(message: string, details?: unknown) {
  return apiError("BAD_REQUEST", message, 400, details);
}
