export function getRequestId(req: Request): string {
  return req.headers.get("x-request-id") ?? "unknown";
}

export function jsonError(req: Request, status: number, code: string, message: string): Response {
  const requestId = getRequestId(req);
  return Response.json(
    { error: { code, message, requestId } },
    { status, headers: { "X-Request-Id": requestId } },
  );
}
