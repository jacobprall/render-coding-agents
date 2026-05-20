import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@coding-agents/db/schema";

/**
 * The Drizzle database instance type used throughout the platform.
 * Both apps/web and apps/agent create instances of this type.
 * Services receive it via constructor injection.
 */
export type PlatformDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Create a PlatformDb instance from a DATABASE_URL.
 * Convenience for composition roots that don't already have a connection.
 */
export function createDb(
  databaseUrl: string,
  opts?: { maxConnections?: number; idleTimeout?: number },
): PlatformDb {
  const client = postgres(databaseUrl, {
    max: opts?.maxConnections ?? 10,
    idle_timeout: opts?.idleTimeout ?? 20,
  });
  return drizzle(client, { schema });
}
