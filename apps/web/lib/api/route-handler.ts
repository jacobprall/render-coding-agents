import { NextRequest, NextResponse } from "next/server";
import { requireForgeAuth, requireAuth } from "@/lib/platform";
import type { z } from "zod";

type ForgeAuthContext = Awaited<ReturnType<typeof requireForgeAuth>>;
type AuthContext = Awaited<ReturnType<typeof requireAuth>>;

export function withForgeAuth(
  fn: (
    auth: ForgeAuthContext,
    req: NextRequest,
    ctx: { params: Promise<Record<string, string>> },
  ) => Promise<NextResponse>,
) {
  return async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => {
    try {
      const auth = await requireForgeAuth();
      return await fn(auth, req, ctx);
    } catch (err) {
      if (err instanceof Response) return err;
      console.error("[api]", err);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

export function withAuth(
  fn: (
    auth: AuthContext,
    req: NextRequest,
    ctx: { params: Promise<Record<string, string>> },
  ) => Promise<NextResponse>,
) {
  return async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => {
    try {
      const auth = await requireAuth();
      return await fn(auth, req, ctx);
    } catch (err) {
      if (err instanceof Response) return err;
      console.error("[api]", err);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

export async function parseBody<T>(req: NextRequest, schema: z.ZodSchema<T>): Promise<T> {
  const body = await req.json();
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: result.error.flatten(),
        },
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  return result.data;
}
