import type { PlatformDb, EventBus } from "@coding-agents/platform";
import { updateHeartbeat, publishEvent, evt } from "../run-persistence";

export const RUN_HEARTBEAT_INTERVAL_MS = 15_000;

export interface RunHeartbeatOptions {
  db: PlatformDb;
  runId: string;
  events?: EventBus;
  reqId?: string;
  /** When set with events, publishes agent:heartbeat with this activity label. */
  getActivity?: () => string;
}

/**
 * Single heartbeat owner per run: DB lastHeartbeatAt + optional SSE pulse.
 */
export function startRunHeartbeat(options: RunHeartbeatOptions): () => void {
  const { db, runId, events, reqId, getActivity } = options;

  const tick = async () => {
    await updateHeartbeat(db, runId);
    if (events && getActivity) {
      await publishEvent(
        events,
        runId,
        evt("agent:heartbeat", {
          timestamp: new Date().toISOString(),
          activity: getActivity(),
          step: 0,
        }),
        reqId,
      ).catch(() => {});
    }
  };

  void tick();
  const interval = setInterval(() => {
    void tick();
  }, RUN_HEARTBEAT_INTERVAL_MS);

  return () => clearInterval(interval);
}
