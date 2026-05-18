import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { accounts, invites, users, orgs, projects } from "@openforge/db/schema";
import { ValidationError } from "@openforge/shared";
import type { PlatformDb } from "../interfaces/database";
import type { AuthContext } from "../interfaces/auth";
import { encryptToken } from "../auth/encryption";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FORGEJO_INTERNAL_URL =
  process.env.FORGEJO_INTERNAL_URL || "http://localhost:3000";

const BCRYPT_ROUNDS = 12;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ---------------------------------------------------------------------------
// Parameter and result types
// ---------------------------------------------------------------------------

export interface CreateInviteParams {
  username: string;
  email?: string;
}

export interface CreateInviteResult {
  inviteUrl: string;
  username: string;
  expiresAt: string;
}

export interface AcceptInviteResult {
  ok: true;
  email: string | null;
}

export interface InviteSummary {
  id: string;
  email: string | null;
  forgejoUsername: string | null;
  expiresAt: Date;
  redeemedAt: Date | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// InviteService
// ---------------------------------------------------------------------------

export class InviteService {
  constructor(private db: PlatformDb) {}

  // -------------------------------------------------------------------------
  // listInvites — GET /api/invites
  // -------------------------------------------------------------------------

  async listInvites(auth: AuthContext): Promise<InviteSummary[]> {
    const rows = await this.db
      .select({
        id: invites.id,
        email: invites.email,
        forgejoUsername: invites.forgejoUsername,
        expiresAt: invites.expiresAt,
        redeemedAt: invites.redeemedAt,
        createdAt: invites.createdAt,
      })
      .from(invites)
      .where(eq(invites.createdBy, auth.userId))
      .orderBy(desc(invites.createdAt));

    return rows;
  }

  // -------------------------------------------------------------------------
  // createInvite — POST /api/invites
  // -------------------------------------------------------------------------

  async createInvite(
    auth: AuthContext,
    params: CreateInviteParams,
  ): Promise<CreateInviteResult> {
    const { username } = params;
    const userEmail = (params.email ?? `${username}@open-forge.local`).toLowerCase();

    const forgejoBootstrapPassword = generateSecurePassword();
    const forgejoUser = await createForgejoUser(username, forgejoBootstrapPassword, userEmail);
    const { token: forgejoToken, profile } = await createForgejoApiTokenForUser(
      forgejoUser.login,
      forgejoBootstrapPassword,
    );

    const invitedUserId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const inviteId = crypto.randomUUID();
    const token = createInviteToken(inviteId, expiresAt);

    const [org] = await this.db.select().from(orgs).limit(1);

    await this.db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: invitedUserId,
        name: profile.full_name || profile.login,
        email: userEmail,
        image: profile.avatar_url,
        orgId: org?.id ?? null,
        forgejoUserId: profile.id,
        forgejoUsername: profile.login,
      });

      await tx.insert(accounts).values({
        userId: invitedUserId,
        type: "oauth",
        provider: "forgejo",
        providerAccountId: String(profile.id),
        access_token: encryptToken(forgejoToken),
      });

      await tx.insert(invites).values({
        id: inviteId,
        email: userEmail,
        forgejoUsername: username,
        invitedUserId,
        token,
        createdBy: auth.userId,
        expiresAt,
      });

      if (org) {
        await tx.insert(projects).values({
          id: crypto.randomUUID(),
          orgId: org.id,
          name: "Scratch",
          slug: `scratch-${invitedUserId}`,
          isScratch: true,
          createdBy: invitedUserId,
        });
      }
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:4000";
    const inviteUrl = `${appUrl}/invite/accept?token=${encodeURIComponent(token)}`;

    return { inviteUrl, username, expiresAt: expiresAt.toISOString() };
  }

  // -------------------------------------------------------------------------
  // acceptInvite — POST /api/auth/invite/accept
  // -------------------------------------------------------------------------

  async acceptInvite(rawToken: string, newPassword: string): Promise<AcceptInviteResult> {
    const signed = verifyInviteToken(rawToken);
    if (!signed) {
      throw new ValidationError("Invalid or expired invite token");
    }

    const [invite] = await this.db
      .select()
      .from(invites)
      .where(and(eq(invites.id, signed.inviteId), isNull(invites.redeemedAt)))
      .limit(1);

    if (!invite) {
      throw new ValidationError("Invite not found or already used");
    }

    if (new Date() > invite.expiresAt) {
      throw new ValidationError("Invite has expired");
    }

    const [invitedUser] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, invite.invitedUserId))
      .limit(1);

    if (!invitedUser) {
      throw new ValidationError("Invited user record missing");
    }

    if (invitedUser.passwordHash) {
      throw new ValidationError("This invite was already completed; sign in instead.");
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, invitedUser.id));

      await tx
        .update(invites)
        .set({ redeemedAt: new Date(), redeemedBy: invitedUser.id })
        .where(eq(invites.id, invite.id));
    });

    return { ok: true, email: invitedUser.email };
  }
}

