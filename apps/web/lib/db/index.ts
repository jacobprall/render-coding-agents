import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@coding-agents/db/schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as { __forgeDb?: Db };

export function getDb(): Db {
  if (!globalForDb.__forgeDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL not set");
    const client = postgres(url, { max: 10, idle_timeout: 20 });
    globalForDb.__forgeDb = drizzle(client, { schema });
  }
  return globalForDb.__forgeDb;
}

export type ForgeDb = ReturnType<typeof getDb>;
