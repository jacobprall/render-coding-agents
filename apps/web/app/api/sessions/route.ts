import { NextResponse, type NextRequest } from "next/server";
import { requireForgeAuth, getPlatform } from "@/lib/platform";
import { getDb } from "@/lib/db";
import { sessions } from "@coding-agents/db";
import { eq, desc, and, ne, inArray } from "drizzle-orm";

type SessionStatus = "running" | "completed" | "failed" | "archived" | "deleted";
type SessionFilter = "active" | "archived" | "all";

interface SessionRow {
  id: string;
  title: string | null;
  status: string;
  repoPath: string | null;
  lastActivityAt: Date | null;
  createdAt: Date;
}

function buildFilterConditions(
  filter: SessionFilter,
  userId: string,
): ReturnType<typeof eq>[] {
  const conditions = [eq(sessions.userId, userId)];

  switch (filter) {
    case "active":
      conditions.push(ne(sessions.status, "archived" satisfies SessionStatus));
      conditions.push(ne(sessions.status, "deleted" satisfies SessionStatus));
      break;
    case "archived":
      conditions.push(eq(sessions.status, "archived" satisfies SessionStatus));
      break;
    case "all":
      conditions.push(ne(sessions.status, "deleted" satisfies SessionStatus));
      break;
  }

  return conditions;
}

function groupSessionsByRepoPath(rows: SessionRow[]) {
  const groupMap = new Map<string | null, SessionRow[]>();

  for (const row of rows) {
    const key = row.repoPath;
    const existing = groupMap.get(key);
    if (existing) {
      existing.push(row);
    } else {
      groupMap.set(key, [row]);
    }
  }

  const groups = Array.from(groupMap.entries()).map(([repoPath, groupSessions]) => {
    const sorted = groupSessions.toSorted((a, b) => {
      const aTime = a.lastActivityAt?.getTime() ?? a.createdAt.getTime();
      const bTime = b.lastActivityAt?.getTime() ?? b.createdAt.getTime();
      return bTime - aTime;
    });

    return repoPath === null
      ? { repoPath: null as null, label: "Scratch", sessions: sorted }
      : { repoPath, sessions: sorted };
  });

  groups.sort((a, b) => {
    const aLabel = a.repoPath ?? "Scratch";
    const bLabel = b.repoPath ?? "Scratch";
    return aLabel.localeCompare(bLabel);
  });

  return groups;
}

export async function GET(req: NextRequest) {
  const auth = await requireForgeAuth();
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const filterParam = url.searchParams.get("filter");
  const groupedParam = url.searchParams.get("grouped");
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 100) : 50;

  const filter: SessionFilter =
    filterParam === "archived" || filterParam === "all" ? filterParam : "active";
  const grouped = groupedParam === "true" || groupedParam === "1";

  const db = getDb();
  const validStatuses: SessionStatus[] = [
    "running",
    "completed",
    "failed",
    "archived",
    "deleted",
  ];
  const conditions = buildFilterConditions(filter, auth.userId);

  if (status && validStatuses.includes(status as SessionStatus)) {
    conditions.push(eq(sessions.status, status as SessionStatus));
  }

  const rows = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      status: sessions.status,
      repoPath: sessions.repoPath,
      lastActivityAt: sessions.lastActivityAt,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(and(...conditions))
    .orderBy(desc(sessions.lastActivityAt))
    .limit(limit);

  if (grouped) {
    return NextResponse.json({ groups: groupSessionsByRepoPath(rows) });
  }

  return NextResponse.json({ sessions: rows });
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireForgeAuth();
    const data = await req.json();
    const branch = data.repoPath ? (data.branch || data.baseBranch || "main") : undefined;
    const result = await getPlatform().sessions.create(auth, { ...data, branch });
    return NextResponse.json({ id: result.sessionId, ...result }, { status: 201 });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[sessions] create failed:", err);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