// ---------------------------------------------------------------------------
// Private helpers — Forgejo admin API
// ---------------------------------------------------------------------------

interface ForgejoUserProfile {
  id: number;
  login: string;
  email: string;
  avatar_url: string;
  full_name?: string;
}

async function createForgejoUser(
  username: string,
  password: string,
  email: string,
): Promise<{ id: number; login: string }> {
  const agentToken = process.env.FORGEJO_AGENT_TOKEN;
  if (!agentToken) throw new Error("FORGEJO_AGENT_TOKEN not configured");

  const res = await fetch(`${FORGEJO_INTERNAL_URL}/api/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `token ${agentToken}`,
    },
    body: JSON.stringify({
      username,
      password,
      email,
      must_change_password: false,
      login_name: username,
      source_id: 0,
      visibility: "public",
    }),
  });

  if (res.status === 422) {
    const body = await res.text();
    throw new Error(`Forgejo user "${username}" already exists: ${body}`);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create Forgejo user: ${res.status} ${body}`);
  }

  return res.json() as Promise<{ id: number; login: string }>;
}

async function createForgejoApiTokenForUser(
  username: string,
  password: string,
): Promise<{ token: string; profile: ForgejoUserProfile }> {
  const agentToken = process.env.FORGEJO_AGENT_TOKEN;
  if (!agentToken) throw new Error("FORGEJO_AGENT_TOKEN not configured");

  const userRes = await fetch(
    `${FORGEJO_INTERNAL_URL}/api/v1/users/${encodeURIComponent(username)}`,
    { headers: { Authorization: `token ${agentToken}` } },
  );

  if (!userRes.ok) {
    throw new Error(`Failed to look up Forgejo user: ${userRes.status}`);
  }

  const profile = (await userRes.json()) as ForgejoUserProfile;

  const basicAuth = Buffer.from(`${username}:${password}`).toString("base64");
  const tokenRes = await fetch(
    `${FORGEJO_INTERNAL_URL}/api/v1/users/${encodeURIComponent(username)}/tokens`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
      body: JSON.stringify({
        name: `open-forge-app-${Date.now()}`,
        scopes: ["all"],
      }),
    },
  );

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Failed to create Forgejo token: ${tokenRes.status} ${body}`);
  }

  const tokenData = (await tokenRes.json()) as { sha1: string };
  return { token: tokenData.sha1, profile };
}

// ---------------------------------------------------------------------------
// Private helpers — invite token (HMAC-SHA256 signed)
// ---------------------------------------------------------------------------

/**
 * Tokens are signed payloads: "{inviteId}:{expiresEpoch}:{sig}"
 * The signature prevents tampering without needing a database lookup first.
 */
function getInviteSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for invite tokens");
  return secret;
}

function createInviteToken(inviteId: string, expiresAt: Date): string {
  const expiresEpoch = Math.floor(expiresAt.getTime() / 1000);
  const payload = `${inviteId}:${expiresEpoch}`;
  const sig = createHmac("sha256", getInviteSecret()).update(payload).digest("hex");
  return `${payload}:${sig}`;
}

function verifyInviteToken(token: string): { inviteId: string; expiresEpoch: number } | null {
  const parts = token.split(":");
  if (parts.length !== 3) return null;

  const [inviteId, expiresStr, sig] = parts;
  if (!inviteId || !expiresStr || !sig) return null;

  const expiresEpoch = parseInt(expiresStr, 10);
  if (isNaN(expiresEpoch)) return null;

  if (Date.now() / 1000 > expiresEpoch) return null;

  const payload = `${inviteId}:${expiresStr}`;
  const expected = createHmac("sha256", getInviteSecret()).update(payload).digest("hex");

  const sigBuf = Buffer.from(sig, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  return { inviteId, expiresEpoch };
}

function generateSecurePassword(): string {
  return randomBytes(24).toString("base64url");
}
