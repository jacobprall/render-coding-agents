/**
 * Manually bootstrap the first admin user.
 *
 * Normally this runs automatically on first startup via instrumentation.ts.
 * Use this script for manual runs or CI environments where the app isn't
 * starting up (e.g., database seeding before deploy).
 *
 * Usage:
 *   bun run apps/web/scripts/bootstrap-admin.ts
 *
 * Reads ADMIN_EMAIL / ADMIN_PASSWORD from the environment (same vars the
 * auto-bootstrap uses). Falls back to .env.local in the web app.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import * as schema from "@coding-agents/db/schema";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) {
  console.error("ADMIN_EMAIL and ADMIN_PASSWORD env vars are required.");
  console.error("Set them in .env.local or pass them directly:");
  console.error("  ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=… bun run apps/web/scripts/bootstrap-admin.ts");
  process.exit(1);
}

const client = postgres(DATABASE_URL);
const db = drizzle(client, { schema });

async function main() {
  console.log("=== Bootstrap Admin User ===\n");

  const passwordHash = await bcrypt.hash(password!, 12);
  const userId = crypto.randomUUID();
  const normalizedEmail = email!.toLowerCase();

  const [existing] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, normalizedEmail))
    .limit(1);

  if (existing) {
    await db
      .update(schema.users)
      .set({
        passwordHash,
        isAdmin: true,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, existing.id));

    console.log(`\nUpdated existing user: ${existing.id} (${normalizedEmail})`);
  } else {
    const orgId = crypto.randomUUID();
    await db.insert(schema.orgs).values({
      id: orgId,
      name: "My Organization",
      slug: "my-organization",
    }).onConflictDoNothing();

    await db.insert(schema.users).values({
      id: userId,
      name: "Admin",
      email: normalizedEmail,
      passwordHash,
      isAdmin: true,
      orgId,
    });

    await db.insert(schema.projects).values({
      id: crypto.randomUUID(),
      orgId,
      name: "Scratch",
      slug: `scratch-${userId}`,
      isScratch: true,
      createdBy: userId,
    });

    console.log(`\nCreated admin user: ${userId} (${normalizedEmail})`);
  }

  console.log("\n=== Done ===");
  console.log(`Sign in with: ${normalizedEmail}`);

  await client.end();
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
