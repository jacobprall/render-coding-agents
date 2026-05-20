import { NextRequest, NextResponse } from "next/server";
import { auth, ensureSyncConnection } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  if (!code || !state) {
    return NextResponse.redirect(new URL("/settings/connections?error=missing_params", req.url));
  }

  let statePayload: { userId: string; ts: number };
  try {
    statePayload = JSON.parse(Buffer.from(state, "base64url").toString());
  } catch {
    return NextResponse.redirect(new URL("/settings/connections?error=invalid_state", req.url));
  }

  if (statePayload.userId !== session.user.id) {
    return NextResponse.redirect(new URL("/settings/connections?error=state_mismatch", req.url));
  }

  const MAX_STATE_AGE_MS = 10 * 60 * 1000;
  if (Date.now() - statePayload.ts > MAX_STATE_AGE_MS) {
    return NextResponse.redirect(new URL("/settings/connections?error=state_expired", req.url));
  }

  try {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID!;
    const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET!;
    const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const redirectUri = `${baseUrl}/api/oauth/github/callback`;

    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return NextResponse.redirect(new URL("/settings/connections?error=token_exchange_failed", req.url));
    }

    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const ghUser = await userRes.json();

    await ensureSyncConnection(
      session.user.id,
      "github",
      tokenData.access_token,
      ghUser.login ?? "",
    );

    return NextResponse.redirect(new URL("/settings/connections?connected=github", req.url));
  } catch {
    return NextResponse.redirect(new URL("/settings/connections?error=oauth_failed", req.url));
  }
}
