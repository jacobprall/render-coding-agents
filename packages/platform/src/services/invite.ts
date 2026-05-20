import { and, eq, isNull, desc } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { users, invites, orgs, projects } from "@coding-agents/db/schema";
import type { PlatformDb } from "../interfaces/database";

const INVITE_EXPIRY_DAYS = 7;
const BCRYPT_ROUNDS = 12;

export interface CreateInviteParams {
  email: string;
  createdBy: string;
}

export interface CreateInviteResult {
  inviteId: string;
  token: string;
  email: string;
  expiresAt: Date;
}

export interface AcceptInviteParams {
  token: string;
  password: string;
  name?: string;
}

export interface InviteSummary {
  id: string;
  email: string | null;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;
  redeemedAt: Date | null;
  expired: boolean;
}

export class InviteService {
  constructor(private db: PlatformDb) {}

  async createInvite(params: CreateInviteParams): Promise<CreateInviteResult> {
    const { email, createdBy } = params;
    const normalizedEmail = email.toLowerCase().trim();

    const [existing] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);
    if (existing) {
      throw new Error(`A user with email ${normalizedEmail} already exists`);
    }

    const [org] = await this.db.select({ id: orgs.id }).from(orgs).limit(1);

    const userId = crypto.randomUUID();
    await this.db.insert(users).values({
      id: userId,
      email: normalizedEmail,
      orgId: org?.id ?? null,
    });

    if (org) {
      await this.db.insert(projects).values({
        id: crypto.randomUUID(),
        orgId: org.id,
        name: "Scratch",
        slug: `scratch-${userId}`,
        isScratch: true,
        createdBy: userId,
      }).onConflictDoNothing();
    }

    const token = generateSecureToken();
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const inviteId = crypto.randomUUID();
    await this.db.insert(invites).values({
      id: inviteId,
      email: normalizedEmail,
      invitedUserId: userId,
      token,
      createdBy,
      expiresAt,
    });

    return { inviteId, token, email: normalizedEmail, expiresAt };
  }

  async getInviteByToken(token: string): Promise<{
    id: string;
    email: string | null;
    invitedUserId: string;
    expiresAt: Date;
    redeemedAt: Date | null;
  } | null> {
    const [row] = await this.db
      .select({
        id: invites.id,
        email: invites.email,
        invitedUserId: invites.invitedUserId,
        expiresAt: invites.expiresAt,
        redeemedAt: invites.redeemedAt,
      })
      .from(invites)
      .where(eq(invites.token, token))
      .limit(1);
    return row ?? null;
  }

  async acceptInvite(params: AcceptInviteParams): Promise<{ userId: string; email: string }> {
    const { token, password, name } = params;

    const invite = await this.getInviteByToken(token);
    if (!invite) {
      throw new Error("Invalid invite token");
    }
    if (invite.redeemedAt) {
      throw new Error("This invite has already been used");
    }
    if (invite.expiresAt < new Date()) {
      throw new Error("This invite has expired");
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await this.db
      .update(users)
      .set({
        passwordHash,
        name: name || undefined,
        updatedAt: new Date(),
      })
      .where(eq(users.id, invite.invitedUserId));

    await this.db
      .update(invites)
      .set({
        redeemedAt: new Date(),
        redeemedBy: invite.invitedUserId,
      })
      .where(eq(invites.id, invite.id));

    return {
      userId: invite.invitedUserId,
      email: invite.email ?? "",
    };
  }

  async listInvites(): Promise<InviteSummary[]> {
    const rows = await this.db
      .select({
        id: invites.id,
        email: invites.email,
        createdBy: invites.createdBy,
        createdAt: invites.createdAt,
        expiresAt: invites.expiresAt,
        redeemedAt: invites.redeemedAt,
      })
      .from(invites)
      .orderBy(desc(invites.createdAt))
      .limit(100);

    const now = new Date();
    return rows.map((r) => ({
      ...r,
      expired: !r.redeemedAt && r.expiresAt < now,
    }));
  }

  async revokeInvite(inviteId: string): Promise<void> {
    const [invite] = await this.db
      .select({ id: invites.id, invitedUserId: invites.invitedUserId, redeemedAt: invites.redeemedAt })
      .from(invites)
      .where(and(eq(invites.id, inviteId), isNull(invites.redeemedAt)))
      .limit(1);

    if (!invite) {
      throw new Error("Invite not found or already redeemed");
    }

    // Delete the invite and the pre-provisioned user (cascade deletes the invite too)
    await this.db.delete(users).where(eq(users.id, invite.invitedUserId));
  }
}

function generateSecureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
