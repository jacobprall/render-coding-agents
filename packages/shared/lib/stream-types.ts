/**
 * StreamEvent — the canonical event envelope for all agent/session events.
 *
 * All events flow as this shape through Redis, SSE, and the UI.
 */
export interface StreamEvent {
  v: 2;
  type: string;
  ts: string;
  requestId?: string;
  payload: Record<string, unknown>;
}

export type StreamEventType =
  | "agent:message"
  | "agent:tool_call"
  | "agent:tool_result"
  | "agent:heartbeat"
  | "agent:file_changed"
  | "agent:ask_user"
  | "agent:step_persisted"
  | "agent:verification"
  | "agent:verify_failed"
  | "session:completed"
  | "session:failed"
  | "session:aborted"
  | "session:phase_changed"
  | "plan:generated"
  | "plan:approved"
  | "plan:rejected"
  | "planner:started"
  | "planner:thinking"
  | "planner:completed"
  | "user:message"
  | "user:interrupt"
  | "user:plan_approved"
  | "user:plan_rejected"
  | "step:started"
  | "step:completed"
  | "step:failed";

const TERMINAL_TYPES = new Set<string>([
  "session:completed",
  "session:failed",
  "session:aborted",
]);

export function isTerminalEvent(event: StreamEvent | { type: string }): boolean {
  return TERMINAL_TYPES.has(event.type);
}
