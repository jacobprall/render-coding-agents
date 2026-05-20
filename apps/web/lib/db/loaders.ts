import { cache } from "react";
import { getDb } from "@/lib/db";
import { userPreferences } from "@coding-agents/db";
import { eq } from "drizzle-orm";

export const getUserPreferences = cache(async (userId: string) => {
  const db = getDb();
  const [row] = await db
    .select({ data: userPreferences.data })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return row ?? null;
});
