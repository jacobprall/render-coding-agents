"use server";

import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { userPreferences } from "@coding-agents/db/schema";
import type { UserPreferencesData } from "@coding-agents/db/schema";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";

export async function savePreferencesAction(formData: FormData): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session) redirect("/");

  const rawTheme = (formData.get("theme") as string) || null;
  const validThemes = new Set(["dark", "light"]);
  const theme = rawTheme && validThemes.has(rawTheme) ? rawTheme as UserPreferencesData["theme"] : null;

  const data: UserPreferencesData = {
    defaultModelId: (formData.get("defaultModelId") as string) || null,
    defaultSubagentModelId: (formData.get("defaultSubagentModelId") as string) || null,
    defaultDiffMode: (formData.get("defaultDiffMode") as "unified" | "split") ?? "unified",
    defaultWorkflowMode: (formData.get("defaultWorkflowMode") as "full" | "standard" | "fast" | "yolo") ?? "standard",
    autoCommitPush: formData.get("autoCommitPush") === "on",
    autoCreatePr: formData.get("autoCreatePr") === "on",
    accentColor: (formData.get("accentColor") as string) || null,
    secondaryColor: (formData.get("secondaryColor") as string) || null,
    tertiaryColor: (formData.get("tertiaryColor") as string) || null,
    theme,
  };

  try {
    const db = getDb();
    const userId = String(session.userId);

    await db
      .insert(userPreferences)
      .values({
        id: randomUUID(),
        userId,
        data,
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: { data, updatedAt: new Date() },
      });

    revalidatePath("/settings");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save preferences" };
  }
}
