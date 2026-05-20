/**
 * One-time migration: Forgejo numeric user IDs → NextAuth UUIDs.
 *
 * Scans all tables that store user_id (as Forgejo numeric IDs in text),
 * creates a NextAuth `users` row for each unique ID, and updates all
 * references to use the new UUID.
 *
 * Run with:  bun run apps/web/scripts/migrate-user-ids.ts
 *
 * This script is idempotent — re-running it will skip users that
 * already have a `users` row (matched by forgejo_user_id).
 *
 * A reverse mapping is logged to stdout for rollback reference.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import * as schema from "@coding-agents/db/schema";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const FORGEJO_INTERNAL_URL =
  process.env.FORGEJO_INTERNAL_URL || "http://localhost:3000";
const FORGEJO_AGENT_TOKEN = process.env.FORGEJO_AGENT_TOKEN;

const client = postgres(DATABASE_URL);
const db = drizzle(client, { schema });

interface ForgejoUser {
  id: number;
  login: string;
  email: string;
  avatar_url: string;
  full_name?: string;
}

async function lookupForgejoUser(
  userId: string,
): Promise<ForgejoUser | null> {
  if (!FORGEJO_AGENT_TOKEN) return null;

  try {
    const res = await fetch(
      `${FORGEJO_INTERNAL_URL}/api/v1/users/search?q=&uid=${userId}&limit=1`,
      { headers: { Authorization: `token ${FORGEJO_AGENT_TOKEN}` } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: ForgejoUser[] };
    return data.data?.[0] ?? null;
  } catch {
    return null;
  }
}

const TABLES_WITH_USER_ID = [
  { table: schema.sessions, column: schema.sessions.userId, name: "sessions" },
  { table: schema.prEvents, column: schema.prEvents.userId, name: "pr_events" },
  { table: schema.agentRuns, column: schema.agentRuns.userId, name: "agent_runs" },
  { table: schema.syncConnections, column: schema.syncConnections.userId, name: "sync_connections" },
  { table: schema.userPreferences, column: schema.userPreferences.userId, name: "user_preferences" },
  { table: schema.usageEvents, column: schema.usageEvents.userId, name: "usage_events" },
] as const;

const NULLABLE_USER_ID_TABLES = [
  { table: schema.skillCache, column: schema.skillCache.userId, name: "skill_cache" },
] as const;

async function collectDistinctUserIds(): Promise<Set<string>> {
  const ids = new Set<string>();

  for (const { name } of TABLES_WITH_USER_ID) {
    const rows = await db.execute<{ user_id: string }>(
      sql.raw(`SELECT DISTINCT user_id FROM "${name}" WHERE user_id IS NOT NULL`),
    );
    for (const row of rows) {
      ids.add(row.user_id);
    }
  }

  for (const { name } of NULLABLE_USER_ID_TABLES) {
    const rows = await db.execute<{ user_id: string }>(
      sql.raw(`SELECT DISTINCT user_id FROM "${name}" WHERE user_id IS NOT NULL`),
    );
    for (const row of rows) {
      ids.add(row.user_id);
    }
  }

  return ids;
}

async function main() {
  console.log("=== User ID Migration: Forgejo IDs → NextAuth UUIDs ===\n");

  const forgejoIds = await collectDistinctUserIds();
  console.log(`Found ${forgejoIds.size} distinct Forgejo user IDs in app data.\n`);

  if (forgejoIds.size === 0) {
    console.log("No data to migrate. Exiting.");
    await client.end();
    return;
  }

  const mapping = new Map<string, string>();

  for (const forgejoIdStr of forgejoIds) {
    const forgejoId = parseInt(forgejoIdStr, 10);

    const [existing] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.externalProviderId, forgejoId))
      .limit(1);

    if (existing) {
      mapping.set(forgejoIdStr, existing.id);
      console.log(`  [skip] Forgejo ${forgejoIdStr} → ${existing.id} (already exists)`);
      continue;
    }

    const forgejoUser = await lookupForgejoUser(forgejoIdStr);
    const newId = crypto.randomUUID();

    await db.insert(schema.users).values({
      id: newId,
      name: forgejoUser?.full_name || forgejoUser?.login || `user-${forgejoIdStr}`,
      email: forgejoUser?.email || `forgejo-${forgejoIdStr}@migration.local`,
      image: forgejoUser?.avatar_url || null,
      externalProviderId: forgejoId,
      externalUsername: forgejoUser?.login || null,
    });

    mapping.set(forgejoIdStr, newId);
    console.log(`  [new]  Forgejo ${forgejoIdStr} → ${newId} (${forgejoUser?.login ?? "unknown"})`);
  }

  console.log("\nUpdating user_id references in app tables...\n");

  for (const [oldId, newId] of mapping) {
    for (const { column, name } of TABLES_WITH_USER_ID) {
      const result = await db
        .update(column.table)
        .set({ userId: newId } as Record<string, unknown>)
        .where(eq(column, oldId));
      // @ts-expect-error -- rowCount is available on postgres-js results
      const count = result?.rowCount ?? result?.length ?? 0;
      if (count > 0) {
        console.log(`  ${name}: updated ${count} rows (${oldId} → ${newId})`);
      }
    }

    for (const { column, name } of NULLABLE_USER_ID_TABLES) {
      const result = await db
        .update(column.table)
        .set({ userId: newId } as Record<string, unknown>)
        .where(eq(column, oldId));
      // @ts-expect-error -- rowCount is available on postgres-js results
      const count = result?.rowCount ?? result?.length ?? 0;
      if (count > 0) {
        console.log(`  ${name}: updated ${count} rows (${oldId} → ${newId})`);
      }
    }
  }

  console.log("\n=== Migration complete ===\n");
  console.log("Reverse mapping (for rollback reference):");
  console.log(JSON.stringify(Object.fromEntries(mapping), null, 2));

  await client.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
