import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { encryptToken } from "@openforge/shared/lib/encryption";
import { getDb } from "@/lib/db";
import { users, accounts, orgs, projects } from "@openforge/db/schema";

const FORGEJO_URL = process.env.FORGEJO_INTERNAL_URL ?? "http://localhost:3000";
const AGENT_TOKEN = process.env.FORGEJO_AGENT_TOKEN;
const ADMIN_USERNAME = "forge-admin";
const ADMIN_FORGEJO_PASSWORD =
  process.env.FORGEJO_ADMIN_PASSWORD ?? "admin-password-change-me";

async function forgejoApi(
  path: string,
  opts: RequestInit = {},
): Promise<Response> {
  return fetch(`${FORGEJO_URL}/api/v1${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `token ${AGENT_TOKEN}`,
      ...(opts.headers as Record<string, string> ?? {}),
    },
  });
}

async function ensureForgejoUser(
  email: string,
): Promise<{ id: number; login: string }> {
  const existing = await forgejoApi(`/users/${ADMIN_USERNAME}`);
  if (existing.ok) {
    return existing.json() as Promise<{ id: number; login: string }>;
  }

  const res = await forgejoApi("/admin/users", {
    method: "POST",
    body: JSON.stringify({
      username: ADMIN_USERNAME,
      password: ADMIN_FORGEJO_PASSWORD,
      email,
      must_change_password: false,
      login_name: ADMIN_USERNAME,
      source_id: 0,
      visibility: "public",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create Forgejo user: ${res.status} ${body}`);
  }

  return res.json() as Promise<{ id: number; login: string }>;
}

async function createForgejoToken(): Promise<string> {
  const basicAuth = Buffer.from(
    `${ADMIN_USERNAME}:${ADMIN_FORGEJO_PASSWORD}`,
  ).toString("base64");

  const res = await fetch(
    `${FORGEJO_URL}/api/v1/users/${ADMIN_USERNAME}/tokens`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
      body: JSON.stringify({
        name: `admin-bootstrap-${Date.now()}`,
        scopes: ["all"],
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create Forgejo token: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { sha1: string };
  return data.sha1;
}

/**
 * Auto-bootstrap the first admin user on startup.
 *
 * Runs only when:
 *   1. ADMIN_EMAIL and ADMIN_PASSWORD are set in environment
 *   2. FORGEJO_AGENT_TOKEN is available
 *   3. The `users` table is empty (first run)
 *
 * Idempotent — safe to call on every startup.
 */
export async function bootstrapAdminIfNeeded(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) return;
  if (!AGENT_TOKEN) return;

  const db = getDb();

  const [anyUser] = await db.select({ id: users.id }).from(users).limit(1);
  if (anyUser) return;

  console.log("[bootstrap] No users found — seeding admin account…");

  const forgejoUser = await ensureForgejoUser(adminEmail);
  const forgejoToken = await createForgejoToken();

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const userId = crypto.randomUUID();

  const orgId = crypto.randomUUID();
  await db.insert(orgs).values({
    id: orgId,
    name: "My Organization",
    slug: "my-organization",
  });

  await db.insert(users).values({
    id: userId,
    name: "Admin",
    email: adminEmail.toLowerCase(),
    orgId,
    forgejoUserId: forgejoUser.id,
    forgejoUsername: forgejoUser.login,
    passwordHash,
    isAdmin: true,
  });

  await db.insert(accounts).values({
    userId,
    type: "oauth" as const,
    provider: "forgejo",
    providerAccountId: String(forgejoUser.id),
    access_token: encryptToken(forgejoToken),
  });

  await db.insert(projects).values({
    id: crypto.randomUUID(),
    orgId,
    name: "Scratch",
    slug: `scratch-${userId}`,
    isScratch: true,
    createdBy: userId,
  });

  console.log(`[bootstrap] Admin created: ${adminEmail} (org: ${orgId})`);
}
