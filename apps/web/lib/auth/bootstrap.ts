import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";
import { users, orgs, projects } from "@coding-agents/db/schema";

/**
 * Auto-bootstrap the first admin user on startup.
 *
 * Runs only when:
 *   1. ADMIN_EMAIL and ADMIN_PASSWORD are set in environment
 *   2. The `users` table is empty (first run)
 *
 * Idempotent — safe to call on every startup.
 */
export async function bootstrapAdminIfNeeded(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) return;

  const db = getDb();

  const [anyUser] = await db.select({ id: users.id }).from(users).limit(1);
  if (anyUser) return;

  console.log("[bootstrap] No users found — seeding admin account…");

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
    passwordHash,
    isAdmin: true,
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
