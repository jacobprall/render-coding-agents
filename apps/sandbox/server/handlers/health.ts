import type { HealthResult } from "../../types";
import { WORKSPACE_ROOT } from "../lib/constants";
import { getDiskUsage } from "../lib/disk-usage";

export async function handleHealth(): Promise<Response> {
  const du = await getDiskUsage(WORKSPACE_ROOT);

  const diskUsage =
    du ?? ({ totalBytes: 0, usedBytes: 0, freeBytes: 0, percentUsed: 0 } as HealthResult["diskUsage"]);

  const result: HealthResult = { status: "ok", diskUsage };
  return Response.json(result);
}
